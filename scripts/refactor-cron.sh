#!/bin/bash
# Zira Automated Refactoring Cron Job
# Runs Claude Code headless to pick the next TODO item and fix it.
# Usage: Called by cron, or manually: ./scripts/refactor-cron.sh

set -euo pipefail

PROJECT_DIR="/Users/jsnapoli1/Documents/open-source/zira"
LOG_DIR="${PROJECT_DIR}/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/refactor-${TIMESTAMP}.log"

mkdir -p "${LOG_DIR}"

cd "${PROJECT_DIR}"

# Check we're on main and clean
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "[$(date)] Not on main branch (on ${BRANCH}), skipping." >> "${LOG_FILE}"
    exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "[$(date)] Working tree dirty, skipping." >> "${LOG_FILE}"
    exit 0
fi

echo "[$(date)] Starting automated refactor run" >> "${LOG_FILE}"

# Run Claude in headless mode with no permission prompts
claude --dangerously-skip-permissions -p "$(cat <<'PROMPT'
You are running as an automated refactoring agent for the Zira codebase. Your job:

1. Read TODO.md and find the FIRST unchecked item (line starting with "- [ ]").
2. Implement that fix completely. Read the relevant source files, make the changes, and ensure correctness.
3. After making changes:
   a. Run `go build ./cmd/zira` to verify the Go backend compiles.
   b. Run `gofmt -w .` on any modified Go files.
   c. If the fix is frontend-related, run `cd frontend && npx tsc --noEmit` to verify TypeScript compiles.
   d. Review your own changes: read the diff with `git diff` and verify the fix is correct, complete, and introduces no regressions.
4. If everything passes, mark the item as done in TODO.md by changing "- [ ]" to "- [x]" for that specific item.
5. Stage ONLY the files you changed and the updated TODO.md, then commit with a descriptive message like "refactor(B1): set SQLite MaxOpenConns(1) to prevent concurrent write errors".
6. Do NOT push. Do NOT modify files unrelated to the TODO item.
7. If you encounter a problem you cannot resolve, do NOT commit. Instead, add a note to the TODO item describing the blocker and exit.

Important rules:
- Only fix ONE item per run.
- Do not modify any code beyond what the TODO item requires.
- Do not add features or refactor beyond scope.
- If the fix requires changes that would break E2E tests, note it but still make the fix if it's correct.
- Always verify the build passes before committing.
PROMPT
)" >> "${LOG_FILE}" 2>&1

EXIT_CODE=$?

echo "[$(date)] Claude exited with code ${EXIT_CODE}" >> "${LOG_FILE}"

# Log the result
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Run completed successfully" >> "${LOG_FILE}"
    # Log what was committed
    git log -1 --oneline >> "${LOG_FILE}" 2>&1
else
    echo "[$(date)] Run failed" >> "${LOG_FILE}"
fi

# Clean up old logs (keep last 30)
ls -t "${LOG_DIR}"/refactor-*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true

echo "[$(date)] Done" >> "${LOG_FILE}"
