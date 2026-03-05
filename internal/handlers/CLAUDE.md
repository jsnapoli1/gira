# handlers/ - HTTP Handlers

This directory is currently empty.

All HTTP handlers are implemented in `server/server.go` as methods on the `*Server` struct.

## Future Use

If the server file grows too large, handlers can be extracted here:

```go
// handlers/boards.go
package handlers

func (h *Handlers) HandleBoards(w http.ResponseWriter, r *http.Request) {
    // ...
}
```

## Current Location

See `internal/server/server.go` for all handler implementations.
