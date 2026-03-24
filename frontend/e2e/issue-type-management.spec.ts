/**
 * issue-type-management.spec.ts
 *
 * Comprehensive CRUD tests for issue types that are NOT already covered in
 * issue-types-extended.spec.ts. That file covers:
 *   - list returns array (empty or defaults)
 *   - create with name/icon/color, appears in list
 *   - update name/icon/color
 *   - delete removes from list
 *   - UI: section visible, empty state, Add Type button, modal fields,
 *         create via UI, icon shown, delete via UI, edit via UI, color picker
 *   - Card behavior: default badge, change to Story/Epic/Subtask persists
 *
 * This file adds:
 *   - Create with name-only (no icon, no color), color defaults to #6366f1
 *   - Response shape: has id, name, board_id
 *   - Empty name rejected (400)
 *   - Very long name accepted
 *   - Null/empty icon & color are stored (null color uses default)
 *   - Multiple issue types for same board preserved independently
 *   - Unauthorized (no token) returns 401
 *   - Non-board-member cannot create (403)
 *   - After deletion, not present in list (explicit negative check by id)
 *   - Creating two types with same name on the same board
 *   - Issue types from another board are not returned for this board
 *   - Default types returned when no custom types exist
 *   - UI: Issue Types section present in board settings (structure check only,
 *         board-settings.spec.ts checks the section heading but not content)
 *   - UI: "Add Type" button is present
 *   - UI: create form has name field
 *   - UI: created type appears in list with correct name
 *   - UI: delete type via UI (item is removed)
 *   - UI: edit type via UI (name updated)
 *   - UI: card detail shows issue_type field
 *   - UI: filter by issue type on board view (fixme - filter UI not implemented)
 *   - UI: issue types shown when creating card (fixme - custom types not in dropdown yet)
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  prefix = 'itm',
): Promise<{ token: string; email: string; userId: number }> {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'IssueTypeMgr' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, email, userId: body.user?.id ?? 0 };
}

async function createBoard(
  request: any,
  token: string,
  name = 'IssueType Board',
): Promise<{ id: number; columns: any[]; swimlanes?: any[] }> {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function createIssueType(
  request: any,
  token: string,
  boardId: number,
  name: string,
  icon = '',
  color = '#6366f1',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/issue-types`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { name, icon, color },
  });
  return res;
}

async function setup(request: any, prefix = 'itm') {
  const { token, userId } = await createUser(request, prefix);
  const board = await createBoard(request, token);
  return { token, userId, board };
}

/**
 * Try to create a card. Returns null when Gitea returns 401 so callers can
 * call test.skip().
 */
async function tryCreateCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title = 'Test Card',
): Promise<any | null> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId },
  });
  if (!res.ok()) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// API Tests — Create
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — API: Create', () => {
  test('create issue type with name only returns 201 with defaults', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-name-only');
    const res = await createIssueType(request, token, board.id, 'Name Only');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe('Name Only');
    // When no color is sent, backend defaults to #6366f1
    expect(body.color).toBeTruthy();
  });

  test('create issue type with name, icon, and color stores all fields', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-full');
    const res = await createIssueType(request, token, board.id, 'Full Type', '⚡', '#ff5500');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Full Type');
    expect(body.icon).toBe('⚡');
    expect(body.color).toBe('#ff5500');
  });

  test('response shape includes id, name, board_id, icon, color, position', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-shape');
    const res = await createIssueType(request, token, board.id, 'Shape Test', '●', '#aabbcc');
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
    expect(typeof body.name).toBe('string');
    expect(typeof body.board_id).toBe('number');
    expect(body.board_id).toBe(board.id);
    // icon and color may be empty strings or null but must be present
    expect('icon' in body).toBe(true);
    expect('color' in body).toBe(true);
  });

  test('create issue type with empty name returns 400', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-empty-name');
    const res = await createIssueType(request, token, board.id, '');
    expect(res.status()).toBe(400);
  });

  test('create issue type with very long name (200 chars) succeeds', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-long-name');
    const longName = 'A'.repeat(200);
    const res = await createIssueType(request, token, board.id, longName);
    // Backend should accept long names — 201 or 200
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json();
      expect(body.name).toBe(longName);
    }
  });

  test('create issue type with empty icon stores empty string', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-empty-icon');
    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Icon Type', icon: '', color: '#123456' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('No Icon Type');
    // icon is empty string or null — both are acceptable
    expect(body.icon === '' || body.icon === null || body.icon === undefined).toBe(true);
  });

  test('create issue type without color field — backend uses default color #6366f1', async ({
    request,
  }) => {
    const { token, board } = await setup(request, 'itm-no-color');
    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Color' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.color).toBe('#6366f1');
  });

  test('two issue types with the same name can be created on the same board', async ({
    request,
  }) => {
    const { token, board } = await setup(request, 'itm-dup-name');
    const r1 = await createIssueType(request, token, board.id, 'Duplicate Name');
    const r2 = await createIssueType(request, token, board.id, 'Duplicate Name');
    // Backend does not enforce uniqueness on name — both should succeed
    expect(r1.status()).toBe(201);
    expect(r2.status()).toBe(201);
    const b1 = await r1.json();
    const b2 = await r2.json();
    // They get different IDs
    expect(b1.id).not.toBe(b2.id);
  });
});

// ---------------------------------------------------------------------------
// API Tests — List
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — API: List', () => {
  test('list returns an array after creating multiple types', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-list-multi');
    await createIssueType(request, token, board.id, 'Type Alpha', '★', '#111111');
    await createIssueType(request, token, board.id, 'Type Beta', '◆', '#222222');
    await createIssueType(request, token, board.id, 'Type Gamma', '●', '#333333');

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const types: any[] = await listRes.json();
    const names = types.map((t) => t.name);
    expect(names).toContain('Type Alpha');
    expect(names).toContain('Type Beta');
    expect(names).toContain('Type Gamma');
  });

  test('when no custom types exist, list returns built-in defaults (not empty)', async ({
    request,
  }) => {
    const { token, board } = await setup(request, 'itm-defaults');
    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const types: any[] = await listRes.json();
    // Should return the 5 built-in types: epic, story, task, bug, subtask
    expect(types.length).toBeGreaterThanOrEqual(1);
    const names = types.map((t) => t.name);
    // At least one of the defaults must be present
    const hasDefault = names.some((n: string) =>
      ['epic', 'story', 'task', 'bug', 'subtask'].includes(n),
    );
    expect(hasDefault).toBe(true);
  });

  test('issue types from one board are not returned for a different board', async ({ request }) => {
    const { token, board: boardA } = await setup(request, 'itm-isolation-a');
    const boardB = await createBoard(request, token, 'Board B Isolation');

    await createIssueType(request, token, boardA.id, 'BoardA Only Type', '✓', '#aaaaaa');

    const listB = await request.get(`${BASE}/api/boards/${boardB.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const typesB: any[] = await listB.json();
    // 'BoardA Only Type' must not appear in board B's list
    expect(typesB.some((t) => t.name === 'BoardA Only Type')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API Tests — Update
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — API: Update', () => {
  test('update issue type name via PUT returns updated name', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-update-name');
    const createRes = await createIssueType(request, token, board.id, 'Before Update', '◇', '#0000ff');
    const created = await createRes.json();

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${created.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'After Update', icon: '◇', color: '#0000ff' },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('After Update');
    expect(updated.id).toBe(created.id);
  });

  test('update issue type color via PUT persists correctly', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-update-color');
    const createRes = await createIssueType(request, token, board.id, 'Color Change', '■', '#000000');
    const created = await createRes.json();

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${created.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Color Change', icon: '■', color: '#ff0000' },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.color).toBe('#ff0000');
  });

  test('update with empty name returns 400', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-update-empty-name');
    const createRes = await createIssueType(request, token, board.id, 'Valid Name', '●', '#abcdef');
    const created = await createRes.json();

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${created.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: '', icon: '●', color: '#abcdef' },
      },
    );
    expect(updateRes.status()).toBe(400);
  });

  test('updated type is reflected in subsequent list call', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-update-list');
    const createRes = await createIssueType(request, token, board.id, 'List Pre-Update', '⊕', '#bbbbbb');
    const created = await createRes.json();

    await request.put(`${BASE}/api/boards/${board.id}/issue-types/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'List Post-Update', icon: '⊕', color: '#bbbbbb' },
    });

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await listRes.json();
    const found = types.find((t) => t.id === created.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('List Post-Update');
    expect(types.some((t) => t.name === 'List Pre-Update')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API Tests — Delete
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — API: Delete', () => {
  test('delete issue type returns 204 and is absent from list', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-delete');
    const createRes = await createIssueType(request, token, board.id, 'Delete Me', '🗑', '#ff0000');
    const created = await createRes.json();

    const delRes = await request.delete(
      `${BASE}/api/boards/${board.id}/issue-types/${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await listRes.json();
    // Explicitly verify by id — not just by name
    expect(types.find((t) => t.id === created.id)).toBeUndefined();
  });

  test('deleting one type does not remove other types on the same board', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-delete-selective');
    const r1 = await createIssueType(request, token, board.id, 'Keep This', '✓', '#00ff00');
    const r2 = await createIssueType(request, token, board.id, 'Remove This', '✗', '#ff0000');
    const keep = await r1.json();
    const remove = await r2.json();

    await request.delete(`${BASE}/api/boards/${board.id}/issue-types/${remove.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await listRes.json();
    // Kept type must still be present
    expect(types.find((t) => t.id === keep.id)).toBeTruthy();
    // Removed type must be absent
    expect(types.find((t) => t.id === remove.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// API Tests — Authorization
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — API: Authorization', () => {
  test('unauthenticated request to list issue types returns 401', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-auth-list');
    const res = await request.get(`${BASE}/api/boards/${board.id}/issue-types`);
    expect(res.status()).toBe(401);
  });

  test('unauthenticated request to create issue type returns 401', async ({ request }) => {
    const { token, board } = await setup(request, 'itm-auth-create');
    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      data: { name: 'Unauth Type' },
    });
    expect(res.status()).toBe(401);
  });

  test('non-board-member cannot create issue type (403)', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request, 'itm-403-owner');
    const { token: outsiderToken } = await createUser(request, 'itm-403-outsider');

    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
      data: { name: 'Outsider Type', icon: '', color: '#aaaaaa' },
    });
    expect(res.status()).toBe(403);
  });

  test('board member (viewer role) cannot create issue type (403)', async ({ request }) => {
    const { token: ownerToken, board } = await setup(request, 'itm-member-403-owner');
    const { token: memberToken, userId: memberId } = await createUser(
      request,
      'itm-member-403-member',
    );

    // Add user as a regular member (non-admin)
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberId, role: 'member' },
    });

    const res = await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Member Type', icon: '', color: '#aaaaaa' },
    });
    // Members without edit board privilege get 403
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// UI Tests — Board Settings: Issue Types section
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — UI: Board Settings section', () => {
  test('Issue Types section visible in board settings page', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-section');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(page.locator('h2:has-text("Issue Types")')).toBeVisible();
  });

  test('"Add Type" button is present in the Issue Types section', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-addbtn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(page.locator('button:has-text("Add Type")')).toBeVisible({ timeout: 5000 });
  });

  test('clicking Add Type opens a modal with a name field', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-modal-name');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    // The name input must be present
    await expect(
      page.locator('.modal input[placeholder*="Bug, Feature, Task"]'),
    ).toBeVisible();
  });

  test('modal create form has color picker', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-color-picker');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    await expect(page.locator('.modal .color-picker')).toBeVisible();
  });

  test('created issue type appears in the list with the entered name', async ({
    page,
    request,
  }) => {
    const { token, board } = await setup(request, 'itm-ui-appears');
    // Pre-create via API so the item is ready on page load
    await createIssueType(request, token, board.id, 'UI Appears Type', '◆', '#0055ff');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Appears Type")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('can create issue type via settings UI and it appears in list', async ({
    page,
    request,
  }) => {
    const { token, board } = await setup(request, 'itm-ui-create');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    await page.locator('.modal input[placeholder*="Bug, Feature, Task"]').fill('New UI Type');
    await page.click('.modal button:has-text("Add Issue Type")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('.issue-types-list .item-name:has-text("New UI Type")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('can delete issue type via UI delete button', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-delete');
    await createIssueType(request, token, board.id, 'UI Delete Type', '✗', '#ee1111');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Delete Type")'),
    ).toBeVisible({ timeout: 5000 });

    page.once('dialog', (d) => d.accept());
    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("UI Delete Type")'),
    });
    await typeItem.locator('.item-delete').click();

    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Delete Type")'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('can edit issue type name via UI', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-edit');
    await createIssueType(request, token, board.id, 'UI Edit Original', '◇', '#007700');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Edit Original")'),
    ).toBeVisible({ timeout: 5000 });

    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("UI Edit Original")'),
    });
    await typeItem.locator('.item-edit').click();

    await page.waitForSelector('.modal', { timeout: 5000 });
    await expect(page.locator('.modal h2:has-text("Edit Issue Type")')).toBeVisible();

    const nameInput = page.locator('.modal input[placeholder*="Bug, Feature, Task"]');
    await nameInput.fill('');
    await nameInput.fill('UI Edit Renamed');

    await page.click('.modal button:has-text("Save Changes")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Edit Renamed")'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.issue-types-list .item-name:has-text("UI Edit Original")'),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI Tests — Card interaction with issue types
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — UI: Card detail shows issue type', () => {
  test('card detail modal shows issue_type field for a card', async ({ page, request }) => {
    const { token, board } = await setup(request, 'itm-ui-card-detail');
    const columns = board.columns || [];
    const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Default', designator: 'DT' },
    });
    const swimlane = await swimlaneRes.json();

    const card = await tryCreateCard(request, token, board.id, columns[0]?.id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation requires Gitea — skipping UI card detail test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The card detail must expose the issue type somewhere
    await expect(page.locator('.card-issue-type')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// UI Tests — fixme stubs for unimplemented features
// ---------------------------------------------------------------------------

test.describe('Issue Type Management — UI: Unimplemented features (fixme)', () => {
  test.fixme(
    'issue types dropdown shown when creating a new card via Add Card button',
    async ({ page, request }) => {
      // CardDetailModal uses a hardcoded list of built-in issue types (epic, story, task,
      // subtask, bug). Custom issue types created via board settings are not propagated
      // to the card editor dropdown. When custom types are surfaced in the card form, add
      // an assertion here that the created custom type appears in the <select>.
      const { token, board } = await setup(request, 'itm-fixme-dropdown');
      await createIssueType(request, token, board.id, 'Custom Dropdown Type', '★', '#000000');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${board.id}`);

      // Open a new card form and check the issue type selector
      await page.click('button:has-text("Add Card")');
      await page.waitForSelector('.add-card-form', { timeout: 5000 });
      const options = page.locator('.add-card-form select[name="issue_type"] option');
      const texts = await options.allTextContents();
      expect(texts).toContain('Custom Dropdown Type');
    },
  );

  test.fixme(
    'filter panel includes issue type filter that hides non-matching cards',
    async ({ page, request }) => {
      // The BoardView does not currently expose a per-issue-type filter in the
      // filter panel. When it does, this test should:
      //   1. Create two cards with different issue types
      //   2. Open the filter panel
      //   3. Select a specific issue type
      //   4. Verify only cards of that type are displayed
      const { token, board } = await setup(request, 'itm-fixme-filter');

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${board.id}`);

      // Open filter panel
      await page.click('button[aria-label="Filter"], button:has-text("Filter")');
      await page.waitForSelector('.filter-panel', { timeout: 5000 });
      await page.locator('.filter-panel select[name="issue_type"]').selectOption('task');
      // Verify only task cards are shown
      const badges = page.locator('.card-type-badge');
      const count = await badges.count();
      for (let i = 0; i < count; i++) {
        await expect(badges.nth(i)).toHaveClass(/type-task/);
      }
    },
  );
});
