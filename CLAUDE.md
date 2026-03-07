# Zira - Project Management Tool

Zira is a Jira-like project management application that integrates with Gitea for issue tracking. It provides a Kanban board interface with sprints, swimlanes, and reporting features.

## Project Structure

```
zira/
├── cmd/zira/          # Application entry point
├── internal/          # Go backend packages
│   ├── auth/          # JWT authentication
│   ├── config/        # Configuration management
│   ├── database/      # SQLite database layer
│   ├── gitea/         # Gitea API client
│   ├── models/        # Data models
│   └── server/        # HTTP server and routes
└── frontend/          # React frontend (Vite + TypeScript)
    ├── src/           # Source code
    └── e2e/           # Playwright tests
```

## Tech Stack

- **Backend**: Go 1.24+, SQLite, JWT authentication
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Testing**: Playwright (E2E)
- **External**: Gitea API integration

## Quick Start

```bash
# Backend
go run ./cmd/zira

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Deployment

The app is deployed via **Gitea Actions** to **Portainer** (Docker).

- Docker image is built and pushed on commits to main
- Portainer pulls and runs the container
- Persistent data is stored in `/app/data/` (mounted volume)

## Configuration

Set via environment variables or `~/.config/zira/config.json`:
- `GITEA_URL` - Gitea instance URL
- `GITEA_API_KEY` - Gitea API token
- `JWT_SECRET` - JWT signing secret (required in production)
- `PORT` - Server port (default: 8080)
- `DB_PATH` - Database file path (default: `~/.config/zira/zira.db`, Docker: `/app/data/zira.db`)
- `DATA_DIR` - Data directory for attachments (default: `~/.config/zira`, Docker: `/app/data`)

## Best Practices

### Testing
- Run Playwright tests: `cd frontend && npm test`
- All new features need E2E test coverage in `frontend/e2e/`
- Test files follow pattern: `*.spec.ts`
- Go build check: `go build ./cmd/zira` (must pass before committing)
- Run `gofmt -w .` on any modified Go files

### Code Style
- Go: Standard `gofmt` formatting
- TypeScript: Follow existing patterns in `src/`
- No unit tests currently - focus on E2E tests

### API Routes
- Auth: `/api/auth/*`
- Config: `/api/config/*`
- Boards/Cards/Sprints: `/api/boards/*`, `/api/cards/*`, `/api/sprints/*`
- Gitea proxy: `/api/repos`, `/api/issues`, `/api/labels`

### Database
- SQLite stored at `~/.config/zira/zira.db`
- Migrations run automatically on startup
- Foreign keys enabled
- **SQLite requires `SetMaxOpenConns(1)`** — concurrent writes cause "database is locked"

### Security Notes
- Never commit API keys or secrets
- JWT_SECRET must be set in production
- Passwords hashed with bcrypt
- Never fetch `password_hash` in queries unless needed for authentication
- Always use middleware (`requireAuth`, `requireAdmin`, `requireBoardRole`) instead of inline auth checks
- Attachment IDs are sequential integers — do not rely on non-guessability for security

## Architecture Guidelines

### Backend (Go)

- **server.go is the main handler file** (~3000 lines). When adding new handlers, consider placing them in domain-specific files within `internal/server/` (e.g., `board_handlers.go`).
- **internal/handlers/ is empty** — all handler logic lives in `internal/server/`. Do not add code to `internal/handlers/`.
- The `Server` struct holds `DB`, `Config`, `Client` (Gitea/GitHub), and the SSE hub. Handlers are methods on `Server`.
- Route registration happens in `server.go:Start()`. Routes use `http.ServeMux` with manual path parsing (no third-party router).
- Middleware pattern: `s.requireAuth(handlerFunc)` wraps handlers. Auth info is stored in request context via `context.go`.
- The `RepoClient` interface in `server.go` is dead code — do not use it.
- Always guard Gitea client calls with `s.Config.IsConfigured()` or use `requireConfig` middleware to prevent nil-deref.
- `updateClient()` is not goroutine-safe — access to `s.Client` and `s.Config` fields should be synchronized.

### Frontend (React/TypeScript)

- **BoardView.tsx is the main component** (~2000 lines). It contains `CardDetailModal`, `BacklogView`, `CardItem`, `DroppableColumn`, and modal components inline. Extract components when possible.
- State management: `useState` + `AuthContext` only. No external state library.
- API client (`src/api/client.ts`): Namespaced module objects. **Return types are currently all `any`** — use proper interfaces from `types/index.ts` when modifying.
- SSE hook (`hooks/useBoardSSE.ts`): Handles real-time updates with exponential backoff. Uses `useRef` for the EventSource.
- CSS: Single `App.css` file (3500 lines). Not using Tailwind utility-first — uses custom classes.
- Card modal UI was redesigned from tabs to a compact inline layout. Classes use `.card-detail-modal-unified`, `.time-tracking-compact`, `.time-input-mini`.
- `window.confirm()` is used for destructive actions (9 instances).
- Token is accessed from `localStorage` in 3 places (API client, SSE hook, attachment upload) — not centralized.

### Refactoring Tracker

See `TODO.md` for the prioritized refactoring backlog. Items are designed to be completed independently.
