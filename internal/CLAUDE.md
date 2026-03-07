# internal/ - Go Backend Packages

Private packages for the Zira backend. Not importable by external projects.

## Package Overview

| Package | Purpose |
|---------|---------|
| `auth` | JWT token generation/validation, password hashing |
| `config` | Load/save configuration from env vars and files |
| `database` | SQLite database operations and migrations |
| `gitea` | HTTP client for Gitea API |
| `models` | Data structures shared across packages |
| `server` | HTTP server, routing, and request handlers |

## Dependencies

```
main.go
    └── config.Load()
    └── database.New()
    └── server.New(cfg, db)
            └── auth (middleware)
            └── gitea.Client
            └── models
```

## Best Practices

### Testing
- No unit tests exist currently
- Add tests in `*_test.go` files alongside source
- Use table-driven tests for Go code

### Error Handling
- Wrap errors with context: `fmt.Errorf("context: %w", err)`
- Return errors up the call stack
- Log at the top level only

### Adding New Features
1. Define models in `models/models.go`
2. Add database operations in `database/`
3. Add handlers in `server/server.go`
4. Register routes in `server.Start()`
