/**
 * error-states.spec.ts
 *
 * Error handling and empty states across the app:
 *   1. Board not found shows "Board not found"
 *   2. Network error on card load handled gracefully
 *   3. Failed board creation shows error toast
 *   4. Empty boards list state shown for new user
 *   5. Empty reports state shown when no board selected
 *   6. Empty backlog state shown with no cards
 *   7. Failed attachment upload shows error toast
 *   8. Session expired mid-session redirects to login
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helpers
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
  return res.json();
}

async function createSwimlaneAndCard(request: any, token: string, board: any) {
  const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Swimlane', designator: 'TS-' },
  })).json();

  const columns = board.columns;
  const card = await (await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  })).json();

  return { swimlane, card };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Error States', () => {

  /**
   * 1. Board not found shows error
   *
   * Navigate to /boards/99999 (a non-existent board). The app should render
   * "Board not found" rather than throwing a JS error or showing a blank screen.
   */
  test('navigating to a non-existent board shows Board not found', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards/99999');

    // The board page renders a .error div with "Board not found" when the API
    // returns 404 / an empty board.
    await expect(page.locator('.error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  /**
   * 2. Network error on card load handled gracefully
   *
   * Intercept GET /api/boards/:id/cards and return a 500. The app should
   * show an error message or empty state rather than a blank white screen.
   * The board header or a recognisable UI element must still be visible.
   */
  test('network error on card load is handled gracefully — no blank white screen', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Mock the board cards endpoint to return 500. Because BoardView uses
    // Promise.all([boardsApi.get(), boardsApi.getCards(), ...]) a cards failure
    // propagates to the whole load — the board stays null and the page renders
    // "Board not found" via the `.error` div. That is the expected behaviour:
    // the UI does not crash or show a blank screen.
    await page.route(`**/api/boards/${board.id}/cards`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto(`/boards/${board.id}`);

    // Wait for the loading state to finish and something meaningful to render.
    // The page must show either the .error div or at least have some UI visible.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // After loading completes, an error element should be shown (board load
    // failed due to the 500 on /cards). A blank white screen is not acceptable.
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error')).toContainText('Board not found');
  });

  /**
   * 3. Failed board creation shows error toast
   *
   * Mock POST /api/boards to return 500. Open the Create Board modal, submit
   * it, and verify a toast with an error is shown.
   */
  test('failed board creation shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Navigate to boards list first so the page initialises with the token.
    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Now mock the create endpoint to fail.
    await page.route('**/api/boards', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the Create Board modal.
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Will Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Expect an error toast to appear.
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error')).toContainText('Failed to create board');
  });

  /**
   * 4. Empty boards list state for fresh user
   *
   * A brand-new user with no boards should see the "No boards yet" empty state.
   */
  test('empty boards list shows No boards yet for a new user', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');

    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('No boards yet');
  });

  /**
   * 5. Empty reports state — Select a board prompt
   *
   * A fresh user with no boards who navigates to /reports should see either an
   * "empty-state" with "Select a board" text (if they have no boards) or the
   * board-selection dropdown. We navigate via the sidebar link to avoid
   * triggering a duplicate auth/me call.
   */
  test('reports page shows Select a board when no board is selected', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await expect(page.locator('.page-header h1')).toContainText('Boards', { timeout: 10000 });

    // Navigate to Reports via sidebar.
    await page.click('a:has-text("Reports")');
    await expect(page).toHaveURL(/\/reports/, { timeout: 5000 });

    // Wait for loading to finish.
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10000 });

    // Should show the empty-state with "Select a board" prompt.
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.empty-state h2')).toContainText('Select a board');
  });

  /**
   * 6. Empty backlog state
   *
   * Navigate to a board that has a swimlane but no cards. Switch to Backlog
   * view. The backlog section should show "No cards in backlog" rather than
   * crashing or showing nothing at all.
   */
  test('empty backlog shows No cards in backlog message', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, 'Empty Backlog Board');

    // Create a swimlane but NO cards.
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Empty Swimlane', designator: 'ES-' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to Backlog view.
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible({ timeout: 10000 });

    // The swimlane-level backlog section should show the empty state message.
    await expect(page.locator('.backlog-empty')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.backlog-empty').first()).toContainText('No cards in backlog');
  });

  /**
   * 7. Failed attachment upload shows error toast
   *
   * Mock POST /api/cards/:id/attachments to return 500. Open a card, try
   * uploading an attachment, and verify the error toast is shown (not a silent
   * failure).
   */
  test('failed attachment upload shows an error toast', async ({ page, request }) => {
    const { token } = await createUser(request);
    const board = await createBoard(request, token, 'Attachment Error Board');
    const { card } = await createSwimlaneAndCard(request, token, board);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to All Cards view so cards are visible.
    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible()) {
      await allCardsBtn.click();
    }
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 10000 });

    // Mock the attachment upload endpoint to fail.
    await page.route(`**/api/cards/${card.id}/attachments`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Upload failed' });
      } else {
        route.continue();
      }
    });

    // Open the card detail modal.
    await page.click('.card-item');
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.attachments-sidebar')).toBeVisible({ timeout: 5000 });

    // Write a small temp file and upload it via the hidden file input.
    const tmpFile = `/tmp/test-attach-fail-${Date.now()}.txt`;
    fs.writeFileSync(tmpFile, 'fail me');
    try {
      const fileInput = page.locator('.attachments-sidebar input[type="file"]');
      await fileInput.setInputFiles(tmpFile);

      // The error toast should appear.
      await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.toast-error')).toContainText('Failed to upload attachment');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  /**
   * 8. Session expired mid-session redirects to login
   *
   * Simulate session expiry: load the board page normally with a valid token,
   * then remove the token from localStorage and reload the page. On reload the
   * AuthContext finds no token → user = null → PrivateRoute redirects to /login.
   *
   * NOTE: page.addInitScript re-executes on every navigation triggered by
   * page.goto/page.reload. To avoid re-injecting the token on reload we must
   * NOT use addInitScript. Instead we set the token via page.evaluate once the
   * page has loaded, give React time to initialise, then reload to simulate
   * a browser-level refresh after session expiry.
   *
   * The test pages through two full navigations:
   *   1. page.goto('/boards/ID') — no token yet in localStorage
   *      → PrivateRoute redirects to /login (this is expected)
   *   2. From /login: evaluate to set token, then reload
   *      → This time AuthContext finds the token, calls auth.me(), boards load
   *   3. Evaluate to remove token, then reload
   *      → AuthContext finds no token → /login redirect
   */
  test('clearing token and reloading redirects to login', async ({ page, request }) => {
    const { token } = await createUser(request);

    // Step 1: load with no token — lands on /login via PrivateRoute.
    await page.goto('/boards');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Step 2: inject token and reload so the app picks it up.
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.reload();
    // App should now be on boards page (PrivateRoute passes, PublicRoute for
    // /login redirects to /dashboard since user is now set).
    // It may redirect to /dashboard then show boards, or stay on a protected page.
    await page.waitForURL(/\/(boards|dashboard)/, { timeout: 10000 });

    // Step 3: remove the token (session expired) and reload.
    await page.evaluate(() => localStorage.removeItem('token'));
    await page.reload();

    // Without a token PrivateRoute must redirect to /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

});
