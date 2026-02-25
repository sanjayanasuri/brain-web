# Task: {{TASK_ID}}

**Branch:** `{{BRANCH_NAME}}`

**Description:**  
{{TASK_DESCRIPTION}}

---

## Definition of Done

Complete the work so that:

1. **PR created** – Open a pull request from `{{BRANCH_NAME}}` to `main` (use `gh pr create` or GitHub UI).
2. **Branch rebased on origin/main** – No merge conflicts; branch is up to date with `origin/main`.
3. **CI green** – Lint, typecheck, and tests all pass (visible in `gh pr checks`).
4. **UI changes** – If you changed any UI, add screenshots to the PR description.
5. **Tests** – Add or update tests relevant to your change.
6. **No refactors unless required** – Only refactor when necessary for the task; avoid scope creep.

Work in this repo (git worktree). Install deps with `pnpm install` or `npm ci` if needed. When done, push the branch, create the PR, and ensure CI passes.
