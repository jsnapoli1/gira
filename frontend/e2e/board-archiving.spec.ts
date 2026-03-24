/**
 * board-archiving.spec.ts — Board lifecycle, archiving, and deletion tests.
 *
 * ARCHIVE FEATURE STATUS: NOT IMPLEMENTED
 *
 * Investigation findings (2026-03-24):
 *
 * Backend:
 *   - The Board model in internal/models/models.go has no `archived` field.
 *   - PUT /api/boards/:id only accepts `{ name, description }` (no `archived` flag).
 *   - GET /api/boards returns all boards without any archive filtering.
 *   - No `include_archived` query parameter handling exists.
 *   - No dedicated archive/unarchive endpoint exists.
 *
 * Frontend:
 *   - BoardSettings.tsx has no archive section.
 *   - The board list page shows no archived-board indicators.
 *
 * All archive-specific tests are marked test.fixme() pending implementation.
 * The board deletion and lifecycle tests (existing) DO work and are kept as-is.
 */

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

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title },
  });
  return (await res.json()) as { id: number };
}

// ---------------------------------------------------------------------------
// Tests — Board Deletion and Lifecycle (implemented and passing)
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

  // ── 9. Board list shows newly created board immediately ───────────────────

  test('newly created board appears in /boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'NewBoardUser', 'ba-newboard');

    const board = await createBoard(request, token, 'Fresh Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Fresh Board'))).toBeTruthy();
  });

  // ── 10. Multiple boards all appear in the list ────────────────────────────

  test('all boards for a user appear in the board list', async ({ page, request }) => {
    const { token } = await createUser(request, 'MultiBoard', 'ba-multi');

    await createBoard(request, token, 'Alpha Board');
    await createBoard(request, token, 'Beta Board');
    await createBoard(request, token, 'Gamma Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Alpha Board'))).toBeTruthy();
    expect(names.some(n => n.includes('Beta Board'))).toBeTruthy();
    expect(names.some(n => n.includes('Gamma Board'))).toBeTruthy();
  });

  // ── 11. DELETE non-existent board returns 404 ─────────────────────────────

  test('DELETE /api/boards/:id for non-existent board returns 404', async ({ request }) => {
    const { token } = await createUser(request, 'NotFoundUser', 'ba-notfound');

    const res = await request.delete(`${BASE}/api/boards/99999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // ── 12. GET deleted board API returns 404 ────────────────────────────────

  test('GET /api/boards/:id after deletion returns 404', async ({ request }) => {
    const { token } = await createUser(request, 'ApiGetDelUser', 'ba-apigetdel');
    const board = await createBoard(request, token, 'To Get Then Delete');

    await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(404);
  });

  // ── 13. Another user cannot delete a board they don't own ─────────────────

  test('a user who does not own the board cannot delete it', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'BoardOwner', 'ba-owner');
    const { token: otherToken } = await createUser(request, 'OtherUser', 'ba-other');
    const board = await createBoard(request, ownerToken, 'Protected Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    // Should be 403 (not a member) or 404 (board not visible)
    expect([403, 404]).toContain(res.status());

    // Board should still exist for the owner
    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeTruthy();
  });

  // ── 14. Unauthenticated request cannot delete a board ─────────────────────

  test('unauthenticated DELETE /api/boards/:id returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'UnauthDelUser', 'ba-unauthd');
    const board = await createBoard(request, token, 'Unauth Board');

    const res = await request.delete(`${BASE}/api/boards/${board.id}`);
    expect(res.status()).toBe(401);
  });

  // ── 15. Board list returns empty array for user with no boards ────────────

  test('GET /api/boards returns empty array for user with no boards', async ({ request }) => {
    const { token } = await createUser(request, 'EmptyUser', 'ba-empty');

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const boards = await res.json();
    expect(Array.isArray(boards)).toBe(true);
    expect(boards.length).toBe(0);
  });

  // ── 16. Board creation with description included in API response ──────────

  test('newly created board API response includes name and description', async ({ request }) => {
    const { token } = await createUser(request, 'DescApiUser', 'ba-descapi');

    const res = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Described Board', description: 'A useful description' },
    });
    expect(res.ok()).toBe(true);
    const board = await res.json();
    expect(board.name).toBe('Described Board');
    expect(board.description).toBe('A useful description');
    expect(board.id).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Archive-specific tests (NOT IMPLEMENTED — test.fixme)
  // ---------------------------------------------------------------------------

  // ── 17. Archive board via API ──────────────────────────────────────────────

  test.fixme('API: PUT /api/boards/:id with archived:true returns 200', async ({ request }) => {
    /**
     * Implementation notes:
     *   - PUT /api/boards/:id body should accept `{ archived: true }`.
     *   - Response should include the updated board with `archived: true`.
     *   - The Board model and DB UpdateBoard function both need an `archived` field.
     */
    const { token } = await createUser(request, 'ArchiveUser', 'ba-archive');
    const board = await createBoard(request, token, 'Archive Me');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });
    expect(res.status()).toBe(200);
    const updated = await res.json();
    expect(updated.archived).toBe(true);
  });

  // ── 18. Archived board not in default GET /api/boards list ───────────────

  test.fixme('API: archived board does not appear in default GET /api/boards', async ({ request }) => {
    /**
     * Implementation notes:
     *   - GET /api/boards should filter out boards where archived=true by default.
     *   - Add an `include_archived=true` query param to opt-in to seeing archived boards.
     *   - DB ListBoardsForUser should accept an includeArchived bool param.
     */
    const { token } = await createUser(request, 'ArchiveListUser', 'ba-archivelist');
    const board = await createBoard(request, token, 'Should Disappear');

    // Archive the board
    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    // Default list should NOT include it
    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: any) => b.id === board.id)).toBeFalsy();
  });

  // ── 19. Archived board accessible via include_archived param ─────────────

  test.fixme('API: GET /api/boards?include_archived=true returns archived boards', async ({ request }) => {
    /**
     * Implementation notes:
     *   - When ?include_archived=true is passed, archived boards are included.
     *   - Alternatively, a separate GET /api/boards/archived endpoint could list them.
     */
    const { token } = await createUser(request, 'ArchiveIncludeUser', 'ba-archiveinc');
    const board = await createBoard(request, token, 'Archived Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const res = await request.get(`${BASE}/api/boards?include_archived=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await res.json();
    expect(boards.some((b: any) => b.id === board.id)).toBeTruthy();
    const archivedBoard = boards.find((b: any) => b.id === board.id);
    expect(archivedBoard.archived).toBe(true);
  });

  // ── 20. Archived board direct URL still accessible (read-only) ───────────

  test.fixme('UI: archived board URL is still accessible (read-only, not 404)', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Archived boards should be viewable but not editable.
     *   - The board page should show an "Archived" banner/badge.
     *   - Add card / move card actions should be disabled or hidden.
     */
    const { token } = await createUser(request, 'ArchiveViewUser', 'ba-archiveview');
    const board = await createBoard(request, token, 'View Archive Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);

    // Board should still render — not a 404
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // An "Archived" indicator should be shown
    // TODO: replace with actual selector once feature is implemented
    await expect(page.locator('.board-archived-banner, .board-archived-badge, [data-testid="archived"]')).toBeVisible();
  });

  // ── 21. Archived boards not shown in UI board list ───────────────────────

  test.fixme('UI: archived board does not appear in /boards list', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - The board list page should not display archived boards.
     *   - Optionally, an "Archived" filter / toggle can reveal them.
     */
    const { token } = await createUser(request, 'ArchiveUiUser', 'ba-archiveui');
    const toArchive = await createBoard(request, token, 'Archived Board UI');
    const toKeep = await createBoard(request, token, 'Keep Board UI');

    await request.put(`${BASE}/api/boards/${toArchive.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: toArchive.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Archived Board UI'))).toBeFalsy();
    expect(names.some(n => n.includes('Keep Board UI'))).toBeTruthy();
  });

  // ── 22. Cannot add cards to archived board ────────────────────────────────

  test.fixme('UI: cannot add cards to an archived board', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Add card buttons/inputs should be hidden or disabled on archived boards.
     *   - POST /api/cards should return 403 if board is archived.
     *   - The backend should check board.archived before creating a card.
     */
    const { token } = await createUser(request, 'ArchiveAddUser', 'ba-archiveadd');
    const board = await createBoard(request, token, 'No Add Archive');

    await createSwimlane(request, token, board.id, 'Test Lane');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // "Add card" button should not be present or should be disabled
    const addBtn = page.locator('.add-card-btn, button:has-text("Add Card"), .inline-card-add');
    const addBtnCount = await addBtn.count();
    if (addBtnCount > 0) {
      await expect(addBtn.first()).toBeDisabled();
    }
  });

  // ── 23. Board settings shows Archive option ───────────────────────────────

  test.fixme('UI: board settings page has an "Archive Board" option', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Add an "Archive Board" button to the Danger Zone section in BoardSettings.tsx.
     *   - Clicking it should call PUT /api/boards/:id with { archived: true }.
     *   - After archiving, the user should be redirected to /boards.
     */
    const { token } = await createUser(request, 'ArchiveBtnUser', 'ba-archivebtn');
    const board = await createBoard(request, token, 'Settings Archive Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // An "Archive Board" button should exist in the Danger Zone
    await expect(
      page.locator('.settings-section.danger .btn:has-text("Archive Board")')
    ).toBeVisible();
  });

  // ── 24. Archive confirmation dialog shown ─────────────────────────────────

  test.fixme('UI: archive board shows a confirmation dialog before archiving', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - The "Archive Board" button should call window.confirm() before proceeding.
     *   - Dismissing should abort the operation (board remains active).
     */
    const { token } = await createUser(request, 'ArchiveConfUser', 'ba-archiveconf');
    const board = await createBoard(request, token, 'Confirm Archive Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // Dismiss dialog — board should NOT be archived
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('.settings-section.danger .btn:has-text("Archive Board")');

    // Still on settings page
    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/settings`));

    // Board still active — appears in list
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some(n => n.includes('Confirm Archive Board'))).toBeTruthy();
  });

  // ── 25. Unarchive (restore) board ─────────────────────────────────────────

  test.fixme('API: archived board can be unarchived via PUT with archived:false', async ({ request }) => {
    /**
     * Implementation notes:
     *   - PUT /api/boards/:id with `{ archived: false }` should restore the board.
     *   - After unarchiving, the board should appear in the default GET /api/boards list.
     */
    const { token } = await createUser(request, 'UnarchiveUser', 'ba-unarchive');
    const board = await createBoard(request, token, 'Restore Me');

    // Archive
    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    // Unarchive
    const unarchiveRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: false },
    });
    expect(unarchiveRes.ok()).toBe(true);
    const restored = await unarchiveRes.json();
    expect(restored.archived).toBe(false);

    // Should appear in default board list again
    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: any) => b.id === board.id)).toBeTruthy();
  });

  // ── 26. Multiple boards: only non-archived returned by default ────────────

  test.fixme('API: with multiple boards, only non-archived ones appear in default list', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Create 3 boards, archive 2, verify only 1 shows in the default list.
     */
    const { token } = await createUser(request, 'MultiArchiveUser', 'ba-multiarchive');

    const boardA = await createBoard(request, token, 'Keep Active');
    const boardB = await createBoard(request, token, 'Archive One');
    const boardC = await createBoard(request, token, 'Archive Two');

    await request.put(`${BASE}/api/boards/${boardB.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardB.name, description: '', archived: true },
    });
    await request.put(`${BASE}/api/boards/${boardC.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardC.name, description: '', archived: true },
    });

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();

    expect(boards.some((b: any) => b.id === boardA.id)).toBeTruthy();
    expect(boards.some((b: any) => b.id === boardB.id)).toBeFalsy();
    expect(boards.some((b: any) => b.id === boardC.id)).toBeFalsy();
  });

  // ── 27. Board created without archive flag is active by default ───────────

  test.fixme('API: board created without archive flag has archived:false', async ({ request }) => {
    /**
     * Implementation notes:
     *   - When the Board model has an `archived` field, new boards default to archived=false.
     *   - GET /api/boards/:id should return `"archived": false` for freshly created boards.
     */
    const { token } = await createUser(request, 'DefaultActiveUser', 'ba-defaultactive');
    const board = await createBoard(request, token, 'Default Active Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const fetched = await res.json();
    expect(fetched.archived).toBe(false);
  });
});
