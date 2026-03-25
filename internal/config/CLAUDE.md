# config/ - Configuration Management

Loads and saves application configuration from environment variables and config files.

## Config Structure

```go
type Config struct {
    GiteaURL         string  // Gitea instance URL
    GiteaAPIKey      string  // Gitea API token
    GiteaInsecureTLS bool    // Skip TLS verification
    Port             int     // Server port (default: 9002)
}
```

## Loading Priority

1. Environment variables (`GITEA_URL`, `GITEA_API_KEY`, `PORT`)
2. Config file (`~/.config/gira/config.json`)
3. Defaults

## Key Functions

| Function | Purpose |
|----------|---------|
| `Load()` | Load config from env/file |
| `IsConfigured()` | Check if Gitea credentials are set |
| `LoadFromFile()` | Read from config.json |
| `SaveToFile()` | Write to config.json |

## File Location

- Config: `~/.config/gira/config.json`
- Created with 0600 permissions (owner read/write only)

## Best Practices

- Use environment variables in production
- Config file is for local development
- Never commit config files with real credentials
