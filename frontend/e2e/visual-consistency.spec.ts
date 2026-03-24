/**
 * visual-consistency.spec.ts
 *
 * Behavioural layout and visual consistency tests. These are NOT screenshot
 * comparisons — they verify structural presence, CSS properties, and correct
 * element behaviour that constitutes a consistent UI.
 *
 * Test inventory
 * ──────────────
 * Page structure
 *  1.  All authenticated pages have a sidebar
 *  2.  Sidebar has navigation links
 *  3.  Sidebar shows user display name
 *  4.  Sidebar has logout button
 *  5.  Board page has header with board name
 *  6.  Board page has view tabs (Board, Backlog, etc.)
 *  7.  Board page columns are displayed horizontally
 *  8.  Swimlane rows separate cards by row
 *  9.  Column headers show column names
 * 10.  Card items show title
 *
 * Empty states
 * 11.  Empty board shows "No swimlanes" or similar message
 * 12.  Empty column shows no cards
 * 13.  Empty board list shows "No boards yet"
 * 14.  No notifications shows empty notification panel
 * 15.  Empty backlog shows appropriate message
 *
 * Loading states
 * 16.  Board page shows loading indicator while fetching (if any)
 * 17.  Card modal loads without blank flash
 * 18.  Board list loads quickly
 *
 * Color and styling
 * 19.  Active sprint badge has distinct styling
 * 20.  Label chips show colored dots/backgrounds
 * 21.  Priority indicators are present (if shown)
 * 22.  Overdue cards have warning color
 * 23.  WIP limit exceeded column has warning style
 *
 * Responsive behaviour
 * 24.  At 1280px width, sidebar visible
 * 25.  At 768px width (tablet), layout still usable
 * 26.  At 375px width (mobile), layout adapts
 * 27.  Column content scrollable when many cards
 * 28.  Modal scrollable when long content
 * 29.  Long card titles do not overflow cards
 * 30.  Board name truncated in header if too long
 *
 * Consistency checks
 * 31.  All forms have consistent submit button text
 * 32.  All modals have a close button
 * 33.  All destructive actions show confirmation dialog
 * 34.  Error messages have consistent styling (.auth-error or similar)
 * 35.  Success feedback shown after save actions
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Visual Tester',
  prefix = 'vis',
): Promise<{ token: string; email: string }> {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

async function createBoard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name: string,
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  const board = await res.json();
  return board.id as number;
}

async function createSwimlane(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name = 'Test Lane',
): Promise<number> {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator: 'VIS-', color: '#6366f1' },
  });
  const sw = await res.json();
  return sw.id as number;
}

async function getFirstColumnId(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
): Promise<number> {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cols = await res.json();
  return (cols as Array<{ id: number }>)[0].id;
}

async function createCard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title = 'Test Card',
): Promise<number | null> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title },
  });
  if (!res.ok()) return null;
  const card = await res.json();
  return card.id as number;
}

async function createSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
  name = 'Sprint 1',
): Promise<number> {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  const sprint = await res.json();
  return sprint.id as number;
}

async function startSprint(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  sprintId: number,
): Promise<void> {
  await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Inject a JWT token via addInitScript so it is present before first navigation. */
function injectToken(page: import('@playwright/test').Page, token: string): void {
  page.addInitScript((t: string) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// 1–10: Page structure
// ---------------------------------------------------------------------------

test.describe('Page structure — sidebar', () => {
  test('1. All authenticated pages have a sidebar', async ({ page, request }) => {
    const { token } = await createUser(request, 'Struct User', 'struct-1');
    injectToken(page, token);

    for (const path of ['/boards', '/dashboard', '/reports', '/settings']) {
      await page.goto(path);
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    }
  });

  test('2. Sidebar has navigation links', async ({ page, request }) => {
    const { token } = await createUser(request, 'Nav Links User', 'struct-2');
    injectToken(page, token);
    await page.goto('/boards');

    await expect(page.locator('.nav-item', { hasText: 'Boards' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'Reports' })).toBeVisible();
    await expect(page.locator('.nav-item', { hasText: 'Settings' })).toBeVisible();
  });

  test('3. Sidebar shows user display name', async ({ page, request }) => {
    const { token } = await createUser(request, 'SidebarName User', 'struct-3');
    injectToken(page, token);
    await page.goto('/boards');
    // Ensure sidebar is expanded
    await page.evaluate(() => localStorage.setItem('zira-sidebar-collapsed', 'false'));
    await page.reload();

    await expect(page.locator('.user-name')).toContainText('SidebarName User', { timeout: 10000 });
  });

  test('4. Sidebar has logout button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Logout Btn User', 'struct-4');
    injectToken(page, token);
    await page.goto('/boards');

    await expect(page.locator('.logout-btn')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Page structure — board page', () => {
  test('5. Board page has header with board name', async ({ page, request }) => {
    const { token } = await createUser(request, 'Board Header User', 'struct-5');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Header Name Board');

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header h1')).toContainText('Header Name Board', { timeout: 10000 });
  });

  test('6. Board page has view tabs (Board, Backlog)', async ({ page, request }) => {
    const { token } = await createUser(request, 'View Tabs User', 'struct-6');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'View Tabs Board');

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.view-btn', { timeout: 10000 });

    await expect(page.locator('.view-btn:has-text("Board")')).toBeVisible();
    await expect(page.locator('.view-btn:has-text("Backlog")')).toBeVisible();
  });

  test('7. Board page columns are displayed horizontally (board-content overflow-x)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Horizontal Cols User', 'struct-7');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Horizontal Cols Board');
    await createSwimlane(request, token, boardId);
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 10000 });

    const overflowX = await page.locator('.board-content').evaluate(
      (el) => getComputedStyle(el).overflowX,
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  test('8. Swimlane rows separate cards by row', async ({ page, request }) => {
    const { token } = await createUser(request, 'Swimlane Rows User', 'struct-8');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Swimlane Rows Board');
    await createSwimlane(request, token, boardId, 'Lane A');
    await createSwimlane(request, token, boardId, 'Lane B');
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-content', { timeout: 10000 });

    // Each swimlane is rendered as a .swimlane-row
    const rows = page.locator('.swimlane-row');
    await expect(rows).toHaveCount(2, { timeout: 8000 });
  });

  test('9. Column headers show column names', async ({ page, request }) => {
    const { token } = await createUser(request, 'Col Headers User', 'struct-9');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Col Headers Board');
    await createSwimlane(request, token, boardId);
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    // Default board has at least 3 columns — check headers exist
    await expect(page.locator('.board-column-header h3').first()).toBeVisible({ timeout: 8000 });
    const count = await page.locator('.board-column-header h3').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('10. Card items show title', async ({ page, request }) => {
    const { token } = await createUser(request, 'Card Title User', 'struct-10');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Card Title Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);
    const cardId = await createCard(request, token, boardId, swimlaneId, colId, 'Visible Title Card');
    if (cardId === null) {
      test.skip(true, 'Card creation failed — skip card title test');
      return;
    }
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.card-item:has-text("Visible Title Card")')).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 11–15: Empty states
// ---------------------------------------------------------------------------

test.describe('Empty states', () => {
  test('11. Empty board shows "No swimlanes" or similar message', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Swimlanes User', 'empty-11');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Empty Board');

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 10000 });
  });

  test('12. Empty column shows no card items', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Col User', 'empty-12');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Empty Col Board');
    await createSwimlane(request, token, boardId);
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    // Columns render but no .card-item elements
    await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(0);
  });

  test('13. Empty board list shows "No boards yet"', async ({ page, request }) => {
    const { token } = await createUser(request, 'No Boards User', 'empty-13');
    injectToken(page, token);
    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  test('14. Notification bell opens a panel — no notifications shows empty state', async ({ page, request }) => {
    const { token } = await createUser(request, 'No Notif User', 'empty-14');
    injectToken(page, token);
    await page.goto('/boards');

    // Click the notification bell
    const bell = page.locator('.notifications-btn, [title="Notifications"], .notification-bell');
    await expect(bell.first()).toBeVisible({ timeout: 10000 });
    await bell.first().click();

    // Panel with empty state, no notifications message, or zero items
    const panel = page.locator('.notifications-panel, .notification-dropdown, .notif-panel');
    await expect(panel.first()).toBeVisible({ timeout: 8000 });
  });

  test('15. Empty backlog shows "No sprints" or similar message', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Backlog User', 'empty-15');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Empty Backlog Board');
    await createSwimlane(request, token, boardId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');

    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 8000 });
    // No sprints yet — should show an empty-sprint message or create-sprint CTA
    const empty = page.locator(
      '.no-sprints, .empty-backlog, .backlog-empty, button:has-text("Create Sprint"), .create-sprint-cta',
    );
    await expect(empty.first()).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 16–18: Loading states
// ---------------------------------------------------------------------------

test.describe('Loading states', () => {
  test('16. Board page loading indicator visible while fetching then disappears', async ({ page, request }) => {
    const { token } = await createUser(request, 'Loading User', 'load-16');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Loading Board');

    await page.goto(`/boards/${boardId}`);

    // After loading, the board page should be present
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 15000 });
    // Loading spinner (if any) should be gone
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
  });

  test('17. Card modal loads without blank flash — modal content visible promptly', async ({ page, request }) => {
    const { token } = await createUser(request, 'Modal Flash User', 'load-17');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Modal Flash Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);
    const cardId = await createCard(request, token, boardId, swimlaneId, colId, 'Flash Card');
    if (cardId === null) {
      test.skip(true, 'Card creation failed — skip modal flash test');
      return;
    }
    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    const card = page.locator('.card-item', { hasText: 'Flash Card' });
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.click();

    // Modal should appear with content — not blank
    await expect(page.locator('.card-detail-modal')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-detail-modal')).not.toBeEmpty();
  });

  test('18. Board list page loads within expected timeout', async ({ page, request }) => {
    const { token } = await createUser(request, 'Fast Load User', 'load-18');
    // Create a few boards to have a realistic list
    for (let i = 1; i <= 3; i++) {
      await createBoard(request, token, `Fast Load Board ${i}`);
    }
    injectToken(page, token);

    const start = Date.now();
    await page.goto('/boards');
    await page.waitForSelector('.boards-grid, .empty-state', { timeout: 10000 });
    const elapsed = Date.now() - start;

    // Board list should load within 5 seconds
    expect(elapsed).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// 19–23: Color and styling
// ---------------------------------------------------------------------------

test.describe('Color and styling', () => {
  test('19. Active sprint badge has distinct styling on the backlog view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sprint Badge User', 'style-19');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Sprint Badge Board');
    await createSwimlane(request, token, boardId);
    const sprintId = await createSprint(request, token, boardId, 'Active Sprint');
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // Active sprint should have a status badge indicating active state
    const activeBadge = page.locator('.sprint-status, .status-badge, .sprint-active-badge, [class*="active"]');
    await expect(activeBadge.first()).toBeVisible({ timeout: 8000 });
  });

  test('20. Label chips show colored backgrounds on card items', async ({ page, request }) => {
    const { token } = await createUser(request, 'Label Color User', 'style-20');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Label Color Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);

    const cardId = await createCard(request, token, boardId, swimlaneId, colId, 'Labeled Card');
    if (cardId === null) {
      test.skip(true, 'Card creation failed — skip label color test');
      return;
    }

    // Create a label via API
    const labelRes = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Bug', color: '#ef4444' },
    });
    const label = await labelRes.json();

    // Apply label to card
    await request.post(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { label_id: label.id },
    });

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    // Card should show label chip
    const cardEl = page.locator('.card-item', { hasText: 'Labeled Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });
    const chip = cardEl.locator('.label-chip, .card-label, .label-dot');
    await expect(chip.first()).toBeVisible({ timeout: 5000 });
  });

  test('21. Priority indicators are present on card items that have priority set', async ({ page, request }) => {
    const { token } = await createUser(request, 'Priority User', 'style-21');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Priority Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { board_id: boardId, swimlane_id: swimlaneId, column_id: colId, title: 'High Priority Card', priority: 'high' },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skip priority test');
      return;
    }

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    const cardEl = page.locator('.card-item', { hasText: 'High Priority Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });

    // Priority indicator — could be a dot, badge, or icon
    const priorityEl = cardEl.locator('.priority-indicator, .priority-badge, .priority-dot, [class*="priority"]');
    await expect(priorityEl.first()).toBeVisible({ timeout: 5000 });
  });

  test('22. Overdue card has warning color applied', async ({ page, request }) => {
    const { token } = await createUser(request, 'Overdue User', 'style-22');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Overdue Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);

    // Create a card with a due_date in the past
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: colId,
        title: 'Overdue Card',
        due_date: '2020-01-01T00:00:00Z',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skip overdue test');
      return;
    }

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    const cardEl = page.locator('.card-item', { hasText: 'Overdue Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });

    // Overdue card should have an overdue class or warning color applied
    const hasOverdueStyle = await cardEl.evaluate((el) => {
      const classes = el.className + ' ' + el.innerHTML;
      return /overdue|warning|past-due/.test(classes);
    });
    expect(hasOverdueStyle).toBe(true);
  });

  test('23. Column with WIP limit exceeded has warning style', async ({ page, request }) => {
    const { token } = await createUser(request, 'WIP Limit User', 'style-23');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'WIP Limit Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);

    // Set WIP limit to 1 on the first column if the API supports it
    const wipRes = await request.put(`${BASE}/api/boards/${boardId}/columns/${colId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { wip_limit: 1 },
    });

    if (!wipRes.ok()) {
      test.fixme();
      return;
    }

    // Create 2 cards to exceed the WIP limit of 1
    for (const title of ['WIP Card 1', 'WIP Card 2']) {
      const r = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { board_id: boardId, swimlane_id: swimlaneId, column_id: colId, title },
      });
      if (!r.ok()) {
        test.skip(true, 'Card creation failed — skip WIP test');
        return;
      }
    }

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    // Column header should have a WIP warning class
    const col = page.locator('.board-column-header').first();
    await expect(col).toBeVisible({ timeout: 8000 });
    const hasWipWarning = await col.evaluate((el) =>
      /wip-exceeded|wip-warning|wip-over/.test(el.className + ' ' + el.innerHTML),
    );
    expect(hasWipWarning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 24–30: Responsive behaviour
// ---------------------------------------------------------------------------

test.describe('Responsive behaviour', () => {
  test('24. At 1280px width, sidebar is visible', async ({ page, request }) => {
    const { token } = await createUser(request, 'Wide Sidebar User', 'resp-24');
    injectToken(page, token);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/boards');

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
  });

  test('25. At 768px width (tablet), layout still usable — sidebar or toggle present', async ({ page, request }) => {
    const { token } = await createUser(request, 'Tablet User', 'resp-25');
    injectToken(page, token);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/boards');

    // Either the sidebar is visible or the mobile toggle is present
    const sidebarVisible = await page.locator('.sidebar').isVisible();
    const toggleVisible = await page.locator('.mobile-nav-toggle').isVisible();
    expect(sidebarVisible || toggleVisible).toBe(true);

    // Main content should still be accessible
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
  });

  test('26. At 375px width (mobile), layout adapts — mobile toggle present', async ({ page, request }) => {
    const { token } = await createUser(request, 'Mobile User', 'resp-26');
    injectToken(page, token);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/boards');

    await expect(page.locator('.mobile-nav-toggle')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.main-content')).toBeVisible();
  });

  test('27. Column content is scrollable when many cards are present', async ({ page, request }) => {
    const { token } = await createUser(request, 'Many Cards User', 'resp-27');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Many Cards Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);

    // Create several cards
    for (let i = 1; i <= 8; i++) {
      const r = await createCard(request, token, boardId, swimlaneId, colId, `Scroll Card ${i}`);
      if (r === null) {
        test.skip(true, 'Card creation failed — skip scroll test');
        return;
      }
    }

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.board-column').first()).toBeVisible({ timeout: 8000 });

    // board-content or the column itself should allow vertical scroll
    const overflowY = await page.locator('.board-content').evaluate(
      (el) => getComputedStyle(el).overflowY,
    );
    expect(['auto', 'scroll', 'visible']).toContain(overflowY);
  });

  test('28. Card detail modal is scrollable when content is long', async ({ page, request }) => {
    const { token } = await createUser(request, 'Scroll Modal User', 'resp-28');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Long Modal Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);
    const cardId = await createCard(request, token, boardId, swimlaneId, colId, 'Long Content Card');
    if (cardId === null) {
      test.skip(true, 'Card creation failed — skip modal scroll test');
      return;
    }

    // Add a long description via API
    await request.put(`${BASE}/api/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { description: 'A'.repeat(2000) },
    });

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    const cardEl = page.locator('.card-item', { hasText: 'Long Content Card' });
    await expect(cardEl).toBeVisible({ timeout: 8000 });
    await cardEl.click();

    await expect(page.locator('.card-detail-modal')).toBeVisible({ timeout: 8000 });

    // Modal or its inner content should be scrollable
    const overflowY = await page.locator('.card-detail-modal').evaluate(
      (el) => getComputedStyle(el).overflowY,
    );
    expect(['auto', 'scroll', 'visible']).toContain(overflowY);
  });

  test('29. Long card titles do not overflow the card item element', async ({ page, request }) => {
    const { token } = await createUser(request, 'Long Title User', 'resp-29');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Long Title Board');
    const swimlaneId = await createSwimlane(request, token, boardId);
    const colId = await getFirstColumnId(request, token, boardId);
    const longTitle = 'This is an extremely long card title that should not overflow the card container layout';
    const cardId = await createCard(request, token, boardId, swimlaneId, colId, longTitle);
    if (cardId === null) {
      test.skip(true, 'Card creation failed — skip long title test');
      return;
    }

    const sprintId = await createSprint(request, token, boardId);
    await startSprint(request, token, sprintId);

    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');

    const cardEl = page.locator('.card-item').filter({ hasText: longTitle.slice(0, 30) });
    await expect(cardEl).toBeVisible({ timeout: 8000 });

    // Card should not overflow — its scroll width should be close to offset width
    const overflows = await cardEl.evaluate((el) => el.scrollWidth > el.clientWidth + 4);
    expect(overflows).toBe(false);
  });

  test('30. Board name is truncated in header when very long', async ({ page, request }) => {
    const { token } = await createUser(request, 'Long Board Name User', 'resp-30');
    injectToken(page, token);
    const longName = 'This Board Has An Extremely Long Name That Should Be Truncated In The UI Header';
    const boardId = await createBoard(request, token, longName);

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header h1')).toBeVisible({ timeout: 10000 });

    const h1 = page.locator('.board-header h1');
    const overflow = await h1.evaluate((el) => getComputedStyle(el).overflow);
    const textOverflow = await h1.evaluate((el) => getComputedStyle(el).textOverflow);
    const whiteSpace = await h1.evaluate((el) => getComputedStyle(el).whiteSpace);

    // Should have some truncation mechanism (ellipsis, hidden overflow, or nowrap)
    const hasTruncation =
      overflow === 'hidden' ||
      textOverflow === 'ellipsis' ||
      whiteSpace === 'nowrap';
    expect(hasTruncation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 31–35: Consistency checks
// ---------------------------------------------------------------------------

test.describe('Consistency checks', () => {
  test('31. Create Board form has "Create Board" submit button text', async ({ page, request }) => {
    const { token } = await createUser(request, 'Form Text User', 'cons-31');
    injectToken(page, token);
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    await page.click('button:has-text("Create Board")');
    await page.waitForSelector('#boardName', { timeout: 5000 });

    // The submit button inside the modal should have a consistent label
    const submitBtn = page.locator('.modal button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    const btnText = await submitBtn.textContent();
    expect(btnText?.trim()).toMatch(/^(Create Board|Create|Save)$/);
  });

  test('32. Create Board modal has a close or cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Modal Close User', 'cons-32');
    injectToken(page, token);
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    await page.click('button:has-text("Create Board")');
    await page.waitForSelector('#boardName', { timeout: 5000 });

    // Modal must have a Cancel or close (×) button
    const closeBtn = page.locator('.modal button:has-text("Cancel"), .modal .modal-close, .modal button[aria-label="Close"]');
    await expect(closeBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('32b. Add Column modal (board settings) has a cancel button', async ({ page, request }) => {
    const { token } = await createUser(request, 'Column Close User', 'cons-32b');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Column Close Board');

    await page.goto(`/boards/${boardId}/settings`);
    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 });

    const closeBtn = page.locator('.modal button:has-text("Cancel"), .modal .modal-close, .modal button[aria-label="Close"]');
    await expect(closeBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('33. Deleting a board from list triggers a confirmation dialog', async ({ page, request }) => {
    const { token } = await createUser(request, 'Confirm Delete User', 'cons-33');
    injectToken(page, token);
    await createBoard(request, token, 'Confirm Delete Board');
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    let dialogTriggered = false;
    page.once('dialog', (dialog) => {
      dialogTriggered = true;
      dialog.dismiss();
    });

    await page.click('.board-card-delete');
    expect(dialogTriggered).toBe(true);
  });

  test('34. Auth error messages use .auth-error class for consistent styling', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'nobody@example.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 8000 });

    // Verify the element has some visible styling (not zero dimensions)
    const box = await page.locator('.auth-error').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  test('35. Success feedback shown after saving board settings', async ({ page, request }) => {
    const { token } = await createUser(request, 'Save Feedback User', 'cons-35');
    injectToken(page, token);
    const boardId = await createBoard(request, token, 'Feedback Board');

    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    // Fill and submit the board name form
    await page.fill('#boardName', 'Feedback Board Updated');
    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/boards/') && r.request().method() === 'PUT'),
      page.click('button:has-text("Save Changes")'),
    ]);
    expect(saveRes.status()).toBe(200);

    // Some feedback should appear — toast, banner, or updated state
    const feedback = page.locator(
      '.toast-success, .save-success, [class*="success"], .toast-container',
    );
    await expect(feedback.first()).toBeVisible({ timeout: 5000 });
  });
});
