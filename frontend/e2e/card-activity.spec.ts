import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Set up a fresh user, board, swimlane, and card via the API.
 * Injects the auth token and navigates to the board in "All Cards" view.
 */
async function setupBoardWithCard(request: any, page: any, label = 'Activity') {
  const email = `test-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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
        title: 'Activity Test Card',
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

  return { board, card, columns, swimlane, token };
}

test.describe('Card Activity Log', () => {
  test('activity section is visible in card modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ActivityVisible');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Activity log section with heading should exist
    await expect(page.locator('.activity-log-section')).toBeVisible();
    await expect(page.locator('.activity-log-section h4')).toContainText('Activity');
  });

  test('card creation shows in activity log', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ActivityCreated');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Wait for activities to load (spinner disappears)
    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    // At least one activity item should be visible
    await expect(page.locator('.activity-item').first()).toBeVisible({ timeout: 8000 });

    // The creation entry should mention "created card"
    await expect(page.locator('.activity-description').first()).toContainText('created card');
  });

  test('adding a comment appears in activity log', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ActivityComment');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Wait for initial activities to load
    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    const initialCount = await page.locator('.activity-item').count();

    // Post a comment and wait for the POST response
    await page.fill('.comment-form-compact textarea', 'Hello from activity test');
    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.url().includes('/comments') && r.request().method() === 'POST'
      ),
      page.click('.comment-form-compact button[type="submit"]'),
    ]);

    // Reload activity by closing and reopening the modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    // Should have more activity items now
    const newCount = await page.locator('.activity-item').count();
    expect(newCount).toBeGreaterThan(initialCount);

    // At least one entry should mention "added a comment"
    await expect(page.locator('.activity-description', { hasText: 'added a comment' })).toBeVisible();
  });

  test('title change appears in activity log', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ActivityTitle');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Enter edit mode and change the title
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const titleInput = page.locator('.card-detail-edit input[type="text"]').first();
    await titleInput.fill('Renamed Activity Card');

    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Reload modal to refresh activity
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    // An entry for title change should be present
    await expect(
      page.locator('.activity-description', { hasText: 'changed title' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('activity items show timestamp and author', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'ActivityMeta');

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    // There should be at least one activity (the card creation)
    await expect(page.locator('.activity-item').first()).toBeVisible({ timeout: 8000 });

    // Each visible item should have an author name
    await expect(page.locator('.activity-item').first().locator('.activity-user')).toBeVisible();

    // Each visible item should have a relative timestamp
    await expect(page.locator('.activity-item').first().locator('.activity-time')).toBeVisible();

    // Timestamp should read "just now" since the card was just created
    await expect(page.locator('.activity-item').first().locator('.activity-time')).toContainText('just now');
  });

  test('activity log shows both creation and title change entries', async ({ page, request }) => {
    const { card, token } = await setupBoardWithCard(request, page, 'ActivityOrder');

    // Rename the card via API to generate a second activity entry after "created"
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Renamed For Order Test' },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({ timeout: 8000 });

    // Should have at least 2 activity items (creation + title change; may have more)
    const count = await page.locator('.activity-item').count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Both a "created card" entry and a "changed title" entry should be present
    // (ORDER BY created_at DESC — most recent first — but within the same second
    //  SQLite ordering is non-deterministic, so we check presence rather than position)
    await expect(page.locator('.activity-description', { hasText: 'created card' })).toBeVisible();
    await expect(page.locator('.activity-description', { hasText: 'changed title' })).toBeVisible();
  });
});
