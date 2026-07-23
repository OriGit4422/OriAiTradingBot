# Agent & Feature Reference

A copy-paste-ready catalogue of every agent and feature from the reference
architecture (12 deterministic agents + sub-scorers + 1 LLM coordinator),
with the function name in both reference implementations (Python / TypeScript)
so they can be ported directly.

Each row also carries a **Status in this repo** column mapping the reference
design onto the current `OriAiTradingBot v2` codebase, which today uses a
single 22-factor weighted Phase 2 composite (`runPhase2Confluence`) plus an
AI veto (`callAIVeto`) rather than the discrete 16-agent layout below.

Status legend:
- ✅ **present** — equivalent logic already exists (function noted).
- 🟡 **partial** — some of the behaviour exists, but not as a discrete agent / not fully.
- ⛔ **missing** — no equivalent in the current codebase.

> Alignment with `CLAUDE.md`: the deterministic core computes every indicator
> value; the LLM layer (`callAIVeto`) only reasons over already-computed values
> and returns `confirm | veto | flag`. Any port of the sub-scorers below must
> keep that boundary — the AI veto can block or flag but never increase
> confidence. New strategy logic must pass `validation/backtest_validator.py`
> (Phase 0) before being wired live.

## Agents (12 deterministic + aggregators + 1 LLM)

| # | Agent | Role | Function (Py / TS) | In → Out | Status in this repo |
|---|-------|------|--------------------|----------|---------------------|
| 1 | Structure | Direction/trend from weighted EMA + RSI + range + momentum + HTF vote | `agent_structure` / `agentStructure` | Features, htf → `{direction, score, confidence, reasons}` | 🟡 partial — `detectDirection` (`market-scanner.ts:199`) + `scoreEMAAlignment`/`scoreRSI` (`technical-analysis-agent.ts`) |
| 2 | Exchange / Validation | Liquidity + spread + data-reliability score | `agent_exchange` / `agentExchange` | ticker → `{score, spreadPct, summary}` | ⛔ missing — no discrete spread/data-reliability agent |
| 3 | Multi-Timeframe | Does the higher timeframe agree? (biggest weight) | `sub_multi_tf` / `subMultiTf` | confluence, htf → score + note | ✅ present — `scoreMultiTimeframe` (`technical-analysis-agent.ts:413`, weight 7) |
| 4 | Order-Book | Depth imbalance aligned with the trade | `sub_order_book` / `subOrderBook` | confluence, imbalance → score + note | ⛔ missing — no order-book imbalance fetch/scorer |
| 5 | Liquidity | Volume + spread depth | `sub_liquidity` (via exchange) | exchange → score + note | 🟡 partial — `scoreLiquiditySweep` (`technical-analysis-agent.ts:356`) + `scoreVolumeConfirmation` |
| 6 | Volatility | ATR/price regime (mid = best) | `sub_volatility` / `subVolatility` | Features → score + note | ✅ present — `scoreATRVolatility` (`technical-analysis-agent.ts:269`) + `detectRegime` (`risk-management-agent.ts:159`) |
| 7 | Market-Regime | EMA stack + HTF = trending vs choppy | `sub_regime` / `subRegime` | Features, htf → score + note | 🟡 partial — `getMarketRegime` (`market-intelligence-agent.ts:207`) is macro-based; EMA-stack regime via `scoreEMAAlignment`/`scoreADX` |
| 8 | Setup-Conflict | How decisive the confluence is | `sub_conflict` / `subConflict` | confluence → score + note | ⛔ missing — decisiveness not scored as a discrete factor |
| 9 | Execution / Timing | Distance from ideal entry (do-not-chase) | `sub_execution` / `subExecution` | Features, confluence → score + note + chase | 🟡 partial — `scoreSessionTiming` (`technical-analysis-agent.ts:327`); no do-not-chase distance gate |
| 10 | News-Risk | Abnormal-volume / event-risk proxy | `sub_news_risk` / `subNewsRisk` | Features → score + note | 🟡 partial — `market-intelligence-agent.ts` fear/greed + macro; no abnormal-volume proxy |
| 11 | Derivatives | Liquidation / crowded-extreme risk | `sub_derivatives` / `subDerivatives` | Features → score + note | 🟡 partial — Coinglass data in orchestrator (`fallbackCG`, `agent-orchestrator.ts:421`) |
| 12 | Strategy-Classifier | Labels the setup (17 types) + edge | `agent_strategy` / `agentStrategy` | Features, confluence, htf → `{type, label}` | ⛔ missing — no setup-type classifier |
| 13 | Historical-Edge | Measured (backtested) or proxy expectancy | `sub_edge` / `subEdge` | confluence, R:R, measured → score + note + proven | 🟡 partial — `computeHistoricalStats` (`risk-management-agent.ts:87`) + edge weights |
| 14 | Risk / Scoring (aggregator) | Combines the 15 sub-scores with weights → grade + block rules | `agent_risk` / `agentRisk` | all above → Scoring | 🟡 partial — `runPhase2Confluence` (`technical-analysis-agent.ts:693`) aggregates 22 factors; different weight set |
| 15 | Portfolio-Risk | Veto / resize + correlation trim across the book | `agent_portfolio_risk` / `agentPortfolioRisk` | signals[] → reviews + notes | 🟡 partial — `detectCorrelationRisk` (`risk-management-agent.ts:58`) + `assessTradeRisk` |
| 16 | Coordinator (LLM) | Reviews everything, writes brief, sets regime/sentiment (token cost only, has fallback) | `agent_coordinator` / `agentCoordinator` | top signals, news, risk → `{brief, regime, sentimentScore}` | 🟡 partial — `callAIVeto` (`agent-orchestrator.ts:99`) is veto-only; `sentimentScore` (`agent-orchestrator.ts:365`); no market brief writer |

### Scoring weights (in `agent_risk`)

| Sub-score | Weight |
|-----------|-------:|
| Multi-Timeframe | 3.0 |
| Setup-Conflict | 2.5 |
| Data-Quality | 2.5 |
| Market-Regime | 2.0 |
| Historical-Edge | 2.0 |
| Execution | 2.0 |
| Liquidity | 1.5 |
| Order-Book | 1.5 |
| Volatility | 1.5 |
| Derivatives | 1.5 |
| News-Risk | 1.5 |

> Note: these are the reference `agent_risk` weights. The current repo does not
> use them — `runPhase2Confluence` weights 22 named confluence factors
> (e.g. SMC Structure 8, EMA Alignment 7, Multi-Timeframe 7, Breaker Block 8,
> RSI 6, MACD 6 …) into one composite. Reconcile before porting.

## Features (importable capabilities)

| Feature | Function (Py / TS) | What it gives you | Status in this repo |
|---------|--------------------|-------------------|---------------------|
| Live data fetch | `fetch_klines` / `fetchKlines`, `fetch_order_book_imbalance`, `fetch_ticker_stats` | Guarded HTTP with host fallback — swap these to change data source | 🟡 partial — `fetchBinanceKlines` (`market-scanner.ts:120`), `fetchPrice`; no order-book imbalance fetch |
| Indicators | `ema`, `rsi`, `atr`, `derive_features` | EMA20/50/200, RSI14, ATR, range position, momentum, volume ratio | ✅ present — `calcEMA`, `calcRSI`, `calcATR`, `calcMACD`, `calcADX` (`technical-analysis-agent.ts`) |
| Single source of truth | `compute_signal` / `compute_signal_core` | One function the UI, API, and cron all call — no drift | 🟡 partial — `runOrchestrator` (`agent-orchestrator.ts:187`) is the composite entry point |
| Trade plans | `build_plan` / `buildPlan` | Entry zone, stop-loss, TP1/TP2/TP3, weighted R:R | 🟡 partial — `computeLevels` (`market-scanner.ts:156`) builds entry/SL/TP |
| Transparent scoring | `compute_scoring` (in `agent_risk`) | 15 weighted sub-scores → confidence + grade (A+/A/B/C) + MAIN/OPTIONAL/NO_TRADE | 🟡 partial — `runPhase2Confluence` → composite + `deriveGrade` (`agent-orchestrator.ts:176`) |
| Lifecycle gating | `LIFECYCLE` map | fresh / expiry / cooldown per timeframe | ⛔ missing — no per-timeframe lifecycle map |
| 24/7 cycle | `run_cycle` / `runCycle` | Fans out all coins × timeframes, persists, never throws | 🟡 partial — `runScan` / `startMarketScanner` (`market-scanner.ts:329`,`511`) |
| Backtester | `backtest_series`, `run_backtest` | Scale-out resolution (40/35/25, breakeven after TP1) → win-rate + avg-R by grade/tf/strategy/direction | 🟡 partial — `validation/backtest_validator.py` (Phase 0 edge validation) |
| Learning loop | `run_learning`, `load_edge_weights` | Feeds backtest edge back into the scorer (self-tuning, hot-reload, reversible) | 🟡 partial — edge weighting in `risk-management-agent.ts` / journal stats |
| Paper/live executor | `run_paper_executor`, `place_live_order` | Risk-sized positions, SL/TP management; live is a guarded stub | 🟡 partial — `bot-engine.ts` (execution/sizing/state); live gated per `CLAUDE.md` |
| Alerts/brief output | `print_trades`, state JSON | Market brief, regime, sentiment, per-trade cards | 🟡 partial — `generatePerformanceReport` (`trade-journal-agent.ts:165`); routes in `routes.ts` |

## Port checklist (Phase 0 → live)

Before wiring any ported agent into the live bot:

1. Implement the deterministic sub-scorer in TypeScript (values only — no LLM recompute).
2. Add boundary-condition tests for it (`CLAUDE.md`: every module ships with tests).
3. Validate the strategy change via `validation/backtest_validator.py` — gate:
   bootstrap CI lower bound > 0 on 2 of 3 pairs after costs.
4. Reconcile weights against the existing `runPhase2Confluence` composite so the
   AI veto still only blocks/flags, never scores.
5. Commit per module (one module per session), not at end of phase.
