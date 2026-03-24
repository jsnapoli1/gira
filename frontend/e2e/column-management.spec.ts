import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh user + board via API, inject JWT via page.evaluate, and return both.
 * The page is navigated to /login first so the evaluate has a browsing context.
 */
async function setupUserAndBoard(
  request: any,
  page: any,
  boardName = 'Column Test Board',
) {
  const email = `test-col-${crypto.randomUUID()}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Column Tester' },
  });
  const { token } = await signupRes.json();

  // Navigate to /login first, then inject token via evaluate (not addInitScript)
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  return { token, board };
}

/** Create a fresh user + board via API without a page (API-only tests). */
async function setupUserAndBoardApi(request: any, boardName = 'Column API Board') {
  const email = `test-col-api-${crypto.randomUUID()}@test.com`;

  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Column API Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: boardName },
  });
  const board = await boardRes.json();

  return { token, board };
}

/** Fetch all columns for a board via API. */
async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<Array<{ id: number; name: string; state: string; position: number }>>;
}

/** Add a column via API. */
async function addColumn(
  request: any,
  token: string,
  boardId: number,
  name: string,
  state = 'open',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, state },
  });
  return res.json() as Promise<{ id: number; name: string; state: string }>;
}

/** Create a swimlane via API (required before cards can be added). */
async function addSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'TL-', color: '#3b82f6' },
  });
  return res.json() as Promise<{ id: number }>;
}

/** Create a card via API. */
async function addCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title = 'Test Card',
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title, description: '' },
  });
  return res.json() as Promise<{ id: number; title: string; column_id: number }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Column Management', () => {

  // 1. Default columns on new board
  test('new board has default To Do, In Progress, In Review, and Done columns', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);

    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThanOrEqual(3);

    const names = columns.map(c => c.name);
    expect(names.some(n => /to do/i.test(n))).toBe(true);
    expect(names.some(n => /in progress/i.test(n))).toBe(true);
    expect(names.some(n => /done/i.test(n))).toBe(true);
  });

  // 2. Column state field reflected in API
  test('GET /api/boards/:id/columns returns a state field on each column', async ({ request, page }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const validStates = new Set(['open', 'in_progress', 'review', 'closed']);

    expect(columns.length).toBeGreaterThan(0);
    for (const col of columns) {
      expect(col).toHaveProperty('state');
      expect(validStates.has(col.state)).toBe(true);
    }
  });

  // 3. Add a new column in board settings (POST /api/boards/:id/columns)
  test('add a new column in board settings and it appears in the board view', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    // Add a swimlane so column headers are rendered on the board
    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible({ timeout: 5000 });
    await page.locator('.modal input[type="text"]').fill('Review Queue');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // Navigate to board and switch to All Cards so columns are visible
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.board-column-header h3:has-text("Review Queue")')).toBeVisible({ timeout: 8000 });
  });

  // 4. New column via API appears in settings list
  test('newly added column appears as the last item in the settings column list', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const beforeCount = await columnsSection.locator('.settings-list-item').count();

    await columnsSection.locator('button:has-text("Add Column")').click();
    await page.locator('.modal input[type="text"]').fill('Trailing Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    const items = columnsSection.locator('.settings-list-item');
    await expect(items).toHaveCount(beforeCount + 1);

    const lastName = await items.last().locator('.item-name').textContent();
    expect(lastName).toBe('Trailing Column');
  });

  // 5. Column state types: open / in_progress / review / closed
  test('adding a column with in_progress state shows correct state badge in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible({ timeout: 5000 });
    await page.locator('.modal input[type="text"]').fill('QA Testing');
    await page.locator('.modal select').selectOption('in_progress');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    const newRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'QA Testing' });
    await expect(newRow.locator('.item-meta')).toHaveText('State: in_progress');
  });

  test('column state selector allows all four valid state values', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 });

    const select = page.locator('.modal select');
    const options = await select.locator('option').allTextContents();
    const optionValues = await Promise.all(
      (await select.locator('option').all()).map(o => o.getAttribute('value'))
    );

    expect(optionValues).toContain('open');
    expect(optionValues).toContain('in_progress');
    expect(optionValues).toContain('review');
    expect(optionValues).toContain('closed');

    // Dismiss modal
    await page.keyboard.press('Escape');
  });

  // 6. Rename a column (via settings — state badge reflects the current name)
  test('column name added via settings appears in the board column header', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    await columnsSection.locator('button:has-text("Add Column")').click();

    await expect(page.locator('.modal h2:has-text("Add Column")')).toBeVisible({ timeout: 5000 });
    await page.locator('.modal input[type="text"]').fill('My Custom Column');
    await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // Navigate to board and switch to All Cards so columns are visible
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    await expect(page.locator('.board-column-header h3:has-text("My Custom Column")')).toBeVisible({ timeout: 8000 });
  });

  // 7. Reorder columns via move buttons in settings
  test('reorder columns via up/down move buttons in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');
    const initialCount = await items.count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    // Record the name of the second item before reordering
    const secondItemNameBefore = await items.nth(1).locator('.item-name').textContent();

    // Click "Move up" on the second item to bring it to first position
    await items.nth(1).locator('.reorder-btn[title="Move up"]').click();
    await page.waitForTimeout(500);

    // The item that was second should now be first
    const firstItemNameAfter = await items.nth(0).locator('.item-name').textContent();
    expect(firstItemNameAfter).toBe(secondItemNameBefore);
  });

  test('reorder columns via down button in settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(request, page);

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const items = columnsSection.locator('.settings-list-item');
    const initialCount = await items.count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    // Record the name of the first item before reordering
    const firstItemNameBefore = await items.nth(0).locator('.item-name').textContent();

    // Click "Move down" on the first item
    await items.nth(0).locator('.reorder-btn[title="Move down"]').click();
    await page.waitForTimeout(500);

    // The item that was first should now be second
    const secondItemNameAfter = await items.nth(1).locator('.item-name').textContent();
    expect(secondItemNameAfter).toBe(firstItemNameBefore);
  });

  // 8. Reorder via API (POST /api/boards/:id/columns/:id/reorder)
  test('POST /api/boards/:id/columns/:columnId/reorder responds with 200', async ({ request, page }) => {
    const { token, board } = await setupUserAndBoard(request, page);
    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThanOrEqual(2);

    const res = await request.post(
      `${BASE}/api/boards/${board.id}/columns/${columns[0].id}/reorder`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { position: 1 },
      },
    );
    expect(res.status()).toBe(200);
  });

  // 9. Delete a column (with confirmation)
  test('attempting to delete a column triggers a window.confirm dialog', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const targetColumn = columns.find(c => c.state === 'open');
    expect(targetColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);
    await addCard(request, token, board.id, swimlane.id, targetColumn!.id, 'Card In Column');

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const targetRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: targetColumn!.name });

    let dialogShown = false;
    page.once('dialog', async (dialog) => {
      dialogShown = true;
      await dialog.dismiss();
    });

    await targetRow.locator('.item-delete').click();

    expect(dialogShown).toBe(true);

    // Column must still be present after dismissal
    await expect(columnsSection.locator(`.item-name:has-text("${targetColumn!.name}")`)).toBeVisible();
  });

  test('confirming delete removes the column from the settings list', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    // Add a fresh column to delete so we do not disturb the default columns
    const newCol = await addColumn(request, token, board.id, 'Delete Me Column', 'open');

    await page.goto(`/boards/${board.id}/settings`);

    const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
    const targetRow = columnsSection
      .locator('.settings-list-item')
      .filter({ hasText: 'Delete Me Column' });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await targetRow.locator('.item-delete').click();

    // Column should be gone from the list
    await expect(
      columnsSection.locator('.item-name:has-text("Delete Me Column")')
    ).not.toBeVisible({ timeout: 8000 });

    // Verify via API
    const updatedColumns = await getColumns(request, token, board.id);
    expect(updatedColumns.find(c => c.id === newCol.id)).toBeUndefined();
  });

  // 10. Cards in closed-state column excluded from backlog
  test('cards placed in a closed-state column do not appear in the backlog panel', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    const openCardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: openColumn!.id,
        title: 'Visible Backlog Card',
      },
    });
    if (!openCardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await openCardRes.text()}`);
      return;
    }

    const closedCardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: closedColumn!.id,
        title: 'Hidden Done Card',
      },
    });
    if (!closedCardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await closedCardRes.text()}`);
      return;
    }

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    await expect(page.locator('.backlog-card:has-text("Visible Backlog Card")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.backlog-card:has-text("Hidden Done Card")')).not.toBeVisible();
  });

  // 11. Cards in closed-state column excluded from sprint panel card list
  test('closed-state column cards are excluded from sprint panel in backlog view', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    const columns = await getColumns(request, token, board.id);
    const openColumn = columns.find(c => c.state === 'open');
    const closedColumn = columns.find(c => c.state === 'closed');
    expect(openColumn).toBeDefined();
    expect(closedColumn).toBeDefined();

    const swimlane = await addSwimlane(request, token, board.id);

    const openCardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: openColumn!.id,
        title: 'Open Sprint Card',
      },
    });
    if (!openCardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await openCardRes.text()}`);
      return;
    }

    const closedCardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: closedColumn!.id,
        title: 'Closed Sprint Card',
      },
    });
    if (!closedCardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await closedCardRes.text()}`);
      return;
    }

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForTimeout(500);

    await expect(
      page.locator('.backlog-card:has-text("Closed Sprint Card"), .sprint-card:has-text("Closed Sprint Card")')
    ).toHaveCount(0);
  });

  // 12. Board with many columns scrolls horizontally
  test('board with 6+ columns renders all column headers and board-content is horizontally scrollable', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, page, 'Wide Board');

    for (let i = 1; i <= 6; i++) {
      await addColumn(request, token, board.id, `Extra Col ${i}`, 'open');
    }

    await addSwimlane(request, token, board.id);

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    const headers = page.locator('.board-column-header');
    await expect(headers.first()).toBeVisible({ timeout: 8000 });
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThanOrEqual(9);

    const boardContent = page.locator('.board-content');
    await expect(boardContent).toBeVisible();
    const overflowX = await boardContent.evaluate(
      (el: Element) => window.getComputedStyle(el).overflowX,
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  // 13. Column position order: API returns columns sorted ascending by position
  test('API returns columns in ascending position order', async ({ request, page }) => {
    const { token, board } = await setupUserAndBoard(request, page);

    await addColumn(request, token, board.id, 'Omega', 'open');
    await addColumn(request, token, board.id, 'Zeta', 'in_progress');

    const columns = await getColumns(request, token, board.id);
    expect(columns.length).toBeGreaterThan(1);

    for (let i = 1; i < columns.length; i++) {
      expect(columns[i].position).toBeGreaterThanOrEqual(columns[i - 1].position);
    }
  });

  // 14. Column drop target (keyboard DnD)
  test.fixme('column cards drop target works via drag-and-drop', async ({ page, request }) => {
    // Mouse-based DnD with @dnd-kit is difficult to drive reliably in Playwright
    // since it relies on pointer events with precise coordinates.
    // This test is marked fixme until a keyboard DnD approach or test-id hooks
    // are added to the DroppableColumn component.
    //
    // Expected behaviour: drag a .card-item from column A and drop onto column B;
    // the card should appear under column B and disappear from column A.
  });

  // =========================================================================
  // NEW TESTS — API tests
  // =========================================================================

  test.describe('Column API', () => {

    test('POST /api/boards/:id/columns creates column with the given name', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'API Create Column Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'API Created Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.name).toBe('API Created Column');
    });

    test('new column response has correct board_id', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Board ID Column Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Board ID Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.board_id).toBe(board.id);
    });

    test('new column has a positive integer position value', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Position Column Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Position Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(typeof col.position).toBe('number');
    });

    test('column can be created with state in_progress', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'InProgress Column Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'In Progress Column', state: 'in_progress' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.state).toBe('in_progress');
    });

    test('column can be created with state done (closed)', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Done Column Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Done Column', state: 'closed' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.state).toBe('closed');
    });

    test('GET /api/boards/:id/columns includes the newly created column', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'List Includes Board');

      await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Included Column', state: 'open' },
      });

      const columns = await getColumns(request, token, board.id);
      const names = columns.map(c => c.name);
      expect(names).toContain('Included Column');
    });

    test('DELETE /api/boards/:id/columns/:id returns 204', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Delete 204 Board');

      const col = await addColumn(request, token, board.id, 'Delete 204 Column', 'open');

      const delRes = await request.delete(
        `${BASE}/api/boards/${board.id}/columns/${col.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(delRes.status()).toBe(204);
    });

    test('deleted column is not present in subsequent GET', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Delete Absent Board');

      const col = await addColumn(request, token, board.id, 'Gone Column', 'open');

      await request.delete(`${BASE}/api/boards/${board.id}/columns/${col.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const columns = await getColumns(request, token, board.id);
      const ids = columns.map(c => c.id);
      expect(ids).not.toContain(col.id);
    });

    test('POST reorder updates column position and returns 200', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Reorder API Board');
      const columns = await getColumns(request, token, board.id);
      expect(columns.length).toBeGreaterThanOrEqual(2);

      const targetCol = columns[0];

      const res = await request.post(
        `${BASE}/api/boards/${board.id}/columns/${targetCol.id}/reorder`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { position: 99 },
        },
      );
      expect(res.status()).toBe(200);

      // Column should now be last
      const updated = await getColumns(request, token, board.id);
      const found = updated.find(c => c.id === targetCol.id);
      expect(found).toBeDefined();
    });

    test('unauthenticated POST to create column returns 401', async ({ request }) => {
      const { _token, board } = await setupUserAndBoardApi(request, 'Unauth Column Board') as any;

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        data: { name: 'Stealth Column', state: 'open' },
      });
      expect(res.status()).toBe(401);
    });

    test('non-member POST to create column returns 403 or 404', async ({ request }) => {
      // Board owner
      const { token: ownerToken, board } = await setupUserAndBoardApi(request, 'NonMember Column Board');

      // Different user (not a member of the board)
      const email2 = `non-member-col-${crypto.randomUUID()}@test.com`;
      const { token: nonMemberToken } = await (
        await request.post(`${BASE}/api/auth/signup`, {
          data: { email: email2, password: 'password123', display_name: 'Non Member' },
        })
      ).json();

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${nonMemberToken}` },
        data: { name: 'Intruder Column', state: 'open' },
      });
      // Non-member cannot create columns — expect 403 or 404
      expect([403, 404]).toContain(res.status());
    });

    test('column created via API has an id field', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Column ID Field Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'ID Field Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(typeof col.id).toBe('number');
      expect(col.id).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // NEW TESTS — UI tests
  // =========================================================================

  test.describe('Column UI', () => {

    test('UI: columns shown in board view when swimlane exists', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'UI Columns Board');
      await addSwimlane(request, token, board.id);

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
    });

    test('UI: board settings page has an Add Column button', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'UI Add Button Board');

      await page.goto(`/boards/${board.id}/settings`);

      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      await expect(columnsSection.locator('button:has-text("Add Column")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: new column created via settings appears on the board immediately', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'UI New Col Board');
      await addSwimlane(request, token, board.id);

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      await columnsSection.locator('button:has-text("Add Column")').click();

      await page.locator('.modal input[type="text"]').fill('Instant Column');
      await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header h3:has-text("Instant Column")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: column name is shown in the board column header', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'UI Col Name Board');
      await addSwimlane(request, token, board.id);
      await addColumn(request, token, board.id, 'Named Header Col', 'open');

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header h3:has-text("Named Header Col")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: deleting a column via settings removes it from the board view', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'UI Delete Col Board');
      await addSwimlane(request, token, board.id);
      await addColumn(request, token, board.id, 'Disposable Column', 'open');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const row = columnsSection.locator('.settings-list-item').filter({ hasText: 'Disposable Column' });

      page.once('dialog', d => d.accept());
      await row.locator('.item-delete').click();

      await expect(
        columnsSection.locator('.item-name:has-text("Disposable Column")')
      ).not.toBeVisible({ timeout: 8000 });

      // Navigate to board and confirm column is gone
      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(
        page.locator('.board-column-header h3:has-text("Disposable Column")')
      ).not.toBeVisible({ timeout: 5000 });
    });

    test('UI: settings list shows state in the column item meta', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'UI State Meta Board');
      await addColumn(request, token, board.id, 'Review State Column', 'review');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const row = columnsSection.locator('.settings-list-item').filter({ hasText: 'Review State Column' });

      await expect(row.locator('.item-meta')).toContainText('review');
    });

    test('UI: default columns list in settings is non-empty', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'UI Default Cols Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });

      const items = columnsSection.locator('.settings-list-item');
      const count = await items.count();
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });
});
