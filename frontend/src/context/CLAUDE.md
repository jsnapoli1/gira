# context/ - React Contexts

React context providers for global state.

## AuthContext.tsx

Manages authentication state across the app.

### Provided Values

```typescript
{
  user: User | null;      // Current user or null
  loading: boolean;       // Initial auth check in progress
  login: (email, password) => Promise<void>;
  signup: (email, password, displayName) => Promise<void>;
  logout: () => void;
}
```

### Usage

```typescript
import { useAuth } from '../context/AuthContext';

function MyComponent() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return <button onClick={logout}>Logout {user.email}</button>;
}
```

### How It Works

1. On mount, checks for token in localStorage
2. Validates token via `/api/auth/me`
3. Sets user state if valid
4. Provides auth methods to all children

## Best Practices

### Adding New Contexts

1. Create `NameContext.tsx`
2. Define context value interface
3. Create provider component
4. Export `useContextName` hook
5. Wrap app in `App.tsx`

### When to Use Context

- Global state needed by many components
- Avoid prop drilling through many levels
- Auth, theme, locale, etc.

### When NOT to Use Context

- Local component state
- Data that changes frequently (use local state)
- Server state (just fetch in components)
