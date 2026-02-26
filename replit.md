# WINM AI Trading Bot

## Overview
AI-powered cryptocurrency trading bot platform with Claude AI integration, live Binance price data, TradingView-style charts, quantum trading signals, order book, and portfolio tracking.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS v3, shadcn/ui, wouter, TanStack Query, recharts, lightweight-charts
- **Backend**: Express.js, PostgreSQL with Drizzle ORM
- **AI**: Claude AI (Anthropic) via Replit AI Integrations (claude-sonnet-4-6 for analysis)
- **Auth**: Simple localStorage-based auth with hardcoded credentials (no sessions)
- **Market Data**: Live Binance API (24h tickers, order book, klines)

## Project Structure
```
client/src/
  pages/
    login.tsx           - Login page (username/password)
    dashboard.tsx       - Main trading dashboard with charts, signals, AI insights
    markets.tsx         - Market overview and coin listings
    strategies.tsx      - Strategy CRUD management
    signals.tsx         - Trading signals history
    portfolio.tsx       - Portfolio positions, wallet, and manual deposit
    settings.tsx        - Bot settings, exchange API config, risk management, user access
  components/
    layout/Sidebar.tsx  - Navigation sidebar with WinM AI branding
    dashboard/
      TradingChart.tsx  - TradingView-style candlestick chart (lightweight-charts)
      MarketOverview.tsx - Live market watch with Binance prices
      SignalFeed.tsx    - Quantum signals feed with popup detail dialog
      TradeEntry.tsx    - Trade entry form
      OrderBook.tsx     - Live order book from Binance
  lib/
    binance.ts          - Binance API integration (tickers, orderbook, klines)
    strategies.ts       - Technical analysis (SMC, ICT, RSI, MACD, EMA, etc.)
    mockData.ts         - Fallback mock data
    queryClient.ts      - TanStack Query setup
server/
  index.ts             - Express server entry point
  routes.ts            - All API routes (auth, AI, settings, strategies, signals, positions, wallet, user-access)
  storage.ts           - Database storage interface (IStorage + DatabaseStorage)
  db.ts                - Drizzle/PostgreSQL connection
  ai-analysis.ts       - Claude AI market insight and signal analysis
  ai-service.ts        - Claude AI signal generation, validation, strategy review, chat
shared/
  schema.ts            - Drizzle schema (users, settings, strategies, signals, positions, wallet, userAccess)
  models/chat.ts       - Conversations and messages schema
```

## AI Features (Claude Integration)
- **Market Insights**: AI analyzes live market data for all major coins with sentiment, key levels, upcoming trades
- **Signal Analysis**: AI evaluates trading signals with verdict, confidence adjustment, risk assessment
- **Signal Generation**: Claude generates trading signals with entry/target/stop-loss
- **Strategy Review**: Claude evaluates strategy configurations
- **AI Chat**: Interactive conversation about market analysis
- Environment vars: AI_INTEGRATIONS_ANTHROPIC_API_KEY, AI_INTEGRATIONS_ANTHROPIC_BASE_URL

## Key Features
- **Signal Detail Popup**: Clicking a quantum signal opens a popup dialog with full details (RSI, MACD, EMA, Volume, RSI Divergence, Market Structure, Trend Strength, Risk/Reward) plus Execute Trade and Share buttons. Close via X button.
- **Manual Wallet Deposit**: Portfolio page has a Deposit button that opens a dialog with amount input, preset buttons ($100/$500/$1000/$5000), and confirm/cancel. Calls POST /api/wallet/deposit.
- **User Access Management**: Settings page has "User Access" tab for managing platform users with email, role (Admin/Trader/Viewer), granular permissions, and active/disabled toggle. Full CRUD via /api/user-access endpoints.

## Login Credentials
- Username: patyqm2010@gmail.com
- Password: Ori@4422

## Database Tables
PostgreSQL: users, settings, strategies, signals, positions, wallet, user_access, conversations, messages

## API Endpoints
- POST /api/auth/login
- POST /api/ai/analyze-signal, POST /api/ai/market-insight
- GET/PATCH /api/settings
- GET/POST/PATCH/DELETE /api/strategies
- GET/POST/DELETE /api/signals, PATCH /api/signals/:id/status
- GET/POST /api/positions, PATCH /api/positions/:id/close
- GET /api/wallet, POST /api/wallet/deposit
- GET/POST /api/user-access, PATCH/DELETE /api/user-access/:id

## Theme
Dark trading terminal theme with neon cyan/blue primary, purple accents, slate backgrounds. Uses Rajdhani display font and Inter sans font.
