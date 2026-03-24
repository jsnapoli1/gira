import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

interface SetupResult {
  token: string;
  boardId: number;
  swimlaneId: number;
  columnId: number;
}

async function setupBoard(request: any): Promise<SetupResult> {
  const email = `test-sf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

  const columns = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const firstColumn = columns[0];

  // Create a card with high priority so filters have something to act on
  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'High Priority Card',
        column_id: firstColumn.id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await request.put(`${BASE}/api/cards/${card.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { priority: 'high' },
  });

  return { token, boardId: board.id, swimlaneId: swimlane.id, columnId: firstColumn.id };
}

test.describe('Saved Filters', () => {
  let setup: SetupResult;

  test.beforeEach(async ({ request, page }) => {
    setup = await setupBoard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), setup.token);
    // Clear saved filter state from localStorage to guarantee collapsed state
    await page.addInitScript(() => localStorage.removeItem('zira-filters-expanded'));
    await page.goto(`/boards/${setup.boardId}`);
    // Switch to All Cards view so cards are visible without a sprint
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
  });

  test('filter bar expand and collapse', async ({ page }) => {
    const filterToggle = page.locator('.filter-toggle-btn');
    await expect(filterToggle).toBeVisible();

    // Expand
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).toBeVisible();

    // Collapse
    await filterToggle.click();
    await expect(page.locator('.filters-expanded')).not.toBeVisible();
  });

  test('save current filter', async ({ page }) => {
    // Expand filter bar and set a priority filter
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // The save filter button only appears when hasActiveFilters is true
    const saveBtn = page.locator('.save-filter-btn');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    // Save filter modal should appear
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.save-filter-modal h3')).toContainText('Save Filter');

    // Enter filter name and submit
    const nameInput = page.locator('.save-filter-input');
    await nameInput.fill('High Priority Filter');
    await page.click('.save-filter-modal .btn-primary');

    // Modal should close
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Open the saved filters dropdown and verify the new filter appears
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("High Priority Filter")')).toBeVisible();
  });

  test('apply saved filter restores filter values', async ({ page }) => {
    // Set priority filter and save it
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('Apply Test Filter');
    await page.click('.save-filter-modal .btn-primary');
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Clear all active filters
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // Verify priority filter is cleared
    await expect(prioritySelect).toHaveValue('');

    // Expand filter bar (clear may have left it visible, ensure it's visible)
    const filtersExpanded = page.locator('.filters-expanded');
    if (!(await filtersExpanded.isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(filtersExpanded).toBeVisible();
    }

    // Open saved filters dropdown and apply the saved filter
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await page.locator('.saved-filter-apply:has-text("Apply Test Filter")').click();

    // Priority filter should now be restored to 'high'
    await expect(prioritySelect).toHaveValue('high');
  });

  test('delete saved filter removes it from dropdown', async ({ page }) => {
    // Set a filter and save it
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('medium');

    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('Delete Me Filter');
    await page.click('.save-filter-modal .btn-primary');
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Open the dropdown and confirm the filter is there
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).toBeVisible();

    // Delete the filter using the trash icon button next to it
    const filterItem = page.locator('.saved-filter-item').filter({
      has: page.locator('.saved-filter-name:has-text("Delete Me Filter")'),
    });
    await filterItem.locator('.saved-filter-delete').click();

    // The filter should be gone from the dropdown
    await expect(page.locator('.saved-filter-name:has-text("Delete Me Filter")')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('saved filter persists across page reload', async ({ page }) => {
    // Set a filter and save it
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    // Use 'high' so the card we created is visible after reload
    await prioritySelect.selectOption('high');

    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('Persist Test Filter');
    await page.click('.save-filter-modal .btn-primary');
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Reload the page and wait for board header to appear (confirms board has loaded)
    await page.reload();
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 15000 });

    // Open saved filters dropdown and verify filter is still listed
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Persist Test Filter")')).toBeVisible();
  });

  test('multiple saved filters appear in dropdown', async ({ page }) => {
    // Save filter 1
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible();

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });

    await prioritySelect.selectOption('high');
    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('Filter Alpha');
    await page.click('.save-filter-modal .btn-primary');
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Clear and save filter 2
    await page.locator('.clear-filter').click();
    // Ensure filter bar is still expanded after clear
    if (!(await page.locator('.filters-expanded').isVisible())) {
      await page.click('.filter-toggle-btn');
      await expect(page.locator('.filters-expanded')).toBeVisible();
    }
    await prioritySelect.selectOption('low');
    await page.locator('.save-filter-btn').click();
    await expect(page.locator('.save-filter-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('Filter Beta');
    await page.click('.save-filter-modal .btn-primary');
    await expect(page.locator('.save-filter-modal')).not.toBeVisible({ timeout: 5000 });

    // Verify count badge shows 2
    await expect(page.locator('.saved-filters-count')).toHaveText('2');

    // Open dropdown and verify both appear
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Filter Alpha")')).toBeVisible();
    await expect(page.locator('.saved-filter-name:has-text("Filter Beta")')).toBeVisible();
  });
});
