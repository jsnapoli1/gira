/**
 * error-states.spec.ts
 *
 * Error handling and empty/degraded states across the app.
 *
 * Tests in this file do NOT require a card to exist — they either use
 * fresh users with no data, or use page.route() to mock API failures.
 *
 * Test inventory
 * ──────────────
 *  1.  Board not found        — /boards/99999 shows "Board not found"
 *  2.  Cards API 500          — mocked 500 on /cards shows graceful error
 *  3.  Failed board creation  — mocked 500 on POST /boards shows error toast
 *  4.  Empty boards list      — new user sees "No boards yet"
 *  5.  Empty reports state    — no board selected shows "Select a board"
 *  6.  Empty backlog state    — board with swimlane but no cards
 *  7.  Attachment upload error — mocked 500 on upload shows error toast
 *  8.  Session expired        — clearing token and reloading redirects to /login
 *  9.  Invalid JWT token      — expired/garbage token redirects to /login
 * 10.  Network offline        — page.setOffline shows error state
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Error Tester',
  prefix = 'err',
) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-${prefix}-${uid}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const { token, user } = await res.json();
  return { token, user, email };
}

async function createBoard(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  name = 'Error Test Board',
) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json() as Promise<{ id: number; name: string; columns: any[] }>;
}

async function createSwimlane(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  boardId: number,
) {
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
  // 1. Board not found — /boards/99999
  // -------------------------------------------------------------------------

  test('navigating to a non-existent board shows Board not found', async ({ page, request }) => {
    const { token } = await createUser(request, 'NotFound Tester', 'notfound');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards/99999');

    // Loading must eventually finish.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Error element must be shown with "Board not found".
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 2. Network error on card load is handled gracefully — no blank screen
  //
  // BoardView uses Promise.all([boardsApi.get(), boardsApi.getCards(), ...]).
  // When /cards returns 500 the entire load fails; the board stays null and
  // the UI shows "Board not found" — that is the current graceful degradation.
  // -------------------------------------------------------------------------

  test('mocked 500 on board cards API shows graceful error — no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'CardError Tester', 'carderr');
    const board = await createBoard(request, token, 'Card Error Board');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Mock the board cards endpoint to return 500 before navigating.
    await page.route(`**/api/boards/${board.id}/cards`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto(`/boards/${board.id}`);

    // Loading must eventually finish — no infinite spinner.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // An error element must be shown (board load failed because getCards threw).
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  // -------------------------------------------------------------------------
  // 3. Failed board creation shows error toast
  // -------------------------------------------------------------------------

  test('failed board creation shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardErr Tester', 'boarderr');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Mock POST /boards to fail but allow GETs to pass.
    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Will Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error')).toContainText('Failed to create board');
  });

  // -------------------------------------------------------------------------
  // 4. Empty boards list for a fresh user
  // -------------------------------------------------------------------------

  test('empty boards list shows No boards yet for a new user', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty Boards Tester', 'emptyboards');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  // -------------------------------------------------------------------------
  // 5. Empty reports state — no board selected
  // -------------------------------------------------------------------------

  test('reports page shows Select a board when no board is selected', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Reports Tester', 'reportsempty');

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

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
    const { token } = await createUser(request, 'Backlog Tester', 'backlogempty');
    const board = await createBoard(request, token, 'Empty Backlog Board');
    await createSwimlane(request, token, board.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

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
  // POST /api/cards triggers Gitea issue creation which may fail in this
  // environment. To work around this, we mock POST /api/cards in the browser
  // to return a synthetic card object, create the card via the Backlog UI,
  // then mock the attachment upload endpoint to return 500 and verify the
  // error toast.
  // -------------------------------------------------------------------------

  test('failed attachment upload shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request, 'Attach Tester', 'attacherr');
    const board = await createBoard(request, token, 'Attachment Error Board');
    const swimlane = await createSwimlane(request, token, board.id);

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to Backlog view.
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 5000 });

    // Intercept POST /api/cards to return a synthetic card, bypassing Gitea.
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
    await expect(
      page.locator('.backlog-card .card-title').first(),
    ).toContainText('Attachment Test Card', { timeout: 8000 });

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
  // 8. Session expired mid-session — clearing token redirects to /login
  //
  // Uses page.evaluate (not addInitScript) so the token is NOT re-injected
  // on subsequent reloads, which would defeat the test.
  // -------------------------------------------------------------------------

  test('clearing token and reloading redirects to login', async ({ page, request }) => {
    // Step 1: navigate to /boards with no token → PrivateRoute → /login.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: sign up a new user and inject the token via evaluate.
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `session-exp-${uid}@test.com`,
          password: 'password123',
          display_name: 'Session Tester',
        },
      })
    ).json();

    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Reload so AuthContext picks up the injected token.
    await page.reload();
    await page.waitForURL(/\/(login|dashboard|boards)/, { timeout: 10000 });

    // Step 3: simulate session expiry by removing the token.
    await page.evaluate(() => localStorage.removeItem('token'));

    // Reload so AuthContext re-runs with no token → user = null.
    await page.reload();

    // PrivateRoute must redirect to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 9. Invalid JWT token — garbage token redirects to /login
  // -------------------------------------------------------------------------

  test('invalid JWT token redirects to login page', async ({ page }) => {
    // Step 1: navigate to /boards with no token → goes to /login.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: inject a garbage token that the server will reject.
    await page.evaluate(() =>
      localStorage.setItem('token', 'this.is.not.a.valid.jwt'),
    );

    // Reload — AuthContext calls /api/auth/me which returns 401; user stays
    // null; PrivateRoute keeps user on /login.
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 10. Network offline simulation — going offline shows an error
  //
  // page.setOffline(true) blocks all network requests. When the app tries to
  // load /api/boards it fails; the boards list page should show an error state
  // or an empty state (never a blank white screen or an unhandled exception).
  // -------------------------------------------------------------------------

  test('network offline — boards page shows error or empty state, no blank screen', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Offline Tester', 'offline');

    // Inject the token while still online.
    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);

    // Go offline before navigating to boards.
    await page.context().setOffline(true);
    await page.goto('/boards');

    // Wait long enough for any network timeout / error path to resolve.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 15000 });

    // The page must render something useful — either an error message or an
    // empty state.  A completely blank body (no child nodes) is a failure.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(0);

    // Restore network for cleanup.
    await page.context().setOffline(false);
  });

});
