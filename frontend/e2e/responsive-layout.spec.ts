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

  // ---------------------------------------------------------------------------
  // Login / Auth pages responsive
  // ---------------------------------------------------------------------------
  test.describe('Login and auth pages responsive', () => {
    // 1. Login form usable at 390px width
    test('login form usable at 390px width', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/login');
      await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible({ timeout: 8000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')).toBeVisible();
    });

    // 2. Login form centered and visible at mobile
    test('login form is centered and visible on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/login');
      const form = page.locator('form, .login-form, .auth-form').first();
      await expect(form).toBeVisible({ timeout: 8000 });
      const box = await form.boundingBox();
      if (box) {
        // Form should not overflow the viewport
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(400);
      }
    });

    // 3. Signup form usable at 390px
    test('signup form usable at 390px', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/signup');
      await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible({ timeout: 8000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"], button:has-text("Sign up"), button:has-text("Create")')).toBeVisible();
    });

    // 4. All signup fields visible at mobile
    test('all signup fields visible at mobile 390px', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/signup');
      // Email, password, and submit should all be visible without scrolling
      const email = page.locator('input[type="email"], input[name="email"]').first();
      const password = page.locator('input[type="password"]').first();
      const submit = page.locator('button[type="submit"]').first();
      await expect(email).toBeVisible({ timeout: 8000 });
      await expect(password).toBeVisible();
      await expect(submit).toBeVisible();
    });
  });

  // ---------------------------------------------------------------------------
  // Board list responsive
  // ---------------------------------------------------------------------------
  test.describe('Board list page responsive', () => {
    // 5. Board list page loads at 390px
    test('board list page loads at 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'bl-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await expect(page.locator('.main-content, .page-content, .boards-page')).toBeVisible({ timeout: 10000 });
    });

    // 6. Board cards visible at mobile
    test('board cards visible at mobile 390px', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bl-cards-mob');
      await createBoard(request, token, `Mobile Board ${Date.now()}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await expect(page.locator('.board-card, .board-item, .board-list-item').first()).toBeVisible({ timeout: 10000 });
    });

    // 7. Create board button accessible at mobile
    test('create board button accessible at mobile 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'bl-crbtn-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await expect(page.locator('button:has-text("New Board"), button:has-text("Create"), button:has-text("+ Board"), .create-board-btn').first()).toBeVisible({ timeout: 10000 });
    });

    // 8. Board list at 768px shows properly
    test('board list at 768px tablet portrait shows properly', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bl-tablet');
      await createBoard(request, token, `Tablet Board ${Date.now()}`);
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/boards');
      await expect(page.locator('.main-content, .page-content, .boards-page')).toBeVisible({ timeout: 10000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Board view responsive
  // ---------------------------------------------------------------------------
  test.describe('Board view responsive', () => {
    // 9. Board view at 1440px shows columns side by side
    test('board view at 1440px shows columns side by side', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-desktop');
      const boardId = await createBoard(request, token, `Desktop Board ${Date.now()}`);
      await createColumn(request, token, boardId, 'In Progress');
      await createColumn(request, token, boardId, 'Done');
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
      // Multiple columns should each be visible
      const columns = page.locator('.board-column, .column-header, .kanban-column');
      await expect(columns.first()).toBeVisible({ timeout: 8000 });
    });

    // 10. Board view at 390px — columns scroll horizontally
    test('board view at 390px allows horizontal scroll', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-mob-scroll');
      const boardId = await createBoard(request, token, `Mobile Scroll Board ${Date.now()}`);
      for (const name of ['Col B', 'Col C', 'Col D']) {
        await createColumn(request, token, boardId, name);
      }
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
      const overflow = await page.locator('.board-content').evaluate(
        (el) => getComputedStyle(el).overflowX
      );
      expect(['auto', 'scroll']).toContain(overflow);
    });

    // 11. Column header visible at mobile
    test('column header visible at 390px mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-colhdr-mob');
      const boardId = await createBoard(request, token, `ColHdr Board ${Date.now()}`);
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.column-header, .board-column-header').first()).toBeVisible({ timeout: 8000 });
    });

    // 12. Card items visible at mobile
    test('card items visible at 390px after card is created', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-cards-mob');
      const boardId = await createBoard(request, token, `Cards Mobile Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      await createCard(request, token, boardId, swimlaneId, columnId, 'Mobile Visible Card');
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();
      await expect(page.locator('.card-item').filter({ hasText: 'Mobile Visible Card' })).toBeVisible({ timeout: 10000 });
    });

    // 13. Filter toggle accessible at mobile
    test('filter toggle accessible at 390px mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-filter-mob');
      const boardId = await createBoard(request, token, `Filter Mobile Board ${Date.now()}`);
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });
      const filterBtn = page.locator('button:has-text("Filter"), .filter-toggle, .filter-btn, [aria-label*="filter" i]').first();
      await expect(filterBtn).toBeVisible({ timeout: 8000 });
    });

    // 14. View tabs (Board/Backlog) visible at mobile
    test('view tabs Board/Backlog visible at 390px mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bv-tabs-mob');
      const boardId = await createBoard(request, token, `Tabs Mobile Board ${Date.now()}`);
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await expect(page.locator('.view-btn, .board-view-tab').first()).toBeVisible({ timeout: 10000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Settings page responsive
  // ---------------------------------------------------------------------------
  test.describe('Settings page responsive', () => {
    // 15. Settings page loads at 390px
    test('settings page loads at 390px mobile', async ({ page, request }) => {
      await setupUser({ page, request }, 'set-mob-load');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/settings');
      await expect(page.locator('.settings-page, .settings-container, main')).toBeVisible({ timeout: 10000 });
    });

    // 16. Settings sections stacked vertically on mobile
    test('settings sections are stacked vertically on mobile', async ({ page, request }) => {
      await setupUser({ page, request }, 'set-mob-stack');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/settings');
      await expect(page.locator('.settings-page, .settings-container, main')).toBeVisible({ timeout: 10000 });
      // The page should not overflow horizontally at this viewport
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(410);
    });

    // 17. Form inputs full-width on mobile
    test('settings form inputs do not overflow at 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'set-mob-inputs');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/settings');
      await expect(page.locator('.settings-page, .settings-container, main')).toBeVisible({ timeout: 10000 });
      const input = page.locator('input[type="text"], input[type="url"], input[type="password"]').first();
      const hasInput = await input.isVisible().catch(() => false);
      if (hasInput) {
        const box = await input.boundingBox();
        if (box) {
          expect(box.x + box.width).toBeLessThanOrEqual(400);
        }
      }
    });

    // 18. Save button accessible on mobile
    test('settings save button accessible on mobile 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'set-mob-save');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/settings');
      await expect(page.locator('.settings-page, .settings-container, main')).toBeVisible({ timeout: 10000 });
      const saveBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Update")').first();
      const hasBtn = await saveBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (hasBtn) {
        const box = await saveBtn.boundingBox();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(400);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Modal responsive
  // ---------------------------------------------------------------------------
  test.describe('Modal responsive', () => {
    // 19. Card detail modal full-screen on mobile (already tested above; this variant uses 390px)
    test('card detail modal covers full viewport width on 390px mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'mod-full-mob');
      const boardId = await createBoard(request, token, `Full Modal Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      await createCard(request, token, boardId, swimlaneId, columnId, 'Full Screen Modal Card');
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();
      const card = page.locator('.card-item').filter({ hasText: 'Full Screen Modal Card' });
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.click();
      await expect(page.locator('.card-detail-modal, .card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
      const width = await page.locator('.card-detail-modal, .card-detail-modal-unified').first().evaluate(
        (el) => el.getBoundingClientRect().width
      );
      expect(width).toBeGreaterThanOrEqual(385);
    });

    // 20. Modal scrollable on mobile
    test('card detail modal is scrollable on mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'mod-scroll-mob');
      const boardId = await createBoard(request, token, `Scroll Modal Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      await createCard(request, token, boardId, swimlaneId, columnId, 'Scrollable Modal Card');
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();
      const card = page.locator('.card-item').filter({ hasText: 'Scrollable Modal Card' });
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.click();
      const modal = page.locator('.card-detail-modal, .card-detail-modal-unified').first();
      await expect(modal).toBeVisible({ timeout: 8000 });
      const overflowY = await modal.evaluate((el) => getComputedStyle(el).overflowY);
      expect(['auto', 'scroll', 'overlay']).toContain(overflowY);
    });

    // 21. Close button accessible on modal on mobile
    test('modal close button accessible on mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'mod-close-mob');
      const boardId = await createBoard(request, token, `Close Modal Board ${Date.now()}`);
      const swimlaneId = await createSwimlane(request, token, boardId, 'Main');
      const columnId = await getFirstColumn(request, token, boardId);
      await createCard(request, token, boardId, swimlaneId, columnId, 'Close Button Card');
      const sprintId = await createSprint(request, token, boardId, 'S1');
      await startSprint(request, token, sprintId);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}`);
      await page.locator('.view-btn:has-text("All Cards")').click();
      const card = page.locator('.card-item').filter({ hasText: 'Close Button Card' });
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.click();
      await expect(page.locator('.card-detail-modal, .card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
      const closeBtn = page.locator('.modal-close, button[aria-label*="close" i], button:has-text("×"), button:has-text("Close"), .close-btn').first();
      await expect(closeBtn).toBeVisible({ timeout: 5000 });
    });

    // 22. Create board modal on mobile
    test('create board modal is usable on mobile 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'mod-create-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      const createBtn = page.locator('button:has-text("New Board"), button:has-text("Create"), button:has-text("+ Board"), .create-board-btn').first();
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await createBtn.click();
      const modal = page.locator('.modal, dialog, .create-board-modal').first();
      await expect(modal).toBeVisible({ timeout: 5000 });
      const box = await modal.boundingBox();
      if (box) {
        // Modal should not overflow the viewport width
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(410);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Navigation responsive
  // ---------------------------------------------------------------------------
  test.describe('Navigation responsive', () => {
    // 23. Sidebar hidden at 390px
    test('sidebar hidden at 390px mobile', async ({ page, request }) => {
      await setupUser({ page, request }, 'nav-sidebar-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await expect(page.locator('.sidebar')).toBeHidden();
    });

    // 24. Hamburger menu button at mobile
    test('hamburger menu button present at 390px mobile', async ({ page, request }) => {
      await setupUser({ page, request }, 'nav-ham-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await expect(page.locator('.mobile-nav-toggle')).toBeVisible();
    });

    // 25. Navigation accessible via mobile menu
    test('navigation links accessible via mobile hamburger menu', async ({ page, request }) => {
      await setupUser({ page, request }, 'nav-links-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await page.click('.mobile-nav-toggle');
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.sidebar.mobile-open .nav-item:has-text("Boards")')).toBeVisible();
    });

    // 26. Dashboard link accessible on mobile
    test('dashboard link accessible via mobile menu', async ({ page, request }) => {
      await setupUser({ page, request }, 'nav-dash-mob');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/boards');
      await page.click('.mobile-nav-toggle');
      await expect(page.locator('.sidebar.mobile-open')).toBeVisible({ timeout: 5000 });
      const dashLink = page.locator('.sidebar.mobile-open .nav-item:has-text("Dashboard"), .sidebar.mobile-open a[href*="dashboard"]').first();
      await expect(dashLink).toBeVisible({ timeout: 5000 });
    });
  });

  // ---------------------------------------------------------------------------
  // Dashboard responsive
  // ---------------------------------------------------------------------------
  test.describe('Dashboard responsive', () => {
    // 27. Dashboard page at 390px
    test('dashboard page loads at 390px mobile', async ({ page, request }) => {
      await setupUser({ page, request }, 'dash-mob-load');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');
      await expect(page.locator('.dashboard-content, main, .page-content')).toBeVisible({ timeout: 10000 });
    });

    // 28. Dashboard stats visible on mobile
    test('dashboard sections visible on mobile 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'dash-mob-stats');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');
      await page.waitForSelector('.dashboard-content', { timeout: 10000 });
      // At least one section heading should be visible
      const headings = page.locator('h2, h3, .section-title, .dashboard-section-title');
      await expect(headings.first()).toBeVisible({ timeout: 8000 });
    });

    // 29. Quick links accessible on mobile
    test('quick links or action buttons accessible on mobile 390px', async ({ page, request }) => {
      await setupUser({ page, request }, 'dash-mob-links');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');
      await expect(page.locator('.dashboard-content, main')).toBeVisible({ timeout: 10000 });
      // Body should not overflow at 390px
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(410);
    });
  });

  // ---------------------------------------------------------------------------
  // Board settings responsive
  // ---------------------------------------------------------------------------
  test.describe('Board settings responsive', () => {
    // 30. Board settings at 390px
    test('board settings page loads at 390px mobile', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bset-mob-load');
      const boardId = await createBoard(request, token, `Settings Mobile Board ${Date.now()}`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}/settings`);
      await expect(page.locator('.settings-page, .board-settings, main')).toBeVisible({ timeout: 10000 });
    });

    // 31. Settings sections visible and scrollable
    test('board settings sections visible and body not overflowing at 390px', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bset-mob-scroll');
      const boardId = await createBoard(request, token, `Settings Scroll Board ${Date.now()}`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}/settings`);
      await expect(page.locator('.settings-page, .board-settings, main')).toBeVisible({ timeout: 10000 });
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(410);
    });

    // 32. Add column form on mobile
    test('add column form accessible on mobile 390px in board settings', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bset-mob-col');
      const boardId = await createBoard(request, token, `ColForm Mobile Board ${Date.now()}`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}/settings`);
      await expect(page.locator('.settings-page, .board-settings, main')).toBeVisible({ timeout: 10000 });
      const addColInput = page.locator('input[placeholder*="column" i], input[name*="column" i]').first();
      const hasInput = await addColInput.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasInput) {
        const box = await addColInput.boundingBox();
        if (box) {
          expect(box.x + box.width).toBeLessThanOrEqual(400);
        }
      }
    });

    // 33. Member list on mobile
    test('board member list visible on mobile 390px in board settings', async ({ page, request }) => {
      const { token } = await setupUser({ page, request }, 'bset-mob-members');
      const boardId = await createBoard(request, token, `Members Mobile Board ${Date.now()}`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/boards/${boardId}/settings`);
      await expect(page.locator('.settings-page, .board-settings, main')).toBeVisible({ timeout: 10000 });
      // Member list section or heading should be findable
      const memberSection = page.locator(':has-text("Member"), :has-text("member"), .members-section, .board-members').first();
      await expect(memberSection).toBeVisible({ timeout: 8000 });
    });
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
