# e2e/ - End-to-End Tests

Playwright tests for the Zira frontend.

## Test Files

| File | Coverage |
|------|----------|
| `auth.spec.ts` | Login, signup flows |
| `boards.spec.ts` | Board CRUD operations |
| `cards.spec.ts` | Card creation, editing, moving |
| `sprints.spec.ts` | Sprint management |
| `reports.spec.ts` | Reports page |
| `settings.spec.ts` | Gitea configuration |
| `navigation.spec.ts` | App navigation, logout |
| `assignees.spec.ts` | Card assignee management |

## Running Tests

```bash
npm test              # Run all tests headless
npm run test:ui       # Interactive UI mode
npm run test:headed   # Run in visible browser
```

## Writing Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Setup - login, navigate, etc.
  });

  test('should do something', async ({ page }) => {
    await page.goto('/boards');
    await page.click('button:has-text("Create")');
    await expect(page.locator('.board-card')).toBeVisible();
  });
});
```

## Best Practices

### Test Structure

- Group related tests with `test.describe`
- Use `test.beforeEach` for common setup
- One assertion focus per test
- Descriptive test names

### Selectors

- Prefer text selectors: `'button:has-text("Save")'`
- Use test IDs for complex elements: `[data-testid="card-1"]`
- Avoid fragile CSS selectors

### Waiting

```typescript
// Wait for element
await expect(page.locator('.card')).toBeVisible();

// Wait for navigation
await page.waitForURL('/boards');

// Wait for network
await page.waitForResponse('/api/boards');
```

### Debugging

```bash
npm run test:headed   # See the browser
npx playwright test --debug  # Step through
```

### Adding New Tests

1. Create `feature.spec.ts`
2. Test happy path first
3. Add error case tests
4. Test edge cases
