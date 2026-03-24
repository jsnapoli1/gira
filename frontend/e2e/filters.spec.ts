import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;

test.describe('Filter Bar', () => {
  let token: string;
  let boardId: number;
  let columns: any[];
  let swimlanes: any[];

  test.beforeEach(async ({ page, request }) => {
    // Create a unique user via API
    const email = `test-filters-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Filter Tester' },
    });
    const signupData = await signupRes.json();
    token = signupData.token;

    // Create board — API returns Board directly (not wrapped)
    const boardRes = await request.post(`http://localhost:${PORT}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Filter Test Board' },
    });
    const board = await boardRes.json();
    boardId = board.id;

    // Get columns — API returns []Column directly
    const columnsRes = await request.get(`http://localhost:${PORT}/api/boards/${boardId}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    columns = await columnsRes.json();

    // Create a swimlane (boards start with no swimlanes) — API returns Swimlane directly
    const swimlaneRes = await request.post(`http://localhost:${PORT}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TSW-', color: '#6366f1' },
    });
    const swimlane = await swimlaneRes.json();
    swimlanes = [swimlane];

    // Create 3 cards with different priorities
    const card1Res = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'High Priority Card',
        column_id: columns[0].id,
        swimlane_id: swimlanes[0].id,
        board_id: boardId,
      },
    });
    // API returns Card directly (not wrapped)
    const card1 = await card1Res.json();
    await request.put(`http://localhost:${PORT}/api/cards/${card1.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { priority: 'high' },
    });

    const card2Res = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Low Priority Card',
        column_id: columns[0].id,
        swimlane_id: swimlanes[0].id,
        board_id: boardId,
      },
    });
    const card2 = await card2Res.json();
    await request.put(`http://localhost:${PORT}/api/cards/${card2.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { priority: 'low' },
    });

    const card3Res = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Normal Card',
        column_id: columns[0].id,
        swimlane_id: swimlanes[0].id,
        board_id: boardId,
      },
    });
    const card3 = await card3Res.json();
    await request.put(`http://localhost:${PORT}/api/cards/${card3.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { priority: 'medium' },
    });

    // Inject token and navigate to board
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // Wait for the board header to appear (board data loaded)
    await page.waitForSelector('.board-header', { timeout: 10000 });
    // Wait for the view mode buttons to be visible
    await page.waitForSelector('.view-toggle', { timeout: 10000 });

    // Switch to All Cards view so cards are visible without a sprint
    await page.click('.view-btn:has-text("All Cards")');

    // Wait for the board grid to render (in all mode, a swimlane row is visible)
    await page.waitForSelector('.swimlane-header, .board-grid', { timeout: 10000 });

    // Wait for all 3 card items to be present
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });
  });

  test('filter bar toggle shows and hides filter controls', async ({ page }) => {
    // Filter controls should not be visible initially (collapsed by default due to cleared localStorage)
    const filterToggle = page.locator('.filter-toggle-btn');
    await expect(filterToggle).toBeVisible();

    // Click the filter toggle button
    await filterToggle.click();

    // Expanded filter controls should become visible
    await expect(page.locator('.filters-expanded')).toBeVisible();

    // Click again to collapse
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).not.toBeVisible();
  });

  test('search input filters cards by title', async ({ page }) => {
    // Verify we start with 3 cards in All Cards mode
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Type in the search input (always visible, not behind filter toggle)
    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('High Priority');

    // Only 1 card (High Priority Card) should remain visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Priority Card');
  });

  test('clearing search shows all cards again', async ({ page }) => {
    // Verify initial state
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('High Priority');

    // Confirm filter applied - only 1 card remains
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Clear the search input
    await searchInput.fill('');

    // All 3 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('filter by priority shows only matching cards', async ({ page }) => {
    // Verify initial state
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Expand the filter bar
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    // Select "High" from the priority filter
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toBeVisible();
    await prioritySelect.selectOption('high');

    // Only 1 card (High Priority Card) should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Priority Card');
  });

  test('clear all filters button resets filters and shows all cards', async ({ page }) => {
    // Verify initial state
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Expand filters and set priority
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // The clear button (X) should be visible when filters are active
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // All cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Priority filter should be reset
    await expect(prioritySelect).toHaveValue('');
  });

  test('overdue filter shows only overdue cards', async ({ page, request }) => {
    // Create an overdue card via API
    const overdueCardRes = await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Overdue Card',
        column_id: columns[0].id,
        swimlane_id: swimlanes[0].id,
        board_id: boardId,
      },
    });
    const overdueCard = await overdueCardRes.json();
    await request.put(`http://localhost:${PORT}/api/cards/${overdueCard.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { due_date: '2020-01-01' },
    });

    // Reload page to pick up new card
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 8000 });

    // All 4 cards should be present now
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 8000 });

    // Expand filters
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    // Click the Overdue toggle button
    const overdueBtn = page.locator('.filter-overdue');
    await expect(overdueBtn).toBeVisible();
    await overdueBtn.click();

    // Only 1 card (the overdue card) should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Overdue Card');
  });
});
