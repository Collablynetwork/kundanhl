const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const { state, saveState } = require("./state");

const bot = new TelegramBot(config.telegramBotToken, { polling: true });

function menuKeyboard() {
  return {
    keyboard: [
      [{ text: "/stats" }, { text: "/live" }],
      [{ text: "/dryrun_list" }, { text: "/pairs" }],
      [{ text: "/help" }, { text: "/menu" }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

function formatPrice(n) {
  if (!Number.isFinite(n)) return "n/a";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatPct(n) {
  if (!Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function rrFromPrices(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return "n/a";
  return `1:${(reward / risk).toFixed(2)}`;
}

function hlTradeLink(symbol) {
  return `https://app.hyperliquid.xyz/trade/${symbol}`;
}

function buildStatsMessage() {
  const total = state.stats.totalSignals;
  const wins = state.stats.wins;
  const losses = state.stats.losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(2) : "0.00";

  return [
    `📊 BOT STATS`,
    `🎯 Total Signals: ${total}`,
    `✅ Wins: ${wins}`,
    `🛑 Losses: ${losses}`,
    `🏆 Win Rate: ${winRate}%`,
    `💰 Net PnL: ${formatPct(state.stats.pnlPct)}`,
  ].join("\n");
}

function buildLiveTradesMessage() {
  const trades = Object.values(state.liveTrades);
  if (!trades.length) return `📭 No live strategy trades right now.`;

  return [
    `📌 LIVE STRATEGY TRADES`,
    ...trades.map(
      (t) =>
        `\n🪙 ${t.symbol} | ${t.side === "BUY" ? "🚀 LONG" : "🔻 SHORT"}\n🎯 ${formatPrice(t.entry)} | 🥇 ${formatPrice(t.tp)} | 🛑 ${formatPrice(t.sl)}\n🧠 ${t.strategy}`
    ),
  ].join("\n");
}

function buildDryRunListMessage() {
  const trades = Object.values(state.dryRunTrades);
  if (!trades.length) return `🧪 No dry-run trades right now.`;

  return [
    `🧪 DRY-RUN TRADES`,
    ...trades.map(
      (t) =>
        `\n🪙 ${t.symbol} | ${t.side === "BUY" ? "🚀 LONG" : "🔻 SHORT"}\n🎯 ${formatPrice(t.entry)} | 🥇 ${formatPrice(t.tp)} | 🛑 ${formatPrice(t.sl)}\n🧠 ${t.strategy}`
    ),
  ].join("\n");
}

function buildPairsMessage() {
  return [`🧾 WATCHLIST`, ...config.pairs.map((p) => `• ${p}`)].join("\n");
}

function buildHelpMessage() {
  return [
    `🤖 COMMANDS`,
    `/stats - view win/loss and pnl`,
    `/live - view live strategy trades`,
    `/pairs - view watchlist pairs`,
    `/menu - show menu`,
    `/help - help`,
    ``,
    `🧪 DRY-RUN COMMANDS`,
    `/dryrun_long HYPE`,
    `/dryrun_short HYPE`,
    `/dryrun_close HYPE`,
    `/dryrun_list`,
  ].join("\n");
}

function buildDryRunOpenMessage(trade) {
  return [
    `${trade.side === "BUY" ? "🧪🚀 DRY-RUN LONG OPENED" : "🧪🔻 DRY-RUN SHORT OPENED"}`,
    `🪙 Pair: ${trade.symbol}`,
    `🌐 Hyperliquid: ${hlTradeLink(trade.symbol)}`,
    `⏱ Execution TF: 1m`,
    `🎯 Entry Price: ${formatPrice(trade.entry)}`,
    `🥇 Planned TP: ${formatPrice(trade.tp)}`,
    `🛑 Planned Stop: ${formatPrice(trade.sl)}`,
    `⚖️ Risk/Reward: ${rrFromPrices(trade.entry, trade.sl, trade.tp)}`,
    `🧠 Strategy used: ${trade.strategy}`,
  ].join("\n");
}

function buildDryRunTpMessage(trade, pnlPct) {
  return [
    `🧪✅ DRY-RUN TP HIT`,
    `🪙 Pair: ${trade.symbol}`,
    `${trade.side === "BUY" ? "🚀 Direction: LONG" : "🔻 Direction: SHORT"}`,
    `🎯 Entry: ${formatPrice(trade.entry)}`,
    `🥇 TP Hit: ${formatPrice(trade.tp)}`,
    `💰 PnL: ${formatPct(pnlPct)}`,
    `🧠 Strategy: ${trade.strategy}`,
  ].join("\n");
}

function buildDryRunSlMessage(trade, pnlPct) {
  return [
    `🧪🛑 DRY-RUN SL HIT`,
    `🪙 Pair: ${trade.symbol}`,
    `${trade.side === "BUY" ? "🚀 Direction: LONG" : "🔻 Direction: SHORT"}`,
    `🎯 Entry: ${formatPrice(trade.entry)}`,
    `🛑 Stop Hit: ${formatPrice(trade.sl)}`,
    `📉 PnL: ${formatPct(pnlPct)}`,
    `🧠 Strategy: ${trade.strategy}`,
  ].join("\n");
}

async function setupTelegramUi() {
  await bot.setMyCommands([
    { command: "stats", description: "View win/loss and pnl" },
    { command: "live", description: "View live trades" },
    { command: "pairs", description: "View watchlist pairs" },
    { command: "menu", description: "Show menu" },
    { command: "help", description: "Help and commands" },
    { command: "dryrun_list", description: "View dry-run trades" },
    { command: "dryrun_long", description: "Open dry-run long. Example: /dryrun_long HYPE" },
    { command: "dryrun_short", description: "Open dry-run short. Example: /dryrun_short HYPE" },
    { command: "dryrun_close", description: "Close dry-run trade. Example: /dryrun_close HYPE" },
  ]);
}

function registerBasicHandlers() {
  bot.onText(/\/start|\/menu/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "📋 Bot menu opened.", {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildHelpMessage(), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/stats/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildStatsMessage(), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/live/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildLiveTradesMessage(), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/pairs/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildPairsMessage(), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/dryrun_list/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildDryRunListMessage(), {
      reply_markup: menuKeyboard(),
    });
  });
}

function registerDryRunHandlers({ openDryRunTrade, closeDryRunTrade }) {
  bot.onText(/\/dryrun_long(?:\s+([A-Za-z0-9]+))?/, async (msg, match) => {
    const symbol = (match?.[1] || "").toUpperCase().trim();
    if (!symbol) {
      await bot.sendMessage(msg.chat.id, "Use like this:\n/dryrun_long HYPE");
      return;
    }
    const result = await openDryRunTrade(symbol, "BUY", msg.chat.id);
    if (!result.ok) {
      await bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      return;
    }
    await bot.sendMessage(msg.chat.id, buildDryRunOpenMessage(result.trade), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/dryrun_short(?:\s+([A-Za-z0-9]+))?/, async (msg, match) => {
    const symbol = (match?.[1] || "").toUpperCase().trim();
    if (!symbol) {
      await bot.sendMessage(msg.chat.id, "Use like this:\n/dryrun_short HYPE");
      return;
    }
    const result = await openDryRunTrade(symbol, "SELL", msg.chat.id);
    if (!result.ok) {
      await bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      return;
    }
    await bot.sendMessage(msg.chat.id, buildDryRunOpenMessage(result.trade), {
      reply_markup: menuKeyboard(),
    });
  });

  bot.onText(/\/dryrun_close(?:\s+([A-Za-z0-9]+))?/, async (msg, match) => {
    const symbol = (match?.[1] || "").toUpperCase().trim();
    if (!symbol) {
      await bot.sendMessage(msg.chat.id, "Use like this:\n/dryrun_close HYPE");
      return;
    }
    const result = await closeDryRunTrade(symbol);
    if (!result.ok) {
      await bot.sendMessage(msg.chat.id, `❌ ${result.error}`);
      return;
    }
    await bot.sendMessage(msg.chat.id, `🧪 Closed dry-run trade for ${symbol}`);
  });
}

module.exports = {
  bot,
  setupTelegramUi,
  registerBasicHandlers,
  registerDryRunHandlers,
  buildDryRunTpMessage,
  buildDryRunSlMessage,
};