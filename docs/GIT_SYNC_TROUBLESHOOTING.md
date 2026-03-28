# Git Push/Pull Troubleshooting (OriAiTradingBot)

If `git pull` shows no changes or `git push` fails, run these checks in order.

## 1) Verify current branch and local commits

```bash
git status -sb
git branch -vv
git log --oneline --decorate -n 10
```

You must be on the branch that contains your commits (for this repo it may be `work`).

## 2) Verify remote exists

```bash
git remote -v
```

If this prints nothing, add your GitHub remote:

```bash
git remote add origin <YOUR_GITHUB_REPO_URL>
```

Examples:
- HTTPS: `https://github.com/<user>/<repo>.git`
- SSH: `git@github.com:<user>/<repo>.git`

## 3) Push local branch to GitHub

```bash
git push -u origin work
```

If your target branch is `main` instead:

```bash
git push -u origin work:main
```

## 4) Pull latest remote changes safely

```bash
git fetch origin
git checkout work
git pull --rebase origin work
```

If remote branch is `main`:

```bash
git pull --rebase origin main
```

## 5) Common failure causes

- **No remote configured**: `git remote -v` is empty.
- **Wrong branch checked out**: you committed on `work`, but pulled `main`.
- **Auth issue**: GitHub token/SSH key not configured.
- **Non-fast-forward**: remote has commits not in your local branch; run fetch + rebase.

## 6) Quick recovery commands

```bash
# Show local-only commits
git log --oneline origin/work..work

# Show remote-only commits
git log --oneline work..origin/work
```

Then rebase and push again.
