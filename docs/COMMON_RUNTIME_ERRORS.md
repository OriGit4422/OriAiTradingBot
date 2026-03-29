# Common runtime errors and exact fixes

## 1) `bash: syntax error near unexpected token newline`

Cause: you ran placeholder text literally:

```bash
git checkout <your-pr-branch>
```

`<...>` is placeholder syntax, not valid shell command.

### Fix
Use the actual branch name (example from your output):

```bash
git fetch origin
git checkout codex/review-project-and-summarize-functionality-hc0by3
git pull origin codex/review-project-and-summarize-functionality-hc0by3
```

## 2) `EADDRINUSE: address already in use 0.0.0.0:5000`

Cause: another process already uses port `5000`.

### Quick fix

```bash
./scripts/start_dev_on_free_port.sh 5000
```

This script stops any listener on port `5000` and starts the app.

### Manual fix (if needed)

```bash
lsof -i :5000
kill -9 <PID>
npm run dev
```

## 3) Verify updates are truly running

After server starts:

```bash
./scripts/verify_runtime_sync.sh http://localhost:5000
```

If runtime endpoints are reachable, compare the local git commit with runtime response.
