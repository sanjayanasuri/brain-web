# Retry: {{TASK_ID}}

**Branch:** `{{BRANCH_NAME}}`

**Previous outcome:** {{PREVIOUS_OUTCOME}}

**Description (original):**  
{{TASK_DESCRIPTION}}

---

## Definition of Done (same as before)

1. **PR created** – Pull request from `{{BRANCH_NAME}}` to `main`.
2. **Branch rebased on origin/main** – No conflicts with `origin/main`.
3. **CI green** – Lint, typecheck, tests pass (`gh pr checks`).
4. **UI changes** – Screenshots in PR description if you changed UI.
5. **Tests** – Add or update tests for your change.
6. **No refactors unless required** – Minimal scope.

Address the feedback or failure above, then push, update the PR, and get CI green.
