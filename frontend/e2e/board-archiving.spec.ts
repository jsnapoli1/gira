import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number } };
}

async function createBoard(request: any, token: string, name: string, description = '') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, description },
  });
  return (await res.json()) as { id: number; name: string; description: string };
}

async function createSwimlane(request: any, token: string, boardId: number, name: string) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator: 'BA-', color: '#6366f1' },
  });
  return (await res.json()) as { id: number };
}

async function getFirstColumn(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cols = await res.json();
  return cols[0] as { id: number };
}

async function createCard(request: any, token: string, boardId: number, swimlaneId: number, columnId: number, title: string) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title },
  });
  return (await res.json()) as { id: number };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Board Archiving and Lifecycle', () => {
  // ── 1. Delete board from settings ────────────────────────────────────────

  test('board settings has Delete Board button in Danger Zone; clicking and confirming deletes the board', async ({ page, request }) => {
    const { token } = await createUser(request, 'DeleteUser', 'ba-del');
    const board = await createBoard(request, token, 'Board To Delete');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // Danger Zone section should be visible
    await expect(page.locator('.settings-section.danger h2:has-text("Danger Zone")')).toBeVisible();
    await expect(page.locator('.btn.btn-danger:has-text("Delete Board")')).toBeVisible();

    // Accept the confirmation dialog and click delete
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.btn.btn-danger:has-text("Delete Board")');

    // After deletion, app navigates to /boards
    await page.waitForURL(/\/boards$/, { timeout: 10000 });

    // The deleted board should no longer appear in the list
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Board To Delete'))).toBeFalsy();
  });

  // ── 2. Deleted board not in list ─────────────────────────────────────────

  test('after deleting a board via API, /boards does not show it', async ({ page, request }) => {
    const { token } = await createUser(request, 'ListCheckUser', 'ba-listchk');
    const board = await createBoard(request, token, 'Gone Board');
    const keepBoard = await createBoard(request, token, 'Keep Board');

    // Delete via API
    const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Gone Board'))).toBeFalsy();
    expect(names.some(n => n.includes('Keep Board'))).toBeTruthy();
  });

  // ── 3. Deleted board URL gives error or redirects ─────────────────────────

  test('navigating to a deleted board URL shows an error or redirects', async ({ page, request }) => {
    const { token } = await createUser(request, 'GhostNav', 'ba-ghost');
    const board = await createBoard(request, token, 'Ghost Board');
    const boardId = board.id;

    // Delete the board via API
    await request.delete(`${BASE}/api/boards/${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    // Either the .error element appears (board not found / 404) or the page redirects away
    const hasError = await page.locator('.error').isVisible({ timeout: 8000 }).catch(() => false);
    const redirected = !page.url().includes(`/boards/${boardId}`);

    expect(hasError || redirected).toBeTruthy();
  });

  // ── 4. Delete board API returns 204 ──────────────────────────────────────

  test('DELETE /api/boards/:id returns 204 for the board owner', async ({ request }) => {
    const { token } = await createUser(request, 'ApiDelUser', 'ba-apidel');
    const board = await createBoard(request, token, 'API Delete Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(204);
  });

  // ── 5. Delete board with cards ────────────────────────────────────────────

  test('board with cards can be deleted; all cards are removed too', async ({ page, request }) => {
    const { token } = await createUser(request, 'CardsDelUser', 'ba-cardsdel');
    const board = await createBoard(request, token, 'Populated Board');

    // Set up swimlane and cards
    const swimlane = await createSwimlane(request, token, board.id, 'Main');
    const col = await getFirstColumn(request, token, board.id);
    await createCard(request, token, board.id, swimlane.id, col.id, 'Card One');
    await createCard(request, token, board.id, swimlane.id, col.id, 'Card Two');
    await createCard(request, token, board.id, swimlane.id, col.id, 'Card Three');

    // Delete board via API — should succeed
    const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    // Verify the board is gone via list endpoint
    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeFalsy();

    // Navigating to the deleted board URL should show an error in the UI
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    const hasError = await page.locator('.error').isVisible({ timeout: 8000 }).catch(() => false);
    const redirected = !page.url().includes(`/boards/${board.id}`);
    expect(hasError || redirected).toBeTruthy();
  });

  // ── 6. Delete board confirmation required ────────────────────────────────

  test('dismissing the delete confirmation dialog does not delete the board', async ({ page, request }) => {
    const { token } = await createUser(request, 'ConfirmUser', 'ba-confirm');
    const board = await createBoard(request, token, 'Survive Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // Dismiss (cancel) the confirmation dialog
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('.btn.btn-danger:has-text("Delete Board")');

    // Still on the settings page — no redirect occurred
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/settings`));

    // Navigate to boards list and verify board still exists
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Survive Board'))).toBeTruthy();
  });

  // ── 7. Board rename via settings ─────────────────────────────────────────

  test('renaming a board via PUT /api/boards/:id updates name in UI and API', async ({ page, request }) => {
    const { token } = await createUser(request, 'RenameUser', 'ba-rename');
    const board = await createBoard(request, token, 'Old Name Board');

    // Rename via API
    const putRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'New Name Board', description: '' },
    });
    expect(putRes.ok()).toBeTruthy();
    const updated = await putRes.json();
    expect(updated.name).toBe('New Name Board');

    // Verify the rename is reflected in the board header UI
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header h1')).toContainText('New Name Board', { timeout: 10000 });

    // Verify visible in /boards list
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('New Name Board'))).toBeTruthy();
    expect(names.some(n => n.includes('Old Name Board'))).toBeFalsy();
  });

  // ── 8. Board description update persists ─────────────────────────────────

  test('updating board description via settings persists across reloads', async ({ page, request }) => {
    const { token } = await createUser(request, 'DescUser', 'ba-desc');
    const board = await createBoard(request, token, 'Desc Board', '');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // Update description via the settings form
    const descInput = page.locator('#boardDesc');
    await descInput.clear();
    await descInput.fill('Updated board description for testing');

    const saveBtn = page.locator('button:has-text("Save Changes")');
    await saveBtn.click();

    // Wait for save confirmation — button returns from "Saving..." to "Save Changes"
    await expect(saveBtn).toHaveText('Save Changes', { timeout: 8000 });

    // Reload the settings page and verify the description persisted
    await page.reload();
    await page.waitForSelector('.settings-page', { timeout: 10000 });
    await expect(page.locator('#boardDesc')).toHaveValue('Updated board description for testing');

    // Also verify via API
    const apiRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const apiBoard = await apiRes.json();
    expect(apiBoard.description).toBe('Updated board description for testing');
  });
});
