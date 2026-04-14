const axios = require("axios");
const config = require("./config");
const { state, saveState, ensurePairStats, ensureStrategyStats, rememberSent, wasSent } = require("./state");
const {
  bot,
  setupTelegramUi,
  registerBasicHandlers,
  registerDryRunHandlers,
  buildDryRunTpMessage,
  buildDryRunSlMessage,
} = require("./telegram");

// your existing imports
const { detectSignals } = require("./strategies");

// =========================
// Common helpers
// =========================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchCandles(symbol, interval, bars = 250) {
  const intervalMsMap = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
  };

  const endTime = Date.now();
  const startTime = endTime - bars * intervalMsMap[interval];

  const body = {
    type: "candleSnapshot",
    req: {
      coin: symbol,
      interval,
      startTime,
      endTime,
    },
  };

  const res = await axios.post(config.hyperliquidApiUrl, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 20000,
  });

  if (!Array.isArray(res.data)) {
    throw new Error(`Unexpected response for ${symbol} ${interval}`);
  }

  return res.data.map((x) => ({
    openTime: Number(x.t),
    closeTime: Number(x.T),
    open: toNum(x.o),
    high: toNum(x.h),
    low: toNum(x.l),
    close: toNum(x.c),
    volume: toNum(x.v),
    symbol,
    interval,
  }));
}

async function getLatest1mPrice(symbol) {
  const candles = await fetchCandles(symbol, "1m", 5);
  const last = candles[candles.length - 1];
  if (!last) throw new Error(`No latest price for ${symbol}`);
  return last.close;
}

function rrPnlPct(side, entry, exit) {
  return side === "BUY"
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
}

function isReplyTargetMissing(error) {
  const detail = String(
    error?.response?.body?.description ||
    error?.response?.data?.description ||
    error?.message ||
    ""
  ).toLowerCase();

  return detail.includes("message to be replied not found");
}

async function sendTradeUpdate(text, replyToMessageId = null) {
  try {
    return await bot.sendMessage(config.telegramChatId, text, {
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    });
  } catch (error) {
    if (!replyToMessageId || !isReplyTargetMissing(error)) {
      throw error;
    }

    return bot.sendMessage(config.telegramChatId, text);
  }
}

// =========================
// Strategy trade lifecycle
// =========================
async function sendSignal(signal) {
  const sideText = signal.side === "BUY" ? "🚀 LONG SIGNAL" : "🔻 SHORT SIGNAL";
  const risk = Math.abs(signal.entry - signal.sl);
  const reward = Math.abs(signal.tp - signal.entry);
  const rr = risk > 0 ? `1:${(reward / risk).toFixed(2)}` : "n/a";

  const text = [
    `${sideText}`,
    `🪙 Pair: ${signal.symbol}`,
    `🌐 Hyperliquid: https://app.hyperliquid.xyz/trade/${signal.symbol}`,
    `⏱ Execution TF: 1m`,
    `🎯 Entry Price: ${signal.entry}`,
    `🥇 Planned TP: ${signal.tp}`,
    `🛑 Planned Stop: ${signal.sl}`,
    `⚖️ Risk/Reward: ${rr}`,
    `🧠 Strategy used: ${signal.strategy}`,
  ].join("\n");

  const sent = await bot.sendMessage(config.telegramChatId, text, {
    disable_web_page_preview: true,
  });

  state.liveTrades[signal.symbol] = {
    symbol: signal.symbol,
    side: signal.side,
    strategy: signal.strategy,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    signalMessageId: sent.message_id,
    signalTime: Date.now(),
    candleTime: signal.candleTime,
    mode: "strategy",
  };

  state.stats.totalSignals += 1;
  ensurePairStats(signal.symbol);
  ensureStrategyStats(signal.strategy);
  state.stats.byPair[signal.symbol].signals += 1;
  state.stats.byStrategy[signal.strategy].signals += 1;
  saveState();
}

async function closeTradeAsWin(trade) {
  const pnlPct = rrPnlPct(trade.side, trade.entry, trade.tp);

  await sendTradeUpdate(
    [
      `✅ TP HIT`,
      `🪙 Pair: ${trade.symbol}`,
      `${trade.side === "BUY" ? "🚀 Direction: LONG" : "🔻 Direction: SHORT"}`,
      `🎯 Entry: ${trade.entry}`,
      `🥇 TP Hit: ${trade.tp}`,
      `💰 PnL: ${pnlPct.toFixed(2)}%`,
      `🧠 Strategy: ${trade.strategy}`,
    ].join("\n"),
    trade.signalMessageId
  );

  state.stats.wins += 1;
  state.stats.pnlPct += pnlPct;

  ensurePairStats(trade.symbol);
  ensureStrategyStats(trade.strategy);

  state.stats.byPair[trade.symbol].wins += 1;
  state.stats.byPair[trade.symbol].pnlPct += pnlPct;

  state.stats.byStrategy[trade.strategy].wins += 1;
  state.stats.byStrategy[trade.strategy].pnlPct += pnlPct;

  delete state.liveTrades[trade.symbol];
  saveState();
}

async function closeTradeAsLoss(trade) {
  const pnlPct = rrPnlPct(trade.side, trade.entry, trade.sl);

  await sendTradeUpdate(
    [
      `🛑 SL HIT`,
      `🪙 Pair: ${trade.symbol}`,
      `${trade.side === "BUY" ? "🚀 Direction: LONG" : "🔻 Direction: SHORT"}`,
      `🎯 Entry: ${trade.entry}`,
      `🛑 Stop Hit: ${trade.sl}`,
      `📉 PnL: ${pnlPct.toFixed(2)}%`,
      `🧠 Strategy: ${trade.strategy}`,
    ].join("\n"),
    trade.signalMessageId
  );

  state.stats.losses += 1;
  state.stats.pnlPct += pnlPct;

  ensurePairStats(trade.symbol);
  ensureStrategyStats(trade.strategy);

  state.stats.byPair[trade.symbol].losses += 1;
  state.stats.byPair[trade.symbol].pnlPct += pnlPct;

  state.stats.byStrategy[trade.strategy].losses += 1;
  state.stats.byStrategy[trade.strategy].pnlPct += pnlPct;

  delete state.liveTrades[trade.symbol];
  saveState();
}

async function checkStrategyTrade(symbol, latestPrice) {
  const trade = state.liveTrades[symbol];
  if (!trade) return;

  if (trade.side === "BUY") {
    if (latestPrice >= trade.tp) return closeTradeAsWin(trade);
    if (latestPrice <= trade.sl) return closeTradeAsLoss(trade);
  } else {
    if (latestPrice <= trade.tp) return closeTradeAsWin(trade);
    if (latestPrice >= trade.sl) return closeTradeAsLoss(trade);
  }
}

// =========================
// Dry-run lifecycle
// =========================
async function openDryRunTrade(symbol, side, chatId) {
  try {
    if (!config.pairs.includes(symbol)) {
      return { ok: false, error: `Pair ${symbol} is not in watchlist.` };
    }

    if (state.liveTrades[symbol]) {
      return { ok: false, error: `A live strategy trade already exists for ${symbol}.` };
    }

    if (state.dryRunTrades[symbol]) {
      return { ok: false, error: `A dry-run trade already exists for ${symbol}.` };
    }

    const entry = await getLatest1mPrice(symbol);

    const tp =
      side === "BUY"
        ? entry * (1 + config.dryRunTpPct / 100)
        : entry * (1 - config.dryRunTpPct / 100);

    const sl =
      side === "BUY"
        ? entry * (1 - config.dryRunSlPct / 100)
        : entry * (1 + config.dryRunSlPct / 100);

    const signalText = [
      `${side === "BUY" ? "🧪🚀 DRY-RUN LONG OPENED" : "🧪🔻 DRY-RUN SHORT OPENED"}`,
      `🪙 Pair: ${symbol}`,
      `🌐 Hyperliquid: https://app.hyperliquid.xyz/trade/${symbol}`,
      `⏱ Execution TF: 1m`,
      `🎯 Entry Price: ${entry.toFixed(6)}`,
      `🥇 Planned TP: ${tp.toFixed(6)}`,
      `🛑 Planned Stop: ${sl.toFixed(6)}`,
      `⚖️ Risk/Reward: ${Math.abs(tp - entry) && Math.abs(entry - sl) ? `1:${(Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2)}` : "n/a"}`,
      `🧠 Strategy used: Manual Dry-Run ${side === "BUY" ? "Long" : "Short"}`,
    ].join("\n");

    const sent = await bot.sendMessage(chatId, signalText, {
      disable_web_page_preview: true,
    });

    const trade = {
      symbol,
      side,
      strategy: `Manual Dry-Run ${side === "BUY" ? "Long" : "Short"}`,
      entry,
      tp,
      sl,
      signalMessageId: sent.message_id,
      signalTime: Date.now(),
      mode: "dryrun",
    };

    state.dryRunTrades[symbol] = trade;
    saveState();

    return { ok: true, trade };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function closeDryRunTrade(symbol) {
  const trade = state.dryRunTrades[symbol];
  if (!trade) {
    return { ok: false, error: `No dry-run trade found for ${symbol}.` };
  }
  delete state.dryRunTrades[symbol];
  saveState();
  return { ok: true };
}

async function closeDryRunAsWin(trade) {
  const pnlPct = rrPnlPct(trade.side, trade.entry, trade.tp);

  await sendTradeUpdate(buildDryRunTpMessage(trade, pnlPct), trade.signalMessageId);

  delete state.dryRunTrades[trade.symbol];
  saveState();
}

async function closeDryRunAsLoss(trade) {
  const pnlPct = rrPnlPct(trade.side, trade.entry, trade.sl);

  await sendTradeUpdate(buildDryRunSlMessage(trade, pnlPct), trade.signalMessageId);

  delete state.dryRunTrades[trade.symbol];
  saveState();
}

async function checkDryRunTrade(symbol, latestPrice) {
  const trade = state.dryRunTrades[symbol];
  if (!trade) return;

  if (trade.side === "BUY") {
    if (latestPrice >= trade.tp) return closeDryRunAsWin(trade);
    if (latestPrice <= trade.sl) return closeDryRunAsLoss(trade);
  } else {
    if (latestPrice <= trade.tp) return closeDryRunAsWin(trade);
    if (latestPrice >= trade.sl) return closeDryRunAsLoss(trade);
  }
}

// =========================
// Scan
// =========================
async function scanSymbol(symbol) {
  try {
    const [c1m, c5m, c15] = await Promise.all([
      fetchCandles(symbol, "1m", 250),
      fetchCandles(symbol, "5m", 250),
      fetchCandles(symbol, "15m", 250),
    ]);

    if (c1m.length < 50 || c5m.length < 50 || c15.length < 50) return;

    const latest1m = c1m[c1m.length - 1];
    await checkStrategyTrade(symbol, latest1m.close);
    await checkDryRunTrade(symbol, latest1m.close);

    if (state.liveTrades[symbol] || state.dryRunTrades[symbol]) {
      return;
    }

    const signals = detectSignals(symbol, c1m, c5m, c15);

    for (const signal of signals) {
      const dedupKey = `${signal.symbol}|${signal.strategy}|${signal.side}|${signal.candleTime}`;
      if (wasSent(dedupKey)) continue;

      rememberSent(dedupKey);
      await sendSignal(signal);
      break;
    }

    saveState();
  } catch (err) {
    console.error(`[${symbol}]`, err.message);
  }
}

async function runScan() {
  for (const symbol of config.pairs) {
    await scanSymbol(symbol);
    await sleep(400);
  }
}

// =========================
// Boot
// =========================
async function start() {
  await setupTelegramUi();
  registerBasicHandlers();
  registerDryRunHandlers({ openDryRunTrade, closeDryRunTrade });

  console.log("Bot started");
  console.log("Pairs:", config.pairs.join(", "));

  await runScan();
  setInterval(runScan, config.scanIntervalMs);
}

start().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
