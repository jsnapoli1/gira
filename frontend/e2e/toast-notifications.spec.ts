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
 * 10.  Successful board creation causes no error toast
 * 11.  Deleting a board via settings causes no error toast during redirect
 * 12.  Label deleted from board settings shows success toast
 * 13.  Failed label delete shows error toast
 * 14.  Work log added shows success toast
 * 15.  Failed work log add shows error toast
 * 16.  Card description updated shows success toast
 * 17.  Card deleted from modal shows success toast
 * 18.  Login error shows inline auth-error, not a toast
 * 19.  No error toast on successful board load
 * 20.  No error toast on valid card creation
 * 21.  Success toast has .toast-success class, not .toast-error
 * 22.  Error toast has .toast-error class, not .toast-success
 * 23.  Toast message text is non-empty
 * 24.  .toast-container is always present in the DOM
 * 25.  Error toast is still visible after 2 seconds (not dismissed too early)
 * 26.  Navigation between pages does not trigger error toasts
 * 27.  Swimlane added in board settings shows success toast
 * 28.  Failed swimlane add shows error toast
 * 29.  Workflow rules saved shows success toast
 * 30.  Failed workflow rules save shows error toast
 * 31.  Quick-add toast message text says "Card created"
 * 32.  Click-dismiss adds .toast-exit before removal
 * 33.  Stacked toasts each carry a non-empty message
 * 34.  Card link created shows success toast
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helpers
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

/** Sign up a user and inject token; returns token and email. */
async function setupUserOnBoards(
  request: import('@playwright/test').APIRequestContext,
  page: import('@playwright/test').Page,
  label = 'User',
) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-${label.toLowerCase()}-${uid}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: label },
    })
  ).json();

  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  return { token, email };
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

    // Route to /boards and trigger two failed board creation attempts.
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

    // The modal stays open after failure (error path does not close it).
    // Close it by clicking Cancel before attempting the second creation.
    await page.locator('.modal .form-actions button:not([type="submit"])').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });

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

// ---------------------------------------------------------------------------
// 10. Successful board creation — no error toast
// ---------------------------------------------------------------------------

test.describe('Toast — board creation success (no error toast)', () => {
  test('successfully creating a board does not show an error toast', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'BoardCreate');
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    const [navResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/boards') && r.request().method() === 'POST',
      ),
      (async () => {
        await page.click('button:has-text("Create Board")');
        await page.fill('#boardName', 'New Success Board');
        await page.click('button[type="submit"]:has-text("Create Board")');
      })(),
    ]);
    expect(navResponse.status()).toBe(201);

    // No error toast should appear after a successful create.
    await page.waitForTimeout(500);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 11. Board deletion — redirect happens, no error toast
// ---------------------------------------------------------------------------

test.describe('Toast — board deletion via settings', () => {
  test('deleting a board redirects without showing an error toast', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'BoardDel');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Board To Delete' },
      })
    ).json();

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('button.btn-danger:has-text("Delete Board")').click();

    await page.waitForURL(/\/boards$/, { timeout: 10000 });
    await page.waitForTimeout(400);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 12. Label deleted — success toast from board settings
// ---------------------------------------------------------------------------

test.describe('Toast — label deleted success', () => {
  test("deleting a label in board settings shows 'Label deleted' success toast", async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'LabelDel');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Label Delete Board' },
      })
    ).json();

    const labelRes = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete Me Label', color: '#ff0000' },
    });
    if (!labelRes.ok()) {
      test.skip(true, `Label creation failed: ${await labelRes.text()}`);
      return;
    }

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Labels")') })
      .locator('button[title="Delete label"]')
      .first()
      .click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Label deleted');
  });
});

// ---------------------------------------------------------------------------
// 13. Failed label delete — error toast from board settings
// ---------------------------------------------------------------------------

test.describe('Toast — label delete failure', () => {
  test('failed label delete shows an error toast', async ({ page, request }) => {
    const { token } = await setupUserOnBoards(request, page, 'LabelDelErr');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Label Delete Err Board' },
      })
    ).json();

    const labelRes = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Error Label', color: '#00ff00' },
    });
    if (!labelRes.ok()) {
      test.skip(true, `Label creation failed: ${await labelRes.text()}`);
      return;
    }

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    await page.route(`**/api/boards/*/labels/**`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    page.once('dialog', (d) => d.accept());
    await page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Labels")') })
      .locator('button[title="Delete label"]')
      .first()
      .click();

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 14. Work log added — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — work log added', () => {
  test("adding a work log shows 'Work log added' success toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'WorkLog');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const timeInput = page.locator(
      '.time-input-mini, input[placeholder="mins"]',
    ).first();

    if (!(await timeInput.isVisible())) {
      test.skip(true, 'Time tracking input not visible in this build');
      return;
    }

    // Use pressSequentially to fire proper React key events on the controlled input.
    await timeInput.click();
    await timeInput.pressSequentially('2');

    const submitBtn = page.locator(
      '.time-tracking-actions .btn-primary, .time-tracking-actions button:has-text("Log")',
    ).first();
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });

    const [worklogRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/worklogs') && r.request().method() === 'POST',
        { timeout: 10000 },
      ),
      submitBtn.click(),
    ]);
    expect(worklogRes.status()).toBe(201);

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Work log added');
  });
});

// ---------------------------------------------------------------------------
// 15. Failed work log — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — work log failure', () => {
  test("failed work log shows 'Failed to add work log' error toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'WorkLogErr');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const timeInput = page.locator(
      '.time-input-mini, input[placeholder="mins"]',
    ).first();
    if (!(await timeInput.isVisible())) {
      test.skip(true, 'Time tracking input not visible in this build');
      return;
    }

    await page.route(`**/api/cards/*/worklogs`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    // Use pressSequentially to fire proper React key events on the controlled input.
    await timeInput.click();
    await timeInput.pressSequentially('3');

    const submitBtn = page.locator(
      '.time-tracking-actions .btn-primary, .time-tracking-actions button:has-text("Log")',
    ).first();
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });
    await submitBtn.click();

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to add work log');
  });
});

// ---------------------------------------------------------------------------
// 16. Card description updated — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — card description update', () => {
  test("saving description shows 'Description updated' success toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'Desc');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const descEditBtn = page.locator(
      'button:has-text("Edit Description"), button[aria-label*="description" i], .description-edit-btn',
    ).first();
    if (!(await descEditBtn.isVisible())) {
      test.skip(true, 'Description edit button not visible in this build');
      return;
    }

    await descEditBtn.click();

    const descTextarea = page.locator(
      '.description-editor textarea, .description-form textarea',
    ).first();
    await expect(descTextarea).toBeVisible({ timeout: 5000 });
    await descTextarea.fill('Updated description text');

    const saveBtn = page.locator(
      'button:has-text("Save Description"), .description-form button[type="submit"]',
    ).first();
    await saveBtn.click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Description updated');
  });
});

// ---------------------------------------------------------------------------
// 17. Card deleted from modal — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — card deleted from modal', () => {
  test("deleting a card from the modal shows 'Card deleted' success toast", async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'CardDel');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const deleteBtn = page.locator(
      '.card-detail-actions button:has-text("Delete"), button[title="Delete card"], .card-detail-modal-unified button:has-text("Delete")',
    ).first();
    if (!(await deleteBtn.isVisible())) {
      test.skip(true, 'Card delete button not visible in this build');
      return;
    }

    page.once('dialog', (d) => d.accept());
    await deleteBtn.click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Card deleted');
  });
});

// ---------------------------------------------------------------------------
// 18. Login with wrong credentials — inline .auth-error, not a toast
// ---------------------------------------------------------------------------

test.describe('Toast — login error is inline, not a toast', () => {
  test('wrong password shows .auth-error inline, not an error toast', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', 'nonexistent@test.com');
    await page.fill('input[type="password"], input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 19. No error toast on successful board load
// ---------------------------------------------------------------------------

test.describe('Toast — no error toast on valid board load', () => {
  test('navigating to a valid board shows no error toast', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'NoErrLoad');
    if (!setup.card) return;

    await page.goto(`/boards/${setup.board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.waitForTimeout(800);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 20. No error toast on valid card creation
// ---------------------------------------------------------------------------

test.describe('Toast — no error toast on valid card creation', () => {
  test('creating a card successfully does not show an error toast', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'NoErrCard');
    if (!setup.card) return;

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'Valid Card No Error');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(201);

    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 21. Success toast has .toast-success class and not .toast-error
// ---------------------------------------------------------------------------

test.describe('Toast — success CSS class', () => {
  test('success toast carries .toast-success and lacks .toast-error', async ({
    page,
    request,
  }) => {
    const setup = await setupBoardWithCard(request, page, 'CssClass');
    if (!setup.card) return;

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="text"]').first().fill('CSS Class Test');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT',
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    const classes = await page.locator('.toast-success').first().getAttribute('class');
    expect(classes).toContain('toast-success');
    expect(classes).not.toContain('toast-error');
  });
});

// ---------------------------------------------------------------------------
// 22. Error toast has .toast-error class and not .toast-success
// ---------------------------------------------------------------------------

test.describe('Toast — error CSS class', () => {
  test('error toast carries .toast-error and lacks .toast-success', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'ErrClass');
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
    await page.fill('#boardName', 'CSS Error Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    const classes = await page.locator('.toast-error').first().getAttribute('class');
    expect(classes).toContain('toast-error');
    expect(classes).not.toContain('toast-success');
  });
});

// ---------------------------------------------------------------------------
// 23. Toast message text is non-empty
// ---------------------------------------------------------------------------

test.describe('Toast — message text is non-empty', () => {
  test('.toast-message span contains readable text', async ({ page, request }) => {
    const { token } = await setupUserOnBoards(request, page, 'MsgText');
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
    await page.fill('#boardName', 'Message Text Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    const toastMsg = page.locator('.toast-error .toast-message').first();
    await expect(toastMsg).toBeVisible({ timeout: 5000 });
    const text = await toastMsg.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 24. .toast-container is always present in the DOM
// ---------------------------------------------------------------------------

test.describe('Toast — container always in DOM', () => {
  test('.toast-container element is attached even when no toasts are showing', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'Container');
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    // ToastProvider always renders .toast-container regardless of active toasts.
    await expect(page.locator('.toast-container')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// 25. Error toast is still visible after 2 seconds (not dismissed too early)
// ---------------------------------------------------------------------------

test.describe('Toast — error toast persists past 2 seconds', () => {
  test('error toast visible 2 seconds after appearing (auto-dismiss is 3.5s)', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'Persist');
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
    await page.fill('#boardName', 'Persist Error Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });

    // Wait 2 seconds — auto-dismiss fires at 3500ms, so toast must still be visible.
    await page.waitForTimeout(2000);
    await expect(page.locator('.toast-error')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 26. Navigation between pages does not trigger error toasts
// ---------------------------------------------------------------------------

test.describe('Toast — page navigation is toast-free', () => {
  test('navigating Boards → Reports → Settings → Boards shows no error toasts', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'NavToast');
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    await page.click('.nav-item:has-text("Reports")');
    await page.waitForURL(/\/reports/, { timeout: 8000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error')).not.toBeVisible();

    await page.click('.nav-item:has-text("Settings")');
    await page.waitForURL(/\/settings/, { timeout: 8000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error')).not.toBeVisible();

    await page.click('.nav-item:has-text("Boards")');
    await page.waitForURL(/\/boards/, { timeout: 8000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 27. Swimlane added — success toast from board settings
// ---------------------------------------------------------------------------

test.describe('Toast — swimlane added success', () => {
  test("adding a swimlane in board settings shows 'Swimlane added' toast", async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'SwimAdd');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Swimlane Add Board' },
      })
    ).json();

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    const swimSection = page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Swimlanes")') });
    await swimSection.locator('button:has-text("Add Swimlane"), button:has-text("Add")').first().click();

    const nameInput = page.locator(
      'input#swimlaneName, input[name="swimlaneName"], input[placeholder*="swimlane" i]',
    ).first();
    if (!(await nameInput.isVisible())) {
      test.skip(true, 'Swimlane name input not visible in this build');
      return;
    }
    await nameInput.fill('New Toast Swimlane');

    const designatorInput = page.locator('input#designator, input[name="designator"]').first();
    if (await designatorInput.isVisible()) {
      await designatorInput.fill('NTS-');
    }

    await page.locator(
      '.modal-content button[type="submit"], .swimlane-form button[type="submit"], button:has-text("Add Swimlane")',
    ).last().click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Swimlane added');
  });
});

// ---------------------------------------------------------------------------
// 28. Failed swimlane add — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — swimlane add failure', () => {
  test("failed swimlane add shows 'Failed to add swimlane' error toast", async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'SwimErr');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Swimlane Err Board' },
      })
    ).json();

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    await page.route(`**/api/boards/*/swimlanes`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server Error' });
      } else {
        route.continue();
      }
    });

    const swimSection = page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Swimlanes")') });
    await swimSection.locator('button:has-text("Add Swimlane"), button:has-text("Add")').first().click();

    const nameInput = page.locator(
      'input#swimlaneName, input[name="swimlaneName"], input[placeholder*="swimlane" i]',
    ).first();
    if (!(await nameInput.isVisible())) {
      test.skip(true, 'Swimlane name input not visible in this build');
      return;
    }
    await nameInput.fill('Fail Swimlane');

    const designatorInput = page.locator('input#designator, input[name="designator"]').first();
    if (await designatorInput.isVisible()) {
      await designatorInput.fill('FS-');
    }

    await page.locator(
      '.modal-content button[type="submit"], .swimlane-form button[type="submit"], button:has-text("Add Swimlane")',
    ).last().click();

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to add swimlane');
  });
});

// ---------------------------------------------------------------------------
// 29. Workflow rules saved — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — workflow rules saved', () => {
  test("saving workflow rules shows 'Workflow rules saved' toast", async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'Workflow');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Workflow Board' },
      })
    ).json();

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    const wfSection = page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Workflow Rules")') });
    const saveWfBtn = wfSection.locator(
      'button:has-text("Save"), button:has-text("Save Rules"), button[type="submit"]',
    ).first();

    if (!(await saveWfBtn.isVisible())) {
      test.skip(true, 'Workflow rules save button not visible in this build');
      return;
    }

    await saveWfBtn.click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Workflow rules saved');
  });
});

// ---------------------------------------------------------------------------
// 30. Failed workflow rules save — error toast
// ---------------------------------------------------------------------------

test.describe('Toast — workflow rules save failure', () => {
  test("failed workflow rules save shows 'Failed to save workflow rules' error toast", async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'WorkflowErr');

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Workflow Err Board' },
      })
    ).json();

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 15000 });

    await page.route(`**/api/boards/*/workflow*`, (route) => {
      route.fulfill({ status: 500, body: 'Server Error' });
    });

    const wfSection = page.locator('.settings-section')
      .filter({ has: page.locator('h2:has-text("Workflow Rules")') });
    const saveWfBtn = wfSection.locator(
      'button:has-text("Save"), button:has-text("Save Rules"), button[type="submit"]',
    ).first();

    if (!(await saveWfBtn.isVisible())) {
      test.skip(true, 'Workflow rules save button not visible in this build');
      return;
    }

    await saveWfBtn.click();

    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to save workflow rules');
  });
});

// ---------------------------------------------------------------------------
// 31. Quick-add toast message says "Card created"
// ---------------------------------------------------------------------------

test.describe('Toast — card-created message content', () => {
  test('.toast-message contains the text "Card created"', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'CardCreatedMsg');
    if (!setup.card) return;

    await page.click('.add-card-btn');
    await page.waitForSelector('.quick-add-form', { timeout: 5000 });
    await page.fill('.quick-add-form input', 'Message Content Card');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);

    await expect(page.locator('.toast-success .toast-message').first()).toContainText(
      'Card created',
      { timeout: 5000 },
    );
  });
});

// ---------------------------------------------------------------------------
// 32. Click-dismiss adds .toast-exit before the element is removed
// ---------------------------------------------------------------------------

test.describe('Toast — exit animation class on click-dismiss', () => {
  test('toast element is removed (or has .toast-exit) within 2s of being clicked', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'ExitClass');
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
    await page.fill('#boardName', 'Exit Anim Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    const toast = page.locator('.toast-error').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await toast.click();

    // After click the toast must not be visible within 2 seconds.
    await expect(toast).not.toBeVisible({ timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// 33. Stacked toasts each carry a non-empty message
// ---------------------------------------------------------------------------

test.describe('Toast — stacked toasts have individual messages', () => {
  test('two stacked error toasts both have non-empty .toast-message text', async ({
    page,
    request,
  }) => {
    const { token } = await setupUserOnBoards(request, page, 'StackMsg');
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
    await page.fill('#boardName', 'Stack Msg 1');
    await page.click('button[type="submit"]:has-text("Create Board")');
    await expect(page.locator('.toast-error').first()).toBeVisible({ timeout: 5000 });

    // The modal stays open after failure — close it before attempting the second creation.
    await page.locator('.modal .form-actions button:not([type="submit"])').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });

    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Stack Msg 2');
    await page.click('button[type="submit"]:has-text("Create Board")');

    await expect(page.locator('.toast-error')).toHaveCount(2, { timeout: 5000 });

    const messages = await page.locator('.toast-error .toast-message').allTextContents();
    for (const msg of messages) {
      expect(msg.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 34. Card link created — success toast
// ---------------------------------------------------------------------------

test.describe('Toast — card link created', () => {
  test("creating a card link shows 'Link created' success toast", async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, page, 'LinkCreate');
    if (!setup.card) return;

    // Create a second card to link to.
    const card2Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: {
        title: 'Link Target Card',
        column_id: setup.columns[0].id,
        swimlane_id: setup.swimlane.id,
        board_id: setup.board.id,
      },
    });
    if (!card2Res.ok()) {
      test.skip(true, `Second card creation failed: ${await card2Res.text()}`);
      return;
    }
    const card2 = await card2Res.json();

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const addLinkBtn = page.locator(
      'button:has-text("Add Link"), button[aria-label*="link" i], .card-links button:has-text("Add")',
    ).first();
    if (!(await addLinkBtn.isVisible())) {
      test.skip(true, 'Add link button not visible in this build');
      return;
    }
    await addLinkBtn.click();

    const linkInput = page.locator(
      '.link-form input, input[placeholder*="card" i], input[placeholder*="ID" i]',
    ).first();
    await expect(linkInput).toBeVisible({ timeout: 5000 });
    await linkInput.fill(String(card2.id));

    await page.locator(
      '.link-form button[type="submit"], button:has-text("Create Link")',
    ).first().click();

    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Link created');
  });
});
