# Project Constraints — OriAiTradingBot v2

## Architecture

- **Deterministic core first.** `technical-analysis-agent.ts` and `risk-management-agent.ts` compute every indicator value in plain TypeScript. The LLM layer (`agent-orchestrator.ts` → `callAIVeto`) only reasons over already-computed values and returns `confirm | veto | flag` — it never recomputes or overrides a technical indicator value.

- **AI as veto, not scorer.** The `runOrchestrator` composite score IS the Phase 2 TA score. The AI veto can block or flag a signal but cannot increase confidence.

- **Phase 0 before Phase 1.** Any new strategy logic must be validated via `validation/backtest_validator.py` before being wired into the live bot. The gate: bootstrap CI lower bound > 0 on 2 of 3 pairs after costs.

- **Learning is bounded and evidence-gated.** `agents/learning-core.ts` calibrates confidence against realized outcomes (isotonic regression + Bayesian shrinkage). It may cut confidence freely but never adds more than `MAX_UPWARD_ADJUST` points, and is a no-op below `MIN_SAMPLES` closed trades. It runs on pure math — no AI calls.

## AI Cost Discipline

Every AI call goes through `ai-budget.ts`. Nothing calls a provider directly.

| Control | Behaviour |
|---------|-----------|
| Daily cap | `$0.05` per provider by default (`AI_DAILY_BUDGET_USD`, or `POST /api/ai/budget`) |
| Per-call cap | no single call may reserve more than 20% of the day (`AI_MAX_CALL_USD`) |
| Economy routing | `AI_ECONOMY_MODE=always` (default) sends every call to the cheapest capable model per provider; `auto` only downgrades when the budget binds; `off` disables it |
| Tier: `critical` | AI veto on a tradeable signal — allowed up to 100% of budget |
| Tier: `normal` | signal analysis, on-demand deep analysis — cut off at 75% |
| Tier: `cosmetic` | narratives, moods, prose — cut off at 35% |
| Cache | content-hashed, TTL per tier; a repeat prompt costs $0 |
| Single-flight | concurrent identical prompts collapse to one request |
| Ledger | real provider token usage, priced and persisted per UTC day |
| Visibility | `GET /api/ai/budget` and the AI Credit Usage panel on the Agents page |

Rules when adding an AI call:
- Declare a `tier`. Untagged calls default to `normal`.
- If the value is display-only prose, it is `cosmetic` — or better, derive it deterministically.
- Never send the model values it cannot change. Restating a scoring rubric on every call is pure token cost.
- Set `maxTokens` to what the response actually needs. Admission is priced at `maxTokens`, so a generous ceiling reserves budget whether or not it is used — a call larger than the per-call cap can never be admitted, on any day, at any hour.
- Omit fields that were never computed rather than sending `undefined`. They cost input tokens and invite the model to hedge about data it does not have.
- Never let a failed AI call become a user-visible error. Fall back to the deterministic path, mark the result `degraded` with a reason, and return it. Losing the AI layer must never block a signal, silently penalise its confidence, or fail a request.

## Hard-coded Risk Rules (not config-overridable below the floor)

| Rule | Value |
|------|-------|
| Risk per trade | 0.5–1.0% (default 0.75%) |
| Daily loss limit | -3% |
| Weekly loss limit | -6% |
| Max consecutive losses before pause | 4 |
| Volatility circuit breaker (EXTREME) | no new trades |
| Volatility circuit breaker (ELEVATED) | 50% position size |
| No martingale | enforced — never average into losers |
| Stop-loss direction | never moved away from price |

## Exchange Safety

- Testnet/sandbox is the default on every exchange client.
- Live trading requires **both** `live=True` in the call **and** `LIVE_TRADING_CONFIRMED=true` in environment variables — never just one.

## Code Quality

- Every module ships with tests covering boundary conditions before it is considered done.
- Never log API keys. Read all credentials from environment variables only.
- Deploy as single-file patches; verify before/after line counts so a partial deploy is caught immediately.
- One module per Claude Code session — keeps diffs reviewable.
- Commit after each module passes its tests, not at end of phase.

## Calibration

- Every closed trade logs a `CALIBRATION_RECORD` event with `predictedConfidence`, `grade`, `outcome`, and `pnlR`.
- Query `/api/agents/calibration` to check the calibration curve. If any bucket's divergence exceeds 15 percentage points, investigate and adjust weights before adding capital.

## Repo Structure

```
server/
  agents/
    agent-orchestrator.ts    ← orchestration + AI veto
    technical-analysis-agent.ts  ← deterministic TA (Phase 2)
    risk-management-agent.ts     ← risk + regime detection
    market-intelligence-agent.ts ← macro context
    trade-journal-agent.ts       ← stats + calibration
    learning-core.ts             ← pure calibration math (no I/O, unit-tested)
    learning-engine.ts           ← loads trades, caches, schedules the refresh
    market-scanner.ts
  ai-budget.ts               ← daily spend cap, cache, single-flight, ledger
  ai-budget-persistence.ts   ← ledger survives restarts
  ai-providers.ts            ← the ONLY place that talks to an AI provider
  accuracy.ts                ← realized accuracy report (/api/agents/accuracy)
  bot-engine.ts              ← execution, sizing, state
  routes.ts                  ← REST API
validation/
  backtest_validator.py      ← Phase 0 edge validation (run before changing strategy)
tests/                       ← node:test suites, `npm test`
client/
  src/
    lib/live-price-store.tsx ← single WebSocket price feed for the whole app
    pages/
    components/
CLAUDE.md                    ← this file
```

## Live Data

Prices come from one shared Binance WebSocket (`lib/live-price-store.tsx`), batched to one React commit per frame. Panels must read from `useLivePrices()` — do not add per-component poll loops. REST is the cold-start seed and the fallback only. Staleness is always shown via `LiveFeedBadge`, never hidden.
