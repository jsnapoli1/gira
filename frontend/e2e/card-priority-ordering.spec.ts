import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const API = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(request: any) {
  const email = `priority-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${API}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `PriorityTester-${crypto.randomUUID().slice(0, 8)}` },
  });
  const body = await res.json();
  return { token: body.token as string, userId: body.user?.id as number };
}

async function createBoard(request: any, token: string) {
  const boardRes = await request.post(`${API}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Priority Board ${crypto.randomUUID().slice(0, 8)}`, description: '' },
  });
  const board = await boardRes.json();

  const colRes = await request.get(`${API}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columns = await colRes.json();

  const slRes = await request.post(`${API}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', repo_owner: 'test', repo_name: 'repo', designator: 'PL-', color: '#3b82f6' },
  });
  const swimlane = await slRes.json();

  return { board, columns, swimlane };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
  priority: string = 'medium',
  storyPoints?: number,
) {
  const data: Record<string, any> = {
    board_id: boardId,
    swimlane_id: swimlaneId,
    column_id: columnId,
    title,
    description: '',
    priority,
  };
  if (storyPoints !== undefined) {
    data.story_points = storyPoints;
  }
  const res = await request.post(`${API}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return res.json();
}

/** Navigate to the board and switch to All Cards view. */
async function openBoardAllCards(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 10000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Card Priority & Story Points', () => {
  // -------------------------------------------------------------------------
  // 1. Priority badge visible on board card
  // -------------------------------------------------------------------------
  test('priority badge shows on board card for non-medium priorities', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Highest Card', 'highest');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    // All 4 cards should be visible
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 8000 });

    // Non-medium cards have a .card-priority badge with aria-label
    await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Priority: high"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Priority: highest"]')).toBeVisible({ timeout: 5000 });

    // Medium card should NOT have a priority badge (medium is intentionally hidden on cards)
    const mediumCard = page.locator('.card-item[aria-label="Medium Card"]');
    await expect(mediumCard).toBeVisible();
    await expect(mediumCard.locator('.card-priority')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Priority visible in card modal (view mode)
  // -------------------------------------------------------------------------
  test('card modal shows current priority', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Modal Card', 'high');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    // Open the card modal
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified, .modal', { timeout: 8000 });

    // The view-mode meta row shows <span class="card-priority priority-high">high</span>
    const priorityBadge = page.locator('.card-detail-meta .card-priority');
    await expect(priorityBadge).toBeVisible({ timeout: 5000 });
    await expect(priorityBadge).toHaveClass(/priority-high/);
    await expect(priorityBadge).toContainText('high');
  });

  // -------------------------------------------------------------------------
  // 3. Change priority in modal updates the board card badge
  // -------------------------------------------------------------------------
  test('changing priority in modal updates the card badge', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Change Priority Card', 'low');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    // Original badge shows "low"
    await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible({ timeout: 5000 });

    // Open modal and switch to edit mode
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified, .modal', { timeout: 8000 });
    await page.click('button:has-text("Edit")');

    // Change priority via the select in edit mode
    const prioritySelect = page.locator('select').filter({ has: page.locator('option:text("Highest")') });
    await expect(prioritySelect).toBeVisible({ timeout: 5000 });
    await prioritySelect.selectOption('highest');

    // Save the card
    await page.click('button:has-text("Save")');
    await page.waitForSelector('.card-detail-meta', { timeout: 5000 });

    // Close the modal
    await page.keyboard.press('Escape');

    // Board card should now show "highest" priority badge
    await expect(page.locator('[aria-label="Priority: highest"]')).toBeVisible({ timeout: 5000 });
    // "low" badge should be gone
    await expect(page.locator('[aria-label="Priority: low"]')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 4. Priority filter — high only
  // -------------------------------------------------------------------------
  test('priority filter shows only high priority cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Highest Card', 'highest');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 8000 });

    // Open the filter panel
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    // Select "high" from priority filter
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toBeVisible();
    await prioritySelect.selectOption('high');

    // Only the "High Card" should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Card');
  });

  // -------------------------------------------------------------------------
  // 5. Priority filter — clear restores all cards
  // -------------------------------------------------------------------------
  test('clearing priority filter shows all cards again', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Apply priority filter
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Clear the filter using the clear button
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();

    // All 3 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Priority select should be reset to empty
    await expect(prioritySelect).toHaveValue('');
  });

  // -------------------------------------------------------------------------
  // 6. Bulk set priority — select 3 cards, set to highest
  // -------------------------------------------------------------------------
  test('bulk set priority updates all selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 1', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 2', 'medium');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 3', 'low');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Select all three cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });

    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(2).locator('.card-select-checkbox input').click({ force: true });

    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bulk-action-count')).toContainText('3 cards selected');

    // Open the Set Priority dropdown
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select "Highest"
    await page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').filter({ hasText: /^Highest$/ }).click();

    // Bulk bar should disappear after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // All cards should now show the "highest" priority badge
    await expect(page.locator('[aria-label="Priority: highest"]')).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 7. Default priority on new card (quick-add)
  // -------------------------------------------------------------------------
  test('quick-add card has a default priority set', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Create at least one card so the board renders in All Cards view
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Existing Card', 'medium');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Click the add-card button in the first column
    await page.locator('.add-card-btn').first().click();
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    const titleInput = page.locator('.quick-add-form input[type="text"]');
    await titleInput.fill('Quick Added Card');
    await page.locator('.quick-add-form button[type="submit"]').click();

    // Wait for the new card to appear
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Open the new card via its title
    await page.locator('.card-item[aria-label="Quick Added Card"]').click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });

    // The modal should show a priority badge (default is "medium")
    const priorityBadge = page.locator('.card-detail-meta .card-priority');
    await expect(priorityBadge).toBeVisible({ timeout: 5000 });
    await expect(priorityBadge).toContainText('medium');
  });

  // -------------------------------------------------------------------------
  // 8. Story points displayed on board card
  // -------------------------------------------------------------------------
  test('story points appear on board card', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const card = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Points Card', 'medium', 5);

    // Verify the card was created with story_points via API
    expect(card.story_points).toBe(5);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // The .card-points element on the card should show "5"
    const cardItem = page.locator('.card-item[aria-label="Points Card"]');
    await expect(cardItem).toBeVisible();
    const pointsBadge = cardItem.locator('.card-points');
    await expect(pointsBadge).toBeVisible({ timeout: 5000 });
    await expect(pointsBadge).toContainText('5');
  });

  // -------------------------------------------------------------------------
  // 9. Story points in card modal — show and update
  // -------------------------------------------------------------------------
  test('story points input in modal persists change', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'SP Modal Card', 'medium', 3);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    // Open the card
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified, .modal', { timeout: 8000 });

    // View mode shows "3 pts"
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('3');

    // Enter edit mode
    await page.click('button:has-text("Edit")');

    // The story points input is inside a .form-group with a "Story Points" label
    const storyPointsInput = page.locator('.form-group').filter({ has: page.locator('label:has-text("Story Points")') }).locator('input[type="number"]');
    await storyPointsInput.fill('8');

    // Save
    await page.click('button:has-text("Save")');
    await page.waitForSelector('.card-detail-meta', { timeout: 5000 });

    // Modal view mode should now show "8 pts"
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('8', { timeout: 5000 });

    // Close modal and verify board card shows "8"
    await page.keyboard.press('Escape');
    const pointsBadge = page.locator('.card-item .card-points');
    await expect(pointsBadge).toContainText('8', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 10. Highest priority styling — card-priority element present with right color
  // -------------------------------------------------------------------------
  test('highest priority card has a priority badge with the correct color', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Highest Card', 'highest');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await openBoardAllCards(page, board.id);

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // The badge should exist with aria-label
    const badge = page.locator('[aria-label="Priority: highest"]');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // The badge carries an inline color style (#dc2626 = red)
    const color = await badge.evaluate((el) => (el as HTMLElement).style.color);
    expect(color).toBe('rgb(220, 38, 38)');

    // In the card modal, the priority badge should have class "priority-highest"
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });
    const modalBadge = page.locator('.card-detail-meta .card-priority');
    await expect(modalBadge).toHaveClass(/priority-highest/);
    await expect(modalBadge).toContainText('highest');
  });
});
