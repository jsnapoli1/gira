import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------
interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardsCreated: boolean;
}

async function setupBoard(request: any): Promise<SetupResult> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-sf-${suffix}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'SF Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Saved Filter Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM', color: '#6366f1' },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const firstColumn = columns[0];

  // Attempt to create a card so filters have something to act on
  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'High Priority Card',
      column_id: firstColumn.id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'high',
    },
  });

  const cardsCreated = cardRes.ok();

  return {
    token,
    boardId: board.id,
    columnId: firstColumn.id,
    swimlaneId: swimlane.id,
    cardsCreated,
  };
}

// Navigate to the board, clear expansion state from localStorage, then
// (optionally) switch to All Cards view.
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

// Expand the filter bar and set priority to a value, making hasActiveFilters=true
async function setActivePriorityFilter(page: any, priority: string) {
  const filtersExpanded = page.locator('.filters-expanded');
  if (!(await filtersExpanded.isVisible())) {
    await page.click('.filter-toggle-btn');
    await expect(filtersExpanded).toBeVisible({ timeout: 5000 });
  }
  const prioritySelect = page.locator('.filter-select').filter({
    has: page.locator('option:text("All priorities")'),
  });
  await prioritySelect.selectOption(priority);
}

// Save the current filters via the save-filter UI flow
async function saveFilter(page: any, name: string) {
  const saveBtn = page.locator('.save-filter-btn');
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();

  await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
  await page.locator('.save-filter-input').fill(name);
  await page.click('.save-filter-modal .btn-primary');
  await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------

test.describe('Saved Filters', () => {
  test('filter bar expands and collapses via toggle button', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    const filterToggle = page.locator('.filter-toggle-btn');
    await expect(filterToggle).toBeVisible();

    // Expand
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // Collapse
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).not.toBeVisible({ timeout: 5000 });
  });

  test('save-filter button appears only when filters are active', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // No active filter yet — save button should be absent
    await expect(page.locator('.save-filter-btn')).not.toBeVisible();

    // Activate a filter
    await setActivePriorityFilter(page, 'high');

    // Now the save button should appear
    await expect(page.locator('.save-filter-btn')).toBeVisible({ timeout: 5000 });
  });

  test('clicking save-filter button opens save dialog with title "Save Filter"', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'high');

    const saveBtn = page.locator('.save-filter-btn');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.save-filter-modal h3')).toContainText('Save Filter');
  });

  test('save dialog has a name input, a "Share with team" checkbox, cancel, and save buttons', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'high');
    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.save-filter-input')).toBeVisible();
    await expect(page.locator('.save-filter-shared-label')).toBeVisible();
    await expect(page.locator('.save-filter-modal .btn-primary')).toBeVisible();
    await expect(page.locator('.save-filter-modal .btn-secondary')).toBeVisible();
  });

  test('saving a filter closes the modal and shows the filter in the dropdown', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'High Priority Filter');

    // Open the saved-filters dropdown
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("High Priority Filter")')).toBeVisible();
  });

  test('applying a saved filter restores the filter values', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    // Save a "high" priority filter
    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Apply Test Filter');

    // Clear all active filters
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();

    // Ensure the filter bar is visible for the value check below
    const filtersExpanded = page.locator('.filters-expanded');
    if (!(await filtersExpanded.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filtersExpanded).toBeVisible({ timeout: 5000 });
    }

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toHaveValue('');

    // Open dropdown and apply the saved filter
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await page.locator('.saved-filter-apply').filter({ hasText: 'Apply Test Filter' }).click();

    // Priority should be restored to 'high'
    await expect(prioritySelect).toHaveValue('high');
  });

  test('deleting a saved filter removes it from the dropdown', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'medium');
    await saveFilter(page, 'Delete Me Filter');

    // Confirm it is in the dropdown
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).toBeVisible();

    // Click the delete button on that filter item
    const filterItem = page.locator('.saved-filter-item').filter({
      has: page.locator('.saved-filter-name:has-text("Delete Me Filter")'),
    });
    await filterItem.locator('.saved-filter-delete').click();

    // The filter should be gone
    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).not.toBeVisible({ timeout: 5000 });
  });

  test('saved filter persists across page reload', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Persist Test Filter');

    // Reload the page
    await page.reload();
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Saved filters are stored server-side — they should still be listed
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Persist Test Filter")')).toBeVisible();
  });

  test('multiple saved filters appear in dropdown and count badge updates', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    // Save filter 1
    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Filter Alpha');

    // Clear and save filter 2
    await page.locator('.clear-filter').click();
    // Re-expand filter bar if needed
    const filtersExpanded = page.locator('.filters-expanded');
    if (!(await filtersExpanded.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filtersExpanded).toBeVisible({ timeout: 5000 });
    }
    await setActivePriorityFilter(page, 'low');
    await saveFilter(page, 'Filter Beta');

    // Count badge on the saved-filters button should show 2
    await expect(page.locator('.saved-filters-count')).toHaveText('2');

    // Both filters appear in dropdown
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Filter Alpha")')).toBeVisible();
    await expect(page.locator('.saved-filter-name:has-text("Filter Beta")')).toBeVisible();
  });

  test('saved filters are board-specific — filter from another board does not appear', async ({ page, request }) => {
    // Board A: create and save a filter
    const setupA = await setupBoard(request);
    await navigateToBoard(page, setupA.boardId, setupA.token);
    await setActivePriorityFilter(page, 'high');
    await saveFilter(page, 'Board A Filter');

    // Board B: create a separate board with the same user
    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${setupA.token}` },
        data: { name: 'Board B' },
      })
    ).json();

    // Navigate to board B and open saved-filters dropdown
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });

    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });

    // The filter saved for board A must NOT appear for board B
    await expect(page.locator('.saved-filter-name:has-text("Board A Filter")')).not.toBeVisible();
  });

  test('cancel button in save dialog closes the dialog without saving', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    await setActivePriorityFilter(page, 'high');
    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });

    // Type a name but then cancel
    await page.locator('.save-filter-input').fill('Cancelled Filter');
    await page.click('.save-filter-modal .btn-secondary');

    // Modal closes
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Filter should NOT appear in the dropdown
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Cancelled Filter")')).not.toBeVisible();
  });

  test('empty saved-filters dropdown shows "No saved filters" message', async ({ page, request }) => {
    const setup = await setupBoard(request);
    await navigateToBoard(page, setup.boardId, setup.token);

    // Open the dropdown without saving anything first
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filters-empty')).toBeVisible();
    await expect(page.locator('.saved-filters-empty')).toContainText('No saved filters');
  });
});
