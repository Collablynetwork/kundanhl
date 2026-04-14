require("dotenv").config();

module.exports = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  hyperliquidApiUrl: process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz/info",
  pairs: (process.env.PAIRS || "HYPE,BTC,ETH,SOL")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS || 20000),
  volumeMultiplier: Number(process.env.VOLUME_MULTIPLIER || 1.5),
  adxMin: Number(process.env.ADX_MIN || 25),
  rsiBuyMin: Number(process.env.RSI_BUY_MIN || 50),
  rsiSellMax: Number(process.env.RSI_SELL_MAX || 50),
  supResLookback: Number(process.env.SUP_RES_LOOKBACK || 20),
  zoneTolerancePct: Number(process.env.ZONE_TOLERANCE_PCT || 0.003),
  use1mConfirmation: String(process.env.USE_1M_CONFIRMATION || "true") === "true",
  use5mConfirmation: String(process.env.USE_5M_CONFIRMATION || "true") === "true",
  stateFile: process.env.STATE_FILE || "bot_state.json",
  dryRunTpPct: Number(process.env.DRYRUN_TP_PCT || 1.0),
  dryRunSlPct: Number(process.env.DRYRUN_SL_PCT || 0.5),
};