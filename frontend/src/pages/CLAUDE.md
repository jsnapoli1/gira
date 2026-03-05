# pages/ - Route Components

Top-level components rendered by React Router.

## Pages

| File | Route | Description |
|------|-------|-------------|
| `Login.tsx` | `/login` | User login form |
| `Signup.tsx` | `/signup` | User registration form |
| `BoardsList.tsx` | `/boards` | List of user's boards |
| `BoardView.tsx` | `/boards/:id` | Kanban board with cards |
| `BoardSettings.tsx` | `/boards/:id/settings` | Board configuration |
| `Reports.tsx` | `/reports` | Burndown and velocity charts |
| `Settings.tsx` | `/settings` | Gitea configuration |

## Page Structure

```typescript
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { boards } from '../api/client';

export function PageName() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const result = await boards.list();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Layout><div>Loading...</div></Layout>;
  if (error) return <Layout><div>Error: {error}</div></Layout>;

  return (
    <Layout>
      {/* Page content */}
    </Layout>
  );
}
```

## Best Practices

### Adding New Pages

1. Create `PageName.tsx` in this directory
2. Add route in `App.tsx`
3. Wrap with `PrivateRoute` for auth-required pages
4. Use `Layout` component for consistent nav
5. Add E2E test in `e2e/pagename.spec.ts`

### State Management

- Use `useState` for local state
- Fetch data in `useEffect`
- Handle loading and error states
- Refetch after mutations

### URL Parameters

```typescript
const { boardId } = useParams<{ boardId: string }>();
const id = Number(boardId);
```
