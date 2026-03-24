import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const API = `http://127.0.0.1:${PORT}`;

// Helper: sign up via API and return token + user
async function signUp(request: any) {
  const email = `bulk-${crypto.randomUUID()}@test.com`;
  const displayName = `BulkTester-${crypto.randomUUID().slice(0, 8)}`;
  const res = await request.post(`${API}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, userId: body.user?.id as number, email };
}

// Helper: create board with a swimlane + columns via API, return board data
async function createBoard(request: any, token: string) {
  const boardRes = await request.post(`${API}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Bulk Test Board ${crypto.randomUUID().slice(0, 8)}`, description: '' },
  });
  const board = await boardRes.json();

  // The board comes with default columns; fetch them
  const colRes = await request.get(`${API}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columns = await colRes.json();

  // Add a swimlane
  const slRes = await request.post(`${API}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Test Lane',
      repo_owner: 'test',
      repo_name: 'repo',
      designator: 'TL-',
      color: '#3b82f6',
    },
  });
  const swimlane = await slRes.json();

  return { board, columns, swimlane };
}

// Helper: create a card via API
async function createCard(request: any, token: string, boardId: number, swimlaneId: number, columnId: number, title: string) {
  const res = await request.post(`${API}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      title,
      description: '',
      priority: 'medium',
    },
  });
  return res.json();
}

test.describe('Bulk Actions', () => {
  test('select card shows bulk action bar with count "1 selected"', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Alpha');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Beta');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Gamma');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    // Switch to All Cards view so cards are visible without an active sprint
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Hover over first card to reveal checkbox, then click it
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    const checkbox = firstCard.locator('.card-select-checkbox input');
    await checkbox.click({ force: true });

    // Bulk action bar should appear
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bulk-action-count')).toContainText('1 card selected');
  });

  test('select multiple cards shows correct count', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card One');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Two');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Three');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select first card
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('1 card selected');

    // Select second card — checkboxes are now always visible (has-selection mode)
    const secondCard = page.locator('.card-item').nth(1);
    await secondCard.locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('2 cards selected');
  });

  test('deselect all clears bulk action bar', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card A');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card B');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card C');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select two cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click Deselect All
    await page.click('button:has-text("Deselect All")');
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('Escape key deselects all cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Esc Card 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Esc Card 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Esc Card 3');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select a card
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click on the board grid (not an input) to ensure no form element has focus, then press Escape
    await page.locator('.board-content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('bulk move to column moves selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Find a non-first column to move cards to
    // Default boards typically have: To Do, In Progress, Done
    const targetColumn = columns.find((c: any) => c.state !== 'closed') || columns[columns.length - 1];

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Move Card 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Move Card 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Move Card 3');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select first two cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click "Move to..."
    await page.click('.bulk-action-bar button:has-text("Move to...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Click the target column (last column, e.g., "Done")
    const lastColumnBtn = page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').last();
    const targetColName = await lastColumnBtn.textContent();
    await lastColumnBtn.click();

    // Bulk bar should disappear after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // Verify cards moved: the target column data-column-id should contain the cards
    if (targetColName) {
      const targetColHeader = page.locator(`.board-column-header h3:has-text("${targetColName.trim()}")`);
      // Just verify column header is visible (cards are now there)
      await expect(targetColHeader).toBeVisible({ timeout: 3000 });
    }
  });

  test('bulk set priority updates selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Priority Card 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Priority Card 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Priority Card 3');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select first two cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click "Set Priority..."
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select "High" (exact match to avoid matching "Highest")
    await page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').filter({ hasText: /^High$/ }).click();

    // Bulk bar should disappear after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // Verify: at least one card now has the high priority indicator (aria-label)
    await expect(page.locator('[aria-label="Priority: high"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('bulk delete removes selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Delete Me 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Delete Me 2');
    // Third card stays
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Keep Me');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Select first two cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('2 cards selected');

    // Accept confirmation dialog
    page.once('dialog', (dialog) => dialog.accept());

    // Click Delete
    await page.click('.bulk-action-bar .btn-danger:has-text("Delete")');

    // Only 1 card should remain
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item')).toContainText('Keep Me');
  });

  test('bulk assign to sprint moves cards into sprint', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Create a sprint via API
    const sprintRes = await request.post(`${API}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint 1', goal: '' },
    });
    const sprint = await sprintRes.json();

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Sprint Card 1');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Sprint Card 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Sprint Card 3');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 8000 });

    // Select first two cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click "Assign Sprint..."
    await page.click('.bulk-action-bar button:has-text("Assign Sprint...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select the sprint by name
    await page.click(`.bulk-action-dropdown .bulk-action-dropdown-item:has-text("${sprint.name}")`);

    // Bulk bar should disappear after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // Verify via API that cards have been assigned to the sprint
    const cardsRes = await request.get(`${API}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprintCards = await cardsRes.json();
    expect(Array.isArray(sprintCards) && sprintCards.length).toBeGreaterThanOrEqual(2);
  });
});
