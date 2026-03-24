/**
 * toast-notifications.spec.ts
 *
 * Comprehensive tests for the Toast notification system.
 *
 * Toast component behaviour (from Toast.tsx):
 *  - All toasts auto-dismiss after 3500ms (300ms exit animation → 3800ms total)
 *  - Types: 'success' (.toast-success), 'error' (.toast-error), 'info' (.toast-info)
 *  - Clicking a toast dismisses it immediately
 *  - Multiple toasts stack in .toast-container
 *
 * Test inventory
 * ──────────────
 *  1.  Quick-add card creation shows success toast
 *  2.  Saving card edits shows success toast
 *  3.  Comment post shows no toast on success (verify actual behaviour)
 *  4.  Comment post failure shows error toast
 *  5.  Board creation failure shows error toast (via route interception)
 *  6.  Card update failure shows error toast (via route interception)
 *  7.  Success toast auto-dismisses after ~3.5 seconds
 *  8.  Multiple toasts stack — all visible simultaneously
 *  9.  Clicking a toast dismisses it immediately
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

/**
 * Create user + board + swimlane + card via API, inject token with
 * page.evaluate (NOT addInitScript), navigate to board, and switch to
 * "All Cards" view so the card is visible.
 */
async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  page: import('@playwright/test').Page,
  label = 'Toast',
) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-toast-${uid}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Toast Test Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!cardRes.ok()) {
    test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
    return { board, columns, swimlane, card: null as any, token };
  }

  const card = await cardRes.json();

  // Use page.evaluate (NOT addInitScript) to inject the token so it is set
  // after the page is loaded — avoids re-injection on subsequent reloads.
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to "All Cards" so the card is visible regardless of sprint state.
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, columns, swimlane, card, token };
}

// ---------------------------------------------------------------------------
// 1. Quick-add card creation — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — quick-add card creation', () => {
  test('creating a card via quick-add shows a success toast', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastCreate');
    if (!setup.card) return;

    // Click the add-card button in the column.
    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });

    await page.fill('.quick-add-form input', 'Quick Add Toast Card');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(201);

    // Success toast should appear.
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Card created');
  });
});

// ---------------------------------------------------------------------------
// 2. Card title update — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — card update', () => {
  test("saving card edits shows a 'Card updated' success toast", async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastUpdate');
    if (!setup.card) return;

    // Open the card detail modal.
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Enter edit mode.
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change the title.
    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Toast Title');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // "Card updated" success toast should appear.
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Card updated');
  });
});

// ---------------------------------------------------------------------------
// 3. Comment post on success — no toast (verify actual behaviour)
// ---------------------------------------------------------------------------

test.describe('Toast — comment post success (no toast)', () => {
  test('posting a comment successfully shows no toast', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastCommentOk');
    if (!setup.card) return;

    // Open the card.
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Post a comment.
    await page.fill('.comment-form-compact textarea', 'A comment that should not toast');
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.url().includes('/comments') && r.request().method() === 'POST',
      ),
      page.click('.comment-form-compact button[type="submit"]'),
    ]);
    expect(response.status()).toBe(201);

    // Wait briefly to confirm that neither a success nor error toast appears.
    // The app intentionally shows no toast on successful comment creation.
    await page.waitForTimeout(500);
    await expect(page.locator('.toast-success')).not.toBeVisible();
    await expect(page.locator('.toast-error')).not.toBeVisible();

    // The comment should appear in the list to confirm the post succeeded.
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'A comment that should not toast' }),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Comment post failure — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — comment post error', () => {
  test("failed comment post shows a 'Failed to post comment' error toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastCommentErr');
    if (!setup.card) return;

    // Intercept the POST comment call to make it fail.
    await page.route(`**/api/cards/*/comments`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the card.
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Type a comment and submit.
    await page.fill('.comment-form-compact textarea', 'This comment will fail');
    await page.click('.comment-form-compact button[type="submit"]');

    // Error toast should appear.
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to post comment');
  });
});

// ---------------------------------------------------------------------------
// 5. Board creation failure (POST /api/boards returns 500) — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — board creation error', () => {
  test("failed board creation shows a 'Failed to create board' error toast", async ({
    page,
    request,
  }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `test-board-toast-${uid}@test.com`,
          password: 'password123',
          display_name: 'BoardToast User',
        },
      })
    ).json();

    await page.goto('/login');
    await page.evaluate((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    // Intercept the board creation POST to force a failure while allowing GETs.
    await page.route(`**/api/boards`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the Create Board modal and submit.
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Should Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Error toast should appear.
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to create board');
  });
});

// ---------------------------------------------------------------------------
// 6. Card update failure (PUT /api/cards/:id returns 500) — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — card update error', () => {
  test("failed card save shows a 'Failed to update card' error toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastUpdateErr');
    if (!setup.card) return;

    // Intercept ALL card PUT requests to force failure.
    await page.route(`**/api/cards/**`, (route) => {
      if (route.request().method() === 'PUT') {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the card and attempt a save.
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="text"]').first().fill('Will Fail Save');
    await page.click('.card-detail-actions button:has-text("Save")');

    // The "Failed to update card" error toast should appear.
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to update card');
  });
});

// ---------------------------------------------------------------------------
// 7. Toast auto-dismiss — success toast disappears after ~3.5 seconds
// ---------------------------------------------------------------------------

test.describe('Toast — auto-dismiss behaviour', () => {
  test('success toast disappears after a few seconds without any interaction', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastDismiss');
    if (!setup.card) return;

    // Trigger a card update to produce a success toast.
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="text"]').first().fill('Dismiss Test Title');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Toast should appear first.
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });

    // Toast must disappear within 6000ms (3500ms timer + 300ms animation + buffer).
    await expect(page.locator('.toast-success')).not.toBeVisible({ timeout: 6000 });
  });
});

// ---------------------------------------------------------------------------
// 8. Multiple toasts stack — all visible simultaneously
// ---------------------------------------------------------------------------

test.describe('Toast — multiple toasts stack', () => {
  test('triggering multiple toasts shows all of them stacked', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastStack');
    if (!setup.card) return;

    // Intercept ALL card PUTs to fail — this gives us a reliable error toast on save.
    // But first, do one successful update to get a success toast, then fail a second.
    // Simpler approach: intercept board list to fail twice in a row from /boards page.
    // We route to /boards and trigger two failed board creation attempts.
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    // Intercept POST /boards to fail — allows GET to pass.
    await page.route(`**/api/boards`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    // First failed creation.
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Fail Board 1');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await expect(page.locator('.toast-error').first()).toBeVisible({ timeout: 5000 });

    // Quickly submit a second failing creation before the first toast dismisses.
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Fail Board 2');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Both error toasts must be present at the same time.
    await expect(page.locator('.toast-error')).toHaveCount(2, { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 9. Clicking a toast dismisses it immediately
// ---------------------------------------------------------------------------

test.describe('Toast — click to dismiss', () => {
  test('clicking an error toast dismisses it immediately', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'ToastClick');
    if (!setup.card) return;

    // Route to /boards and trigger a failed board creation for a reliable error toast.
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    await page.route(`**/api/boards`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Click Dismiss Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    const toast = page.locator('.toast-error').first();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Click the toast to dismiss it.
    await toast.click();

    // Toast should disappear well before the 3500ms auto-dismiss timer.
    await expect(toast).not.toBeVisible({ timeout: 2000 });
  });
});
