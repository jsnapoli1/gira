import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Set up a fresh user, board, swimlane, and card via the API.
 * Injects the auth token and navigates to the board in "All Cards" view.
 */
async function setupBoardWithCard(request: any, page: any, label = 'Watchers') {
  const email = `test-watchers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const { token, user } = await (
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
        title: 'Watcher Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, card, columns, swimlane, token, user };
}

// NOTE: The watchers feature has a backend API (/cards/:id/watchers, /cards/:id/watch)
// but no Watch button or watcher UI has been implemented in the card detail modal
// (CardDetailModal.tsx). All tests below are marked fixme until the UI is added.

test.describe('Card Watchers', () => {
  test.fixme('watch button exists in card modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchBtn');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Expect a Watch button in the modal (sidebar or header)
    await expect(
      page.locator('button:has-text("Watch"), button:has-text("Unwatch"), button:has-text("Watching"), .watch-btn, .watch-card')
    ).toBeVisible();
  });

  test.fixme('watch card — button changes to Unwatch/Watching', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchCard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click the Watch button
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    // Button text should change to indicate the card is being watched
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching"), .watch-btn.active')
    ).toBeVisible({ timeout: 5000 });
  });

  test.fixme('unwatch card — button returns to Watch state', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'UnwatchCard');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });

    // Unwatch
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'DELETE'
      ),
      page.click('button:has-text("Unwatch"), button:has-text("Watching")'),
    ]);

    // Should return to Watch state
    await expect(page.locator('button:has-text("Watch")')).toBeVisible({ timeout: 5000 });
  });

  test.fixme('watch state persists after reopening modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchPersist');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch the card
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Reopen modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Watch state should still be reflected
    await expect(
      page.locator('button:has-text("Unwatch"), button:has-text("Watching")')
    ).toBeVisible({ timeout: 5000 });
  });

  test.fixme('watcher count increments when watching', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'WatchCount');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Check initial watcher count (should be 0 or not shown)
    const countLocator = page.locator('.watcher-count, [data-testid="watcher-count"]');
    const initialText = (await countLocator.isVisible()) ? await countLocator.textContent() : '0';
    const initialCount = parseInt(initialText || '0', 10);

    // Watch the card
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/watch') && r.request().method() === 'POST'
      ),
      page.click('button:has-text("Watch"), .watch-btn'),
    ]);

    // Count should increase by 1
    await expect(countLocator).toBeVisible({ timeout: 5000 });
    const newText = await countLocator.textContent();
    expect(parseInt(newText || '0', 10)).toBe(initialCount + 1);
  });
});
