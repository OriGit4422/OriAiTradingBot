# Fix PR Conflict + App Not Updating

If your PR merges but app still shows old behavior, use this exact flow.

Optional helper script in this repo:

```bash
./scripts/resolve_pr_conflict.sh main
```

It rebases your current branch on `origin/main` and checks for unresolved conflict markers.

## 1) Resolve conflict markers first

You likely have unresolved markers in `server/routes.ts` like:

- `<<<<<<<`
- `=======`
- `>>>>>>>`

In GitHub conflict editor, choose **Accept both changes** where needed and keep these imports together:

- `notifySignal`, `validateSignalBestPractice` from `./notifications`
- `testBinanceConnectivity`, `testBybitConnectivity` from `./exchange-connectivity`
- `evaluateSignalsPerformance` from `./signal-performance`

Then remove all markers and commit the conflict resolution.

## 2) Verify no conflict markers remain

```bash
rg -n "<<<<<<<|=======|>>>>>>>"
```

Expected output: **no matches**.

## 3) Pull correct branch and rebuild

```bash
git fetch origin
git checkout work
git pull --rebase origin work
npm install
npm run dev
```

If your deployed branch is `main`, switch `work` -> `main` in commands above.

## 4) Confirm features are active

Use these API checks:

```bash
# requirements/feature readiness
curl http://localhost:5000/api/system/requirements-status

# exchange connectivity checks
curl -X POST http://localhost:5000/api/exchange/binance/test -H 'Content-Type: application/json' -d '{"apiKey":"YOUR_BINANCE_KEY"}'
curl -X POST http://localhost:5000/api/exchange/bybit/test -H 'Content-Type: application/json' -d '{"apiKey":"YOUR_BYBIT_KEY"}'

# signal 24h performance view API
curl http://localhost:5000/api/signals/performance?hours=24
```

## 5) UI cache issue quick fix

If backend is updated but UI appears old:

- Hard refresh browser (`Ctrl/Cmd + Shift + R`)
- Restart dev server
- Ensure you are on the same branch that contains the merged commit

## 6) If Git says: "Unsupported state: you are in the middle of a rebase"

This means a previous rebase did not finish.

### Option A (recommended): finish the rebase

```bash
git status
# resolve conflicted files
git add <resolved-files>
git rebase --continue
```

Repeat until rebase completes.

### Option B: cancel and restart cleanly

```bash
git rebase --abort
git fetch origin
git checkout <your-pr-branch>
./scripts/resolve_pr_conflict.sh main
```

### If there are no conflicts but Git still blocks

```bash
git rebase --continue || true
git rebase --abort || true
```

Then start again with Option B.
