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
│   ├── handlers/      # HTTP handlers (empty, logic in server)
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

### Security Notes
- Never commit API keys or secrets
- JWT_SECRET must be set in production
- Passwords hashed with bcrypt
