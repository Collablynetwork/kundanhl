# Hyperliquid Telegram Signal Bot

Production-style split version.

## Files
- index.js
- config.js
- indicators.js
- strategies.js
- telegram.js
- state.js
- package.json
- .env.example

## Setup
1. Copy `.env.example` to `.env`
2. Fill bot token and chat ID
3. Run:
   - `npm install`
   - `node index.js`

## Features
- 6 strategy conditions
- 1m / 5m confirmations
- no duplicate live trade per pair
- TP/SL reply tagging on original message
- /stats /live /pairs /menu /help
- persistent local state in JSON
