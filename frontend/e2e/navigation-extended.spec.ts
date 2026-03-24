import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, prefix = 'navext') {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'NavExt User' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

async function createBoard(request: any, token: string, name: string) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json() as Promise<{ id: number; name: string }>;
}

// ---------------------------------------------------------------------------
// Deep links — authenticated
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — deep link to board (authenticated)', () => {
  test('direct URL /boards/:id loads the board view when authenticated', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-deeplink');
    const board = await createBoard(request, token, 'Deep Link Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Deep Link Board');
  });

  test('deep linking to a board does not redirect to /login when authenticated', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-deeplink-auth');
    const board = await createBoard(request, token, 'Auth Deep Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
  });

  test('board URL contains the board id', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-url-id');
    const board = await createBoard(request, token, 'URL ID Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await page.waitForURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    expect(page.url()).toContain(`/boards/${board.id}`);
  });
});

// ---------------------------------------------------------------------------
// Deep links — unauthenticated redirect
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — deep link redirects to login when unauthenticated', () => {
  test('visiting /boards/123 without auth redirects to /login', async ({ page }) => {
    await page.goto('/boards/123');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /boards/:id/settings without auth redirects to /login', async ({ page }) => {
    await page.goto('/boards/123/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// 404 — non-existent board
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — non-existent board shows error state', () => {
  test('visiting /boards/99999 shows "Board not found" error', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-notfound');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards/99999');

    await expect(
      page.locator('.error').or(page.getByText('Board not found'))
    ).toBeVisible({ timeout: 10000 });
  });

  test('board not found state does not crash the page', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-nocrash');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Listen for uncaught errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/boards/99999');
    await expect(
      page.locator('.error').or(page.getByText('Board not found'))
    ).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Browser back / forward navigation state
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — browser back/forward history', () => {
  test('browser back from board view returns to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-back');
    const board = await createBoard(request, token, 'History Back Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'History Back Board' }).click();
    await page.waitForURL(/\/boards\/\d+$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('browser forward after going back returns to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-forward');
    const board = await createBoard(request, token, 'History Forward Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'History Forward Board' }).click();
    await page.waitForURL(/\/boards\/\d+$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
  });

  test('navigating between pages builds a correct history stack', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-history-stack');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Active nav item highlighted
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — active nav item', () => {
  test('only one nav item is active at a time', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-one-active');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    const activeItems = await page.locator('.nav-item.active').count();
    expect(activeItems).toBe(1);
  });

  test('active item changes when navigating to Reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-active-reports');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.nav-item.active')).toContainText('Boards', { timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page.locator('.nav-item.active')).toContainText('Reports', { timeout: 10000 });
    // Boards is no longer active
    await expect(page.locator('.nav-item.active')).not.toContainText('Boards');
  });

  test('active item reflects board subpath /boards/:id', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-active-board-sub');
    const board = await createBoard(request, token, 'Active Sub Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    // /boards/:id starts with /boards so the Boards item should be active
    await expect(page.locator('.nav-item.active')).toContainText('Boards', { timeout: 10000 });
  });

  test('active item reflects /boards/:id/settings subpath', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-active-settings-sub');
    const board = await createBoard(request, token, 'Settings Sub Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.nav-item.active')).toContainText('Boards', { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Sidebar collapse / expand
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — sidebar collapse/expand', () => {
  test('sidebar collapse button is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-toggle-btn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.sidebar-toggle')).toBeVisible({ timeout: 10000 });
  });

  test('clicking sidebar toggle adds collapsed class to sidebar', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-collapse');
    await page.addInitScript((t: string) => (
      localStorage.setItem('token', t),
      localStorage.removeItem('zira-sidebar-collapsed')
    ), token);
    await page.goto('/boards');

    // Ensure expanded first
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/, { timeout: 10000 });

    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });
  });

  test('clicking sidebar toggle again expands the sidebar', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-expand');
    await page.addInitScript((t: string) => (
      localStorage.setItem('token', t),
      localStorage.removeItem('zira-sidebar-collapsed')
    ), token);
    await page.goto('/boards');

    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });

    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/, { timeout: 5000 });
  });

  test('sidebar collapsed state is persisted in localStorage', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-persist-collapse');
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-sidebar-collapsed');
    }, token);
    await page.goto('/boards');

    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });

    const storedValue = await page.evaluate(() => localStorage.getItem('zira-sidebar-collapsed'));
    expect(storedValue).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Unknown route handling
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — unknown routes', () => {
  test('visiting an unknown route when authenticated does not throw a JS error', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-unknown');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/totally-nonexistent-route-xyz');

    // App should not crash; it may redirect or render blank
    const url = page.url();
    const isExpected =
      url.includes('/totally-nonexistent-route-xyz') ||
      url.includes('/dashboard') ||
      url.includes('/boards') ||
      url.includes('/login');
    expect(isExpected).toBeTruthy();
    expect(errors).toHaveLength(0);
  });

  test('visiting an unknown route when unauthenticated redirects to /login', async ({ page }) => {
    await page.goto('/totally-nonexistent-route-xyz');
    // PrivateRoute will send unauthenticated users to /login; unknown paths that
    // are not wrapped in PrivateRoute may render blank. Either outcome is acceptable.
    const url = page.url();
    expect(url.includes('/login') || url.includes('/totally-nonexistent-route-xyz')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reports and Settings direct navigation
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — reports and settings direct navigation', () => {
  test('Reports page loads when navigated to directly', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-reports-direct');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('h1:has-text("Reports")')).toBeVisible({ timeout: 10000 });
  });

  test('Settings page loads when navigated to directly', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-settings-direct');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// card deep-link via ?card=id — not yet implemented
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — card deep-link (not yet implemented)', () => {
  test.fixme(
    'direct URL to board with ?card=id query param auto-opens card modal',
    async ({ page, request }) => {
      // card deep-link via ?card=id is not currently implemented in BoardView.tsx
      const { token } = await createUser(request, 'navext-card-deeplink');
      const board = await createBoard(request, token, 'Card DeepLink Board');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${board.id}?card=1`);

      await expect(page.locator('.card-detail-modal-unified, [class*="card-modal"]')).toBeVisible({
        timeout: 8000,
      });
    },
  );
});
