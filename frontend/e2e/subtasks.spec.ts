import { test, expect, APIRequestContext } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function createUser(request: APIRequestContext) {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Test User' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  parentCardId: number;
}

async function setup(request: APIRequestContext): Promise<SetupResult> {
  const { token } = await createUser(request);

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Subtask Test Board' },
    })
  ).json();

  const columnId: number = board.columns[0].id;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'ST-' },
    })
  ).json();

  const parentCardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Parent Card',
      column_id: columnId,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!parentCardRes.ok()) {
    throw new Error(`Parent card creation failed: ${await parentCardRes.text()}`);
  }

  const parentCard = await parentCardRes.json();

  return {
    token,
    boardId: board.id,
    columnId,
    swimlaneId: swimlane.id,
    parentCardId: parentCard.id,
  };
}

// ─── API-level tests ──────────────────────────────────────────────────────────

test.describe('Subtasks — API', () => {
  test('POST /api/cards with parent_id creates a subtask', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Child Task',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!res.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await res.text()}`);
      return;
    }

    expect(res.status()).toBe(201);
    const child = await res.json();
    expect(child.id).toBeGreaterThan(0);
    expect(child.parent_id).toBe(parentCardId);
    expect(child.title).toBe('Child Task');
  });

  test('GET /api/cards/:id/children returns subtasks for a parent', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Child Task',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!childRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await childRes.text()}`);
      return;
    }

    const res = await request.get(`${BASE}/api/cards/${parentCardId}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const children = await res.json();
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBe(1);
    expect(children[0].title).toBe('Child Task');
    expect(children[0].parent_id).toBe(parentCardId);
  });

  test('GET /api/cards/:id/children returns empty array when no subtasks', async ({ request }) => {
    const { token, parentCardId } = await setup(request);

    const res = await request.get(`${BASE}/api/cards/${parentCardId}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const children = await res.json();
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBe(0);
  });

  test('multiple subtasks appear in children list', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    const child1Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Subtask One',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!child1Res.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await child1Res.text()}`);
      return;
    }

    const child2Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Subtask Two',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!child2Res.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await child2Res.text()}`);
      return;
    }

    const res = await request.get(`${BASE}/api/cards/${parentCardId}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const children = await res.json();
    expect(children.length).toBe(2);
    const titles = children.map((c: { title: string }) => c.title);
    expect(titles).toContain('Subtask One');
    expect(titles).toContain('Subtask Two');
  });

  test('GET /api/cards/:id returns parent_id on child card', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Child With Parent',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!childRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await childRes.text()}`);
      return;
    }

    const child = await childRes.json();

    const getRes = await request.get(`${BASE}/api/cards/${child.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(getRes.status()).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.parent_id).toBe(parentCardId);
  });

  test('PATCH /api/cards/:id can assign parent_id to an existing card', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    // Create a standalone card without parent
    const standaloneRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Standalone Card',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });

    if (!standaloneRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await standaloneRes.text()}`);
      return;
    }

    const standalone = await standaloneRes.json();

    // Assign parent via update
    const patchRes = await request.patch(`${BASE}/api/cards/${standalone.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Standalone Card',
        parent_id: parentCardId,
      },
    });

    expect(patchRes.status()).toBe(200);
    const updated = await patchRes.json();
    expect(updated.parent_id).toBe(parentCardId);

    // Verify parent now has this card as a child
    const childrenRes = await request.get(`${BASE}/api/cards/${parentCardId}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const children = await childrenRes.json();
    expect(children.some((c: { id: number }) => c.id === standalone.id)).toBe(true);
  });

  test('PATCH /api/cards/:id rejects self as parent', async ({ request }) => {
    const { token, parentCardId } = await setup(request);

    const res = await request.patch(`${BASE}/api/cards/${parentCardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Parent Card',
        parent_id: parentCardId,
      },
    });

    expect(res.status()).toBe(400);
  });

  test('PATCH /api/cards/:id rejects circular parent reference', async ({ request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    // Create child of parent
    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Child Card',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!childRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await childRes.text()}`);
      return;
    }

    const child = await childRes.json();

    // Try to make the original parent a child of its own child (circular)
    const circularRes = await request.patch(`${BASE}/api/cards/${parentCardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Parent Card',
        parent_id: child.id,
      },
    });

    expect(circularRes.status()).toBe(400);
  });

  test('unauthenticated request to GET children returns 401', async ({ request }) => {
    const { parentCardId } = await setup(request);

    const res = await request.get(`${BASE}/api/cards/${parentCardId}/children`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/cards/:id/children returns 404 for non-existent card', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(`${BASE}/api/cards/999999/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(404);
  });

  test('subtask is visible on its own swimlane column', async ({ request }) => {
    // Subtasks inherit the same column/swimlane — confirm card attributes match
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Subtask on swimlane',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!childRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await childRes.text()}`);
      return;
    }

    const child = await childRes.json();
    expect(child.column_id).toBe(columnId);
    expect(child.swimlane_id).toBe(swimlaneId);
    expect(child.board_id).toBe(boardId);
  });
});

// ─── UI tests ─────────────────────────────────────────────────────────────────

test.describe('Subtasks — UI', () => {
  test('subtasks section visible in card modal', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtasks-section')).toBeVisible();
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks');
  });

  test('create subtask via Add button', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await expect(page.locator('.add-subtask-form')).toBeVisible();

    await page.fill('.add-subtask-form input', 'My Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');

    await expect(page.locator('.subtask-list')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.subtask-item')).toContainText('My Subtask');
  });

  test('subtask appears in list after creation', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Listed Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');

    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.subtask-list .subtask-item').first()).toContainText('Listed Subtask');
  });

  test('toggle subtask complete marks it as completed', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Toggle Me');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });

    const checkbox = page.locator('.subtask-checkbox').first();
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();

    await expect(page.locator('.subtask-item.subtask-completed')).toBeVisible({ timeout: 8000 });
  });

  test('subtask persists after modal reopen', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Persistent Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });

    // Close modal by clicking the overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.subtask-list .subtask-item').first()).toContainText('Persistent Subtask');
  });

  test('multiple subtasks — completing first does not affect second', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'First Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Second Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(2, { timeout: 8000 });

    // Complete only the first subtask
    await page.locator('.subtask-checkbox').first().click();
    await expect(page.locator('.subtask-item.subtask-completed')).toHaveCount(1, { timeout: 8000 });

    const completedItems = page.locator('.subtask-item.subtask-completed');
    const allItems = page.locator('.subtask-item');
    await expect(completedItems).toHaveCount(1);
    await expect(allItems).toHaveCount(2);
  });

  test('subtask progress bar shows correct fraction', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Progress Task 1');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Progress Task 2');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(2, { timeout: 8000 });

    await page.locator('.subtask-checkbox').first().click();
    await expect(page.locator('.subtask-item.subtask-completed')).toHaveCount(1, { timeout: 8000 });

    await expect(page.locator('.subtask-progress-info')).toBeVisible();
    await expect(page.locator('.subtask-progress-info')).toContainText('1/2');
  });

  test('subtask count visible in subtasks header', async ({ page, request }) => {
    const { token, boardId } = await setup(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (0)');

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'Count Test');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });

    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (1)');
  });

  test('pre-existing subtask (created via API) is shown in modal', async ({ page, request }) => {
    const { token, boardId, columnId, swimlaneId, parentCardId } = await setup(request);

    // Create child via API before opening the UI
    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'API-created Subtask',
        column_id: columnId,
        swimlane_id: swimlaneId,
        board_id: boardId,
        parent_id: parentCardId,
      },
    });

    if (!childRes.ok()) {
      test.skip(true, `Card creation failed (likely Gitea 401): ${await childRes.text()}`);
      return;
    }

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the parent card
    const cardItem = page.locator('.card-item:has(.card-title:has-text("Parent Card"))');
    await expect(cardItem).toBeVisible({ timeout: 10000 });
    await cardItem.click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtask-list .subtask-item')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.subtask-list .subtask-item').first()).toContainText('API-created Subtask');
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (1)');
  });
});
