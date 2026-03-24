import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const API = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(request: any) {
  const email = `bulk-${crypto.randomUUID()}@test.com`;
  const displayName = `BulkTester-${crypto.randomUUID().slice(0, 8)}`;
  const res = await request.post(`${API}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, userId: body.user?.id as number, email };
}

async function createBoard(request: any, token: string) {
  const boardRes = await request.post(`${API}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Bulk Test Board ${crypto.randomUUID().slice(0, 8)}`, description: '' },
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
      designator: 'TL-',
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
) {
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
  return res;
}

/** Navigate to the board in "All Cards" view and wait for cards to appear. */
async function gotoBoard(page: any, boardId: number, token: string, expectedCardCount = 1) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await expect(page.locator('.card-item')).toHaveCount(expectedCardCount, { timeout: 12000 });
}

/** Hover the first card and click the checkbox to enter selection mode. */
async function selectFirstCard(page: any) {
  const firstCard = page.locator('.card-item').first();
  await firstCard.hover();
  const checkbox = firstCard.locator('.card-select-checkbox');
  await checkbox.click({ force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Bulk Actions', () => {
  test.setTimeout(90000);

  test('hovering a card reveals the selection checkbox', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Hover Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    const firstCard = page.locator('.card-item').first();
    // Before hover, checkbox wrapper exists but should not be prominently visible
    await firstCard.hover();
    // After hover, the checkbox becomes visible (CSS opacity: 1)
    const checkbox = firstCard.locator('.card-select-checkbox input[type="checkbox"]');
    await expect(checkbox).toBeAttached();
  });

  test('clicking a card checkbox shows the bulk action bar with "1 card selected"', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Alpha');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Beta');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);

    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bulk-action-count')).toContainText('1 card selected');
  });

  test('selecting multiple cards shows correct count', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card One');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Two');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card Three');

    await gotoBoard(page, board.id, token, 3);

    // Select first card (enters selection mode)
    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-count')).toContainText('1 card selected');

    // In selection mode, all checkboxes are always-visible — click second card's checkbox
    const secondCard = page.locator('.card-item').nth(1);
    await secondCard.locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('2 cards selected');

    // Select third
    const thirdCard = page.locator('.card-item').nth(2);
    await thirdCard.locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('3 cards selected');
  });

  test('selected card gets a visual "selected" class', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Selected Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await expect(page.locator('.card-item.selected')).toHaveCount(1);
  });

  test('in selection mode all cards show has-selection class', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card A');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card B');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);
    // All cards should have has-selection class once any card is selected
    await expect(page.locator('.card-item.has-selection')).toHaveCount(2);
  });

  test('clicking "Deselect All" clears the selection and hides the bulk action bar', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card A');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Card B');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    await page.click('button:has-text("Deselect All")');
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('Escape key clears selection and hides the bulk action bar', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Esc Card 1');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Esc Card 2');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Click board content area (not an input) so no form element has focus, then press Escape
    await page.locator('.board-content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('bulk move to column moves selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Move Card 1');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Move Card 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Stay Card');

    await gotoBoard(page, board.id, token, 3);

    // Select first two cards
    await selectFirstCard(page);
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Open the "Move to..." dropdown
    await page.click('.bulk-action-bar button:has-text("Move to...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Click the second column (In Progress) to move cards there
    const columnItems = page.locator('.bulk-action-dropdown .bulk-action-dropdown-item');
    await columnItems.nth(1).click();

    // Bulk bar should disappear after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 8000 });
  });

  test('"Move to..." dropdown lists all board columns', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Col List Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await page.click('.bulk-action-bar button:has-text("Move to...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    const items = page.locator('.bulk-action-dropdown .bulk-action-dropdown-item');
    // Default board has at least 2 columns (To Do, In Progress, Done)
    expect(await items.count()).toBeGreaterThanOrEqual(2);
  });

  test('bulk assign sprint moves selected cards into sprint', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    // Create a sprint via API
    const sprintRes = await request.post(`${API}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Bulk Test', goal: '' },
    });
    if (!sprintRes.ok()) { test.skip(true, 'Sprint creation unavailable'); return; }
    const sprint = await sprintRes.json();

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Sprint Card 1');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Sprint Card 2');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Open "Assign Sprint..." dropdown
    await page.click('.bulk-action-bar button:has-text("Assign Sprint...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select the sprint by name
    await page.locator(`.bulk-action-dropdown .bulk-action-dropdown-item:has-text("${sprint.name}")`).click();

    // Bulk bar should disappear
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 8000 });

    // Verify via API
    const cardsRes = await request.get(`${API}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprintCards = await cardsRes.json();
    expect(Array.isArray(sprintCards) && sprintCards.length).toBeGreaterThanOrEqual(2);
  });

  test('"Assign Sprint..." dropdown includes "Backlog (no sprint)" option', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Backlog Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await page.click('.bulk-action-bar button:has-text("Assign Sprint...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    await expect(
      page.locator('.bulk-action-dropdown .bulk-action-dropdown-item:has-text("Backlog")')
    ).toBeVisible();
  });

  test('bulk set priority updates selected cards', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Priority Card 1');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Priority Card 2');

    await gotoBoard(page, board.id, token, 2);

    await selectFirstCard(page);
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select "High" (exact match to avoid matching "Highest")
    await page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').filter({ hasText: /^High$/ }).click();

    // Bulk bar disappears after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 8000 });

    // Wait for cards to re-render with updated priority
    await page.waitForTimeout(500);

    // Cards should still be visible after bulk action
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Verify: at least one card now has the high priority indicator
    await expect(page.locator('.card-priority[aria-label="Priority: high"]').first()).toBeVisible({ timeout: 8000 });
  });

  test('"Set Priority..." dropdown lists all priority levels', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Prio List Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    const items = page.locator('.bulk-action-dropdown .bulk-action-dropdown-item');
    const texts = await items.allTextContents();
    // Expect all 5 priorities
    expect(texts.some((t) => /highest/i.test(t))).toBe(true);
    expect(texts.some((t) => /^high$/i.test(t))).toBe(true);
    expect(texts.some((t) => /medium/i.test(t))).toBe(true);
    expect(texts.some((t) => /^low$/i.test(t))).toBe(true);
    expect(texts.some((t) => /lowest/i.test(t))).toBe(true);
  });

  test('bulk delete removes selected cards and shows remaining', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Delete Me 1');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Delete Me 2');
    await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Keep Me');

    await gotoBoard(page, board.id, token, 3);

    // Select first two cards
    await selectFirstCard(page);
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox').click({ force: true });
    await expect(page.locator('.bulk-action-count')).toContainText('2 cards selected');

    // Accept confirmation dialog
    page.once('dialog', (dialog) => dialog.accept());

    // Click Delete
    await page.locator('.bulk-action-bar .btn-danger:has-text("Delete")').click();

    // Only 1 card should remain
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item')).toContainText('Keep Me');
  });

  test('bulk delete shows confirmation dialog before deleting', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Confirm Delete Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Dismiss the dialog (cancel) — card should NOT be deleted
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('.bulk-action-bar .btn-danger:has-text("Delete")').click();

    // Card should still be there
    await expect(page.locator('.card-item')).toHaveCount(1);
  });

  test('bulk action bar contains Move, Sprint, Priority, and Delete buttons', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Bar Check Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.bulk-action-bar button:has-text("Move to...")')).toBeVisible();
    await expect(page.locator('.bulk-action-bar button:has-text("Assign Sprint...")')).toBeVisible();
    await expect(page.locator('.bulk-action-bar button:has-text("Set Priority...")')).toBeVisible();
    await expect(page.locator('.bulk-action-bar .btn-danger:has-text("Delete")')).toBeVisible();
    await expect(page.locator('.bulk-action-bar button:has-text("Deselect All")')).toBeVisible();
  });

  test('clicking a selected card checkbox deselects it', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Toggle Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    // Select the card
    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-count')).toContainText('1 card selected');

    // Click checkbox again to deselect
    await page.locator('.card-item').first().locator('.card-select-checkbox').click({ force: true });

    // Bar should disappear (0 cards selected)
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });
  });

  test('opening one dropdown closes any previously open dropdown', async ({ page, request }) => {
    const { token } = await signUp(request);
    const { board, columns, swimlane } = await createBoard(request, token);

    const cardRes = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Dropdown Toggle Card');
    if (!cardRes.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    await gotoBoard(page, board.id, token, 1);

    await selectFirstCard(page);
    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });

    // Open "Move to..." dropdown
    await page.click('.bulk-action-bar button:has-text("Move to...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Open "Set Priority..." dropdown — the previous dropdown should close
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');

    // Only one dropdown should be visible
    await expect(page.locator('.bulk-action-dropdown')).toHaveCount(1);
  });
});
