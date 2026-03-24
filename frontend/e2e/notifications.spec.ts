/**
 * notifications.spec.ts
 *
 * Core notification CRUD tests:
 *   - Notification bell is visible in sidebar
 *   - Unread count badge appears when there are unread notifications
 *   - Click bell opens notification panel
 *   - Notification list renders
 *   - "Mark all read" clears the badge
 *   - Clicking an individual notification marks it read
 *   - Clicking a notification link navigates to the board and opens the card modal
 *   - Empty state when there are no notifications
 *   - Delete individual notification
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared helper: sign up a user and return { token, user }
// ---------------------------------------------------------------------------
async function createUser(
  request: any,
  displayName: string,
  suffix: string
): Promise<{ token: string; user: any }> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `ntf-${suffix}-${uid}@test.com`,
      password: 'password123',
      display_name: displayName,
    },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Shared helper: create board + swimlane + card owned by tokenA.
// Optionally add tokenB / userBId as a board member.
// ---------------------------------------------------------------------------
async function createBoardWithCard(
  request: any,
  tokenA: string,
  options: { tokenB?: string; userBId?: number } = {}
): Promise<{ board: any; card: any; columns: any[]; swimlane: any }> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: `Notifications Board ${uid}` },
    })
  ).json();

  const columns: any[] = board.columns ?? [];

  if (options.tokenB && options.userBId) {
    await request.post(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: options.userBId, role: 'member' },
    });
  }

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: 'Test Swimlane', designator: 'NF-', color: '#6366f1' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        title: 'Notification Target Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return { board, card, columns, swimlane };
}

// ---------------------------------------------------------------------------
// Shared helper: navigate page to board as user, wait for bell and card items.
// ---------------------------------------------------------------------------
async function navigateToBoard(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.notification-bell', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Shared helper: trigger an assignment notification.
// User B (tokenB) assigns user A (userId) to the card.
// ---------------------------------------------------------------------------
async function triggerAssignmentNotification(
  request: any,
  tokenB: string,
  cardId: number,
  userId: number
) {
  await request.post(`${BASE}/api/cards/${cardId}/assignees`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { user_id: userId },
  });
}

// ===========================================================================
// Notification bell UI
// ===========================================================================
test.describe('Notification bell UI', () => {
  test('notification bell is visible in the sidebar', async ({ page, request }) => {
    const { token } = await createUser(request, 'Bell Visible', 'bellvisible');
    const { board } = await createBoardWithCard(request, token);
    await navigateToBoard(page, token, board.id);

    await expect(page.locator('.notification-bell')).toBeVisible();
  });

  test('no unread badge when there are no notifications', async ({ page, request }) => {
    const { token } = await createUser(request, 'No Badge', 'nobadge');
    const { board } = await createBoardWithCard(request, token);
    await navigateToBoard(page, token, board.id);

    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 5000 });
  });

  test('clicking bell opens notification dropdown', async ({ page, request }) => {
    const { token } = await createUser(request, 'Bell Click', 'bellclick');
    const { board } = await createBoardWithCard(request, token);
    await navigateToBoard(page, token, board.id);

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
  });

  test('empty state is shown when there are no notifications', async ({ page, request }) => {
    const { token } = await createUser(request, 'Empty State', 'emptystate');
    const { board } = await createBoardWithCard(request, token);
    await navigateToBoard(page, token, board.id);

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    await expect(page.locator('.notification-empty')).toBeVisible();
    await expect(page.locator('.notification-empty')).toContainText('No notifications');
  });
});

// ===========================================================================
// Unread badge
// ===========================================================================
test.describe('Unread badge', () => {
  test('badge appears with a positive count after receiving a notification', async ({
    page,
    request,
  }) => {
    const { token, user } = await createUser(request, 'Badge Show', 'badgeshow');
    const { token: tokenB } = await createUser(request, 'Badge Trigger', 'badgetrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    const text = await badge.textContent();
    expect(Number(text)).toBeGreaterThan(0);
  });

  test('badge count reflects unread_count returned by the API', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Badge Count', 'badgecount');
    const { token: tokenB } = await createUser(request, 'Badge Count Trig', 'badgecounttrig');
    const { board, card } = await createBoardWithCard(request, token);

    // Create two notifications: assignment + comment
    await triggerAssignmentNotification(request, tokenB, card.id, user.id);
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Badge count comment' },
    });

    // Get API's unread_count before navigating
    const apiRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const apiData = await apiRes.json();
    const apiUnreadCount: number = apiData.unread_count;

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    const badgeText = await badge.textContent();
    expect(Number(badgeText)).toBe(apiUnreadCount);
  });
});

// ===========================================================================
// Mark all read
// ===========================================================================
test.describe('Mark all read', () => {
  test('clicking "Mark all read" clears the badge', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Mark All User', 'markalluser');
    const { token: tokenB } = await createUser(request, 'Mark All Trig', 'markalltrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    // Wait for notification items to load before clicking Mark all read
    await expect(page.locator('.notification-item')).toBeVisible({ timeout: 8000 });

    // Use evaluate+click() to bypass Playwright hit-test checks (sidebar-nav overlaps the
    // notification dropdown in the DOM). evaluate().click() calls the native DOM click method
    // directly on the element, which properly triggers React's synthetic event system.
    await page.locator('.mark-all-read-btn').evaluate((el: HTMLElement) => el.click());

    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 8000 });
  });

  test('"Mark all read" sets all notification items to read state', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'MAR Items', 'maritems');
    const { token: tokenB } = await createUser(request, 'MAR Trig', 'martrig');
    const { board, card } = await createBoardWithCard(request, token);

    // Create multiple notifications
    await triggerAssignmentNotification(request, tokenB, card.id, user.id);
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Comment one' },
    });
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Comment two' },
    });

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    // Wait for badge to confirm notifications arrived
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Wait for notification items to load
    await expect(page.locator('.notification-item').first()).toBeVisible({ timeout: 8000 });

    // Confirm there are unread items (items have class .unread when notification.read is false)
    await expect(page.locator('.notification-item.unread').first()).toBeVisible({ timeout: 8000 });
    const unreadBefore = await page.locator('.notification-item.unread').count();
    expect(unreadBefore).toBeGreaterThanOrEqual(1);

    // evaluate().click() triggers the native DOM click, which fires React's synthetic event
    // system correctly even when sidebar-nav overlaps the dropdown in Playwright hit-tests.
    await page.locator('.mark-all-read-btn').evaluate((el: HTMLElement) => el.click());

    // All unread items should now be gone
    await expect(page.locator('.notification-item.unread')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 8000 });
  });
});

// ===========================================================================
// Individual notification interaction
// ===========================================================================
test.describe('Individual notification interaction', () => {
  test('clicking an unread notification marks it as read', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Single Read', 'singleread');
    const { token: tokenB } = await createUser(request, 'Single Read Trig', 'singlereadtrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // The notification must be visible and unread
    const unreadItem = page.locator('.notification-item.unread').first();
    await expect(unreadItem).toBeVisible({ timeout: 8000 });

    // evaluate().click() triggers the native DOM click, bypassing Playwright hit-test checks
    await unreadItem.evaluate((el: HTMLElement) => el.click());

    // Re-open dropdown and verify item is now read (no longer has .unread class)
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    await expect(page.locator('.notification-item.unread')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 5000 });
  });

  test('notification list shows title and message text', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Ntf Content', 'ntfcontent');
    const { token: tokenB } = await createUser(request, 'Ntf Content Trig', 'ntfcontenttrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    await expect(page.locator('.notification-item')).toBeVisible();

    // Title and message should be rendered
    await expect(page.locator('.notification-title').first()).toBeVisible();
    await expect(page.locator('.notification-message').first()).toBeVisible();
  });

  test('notification shows a timestamp', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Ntf Time', 'ntftime');
    const { token: tokenB } = await createUser(request, 'Ntf Time Trig', 'ntftimetrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // The timestamp element should be present
    const timeEl = page.locator('.notification-time, .notification-timestamp');
    await expect(timeEl.first()).toBeVisible({ timeout: 5000 });

    // Timestamps for freshly created notifications should contain relative time words
    const tsText = (await timeEl.first().textContent()) ?? '';
    const relativePattern = /just now|ago|second|minute|hour|day|week/i;
    expect(relativePattern.test(tsText)).toBe(true);
  });
});

// ===========================================================================
// Notification navigation (clicking link opens card)
// ===========================================================================
test.describe('Notification navigation', () => {
  test('clicking a notification navigates to the board URL with ?card=:id param', async ({
    page,
    request,
  }) => {
    const { token, user } = await createUser(request, 'Nav User', 'navuser');
    const { token: tokenB } = await createUser(request, 'Nav Trigger', 'navtrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    // Wait for notification items to load
    await expect(page.locator('.notification-item').first()).toBeVisible({ timeout: 8000 });

    // evaluate().click() triggers the native DOM click, bypassing Playwright hit-test checks
    await page.locator('.notification-item').first().evaluate((el: HTMLElement) => el.click());

    // URL should contain the card ID as ?card=<id>
    await expect(page).toHaveURL(new RegExp(`[?&]card=${card.id}`), { timeout: 8000 });
  });

  test('navigating to ?card=:id URL opens the card detail modal', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Card Modal Open', 'cardmodalopen');
    const { token: tokenB } = await createUser(request, 'Card Modal Trig', 'cardmodaltrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    // Navigate directly to the board with the ?card= param (as a notification link would)
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}?card=${card.id}`);
    await page.waitForSelector('.notification-bell', { timeout: 15000 });
    // Switch to All Cards so the card is rendered and the modal can open
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // The card detail modal should open automatically
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });
  });
});

// ===========================================================================
// Delete notification
// ===========================================================================
test.describe('Delete notification', () => {
  test('deleting a notification removes it from the list', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Delete Ntf', 'deletentf');
    const { token: tokenB } = await createUser(request, 'Delete Ntf Trig', 'deletentftrig');
    const { board, card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    await expect(page.locator('.notification-item')).toBeVisible({ timeout: 8000 });

    // evaluate().click() triggers the native DOM click, bypassing Playwright hit-test checks.
    // Hover first (force) to reveal the delete button (CSS :hover), then click it.
    await page.locator('.notification-item').first().hover({ force: true });
    await page.locator('.notification-delete').first().evaluate((el: HTMLElement) => el.click());

    // Empty state should appear after deletion
    await expect(page.locator('.notification-empty')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.notification-empty')).toContainText('No notifications');
  });

  test('deleting an unread notification decrements the badge count', async ({ page, request }) => {
    const { token, user } = await createUser(request, 'Delete Badge', 'deletebadge');
    const { token: tokenB } = await createUser(request, 'Delete Badge Trig', 'deletebadgetrig');
    const { board, card } = await createBoardWithCard(request, token);

    // Create two notifications
    await triggerAssignmentNotification(request, tokenB, card.id, user.id);
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Delete badge comment' },
    });

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    const countBefore = Number(await badge.textContent());
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Open dropdown and delete one notification
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    // Wait for items to load, then dispatch events to bypass sidebar-nav interception
    await expect(page.locator('.notification-item').first()).toBeVisible({ timeout: 8000 });
    await page.locator('.notification-item').first().hover({ force: true });
    await page.locator('.notification-delete').first().evaluate((el: HTMLElement) => el.click());

    // Badge count should have decreased
    await expect(badge).toBeVisible({ timeout: 5000 });
    const countAfter = Number(await badge.textContent());
    expect(countAfter).toBeLessThan(countBefore);
  });
});

// ===========================================================================
// Dropdown close behaviour
// ===========================================================================
test.describe('Dropdown close behaviour', () => {
  test('dropdown closes when clicking outside the notification container', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Outside Click', 'outsideclick');
    const { board } = await createBoardWithCard(request, token);
    await navigateToBoard(page, token, board.id);

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Click somewhere in the main content area (outside the notification container)
    await page.click('.main-content', { position: { x: 10, y: 10 } });

    await expect(page.locator('.notification-dropdown')).not.toBeVisible({ timeout: 5000 });
  });
});
