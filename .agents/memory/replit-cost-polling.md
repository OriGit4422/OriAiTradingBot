---
name: Replit cost & polling
description: How to keep this app's running cost near zero (DB compute only) on autoscale.
---

# Keeping running cost low (autoscale)

Deployment target is **autoscale** (`.replit` `[deployment]`). It scales to zero when no requests arrive, so an idle/closed app should cost only database compute (plus any plan base fee). The thing that keeps the instance warm is the **frontend polling the backend**.

- **Rule:** every `setInterval`-based network poller must be guarded with `if (!document.hidden) ...` so a hidden/closed tab makes zero requests. TanStack Query `refetchInterval` already pauses in the background (`refetchIntervalInBackground` defaults false and `queryClient.ts` does not override it), so those are fine as-is.
- **Rule:** do NOT add server-side `setInterval`/cron/while-loops for periodic work — that would keep the instance billed even with no users. (The only `while(true)` in `server/ai-providers.ts` is a per-request stream reader, not a background loop.)
- External costs are not Replit's: AI uses the user's own provider keys (billed by OpenAI/Anthropic/Gemini), Binance is keyless/free.

**Why:** user wanted to be charged for database compute only and to reduce running cost. **How to apply:** when adding any new live-updating UI, gate its poll on tab visibility and prefer the longest acceptable interval; never introduce a server-side timer.
