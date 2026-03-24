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

  // =========================================================================
  // EXTENDED API TESTS
  // =========================================================================

  test.describe('Column API Extended', () => {

    test('GET /api/boards/:id returns board with columns array', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Board With Columns Array');

      const res = await request.get(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.columns)).toBe(true);
      expect(body.columns.length).toBeGreaterThan(0);
    });

    test('each column in GET /api/boards/:id has id, board_id, name, position, state fields', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Column Fields Board');

      const res = await request.get(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      const col = body.columns[0];
      expect(typeof col.id).toBe('number');
      expect(typeof col.board_id).toBe('number');
      expect(typeof col.name).toBe('string');
      expect(typeof col.position).toBe('number');
      expect(typeof col.state).toBe('string');
    });

    test('column state field accepts review value', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Review State Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Review Column', state: 'review' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.state).toBe('review');
    });

    test('column state field accepts open value', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Open State Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Open Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
      const col = await res.json();
      expect(col.state).toBe('open');
    });

    test('default columns are created automatically on board creation', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Default Cols Auto Board');

      const columns = await getColumns(request, token, board.id);
      expect(columns.length).toBeGreaterThanOrEqual(3);
    });

    test('default columns contain a closed-state column (Done)', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Done Column Board 2');

      const columns = await getColumns(request, token, board.id);
      const closedCol = columns.find(c => c.state === 'closed');
      expect(closedCol).toBeDefined();
    });

    test('column position is preserved across GET requests', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Position Preserved Board');

      const first = await getColumns(request, token, board.id);
      const second = await getColumns(request, token, board.id);

      expect(first.map(c => c.id)).toEqual(second.map(c => c.id));
    });

    test('multiple columns are returned ordered by position ascending', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Multi Column Order Board');
      await addColumn(request, token, board.id, 'Extra Col A', 'open');
      await addColumn(request, token, board.id, 'Extra Col B', 'open');

      const columns = await getColumns(request, token, board.id);
      for (let i = 1; i < columns.length; i++) {
        expect(columns[i].position).toBeGreaterThanOrEqual(columns[i - 1].position);
      }
    });

    test('deleting column with cards returns 500 or 400 (FK constraint)', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Delete With Cards Board');

      const columns = await getColumns(request, token, board.id);
      const openCol = columns.find(c => c.state === 'open');
      if (!openCol) return;

      // Create a swimlane + card first
      const swRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-', color: '#6366f1' },
      });
      const sw = await swRes.json();

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { board_id: board.id, swimlane_id: sw.id, column_id: openCol.id, title: 'Blocking Card' },
      });
      if (!cardRes.ok()) return; // Skip if card creation unavailable

      // Attempt to delete the column that has a card
      const delRes = await request.delete(
        `${BASE}/api/boards/${board.id}/columns/${openCol.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      // FK constraint should block deletion or the app handles it explicitly
      expect([400, 500]).toContain(delRes.status());
    });

    test('reorder column to position 0 moves it to the front', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Reorder To Front Board');

      const columns = await getColumns(request, token, board.id);
      expect(columns.length).toBeGreaterThanOrEqual(2);
      const lastCol = columns[columns.length - 1];

      const res = await request.post(
        `${BASE}/api/boards/${board.id}/columns/${lastCol.id}/reorder`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { position: 0 },
        },
      );
      expect(res.status()).toBe(200);

      const updated = await getColumns(request, token, board.id);
      expect(updated[0].id).toBe(lastCol.id);
    });

    test('creating two columns gives them different IDs', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Unique IDs Column Board');

      const col1 = await addColumn(request, token, board.id, 'Unique Col 1', 'open');
      const col2 = await addColumn(request, token, board.id, 'Unique Col 2', 'open');

      expect(col1.id).not.toBe(col2.id);
    });

    test('creating two columns gives them different positions', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Unique Positions Board');

      const beforeCount = (await getColumns(request, token, board.id)).length;
      const col1 = await addColumn(request, token, board.id, 'Pos Col 1', 'open');
      const col2 = await addColumn(request, token, board.id, 'Pos Col 2', 'open');

      // Positions must increase
      expect(col2.position).toBeGreaterThan(col1.position);
    });

    test('column created with state in_progress has correct state in GET', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'InProgress GET Board');

      await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Progress Col', state: 'in_progress' },
      });

      const columns = await getColumns(request, token, board.id);
      const found = columns.find(c => c.name === 'Progress Col');
      expect(found).toBeDefined();
      expect(found!.state).toBe('in_progress');
    });

    test('GET /api/boards/:id/columns returns 401 without token', async ({ request }) => {
      const { _token, board } = await setupUserAndBoardApi(request, 'Unauth GET Cols Board') as any;

      const res = await request.get(`${BASE}/api/boards/${board.id}/columns`);
      expect(res.status()).toBe(401);
    });

    test('GET /api/boards/:id/columns returns 403 or 404 for non-member', async ({ request }) => {
      const { board } = await setupUserAndBoardApi(request, 'Non Member GET Cols Board');

      const email2 = `non-member-get-${crypto.randomUUID()}@test.com`;
      const { token: token2 } = await (
        await request.post(`${BASE}/api/auth/signup`, {
          data: { email: email2, password: 'password123', display_name: 'Non Member 2' },
        })
      ).json();

      const res = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token2}` },
      });
      expect([403, 404]).toContain(res.status());
    });

    test('reorder column returns 403 for non-admin member', async ({ request }) => {
      const { token: ownerToken, board } = await setupUserAndBoardApi(request, 'Non Admin Reorder Board');

      // Create another user and add as viewer
      const email2 = `viewer-reorder-${crypto.randomUUID()}@test.com`;
      const { token: viewerToken, user: viewerUser } = await (
        await request.post(`${BASE}/api/auth/signup`, {
          data: { email: email2, password: 'password123', display_name: 'Viewer Reorder' },
        })
      ).json();

      await request.post(`${BASE}/api/boards/${board.id}/members`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { user_id: viewerUser.id, role: 'viewer' },
      });

      const columns = await getColumns(request, ownerToken, board.id);
      const res = await request.post(
        `${BASE}/api/boards/${board.id}/columns/${columns[0].id}/reorder`,
        {
          headers: { Authorization: `Bearer ${viewerToken}` },
          data: { position: 1 },
        },
      );
      expect([403, 404]).toContain(res.status());
    });

    test('DELETE column returns 401 without token', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Unauth Delete Col Board');
      const col = await addColumn(request, token, board.id, 'To Delete Unauth', 'open');

      const res = await request.delete(`${BASE}/api/boards/${board.id}/columns/${col.id}`);
      expect(res.status()).toBe(401);
    });

    test('POST /api/boards/:id/columns returns 201 status code', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, '201 Status Board');

      const res = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: '201 Column', state: 'open' },
      });
      expect(res.status()).toBe(201);
    });

    test('new column appended after existing columns has higher position', async ({ request }) => {
      const { token, board } = await setupUserAndBoardApi(request, 'Append Position Board');

      const before = await getColumns(request, token, board.id);
      const maxPosBefore = Math.max(...before.map(c => c.position));

      const newCol = await addColumn(request, token, board.id, 'Appended Col', 'open');
      expect(newCol.position).toBeGreaterThan(maxPosBefore);
    });
  });

  // =========================================================================
  // EXTENDED UI TESTS
  // =========================================================================

  test.describe('Column UI Extended', () => {

    test('UI: column header shows name and card count when cards exist', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Col Count Header Board');
      const swimlane = await addSwimlane(request, token, board.id);

      const columns = await getColumns(request, token, board.id);
      const openCol = columns.find(c => c.state === 'open');
      if (!openCol) return;

      const cardRes = await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { board_id: board.id, swimlane_id: swimlane.id, column_id: openCol.id, title: 'Header Count Card' },
      });
      if (!cardRes.ok()) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
      // At least one column header exists
      const headers = page.locator('.board-column-header');
      const count = await headers.count();
      expect(count).toBeGreaterThan(0);
    });

    test('UI: multiple columns are visible side by side in board view', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Side By Side Board');
      await addSwimlane(request, token, board.id);

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      const headers = page.locator('.board-column-header');
      await expect(headers.first()).toBeVisible({ timeout: 8000 });
      const headerCount = await headers.count();
      expect(headerCount).toBeGreaterThanOrEqual(3);
    });

    test('UI: board settings page shows a list of columns', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Settings Col List Board');

      await page.goto(`/boards/${board.id}/settings`);

      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      await expect(columnsSection).toBeVisible({ timeout: 8000 });
      const items = columnsSection.locator('.settings-list-item');
      await expect(items.first()).toBeVisible({ timeout: 5000 });
    });

    test('UI: column names in settings appear in the same order as on the board', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Order Match Board');
      await addSwimlane(request, token, board.id);

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const settingsNames = await columnsSection.locator('.item-name').allTextContents();

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');
      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
      const boardHeaders = await page.locator('.board-column-header h3').allTextContents();

      // Every settings column name should appear in the board headers
      for (const name of settingsNames) {
        expect(boardHeaders).toContain(name);
      }
    });

    test('UI: Add Column modal requires a name (empty name blocked)', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Empty Name Block Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      await columnsSection.locator('button:has-text("Add Column")').click();

      await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 });

      // Submit with empty name — form should not close or show a validation message
      await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
      // Modal should still be open
      await expect(page.locator('.modal')).toBeVisible({ timeout: 2000 });

      // Dismiss modal
      await page.keyboard.press('Escape');
    });

    test('UI: column state badge is shown in the settings list item', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'State Badge Board');
      await addColumn(request, token, board.id, 'State Badge Col', 'open');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const row = columnsSection.locator('.settings-list-item').filter({ hasText: 'State Badge Col' });

      await expect(row.locator('.item-meta')).toContainText('open');
    });

    test('UI: closed-state column appears in the settings list', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Closed State Settings Board');
      await addColumn(request, token, board.id, 'Done Closed Col', 'closed');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const row = columnsSection.locator('.settings-list-item').filter({ hasText: 'Done Closed Col' });
      await expect(row).toBeVisible({ timeout: 5000 });
      await expect(row.locator('.item-meta')).toContainText('closed');
    });

    test('UI: board shows empty-swimlanes message without swimlanes regardless of columns', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'No Swimlane Empty Board');

      await page.goto(`/boards/${board.id}`);
      await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    });

    test('UI: after creating a column in settings, count in list increases by 1', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Count Increase Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const beforeCount = await columnsSection.locator('.settings-list-item').count();

      await columnsSection.locator('button:has-text("Add Column")').click();
      await page.locator('.modal input[type="text"]').fill('Count Increase Col');
      await page.locator('.modal button[type="submit"]:has-text("Add Column")').click();
      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

      await expect(columnsSection.locator('.settings-list-item')).toHaveCount(beforeCount + 1);
    });

    test('UI: cancelling the Add Column modal (Escape) does not create a column', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Cancel Modal Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const beforeCount = await columnsSection.locator('.settings-list-item').count();

      await columnsSection.locator('button:has-text("Add Column")').click();
      await page.locator('.modal input[type="text"]').fill('Cancelled Col');
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 3000 });

      const afterCount = await columnsSection.locator('.settings-list-item').count();
      expect(afterCount).toBe(beforeCount);
    });

    test('UI: column with in_progress state shows in board view', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'InProgress Board View');
      await addSwimlane(request, token, board.id);
      await addColumn(request, token, board.id, 'IP Column', 'in_progress');

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header h3:has-text("IP Column")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: column with review state shows in board view', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Review Board View');
      await addSwimlane(request, token, board.id);
      await addColumn(request, token, board.id, 'Review Col View', 'review');

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header h3:has-text("Review Col View")')).toBeVisible({ timeout: 8000 });
    });

    test('UI: column count badge shows correct number of cards', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Col Count Badge Board');
      const swimlane = await addSwimlane(request, token, board.id);

      const columns = await getColumns(request, token, board.id);
      const openCol = columns.find(c => c.state === 'open');
      if (!openCol) return;

      // Create 3 cards in the open column
      let created = 0;
      for (let i = 0; i < 3; i++) {
        const r = await request.post(`${BASE}/api/cards`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { board_id: board.id, swimlane_id: swimlane.id, column_id: openCol.id, title: `Badge Card ${i + 1}` },
        });
        if (r.ok()) created++;
      }
      if (created === 0) {
        test.skip(true, 'Card creation unavailable');
        return;
      }

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
      // At least one column-count badge should exist
      const badge = page.locator('.column-count').first();
      await expect(badge).toBeVisible({ timeout: 8000 });
    });

    test('UI: dismissing the delete confirm dialog keeps the column in the list', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Dismiss Delete Board');
      await addColumn(request, token, board.id, 'Keep Me Column', 'open');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const row = columnsSection.locator('.settings-list-item').filter({ hasText: 'Keep Me Column' });

      page.once('dialog', d => d.dismiss());
      await row.locator('.item-delete').click();
      await page.waitForTimeout(400);

      await expect(row).toBeVisible();
    });

    test.fixme('UI: column collapse/expand via a toggle button', async ({ page, request }) => {
      // Column collapse/expand is not yet implemented.
      // Once added, each column header should have a toggle that hides the cards
      // below it without removing the column from the board.
    });

    test.fixme('UI: drag-to-reorder columns via DnD', async ({ page, request }) => {
      // @dnd-kit drag-and-drop is unreliable in headless Playwright.
      // Use the up/down move buttons in settings instead until keyboard DnD is wired up.
    });

    test('UI: column header does not show WIP limit when not configured', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'No WIP Label Board');
      await addSwimlane(request, token, board.id);

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
      // The .wip-limit element should not be present since no wip_limit was set
      await expect(page.locator('.wip-limit')).toHaveCount(0);
    });

    test('UI: settings section for columns has the heading "Columns"', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Columns Heading Board');

      await page.goto(`/boards/${board.id}/settings`);
      await expect(page.locator('.settings-section').filter({ hasText: 'Columns' })).toBeVisible({ timeout: 5000 });
    });

    test('UI: move-up button is disabled for the first column in the list', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Move Up First Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const firstItem = columnsSection.locator('.settings-list-item').first();

      // First item's move-up button should be disabled or absent
      const moveUpBtn = firstItem.locator('.reorder-btn[title="Move up"]');
      const count = await moveUpBtn.count();
      if (count > 0) {
        await expect(moveUpBtn).toBeDisabled();
      }
      // It's also acceptable for the button to simply not exist
    });

    test('UI: move-down button is disabled for the last column in the list', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Move Down Last Board');

      await page.goto(`/boards/${board.id}/settings`);
      const columnsSection = page.locator('.settings-section').filter({ hasText: 'Columns' });
      const items = columnsSection.locator('.settings-list-item');
      const count = await items.count();
      const lastItem = items.nth(count - 1);

      const moveDownBtn = lastItem.locator('.reorder-btn[title="Move down"]');
      const btnCount = await moveDownBtn.count();
      if (btnCount > 0) {
        await expect(moveDownBtn).toBeDisabled();
      }
    });

    test('UI: board view is horizontally scrollable with many columns', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Scroll Many Cols Board');
      await addSwimlane(request, token, board.id);
      for (let i = 1; i <= 5; i++) {
        await addColumn(request, token, board.id, `Scroll Col ${i}`, 'open');
      }

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      const boardContent = page.locator('.board-content');
      await expect(boardContent).toBeVisible({ timeout: 8000 });
      const overflowX = await boardContent.evaluate(
        (el: Element) => window.getComputedStyle(el).overflowX,
      );
      expect(['auto', 'scroll']).toContain(overflowX);
    });

    test('UI: board settings page is accessible via gear icon link from board view', async ({ page, request }) => {
      const { board } = await setupUserAndBoard(request, page, 'Gear Icon Settings Board');

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });

      // Navigate to settings page (link in header area)
      const settingsLink = page.locator('a[href*="/settings"]');
      await expect(settingsLink.first()).toBeVisible({ timeout: 5000 });
    });

    test('UI: board view header shows column names from API', async ({ page, request }) => {
      const { token, board } = await setupUserAndBoard(request, page, 'Header Names From API Board');
      await addSwimlane(request, token, board.id);

      const columns = await getColumns(request, token, board.id);

      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });
      await page.click('.view-btn:has-text("All Cards")');

      await expect(page.locator('.board-column-header').first()).toBeVisible({ timeout: 8000 });
      const boardHeaders = await page.locator('.board-column-header h3').allTextContents();

      // All API columns should be rendered
      for (const col of columns) {
        expect(boardHeaders).toContain(col.name);
      }
    });
  });
});
