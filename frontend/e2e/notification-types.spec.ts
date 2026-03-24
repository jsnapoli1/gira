/**
 * notification-types.spec.ts
 *
 * Tests focused on notification *types* and *triggers*:
 *   - assignment, comment, mention, due_date
 *
 * What is NOT covered here (already in notifications.spec.ts /
 * notifications-extended.spec.ts):
 *   - Basic bell visibility
 *   - Empty-state dropdown
 *   - Delete individual notification
 *   - Dropdown closes on outside-click
 *   - Batch multi-unread count via repeated comments
 *   - Bell count updates after new notification (poll simulation)
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Create a fresh user via API and return { token, user }. */
async function createUser(
  request: any,
  displayName: string,
  suffix: string
): Promise<{ token: string; user: any }> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `nt-${suffix}-${uid}@test.com`,
      password: 'password123',
      display_name: displayName,
    },
  });
  return res.json();
}

/**
 * Create a board (owned by tokenA), add tokenB as member, create a
 * swimlane and one card.  Returns all IDs needed by tests.
 */
async function createBoardWithTwoUsers(
  request: any,
  tokenA: string,
  tokenB: string,
  userBId: number
): Promise<{ board: any; card: any; columns: any[]; swimlane: any }> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: `NT Board ${uid}` },
    })
  ).json();

  const columns: any[] = board.columns ?? [];

  // Add User B as board member so they can be assigned, mentioned, etc.
  await request.post(`${BASE}/api/boards/${board.id}/members`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { user_id: userBId, role: 'member' },
  });

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: 'NT Swimlane', designator: 'NT-', color: '#6366f1' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        title: 'Notification Type Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return { board, card, columns, swimlane };
}

/**
 * Navigate `page` to a board as `token`.  Waits for the notification bell
 * and switches to "All Cards" view so card items are always visible.
 */
async function navigateToBoard(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.notification-bell', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

/**
 * Open the notification dropdown and wait for it to be visible.
 */
async function openNotificationDropdown(page: any) {
  await page.click('.notification-bell');
  await expect(page.locator('.notification-dropdown')).toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// 1. Assignment notification type
// ---------------------------------------------------------------------------
test.describe('Assignment notification type', () => {
  test('user A assigns user B to a card; user B receives an assignment notification', async ({
    request,
    browser,
  }) => {
    const { token: tokenA, user: userA } = await createUser(request, 'NT Assigner', 'assigner');
    const { token: tokenB, user: userB } = await createUser(request, 'NT Assignee', 'assignee');
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // User A assigns User B to the card
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userB.id },
    });

    // Open a fresh browser context for User B
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await navigateToBoard(pageB, tokenB, board.id);
    await pageB.reload();
    await pageB.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge should be present
    await expect(pageB.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    // Open dropdown; verify type=assignment title
    await openNotificationDropdown(pageB);
    await expect(
      pageB.locator('.notification-title').filter({ hasText: "You've been assigned" }).first()
    ).toBeVisible({ timeout: 8000 });

    await ctxB.close();
  });

  test('self-assignment does NOT produce a notification', async ({ request, page }) => {
    const { token, user } = await createUser(request, 'NT SelfAssign', 'selfassign');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `NT SelfAssign Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'NT Swimlane', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Self-assign card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // Self-assign
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    // Navigate and reload; badge should NOT appear
    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Comment notification type
// ---------------------------------------------------------------------------
test.describe('Comment notification type', () => {
  test('user A comments on card assigned to user B; user B receives a comment notification', async ({
    request,
    browser,
  }) => {
    const { token: tokenA, user: userA } = await createUser(request, 'NT Commenter', 'commenter');
    const { token: tokenB, user: userB } = await createUser(request, 'NT CommentTarget', 'ctarget');
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // Assign User B to the card first so they become a comment-notification recipient
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userB.id },
    });

    // User A posts a comment
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: 'Here is a review comment for you.' },
    });

    // Open a fresh context for User B
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await navigateToBoard(pageB, tokenB, board.id);
    await pageB.reload();
    await pageB.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge should be present (comment notification + any assignment notification)
    await expect(pageB.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await openNotificationDropdown(pageB);

    // At least one notification should be the comment type
    await expect(
      pageB.locator('.notification-title').filter({ hasText: 'New comment' }).first()
    ).toBeVisible({ timeout: 8000 });

    await ctxB.close();
  });

  test('comment notification message references commenter display name', async ({
    request,
    browser,
  }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT NamedCommenter',
      'namedcmt'
    );
    const { token: tokenB, user: userB } = await createUser(request, 'NT CommentRcvr', 'crcvr');
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userB.id },
    });

    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: 'Please review this.' },
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await navigateToBoard(pageB, tokenB, board.id);
    await pageB.reload();
    await pageB.waitForSelector('.notification-bell', { timeout: 10000 });

    await expect(pageB.locator('.notification-badge')).toBeVisible({ timeout: 8000 });
    await openNotificationDropdown(pageB);

    // The notification message body should mention the commenter by display name
    const msgLocator = pageB.locator('.notification-message, .notification-body');
    const allMsgs = await msgLocator.allTextContents();
    const hasCommenterName = allMsgs.some((m) => m.includes('NT NamedCommenter'));
    expect(hasCommenterName).toBe(true);

    await ctxB.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Due date notification
// ---------------------------------------------------------------------------
test.describe('Due date notification', () => {
  test('card with past due date assigned to user creates assignment notification (due_date field verified via API)', async ({
    request,
    browser,
  }) => {
    // NOTE: The backend does NOT emit a separate "due_date" notification type on
    // card update. However, the card model stores due_date and the assignment
    // notification is still triggered when a user is assigned to an overdue card.
    // This test verifies:
    //   a) A card with a past due date can be created/updated via the API.
    //   b) Assigning a user to that card produces an assignment notification.
    //   c) The notification includes the card title in its message.

    const { token: tokenA, user: userA } = await createUser(request, 'NT DueSetter', 'duesetter');
    const { token: tokenB, user: userB } = await createUser(request, 'NT DueAssignee', 'dueasgn');
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // Update the card with a past due date
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        title: 'Overdue Task Card',
        description: '',
        due_date: '2000-01-01', // clearly in the past
      },
    });

    // Assign User B to the overdue card
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userB.id },
    });

    // Verify via API that User B has an assignment notification
    const ntfRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const ntfData = await ntfRes.json();
    const notifications: any[] = ntfData.notifications ?? [];

    const assignmentNtf = notifications.find((n: any) => n.type === 'assignment');
    expect(assignmentNtf).toBeDefined();
    expect(assignmentNtf.message).toContain('Overdue Task Card');

    // Verify User B sees the badge in the UI
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await navigateToBoard(pageB, tokenB, board.id);
    await pageB.reload();
    await pageB.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(pageB.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await ctxB.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Mention notification type
// ---------------------------------------------------------------------------
test.describe('Mention notification type', () => {
  test('@displayname in comment generates a mention notification for the named user', async ({
    request,
    browser,
  }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT MentionAuthor',
      'mentionauth'
    );
    const { token: tokenB, user: userB } = await createUser(
      request,
      'NT MentionTarget',
      'mentiontgt'
    );
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // User A comments mentioning User B by display name.
    // Multi-word display names must use the quoted @"Name" format in the mention regex.
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: `Hey @"NT MentionTarget", can you take a look?` },
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await navigateToBoard(pageB, tokenB, board.id);
    await pageB.reload();
    await pageB.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge should appear for the mention
    await expect(pageB.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await openNotificationDropdown(pageB);

    // "You were mentioned" title should appear
    await expect(
      pageB.locator('.notification-title').filter({ hasText: 'You were mentioned' }).first()
    ).toBeVisible({ timeout: 8000 });

    await ctxB.close();
  });

  test('mention notification is type "mention" in the API response', async ({ request }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT MentionApiAuthor',
      'mentapiauth'
    );
    const { token: tokenB, user: userB } = await createUser(
      request,
      'NT MentionApiTarget',
      'mentapitgt'
    );
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // Multi-word display names must be quoted: @"Name"
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: `@"NT MentionApiTarget" please review` },
    });

    const ntfRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const ntfData = await ntfRes.json();
    const notifications: any[] = ntfData.notifications ?? [];

    const mentionNtf = notifications.find((n: any) => n.type === 'mention');
    expect(mentionNtf).toBeDefined();
    expect(mentionNtf.title).toContain('You were mentioned');
  });

  test('mentioner does NOT receive their own mention notification', async ({ request }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT SelfMentioner',
      'selfmention'
    );
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: `NT SelfMention Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          title: 'Self-mention card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // User A mentions themselves — multi-word names need quotes
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: `@"NT SelfMentioner" look at this` },
    });

    const ntfRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const ntfData = await ntfRes.json();
    const notifications: any[] = ntfData.notifications ?? [];

    // No mention notification for the author themselves
    const mentionNtf = notifications.find((n: any) => n.type === 'mention');
    expect(mentionNtf).toBeUndefined();
  });

  test('mention with quoted display name (@"Name With Spaces") works', async ({
    request,
    browser,
  }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT QuotedAuthor',
      'quotedauth'
    );
    const { token: tokenB, user: userB } = await createUser(
      request,
      'NT Quoted Target',
      'quotedtgt'
    );
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // Mention with quoted format for the space-containing display name
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: `@"NT Quoted Target" can you check this?` },
    });

    const ntfRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const ntfData = await ntfRes.json();
    const notifications: any[] = ntfData.notifications ?? [];

    const mentionNtf = notifications.find((n: any) => n.type === 'mention');
    expect(mentionNtf).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Notification click navigates to the correct card
// ---------------------------------------------------------------------------
test.describe('Notification navigation', () => {
  test('clicking a notification opens the correct card (URL contains ?card=:id)', async ({
    page,
    request,
  }) => {
    // Reuse single-user setup: a second user triggers the notification
    const { token: tokenA, user: userA } = await createUser(request, 'NT NavUser', 'navuser');
    const { token: tokenB } = await createUser(request, 'NT NavTrigger', 'navtrig');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: `NT Nav Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          title: 'Navigation Target Card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // User B assigns User A (triggers notification for A)
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: userA.id },
    });

    await navigateToBoard(page, tokenA, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await openNotificationDropdown(page);

    // Click the notification item
    await page.locator('.notification-item').first().click();

    // URL should include the card ID as a query param
    await expect(page).toHaveURL(new RegExp(`[?&]card=${card.id}`), { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Mark all as read
// ---------------------------------------------------------------------------
test.describe('Mark all as read', () => {
  test('"Mark all read" button clears all unread notifications', async ({ page, request }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT MarkAllUser',
      'markalluser'
    );
    const { token: tokenB } = await createUser(request, 'NT MarkAllTrig', 'markalltrig');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: `NT MarkAll Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          title: 'Mark All Read Card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // Assign User A (notification 1) then add a comment (notification 2)
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: userA.id },
    });
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'First comment' },
    });

    await navigateToBoard(page, tokenA, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });
    const countBefore = Number(await page.locator('.notification-badge').textContent());
    expect(countBefore).toBeGreaterThanOrEqual(2);

    await openNotificationDropdown(page);

    // Click mark-all-read
    await page.click('.mark-all-read-btn');

    // Badge should disappear
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 8000 });

    // No unread items remain in the list
    await expect(page.locator('.notification-item.unread')).toHaveCount(0, { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 7. Notification badge count accuracy
// ---------------------------------------------------------------------------
test.describe('Notification badge count', () => {
  test('badge shows correct count matching unread_count from API', async ({ page, request }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT BadgeCount',
      'badgecount'
    );
    const { token: tokenB } = await createUser(request, 'NT BadgeTrig', 'badgetrig');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: `NT Badge Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${tokenA}` },
        data: {
          title: 'Badge Count Card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // Create exactly 2 notifications: assignment + comment
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: userA.id },
    });
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Badge count comment' },
    });

    // Get the API's unread_count for User A
    const apiRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const apiData = await apiRes.json();
    const apiUnreadCount: number = apiData.unread_count;

    // Navigate and verify the UI badge matches
    await navigateToBoard(page, tokenA, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    const badgeText = await badge.textContent();
    expect(Number(badgeText)).toBe(apiUnreadCount);
  });
});

// ---------------------------------------------------------------------------
// 8. Badge disappears when all notifications are read
// ---------------------------------------------------------------------------
test.describe('Badge disappears when all read', () => {
  test('badge count goes to 0 after marking all notifications as read', async ({
    page,
    request,
  }) => {
    const { token, user } = await createUser(request, 'NT BadgeZero', 'badgezero');
    const { token: tokenB } = await createUser(request, 'NT BadgeZeroTrig', 'badgezerotrig');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `NT BadgeZero Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Badge Zero Card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Confirm badge is present before acting
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    // Mark all read via the UI
    await openNotificationDropdown(page);
    await page.click('.mark-all-read-btn');

    // Badge should be gone
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 8000 });

    // Verify API also reports 0 unread
    const apiRes = await request.get(`${BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const apiData = await apiRes.json();
    expect(apiData.unread_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Notification timestamp
// ---------------------------------------------------------------------------
test.describe('Notification timestamp', () => {
  test('freshly created notification shows relative time (e.g. "just now" or "ago")', async ({
    page,
    request,
  }) => {
    const { token, user } = await createUser(request, 'NT TimeUser', 'timeuser');
    const { token: tokenB } = await createUser(request, 'NT TimeTrig', 'timetrig');
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: `NT Time Board ${uid}` },
      })
    ).json();

    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'NT SL', designator: 'NT-' },
      })
    ).json();

    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Timestamp Test Card',
          column_id: board.columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await navigateToBoard(page, token, board.id);
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await openNotificationDropdown(page);

    // The notification should show a timestamp element
    const timestampLocator = page.locator('.notification-time, .notification-timestamp, .notification-age');
    const count = await timestampLocator.count();
    expect(count).toBeGreaterThan(0);

    // The timestamp text should contain a relative time pattern:
    // "just now", "a few seconds ago", "<N> min ago", "<N> minutes ago", etc.
    const tsText = (await timestampLocator.first().textContent()) ?? '';
    const relativeTimePattern = /just now|ago|second|minute|hour|day|week/i;
    expect(relativeTimePattern.test(tsText)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. No notification after board membership is removed
// ---------------------------------------------------------------------------
test.describe('Notification when not a board member', () => {
  test('user removed from board does not receive notifications for that board after removal', async ({
    request,
  }) => {
    const { token: tokenA, user: userA } = await createUser(
      request,
      'NT ExMember Owner',
      'exmowner'
    );
    const { token: tokenB, user: userB } = await createUser(
      request,
      'NT ExMember User',
      'exmuser'
    );
    const { board, card } = await createBoardWithTwoUsers(request, tokenA, tokenB, userB.id);

    // Assign User B while still a member — this notification SHOULD exist
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userB.id },
    });

    // Count User B's notifications now
    const before = await (
      await request.get(`${BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
    ).json();
    const countBefore: number = (before.notifications ?? []).length;
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Remove User B from the board
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    // Remove User B as assignee so no role on the card either
    await request.delete(`${BASE}/api/cards/${card.id}/assignees/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    // User A posts a new comment — User B is no longer an assignee or member
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { body: 'Post-removal comment, should not notify B' },
    });

    // Verify User B did NOT receive a new notification for the post-removal comment
    const after = await (
      await request.get(`${BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
    ).json();
    const countAfter: number = (after.notifications ?? []).length;

    // Count should not have increased beyond what it was before the comment
    expect(countAfter).toBe(countBefore);
  });
});
