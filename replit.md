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
    portfolio.tsx       - Portfolio positions and wallet
    settings.tsx        - Bot settings, exchange API config, risk management
  components/
    layout/Sidebar.tsx  - Navigation sidebar with WinM AI branding
    dashboard/
      TradingChart.tsx  - TradingView-style candlestick chart (lightweight-charts)
      MarketOverview.tsx - Live market watch with Binance prices
      SignalFeed.tsx    - Quantum signals feed
      TradeEntry.tsx    - Trade entry form
      OrderBook.tsx     - Live order book from Binance
  lib/
    binance.ts          - Binance API integration (tickers, orderbook, klines)
    strategies.ts       - Technical analysis (SMC, ICT, RSI, MACD, EMA, etc.)
    mockData.ts         - Fallback mock data
    queryClient.ts      - TanStack Query setup
server/
  index.ts             - Express server entry point
  routes.ts            - All API routes (auth, AI, settings, strategies, signals, positions, wallet)
  storage.ts           - Database storage interface (IStorage + DatabaseStorage)
  db.ts                - Drizzle/PostgreSQL connection
  ai-analysis.ts       - Claude AI market insight and signal analysis
  ai-service.ts        - Claude AI signal generation, validation, strategy review, chat
shared/
  schema.ts            - Drizzle schema (users, settings, strategies, signals, positions, wallet)
  models/chat.ts       - Conversations and messages schema
```

## AI Features (Claude Integration)
- **Market Insights**: AI analyzes live market data for all major coins with sentiment, key levels, upcoming trades
- **Signal Analysis**: AI evaluates trading signals with verdict, confidence adjustment, risk assessment
- **Signal Generation**: Claude generates trading signals with entry/target/stop-loss
- **Strategy Review**: Claude evaluates strategy configurations
- **AI Chat**: Interactive conversation about market analysis
- Environment vars: AI_INTEGRATIONS_ANTHROPIC_API_KEY, AI_INTEGRATIONS_ANTHROPIC_BASE_URL

## Login Credentials
- Username: patyqm2010@gmail.com
- Password: Ori@4422

## Database Tables
PostgreSQL: users, settings, strategies, signals, positions, wallet, conversations, messages

## Theme
Dark trading terminal theme with neon cyan/blue primary, purple accents, slate backgrounds. Uses Rajdhani display font and Inter sans font.
