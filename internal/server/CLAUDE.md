# server/ - HTTP Server

Main HTTP server with routing and request handlers.

## Files

| File | Purpose |
|------|---------|
| `server.go` | Server struct, routes, all handlers |
| `context.go` | Request context helpers |

## Server Structure

```go
type Server struct {
    Config *config.Config
    Client *gitea.Client  // May be nil if not configured
    DB     *database.DB
    Port   int
}
```

## Route Groups

### Auth (`/api/auth/*`)
- `POST /signup` - Create account
- `POST /login` - Get JWT token
- `GET /me` - Current user info

### Config (`/api/config/*`)
- `GET/POST /config` - Gitea settings
- `GET /config/status` - Check if configured

### Boards (`/api/boards/*`)
- CRUD operations for boards, columns, swimlanes
- Board member management

### Cards (`/api/cards/*`)
- Create, update, delete cards
- Move between columns/swimlanes
- Assignee management

### Sprints (`/api/sprints/*`)
- Sprint CRUD
- Start/complete sprints
- Metrics and burndown data

### Gitea Proxy (`/api/repos`, `/api/issues`, etc.)
- Proxies requests to Gitea API
- Requires authentication

## Middleware

`requireAuth()` - Wraps handlers to require valid JWT.

## Best Practices

### Adding New Endpoints
1. Add handler method on `*Server`
2. Register route in `Start()`
3. Use `requireAuth()` for protected routes
4. Return JSON with proper status codes

### Error Responses
```go
http.Error(w, "message", http.StatusBadRequest)
```

### JSON Responses
```go
w.Header().Set("Content-Type", "application/json")
json.NewEncoder(w).Encode(data)
```

### Request Parsing
```go
var req struct { Field string `json:"field"` }
json.NewDecoder(r.Body).Decode(&req)
```
