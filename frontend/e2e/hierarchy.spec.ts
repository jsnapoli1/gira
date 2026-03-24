import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

/**
 * Creates a user, board, swimlane, and a parent card.
 * Skips the test if card creation fails (e.g. Gitea unreachable).
 * Returns null if the test was skipped.
 */
async function setupHierarchyBoard(request: any, page: any) {
  const email = `test-hierarchy-${crypto.randomUUID()}@example.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email,
      password: 'password123',
      display_name: 'Hierarchy Test User',
    },
  });
  expect(signupRes.ok(), `signup failed: ${await signupRes.text()}`).toBeTruthy();
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Hierarchy Test Board ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(boardRes.ok(), `board creation failed: ${await boardRes.text()}`).toBeTruthy();
  const board = await boardRes.json();

  const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const columns = await columnsRes.json();

  const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'HIER-', color: '#2196F3' },
  });
  expect(swimlaneRes.ok(), `swimlane creation failed: ${await swimlaneRes.text()}`).toBeTruthy();
  const swimlane = await swimlaneRes.json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Parent Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });
  if (!cardRes.ok()) {
    test.skip(true, `Card creation failed (likely Gitea unreachable): ${await cardRes.text()}`);
    return null;
  }
  const card = await cardRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { token, board, card, columns, swimlane };
}

// ---------------------------------------------------------------------------
// 1. Issue type badge visible on cards
// ---------------------------------------------------------------------------

test.describe('Issue Hierarchy', () => {
  test('should show issue type badge on cards', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    // Cards should have a type badge
    await expect(page.locator('.card-type-badge')).toBeVisible();
    // Default type should be task
    await expect(page.locator('.card-type-badge.type-task')).toBeVisible();
  });

  test('should show issue type in card detail', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Should show issue type in card detail header
    await expect(page.locator('.card-issue-type')).toBeVisible();
    await expect(page.locator('.card-issue-type')).toContainText('task');
  });

  test('should be able to change issue type to epic', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should be able to change issue type to story', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Story' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('story', { timeout: 5000 });
  });

  test('should be able to change issue type to subtask', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Subtask' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('subtask', { timeout: 5000 });
  });

  test('should persist issue type after closing modal', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Close modal by clicking overlay
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Verify the card badge shows epic
    await expect(page.locator('.card-type-badge.type-epic')).toBeVisible({ timeout: 5000 });

    // Reopen the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Issue type should still be epic
    await expect(page.locator('.card-detail-modal-unified .card-issue-type')).toContainText('epic', { timeout: 5000 });
  });

  test('should show correct type badge character', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    // Task badge should show "T"
    const badge = page.locator('.card-type-badge.type-task');
    await expect(badge).toContainText('T');
  });

  // -------------------------------------------------------------------------
  // 2. Parent–child relationship via API
  // -------------------------------------------------------------------------

  test('GET /api/cards/:id/children — returns empty array for new card', async ({ request }) => {
    const email = `test-hier-api-${crypto.randomUUID()}@example.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Hierarchy API' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'HierAPI Board' },
      })
    ).json();

    const columns = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-', color: '#333' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'API Parent Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed (Gitea unreachable): ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    const childrenRes = await request.get(`${BASE}/api/cards/${card.id}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(childrenRes.ok(), `children endpoint failed: ${await childrenRes.text()}`).toBeTruthy();
    const children = await childrenRes.json();
    expect(Array.isArray(children)).toBe(true);
    expect(children).toHaveLength(0);
  });

  test('POST /api/cards with parent_id — child card linked to parent', async ({ request }) => {
    const email = `test-hier-child-${crypto.randomUUID()}@example.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Hierarchy Child' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'HierChild Board' },
      })
    ).json();

    const columns = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-', color: '#333' },
      })
    ).json();

    // Create parent card
    const parentRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Story: API Parent',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
        issue_type: 'story',
      },
    });
    if (!parentRes.ok()) {
      test.skip(true, `Parent card creation failed: ${await parentRes.text()}`);
      return;
    }
    const parent = await parentRes.json();

    // Create child card with parent_id
    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Subtask: API Child',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
        parent_id: parent.id,
        issue_type: 'subtask',
      },
    });
    if (!childRes.ok()) {
      test.skip(true, `Child card creation failed: ${await childRes.text()}`);
      return;
    }
    const child = await childRes.json();

    // Verify the child has parent_id set
    expect(child.parent_id).toBe(parent.id);

    // GET /api/cards/:parentId/children should now include the child
    const childrenRes = await request.get(`${BASE}/api/cards/${parent.id}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(childrenRes.ok()).toBeTruthy();
    const children = await childrenRes.json();
    expect(Array.isArray(children)).toBe(true);
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe(child.id);
    expect(children[0].title).toBe('Subtask: API Child');
  });

  test('PATCH /api/cards/:id — setting parent_id on existing card links it', async ({ request }) => {
    const email = `test-hier-patch-${crypto.randomUUID()}@example.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Hierarchy Patch' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'HierPatch Board' },
      })
    ).json();

    const columns = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-', color: '#333' },
      })
    ).json();

    const parentRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Epic Parent',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
        issue_type: 'epic',
      },
    });
    if (!parentRes.ok()) {
      test.skip(true, `Parent card creation failed: ${await parentRes.text()}`);
      return;
    }
    const parent = await parentRes.json();

    const childRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Task Child (initially unlinked)',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    if (!childRes.ok()) {
      test.skip(true, `Child card creation failed: ${await childRes.text()}`);
      return;
    }
    const child = await childRes.json();

    // Link child to parent via PUT (the card update endpoint uses PUT)
    const patchRes = await request.put(`${BASE}/api/cards/${child.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: child.title,
        description: '',
        priority: 'medium',
        parent_id: parent.id,
        issue_type: 'task',
      },
    });
    expect(patchRes.ok(), `PUT failed: ${await patchRes.text()}`).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.parent_id).toBe(parent.id);

    // Verify children endpoint reflects the link
    const childrenRes = await request.get(`${BASE}/api/cards/${parent.id}/children`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(childrenRes.ok()).toBeTruthy();
    const children = await childrenRes.json();
    expect(children.some((c: any) => c.id === child.id)).toBe(true);
  });

  test('PATCH /api/cards/:id — circular parent reference is rejected', async ({ request }) => {
    const email = `test-hier-circular-${crypto.randomUUID()}@example.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Hierarchy Circular' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'HierCirc Board' },
      })
    ).json();

    const columns = await (
      await request.get(`${BASE}/api/boards/${board.id}/columns`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'L-', color: '#333' },
      })
    ).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Self-Parent Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    // Attempt to set a card as its own parent (uses PUT for card updates)
    const selfRefRes = await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: '',
        priority: 'medium',
        parent_id: card.id,
        issue_type: 'task',
      },
    });
    expect(selfRefRes.status()).toBe(400);
    const errText = await selfRefRes.text();
    expect(errText.toLowerCase()).toContain('parent');
  });

  // -------------------------------------------------------------------------
  // 3. Subtasks section UI
  // -------------------------------------------------------------------------

  test('subtasks section is visible in card detail modal', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.subtasks-section')).toBeVisible();
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks');
  });

  test('subtask count is shown in subtasks header', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Before any subtasks, header shows (0)
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (0)');
  });

  test('Add button in subtasks header opens add-subtask form', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click Add
    await page.click('.subtasks-header button:has-text("Add")');
    await expect(page.locator('.add-subtask-form')).toBeVisible({ timeout: 5000 });

    // The input inside the form should be visible
    await expect(page.locator('.add-subtask-form input')).toBeVisible();
  });

  test('creating a subtask via UI increases the subtask count', async ({ page, request }) => {
    const ctx = await setupHierarchyBoard(request, page);
    if (!ctx) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.subtasks-header button:has-text("Add")');
    await page.fill('.add-subtask-form input', 'My First Subtask');
    await page.click('.add-subtask-form button[type="submit"]:has-text("Create")');

    // Subtask list should appear with one item
    await expect(page.locator('.subtask-list .subtask-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.subtask-item')).toContainText('My First Subtask');

    // Header should show (1)
    await expect(page.locator('.subtasks-header h4')).toContainText('Subtasks (1)');
  });

  // -------------------------------------------------------------------------
  // 4. Issue type badge characters
  // -------------------------------------------------------------------------

  test.describe('Issue type badge characters', () => {
    const typesAndChars: Array<{ type: string; label: string; char: string }> = [
      { type: 'epic',    label: 'Epic',    char: 'E' },
      { type: 'story',   label: 'Story',   char: 'S' },
      { type: 'task',    label: 'Task',    char: 'T' },
      { type: 'subtask', label: 'Subtask', char: 'S' },
    ];

    for (const { type, label, char } of typesAndChars) {
      test(`${label} badge shows correct character "${char}"`, async ({ page, request }) => {
        const ctx = await setupHierarchyBoard(request, page);
        if (!ctx) return;

        if (type !== 'task') {
          // Change issue type to the target
          await page.click('.card-item');
          await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
          await page.click('button:has-text("Edit")');
          await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
          await page.locator('.card-detail-modal-unified select').first().selectOption({ label });
          await page.click('.card-detail-modal-unified button:has-text("Save")');
          await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });
          // Close modal to see the card item badge
          await page.click('.modal-close-btn');
          await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
        }

        const badge = page.locator(`.card-type-badge.type-${type}`);
        await expect(badge).toBeVisible({ timeout: 5000 });
        await expect(badge).toContainText(char);
      });
    }
  });
});
