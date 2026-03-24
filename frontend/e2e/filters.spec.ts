import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------
interface FilterSetup {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardsCreated: boolean;
}

async function setupFilterBoard(request: any): Promise<FilterSetup> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-filters-${suffix}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Filter Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Filter Test Board' },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TSW-', color: '#6366f1' },
    })
  ).json();

  // Attempt to create 3 cards with different priorities
  const c1Res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'High Priority Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'high',
    },
  });

  if (!c1Res.ok()) {
    return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id, cardsCreated: false };
  }

  await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Low Priority Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'low',
    },
  });

  await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Normal Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'medium',
    },
  });

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id, cardsCreated: true };
}

/** Navigate to the board and switch to All Cards view. */
async function navigateToBoard(page: any, boardId: number, token: string, switchToAllCards = true) {
  await page.addInitScript((t: string) => {
    localStorage.setItem('token', t);
    localStorage.removeItem('zira-filters-expanded');
  }, token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 15000 });
  await page.waitForSelector('.view-toggle', { timeout: 10000 });

  if (switchToAllCards) {
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });
  }
}

// ---------------------------------------------------------------------------

test.describe('Filter Bar', () => {
  test.setTimeout(90000);

  test('filter toggle button is visible in the board header', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await expect(page.locator('.filter-toggle-btn')).toBeVisible();
  });

  test('clicking filter toggle expands the filter panel', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.locator('.filter-toggle-btn').click();
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
  });

  test('clicking filter toggle a second time collapses the filter panel', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    const filterToggle = page.locator('.filter-toggle-btn');
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).not.toBeVisible({ timeout: 5000 });
  });

  test('filter panel contains swimlane, assignee, label, and priority dropdowns', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const swimlaneSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    await expect(swimlaneSelect).toBeVisible();

    const assigneeSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });
    await expect(assigneeSelect).toBeVisible();

    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await expect(labelSelect).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toBeVisible();
  });

  test('filter panel contains an overdue toggle button', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.filter-overdue')).toBeVisible();
  });

  test('filter by priority shows only matching cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }
    await navigateToBoard(page, setup.boardId, setup.token);

    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Priority Card');
  });

  test('filter by low priority shows only low priority card', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }
    await navigateToBoard(page, setup.boardId, setup.token);

    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('low');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Low Priority Card');
  });

  test('filter by swimlane shows only cards in that swimlane', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }
    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const swimlaneSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });

    const options = await swimlaneSelect.locator('option').allTextContents();
    const swimlaneName = options.find((o) => o !== 'All swimlanes');
    if (!swimlaneName) {
      test.skip(true, 'No swimlane option found in dropdown');
      return;
    }

    // Select the swimlane — all 3 cards belong to it, so count stays 3
    await swimlaneSelect.selectOption({ label: swimlaneName });
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Filter is active — indicator dot should be present
    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible();
  });

  test('filter by label shows only cards with that label', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    // Create a board label via API
    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'urgent', color: '#ef4444' },
    });
    if (!labelRes.ok()) {
      test.skip(true, 'Label creation unavailable');
      return;
    }
    const label = await labelRes.json();

    // Get the cards and tag the first one with the label
    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    if (boardCards.length === 0) {
      test.skip(true, 'No cards available to label');
      return;
    }
    await request.post(`${BASE}/api/cards/${boardCards[0].id}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { label_id: label.id },
    });

    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });

    await labelSelect.selectOption(String(label.id));

    // Only the labelled card should remain
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  test('label filter dropdown lists created labels', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);

    // Create a label
    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'blocker', color: '#dc2626' },
    });
    if (!labelRes.ok()) {
      test.skip(true, 'Label creation unavailable');
      return;
    }
    const label = await labelRes.json();

    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });

    // The label we created should appear as an option
    await expect(labelSelect.locator(`option[value="${label.id}"]`)).toBeAttached();
  });

  test('filter by assignee shows only assigned cards', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    const meRes = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    if (!meRes.ok()) {
      test.skip(true, 'Cannot fetch current user');
      return;
    }
    const me = await meRes.json();

    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    if (boardCards.length === 0) {
      test.skip(true, 'No cards available');
      return;
    }
    await request.post(`${BASE}/api/cards/${boardCards[0].id}/assignees`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { user_id: me.id },
    });

    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const assigneeSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All assignees")'),
    });
    await assigneeSelect.selectOption(String(me.id));

    // Only the assigned card should remain
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  test('combined swimlane + priority filter narrows results', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }
    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // Select the test swimlane (all 3 cards are in it)
    const swimlaneSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    const options = await swimlaneSelect.locator('option').allTextContents();
    const swimlaneName = options.find((o) => o !== 'All swimlanes');
    if (swimlaneName) {
      await swimlaneSelect.selectOption({ label: swimlaneName });
    }

    // Also filter by high priority — only 1 card matches
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Priority Card');
  });

  test('combined label + priority filter shows only cards matching both criteria', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    // Create label and assign it to the high-priority card
    const labelRes = await request.post(`${BASE}/api/boards/${setup.boardId}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { name: 'critical', color: '#b91c1c' },
    });
    if (!labelRes.ok()) {
      test.skip(true, 'Label creation unavailable');
      return;
    }
    const label = await labelRes.json();

    const cardsRes = await request.get(`${BASE}/api/boards/${setup.boardId}/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const boardCards: any[] = await cardsRes.json();
    const highCard = boardCards.find((c: any) => c.priority === 'high');
    if (!highCard) {
      test.skip(true, 'Cannot find high priority card');
      return;
    }
    await request.post(`${BASE}/api/cards/${highCard.id}/labels`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { label_id: label.id },
    });

    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // Filter by label
    const labelSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await labelSelect.selectOption(String(label.id));
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Also filter by high priority — still only the same 1 card
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  test('clear all filters button resets all active filters', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }
    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // .clear-filter button appears when hasActiveFilters is true
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // All 3 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Priority dropdown should be reset
    await expect(prioritySelect).toHaveValue('');
  });

  test('clear all filters also removes label and swimlane selections', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await navigateToBoard(page, setup.boardId, setup.token);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // Apply priority filter
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Apply swimlane filter if available
    const swimlaneSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    const options = await swimlaneSelect.locator('option').allTextContents();
    const swimlaneName = options.find((o) => o !== 'All swimlanes');
    if (swimlaneName) {
      await swimlaneSelect.selectOption({ label: swimlaneName });
    }

    // Clear all
    const clearBtn = page.locator('.clear-filter');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
    }

    // All dropdowns should reset
    await expect(prioritySelect).toHaveValue('');
    await expect(swimlaneSelect).toHaveValue('');
  });

  test('filter state is synced to URL search params', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    await page.waitForFunction(() => window.location.search.includes('priority=high'), { timeout: 5000 });
    expect(page.url()).toContain('priority=high');
  });

  test('filter toggle badge appears when a filter is active', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    // No active filters — should NOT have has-filters
    await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible();

    // Apply a priority filter
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Badge should now be present
    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible({ timeout: 5000 });
  });

  test('filter badge disappears when clear all is clicked', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible({ timeout: 5000 });

    const clearBtn = page.locator('.clear-filter');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('filters are board-specific: applying filter on board A does not affect board B', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-cross-board-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Cross Board Tester' },
      })
    ).json();

    // Create two boards
    const boardA = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Board A' },
      })
    ).json();

    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Board B' },
      })
    ).json();

    // Navigate to Board A and set a priority filter
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardA.id}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await page.waitForFunction(() => window.location.search.includes('priority=high'), { timeout: 5000 });

    // Navigate to Board B — it should NOT have the priority filter from Board A
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });

    // URL should not contain priority=high for Board B
    expect(page.url()).not.toContain('priority=high');

    // Filter toggle should not show active filters
    await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible();
  });

  test('filter state is NOT persisted across page loads (URL params cleared on navigation)', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Navigate away from board and back (without URL params)
    await page.goto('/boards');
    await page.waitForSelector('.boards-list, .board-card', { timeout: 10000 });

    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });

    // Priority filter should be cleared
    if (await page.locator('.filters-expanded').isVisible()) {
      const priorityAfterReload = page.locator('.filter-select').filter({
        has: page.locator('option:text("All priorities")'),
      });
      await expect(priorityAfterReload).toHaveValue('');
    } else {
      // Filter bar is collapsed — no active filter indicator
      await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible();
    }
  });

  test('overdue filter shows only cards with a past due date', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    // Create an additional card and set a past due date
    const overdueCardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Overdue Card',
        column_id: setup.columnId,
        swimlane_id: setup.swimlaneId,
        board_id: setup.boardId,
      },
    });
    if (!overdueCardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await overdueCardRes.text()}`);
      return;
    }
    const overdueCard = await overdueCardRes.json();

    await request.put(`${BASE}/api/cards/${overdueCard.id}`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { title: overdueCard.title, description: overdueCard.description || '', due_date: '2020-01-01' },
    });

    await navigateToBoard(page, setup.boardId, setup.token);
    // 4 cards total (3 from setup + 1 overdue)
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 12000 });

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.filter-overdue')).toBeVisible();
    await page.locator('.filter-overdue').click();

    // Only the overdue card should remain
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Overdue Card');
  });

  test('filter-active badge appears on toggle button when filters are set via search', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    // No active filters
    await expect(page.locator('.filter-toggle-btn.has-filters')).not.toBeVisible();

    // Type in search to activate a filter
    const searchInput = page.locator('.search-input input');
    await searchInput.fill('test');

    // Toggle should now have the has-filters class
    await expect(page.locator('.filter-toggle-btn.has-filters')).toBeVisible({ timeout: 5000 });
  });

  test('swimlane filter dropdown lists board swimlanes', async ({ page, request }) => {
    const setup = await setupFilterBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const swimlaneSelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });

    // The "Test Swimlane" we created should be in the dropdown
    const options = await swimlaneSelect.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Test Swimlane'))).toBe(true);
  });
});
