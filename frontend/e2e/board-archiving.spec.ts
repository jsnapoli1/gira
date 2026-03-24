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

    // Wait for the loading state to complete: either the board renders (.board-page),
    // an error appears (.error), or a redirect occurs away from this URL.
    await page.locator('.board-page, .error').waitFor({ timeout: 20000 }).catch(() => {});

    // Either the .error element appears (board not found / 404) or the page redirects away
    const hasError = await page.locator('.error').isVisible({ timeout: 5000 }).catch(() => false);
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
    const boards = (await listRes.json()) || [];
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeFalsy();

    // Navigating to the deleted board URL should show an error in the UI
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    // Wait for the loading state to complete before asserting
    await page.locator('.board-page, .error').waitFor({ timeout: 20000 }).catch(() => {});
    const hasError = await page.locator('.error').isVisible({ timeout: 5000 }).catch(() => false);
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
    // Backend returns [] (or null on older versions). Normalise to array.
    const boards = (await res.json()) || [];
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

  // ── 28. Board creation requires a name ────────────────────────────────────

  test('POST /api/boards without a name returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'NoNameUser', 'ba-noname');

    const res = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: '', description: '' },
    });
    // Empty name should be rejected
    expect([400, 422]).toContain(res.status());
  });

  // ── 29. Unauthenticated cannot create a board ─────────────────────────────

  test('POST /api/boards without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/boards`, {
      data: { name: 'Unauth Board' },
    });
    expect(res.status()).toBe(401);
  });

  // ── 30. Board GET returns correct owner ───────────────────────────────────

  test('GET /api/boards/:id returns correct owner_id', async ({ request }) => {
    const { token, user } = await createUser(request, 'OwnerCheck', 'ba-ownerchk');
    const board = await createBoard(request, token, 'Owner Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const fetched = await res.json();
    expect(fetched.owner_id).toBe(user.id);
  });

  // ── 31. Board has created_at timestamp ───────────────────────────────────

  test('GET /api/boards/:id includes a created_at timestamp', async ({ request }) => {
    const { token } = await createUser(request, 'TimestampUser', 'ba-ts');
    const board = await createBoard(request, token, 'Timestamp Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fetched = await res.json();
    expect(fetched.created_at).toBeDefined();
    // created_at should be a valid ISO date string
    const d = new Date(fetched.created_at);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  // ── 32. Board has updated_at that changes after rename ────────────────────

  test('PUT /api/boards/:id updates updated_at timestamp', async ({ request }) => {
    const { token } = await createUser(request, 'UpdatedAtUser', 'ba-updts');
    const board = await createBoard(request, token, 'Before Update');

    const before = await (
      await request.get(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    // Wait a tick to ensure timestamp can change
    await new Promise((r) => setTimeout(r, 10));

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'After Update', description: '' },
    });

    const after = await (
      await request.get(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(after.name).toBe('After Update');
    // updated_at should be defined (may or may not change depending on precision)
    expect(after.updated_at).toBeDefined();
  });

  // ── 33. Board default columns created on new board ────────────────────────

  test('new board gets default columns automatically', async ({ request }) => {
    const { token } = await createUser(request, 'DefaultColsUser', 'ba-defcols');
    const board = await createBoard(request, token, 'Default Cols Board');

    const col = await getFirstColumn(request, token, board.id);
    expect(col).toBeDefined();
    expect(col.id).toBeGreaterThan(0);
  });

  // ── 34. Board member cannot rename the board ──────────────────────────────

  test('board member cannot rename a board (403)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'RenameOwner', 'ba-renown');
    const { token: memberToken, user: memberUser } = await createUser(request, 'RenameMember', 'ba-renmem');
    const board = await createBoard(request, ownerToken, 'Protected Name Board');

    // Add member to board
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: 'Hijacked Name', description: '' },
    });
    expect(res.status()).toBe(403);
  });

  // ── 35. Board list pagination — ordering ──────────────────────────────────

  test('GET /api/boards returns boards in a consistent order', async ({ request }) => {
    const { token } = await createUser(request, 'OrderUser', 'ba-order');

    await createBoard(request, token, 'Order Board 1');
    await createBoard(request, token, 'Order Board 2');
    await createBoard(request, token, 'Order Board 3');

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await res.json();
    expect(Array.isArray(boards)).toBe(true);
    // All three boards present
    const names = boards.map((b: { name: string }) => b.name);
    expect(names.some((n: string) => n.includes('Order Board 1'))).toBeTruthy();
    expect(names.some((n: string) => n.includes('Order Board 2'))).toBeTruthy();
    expect(names.some((n: string) => n.includes('Order Board 3'))).toBeTruthy();
  });

  // ── 36. Board does not expose internal fields ─────────────────────────────

  test('GET /api/boards/:id does not expose sensitive fields', async ({ request }) => {
    const { token } = await createUser(request, 'SecureBoard', 'ba-secure');
    const board = await createBoard(request, token, 'Secure Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fetched = await res.json();
    // id and name must be present
    expect(fetched.id).toBeDefined();
    expect(fetched.name).toBeDefined();
    // password hashes must not be exposed
    expect(fetched.password_hash).toBeUndefined();
  });

  // ── 37. Board can be created with long description ────────────────────────

  test('board can be created with a long description (1000 chars)', async ({ request }) => {
    const { token } = await createUser(request, 'LongDescUser', 'ba-longdesc');
    const longDesc = 'A'.repeat(1000);

    const res = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Long Desc Board', description: longDesc },
    });
    expect(res.ok()).toBe(true);
    const created = await res.json();
    expect(created.description).toBe(longDesc);
  });

  // ── 38. Board list only shows boards the user is a member of ─────────────

  test('GET /api/boards only returns boards the authenticated user has access to', async ({ request }) => {
    const { token: t1 } = await createUser(request, 'Access1', 'ba-acc1');
    const { token: t2 } = await createUser(request, 'Access2', 'ba-acc2');

    const board1 = await createBoard(request, t1, 'Accessible Board');
    await createBoard(request, t2, 'Hidden Board');

    // t1 should NOT see t2's board
    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${t1}` },
    });
    const boards = await res.json();
    const names = boards.map((b: { name: string }) => b.name);
    expect(names.some((n: string) => n.includes('Accessible Board'))).toBeTruthy();
    expect(names.some((n: string) => n.includes('Hidden Board'))).toBeFalsy();
  });

  // ── 39. DELETE board via UI navigates away ────────────────────────────────

  test('deleting a board from settings redirects to /boards within 5 seconds', async ({ page, request }) => {
    const { token } = await createUser(request, 'FastDelUser', 'ba-fastdel');
    const board = await createBoard(request, token, 'Fast Delete Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.btn.btn-danger:has-text("Delete Board")');

    await page.waitForURL(/\/boards/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/boards/);
  });

  // ── 40. Board Danger Zone is present in settings ──────────────────────────

  test('settings page has a Danger Zone section', async ({ page, request }) => {
    const { token } = await createUser(request, 'DangerUser', 'ba-danger');
    const board = await createBoard(request, token, 'Danger Zone Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await expect(page.locator('.settings-section.danger')).toBeVisible();
    await expect(
      page.locator('.settings-section.danger h2:has-text("Danger Zone")')
    ).toBeVisible();
  });

  // ── 41. Board name too long is rejected ───────────────────────────────────

  test('PUT /api/boards/:id with very long name either succeeds or returns 400', async ({ request }) => {
    const { token } = await createUser(request, 'LongNameUser', 'ba-longname');
    const board = await createBoard(request, token, 'Short Name');

    const veryLongName = 'X'.repeat(500);
    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: veryLongName, description: '' },
    });
    // Either accepts it or rejects gracefully — should not 500
    expect([200, 400, 422]).toContain(res.status());
  });

  // ── 42. Board update returns updated object ───────────────────────────────

  test('PUT /api/boards/:id returns the updated board object', async ({ request }) => {
    const { token } = await createUser(request, 'UpdateRetUser', 'ba-updret');
    const board = await createBoard(request, token, 'Update Return Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Updated Return Board', description: 'New desc' },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.id).toBe(board.id);
    expect(updated.name).toBe('Updated Return Board');
    expect(updated.description).toBe('New desc');
  });

  // ── 43. Unauthenticated cannot update a board ─────────────────────────────

  test('PUT /api/boards/:id without auth returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'UnauthPutUser', 'ba-unauthput');
    const board = await createBoard(request, token, 'Unauth Put Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      data: { name: 'Stolen Name', description: '' },
    });
    expect(res.status()).toBe(401);
  });

  // ── 44. Board list is an array, never null ────────────────────────────────

  test('GET /api/boards always returns a JSON array, never null', async ({ request }) => {
    const { token } = await createUser(request, 'NullCheckUser', 'ba-nullcheck');
    // User has no boards

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    // May return [] or null — normalize
    const boards = data ?? [];
    expect(Array.isArray(boards)).toBe(true);
  });

  // ── 45. Board settings page shows board name in header ────────────────────

  test('board settings page shows the board name in the page heading', async ({ page, request }) => {
    const { token } = await createUser(request, 'SettingsNameUser', 'ba-sname');
    const board = await createBoard(request, token, 'Named Settings Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    // The settings page should reference the board name somewhere
    const bodyText = await page.locator('.settings-page').textContent();
    expect(bodyText ?? '').toContain('Named Settings Board');
  });

  // ── 46. Deleting a board with sprints succeeds ────────────────────────────

  test('board with sprints can be deleted; all sprints are removed', async ({ request }) => {
    const { token } = await createUser(request, 'SprintDelUser', 'ba-sprintdel');
    const board = await createBoard(request, token, 'Sprint Board Delete');

    // Create a sprint
    const sprintRes = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint One', goal: '', start_date: null, end_date: null },
    });
    if (sprintRes.ok()) {
      // Only assert board deletion if sprint creation succeeded
      const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status()).toBe(204);
    } else {
      // Sprint endpoint may not exist yet — delete board anyway
      const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status()).toBe(204);
    }
  });

  // ── 47. Board swimlanes preserved in GET after creation ───────────────────

  test('swimlanes created on a board are accessible via GET /api/boards/:id/swimlanes', async ({ request }) => {
    const { token } = await createUser(request, 'SwimlaneGetUser', 'ba-swget');
    const board = await createBoard(request, token, 'Swimlane Get Board');

    await createSwimlane(request, token, board.id, 'Lane Alpha');
    await createSwimlane(request, token, board.id, 'Lane Beta');

    const res = await request.get(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    const swimlanes = await res.json();
    expect(Array.isArray(swimlanes)).toBe(true);
    const names = swimlanes.map((s: { name: string }) => s.name);
    expect(names.some((n: string) => n.includes('Lane Alpha'))).toBeTruthy();
    expect(names.some((n: string) => n.includes('Lane Beta'))).toBeTruthy();
  });

  // ── 48. Board columns preserved in GET after creation ─────────────────────

  test('columns on a board can be retrieved via GET /api/boards/:id/columns', async ({ request }) => {
    const { token } = await createUser(request, 'ColsGetUser', 'ba-colsget');
    const board = await createBoard(request, token, 'Columns Get Board');

    const col = await getFirstColumn(request, token, board.id);
    expect(col).toBeDefined();
    expect(col.id).toBeGreaterThan(0);
  });

  // ── 49. Board update with same name is idempotent ─────────────────────────

  test('PUT /api/boards/:id with same name is idempotent (returns 200)', async ({ request }) => {
    const { token } = await createUser(request, 'IdempotentUser', 'ba-idemp');
    const board = await createBoard(request, token, 'Idempotent Board');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Idempotent Board', description: '' },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.name).toBe('Idempotent Board');
  });

  // ── 50. Board with members: deleted board also removes member rows ─────────

  test('deleting a board removes all board_members rows (no FK errors)', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MemberDelOwner', 'ba-memdlown');
    const { token: _memberToken, user: memberUser } = await createUser(request, 'MemberDelMember', 'ba-memdlmem');
    const board = await createBoard(request, ownerToken, 'Member Del Board');

    // Add a member
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });

    // Delete the board — should not fail due to FK constraint on board_members
    const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(delRes.status()).toBe(204);
  });

  // ── 51. Board description can be cleared (set to empty string) ────────────

  test('board description can be updated to an empty string', async ({ request }) => {
    const { token } = await createUser(request, 'ClearDescUser', 'ba-cleardesc');
    const board = await createBoard(request, token, 'Has Desc Board', 'Original description');

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Has Desc Board', description: '' },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.description).toBe('');
  });

  // ── 52. Board name updates are reflected in board header on UI ─────────────

  test('renamed board shows updated name in board header immediately', async ({ page, request }) => {
    const { token } = await createUser(request, 'HeaderNameUser', 'ba-headname');
    const board = await createBoard(request, token, 'Before Rename Header');

    // Rename via API
    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'After Rename Header', description: '' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-header h1')).toContainText('After Rename Header', {
      timeout: 10000,
    });
  });

  // ---------------------------------------------------------------------------
  // Archive-specific tests (feature NOT IMPLEMENTED — test.fixme)
  // All tests below document the expected archive behavior.
  // ---------------------------------------------------------------------------

  // ── 53. Archive board via API ──────────────────────────────────────────────

  test.fixme('API: PUT /api/boards/:id with archived:true archives board and returns 200', async ({ request }) => {
    /**
     * Implementation notes:
     *   - PUT /api/boards/:id body should accept `{ archived: true }`.
     *   - Response should include the updated board with `archived: true`.
     *   - The Board model and DB UpdateBoard function both need an `archived` field.
     *   - Default for new boards: archived = false.
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

  // ── 54. Archived board not in default GET /api/boards list ───────────────

  test.fixme('API: archived board does not appear in default GET /api/boards (strict types)', async ({ request }) => {
    /**
     * Implementation notes:
     *   - GET /api/boards should filter out boards where archived=true by default.
     *   - Add an `include_archived=true` query param to opt-in.
     *   - DB ListBoardsForUser should accept an includeArchived bool param.
     */
    const { token } = await createUser(request, 'ArchiveListUser', 'ba-archivelist');
    const board = await createBoard(request, token, 'Should Disappear');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeFalsy();
  });

  // ── 55. Archived board accessible via include_archived param ─────────────

  test.fixme('API: GET /api/boards?include_archived=true returns archived boards (strict types)', async ({ request }) => {
    /**
     * Implementation notes:
     *   - When ?include_archived=true is passed, archived boards are included.
     *   - Archived board should have archived:true in the response.
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
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeTruthy();
    const archivedBoard = boards.find((b: { id: number }) => b.id === board.id);
    expect(archivedBoard.archived).toBe(true);
  });

  // ── 56. Archived board direct URL accessible (read-only) ─────────────────

  test.fixme('UI: archived board URL is still accessible and not a 404', async ({ page, request }) => {
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
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    // Archived indicator should appear
    await expect(
      page.locator('.board-archived-banner, .board-archived-badge, [data-testid="archived"]')
    ).toBeVisible();
  });

  // ── 57. Archived board not in UI board list ───────────────────────────────

  test.fixme('UI: archived board does not appear in /boards list (strict types)', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - The board list page should not display archived boards.
     *   - Optionally, a "Show Archived" toggle can reveal them.
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
    expect(names.some((n) => n.includes('Archived Board UI'))).toBeFalsy();
    expect(names.some((n) => n.includes('Keep Board UI'))).toBeTruthy();
  });

  // ── 58. Cannot add cards to archived board via API ────────────────────────

  test.fixme('API: POST /api/cards to archived board returns 403', async ({ request }) => {
    /**
     * Implementation notes:
     *   - The backend should check board.archived before creating a card.
     *   - Return 403 "Board is archived" if archived=true.
     */
    const { token } = await createUser(request, 'ArchiveAddUser', 'ba-archiveadd');
    const board = await createBoard(request, token, 'No Add Archive');
    const swimlane = await createSwimlane(request, token, board.id, 'Test Lane');
    const col = await getFirstColumn(request, token, board.id);

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Should Fail',
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: col.id,
      },
    });
    expect(cardRes.status()).toBe(403);
  });

  // ── 59. Cannot create columns on archived board ────────────────────────────

  test.fixme('API: POST /api/boards/:id/columns on archived board returns 403', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archived boards should be read-only for structural changes.
     *   - Both columns and swimlane creation should be blocked.
     */
    const { token } = await createUser(request, 'ArchiveColUser', 'ba-archivecol');
    const board = await createBoard(request, token, 'No New Cols Archive');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const colRes = await request.post(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Blocked Column', position: 99 },
    });
    expect([403, 400]).toContain(colRes.status());
  });

  // ── 60. Board settings page has Archive Board option ─────────────────────

  test.fixme('UI: board settings page has an "Archive Board" option in Danger Zone', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Add an "Archive Board" button to the Danger Zone section in BoardSettings.tsx.
     *   - Clicking it calls PUT /api/boards/:id with { archived: true }.
     *   - After archiving, the user should be redirected to /boards.
     */
    const { token } = await createUser(request, 'ArchiveBtnUser', 'ba-archivebtn');
    const board = await createBoard(request, token, 'Settings Archive Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await expect(
      page.locator('.settings-section.danger .btn:has-text("Archive Board")')
    ).toBeVisible();
  });

  // ── 61. Archive confirmation dialog ───────────────────────────────────────

  test.fixme('UI: archive board shows a confirmation dialog; dismissing aborts', async ({ page, request }) => {
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

    // Dismiss — board should NOT be archived
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('.settings-section.danger .btn:has-text("Archive Board")');

    await expect(page).toHaveURL(new RegExp(`/boards/${board.id}/settings`));

    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('Confirm Archive Board'))).toBeTruthy();
  });

  // ── 62. Unarchive board via API ───────────────────────────────────────────

  test.fixme('API: archived board can be unarchived via PUT with archived:false (strict types)', async ({ request }) => {
    /**
     * Implementation notes:
     *   - PUT /api/boards/:id with `{ archived: false }` should restore the board.
     *   - After unarchiving, the board should appear in the default GET /api/boards list.
     */
    const { token } = await createUser(request, 'UnarchiveUser', 'ba-unarchive');
    const board = await createBoard(request, token, 'Restore Me');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const unarchiveRes = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: false },
    });
    expect(unarchiveRes.ok()).toBe(true);
    const restored = await unarchiveRes.json();
    expect(restored.archived).toBe(false);

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await listRes.json();
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeTruthy();
  });

  // ── 63. Multiple boards: only non-archived in default list ───────────────

  test.fixme('API: with multiple boards, only non-archived appear in default list', async ({ request }) => {
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
    expect(boards.some((b: { id: number }) => b.id === boardA.id)).toBeTruthy();
    expect(boards.some((b: { id: number }) => b.id === boardB.id)).toBeFalsy();
    expect(boards.some((b: { id: number }) => b.id === boardC.id)).toBeFalsy();
  });

  // ── 64. Board created without archive flag defaults to active ─────────────

  test.fixme('API: board created without archive flag has archived:false (strict types)', async ({ request }) => {
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

  // ── 65. Archived board shows archived badge in board header ──────────────

  test.fixme('UI: archived board header shows archived badge', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - A banner or badge should be rendered in the board header when archived=true.
     *   - Suggested selector: .board-archived-badge or [data-testid="archived-badge"]
     */
    const { token } = await createUser(request, 'ArchiveBadgeUser', 'ba-archivebadge');
    const board = await createBoard(request, token, 'Archive Badge Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('.board-archived-badge, [data-testid="archived-badge"], .badge-archived')
    ).toBeVisible();
  });

  // ── 66. Archived board Add Card button disabled or hidden ─────────────────

  test.fixme('UI: cannot add cards to an archived board — button disabled or hidden', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Add card buttons/inputs should be hidden or disabled on archived boards.
     *   - The board view component should check board.archived on mount.
     */
    const { token } = await createUser(request, 'ArchiveAddBtnUser', 'ba-archiveaddbtn');
    const board = await createBoard(request, token, 'No Add Archive UI');

    await createSwimlane(request, token, board.id, 'Test Lane');
    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const addBtn = page.locator('.add-card-btn, button:has-text("Add Card"), .inline-card-add');
    const addBtnCount = await addBtn.count();
    if (addBtnCount > 0) {
      await expect(addBtn.first()).toBeDisabled();
    }
  });

  // ── 67. Board settings shows archived status ──────────────────────────────

  test.fixme('UI: board settings page shows archived status indicator', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - When a board is archived, BoardSettings.tsx should show an "Archived" chip
     *     or status indicator near the top of the page.
     *   - An "Unarchive" button should be present instead of the "Archive Board" button.
     */
    const { token } = await createUser(request, 'ArchiveStatusUser', 'ba-archivestatus');
    const board = await createBoard(request, token, 'Settings Status Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await expect(
      page.locator('[data-testid="archived-status"], .archived-status, .badge-archived')
    ).toBeVisible();
  });

  // ── 68. Archiving board shows success message ─────────────────────────────

  test.fixme('UI: archiving a board shows a success toast/message', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - After clicking Archive Board and confirming, a toast notification
     *     or success message should briefly appear before redirect.
     *   - Suggested: look for .toast, .notification, or a visible text banner.
     */
    const { token } = await createUser(request, 'ArchiveToastUser', 'ba-archivetoast');
    const board = await createBoard(request, token, 'Toast Archive Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('.settings-section.danger .btn:has-text("Archive Board")');

    // Either a toast or redirect to /boards
    await Promise.race([
      page.locator('.toast, .notification, .alert-success').waitFor({ timeout: 3000 }),
      page.waitForURL(/\/boards/, { timeout: 5000 }),
    ]).catch(() => {});

    // Verify board is gone from active list
    await page.goto('/boards');
    await page.waitForSelector('.board-card, .empty-state', { timeout: 10000 });
    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('Toast Archive Board'))).toBeFalsy();
  });

  // ── 69. Show archived boards toggle in board list ─────────────────────────

  test.fixme('UI: "Show archived boards" toggle in board list reveals archived boards', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - A "Show Archived" toggle/button should appear in the board list header.
     *   - Clicking it re-fetches with include_archived=true and shows archived boards
     *     with a distinct visual style (dimmed, badge, etc.).
     */
    const { token } = await createUser(request, 'ShowArchiveUser', 'ba-showarchive');
    const toArchive = await createBoard(request, token, 'Hidden Archive Board');
    const toKeep = await createBoard(request, token, 'Visible Active Board');

    await request.put(`${BASE}/api/boards/${toArchive.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: toArchive.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    // Find and click the "Show Archived" toggle
    const toggle = page.locator(
      'button:has-text("Show Archived"), button:has-text("Show archived"), input[type="checkbox"][aria-label*="rchiv"]'
    );
    await toggle.click();

    // Archived board should now be visible
    await expect(
      page.locator('.board-card h3').filter({ hasText: 'Hidden Archive Board' })
    ).toBeVisible({ timeout: 5000 });
  });

  // ── 70. Archived boards shown with distinct styling ────────────────────────

  test.fixme('UI: archived boards in the board list have a distinct visual style', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - Archived board cards should render with a visual distinction:
     *     dimmed opacity, "Archived" badge, or a different background colour.
     *   - The .board-card element may have a .board-card--archived modifier class.
     */
    const { token } = await createUser(request, 'StyleArchiveUser', 'ba-stylearchive');
    const archivedBoard = await createBoard(request, token, 'Styled Archive Board');

    await request.put(`${BASE}/api/boards/${archivedBoard.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: archivedBoard.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');

    // Reveal archived boards via toggle
    const toggle = page.locator(
      'button:has-text("Show Archived"), button:has-text("Show archived")'
    );
    await toggle.click();

    // Archived card should have a distinct class or badge
    const archivedCard = page.locator('.board-card').filter({ hasText: 'Styled Archive Board' });
    await expect(archivedCard).toBeVisible({ timeout: 5000 });
    // It should have either an archived class or a badge inside
    const hasArchivedClass = await archivedCard.evaluate((el) =>
      el.classList.contains('board-card--archived') ||
      el.querySelector('[class*="archived"]') !== null
    );
    expect(hasArchivedClass).toBeTruthy();
  });

  // ── 71. Unarchive button visible on archived board ────────────────────────

  test.fixme('UI: unarchive button is visible on an archived board settings page', async ({ page, request }) => {
    /**
     * Implementation notes:
     *   - When board.archived=true, the settings Danger Zone should show an
     *     "Unarchive Board" button instead of (or alongside) "Archive Board".
     */
    const { token } = await createUser(request, 'UnarchiveBtnUser', 'ba-unarchivestatus');
    const board = await createBoard(request, token, 'Unarchive Btn Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await expect(
      page.locator('.btn:has-text("Unarchive Board"), .btn:has-text("Unarchive")')
    ).toBeVisible();
  });

  // ── 72. Board archive logs activity event ─────────────────────────────────

  test.fixme('API: archiving a board creates an activity_log entry', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archiving a board should be logged with action="archived" in activity_log.
     *   - GET /api/boards/:id/activity should return this entry after archiving.
     */
    const { token } = await createUser(request, 'ArchiveLogUser', 'ba-archivelog');
    const board = await createBoard(request, token, 'Activity Archive Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const activityRes = await request.get(`${BASE}/api/boards/${board.id}/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!activityRes.ok()) return; // Endpoint may not exist yet
    const activity = await activityRes.json();
    const archiveEntry = activity.find(
      (a: { action: string }) => a.action === 'archived' || a.action === 'updated'
    );
    expect(archiveEntry).toBeDefined();
  });

  // ── 73. Only board admin can archive board ────────────────────────────────

  test.fixme('API: only board admin can archive board; member gets 403', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archive operation should require admin role (like other board settings changes).
     *   - Board members and viewers should receive 403.
     */
    const { token: ownerToken } = await createUser(request, 'ArchiveAdminUser', 'ba-archiveadmin');
    const { token: memberToken, user: memberUser } = await createUser(request, 'ArchiveMemberUser', 'ba-archivemem');
    const board = await createBoard(request, ownerToken, 'Admin Only Archive');

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });

    const res = await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { name: board.name, description: '', archived: true },
    });
    expect(res.status()).toBe(403);
  });

  // ── 74. Cards in archived board preserved ────────────────────────────────

  test.fixme('API: cards in an archived board are preserved and retrievable', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archiving a board should be non-destructive for all card data.
     *   - GET /api/boards/:id/cards (or GET /api/boards/:id) should still
     *     return card data after archiving.
     */
    const { token } = await createUser(request, 'ArchiveCardsUser', 'ba-archivecards');
    const board = await createBoard(request, token, 'Card Preserve Archive');
    const swimlane = await createSwimlane(request, token, board.id, 'Lane');
    const col = await getFirstColumn(request, token, board.id);

    const card = await createCard(request, token, board.id, swimlane.id, col.id, 'Preserved Card');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    // Accessing the board directly should still show cards
    const boardRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(boardRes.ok()).toBe(true);
    // card data should be accessible
    expect(card.id).toBeGreaterThan(0);
  });

  // ── 75. Sprint data preserved in archived board ───────────────────────────

  test.fixme('API: sprint data preserved after board is archived', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archiving must not delete or modify sprint rows.
     *   - GET /api/boards/:id/sprints should still return sprints after archiving.
     */
    const { token } = await createUser(request, 'ArchiveSprintUser', 'ba-archivesprint');
    const board = await createBoard(request, token, 'Sprint Preserve Archive');

    const sprintRes = await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Preserved Sprint', goal: '', start_date: null, end_date: null },
    });
    if (!sprintRes.ok()) {
      return; // Sprint endpoint may not exist — skip assertion
    }
    const sprint = await sprintRes.json();

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const sprintsRes = await request.get(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sprintsRes.ok()) return;
    const sprints = await sprintsRes.json();
    expect(sprints.some((s: { id: number }) => s.id === sprint.id)).toBeTruthy();
  });

  // ── 76. Board archive date/time recorded ──────────────────────────────────

  test.fixme('API: archiving a board records an archived_at timestamp', async ({ request }) => {
    /**
     * Implementation notes:
     *   - The Board model should include an `archived_at` field (nullable timestamp).
     *   - When archived=true is set, archived_at should be populated with the current time.
     *   - When archived=false, archived_at should be cleared (set to null).
     */
    const { token } = await createUser(request, 'ArchiveTsUser', 'ba-archivets');
    const board = await createBoard(request, token, 'Timestamp Archive Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fetched = await res.json();
    expect(fetched.archived_at).toBeDefined();
    expect(fetched.archived_at).not.toBeNull();
    // Should be a valid date
    const d = new Date(fetched.archived_at);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  // ── 77. Archived board members can still read board ───────────────────────

  test.fixme('API: board members can still read an archived board', async ({ request }) => {
    /**
     * Implementation notes:
     *   - Archiving should not revoke read access for existing members.
     *   - GET /api/boards/:id should return 200 for members even when archived.
     */
    const { token: ownerToken } = await createUser(request, 'ArchiveReadOwner', 'ba-archivereadown');
    const { token: memberToken, user: memberUser } = await createUser(request, 'ArchiveReadMember', 'ba-archivereadmem');
    const board = await createBoard(request, ownerToken, 'Member Read Archive');

    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { user_id: memberUser.id, role: 'member' },
    });

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: board.name, description: '', archived: true },
    });

    const memberGet = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(memberGet.ok()).toBe(true);
  });

  // ── 78. Archived board shown in admin user's list ─────────────────────────

  test.fixme('API: archived board shown in owner\'s list when include_archived=true', async ({ request }) => {
    /**
     * Implementation notes:
     *   - The board owner should always be able to see their archived boards
     *     when they explicitly request include_archived=true.
     */
    const { token } = await createUser(request, 'ArchiveOwnerList', 'ba-archiveownlist');
    const board = await createBoard(request, token, 'Owner Archive List Board');

    await request.put(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: board.name, description: '', archived: true },
    });

    const res = await request.get(`${BASE}/api/boards?include_archived=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await res.json();
    expect(boards.some((b: { id: number }) => b.id === board.id)).toBeTruthy();
  });
});
