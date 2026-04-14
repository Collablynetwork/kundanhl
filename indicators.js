const axios = require('axios');
const { RSI, MACD, ADX, SMA, EMA } = require('technicalindicators');
const { CONFIG } = require('./config');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function bodySize(c) {
  return Math.abs(c.close - c.open);
}

function candleRange(c) {
  return c.high - c.low;
}

function upperShadow(c) {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c) {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c) {
  return c.close > c.open;
}

function isBearish(c) {
  return c.close < c.open;
}

function recentAverageVolume(candles, lookback = 20, offsetFromEnd = 1) {
  const start = Math.max(0, candles.length - offsetFromEnd - lookback);
  const end = Math.max(0, candles.length - offsetFromEnd);
  return avg(candles.slice(start, end).map(c => c.volume));
}

function findSupportResistance(candles, lookback = 20) {
  const slice = candles.slice(-lookback);
  if (!slice.length) return { support: null, resistance: null };
  return {
    support: Math.min(...slice.map(c => c.low)),
    resistance: Math.max(...slice.map(c => c.high)),
  };
}

function nearZone(price, zone, tolerancePct = CONFIG.zoneTolerancePct) {
  if (!zone || zone <= 0) return false;
  return Math.abs(price - zone) / zone <= tolerancePct;
}

function crossedAbove(prev, curr, level) {
  return prev <= level && curr > level;
}

function crossedBelow(prev, curr, level) {
  return prev >= level && curr < level;
}

async function fetchCandles(symbol, interval, bars = 250) {
  const intervalMsMap = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
  };

  const endTime = Date.now();
  const startTime = endTime - bars * intervalMsMap[interval];

  const body = {
    type: 'candleSnapshot',
    req: {
      coin: symbol,
      interval,
      startTime,
      endTime,
    },
  };

  const res = await axios.post(CONFIG.hyperliquidApiUrl, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 20000,
  });

  if (!Array.isArray(res.data)) {
    throw new Error(`Unexpected response for ${symbol} ${interval}`);
  }

  return res.data.map(x => ({
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

function computeIndicators(candles) {
  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const volume = candles.map(c => c.volume);

  return {
    rsi: RSI.calculate({ period: 14, values: close }),
    macd: MACD.calculate({
      values: close,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }),
    adx: ADX.calculate({ period: 14, close, high, low }),
    ema20: EMA.calculate({ period: 20, values: close }),
    volSma20: SMA.calculate({ period: 20, values: volume }),
  };
}

function getLatestIndicatorPack(candles, indicators, shift = 0) {
  const idx = candles.length - 1 - shift;

  const rsiOffset = candles.length - indicators.rsi.length;
  const macdOffset = candles.length - indicators.macd.length;
  const adxOffset = candles.length - indicators.adx.length;
  const emaOffset = candles.length - indicators.ema20.length;
  const volOffset = candles.length - indicators.volSma20.length;

  return {
    candle: candles[idx] || null,
    rsi: indicators.rsi[idx - rsiOffset],
    macd: indicators.macd[idx - macdOffset],
    adx: indicators.adx[idx - adxOffset],
    ema20: indicators.ema20[idx - emaOffset],
    volSma20: indicators.volSma20[idx - volOffset],
  };
}

module.exports = {
  sleep,
  avg,
  bodySize,
  candleRange,
  upperShadow,
  lowerShadow,
  isBullish,
  isBearish,
  recentAverageVolume,
  findSupportResistance,
  nearZone,
  crossedAbove,
  crossedBelow,
  fetchCandles,
  computeIndicators,
  getLatestIndicatorPack,
};
