# components/ - Reusable Components

Shared React components used across multiple pages.

## Current Components

- `Layout.tsx` - Main app layout with navigation sidebar

## Component Guidelines

### Creating Components

```typescript
interface Props {
  // Define all props with types
}

export function ComponentName({ prop1, prop2 }: Props) {
  return (
    // JSX
  );
}
```

### Best Practices

- One component per file
- Export named functions (not default)
- Define Props interface for type safety
- Keep components focused and small
- Extract repeated UI patterns here

### Styling

- Use CSS classes from `App.css`
- Follow BEM-like naming: `component-name__element--modifier`
- No inline styles

### When to Create a Component

Extract to `components/` when:
- Used in 2+ places
- Complex enough to benefit from isolation
- Has reusable logic or UI pattern

Keep in `pages/` when:
- Page-specific
- Only used once
- Tightly coupled to page state
