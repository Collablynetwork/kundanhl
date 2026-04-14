const fs = require("fs");
const path = require("path");
const config = require("./config");

const statePath = path.resolve(config.stateFile);

function defaultState() {
  return {
    stats: {
      totalSignals: 0,
      wins: 0,
      losses: 0,
      pnlPct: 0,
      byPair: {},
      byStrategy: {},
    },
    liveTrades: {},
    dryRunTrades: {},
    sentSignals: [],
  };
}

function loadState() {
  try {
    if (!fs.existsSync(statePath)) return defaultState();
    const raw = fs.readFileSync(statePath, "utf8");
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

const state = loadState();

function saveState() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function ensurePairStats(pair) {
  if (!state.stats.byPair[pair]) {
    state.stats.byPair[pair] = {
      signals: 0,
      wins: 0,
      losses: 0,
      pnlPct: 0,
    };
  }
}

function ensureStrategyStats(strategy) {
  if (!state.stats.byStrategy[strategy]) {
    state.stats.byStrategy[strategy] = {
      signals: 0,
      wins: 0,
      losses: 0,
      pnlPct: 0,
    };
  }
}

function rememberSent(key) {
  if (!state.sentSignals.includes(key)) {
    state.sentSignals.push(key);
    if (state.sentSignals.length > 5000) {
      state.sentSignals = state.sentSignals.slice(-3000);
    }
  }
}

function wasSent(key) {
  return state.sentSignals.includes(key);
}

module.exports = {
  state,
  saveState,
  ensurePairStats,
  ensureStrategyStats,
  rememberSent,
  wasSent,
};