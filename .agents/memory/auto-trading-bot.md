---
name: Auto-trading bot safety
description: Safety invariants for the Phase-1 auto-trading bot engine and its endpoints.
---

# Auto-trading bot safety invariants

The bot (`server/bot-engine.ts` + `/api/bot/*`) is a paper-trading engine. These invariants are deliberate — preserve them.

- **Paper-only execution.** Only `mode === 'paper'` opens a trade. `testnet`/`live` must return a logged NOT_WIRED rejection (no real and no silent fake orders). Real exchange routing is a later phase.
  **Why:** user explicitly required no live/fake order routing until exchange wiring ships.

- **Engine isolation.** The bot engine must NOT import or call the legacy exchange path (`server/exchanges.ts` `autoTradeSignal`, the unauthenticated `POST /api/exchange/:exchange/trade`). All order flow goes through the single `dispatchOrder()` in bot-engine.
  **How to apply:** if adding live execution, wire it inside `dispatchOrder` behind the unlock gates, not via the legacy route.

- **Gating/accounting fields are not editable via `PATCH /api/bot/settings`.** That route strips `mode`, `status`, `lockReason`, `liveUnlocked`, `riskDisclaimerAccepted`, `paperBalance`, `paperStartingBalance`. Mode/unlock/control changes go through `/api/bot/mode`, `/unlock-live`, `/control` so the 20-paper-trade + disclaimer gates and P&L accounting can't be bypassed by a raw settings write.
  **Why:** architect flagged a real-money bypass once live is wired, plus P&L corruption if paperBalance were directly settable.

- **No background auto-execution loop.** `autoExecute` is a stored flag nothing reads yet; `executeSignal` only runs from `POST /api/bot/execute`. Before enabling auto-execution or live, add server-side auth to `/api/bot/*` (currently unauthenticated like the rest of the app).
