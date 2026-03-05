# src/ - Frontend Source Code

Main source directory for the React application.

## Structure

| Directory | Purpose |
|-----------|---------|
| `api/` | API client for backend communication |
| `components/` | Reusable React components |
| `context/` | React context providers |
| `pages/` | Top-level route components |
| `types/` | TypeScript type definitions |

## Key Files

- `main.tsx` - App entry point, renders to #root
- `App.tsx` - Router setup with auth guards
- `App.css` - Global styles

## Auth Flow

1. `AuthContext` provides `user`, `login`, `logout`, `signup`
2. `PrivateRoute` redirects to `/login` if not authenticated
3. `PublicRoute` redirects to `/boards` if already logged in
4. JWT token stored in `localStorage`

## Best Practices

### Adding New Pages
1. Create component in `pages/`
2. Add route in `App.tsx`
3. Wrap with `PrivateRoute` or `PublicRoute`
4. Add E2E test in `e2e/`

### State Management
- Use React hooks (`useState`, `useEffect`)
- Use `AuthContext` for auth state
- Local state for component-specific data
- No Redux or other state library

### TypeScript
- Define interfaces in `types/index.ts`
- Use proper types, avoid `any`
- Match backend JSON field names (snake_case)
