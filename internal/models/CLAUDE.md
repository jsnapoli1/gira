# models/ - Data Models

Shared data structures used across the application.

## Core Models

### User
```go
type User struct {
    ID, Email, PasswordHash, DisplayName, AvatarURL
    CreatedAt, UpdatedAt
}
```
Note: `PasswordHash` uses `json:"-"` to exclude from API responses.

### Board
```go
type Board struct {
    ID, Name, Description, OwnerID
    Columns []Column
    Swimlanes []Swimlane
    CreatedAt, UpdatedAt
}
```

### Column
Board columns with position and state mapping (open, in_progress, closed).

### Swimlane
Horizontal lanes linked to Gitea repos. Each has a designator prefix (e.g., "PROJ-").

### Card
Issue cards with:
- Board/swimlane/column placement
- Optional sprint assignment
- Story points, priority, due date
- Labels and assignees

### Sprint
Sprint planning with:
- Status: planning, active, completed
- Start/end dates
- Goal description

### SprintMetrics
Daily snapshot for burndown charts:
- Total/completed/remaining points
- Total/completed cards

## Best Practices

- All models use JSON tags for API serialization
- Nullable fields use pointers (`*int64`, `*time.Time`)
- Add new models here, not in package-specific files
- Keep models as plain structs - no methods
