import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const API = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(request: any) {
  const email = `priority-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${API}/api/auth/signup`, {
    data: {
      email,
      password: 'password123',
      display_name: `PrioTester-${crypto.randomUUID().slice(0, 8)}`,
    },
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
    data: {
      name: 'Test Lane',
      repo_owner: 'test',
      repo_name: 'repo',
      designator: 'PL-',
      color: '#3b82f6',
    },
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

/** Navigate to the board, inject token, switch to All Cards view, wait for cards. */
async function openBoardAllCards(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 10000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

/** Expand the filter panel if it is not already open. */
async function expandFilters(page: any) {
  const expanded = page.locator('.filters-expanded');
  if (!(await expanded.isVisible())) {
    await page.click('.filter-toggle-btn');
    await expect(expanded).toBeVisible({ timeout: 5000 });
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Card Priority & Ordering', () => {

  // -------------------------------------------------------------------------
  // 1. Priority badge colors — each priority renders a distinct color
  // -------------------------------------------------------------------------
  test('priority badge colors — each non-medium priority has a distinct inline color', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Highest Card', 'highest');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Lowest Card', 'lowest');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 8000 });

    // Each non-medium card should have a .card-priority badge
    const priorityBadges = page.locator('.card-priority');
    await expect(priorityBadges).toHaveCount(4, { timeout: 5000 });

    // Collect the inline color values; they must all be distinct
    const colors = await priorityBadges.evaluateAll((els: HTMLElement[]) =>
      els.map((el) => el.style.color),
    );
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 2. Priority visible on board card without opening modal
  // -------------------------------------------------------------------------
  test('priority indicator is visible on the board card without opening modal', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Visible Priority Card', 'high');

    await openBoardAllCards(page, token, board.id);

    // aria-label is set directly on the card-priority span — no click needed
    const badge = page.locator('[aria-label="Priority: high"]');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Modal must not have opened
    await expect(page.locator('.card-detail-modal-unified, .modal.card-modal')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 3. Priority filter — high only
  // -------------------------------------------------------------------------
  test('priority filter — selecting high shows only high-priority cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toBeVisible();
    await prioritySelect.selectOption('high');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Card');
  });

  // -------------------------------------------------------------------------
  // 4. Priority filter — switching between multiple priorities
  // -------------------------------------------------------------------------
  test('priority filter — switching between values correctly narrows the card list', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Highest Card', 'highest');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });

    // Filter to highest — 1 card
    await prioritySelect.selectOption('highest');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Highest Card');

    // Switch to low — different single card
    await prioritySelect.selectOption('low');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Low Card');

    // Clear filter — all 3 cards return
    await prioritySelect.selectOption('');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 5. Sort backlog by priority — verify priority color dots are distinct
  // -------------------------------------------------------------------------
  test('backlog view — priority color dot is rendered per card with distinct colors', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const lowCard = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Prio Card', 'low');
    const highCard = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Prio Card', 'high');

    // Create a sprint and assign both cards to it so they appear in the backlog panel
    const sprintRes = await request.post(`${API}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Alpha', goal: '' },
    });
    const sprint = await sprintRes.json();

    for (const card of [lowCard, highCard]) {
      await request.put(`${API}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: card.title,
          description: card.description || '',
          priority: card.priority,
          story_points: card.story_points ?? null,
          sprint_id: sprint.id,
          column_id: card.column_id,
          swimlane_id: card.swimlane_id,
          position: card.position,
        },
      });
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-header', { timeout: 10000 });

    // Navigate to backlog
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-card')).toHaveCount(2, { timeout: 10000 });

    // Both cards are present
    const cardTitles = await page.locator('.backlog-card .card-title').allTextContents();
    expect(cardTitles).toContain('Low Prio Card');
    expect(cardTitles).toContain('High Prio Card');

    // Priority color dots (.backlog-card-priority) must be present and distinct
    const dots = page.locator('.backlog-card-priority');
    await expect(dots).toHaveCount(2, { timeout: 5000 });
    const dotColors = await dots.evaluateAll((els: HTMLElement[]) =>
      els.map((el) => el.style.backgroundColor),
    );
    expect(new Set(dotColors).size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 6. Bulk set priority — select 3 cards, set to highest
  // -------------------------------------------------------------------------
  test('bulk set priority — all 3 selected cards get the new priority', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 1', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 2', 'medium');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bulk Card 3', 'lowest');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Select all three cards
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(2).locator('.card-select-checkbox input').click({ force: true });

    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bulk-action-count')).toContainText('3 cards selected');

    // Open the "Set Priority..." dropdown
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select "Highest"
    await page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').filter({ hasText: /^Highest$/ }).click();

    // Bulk bar closes after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // All 3 board cards must now show the highest priority badge
    await expect(page.locator('[aria-label="Priority: highest"]')).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 7. Priority change in modal updates board card badge without refresh
  // -------------------------------------------------------------------------
  test('changing priority in card modal updates the board card badge immediately', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Change Priority Card', 'low');

    await openBoardAllCards(page, token, board.id);

    // Verify initial "low" badge
    await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible({ timeout: 5000 });

    // Open the card modal
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });

    // Enter edit mode
    await page.click('button:has-text("Edit")');

    // Locate the priority select (has Highest/High/Medium/Low/Lowest options)
    const prioritySelect = page.locator('select').filter({ has: page.locator('option:text("Highest")') });
    await expect(prioritySelect).toBeVisible({ timeout: 5000 });
    await prioritySelect.selectOption('highest');

    // Save
    await page.click('button:has-text("Save")');
    await page.waitForSelector('.card-detail-meta', { timeout: 5000 });

    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-meta')).not.toBeVisible({ timeout: 5000 });

    // Board badge must reflect the change — no page reload
    await expect(page.locator('[aria-label="Priority: highest"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Priority: low"]')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 8. Priority in card modal — dropdown present, all options available
  // -------------------------------------------------------------------------
  test('card modal shows priority select in edit mode with all options', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Modal Priority Card', 'medium');

    await openBoardAllCards(page, token, board.id);

    // Open card modal
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });

    // View mode shows the badge
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('medium');

    // Enter edit mode
    await page.click('button:has-text("Edit")');

    // Priority select must expose all 5 levels
    const prioritySelect = page.locator('select').filter({ has: page.locator('option:text("Highest")') });
    await expect(prioritySelect).toBeVisible({ timeout: 5000 });
    const optionTexts = await prioritySelect.locator('option').allTextContents();
    expect(optionTexts).toContain('Highest');
    expect(optionTexts).toContain('High');
    expect(optionTexts).toContain('Medium');
    expect(optionTexts).toContain('Low');
    expect(optionTexts).toContain('Lowest');

    // Change to high and save — view mode badge updates
    await prioritySelect.selectOption('high');
    await page.click('button:has-text("Save")');
    await page.waitForSelector('.card-detail-meta', { timeout: 5000 });
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Default priority — newly created card has a priority value
  // -------------------------------------------------------------------------
  test('newly created card defaults to "medium" priority', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Create via quick-add so we test the UI path (BoardView hardcodes priority: 'medium')
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Seed Card', 'medium');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Use the quick-add button to create a second card
    await page.locator('.add-card-btn').first().click();
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.locator('.quick-add-form input[type="text"]').fill('Default Priority Card');
    await page.locator('.quick-add-form button[type="submit"]').click();

    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Open the newly added card's modal to verify it has a priority
    await page.locator('.card-item[aria-label="Default Priority Card"]').click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });

    const priorityBadge = page.locator('.card-detail-meta .card-priority');
    await expect(priorityBadge).toBeVisible({ timeout: 5000 });
    // BoardView passes priority: 'medium' on quick-add
    await expect(priorityBadge).toContainText('medium');
  });

  // -------------------------------------------------------------------------
  // 10. Critical priority styling — "highest" gets the red urgent treatment
  // -------------------------------------------------------------------------
  test('highest priority card displays an urgent red badge color', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Urgent Card', 'highest');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Board badge present with correct aria-label
    const badge = page.locator('[aria-label="Priority: highest"]');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Inline color must be the "highest" red: #dc2626 → rgb(220, 38, 38)
    const color = await badge.evaluate((el: HTMLElement) => el.style.color);
    expect(color).toBe('rgb(220, 38, 38)');

    // Card modal badge carries the priority-highest CSS class
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });
    const modalBadge = page.locator('.card-detail-meta .card-priority');
    await expect(modalBadge).toHaveClass(/priority-highest/);
    await expect(modalBadge).toContainText('highest');
  });

  // -------------------------------------------------------------------------
  // 11. Story points displayed on board card
  // -------------------------------------------------------------------------
  test('story points number appears on the board card when set', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const card = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'SP Card', 'medium', 8);

    // Confirm API response includes story_points
    expect(card.story_points).toBe(8);

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // .card-points on the card itself (not inside a modal) should contain "8"
    const cardItem = page.locator('.card-item[aria-label="SP Card"]');
    await expect(cardItem).toBeVisible();
    const pointsBadge = cardItem.locator('.card-points');
    await expect(pointsBadge).toBeVisible({ timeout: 5000 });
    await expect(pointsBadge).toContainText('8');
  });

  // -------------------------------------------------------------------------
  // 12. Story points filter (via modal edit) — card without points has no badge
  // -------------------------------------------------------------------------
  test('card without story points shows no story points badge on board', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Estimated Card', 'medium', 5);
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unestimated Card', 'medium');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Exactly one .card-points badge across all board cards
    const allPointsBadges = page.locator('.card-item .card-points');
    await expect(allPointsBadges).toHaveCount(1, { timeout: 5000 });
    await expect(allPointsBadges.first()).toContainText('5');

    // The unestimated card must not have a .card-points child
    const unestimatedCard = page.locator('.card-item[aria-label="Unestimated Card"]');
    await expect(unestimatedCard.locator('.card-points')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Bonus: medium priority card has no badge on the board (intentional design)
  // -------------------------------------------------------------------------
  test('medium priority card does not render a priority badge on the board', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // CardItem hides the badge for medium by design
    await expect(page.locator('.card-item .card-priority')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Bonus: clearing priority filter restores all cards
  // -------------------------------------------------------------------------
  test('clearing priority filter via clear-filter button restores all cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Card', 'high');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Card', 'low');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');

    await openBoardAllCards(page, token, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });

    // Apply filter
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Use the clear-filter button
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 3000 });
    await clearBtn.click();

    // All cards return
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
    await expect(prioritySelect).toHaveValue('');
  });
});
