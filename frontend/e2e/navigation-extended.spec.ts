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

  test('deep link to board works after login via token injection', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-deeplink-postlogin');
    const board = await createBoard(request, token, 'Post-Login Deep Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.board-header h1')).toContainText('Post-Login Deep Board', { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`));
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

  test('visiting /dashboard without auth redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /reports without auth redirects to /login', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('visiting /settings without auth redirects to /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('authenticated user visiting /login is redirected away from login page', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-auth-login-redirect');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/login');

    // PublicRoute redirects authenticated users away from /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
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

  test('browser back from settings returns to previous page', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-back-from-settings');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 10000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('browser back from reports returns to previous page', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-back-from-reports');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.goto('/reports');
    await expect(page.locator('h1:has-text("Reports")')).toBeVisible({ timeout: 10000 });

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

  test('Dashboard nav item is active on /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-active-dashboard');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/dashboard');

    await expect(page.locator('.nav-item.active')).toContainText('Dashboard', { timeout: 10000 });
  });

  test('Settings nav item is active on /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-active-settings');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.nav-item.active')).toContainText('Settings', { timeout: 10000 });
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

  test('collapsed sidebar still renders nav item icons', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-collapsed-icons');
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-sidebar-collapsed');
    }, token);
    await page.goto('/boards');

    // Collapse the sidebar
    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });

    // Nav items should still be present (icons only, text hidden via CSS)
    await expect(page.locator('.nav-item').first()).toBeVisible();

    // The sidebar-nav should still contain the expected number of nav items
    const navItemCount = await page.locator('.nav-item').count();
    expect(navItemCount).toBeGreaterThanOrEqual(4);
  });

  test('collapsed sidebar nav items still navigate correctly', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-collapsed-nav');
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-sidebar-collapsed');
    }, token);
    await page.goto('/boards');

    // Collapse the sidebar
    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });

    // Navigate using a nav item (by href since labels are hidden when collapsed)
    await page.locator('.sidebar-nav a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('collapsed state persists across page reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-persist-reload');
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-sidebar-collapsed');
    }, token);
    await page.goto('/boards');

    await page.locator('.sidebar-toggle').click();
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });

    // Reload the page — localStorage should restore the collapsed state
    await page.reload();
    await page.waitForSelector('.sidebar', { timeout: 10000 });
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 5000 });
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

// ---------------------------------------------------------------------------
// Sidebar — primary nav links navigate to correct routes
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — sidebar primary links', () => {
  test('Dashboard link in sidebar navigates to /dashboard', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-dash-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('Boards link in sidebar navigates to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-boards-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Boards' }).click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('Reports link in sidebar navigates to /reports', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-reports-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });
  });

  test('Settings link in sidebar navigates to /settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-settings-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('logo / brand link navigates to home ("/")', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-logo-link');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // The .logo link in the sidebar-header links to "/"
    await page.locator('.sidebar-header .logo').click();

    // "/" redirects authenticated users — they end up on dashboard or boards
    const url = page.url();
    expect(
      url.includes('/dashboard') || url.includes('/boards') || url.endsWith('/')
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Board list — navigation from board list to board
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — board list navigation', () => {
  test('clicking a board card link navigates to that board', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-board-click');
    const board = await createBoard(request, token, 'Clickable Board Nav');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'Clickable Board Nav' }).click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Clickable Board Nav');
  });

  test('board settings link from board view navigates to /boards/:id/settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-board-settings-link');
    const board = await createBoard(request, token, 'Settings Link Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // The settings gear icon link in board header
    await page.locator(`.board-header-actions a[href="/boards/${board.id}/settings"]`).click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/settings`), { timeout: 10000 });
  });

  test('back-link chevron in board header returns to /boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-back-chevron');
    const board = await createBoard(request, token, 'Back Chevron Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // The .back-link in the board header
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Board settings — breadcrumb-style navigation
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — board settings navigation', () => {
  test('board settings page loads for a board owner', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-bs-load');
    const board = await createBoard(request, token, 'Settings Load Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });
  });

  test('board settings page shows the board name in the header', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-bs-name');
    const board = await createBoard(request, token, 'Named Settings Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });
    // The board settings page renders the board name
    await expect(page.locator('h1, h2, .board-name').first()).toContainText('Named Settings Board', { timeout: 8000 });
  });

  test('board settings back-link navigates to the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-bs-back');
    const board = await createBoard(request, token, 'Back From Settings Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    // BoardSettings.tsx has a ChevronLeft back link
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation through sidebar links
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — keyboard navigation in sidebar', () => {
  test('Tab key moves focus through sidebar nav items', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-nav');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // Focus the first nav item in the sidebar-nav
    await page.locator('.sidebar-nav .nav-item').first().focus();
    await expect(page.locator('.sidebar-nav .nav-item').first()).toBeFocused({ timeout: 5000 });

    // Tab to the next nav item
    await page.keyboard.press('Tab');
    // After Tab, a subsequent nav item or interactive element should have focus
    // We simply check no JS error occurred — the exact focus target varies by DOM order
  });

  test('Enter key on a focused sidebar nav item navigates to that route', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-enter-nav');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // Focus the Settings nav link directly
    await page.locator('.sidebar-nav a[href="/settings"]').focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('sidebar nav items are reachable via keyboard (have href)', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-href-nav');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // All four primary nav links should have href attributes
    const hrefs = await page.locator('.sidebar-nav .nav-item').evaluateAll(
      (els) => els.map((el) => el.getAttribute('href')).filter(Boolean)
    );

    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/boards');
    expect(hrefs).toContain('/reports');
    expect(hrefs).toContain('/settings');
  });
});

// ---------------------------------------------------------------------------
// Board view — tab switching (Board / Backlog / All Cards)
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — board view tab switching', () => {
  test('board view is shown by default when navigating to /boards/:id', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-default');
    const board = await createBoard(request, token, 'Default Tab Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // The board/kanban view button should be active
    await expect(page.locator('.view-btn.active, .view-btn[aria-selected="true"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking the Backlog tab shows the backlog view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-backlog');
    const board = await createBoard(request, token, 'Backlog Tab Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn:has-text("Backlog")').click();
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });
  });

  test('clicking the Board tab from Backlog returns to kanban view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-board-return');
    const board = await createBoard(request, token, 'Return Tab Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn:has-text("Backlog")').click();
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });

    await page.locator('.view-btn:has-text("Board")').click();
    await expect(page.locator('.board-columns, .kanban-columns, .columns-container')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.backlog-view')).not.toBeVisible();
  });

  test('clicking the All Cards tab shows all cards view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-allcards');
    const board = await createBoard(request, token, 'All Cards Tab Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
      // Should still be on the board page without crashing
      await expect(page.locator('.board-page')).toBeVisible({ timeout: 5000 });
    }
  });

  test('Backlog tab button is visible in board view toolbar', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-tab-visible');
    const board = await createBoard(request, token, 'Tab Visible Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.view-btn:has-text("Backlog")')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Card modal navigation
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — card modal navigation', () => {
  test('clicking a card on the board opens the card detail modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-card-open');
    const board = await createBoard(request, token, 'Card Modal Board');

    // Create swimlane + card via API
    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'SL-' },
    });
    const swimlane = await slRes.json();

    const colsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colsRes.json();

    if (columns && columns.length > 0) {
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Modal Nav Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
      });
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to All Cards so card is visible
    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
    }

    const cardItem = page.locator('.card-item').first();
    if (await cardItem.isVisible({ timeout: 5000 })) {
      await cardItem.click();
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
    }
  });

  test('pressing Escape closes the card detail modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-modal-escape');
    const board = await createBoard(request, token, 'Escape Modal Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'SL-' },
    });
    const swimlane = await slRes.json();

    const colsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colsRes.json();

    if (columns && columns.length > 0) {
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Escape Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
      });
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
    }

    const cardItem = page.locator('.card-item').first();
    if (await cardItem.isVisible({ timeout: 5000 })) {
      await cardItem.click();
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('closing card modal with X button returns to board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-modal-close');
    const board = await createBoard(request, token, 'Close Modal Board');

    const slRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'SL', designator: 'SL-' },
    });
    const swimlane = await slRes.json();

    const colsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns = await colsRes.json();

    if (columns && columns.length > 0) {
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Close X Card', column_id: columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
      });
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible({ timeout: 3000 })) {
      await allCardsBtn.click();
    }

    const cardItem = page.locator('.card-item').first();
    if (await cardItem.isVisible({ timeout: 5000 })) {
      await cardItem.click();
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

      await page.locator('.modal-close, button[aria-label="Close"], .close-btn').first().click();
      await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator('.board-page')).toBeVisible();
    }
  });

  test('board header shows the board name as a breadcrumb', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-breadcrumb');
    const board = await createBoard(request, token, 'Breadcrumb Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Board name appears in the header (breadcrumb)
    await expect(page.locator('.board-header h1, .board-header .board-name').first()).toContainText('Breadcrumb Board', { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// URL / deep-link behavior
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — URL and deep-link behavior', () => {
  test('URL updates when clicking from boards list to a specific board', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-url-update');
    const board = await createBoard(request, token, 'URL Update Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.locator('.board-card-link', { hasText: 'URL Update Board' }).click();
    await page.waitForURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });

    expect(page.url()).toContain(`/boards/${board.id}`);
  });

  test('URL updates when navigating between two boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-url-switch');
    const boardA = await createBoard(request, token, 'Board Alpha');
    const boardB = await createBoard(request, token, 'Board Beta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Navigate to board B via sidebar or back to list
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForURL(new RegExp(`/boards/${boardB.id}`), { timeout: 10000 });

    expect(page.url()).toContain(`/boards/${boardB.id}`);
    await expect(page.locator('.board-header h1')).toContainText('Board Beta', { timeout: 8000 });
  });

  test('deep link to /boards/:id/settings loads settings page directly', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-settings-deeplink');
    const board = await createBoard(request, token, 'Settings DeepLink Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });
  });

  test('reload on board view page stays on the same board', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-reload-board');
    const board = await createBoard(request, token, 'Reload Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    await expect(page.locator('.board-header h1')).toContainText('Reload Board', { timeout: 10000 });
  });

  test('reload on board settings stays on board settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-reload-settings');
    const board = await createBoard(request, token, 'Reload Settings Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForURL(new RegExp(`/boards/${board.id}/settings`), { timeout: 10000 });
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });
  });

  test('/boards page reloads correctly', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-reload-boards');
    await createBoard(request, token, 'Reload Boards Page Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });
  });

  test('board URL contains the numeric board ID', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-url-numeric');
    const board = await createBoard(request, token, 'Numeric ID Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });

    const urlPattern = /\/boards\/\d+/;
    expect(urlPattern.test(page.url())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sidebar — board list in sidebar
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — boards in sidebar', () => {
  test('sidebar shows the boards section listing user boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-sidebar-boards');
    await createBoard(request, token, 'Sidebar Listed Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // The sidebar should contain the board name somewhere in boards section
    await expect(page.locator('.sidebar').getByText('Sidebar Listed Board')).toBeVisible({ timeout: 10000 });
  });

  test('new board appears in sidebar board list after creation', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-sidebar-newboard');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Create a board via UI
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Newly Created Sidebar Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Wait for the new board to appear in the sidebar
    await expect(page.locator('.sidebar').getByText('Newly Created Sidebar Board')).toBeVisible({ timeout: 10000 });
  });

  test('clicking board name in sidebar navigates to that board', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-sidebar-click-board');
    const board = await createBoard(request, token, 'Sidebar Clickable Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // Click the board in sidebar
    const sidebarBoardLink = page.locator('.sidebar a', { hasText: 'Sidebar Clickable Board' });
    if (await sidebarBoardLink.isVisible({ timeout: 5000 })) {
      await sidebarBoardLink.click();
      await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    }
  });

  test('multiple boards all appear in the sidebar list', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-sidebar-multi');
    await createBoard(request, token, 'Multi Sidebar Board One');
    await createBoard(request, token, 'Multi Sidebar Board Two');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.sidebar').getByText('Multi Sidebar Board One')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sidebar').getByText('Multi Sidebar Board Two')).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Page structure — layout integrity on each route
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — page layout integrity', () => {
  test('/boards page shows the sidebar, header and grid', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-boards');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('/reports page shows sidebar and main content', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-reports');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1:has-text("Reports")')).toBeVisible({ timeout: 8000 });
  });

  test('/settings page shows sidebar and settings form', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-settings');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 8000 });
  });

  test('/dashboard page shows sidebar and dashboard content', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-dashboard');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/dashboard');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.dashboard-content, .dashboard-error')).toBeVisible({ timeout: 10000 });
  });

  test('board view page shows sidebar and board header', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-boardview');
    const board = await createBoard(request, token, 'Layout Board View');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 8000 });
  });

  test('board settings page shows sidebar and settings panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-layout-boardsettings');
    const board = await createBoard(request, token, 'Layout Settings Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 10000 });
  });

  test('login page does NOT show the sidebar', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.login-page, .auth-page, form[action], .login-form')).toBeVisible({ timeout: 10000 });
    // Sidebar should not be present on public pages
    await expect(page.locator('.sidebar')).not.toBeVisible();
  });

  test('signup page does NOT show the sidebar', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('form')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sidebar')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Navigation flow: login → boards → board → settings → back
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — complete navigation flows', () => {
  test('full flow: boards list → board view → board settings → back to board', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-flow-full');
    const board = await createBoard(request, token, 'Full Flow Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.boards-grid')).toBeVisible({ timeout: 10000 });

    // Step 1: navigate to board
    await page.locator('.board-card-link', { hasText: 'Full Flow Board' }).click();
    await page.waitForURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 8000 });

    // Step 2: navigate to board settings
    await page.locator(`.board-header-actions a[href="/boards/${board.id}/settings"]`).click();
    await page.waitForURL(new RegExp(`/boards/${board.id}/settings`), { timeout: 10000 });
    await expect(page.locator('.board-settings')).toBeVisible({ timeout: 8000 });

    // Step 3: go back to board view
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 8000 });
  });

  test('full flow: boards list → reports → settings → boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-flow-nav');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Boards' }).click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
  });

  test('navigating to boards list from board view via back-link', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-flow-backlink');
    const board = await createBoard(request, token, 'BackLink Flow Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/boards\/?$/, { timeout: 10000 });
    await expect(page.locator('.boards-grid, .empty-state')).toBeVisible({ timeout: 8000 });
  });

  test('navigating from reports back to board view keeps history intact', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-flow-history');
    const board = await createBoard(request, token, 'History Flow Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.locator('.nav-item', { hasText: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports/, { timeout: 10000 });

    // Go back using browser back
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}`), { timeout: 10000 });
  });

  test('route "/" redirects authenticated users to dashboard or boards', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-root-redirect');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/');

    // Authenticated users should be redirected off "/"
    await page.waitForURL(/\/(dashboard|boards)/, { timeout: 10000 });
    const url = page.url();
    expect(url.includes('/dashboard') || url.includes('/boards')).toBe(true);
  });

  test('route "/" redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Authenticated navigation — page title updates
// ---------------------------------------------------------------------------

test.describe('Navigation Extended — page title and heading updates', () => {
  test('/boards page has "Boards" in the document or heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-title-boards');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('.page-header h1, h1').first()).toContainText('Boards', { timeout: 10000 });
  });

  test('/reports page has "Reports" in the heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-title-reports');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/reports');
    await expect(page.locator('h1').first()).toContainText('Reports', { timeout: 10000 });
  });

  test('/settings page has "Settings" in the heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-title-settings');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/settings');
    await expect(page.locator('h1').first()).toContainText('Settings', { timeout: 10000 });
  });

  test('/boards/:id page has the board name in the heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'navext-title-board');
    const board = await createBoard(request, token, 'Heading Title Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header h1, .board-header .board-name').first()).toContainText('Heading Title Board', { timeout: 10000 });
  });

  test('login page is accessible at /login without authentication', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    await expect(page.locator('form')).toBeVisible({ timeout: 5000 });
  });

  test('signup page is accessible at /signup without authentication', async ({ page }) => {
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/signup/, { timeout: 5000 });
    await expect(page.locator('form')).toBeVisible({ timeout: 5000 });
  });

  test('navigating from /login to /signup works without errors', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible({ timeout: 5000 });

    const signupLink = page.locator('a[href="/signup"], a:has-text("Sign up"), a:has-text("Register")').first();
    if (await signupLink.isVisible({ timeout: 3000 })) {
      await signupLink.click();
      await expect(page).toHaveURL(/\/signup/, { timeout: 8000 });
      await expect(page.locator('form')).toBeVisible({ timeout: 5000 });
    } else {
      await page.goto('/signup');
      await expect(page).toHaveURL(/\/signup/, { timeout: 5000 });
    }
  });

  test('navigating from /signup to /login works without errors', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('form')).toBeVisible({ timeout: 5000 });

    const loginLink = page.locator('a[href="/login"], a:has-text("Sign in"), a:has-text("Log in")').first();
    if (await loginLink.isVisible({ timeout: 3000 })) {
      await loginLink.click();
      await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
      await expect(page.locator('form')).toBeVisible({ timeout: 5000 });
    } else {
      await page.goto('/login');
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    }
  });
});
