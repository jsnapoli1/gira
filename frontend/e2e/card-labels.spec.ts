import { test, expect, APIRequestContext } from '@playwright/test';

const PORT = process.env.PORT || 9002;

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardId: number;
}

async function setup(request: APIRequestContext): Promise<SetupResult> {
  const signupResp = await request.post(`http://localhost:${PORT}/api/auth/signup`, {
    data: {
      email: `test-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      display_name: 'Tester',
    },
  });
  const { token } = await signupResp.json();

  // Create board (response is board object directly)
  const board = await (await request.post(`http://localhost:${PORT}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Label Test Board' },
  })).json();

  // Create a swimlane (required for cards)
  const swimlane = await (await request.post(`http://localhost:${PORT}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', repo_owner: 'test', repo_name: 'repo', designator: 'LT-', color: '#6366f1' },
  })).json();

  // Get columns (response is array directly)
  const columns: Array<{ id: number }> = await (await request.get(`http://localhost:${PORT}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json();

  // Create a card (response is card object directly)
  const card = await (await request.post(`http://localhost:${PORT}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  })).json();

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id, cardId: card.id };
}

async function createLabelViaApi(request: APIRequestContext, token: string, boardId: number, name: string, color: string) {
  // Response is label object directly (no wrapper)
  return await (await request.post(`http://localhost:${PORT}/api/boards/${boardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, color },
  })).json();
}

async function applyLabelViaApi(request: APIRequestContext, token: string, cardId: number, labelId: number) {
  await request.post(`http://localhost:${PORT}/api/cards/${cardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { label_id: labelId },
  });
}

async function loginWithToken(page: import('@playwright/test').Page, token: string) {
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
}

test.describe('Card Labels — Board Settings', () => {
  test('should create a label in board settings', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    await loginWithToken(page, token);

    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });

    // Initially no labels
    await expect(page.locator('.settings-section:has(h2:has-text("Labels")) .empty-list')).toBeVisible();

    // Open the add label modal
    await page.click('.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")');
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });

    // Fill in the name and pick a color
    await page.fill('.modal input[placeholder*="Bug"]', 'Bug');
    await page.click('.modal .color-option:first-child');
    await page.click('.modal button[type="submit"]:has-text("Add Label")');

    // Modal should close and label should appear in the list
    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(page.locator('.settings-section:has(h2:has-text("Labels")) .item-name:has-text("Bug")')).toBeVisible();
  });

  test('should delete a label in board settings', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'DeleteMe', '#ef4444');
    await loginWithToken(page, token);

    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("${label.name}")`, { timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await page.click('.settings-list-item:has(.item-name:has-text("DeleteMe")) .item-delete');

    await expect(page.locator(`.item-name:has-text("${label.name}")`)).not.toBeVisible();
    await expect(page.locator('.settings-section:has(h2:has-text("Labels")) .empty-list')).toBeVisible();
  });
});

test.describe('Card Labels — Card Modal', () => {
  test('should apply a label to a card', async ({ page, request }) => {
    const { token, boardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'Bug', '#ef4444');
    await loginWithToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the card modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Find the label toggle in the sidebar and click it
    const labelToggle = page.locator(`.label-toggle:has(.label-name:has-text("${label.name}"))`);
    await expect(labelToggle).toBeVisible();
    await labelToggle.click();

    // The toggle should now have the 'assigned' class
    await expect(labelToggle).toHaveClass(/assigned/);
  });

  test('should remove a label from a card', async ({ page, request }) => {
    const { token, boardId, cardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'Bug', '#ef4444');
    await applyLabelViaApi(request, token, cardId, label.id);

    await loginWithToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the card modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Find the label toggle (should be assigned already)
    const labelToggle = page.locator(`.label-toggle:has(.label-name:has-text("${label.name}"))`);
    await expect(labelToggle).toHaveClass(/assigned/);

    // Click to remove
    await labelToggle.click();
    await expect(labelToggle).not.toHaveClass(/assigned/);
  });

  test('should show label chip on board card after applying', async ({ page, request }) => {
    const { token, boardId, cardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'Feature', '#22c55e');
    await applyLabelViaApi(request, token, cardId, label.id);

    await loginWithToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // The card on the board should show a label chip
    await expect(page.locator('.card-item .card-label')).toBeVisible();
    await expect(page.locator('.card-item .card-label')).toHaveAttribute('title', label.name);
  });
});

test.describe('Card Labels — Label Filter', () => {
  test('should filter cards by label and clear filter', async ({ page, request }) => {
    const { token, boardId, columnId, swimlaneId, cardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'Filtered', '#06b6d4');

    // Create a second card without a label
    await request.post(`http://localhost:${PORT}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Unlabeled Card',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });

    // Apply label only to the first card
    await applyLabelViaApi(request, token, cardId, label.id);

    await loginWithToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Both cards should be visible initially
    await expect(page.locator('.card-item')).toHaveCount(2);

    // Open filter panel
    await page.click('.filter-toggle-btn');
    await page.waitForSelector('.filters-expanded', { timeout: 5000 });

    // Select the label in the label filter dropdown
    const labelFilter = page.locator('.filter-select').filter({ has: page.locator('option:text("All labels")') });
    await labelFilter.selectOption({ label: label.name });

    // Only the labeled card should be visible
    await expect(page.locator('.card-item')).toHaveCount(1);
    await expect(page.locator('.card-item .card-title')).toContainText('Test Card');

    // Clear all filters
    await page.click('.clear-filter');

    // Both cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(2);
  });
});
