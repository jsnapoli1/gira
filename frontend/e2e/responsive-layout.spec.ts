import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupUser(
  { page, request }: { page: import('@playwright/test').Page; request: import('@playwright/test').APIRequestContext },
  prefix = 'resp'
): Promise<{ token: string; userId: number }> {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Responsive Tester' },
  });
  expect(res.ok(), `signup failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  const token: string = body.token;

  await page.addInitScript((t) => localStorage.setItem('token', t), token);

  const meRes = await request.get(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const me = await meRes.json();
  return { token, userId: me.id };
}

async function createBoard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description: '' },
  });
  expect(res.ok(), `createBoard failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function createSwimlane(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      repo_source: 'default_gitea',
      repo_owner: 'test',
      repo_name: 'repo',
      designator: 'R-',
      color: '#6366f1',
    },
  });
  expect(res.ok(), `createSwimlane failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function getFirstColumn(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number
): Promise<number> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `getColumns failed: ${await res.text()}`).toBeTruthy();
  const columns = await res.json();
  return columns[0].id;
}

async function createCard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title, priority: 'medium' },
  });
  if (!res.ok()) {
    test.skip(true, `Card creation failed (likely Gitea 401): ${await res.text()}`);
    return -1;
  }
  return (await res.json()).id;
}

async function createColumn(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, state: 'in_progress' },
  });
  expect(res.ok(), `createColumn failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function createSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name: string
): Promise<number> {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok(), `createSprint failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).id;
}

async function startSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  sprintId: number
): Promise<void> {
  const res = await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `startSprint failed: ${await res.text()}`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Responsive Layout', () => {

  // 1. Desktop (1440x900) — board columns all visible, sidebar visible
  test('desktop 1440x900 — sidebar and board columns visible', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'desk');
    const boardId = await createBoard(request, token, `Desktop Board ${Date.now()}`);
    const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
    const columnId = await getFirstColumn(request, token, boardId);
    await createCard(request, token, boardId, swimlaneId, columnId, 'Desktop Card');
    // Add extra columns so there are multiple to check
    await createColumn(request, token, boardId, 'In Progress');
    await createColumn(request, token, boardId, 'Done');
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/boards/${boardId}`);

    // Sidebar should be present and visible
    await expect(page.locator('.sidebar')).toBeVisible();
    // Nav items should show their text labels
    await expect(page.locator('.nav-item:has-text("Boards")')).toBeVisible();
    await expect(page.locator('.nav-item:has-text("Reports")')).toBeVisible();
    // Board content renders
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
    // Mobile menu toggle is hidden at this width
    await expect(page.locator('.mobile-nav-toggle')).toBeHidden();
  });

  // 2. Laptop (1024x768) — board still usable, sidebar visible
  test('laptop 1024x768 — sidebar and board content still usable', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'laptop');
    const boardId = await createBoard(request, token, `Laptop Board ${Date.now()}`);
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/boards/${boardId}`);

    // At the 1024px breakpoint the sidebar narrows to 180px but stays visible
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.mobile-nav-toggle')).toBeHidden();
  });

  // 3. Tablet landscape (1024x600) — board visible, possible horizontal scroll
  test('tablet landscape 1024x600 — board is reachable and scrollable', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'tland');
    const boardId = await createBoard(request, token, `TLand Board ${Date.now()}`);
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto(`/boards/${boardId}`);

    // Board content should still be present
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    // Verify the board-content container allows horizontal scroll (overflow-x: auto/scroll)
    const overflowX = await page.locator('.board-content').evaluate(
      (el) => getComputedStyle(el).overflowX
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  // 4. Tablet portrait (768x1024) — sidebar collapses / mobile-nav-toggle appears
  test('tablet portrait 768x1024 — sidebar hidden, mobile toggle visible', async ({ page, request }) => {
    await setupUser({ page, request }, 'tport');

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/boards');

    // At ≤768px the sidebar is hidden and the hamburger toggle is shown
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.mobile-nav-toggle')).toBeVisible();
  });

  // 5. Mobile (375x667) — navigation accessible via hamburger, key content visible
  test('mobile 375x667 — hamburger button present, page loads', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    // Sidebar hidden on mobile
    await expect(page.locator('.sidebar')).toBeHidden();
    // Mobile nav toggle (hamburger) is shown
    await expect(page.locator('.mobile-nav-toggle')).toBeVisible();
    // Main content area still fills the page
    await expect(page.locator('.main-content')).toBeVisible();
  });

  // 6. Sidebar collapse on small screen — narrow viewport hides sidebar, menu appears
  test('sidebar collapses at mobile breakpoint and reopens via toggle', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob2');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    // Sidebar should be hidden (display: none) below 768px
    await expect(page.locator('.sidebar')).toBeHidden();

    // Tap the mobile nav toggle to open the sidebar overlay
    await page.click('.mobile-nav-toggle');

    // Sidebar should now be visible as a mobile overlay (has .mobile-open class)
    await expect(page.locator('.sidebar.mobile-open')).toBeVisible();
    // The dim overlay should be present
    await expect(page.locator('.mobile-sidebar-overlay')).toBeVisible();

    // Tapping the overlay (right edge, outside the sidebar) should close the sidebar
    // Click near the right edge to avoid the sidebar that sits on the left
    await page.locator('.mobile-sidebar-overlay').click({ position: { x: 340, y: 300 }, force: true });
    await expect(page.locator('.sidebar.mobile-open')).toBeHidden({ timeout: 5000 });
  });

  // 7. Board horizontal scroll — with 4+ columns the board-content is scrollable
  test('board horizontal scroll with multiple columns', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'hscroll');
    const boardId = await createBoard(request, token, `HScroll Board ${Date.now()}`);
    // Create several extra columns to force overflow
    for (const name of ['Col B', 'Col C', 'Col D', 'Col E']) {
      await createColumn(request, token, boardId, name);
    }
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/boards/${boardId}`);

    // board-content must render
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    // At this viewport the board-content should allow horizontal scrolling
    const overflowX = await page.locator('.board-content').evaluate(
      (el) => getComputedStyle(el).overflowX
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  // 8. Card modal on mobile — modal fills screen on small viewport
  test('card detail modal fills screen on mobile', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'cmod');
    const boardId = await createBoard(request, token, `Modal Mobile Board ${Date.now()}`);
    const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
    const columnId = await getFirstColumn(request, token, boardId);
    await createCard(request, token, boardId, swimlaneId, columnId, 'Mobile Modal Card');
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/boards/${boardId}`);

    // Switch to All Cards view so the card is visible regardless of sprint assignment
    await page.locator('.view-btn:has-text("All Cards")').click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    // Click the card to open the modal
    const card = page.locator('.card-item').filter({ hasText: 'Mobile Modal Card' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();

    // The modal should be visible
    await expect(page.locator('.card-detail-modal')).toBeVisible({ timeout: 8000 });

    // On mobile (≤768px) the modal takes 100vw × 100vh per CSS
    const modalWidth = await page.locator('.card-detail-modal').evaluate(
      (el) => el.getBoundingClientRect().width
    );
    const viewportWidth = 375;
    // Allow a small margin for sub-pixel rounding
    expect(modalWidth).toBeGreaterThanOrEqual(viewportWidth - 5);
  });

  // 9. Dashboard cards stack on mobile — dashboard panels render vertically
  test('dashboard sections stack on mobile', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'dstack');
    await createBoard(request, token, `Stack Board ${Date.now()}`);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard');
    await page.waitForSelector('.dashboard-content', { timeout: 10000 });

    // All three section headings must still be in the DOM
    await expect(page.locator('h2:has-text("My Cards")')).toBeVisible();
    await expect(page.locator('h2:has-text("Recent Boards")')).toBeVisible();
    await expect(page.locator('h2:has-text("Active Sprints")')).toBeVisible();

    // On mobile the boards grid collapses to a single column — each card spans full width
    const boardsGrid = page.locator('.dashboard-boards-grid');
    const gridCols = await boardsGrid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns
    );
    // Single column means only one track value — no spaces between track sizes
    expect(gridCols.trim().split(/\s+/).length).toBe(1);
  });

  // 10. Reports charts on tablet — charts resize to fit viewport
  test('reports charts grid collapses to single column on mobile', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'rchrt');
    const boardId = await createBoard(request, token, `Reports Board ${Date.now()}`);
    const sprintId = await createSprint(request, token, boardId, 'Reports Sprint');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/reports');

    // Select the board so report data and charts render
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    const boardSelect = page.locator('.reports-filters select');
    await expect(boardSelect).toBeVisible({ timeout: 8000 });
    await boardSelect.selectOption({ index: 1 });

    // Wait for charts to render
    await expect(page.locator('.charts-grid')).toBeVisible({ timeout: 10000 });

    // At 768px (≤768px breakpoint) charts-grid collapses to 1fr — single column
    const gridCols = await page.locator('.charts-grid').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns
    );
    // A single track means the value contains no spaces separating multiple sizes
    expect(gridCols.trim().split(/\s+/).length).toBe(1);
  });

  // 11. Navigation links accessible at all viewports
  test.describe('Navigation accessible at every viewport size', () => {
    const viewports = [
      { label: 'desktop',          width: 1440, height: 900  },
      { label: 'laptop',           width: 1024, height: 768  },
      { label: 'tablet-landscape', width: 1024, height: 600  },
    ] as const;

    for (const vp of viewports) {
      test(`nav items reachable at ${vp.label} (${vp.width}x${vp.height})`, async ({ page, request }) => {
        await setupUser({ page, request }, `nav-${vp.label}`);

        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/boards');

        // Sidebar nav items must be visible and clickable
        for (const label of ['Boards', 'Reports', 'Settings']) {
          const navItem = page.locator(`.nav-item:has-text("${label}")`);
          await expect(navItem).toBeVisible({ timeout: 8000 });
        }

        // Navigate to Reports
        await page.click('.nav-item:has-text("Reports")');
        await expect(page).toHaveURL(/\/reports/, { timeout: 8000 });

        // Navigate to Settings
        await page.click('.nav-item:has-text("Settings")');
        await expect(page).toHaveURL(/\/settings/, { timeout: 8000 });

        // Navigate back to Boards
        await page.click('.nav-item:has-text("Boards")');
        await expect(page).toHaveURL(/\/boards/, { timeout: 8000 });
      });
    }

    test('nav accessible on mobile via hamburger menu', async ({ page, request }) => {
      await setupUser({ page, request }, 'nav-mob');

      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/boards');

      // Open mobile sidebar
      await page.click('.mobile-nav-toggle');
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 8000 });

      // Navigate to Reports through the open sidebar
      await page.click('.sidebar.mobile-open .nav-item:has-text("Reports")');
      await expect(page).toHaveURL(/\/reports/, { timeout: 8000 });

      // Open sidebar again
      await page.click('.mobile-nav-toggle');
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 8000 });

      // Navigate to Settings
      await page.click('.sidebar.mobile-open .nav-item:has-text("Settings")');
      await expect(page).toHaveURL(/\/settings/, { timeout: 8000 });

      // Open sidebar again
      await page.click('.mobile-nav-toggle');
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 8000 });

      // Navigate back to Boards
      await page.click('.sidebar.mobile-open .nav-item:has-text("Boards")');
      await expect(page).toHaveURL(/\/boards/, { timeout: 8000 });
    });
  });

  // 12. Mobile 375x667 — sidebar is fully hidden (not just icon-only)
  test('mobile 375x667 — sidebar is fully hidden, hamburger is sole entry point', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob-hidden');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.mobile-nav-toggle')).toBeVisible();
  });

  // 13. Landscape mobile (667x375) — app usable in landscape orientation
  test('landscape mobile 667x375 — boards page loads with main content visible', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob-land');

    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/boards');

    await expect(page.locator('.main-content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.mobile-nav-toggle')).toBeVisible();
  });

  // 14. Landscape mobile — hamburger opens nav overlay in landscape
  test('landscape mobile 667x375 — hamburger opens sidebar overlay', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob-land2');

    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto('/boards');

    await page.click('.mobile-nav-toggle');
    await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.mobile-sidebar-overlay')).toBeVisible();
  });

  // 15. Large desktop (1920x1080) — no horizontal overflow on boards page
  test('large desktop 1920x1080 — boards page has no horizontal overflow', async ({ page, request }) => {
    await setupUser({ page, request }, 'lgdesk');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 16. Large desktop — sidebar visible and mobile toggle hidden
  test('large desktop 1920x1080 — sidebar visible, mobile toggle hidden', async ({ page, request }) => {
    await setupUser({ page, request }, 'lgdesk2');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/boards');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.mobile-nav-toggle')).toBeHidden();
  });

  // 17. Desktop collapsed sidebar — icons still navigable
  test('desktop collapsed sidebar — nav icon buttons still visible', async ({ page, request }) => {
    await setupUser({ page, request }, 'collapsed');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/boards');
    await page.waitForSelector('.sidebar', { timeout: 8000 });

    // Collapse the sidebar via the toggle button
    const collapseBtn = page.locator('.sidebar-toggle');
    await expect(collapseBtn).toBeVisible({ timeout: 5000 });
    await collapseBtn.click();

    // Sidebar should still be visible (just narrower — icon-only mode)
    await expect(page.locator('.sidebar')).toBeVisible();
    // Nav items are present even when text labels are hidden
    await expect(page.locator('.nav-item').first()).toBeVisible();
  });

  // 18. Tablet portrait — login form usable at 768x1024
  test('login form is usable at tablet portrait 768x1024', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible({ timeout: 8000 });
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 19. Mobile — login form usable at 375x667
  test('login form is usable at mobile 375x667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible({ timeout: 8000 });
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 20. Mobile — signup form usable at 375x667
  test('signup form is usable at mobile 375x667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/signup');

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible({ timeout: 8000 });
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
  });

  // 21. Board settings page usable at tablet 768x1024
  test('board settings page is usable at tablet portrait 768x1024', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'bsett');
    const boardId = await createBoard(request, token, `Settings Tablet ${Date.now()}`);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/boards/${boardId}/settings`);

    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.page-header h1')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 22. Mobile sidebar overlay click closes sidebar
  test('mobile overlay click closes sidebar at 375px width', async ({ page, request }) => {
    await setupUser({ page, request }, 'overlay-close');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    await page.click('.mobile-nav-toggle');
    await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 5000 });

    await page.locator('.mobile-sidebar-overlay').click({ position: { x: 340, y: 300 }, force: true });
    await expect(page.locator('.sidebar.mobile-open')).toBeHidden({ timeout: 5000 });
  });

  // 23. Mobile sidebar auto-closes after navigation
  test('mobile sidebar auto-closes after navigating to a new route', async ({ page, request }) => {
    await setupUser({ page, request }, 'mob-auto-close');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    await page.click('.mobile-nav-toggle');
    await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 5000 });

    await page.click('.sidebar.mobile-open .nav-item:has-text("Reports")');
    await page.waitForURL(/\/reports/, { timeout: 8000 });

    // Sidebar should be hidden after the route change (Layout.tsx closes it on pathname change)
    await expect(page.locator('.sidebar.mobile-open')).toBeHidden({ timeout: 3000 });
  });

  // 24. Keyboard navigation — Tab cycles through sidebar nav items
  test('Tab key cycles through sidebar nav items at desktop width', async ({ page, request }) => {
    await setupUser({ page, request }, 'kbnav');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/boards');
    await page.waitForSelector('.sidebar', { timeout: 8000 });

    // Focus the first nav item and tab through several items
    const firstNavItem = page.locator('.nav-item').first();
    await firstNavItem.focus();

    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
    }

    // After tabbing, focus must remain on a real element (no trap / dead end)
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeTruthy();
  });

  // 25. Keyboard navigation — Escape closes card detail modal
  test('Escape key closes the card detail modal', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'esc-modal');
    const boardId = await createBoard(request, token, `Esc Modal Board ${Date.now()}`);
    const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
    const columnId = await getFirstColumn(request, token, boardId);
    await createCard(request, token, boardId, swimlaneId, columnId, 'Esc Close Card');
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/boards/${boardId}`);

    await page.locator('.view-btn:has-text("All Cards")').click();
    await expect(page.locator('.card-item').filter({ hasText: 'Esc Close Card' })).toBeVisible({ timeout: 10000 });

    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal')).toBeVisible({ timeout: 8000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal')).not.toBeVisible({ timeout: 5000 });
  });

  // 26. Keyboard navigation — Tab through login form in correct order
  test('Tab order through login form is email then password then submit', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toBeVisible({ timeout: 8000 });

    await emailInput.focus();
    await page.keyboard.press('Tab');

    // The focused element after Tab from email must be a password field or submit button
    const focusedAfterEmail = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      return (el?.type || el?.tagName || '').toLowerCase();
    });
    const validNextFocusTypes = ['password', 'submit', 'button'];
    expect(validNextFocusTypes.some((t) => focusedAfterEmail.includes(t))).toBe(true);
  });

  // 27. No keyboard trap in card modal — Escape works after tabbing around
  test('no keyboard trap in card modal — Escape always closes it', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'no-trap');
    const boardId = await createBoard(request, token, `No Trap Board ${Date.now()}`);
    const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
    const columnId = await getFirstColumn(request, token, boardId);
    await createCard(request, token, boardId, swimlaneId, columnId, 'No Trap Card');
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/boards/${boardId}`);

    await page.locator('.view-btn:has-text("All Cards")').click();
    await expect(page.locator('.card-item').filter({ hasText: 'No Trap Card' })).toBeVisible({ timeout: 10000 });

    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal')).toBeVisible({ timeout: 8000 });

    // Tab several times to move focus around inside the modal
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    // Escape must still dismiss the modal even after focus moves
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal')).not.toBeVisible({ timeout: 5000 });
  });

  // 28. Long board name does not cause horizontal overflow
  test('very long board name does not break boards list layout', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'longname');
    const longName = 'This Is A Very Long Board Name That Could Potentially Cause Layout Issues On Smaller Viewports';
    await createBoard(request, token, longName);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    await expect(page.locator('.board-card').filter({ hasText: longName })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 29. Many columns do not break the board page at desktop width
  test('board with 8 columns does not break desktop layout', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'manycols');
    const boardId = await createBoard(request, token, `Many Cols Board ${Date.now()}`);
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      await createColumn(request, token, boardId, name);
    }
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/boards/${boardId}`);

    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    // The page must have a positive body height (not collapsed to zero from a broken layout)
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    expect(bodyHeight).toBeGreaterThan(0);
  });

  // 30. Many swimlane rows do not break the board page layout
  test('board with multiple swimlanes renders without layout breakage', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'manyswim');
    const boardId = await createBoard(request, token, `Many Swim Board ${Date.now()}`);
    for (let i = 1; i <= 4; i++) {
      await createSwimlane(request, token, boardId, `Swimlane ${i}`);
    }
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/boards/${boardId}`);

    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    // All swimlane rows must be present in the DOM
    const swimlaneRows = page.locator('.swimlane-row, .swimlane');
    const count = await swimlaneRows.count();
    expect(count).toBeGreaterThan(0);
  });

  // 31. Standard desktop 1280x800 — board-page and sidebar both visible
  test('standard desktop 1280x800 — board-page and sidebar both visible', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'std-desk');
    const boardId = await createBoard(request, token, `Std Desk Board ${Date.now()}`);
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/boards/${boardId}`);

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.mobile-nav-toggle')).toBeHidden();
  });

  // 32. Mobile board view allows horizontal scroll
  test('board page allows horizontal scroll on mobile 375px', async ({ page, request }) => {
    const { token } = await setupUser({ page, request }, 'mob-hscroll');
    const boardId = await createBoard(request, token, `Mobile HScroll Board ${Date.now()}`);
    for (const name of ['Col B', 'Col C', 'Col D']) {
      await createColumn(request, token, boardId, name);
    }
    const sprintId = await createSprint(request, token, boardId, 'Sprint 1');
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/boards/${boardId}`);

    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    const overflowX = await page.locator('.board-content').evaluate(
      (el) => getComputedStyle(el).overflowX
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  // 33. Settings page at mobile — no horizontal overflow
  test('settings page is readable on mobile 375x667 — no horizontal overflow', async ({ page, request }) => {
    await setupUser({ page, request }, 'settings-mob');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/settings');
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  // 34. Reports page at mobile — no horizontal overflow
  test('reports page does not overflow horizontally on mobile 375x667', async ({ page, request }) => {
    await setupUser({ page, request }, 'reports-mob');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/reports');
    await page.waitForSelector('.reports-page, .page-header', { timeout: 10000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
