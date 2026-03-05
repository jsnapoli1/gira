# api/ - API Client

HTTP client for communicating with the Go backend.

## File: client.ts

Single file containing all API functions organized by resource.

## Base Configuration

- Base URL: `/api` (proxied to backend in dev)
- Auth: Bearer token from localStorage
- Content-Type: application/json

## API Modules

| Module | Endpoints |
|--------|-----------|
| `auth` | signup, login, me |
| `config` | getStatus, save |
| `boards` | CRUD, swimlanes, columns, cards, members, labels |
| `sprints` | CRUD, start, complete, cards, metrics |
| `cards` | CRUD, move, assignees, comments, labels |
| `metrics` | burndown, velocity |
| `gitea` | getRepos, getIssues |
| `users` | list |

## Usage

```typescript
import { boards, cards } from '../api/client';

// Get all boards
const boardList = await boards.list();

// Create a card
const card = await cards.create({
  board_id: 1,
  swimlane_id: 1,
  column_id: 1,
  title: 'New card',
  description: 'Details',
});
```

## Error Handling

Throws `Error` with response text for non-OK responses. Handle in components:

```typescript
try {
  await cards.delete(id);
} catch (err) {
  setError(err.message);
}
```

## Best Practices

- Add new endpoints to existing modules
- Keep function signatures consistent
- Match backend API paths exactly
- Use TypeScript generics for return types
