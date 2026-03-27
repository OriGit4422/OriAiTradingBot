# server/routes.ts conflict resolution snippet

If GitHub shows this conflict in `server/routes.ts` imports, keep **all** these imports and delete conflict markers:

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

Then remove:

- `<<<<<<< codex/review-project-and-summarize-functionality-zkavij`
- `=======`
- `>>>>>>> main`

And commit the conflict resolution in GitHub UI.

