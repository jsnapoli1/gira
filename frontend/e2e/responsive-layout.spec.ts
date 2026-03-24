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
  expect(res.ok(), `createCard failed: ${await res.text()}`).toBeTruthy();
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

    // Tapping the overlay should close the sidebar
    await page.click('.mobile-sidebar-overlay');
    await expect(page.locator('.sidebar.mobile-open')).toBeHidden();
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
});
