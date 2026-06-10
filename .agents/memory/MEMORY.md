# Memory Index

- [Auto-trading bot safety](auto-trading-bot.md) — paper-only execution; engine isolated from legacy exchange path; gating fields not PATCH-editable.
- [Replit cost & polling](replit-cost-polling.md) — autoscale scales to zero; keep frontend pollers visibility-gated and avoid server-side cron so idle = DB-compute-only.
