# cmd/ - Application Entry Points

Contains the main entry point for the Gira application.

## Structure

```
cmd/
└── gira/
    └── main.go    # Application bootstrap
```

## main.go

The entry point performs three steps:
1. Load configuration from env vars or config file
2. Initialize SQLite database with migrations
3. Start the HTTP server

## Running

```bash
go run ./cmd/gira
```

## Best Practices

- Keep main.go minimal - delegate to internal packages
- All initialization errors should be fatal
- Database connection is deferred for cleanup
