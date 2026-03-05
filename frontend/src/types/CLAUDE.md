# types/ - TypeScript Definitions

Shared TypeScript interfaces for the frontend.

## File: index.ts

Contains all type definitions matching the backend models.

## Core Types

### User
```typescript
interface User {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  updated_at: string;
}
```

### Board, Column, Swimlane
Board contains columns and swimlanes. Swimlanes link to Gitea repos.

### Card
Main work item with:
- Position (board, column, swimlane)
- Optional sprint assignment
- Story points, priority, due date
- Labels and assignees

### Sprint
Sprint with status: `planning` | `active` | `completed`

### SprintMetrics, VelocityPoint
For burndown and velocity charts.

## Naming Convention

- Use snake_case for JSON fields (matches backend)
- Use TypeScript union types for enums
- Nullable fields: `field: Type | null`

## Best Practices

### Adding Types

1. Define in `index.ts`
2. Match backend model exactly
3. Use proper nullability
4. Export the interface

### Using Types

```typescript
import type { Card, Sprint } from '../types';

const [cards, setCards] = useState<Card[]>([]);
```

### Avoid `any`

- Define proper types
- Use `unknown` if type is truly unknown
- Add types to API client responses
