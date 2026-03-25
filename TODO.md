# Gira Refactoring TODO

Items are ordered by priority. Each item should be a self-contained fix that can be completed, tested, and committed independently.

## Backend - Critical

- [x] **B1: Set SQLite MaxOpenConns(1)** — Add `db.SetMaxOpenConns(1)` after opening the SQLite connection in `internal/database/database.go` to prevent "database is locked" errors under concurrent write load. Verify the app still starts and passes E2E tests.

- [x] **B2: Fix attachment delete order** — In `internal/server/server.go` `handleCardAttachments` DELETE case, delete the DB record first, then remove the file from disk. Currently the file is deleted before the DB record, leaving orphaned rows on DB failure.

- [x] **B3: Add nil-check for Gitea client** — `handleIssues`, `handleLabels`, and `handleMilestones` in `server.go` will nil-deref if `s.Client` is nil (Gitea not configured). Add `s.Config.IsConfigured()` guard to each, returning a 503 with a clear message. The `requireConfig` middleware already exists but is never wired up — wire it to these routes.

- [x] **B4: Remove dead code** — Delete the empty `internal/handlers/` package. Remove the unused `RepoClient` interface from `server.go`. Remove `requireConfig` if it gets wired in B3 (it becomes used). Clean up any other dead declarations.

- [x] **B5: Fix handleConfig inline auth** — `handleConfig` POST manually re-implements `requireAuth`+`requireAdmin`. Split into `handleConfigGet` and `handleConfigPost`, wrap the POST handler with `requireAdmin` middleware, and remove the inline auth code.

- [x] **B6: Fix handleMe inline auth** — `handleMe` manually re-implements `requireAuth`. Wrap it with `requireAuth` middleware and use `getUserFromContext` instead of duplicating token extraction/validation.

- [x] **B7: Handle LastInsertId errors** — In all database CRUD files (`boards.go`, `cards.go`, `sprints.go`, `labels.go`, `comments.go`, `attachments.go`, `notifications.go`, `custom_fields.go`), check and return the error from `result.LastInsertId()` instead of discarding it with `_`.

- [x] **B8: Stop fetching password_hash unnecessarily** — In `GetCardAssignees` (cards.go) and `ListUsers` (users.go), exclude `password_hash` from the SELECT columns. Only fetch it in `GetUserByUsername` where it's needed for auth.

## Backend - Important

- [x] **B9: Add mutex for Config/Client updates** — `updateClient()` writes `s.Client` and `s.Config` fields without synchronization. Add a `sync.RWMutex` to `Server`, lock on writes in `updateClient`/`handleConfig`, and read-lock in handlers that access `s.Client`.

- [x] **B10: Split server.go into handler files** — Extract handlers into domain-specific files within `internal/server/`: `auth_handlers.go`, `board_handlers.go`, `card_handlers.go`, `sprint_handlers.go`, `notification_handlers.go`, `credential_handlers.go`, `gitea_handlers.go`, `config_handlers.go`, `admin_handlers.go`. Keep `server.go` for struct definition, `Start()`, middleware, and route registration only.

- [x] **B11: Use Go 1.22 routing patterns** — Replace manual `strings.TrimPrefix` + `strings.Split` routing with Go 1.22's `mux.HandleFunc("GET /api/boards/{id}", ...)` pattern throughout. Do this after B10 so the handler files are already split.

## Frontend - Critical

- [x] **F1: Type the API client** — Replace all `any` return types in `frontend/src/api/client.ts` with proper interfaces from `types/index.ts`. There are ~50 instances. This is the single highest-leverage TypeScript improvement.

- [x] **F2: Remove dead code from BoardView** — Remove the dead `formatFileSize`, `handleDeleteWorkLog` functions and their `void` suppressions. Remove unused state variables (`workLogs`, `loadingWorkLogs`, `loadingCustomFields`) and their setters. Remove associated eslint-disable comments.

- [x] **F3: Fix stale E2E tests** — Update `frontend/e2e/worklogs.spec.ts` to match the current compact time-tracking UI (`.time-tracking-compact`, `.time-input-mini`). Update any specs referencing `.card-detail-modal` to use `.card-detail-modal-unified`. Run E2E suite to verify.

## Frontend - Important

- [x] **F4: Extract CardDetailModal** — Move `CardDetailModal` (~880 lines) from `BoardView.tsx` into `frontend/src/components/CardDetailModal.tsx`. Pass required props. No behavior changes.

- [x] **F5: Extract CardItem and DroppableColumn** — Move `CardItem` and `DroppableColumn` from `BoardView.tsx` into their own files in `frontend/src/components/`. Add `React.memo` to both for performance.

- [x] **F6: Extract BacklogView** — Move `BacklogView` (~300 lines) and `AddSwimlaneModal`, `AddCardModal` from `BoardView.tsx` into their own component files.

- [x] **F7: Centralize token access** — Create a single `getToken()` utility that all code uses (API client, SSE hook, attachment upload). Remove the 3 separate `localStorage.getItem` calls.

- [x] **F8: Add error feedback for mutations** — Add a simple toast/notification system so users see success/failure for card moves, creates, deletes, sprint changes, etc. Replace `console.error`-only patterns.

## Security

- [x] **S1: Warn on default JWT secret** — In `internal/auth/auth.go`, log a loud warning at startup if `JWT_SECRET` is not set. In production (detect via env var or build flag), refuse to start.

- [x] **S2: Add board membership checks** — `handleSprints`, `handleCards` creation, `handleBurndown`, and `handleVelocity` do not verify board membership. Add `requireBoardRole` or equivalent checks.

## Infrastructure

- [x] **I1: Fix Dockerfile EXPOSE** — Change `EXPOSE 8080` to `EXPOSE 9002` to match the actual port, or make the app respect the PORT env var consistently.

- [x] **I2: Pin Alpine version** — Change `FROM alpine:latest` to `FROM alpine:3.21` in the Dockerfile runtime stage.

- [x] **I3: Add non-root user** — Add `RUN adduser -D appuser` and `USER appuser` to the Dockerfile runtime stage.
