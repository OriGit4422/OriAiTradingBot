# CryptoBot AI - Trading Platform

## Overview
AI-powered cryptocurrency trading bot platform with real-time signals, advanced strategies, risk management, and multi-user admin panel.

## Tech Stack
- **Frontend**: React + TypeScript, Vite, TailwindCSS, shadcn/ui, framer-motion, wouter, TanStack Query
- **Backend**: Express.js, express-session, PostgreSQL with Drizzle ORM
- **Auth**: Email/password with session-based authentication, password reset tokens

## Project Structure
```
client/src/
  pages/
    auth-page.tsx       - Login, register, password reset
    dashboard.tsx       - Main dashboard with stats and overview
    strategies-page.tsx - Strategy CRUD with all options
    signals-page.tsx    - AI trading signals with generation
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
shared/
  schema.ts            - Drizzle schema, Zod validators, types
```

## Features
- Email-based auth with login, register, password reset
- Dashboard with portfolio stats, P&L, win rate
- Strategy management (create, edit, delete, toggle active)
- AI signal generation with confidence scores and analysis
- Bot settings: exchange config, risk management, automation, notifications
- Admin panel: user management, role assignment (admin/user/viewer), activate/deactivate users
- Dark/light theme toggle
- Responsive design for web and mobile

## Demo Accounts
- Admin: admin@cryptobot.com / admin123
- Trader: trader@cryptobot.com / trader123
- Demo: demo@cryptobot.com / demo123

## Database
PostgreSQL with tables: users, strategies, signals, bot_settings, trade_history, session
