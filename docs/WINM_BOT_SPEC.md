# WINM Bot — Feature & Agent Spec (portable)

> Portable reference architecture for the WINM trading bot. This document is a
> design spec, not a live module. It describes a Python-oriented sibling of the
> TypeScript agents already in this repo (`server/agents/*`). Where the two
> line up, cross-references to the current implementation are called out so the
> spec can be used as a porting guide.

## Core architecture principle (read this first — it's the whole design philosophy)

**Deterministic core, LLM as a read-only veto.**

- All math (indicators, prices, stops, sizing, drawdown) is computed in plain
  Python. The LLM **never** calculates, overrides, or edits any price,
  stop-loss, or size. It only returns `confirm` / `veto` / `flag` after
  reasoning over already-computed values.
- Everything routes through one transactional gate (`DecisionGate`) — a single
  choke point that must pass **9 sequential gates** before any order fires.
- **Sandbox by default.** Live trading needs **both** `live=True` **and** env
  var `LIVE_TRADING_CONFIRMED=true`.

> Maps to this repo: the deterministic-core / AI-as-veto rule is already
> enforced in `CLAUDE.md` and `server/agents/agent-orchestrator.ts`
> (`callAIVeto` returns `confirm | veto | flag` and cannot raise confidence).

## The Agents (what each does + how it works)

### 1. DataAgent — market data ingestion & failover
- Unified market feed across 7 exchanges (Binance, Bybit, MEXC, OKX, KuCoin,
  Gate.io, Bitget) via CCXT.
- Multi-source price fusion: fetches ticker from Binance/Bybit/OKX in parallel
  (ThreadPool), returns the **median** price (outlier-resistant) plus per-source
  latency logs.
- WebSocket streaming cache (background daemon thread) for sub-second prices;
  falls back to high-frequency REST polling emulation if WS unavailable.
- Cascading failover: if the active exchange fails, auto-rotates to the next; if
  all fail, serves deterministic stochastic mock candles so the pipeline never
  hard-crashes.
- Unified schemas for ticker, OHLCV, orderbook, funding rate. Health-check ping
  + auto-failover.

### 2. StructureAgent — deterministic SMC/ICT setup detection (the "brain")
Pure Python, no look-ahead bias (backward-looking only). Detects:
- **Liquidity Sweeps** — sweep of Equal Highs/Lows then reclaim (Phase 0
  strategy).
- **Fair Value Gaps (FVG)** — 3-candle imbalance + tracks mitigation state.
- **Market Structure Shift (MSS)/CHoCH** — 5-candle fractal swing break with
  displacement.
- **4H EMA50 trend bias** filter.
- Produces a unified setup with a `confluence_score`
  (`0.4·sweep + 0.3·FVG + 0.3·MSS`), direction, entry price, and stop-loss.

> Maps to this repo: `server/agents/technical-analysis-agent.ts`.

### 3. RiskAgent — deterministic capital management
- Fixed-fractional sizing, hard-locked to **0.5%–1.0%** risk/trade (constructor
  raises if outside range).
- Drawdown circuit breakers: daily **-3.0%**, weekly **-6.0%** → forces
  `TRADING_PAUSED`.
- Consecutive-loss kill switch (default **4** losses in a row).
- Correlation exposure cap — blocks new trades if correlated risk (corr ≥ 0.7)
  exceeds **2%** aggregate.
- No martingale, no averaging into losers, stops never move once active.

> Maps to this repo: `server/agents/risk-management-agent.ts` and the
> hard-coded risk table in `CLAUDE.md`.

### 4. SentimentAgent — context provider (read-only)
- Supplies news headlines and a macro calendar (FOMC, CPI, NFP with time
  offsets).
- Takes the signal as read-only context; never touches numbers. Purely feeds the
  LLM layer.

> Maps to this repo: `server/agents/market-intelligence-agent.ts`.

### 5. LearningAgent — calibration & regime adaptation
- Calibration curve: buckets trades by grade (C/B/B+/A/A+), compares expected vs
  realized win-rate, flags recalibration if the gap > **15pp**.
- Adverse-selection / toxicity detection: measures post-fill price drift
  (>0.35% = toxic).
- Volatility regime detection: `NORMAL` / `ELEVATED` (0.5× size) / `EXTREME`
  (0.25× size) based on realized-vol ratio.
- Persists trade log to local JSON state.

> Maps to this repo: `server/agents/trade-journal-agent.ts` (calibration) and
> the volatility circuit breaker in `risk-management-agent.ts`.

### 6. SignalOrchestrator — LLM gatekeeper (Gemini)
- Wraps the LLM (Gemini) with a strict Pydantic schema (`verdict`, `reasoning`,
  `macro_lockout`, `lockout_window_minutes`).
- Prompt explicitly tells the model it **cannot** change entry/stop — only
  confirm/veto/flag.
- Fails safe: any API error/timeout → defaults to `flag` + macro lockout.
- Audit logs every verdict (prompt + raw response + parsed) to disk with a
  correlation ID.

> Maps to this repo: `callAIVeto` in `server/agents/agent-orchestrator.ts`.

### 7. TradeExecutor — order router
- Sandbox/testnet by default; live requires the double confirmation.
- Idempotent client order IDs, slippage guard (rejects if estimated impact
  > 0.15%).
- Limit order first → 30s poll → market fallback if unfilled. Falls back to
  simulated fill if offline.

> Maps to this repo: `server/bot-engine.ts` (execution, sizing, state).

## The Decision Gate — the 9-gate pipeline (the heart of the system)

Every signal must pass all 9 **in order**; any failure aborts and is persisted
to DB with a reason.

| # | Gate | Type | Check |
|---|------|------|-------|
| 1 | Daily Drawdown | Risk | daily PnL > -3.0% (queries DB for real realized PnL; sets global HALT if breached) |
| 2 | Weekly Drawdown | Risk | weekly PnL > -6.0% |
| 3 | Consecutive Losses | Risk | < 4 losses in a row |
| 4 | Position Sizing | Risk | valid stop distance; size computed at 0.5–1.0% |
| 5 | Correlation Exposure | Risk | correlated risk ≤ 2.0% |
| 6 | Trend Alignment | Structure | signal direction matches 4H EMA bias |
| 7 | Liquidity Sweep | Structure | EQH/EQL sweep verified |
| 8 | Imbalance / Shift | Structure | ≥1 unmitigated FVG or MSS present |
| 9 | Macro Veto | LLM | orchestrator returns `confirm` (not veto/flag) |

### Cross-cutting patterns worth copying
- **Correlation ID** threaded through every agent call for end-to-end tracing.
- **Fail-safe defaults everywhere** — data falls back to mocks, LLM falls back
  to `flag`, executor falls back to sandbox.
- **Global HALT circuit-breaker** — once daily drawdown is breached, the whole
  system locks until reset.
- **Everything persisted** — signals (approved + rejected) and trades go to a DB
  with full gate-status JSON.

## Efficiency improvements (for a faster/leaner port)

Highest-leverage improvements if the goal is a faster version:

1. **Short-circuit ordering** — the gate already checks cheap risk gates before
   expensive ones. Keep the LLM call (gate 9) dead last so most rejections never
   spend a token. ✅ already optimal here.
2. **Cache the SMC scan** — `DecisionGate` recomputes `scan_smc_setup` even when
   the orchestrator already ran it. Pass the computed setup through instead of
   recomputing.
3. **Batch the LLM** — instead of one Gemini call per signal, batch multiple
   candidate signals into one structured call.
4. **Async the DataAgent fully** — it mixes threads + asyncio; a single asyncio
   event loop for WS + REST would cut latency and thread overhead.
5. **Vectorize StructureAgent** — the FVG/MSS loops are O(n²) on mitigation
   checks; NumPy/pandas rolling windows make it near-instant.
6. **Make the LLM layer optional/tiered** — use it only for borderline
   `confluence_score` cases, not every approved signal.
