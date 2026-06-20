# Project Constraints — OriAiTradingBot v2

## Architecture

- **Deterministic core first.** `technical-analysis-agent.ts` and `risk-management-agent.ts` compute every indicator value in plain TypeScript. The LLM layer (`agent-orchestrator.ts` → `callAIVeto`) only reasons over already-computed values and returns `confirm | veto | flag` — it never recomputes or overrides a technical indicator value.

- **AI as veto, not scorer.** The `runOrchestrator` composite score IS the Phase 2 TA score. The AI veto can block or flag a signal but cannot increase confidence.

- **Phase 0 before Phase 1.** Any new strategy logic must be validated via `validation/backtest_validator.py` before being wired into the live bot. The gate: bootstrap CI lower bound > 0 on 2 of 3 pairs after costs.

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
    market-scanner.ts
  bot-engine.ts              ← execution, sizing, state
  routes.ts                  ← REST API
validation/
  backtest_validator.py      ← Phase 0 edge validation (run before changing strategy)
client/
  src/
    pages/
    components/
CLAUDE.md                    ← this file
```
