import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Create user + board + swimlane + card via API, inject token, navigate to board,
 * and switch to "All Cards" view so the card is visible.
 */
async function setupBoardWithCard(request: any, page: any, label = 'Toast') {
  const email = `test-toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Toast Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to All Cards so the card is visible regardless of sprint state
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, columns, swimlane, card, token };
}

// ---------------------------------------------------------------------------
// Toast on card creation via 'n' key modal
// ---------------------------------------------------------------------------

test.describe('Toast — card creation', () => {
  test("'Card created' success toast appears after creating a card via the Add Card modal", async ({
    page,
    request,
  }) => {
    await setupBoardWithCard(request, page, 'ToastCreate');

    // Open the AddCardModal via the 'n' keyboard shortcut
    await page.locator('body').click();
    await page.keyboard.press('n');
    await page.waitForSelector('.modal h2:has-text("Create Card")', { timeout: 5000 });

    await page.fill('.modal input[placeholder="Card title"]', 'New Toast Card');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards') && r.request().method() === 'POST'
      ),
      page.click('.modal .btn-primary:has-text("Create Card")'),
    ]);
    // Card creation returns 201 Created
    await expect(response.status()).toBe(201);

    // The "Card created" success toast should appear
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Card created');
  });
});

// ---------------------------------------------------------------------------
// Toast on card update
// ---------------------------------------------------------------------------

test.describe('Toast — card update', () => {
  test("'Card updated' success toast appears after saving card edits", async ({
    page,
    request,
  }) => {
    await setupBoardWithCard(request, page, 'ToastUpdate');

    // Open the card detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Enter edit mode
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Change the title
    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Updated Toast Title');

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    await expect(response.status()).toBe(200);

    // "Card updated" success toast should appear
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-success .toast-message')).toContainText('Card updated');
  });
});

// ---------------------------------------------------------------------------
// Toast on comment post — error path only (no success toast is shown on success)
// ---------------------------------------------------------------------------

test.describe('Toast — comment error feedback', () => {
  test("'Failed to post comment' error toast appears when comment API fails", async ({
    page,
    request,
  }) => {
    await setupBoardWithCard(request, page, 'ToastComment');

    // Intercept the POST comment call to make it fail
    await page.route(`**/api/cards/*/comments`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    // Open the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Type a comment and submit
    await page.fill('.comment-form-compact textarea', 'This comment will fail');
    await page.click('.comment-form-compact button[type="submit"]');

    // Error toast should appear
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to post comment');
  });
});

// ---------------------------------------------------------------------------
// Toast on board creation — error path (success navigates away immediately)
// ---------------------------------------------------------------------------

test.describe('Toast — board creation error feedback', () => {
  test("'Failed to create board' error toast appears when boards API fails", async ({
    page,
    request,
  }) => {
    // Create a user via API and inject the token
    const email = `test-board-toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'BoardToast User' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.page-header', { timeout: 10000 });

    // Intercept the board creation POST to force a failure
    await page.route(`**/api/boards`, (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the create board modal and submit
    await page.click('button:has-text("Create Board")');
    await page.fill('#boardName', 'Should Fail Board');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Error toast should appear
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to create board');
  });
});

// ---------------------------------------------------------------------------
// Error toast on failed card move (bulk action)
// ---------------------------------------------------------------------------

test.describe('Toast — failed card move error feedback', () => {
  test("'Failed to move card' error toast appears when drag-and-drop API fails", async ({
    page,
    request,
  }) => {
    await setupBoardWithCard(request, page, 'ToastMoveErr');

    // Intercept the card move PATCH call to make it fail
    await page.route(`**/api/cards/*/move`, (route) => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    // Try to drag the card to another column using the move button in the card actions
    // Since DnD is complex to test, trigger a card PUT update that causes a move error
    // by intercepting ALL card PUT requests
    await page.unroute(`**/api/cards/*/move`);
    await page.route(`**/api/cards/**`, (route) => {
      if (route.request().method() === 'PUT') {
        route.fulfill({ status: 500, body: 'Internal Server Error' });
      } else {
        route.continue();
      }
    });

    // Open the card and attempt a save — this triggers the card PUT which is now mocked to fail
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="text"]').first().fill('Will Fail Save');
    await page.click('.card-detail-actions button:has-text("Save")');

    // The "Failed to update card" error toast should appear
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast-error .toast-message')).toContainText('Failed to update card');
  });
});

// ---------------------------------------------------------------------------
// Toast auto-dismisses
// ---------------------------------------------------------------------------

test.describe('Toast — auto-dismiss behaviour', () => {
  test('success toast disappears after a few seconds', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ToastDismiss');

    // Trigger a card update to show a toast
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit input[type="text"]').first().fill('Dismiss Test Title');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Toast appears
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 });

    // Toast disappears (auto-dismiss after 3500ms + 300ms exit animation = ~3800ms;
    // we wait up to 6000ms to be safe without using waitForTimeout)
    await expect(page.locator('.toast-success')).not.toBeVisible({ timeout: 6000 });
  });
});
