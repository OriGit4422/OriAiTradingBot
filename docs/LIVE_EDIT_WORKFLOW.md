# Live Edit Workflow (OriAiTradingBot)

If you want to change the project live with me, use this workflow.

## 1) Start the app

```bash
npm install
npm run dev
```

- Dev server starts from `server/index.ts` and serves both API + client.
- Default port is `5000` unless `PORT` is set.

## 2) Where to edit (quick map)

### Main pages
- Dashboard: `client/src/pages/dashboard.tsx`
- Markets: `client/src/pages/markets.tsx`
- Strategies: `client/src/pages/strategies.tsx`
- Signals: `client/src/pages/signals.tsx`
- Portfolio: `client/src/pages/portfolio.tsx`
- Settings: `client/src/pages/settings.tsx`

### Shared UI components
- Sidebar/nav: `client/src/components/layout/Sidebar.tsx`
- Dashboard widgets: `client/src/components/dashboard/*`
- Reusable UI primitives: `client/src/components/ui/*`

### Data + logic
- Binance feeds/helpers: `client/src/lib/binance.ts`
- Technical analysis engine: `client/src/lib/strategies.ts`
- API client/query behavior: `client/src/lib/queryClient.ts`

### Backend/API
- Route definitions: `server/routes.ts`
- Persistence layer: `server/storage.ts`
- AI market/signal analysis: `server/ai-analysis.ts`
- AI signal/chat/validation service: `server/ai-service.ts`
- Database schema/types: `shared/schema.ts`

## 3) Live collaboration loop

1. You tell me exactly what to change (UI text/layout, API behavior, data model, etc.).
2. I patch the file(s) and explain what changed.
3. You refresh the browser (or rely on HMR) and verify visually.
4. We iterate until done.

## 4) Examples of requests you can give me

- “Move wallet card above open positions in Portfolio.”
- “Add a filter for signal confidence > 80% in Signals page.”
- “Add validation to `/api/wallet/deposit` to reject negative amounts.”
- “Change dashboard accent colors to teal + purple only.”
- “Add a new tab in Settings for API usage logs.”

## 5) Recommended first live changes

- Add strict zod validation on wallet and position close endpoints.
- Replace static Markets page KPI cards with live values.
- Split large TA logic in `client/src/lib/strategies.ts` into smaller modules.

