const config = require("./config");
const {
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
  computeIndicators,
  getLatestIndicatorPack,
} = require("./indicators");

function detectTrend(candles, side) {
  if (!candles || candles.length < 10) return false;
  const closes = candles.slice(-8).map((c) => c.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  return side === "BUY" ? last > first : last < first;
}

function confirmation1m(c1m, i1m, side) {
  const p = getLatestIndicatorPack(c1m, i1m, 0);
  if (!p?.candle) return false;

  if (side === "BUY") {
    return (
      p.candle.close > (p.ema20 || 0) &&
      (p.macd?.histogram ?? -999) >= 0 &&
      (p.rsi ?? 0) >= 45
    );
  }

  return (
    p.candle.close < (p.ema20 || Infinity) &&
    (p.macd?.histogram ?? 999) <= 0 &&
    (p.rsi ?? 100) <= 55
  );
}

function confirmation5m(c5m, i5m, side) {
  const p = getLatestIndicatorPack(c5m, i5m, 0);
  if (!p?.candle) return false;

  if (side === "BUY") {
    return (
      (p.macd?.MACD ?? -999) > (p.macd?.signal ?? 999) &&
      (p.rsi ?? 0) >= 50
    );
  }

  return (
    (p.macd?.MACD ?? 999) < (p.macd?.signal ?? -999) &&
    (p.rsi ?? 100) <= 50
  );
}

function sharedBuyFilters(c15, i15, curr, support) {
  const pack = getLatestIndicatorPack(c15, i15, 0);
  const avgVol = recentAverageVolume(c15, 20, 1);

  return {
    ok:
      curr.volume >= avgVol * config.volumeMultiplier &&
      (pack.adx?.adx ?? 0) >= config.adxMin &&
      (pack.macd?.MACD ?? -999) > 0 &&
      (pack.rsi ?? 0) >= config.rsiBuyMin &&
      (curr.close > support ||
        nearZone(curr.low, support, config.zoneTolerancePct)),
    avgVol,
    adx: pack.adx?.adx ?? null,
    macd: pack.macd?.MACD ?? null,
    signal: pack.macd?.signal ?? null,
    rsi: pack.rsi ?? null,
  };
}

function sharedSellFilters(c15, i15, curr, resistance) {
  const pack = getLatestIndicatorPack(c15, i15, 0);
  const avgVol = recentAverageVolume(c15, 20, 1);

  return {
    ok:
      curr.volume >= avgVol * config.volumeMultiplier &&
      (pack.adx?.adx ?? 0) >= config.adxMin &&
      (pack.macd?.MACD ?? 999) < 0 &&
      (pack.rsi ?? 100) <= config.rsiSellMax &&
      (curr.close < resistance ||
        nearZone(curr.high, resistance, config.zoneTolerancePct)),
    avgVol,
    adx: pack.adx?.adx ?? null,
    macd: pack.macd?.MACD ?? null,
    signal: pack.macd?.signal ?? null,
    rsi: pack.rsi ?? null,
  };
}

function detectCondition1Buy(c15, i15, support) {
  const prev = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  if (!prev || !curr) return null;

  const engulfing =
    isBearish(prev) &&
    isBullish(curr) &&
    curr.open <= prev.close &&
    curr.close >= prev.open &&
    bodySize(curr) > bodySize(prev);

  if (!engulfing) return null;

  const filters = sharedBuyFilters(c15, i15, curr, support);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 1 - Bullish Engulfing",
    side: "BUY",
    entry: curr.close,
    sl: curr.close * 0.995,
    tp: curr.close * 1.03,
    percentageIncrease:
      bodySize(prev) > 0 ? (bodySize(curr) / bodySize(prev)) * 100 : 0,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition1Sell(c15, i15, resistance) {
  const prev = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  if (!prev || !curr) return null;

  const engulfing =
    isBullish(prev) &&
    isBearish(curr) &&
    curr.open >= prev.close &&
    curr.close <= prev.open &&
    bodySize(curr) > bodySize(prev);

  if (!engulfing) return null;

  const filters = sharedSellFilters(c15, i15, curr, resistance);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 1 - Bearish Engulfing",
    side: "SELL",
    entry: curr.close,
    sl: curr.close * 1.005,
    tp: curr.close * 0.97,
    percentageIncrease:
      bodySize(prev) > 0 ? (bodySize(curr) / bodySize(prev)) * 100 : 0,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition2Buy(c15, i15, support) {
  const prev = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  if (!prev || !curr) return null;

  const pattern =
    bodySize(curr) < bodySize(prev) &&
    lowerShadow(curr) >= 2 * bodySize(curr) &&
    upperShadow(curr) <= bodySize(curr);

  if (!pattern) return null;

  const filters = sharedBuyFilters(c15, i15, curr, support);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 2 - Bullish Pin Bar",
    side: "BUY",
    entry: curr.close,
    sl: curr.close * 0.995,
    tp: curr.close * 1.01,
    percentageIncrease:
      bodySize(prev) > 0 ? (bodySize(curr) / bodySize(prev)) * 100 : 0,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition2Sell(c15, i15, resistance) {
  const prev = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  if (!prev || !curr) return null;

  const pattern =
    bodySize(curr) < bodySize(prev) &&
    upperShadow(curr) >= 2 * bodySize(curr) &&
    lowerShadow(curr) <= bodySize(curr);

  if (!pattern) return null;

  const filters = sharedSellFilters(c15, i15, curr, resistance);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 2 - Bearish Pin Bar",
    side: "SELL",
    entry: curr.close,
    sl: curr.close * 1.005,
    tp: curr.close * 0.99,
    percentageIncrease:
      bodySize(prev) > 0 ? (bodySize(curr) / bodySize(prev)) * 100 : 0,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition3Buy(c15, i15, support) {
  if (c15.length < 3) return null;

  const c1 = c15[c15.length - 3];
  const c2 = c15[c15.length - 2];
  const c3 = c15[c15.length - 1];

  const pattern =
    detectTrend(c15.slice(0, -1), "SELL") &&
    isBearish(c1) &&
    bodySize(c2) <= bodySize(c1) * 0.5 &&
    isBullish(c3) &&
    c3.close > (c1.open + c1.close) / 2;

  if (!pattern) return null;

  const filters = sharedBuyFilters(c15, i15, c3, support);
  if (!filters.ok) return null;

  const patternLow = Math.min(c1.low, c2.low, c3.low);

  return {
    strategy: "Condition 3 - Morning Star",
    side: "BUY",
    entry: c3.close,
    sl: patternLow - c3.close * 0.005,
    tp: c3.close * 1.02,
    percentageIncrease:
      bodySize(c2) > 0 ? (bodySize(c3) / bodySize(c2)) * 100 : 0,
    meta: filters,
    candleTime: c3.closeTime,
  };
}

function detectCondition3Sell(c15, i15, resistance) {
  if (c15.length < 3) return null;

  const c1 = c15[c15.length - 3];
  const c2 = c15[c15.length - 2];
  const c3 = c15[c15.length - 1];

  const pattern =
    detectTrend(c15.slice(0, -1), "BUY") &&
    isBullish(c1) &&
    bodySize(c2) <= bodySize(c1) * 0.5 &&
    isBearish(c3) &&
    c3.close < (c1.open + c1.close) / 2;

  if (!pattern) return null;

  const filters = sharedSellFilters(c15, i15, c3, resistance);
  if (!filters.ok) return null;

  const patternHigh = Math.max(c1.high, c2.high, c3.high);

  return {
    strategy: "Condition 3 - Evening Star",
    side: "SELL",
    entry: c3.close,
    sl: patternHigh + c3.close * 0.005,
    tp: c3.close * 0.98,
    percentageIncrease:
      bodySize(c2) > 0 ? (bodySize(c3) / bodySize(c2)) * 100 : 0,
    meta: filters,
    candleTime: c3.closeTime,
  };
}

function detectCondition4Buy(c15, i15, support) {
  const curr = c15[c15.length - 1];
  if (!curr) return null;

  const pattern =
    detectTrend(c15.slice(0, -1), "SELL") &&
    bodySize(curr) < 0.5 * candleRange(curr) &&
    lowerShadow(curr) >= 2 * bodySize(curr);

  if (!pattern) return null;

  const filters = sharedBuyFilters(c15, i15, curr, support);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 4 - Hammer Buy",
    side: "BUY",
    entry: curr.close,
    sl: curr.low - curr.close * 0.005,
    tp: curr.close * 1.02,
    percentageIncrease: null,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition4Sell(c15, i15, resistance) {
  const curr = c15[c15.length - 1];
  if (!curr) return null;

  const pattern =
    detectTrend(c15.slice(0, -1), "BUY") &&
    bodySize(curr) < 0.5 * candleRange(curr) &&
    lowerShadow(curr) >= 2 * bodySize(curr);

  if (!pattern) return null;

  const filters = sharedSellFilters(c15, i15, curr, resistance);
  if (!filters.ok) return null;

  return {
    strategy: "Condition 4 - Hammer Sell",
    side: "SELL",
    entry: curr.close,
    sl: curr.high + curr.close * 0.005,
    tp: curr.close * 0.98,
    percentageIncrease: null,
    meta: filters,
    candleTime: curr.closeTime,
  };
}

function detectCondition5Buy(c15, i15, support) {
  if (c15.length < 3) return null;

  const prev2 = c15[c15.length - 3];
  const prev1 = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  const p0 = getLatestIndicatorPack(c15, i15, 0);
  const p1 = getLatestIndicatorPack(c15, i15, 1);
  const avgVol = recentAverageVolume(c15, 20, 1);

  const ok =
    prev1.volume >= avgVol * config.volumeMultiplier &&
    curr.volume < prev1.volume &&
    prev1.low < support &&
    curr.close > support &&
    crossedAbove(p1.macd?.signal ?? -999, p0.macd?.signal ?? -999, 0) &&
    (p0.adx?.adx ?? 0) >= config.adxMin &&
    (p0.rsi ?? 0) >= config.rsiBuyMin;

  if (!ok) return null;

  const recentLow = Math.min(prev2.low, prev1.low, curr.low);

  return {
    strategy: "Condition 5 - Reclaim Above Support",
    side: "BUY",
    entry: curr.close,
    sl: recentLow * 0.997,
    tp: curr.close * 1.01,
    percentageIncrease: null,
    meta: {
      avgVol,
      adx: p0.adx?.adx ?? null,
      macd: p0.macd?.MACD ?? null,
      signal: p0.macd?.signal ?? null,
      rsi: p0.rsi ?? null,
    },
    candleTime: curr.closeTime,
  };
}

function detectCondition5Sell(c15, i15, resistance) {
  if (c15.length < 3) return null;

  const prev2 = c15[c15.length - 3];
  const prev1 = c15[c15.length - 2];
  const curr = c15[c15.length - 1];
  const p0 = getLatestIndicatorPack(c15, i15, 0);
  const p1 = getLatestIndicatorPack(c15, i15, 1);
  const avgVol = recentAverageVolume(c15, 20, 1);

  const ok =
    prev1.volume >= avgVol * config.volumeMultiplier &&
    curr.volume < prev1.volume &&
    prev1.high > resistance &&
    curr.close < resistance &&
    crossedBelow(p1.macd?.signal ?? 999, p0.macd?.signal ?? 999, 0) &&
    (p0.adx?.adx ?? 0) >= config.adxMin &&
    (p0.rsi ?? 100) <= config.rsiSellMax;

  if (!ok) return null;

  const recentHigh = Math.max(prev2.high, prev1.high, curr.high);

  return {
    strategy: "Condition 5 - Fall Back Below Resistance",
    side: "SELL",
    entry: curr.close,
    sl: recentHigh * 1.003,
    tp: curr.close * 0.99,
    percentageIncrease: null,
    meta: {
      avgVol,
      adx: p0.adx?.adx ?? null,
      macd: p0.macd?.MACD ?? null,
      signal: p0.macd?.signal ?? null,
      rsi: p0.rsi ?? null,
    },
    candleTime: curr.closeTime,
  };
}

function detectCondition6Buy(c15, i15, support) {
  const curr = c15[c15.length - 1];
  if (!curr) return null;

  const p0 = getLatestIndicatorPack(c15, i15, 0);
  const p1 = getLatestIndicatorPack(c15, i15, 1);
  const avgVol = recentAverageVolume(c15, 20, 1);

  const ok =
    curr.volume >= avgVol * config.volumeMultiplier &&
    (p0.adx?.adx ?? 0) >= config.adxMin &&
    crossedAbove(p1.macd?.MACD ?? -999, p0.macd?.MACD ?? -999, 0) &&
    (p0.rsi ?? 0) >= config.rsiBuyMin &&
    curr.close > support;

  if (!ok) return null;

  const recentLow = Math.min(...c15.slice(-5).map((c) => c.low));

  return {
    strategy: "Condition 6 - MACD Cross Above Zero",
    side: "BUY",
    entry: curr.close,
    sl: recentLow * 0.99,
    tp: curr.close * 1.02,
    percentageIncrease: null,
    meta: {
      avgVol,
      adx: p0.adx?.adx ?? null,
      macd: p0.macd?.MACD ?? null,
      signal: p0.macd?.signal ?? null,
      rsi: p0.rsi ?? null,
    },
    candleTime: curr.closeTime,
  };
}

function detectCondition6Sell(c15, i15, resistance) {
  const curr = c15[c15.length - 1];
  if (!curr) return null;

  const p0 = getLatestIndicatorPack(c15, i15, 0);
  const p1 = getLatestIndicatorPack(c15, i15, 1);
  const avgVol = recentAverageVolume(c15, 20, 1);

  const ok =
    curr.volume >= avgVol * config.volumeMultiplier &&
    (p0.adx?.adx ?? 0) >= config.adxMin &&
    crossedBelow(p1.macd?.MACD ?? 999, p0.macd?.MACD ?? 999, 0) &&
    (p0.rsi ?? 100) <= config.rsiSellMax &&
    curr.close < resistance;

  if (!ok) return null;

  const recentHigh = Math.max(...c15.slice(-5).map((c) => c.high));

  return {
    strategy: "Condition 6 - MACD Cross Below Zero",
    side: "SELL",
    entry: curr.close,
    sl: recentHigh * 1.01,
    tp: curr.close * 0.98,
    percentageIncrease: null,
    meta: {
      avgVol,
      adx: p0.adx?.adx ?? null,
      macd: p0.macd?.MACD ?? null,
      signal: p0.macd?.signal ?? null,
      rsi: p0.rsi ?? null,
    },
    candleTime: curr.closeTime,
  };
}

function applyConfirmations(signal, c1m, i1m, c5m, i5m) {
  if (!signal) return null;

  if (config.use1mConfirmation && !confirmation1m(c1m, i1m, signal.side)) {
    return null;
  }

  if (config.use5mConfirmation && !confirmation5m(c5m, i5m, signal.side)) {
    return null;
  }

  return signal;
}

function detectSignals(symbol, c1m, c5m, c15) {
  if (!Array.isArray(c1m) || !Array.isArray(c5m) || !Array.isArray(c15)) {
    return [];
  }

  if (c1m.length < 50 || c5m.length < 50 || c15.length < 50) {
    return [];
  }

  const i1m = computeIndicators(c1m);
  const i5m = computeIndicators(c5m);
  const i15 = computeIndicators(c15);

  const { support, resistance } = findSupportResistance(
    c15.slice(0, -1),
    config.supResLookback
  );

  const rawSignals = [
    detectCondition1Buy(c15, i15, support),
    detectCondition1Sell(c15, i15, resistance),
    detectCondition2Buy(c15, i15, support),
    detectCondition2Sell(c15, i15, resistance),
    detectCondition3Buy(c15, i15, support),
    detectCondition3Sell(c15, i15, resistance),
    detectCondition4Buy(c15, i15, support),
    detectCondition4Sell(c15, i15, resistance),
    detectCondition5Buy(c15, i15, support),
    detectCondition5Sell(c15, i15, resistance),
    detectCondition6Buy(c15, i15, support),
    detectCondition6Sell(c15, i15, resistance),
  ].filter(Boolean);

  return rawSignals
    .map((s) => applyConfirmations(s, c1m, i1m, c5m, i5m))
    .filter(Boolean)
    .map((s) => ({ ...s, symbol, support, resistance }));
}

module.exports = {
  detectSignals,
};