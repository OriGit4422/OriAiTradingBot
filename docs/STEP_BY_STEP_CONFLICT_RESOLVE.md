# Step-by-step: resolve PR conflict in GitHub UI (no terminal needed)

This is for PR conflict in `server/routes.ts`.

## A) Where to do it

1. Open your repository on GitHub.
2. Click **Pull requests**.
3. Open your PR (`#3` in your screenshot).
4. Click the **Resolve conflicts** button.

## B) What to edit

In the `server/routes.ts` editor, find the conflict block near imports.

### Replace the entire conflict section with this final import block:

```ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSettingsSchema, insertStrategySchema, insertSignalSchema, insertPositionSchema, insertUserAccessSchema } from "@shared/schema";
import { z } from "zod";
import { analyzeSignalWithAI, getMarketInsight } from "./ai-analysis";
import { notifySignal, validateSignalBestPractice } from "./notifications";
import { testBinanceConnectivity, testBybitConnectivity } from "./exchange-connectivity";
import { evaluateSignalsPerformance } from "./signal-performance";
```

### Ensure these markers are fully removed:

- `<<<<<<< ...`
- `=======`
- `>>>>>>> ...`

## C) Save on GitHub

1. Click **Mark as resolved**.
2. Click **Commit merge**.
3. Return to PR page and confirm conflict banner is gone.

## D) Merge and update app

1. Click **Merge pull request**.
2. Click **Confirm merge**.
3. Pull latest branch on your machine and restart app:

```bash
git fetch origin
git checkout main
git pull origin main
npm install
npm run dev
```

4. Hard refresh browser (`Ctrl/Cmd + Shift + R`).
5. Verify latest commit is present locally:

```bash
git log --oneline -n 5
```

### Important

If your PR is **not merged yet**, running `git checkout main && git pull origin main` will show the **old app** (expected).

In that case run your PR branch instead:

```bash
git fetch origin
git checkout <your-pr-branch>
git pull origin <your-pr-branch>
npm install
npm run dev
```

## E) Verify new backend features are live

```bash
curl http://localhost:5000/api/system/version
curl http://localhost:5000/api/system/requirements-status
curl http://localhost:5000/api/system/diagnostics
curl http://localhost:5000/api/signals/performance?hours=24
curl -X POST http://localhost:5000/api/exchange/binance/test -H 'Content-Type: application/json' -d '{"apiKey":"YOUR_BINANCE_KEY"}'
curl -X POST http://localhost:5000/api/exchange/bybit/test -H 'Content-Type: application/json' -d '{"apiKey":"YOUR_BYBIT_KEY"}'
curl -X POST http://localhost:5000/api/notifications/test
```

Or run one command:

```bash
./scripts/verify_runtime_sync.sh http://localhost:5000
```

If you get bash placeholder errors or `EADDRINUSE` on port 5000, see:

- `docs/COMMON_RUNTIME_ERRORS.md`
