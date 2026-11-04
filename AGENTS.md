# AGENTS.md

`CLAUDE.md` is the source of truth for every agent working in this repo. Read it first and follow it. If this file and `CLAUDE.md` ever disagree, `CLAUDE.md` wins.

## Project Safety Rules

- Local git is allowed: `git status`, `git diff`, `git log`, `git show`, `git add <named files>`, `git restore --staged <files>`, `git commit`, and creating a new local branch.
- Ask first, every time, before: `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git reset`, `git clean`, `git commit --amend`, `git stash`, any `--force` flag, deleting or creating branches or tags beyond a new local branch, editing remotes or git config, and `git init`.
- Never rewrite or delete history that has been pushed.
- Never stage with `git add -A` or `git add .`. Stage named files only, and review `git diff --staged` before every commit.
- Before every commit run `npm run check` and `npm run scan:secrets`, and paste the output in the report. Never commit if either fails.
- Never read the `.env` file. Instead, use `.env.example` as the reference for any environment-related activities.
