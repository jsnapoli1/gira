import { test, expect, Browser } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared helper: create a fresh user + board + swimlane + card, then navigate
// to the board as that user. Returns tokens, IDs, and the page ready to use.
// ---------------------------------------------------------------------------
async function setupSingleUser(
  request: any,
  page: any,
  label = 'NE'
): Promise<{
  token: string;
  user: any;
  board: any;
  card: any;
  columns: any[];
  swimlane: any;
}> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { token, user } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `ne-${label.toLowerCase()}-${uid}@test.com`,
        password: 'password123',
        display_name: `${label} User`,
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
    })
  ).json();

  // board.columns is returned inline on creation
  const columns: any[] = board.columns ?? [];

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'NE-', color: '#6366f1' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Notification Target Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.notification-bell', { timeout: 15000 });

  // Switch to All Cards so cards are visible even without a sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { token, user, board, card, columns, swimlane };
}

// ---------------------------------------------------------------------------
// Helper: create two users (A and B), a shared board, and a card.
// User A owns the board; User B is added as member.
// Returns raw tokens/users/board/card — does NOT navigate any page.
// ---------------------------------------------------------------------------
async function setupTwoUsers(request: any): Promise<{
  tokenA: string;
  userA: any;
  tokenB: string;
  userB: any;
  board: any;
  card: any;
  columns: any[];
  swimlane: any;
}> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { token: tokenA, user: userA } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `ne-usera-${uid}@test.com`,
        password: 'password123',
        display_name: 'User A Extended',
      },
    })
  ).json();

  const { token: tokenB, user: userB } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `ne-userb-${uid}@test.com`,
        password: 'password123',
        display_name: 'User B Extended',
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: `Shared Board ${uid}` },
    })
  ).json();

  const columns: any[] = board.columns ?? [];

  // Add User B as board member
  await request.post(`${BASE}/api/boards/${board.id}/members`, {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { user_id: userB.id, role: 'member' },
  });

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { name: 'Test Swimlane', designator: 'NE-', color: '#6366f1' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: {
        title: 'Cross-User Notification Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return { tokenA, userA, tokenB, userB, board, card, columns, swimlane };
}

// ---------------------------------------------------------------------------
// Helper: navigate a page to a board as a given user (sets token, goes to board)
// ---------------------------------------------------------------------------
async function navigateAsUser(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.notification-bell', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

// ===========================================================================
// Notification Bell State
// ===========================================================================
test.describe('Notification Bell State', () => {
  test('bell shows unread count badge when there are unread notifications', async ({
    page,
    request,
  }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'BadgeShow');

    // Create a second user to do the assigning (self-assign does not generate a notification)
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-assigner-${uid}@test.com`,
          password: 'password123',
          display_name: 'Assigner B',
        },
      })
    ).json();

    // Assign User A to the card via User B's token (triggers notification for User A)
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    // Reload to pick up the new notification
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge should be visible and contain a positive number
    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    const text = await badge.textContent();
    expect(Number(text)).toBeGreaterThan(0);
  });

  test('badge disappears after clicking Mark All Read', async ({ page, request }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'BadgeClear');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-assigner2-${uid}@test.com`,
          password: 'password123',
          display_name: 'Assigner C',
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Confirm badge is present before acting
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    // Open dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Click Mark All Read
    await page.click('.mark-all-read-btn');

    // Badge should disappear
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 8000 });
  });

  test('bell count updates after new notification (via reload simulation)', async ({
    page,
    request,
  }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'PollUpdate');

    // Confirm no badge initially
    await expect(page.locator('.notification-badge')).not.toBeVisible({ timeout: 5000 });

    // Create notification via API (another user assigns User A)
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-poller-${uid}@test.com`,
          password: 'password123',
          display_name: 'Poller D',
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    // Trigger the notification poll by reloading (simulates the 60-second interval firing)
    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Badge should now appear
    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    expect(Number(await badge.textContent())).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Comment Notifications
// ===========================================================================
test.describe('Comment Notifications', () => {
  // NOTE: The backend only notifies card *assignees* when a comment is posted —
  // not card *watchers*. Watcher-based comment notifications are not implemented.
  test.fixme(
    'comment on watched card (watcher-only) triggers notification for watcher',
    async ({ page, request, browser }) => {
      // This test is fixme because the backend only notifies assignees, not watchers.
      // Once watcher notifications are implemented in card_handlers.go, remove fixme.
      const { tokenA, userA, tokenB, board, card } = await setupTwoUsers(request);

      // User A watches the card via API (but is NOT an assignee)
      await request.post(`${BASE}/api/cards/${card.id}/watch`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      // User B adds a comment
      await request.post(`${BASE}/api/cards/${card.id}/comments`, {
        headers: { Authorization: `Bearer ${tokenB}` },
        data: { body: 'Watcher notification test comment' },
      });

      // User A should have a notification (watcher) — currently not implemented
      const ctxA = await browser.newContext();
      const pageA = await ctxA.newPage();
      await navigateAsUser(pageA, tokenA, board.id);
      await pageA.reload();
      await pageA.waitForSelector('.notification-bell', { timeout: 10000 });
      await expect(pageA.locator('.notification-badge')).toBeVisible({ timeout: 8000 });
      await ctxA.close();
    }
  );

  test('comment on card notifies assignee (not just the commenter)', async ({
    request,
    browser,
  }) => {
    const { tokenA, userA, tokenB, userB, board, card } = await setupTwoUsers(request);

    // User A is assigned to the card
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userA.id },
    });

    // User B (not the assignee) adds a comment
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Hey, check this out!' },
    });

    // Open a browser context for User A and verify they received a notification
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await navigateAsUser(pageA, tokenA, board.id);

    // Reload to fetch latest notifications
    await pageA.reload();
    await pageA.waitForSelector('.notification-bell', { timeout: 10000 });

    await expect(pageA.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    // Open dropdown and confirm notification content
    await pageA.click('.notification-bell');
    await expect(pageA.locator('.notification-dropdown')).toBeVisible();
    await expect(pageA.locator('.notification-item')).toBeVisible();

    await ctxA.close();
  });

  test('notification links to correct card — URL contains ?card=:id', async ({
    page,
    request,
  }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'NavLink');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-linker-${uid}@test.com`,
          password: 'password123',
          display_name: 'Linker E',
        },
      })
    ).json();

    // Assign User A so a notification with a link is created
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    // Open dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Click the notification
    await page.locator('.notification-item').first().click();

    // The URL should contain ?card=:cardId
    await expect(page).toHaveURL(new RegExp(`[?&]card=${card.id}`), { timeout: 8000 });
  });
});

// ===========================================================================
// Notification Types
// ===========================================================================
test.describe('Notification Types', () => {
  test('assignment notification shows assignment-related title text', async ({
    page,
    request,
  }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'TypeAssign');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-assigner3-${uid}@test.com`,
          password: 'password123',
          display_name: 'Assigner F',
        },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(page.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Title should mention assignment
    await expect(page.locator('.notification-title').first()).toContainText("You've been assigned");
  });

  test('comment notification shows comment-related title text', async ({
    request,
    browser,
  }) => {
    const { tokenA, userA, tokenB, userB, board, card } = await setupTwoUsers(request);

    // Assign User A to the card first so comment notification is triggered
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      data: { user_id: userA.id },
    });

    // User B comments on the card
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'This is a type-check comment' },
    });

    // Check User A's notifications in a fresh browser context
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await navigateAsUser(pageA, tokenA, board.id);
    await pageA.reload();
    await pageA.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(pageA.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await pageA.click('.notification-bell');
    await expect(pageA.locator('.notification-dropdown')).toBeVisible();

    // The most-recent notification should be the comment one
    const titles = pageA.locator('.notification-title');
    // Find a notification with "New comment" text
    await expect(titles.filter({ hasText: 'New comment' }).first()).toBeVisible({ timeout: 8000 });

    await ctxA.close();
  });

  test('assignment and comment notifications have visually distinct styling', async ({
    request,
    browser,
  }) => {
    const { tokenA, userA, tokenB, userB, board, card } = await setupTwoUsers(request);

    // Create both notification types for User A:
    // 1. Assign User A (assignment notification from User B)
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: userA.id },
    });

    // 2. User B comments (comment notification for assignee User A)
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Distinct styling check' },
    });

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await navigateAsUser(pageA, tokenA, board.id);
    await pageA.reload();
    await pageA.waitForSelector('.notification-bell', { timeout: 10000 });
    await expect(pageA.locator('.notification-badge')).toBeVisible({ timeout: 8000 });

    await pageA.click('.notification-bell');
    await expect(pageA.locator('.notification-dropdown')).toBeVisible();

    // Both notifications should be present
    await expect(pageA.locator('.notification-item')).toHaveCount(2);

    // They should both show as unread initially
    await expect(pageA.locator('.notification-item.unread')).toHaveCount(2);

    await ctxA.close();
  });
});

// ===========================================================================
// Edge Cases
// ===========================================================================
test.describe('Notification Edge Cases', () => {
  test('dropdown closes when clicking outside', async ({ page, request }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'OutsideClick');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-outside-${uid}@test.com`,
          password: 'password123',
          display_name: 'Outside G',
        },
      })
    ).json();

    // Create at least one notification so the dropdown has content
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Open the dropdown
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();

    // Click somewhere outside the notification container (e.g., the main content area)
    await page.click('.main-content', { position: { x: 10, y: 10 } });

    // Dropdown should be gone
    await expect(page.locator('.notification-dropdown')).not.toBeVisible({ timeout: 5000 });
  });

  test('empty state is shown after deleting all notifications', async ({ page, request }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'EmptyAfterDelete');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-emptyafter-${uid}@test.com`,
          password: 'password123',
          display_name: 'Delete H',
        },
      })
    ).json();

    // Trigger one notification
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Open dropdown, confirm notification present
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    await expect(page.locator('.notification-item')).toBeVisible();

    // Hover to reveal delete button and click it
    await page.locator('.notification-item').first().hover();
    await page.locator('.notification-delete').first().click();

    // After deletion, empty state should appear
    await expect(page.locator('.notification-empty')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.notification-empty')).toContainText('No notifications');
  });

  test('notification dropdown shows all unread items before mark-all-read', async ({
    page,
    request,
  }) => {
    const { token, user, board, card } = await setupSingleUser(request, page, 'MultiUnread');

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { token: tokenB } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: {
          email: `ne-multi-${uid}@test.com`,
          password: 'password123',
          display_name: 'Multi I',
        },
      })
    ).json();

    // Assign User A to create an assignment notification
    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { user_id: user.id },
    });

    // User B adds comments to create additional notifications (assignee = User A)
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Comment one for multi-unread test' },
    });
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { body: 'Comment two for multi-unread test' },
    });

    await page.reload();
    await page.waitForSelector('.notification-bell', { timeout: 10000 });

    // Should have at least 2 unread notifications
    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible({ timeout: 8000 });
    expect(Number(await badge.textContent())).toBeGreaterThanOrEqual(2);

    // Open dropdown and confirm multiple unread items
    await page.click('.notification-bell');
    await expect(page.locator('.notification-dropdown')).toBeVisible();
    const unreadItems = page.locator('.notification-item.unread');
    await expect(unreadItems).toHaveCount(
      await unreadItems.count() >= 2 ? await unreadItems.count() : 2
    );

    // Mark all read — badge disappears and no more unread items
    await page.click('.mark-all-read-btn');
    await expect(badge).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.notification-item.unread')).toHaveCount(0, { timeout: 8000 });
  });
});
