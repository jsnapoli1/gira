# Zira

A Jira-like project management and issue tracking application that integrates with Gitea. Manage your projects with Kanban boards, sprints, and comprehensive reporting.

## Features

### Board Management
- Create multiple boards with customizable columns
- Swimlanes based on different Gitea repositories
- Designator prefixes for cards (e.g., FE-123, BE-456)
- Color-coded swimlanes for visual organization

### Card Management
- Create cards directly from the board UI
- Cards sync with Gitea issues automatically
- Story points for estimation
- Priority levels (highest, high, medium, low, lowest)
- Drag-and-drop cards between columns
- State changes sync back to Gitea

### Sprint Management
- Create and manage sprints
- Backlog view for unassigned cards
- Drag cards into sprints from backlog
- Start and complete sprints
- Sprint goals and planning

### Reporting & Metrics
- Sprint burndown charts
- Velocity tracking across sprints
- Cumulative flow diagrams
- Sprint completion metrics
- Average velocity calculations

### Multi-User Support
- User registration and authentication
- JWT-based session management
- Board membership with roles (admin, member, viewer)
- Work item tracking per user

### Gitea Integration
- Connect to any Gitea instance
- Sync issues bidirectionally
- Repository selection for swimlanes
- Label and milestone support

## Tech Stack

- **Backend**: Go with native HTTP server, SQLite database
- **Frontend**: React 18 + TypeScript + Vite
- **Charts**: Recharts
- **Drag & Drop**: dnd-kit
- **Icons**: Lucide React
- **Testing**: Playwright (E2E)

## Prerequisites

- Go 1.21+
- Node.js 18+
- Gitea instance with API access (optional, for issue sync)

## Quick Start

### Backend

```bash
# Build and run
go build -o zira ./cmd/zira
./zira

# Or run directly
go run cmd/zira/main.go
```

The backend runs on port 8080 by default.

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Production build
npm run build
```

Development server runs on port 3000 and proxies API calls to backend.

## Configuration

### Via UI (Recommended)

1. Start the backend and frontend
2. Create an account at http://localhost:3000/signup
3. Go to Settings to configure your Gitea connection

### Via Environment Variables

```bash
export GITEA_URL=https://gitea.example.com
export GITEA_API_KEY=your_api_key_here
export JWT_SECRET=your_jwt_secret_here  # Optional, defaults to built-in
export PORT=8080  # Optional, defaults to 8080
```

Configuration is saved to `~/.config/zira/config.json` and the database to `~/.config/zira/zira.db`.

## Production Deployment

1. Build frontend:
```bash
cd frontend && npm run build
```

2. Build and run backend:
```bash
go build -o zira ./cmd/zira
./zira
```

The backend serves the frontend from `./frontend/dist` and the full application is available at http://localhost:8080.

## Testing

### E2E Tests (Playwright)

```bash
cd frontend

# Run all tests
npm test

# Run with UI
npm run test:ui

# Run headed (visible browser)
npm run test:headed
```

### Test Coverage

- Authentication (signup, login, logout)
- Board management (create, delete, navigation)
- Sprint management (create, start, complete)
- Card operations (swimlanes, modals)
- Reports and metrics
- Settings and configuration
- Navigation and routing

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Boards
- `GET /api/boards` - List boards
- `POST /api/boards` - Create board
- `GET /api/boards/:id` - Get board with columns and swimlanes
- `PUT /api/boards/:id` - Update board
- `DELETE /api/boards/:id` - Delete board

### Swimlanes & Columns
- `GET /api/boards/:id/swimlanes` - List swimlanes
- `POST /api/boards/:id/swimlanes` - Add swimlane
- `GET /api/boards/:id/columns` - List columns
- `POST /api/boards/:id/columns` - Add column

### Sprints
- `GET /api/sprints?board_id=X` - List sprints
- `POST /api/sprints?board_id=X` - Create sprint
- `POST /api/sprints/:id/start` - Start sprint
- `POST /api/sprints/:id/complete` - Complete sprint

### Cards
- `POST /api/cards` - Create card
- `GET /api/cards/:id` - Get card
- `PUT /api/cards/:id` - Update card
- `POST /api/cards/:id/move` - Move card to column
- `POST /api/cards/:id/assign-sprint` - Assign to sprint

### Metrics
- `GET /api/metrics/burndown?sprint_id=X` - Burndown data
- `GET /api/metrics/velocity?board_id=X` - Velocity data

## Architecture

```
zira/
├── cmd/zira/          # Application entry point
├── internal/
│   ├── auth/          # JWT authentication
│   ├── config/        # Configuration loading
│   ├── database/      # SQLite database layer
│   ├── gitea/         # Gitea API client
│   ├── models/        # Data models
│   └── server/        # HTTP handlers
└── frontend/
    ├── src/
    │   ├── api/       # API client
    │   ├── components/# Reusable components
    │   ├── context/   # React contexts
    │   ├── pages/     # Page components
    │   └── types/     # TypeScript types
    └── e2e/           # Playwright tests
```

## License

MIT
