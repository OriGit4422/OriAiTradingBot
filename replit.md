# CryptoBot AI - Trading Platform

## Overview
AI-powered cryptocurrency trading bot platform with Claude AI integration for signal validation and market analysis, real-time signals, advanced strategies, risk management, and multi-user admin panel.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS, shadcn/ui, framer-motion, wouter, TanStack Query
- **Backend**: Express.js, express-session, PostgreSQL with Drizzle ORM
- **AI**: Claude AI (Anthropic) via Replit AI Integrations (claude-sonnet-4-6 for analysis, claude-haiku-4-5 for validation)
- **Auth**: Email/password with session-based authentication, password reset tokens

## Project Structure
```
client/src/
  pages/
    auth-page.tsx       - Login, register, password reset
    dashboard.tsx       - Main dashboard with stats and overview
    strategies-page.tsx - Strategy CRUD with AI review
    signals-page.tsx    - AI trading signals with Claude-powered generation & validation
    ai-chat-page.tsx    - Interactive AI chat assistant for market analysis
    settings-page.tsx   - Bot configuration and risk management
    admin-page.tsx      - User management, roles, permissions
  components/
    app-sidebar.tsx     - Navigation sidebar
    theme-provider.tsx  - Dark/light mode
  lib/
    auth.tsx            - Authentication context provider
    queryClient.ts      - TanStack Query setup
server/
  index.ts             - Express server entry point
  routes.ts            - All API routes
  storage.ts           - Database storage interface
  db.ts                - Drizzle/PostgreSQL connection
  seed.ts              - Database seeding
  ai-service.ts        - Claude AI integration service (signal gen, validation, strategy review, chat)
shared/
  schema.ts            - Drizzle schema, Zod validators, types
```

## AI Features (Claude Integration)
- **AI Signal Generation**: Claude analyzes market conditions and generates trading signals with entry/target/stop-loss
- **AI Signal Validation**: Secondary AI validation of every signal for risk assessment
- **AI Strategy Review**: Claude evaluates strategy configurations and provides score + recommendations
- **AI Chat Assistant**: Interactive conversation with Claude about market analysis, trading strategies, risk management
- Environment vars: AI_INTEGRATIONS_ANTHROPIC_API_KEY, AI_INTEGRATIONS_ANTHROPIC_BASE_URL (auto-set by Replit)

## Features
- Email-based auth with login, register, password reset
- Dashboard with portfolio stats, P&L, win rate
- Strategy management with Claude AI review (score + feedback)
- AI signal generation with confidence scores, risk assessment, market context, and dual-validation
- Bot settings: exchange config, risk management, automation, notifications
- Admin panel: user management, role assignment (admin/user/viewer), activate/deactivate users
- AI Chat page with conversation history
- Dark/light theme toggle
- Responsive design for web and mobile

## Demo Accounts
- Admin: admin@cryptobot.com / admin123
- Trader: trader@cryptobot.com / trader123
- Demo: demo@cryptobot.com / demo123

## Database
PostgreSQL with tables: users, strategies, signals, bot_settings, trade_history, conversations, messages, session

## Schema AI Fields
- signals: aiValidation, aiRiskScore, riskReward, marketContext (in addition to aiAnalysis)
- strategies: aiScore, aiReview
