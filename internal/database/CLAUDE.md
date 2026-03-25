# database/ - SQLite Database Layer

Handles all database operations using SQLite with foreign key support.

## Files

| File | Purpose |
|------|---------|
| `database.go` | DB initialization and migrations |
| `users.go` | User CRUD operations |
| `boards.go` | Board, column, swimlane operations |
| `cards.go` | Card CRUD and movement |
| `sprints.go` | Sprint management and metrics |
| `labels.go` | Label management |

## Database Location

`~/.config/gira/gira.db`

## Schema

Main tables:
- `users` - User accounts
- `boards` - Kanban boards
- `columns` - Board columns (To Do, In Progress, Done)
- `swimlanes` - Horizontal lanes linked to repos
- `cards` - Issue cards on boards
- `sprints` - Sprint definitions
- `sprint_metrics` - Daily burndown data
- `labels` - Card labels
- `card_labels` - Many-to-many card/label
- `card_assignees` - Many-to-many card/user
- `board_members` - Board access control
- `work_items` - Time tracking

## Migrations

Migrations run automatically on startup in `database.go`. New migrations are appended to the `migrations` slice.

## Best Practices

### Adding New Tables
1. Add CREATE TABLE to migrations slice
2. Add indexes for foreign keys and common queries
3. Add CRUD functions in appropriate file

### Query Patterns
- Always use parameterized queries (`?` placeholders)
- Check `sql.ErrNoRows` for not found
- Use transactions for multi-table updates

### Error Handling
```go
if err == sql.ErrNoRows {
    return nil, nil  // Not found is not an error
}
if err != nil {
    return nil, fmt.Errorf("context: %w", err)
}
```
