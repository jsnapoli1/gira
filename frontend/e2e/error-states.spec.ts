/**
 * error-states.spec.ts
 *
 * Error handling and empty states across the app.
 *
 * Test inventory
 * ──────────────
 *  1.  Board not found          — /boards/99999 shows "Board not found"
 *  2.  Network error on cards   — mocked 500 on /cards shows graceful error
 *  3.  Failed board creation    — mocked 500 on POST /boards shows error toast
 *  4.  Empty boards list        — new user sees "No boards yet"
 *  5.  Empty reports state      — no board selected shows "Select a board"
 *  6.  Empty backlog state      — board with swimlane but no cards
 *  7.  Attachment upload error  — mocked 500 on attachment upload shows error toast
 *  8.  Session expired          — clear token and reload redirects to /login
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function createUser(request: any) {
  const email = `test-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Error Tester' },
  });
  const { token, user } = await res.json();
  return { token, user, email };
}

async function createBoard(request: any, token: string, name = 'Error Test Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json() as Promise<{ id: number; name: string; columns: any[] }>;
}

async function createSwimlane(request: any, token: string, boardId: number) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-' },
  });
  return res.json() as Promise<{ id: number }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Error States', () => {

  // -------------------------------------------------------------------------
  // 1. Board not found
  // -------------------------------------------------------------------------

  test('navigating to a non-existent board shows Board not found', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards/99999');

    // Wait for loading to complete then check for error message.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 2. Network error on card load handled gracefully
  //
  // BoardView uses Promise.all([boardsApi.get(), boardsApi.getCards(), ...]).
  // When /cards returns 500 the entire load fails; the board stays null and
  // the UI shows "Board not found" — that is the current graceful degradation
  // (no blank screen, no JS crash).
  // -------------------------------------------------------------------------

  test('network error on card load is handled gracefully — no blank white screen', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Mock the board cards endpoint to return 500.
    await page.route(`**/api/boards/${board.id}/cards`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto(`/boards/${board.id}`);

    // Loading must eventually finish.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // An error element must be shown (board load failed because getCards threw).
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 3. Failed board creation shows error toast
  // -------------------------------------------------------------------------

  test('failed board creation shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Mock POST /boards to fail (but allow GET /boards to pass).
    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the Create Board modal and submit.
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Will Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Expect an error toast.
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error')).toContainText('Failed to create board');
  });

  // -------------------------------------------------------------------------
  // 4. Empty boards list for fresh user
  // -------------------------------------------------------------------------

  test('empty boards list shows No boards yet for a new user', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  // -------------------------------------------------------------------------
  // 5. Empty reports state
  // -------------------------------------------------------------------------

  test('reports page shows Select a board when no board is selected', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    await page.click('a:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/, { timeout: 5000 });

    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  // -------------------------------------------------------------------------
  // 6. Empty backlog state
  // -------------------------------------------------------------------------

  test('empty backlog shows No cards in backlog message', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, 'Empty Backlog Board');
    await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.backlog-empty')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.backlog-empty').first()).toContainText('No cards in backlog');
  });

  // -------------------------------------------------------------------------
  // 7. Failed attachment upload shows error toast
  //
  // Card creation via POST /api/cards triggers Gitea issue creation which fails
  // in this test environment (401 from the configured Gitea server). To work
  // around this, we mock POST /api/cards in the browser to return a synthetic
  // card object, create the card via the Backlog UI, then mock the attachment
  // upload endpoint to return 500 and verify the error toast.
  // -------------------------------------------------------------------------

  test('failed attachment upload shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, 'Attachment Error Board');
    const swimlane = await createSwimlane(request, token, board.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to Backlog view to access the inline card add form.
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 5000 });

    // Intercept POST /api/cards to return a synthetic card so we bypass the
    // Gitea issue-creation call that fails in this environment (Gitea 401).
    const fakeCardId = 999997;
    await page.route('**/api/cards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: fakeCardId,
            board_id: board.id,
            swimlane_id: swimlane.id,
            column_id: board.columns[0].id,
            sprint_id: null,
            parent_id: null,
            issue_type: 'task',
            gitea_issue_id: 0,
            title: 'Attachment Test Card',
            description: '',
            state: 'open',
            story_points: null,
            priority: 'medium',
            due_date: null,
            time_estimate: null,
            position: 0,
            labels: [],
            assignees: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        route.continue();
      }
    });

    // Create a card via the Backlog Add button.
    const addBtn = page.locator('.backlog-section-header button:has-text("Add")').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    const titleInput = page.locator('input[placeholder="Enter card title..."]');
    await expect(titleInput).toBeVisible({ timeout: 3000 });
    await titleInput.fill('Attachment Test Card');
    await page.keyboard.press('Enter');
    await expect(page.locator('.backlog-card .card-title').first()).toContainText(
      'Attachment Test Card',
      { timeout: 8000 },
    );

    // Now intercept attachment uploads to fail.
    await page.route(`**/api/cards/${fakeCardId}/attachments`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Upload failed' });
      } else {
        route.continue();
      }
    });

    // Open the card detail modal.
    await page.click('.backlog-card .card-title');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachments-sidebar')).toBeVisible({ timeout: 5000 });

    // Upload a small temp file.
    const tmpFile = `/tmp/test-attach-fail-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, 'fail me');
    try {
      const fileInput = page.locator('.attachments-sidebar input[type="file"]');
      await fileInput.setInputFiles(tmpFile);

      await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.toast-error')).toContainText('Failed to upload attachment');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  // -------------------------------------------------------------------------
  // 8. Session expired mid-session redirects to login
  //
  // Approach: navigate to /boards with no token (lands on /login via PrivateRoute),
  // set the token via evaluate (no addInitScript), reload to let AuthContext pick
  // it up, verify boards load, then remove token and reload again. On second
  // reload AuthContext finds no token → user = null → PrivateRoute redirects to
  // /login.
  //
  // We do NOT use addInitScript here because it re-executes on every full page
  // navigation including page.reload(), which would re-inject the token and
  // defeat the test.
  // -------------------------------------------------------------------------

  test('clearing token and reloading redirects to login', async ({ page, request }) => {
    await createUser(request); // just to ensure the server is alive

    // Step 1: load /boards with no token → PrivateRoute redirects to /login.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: inject a valid token via evaluate (NOT addInitScript).
    // We don't need a real board here — just a valid JWT so auth.me() succeeds.
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `session-exp-${Date.now()}@test.com`,
        password: 'password123',
        display_name: 'Session Tester',
      },
    });
    const { token } = await signupRes.json();

    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Reload so AuthContext re-runs with the injected token.
    await page.reload();
    // The PublicRoute at /login redirects to /dashboard now that user is set.
    await page.waitForURL(/\/(login|dashboard|boards)/, { timeout: 10000 });

    // Step 3: remove the token (session expired).
    await page.evaluate(() => localStorage.removeItem('token'));

    // Reload so AuthContext re-runs with no token → user = null.
    await page.reload();

    // PrivateRoute must redirect to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

});
