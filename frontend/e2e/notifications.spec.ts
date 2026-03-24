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

    // Navigate directly to the board with the ?card= param (as a notification link would).
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}?card=${card.id}`);

    // Wait for the board to fully load (notification-bell + view buttons = board page rendered)
    await page.waitForSelector('.notification-bell', { timeout: 15000 });
    await page.waitForSelector('.board-page', { timeout: 20000 });

    // Switch to "All Cards" view — in board mode without an active sprint, no card items
    // render (the board shows an empty sprint message). Once "All Cards" is active,
    // cards are visible AND the ?card useEffect can find the card and open the modal.
    await page.click('.view-btn:has-text("All Cards")', { timeout: 20000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // The card detail modal should open automatically (the ?card param effect fires once cards load)
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible({ timeout: 15000 });
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

  test('deleting a notification via the API reduces the badge count shown on reload', async ({
    page,
    request,
  }) => {
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

    // Get the first notification ID via API and delete it
    const ntfRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ntfData = await ntfRes.json();
    const firstId: number = ntfData.notifications[0].id;

    const delRes = await request.delete(`${BASE}/api/notifications/${firstId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok()).toBeTruthy();

    // Reload to pick up the updated notification count from the server
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge count should have decreased by 1 (if the deleted notification was unread)
    // or the badge may disappear if only 1 unread remained.
    const afterRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterData = await afterRes.json();
    expect(afterData.unread_count).toBeLessThan(countBefore);

    // Badge in UI should reflect the new lower unread count
    if (afterData.unread_count > 0) {
      await expect(badge).toBeVisible({ timeout: 5000 });
      const countAfter = Number(await badge.textContent());
      expect(countAfter).toBeLessThan(countBefore);
    } else {
      await expect(badge).not.toBeVisible({ timeout: 5000 });
    }
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

// ===========================================================================
// Additional API tests
// ===========================================================================
test.describe('Notifications API', () => {
  // -------------------------------------------------------------------------
  // GET /api/notifications returns 200
  // -------------------------------------------------------------------------
  test('API: GET /api/notifications returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'API 200', 'api200');

    const res = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET /api/notifications returns object with notifications array
  // -------------------------------------------------------------------------
  test('API: GET /api/notifications returns object with notifications array and unread_count', async ({ request }) => {
    const { token } = await createUser(request, 'API Shape', 'apishape');

    const res = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(Array.isArray(data.notifications)).toBe(true);
    expect(typeof data.unread_count).toBe('number');
  });

  // -------------------------------------------------------------------------
  // New unread notification has read=false
  // -------------------------------------------------------------------------
  test('API: new assignment notification has read=false', async ({ request }) => {
    const { token, user } = await createUser(request, 'API Unread', 'apiunread');
    const { token: tokenB } = await createUser(request, 'API Unread Trig', 'apiunreadtrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const res = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.notifications.length).toBeGreaterThan(0);
    const ntf = data.notifications[0];
    expect(ntf.read).toBe(false);
  });

  // -------------------------------------------------------------------------
  // PUT /api/notifications/:id sets read=true
  // -------------------------------------------------------------------------
  test('API: PUT /api/notifications/:id marks the notification as read', async ({ request }) => {
    const { token, user } = await createUser(request, 'API Mark Read', 'apimarkread');
    const { token: tokenB } = await createUser(request, 'API Mark Read Trig', 'apimarkreadtrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const listRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    const ntfId: number = listData.notifications[0].id;

    const putRes = await request.put(`${BASE}/api/notifications/${ntfId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(putRes.ok()).toBe(true);
    const updated = await putRes.json();
    expect(updated.read).toBe(true);
  });

  // -------------------------------------------------------------------------
  // POST /api/notifications?action=mark-all-read marks all as read
  // -------------------------------------------------------------------------
  test('API: POST /api/notifications?action=mark-all-read returns 200', async ({ request }) => {
    const { token, user } = await createUser(request, 'API MAR', 'apimar');
    const { token: tokenB } = await createUser(request, 'API MAR Trig', 'apimartrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const res = await request.post(`${BASE}/api/notifications?action=mark-all-read`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(200);

    // Verify all notifications now have read=true
    const listRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await listRes.json();
    expect(data.unread_count).toBe(0);
    for (const ntf of data.notifications) {
      expect(ntf.read).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/notifications/:id removes the notification
  // -------------------------------------------------------------------------
  test('API: DELETE /api/notifications/:id returns 204 and removes the notification', async ({ request }) => {
    const { token, user } = await createUser(request, 'API Del', 'apidel');
    const { token: tokenB } = await createUser(request, 'API Del Trig', 'apideltrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const listRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    const ntfId: number = listData.notifications[0].id;

    const delRes = await request.delete(`${BASE}/api/notifications/${ntfId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    // Verify it's gone from the list
    const afterRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterData = await afterRes.json();
    const found = afterData.notifications.find((n: any) => n.id === ntfId);
    expect(found).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // After PUT mark read, notification.read is true in subsequent GET
  // -------------------------------------------------------------------------
  test('API: after marking a notification read via PUT, GET confirms read=true', async ({ request }) => {
    const { token, user } = await createUser(request, 'API Confirm', 'apiconfirm');
    const { token: tokenB } = await createUser(request, 'API Confirm Trig', 'apiconfirmtrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const listRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    const ntfId: number = listData.notifications[0].id;

    await request.put(`${BASE}/api/notifications/${ntfId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const afterRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterData = await afterRes.json();
    const ntf = afterData.notifications.find((n: any) => n.id === ntfId);
    expect(ntf).toBeDefined();
    expect(ntf.read).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Notification has id, message, created_at, type fields
  // -------------------------------------------------------------------------
  test('API: notification object has id, type, title, message, link, read, and created_at', async ({ request }) => {
    const { token, user } = await createUser(request, 'API Schema', 'apischema');
    const { token: tokenB } = await createUser(request, 'API Schema Trig', 'apischematrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const res = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const ntf = data.notifications[0];

    expect(typeof ntf.id).toBe('number');
    expect(typeof ntf.type).toBe('string');
    expect(typeof ntf.title).toBe('string');
    expect(typeof ntf.message).toBe('string');
    expect(typeof ntf.link).toBe('string');
    expect(typeof ntf.read).toBe('boolean');
    expect(ntf.created_at).toBeTruthy();
    const d = new Date(ntf.created_at);
    expect(d.getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // Unauthorized cannot access notifications
  // -------------------------------------------------------------------------
  test('API: GET /api/notifications without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Unauthorized cannot mark notification read
  // -------------------------------------------------------------------------
  test('API: PUT /api/notifications/:id without auth returns 401', async ({ request }) => {
    const res = await request.put(`${BASE}/api/notifications/999`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Unauthorized cannot delete notification
  // -------------------------------------------------------------------------
  test('API: DELETE /api/notifications/:id without auth returns 401', async ({ request }) => {
    const res = await request.delete(`${BASE}/api/notifications/999`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // User cannot delete another user's notification (404)
  // -------------------------------------------------------------------------
  test('API: user cannot delete a notification belonging to another user (404)', async ({ request }) => {
    const { token: tokenA, user: userA } = await createUser(request, 'Owner', 'ntfowner');
    const { token: tokenB } = await createUser(request, 'Other', 'ntfother');
    const { token: tokenC } = await createUser(request, 'Trigger', 'ntftrigger');

    const { card } = await createBoardWithCard(request, tokenA);
    await triggerAssignmentNotification(request, tokenC, card.id, userA.id);

    const listRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const listData = await listRes.json();
    const ntfId: number = listData.notifications[0].id;

    // Token B tries to delete a notification owned by user A
    const delRes = await request.delete(`${BASE}/api/notifications/${ntfId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(delRes.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Notification type for assignment is "assignment"
  // -------------------------------------------------------------------------
  test('API: assignment notification has type="assignment"', async ({ request }) => {
    const { token, user } = await createUser(request, 'Assign Type', 'assigntype');
    const { token: tokenB } = await createUser(request, 'Assign Trig', 'assigntrig');
    const { card } = await createBoardWithCard(request, token);

    await triggerAssignmentNotification(request, tokenB, card.id, user.id);

    const res = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.notifications.length).toBeGreaterThan(0);
    expect(data.notifications[0].type).toBe('assignment');
  });

  // -------------------------------------------------------------------------
  // Limit parameter on GET /api/notifications
  // -------------------------------------------------------------------------
  test('API: GET /api/notifications?limit=1 returns at most 1 notification', async ({ request }) => {
    const { token, user } = await createUser(request, 'Limit Test', 'limitntf');
    const { token: tokenB } = await createUser(request, 'Limit Trig', 'limittrig');
    const { card } = await createBoardWithCard(request, token);

    // Create two notifications
    await triggerAssignmentNotification(request, tokenB, card.id, user.id);
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Limit comment' },
    });

    const res = await request.get(`${BASE}/api/notifications?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    expect(data.notifications.length).toBeLessThanOrEqual(1);
  });
});
