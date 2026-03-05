# auth/ - Authentication Package

Handles JWT token management and password hashing for user authentication.

## Key Functions

| Function | Purpose |
|----------|---------|
| `HashPassword(password)` | Hash password with bcrypt |
| `CheckPassword(password, hash)` | Verify password against hash |
| `GenerateToken(user)` | Create JWT token (24h expiry) |
| `ValidateToken(tokenString)` | Parse and validate JWT |
| `ExtractTokenFromRequest(r)` | Get Bearer token from Authorization header |

## JWT Claims

```go
type Claims struct {
    UserID int64
    Email  string
    jwt.RegisteredClaims
}
```

## Configuration

- `JWT_SECRET` env var sets the signing key
- Default secret is for development only
- Tokens expire after 24 hours

## Error Types

- `ErrInvalidCredentials` - Wrong password
- `ErrUserExists` - Email already registered
- `ErrInvalidToken` - Malformed or invalid JWT
- `ErrExpiredToken` - Token past expiry

## Best Practices

- Always use `JWT_SECRET` in production
- Never log tokens or password hashes
- Use `CheckPassword()` for timing-safe comparison
