import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  boardId: number;
  cardId: number;
}

/**
 * Create a fresh user, board, swimlane, and card via API.
 * Navigates to the board with the card modal open.
 */
async function setupBoardWithCard(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  displayName = 'Reply Tester',
): Promise<SetupResult> {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const { token } = await signupRes.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Reply Test Board' },
    })
  ).json();

  const columnId: number = board.columns[0].id;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'RT' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Reply Test Card',
        column_id: columnId,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);

  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.locator('.card-item').click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

  return { token, boardId: board.id, cardId: card.id };
}

/** Post a top-level comment via the main comment form and wait for it to appear. */
async function postTopLevelComment(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  text: string,
) {
  await page.fill('.comment-form-compact textarea', text);
  await page.click('.comment-form-compact button[type="submit"]');
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: text }),
  ).toBeVisible({ timeout: 8000 });
}

/** Click the Reply button on the first comment, fill the reply form, and submit. */
async function postReplyToFirstComment(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  replyText: string,
) {
  const replyBtn = page.locator('.btn-reply').first();
  await expect(replyBtn).toBeVisible({ timeout: 5000 });
  await replyBtn.click();
  await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
  await page.fill('.comment-reply-form textarea', replyText);
  await page.locator('.comment-reply-form .btn-primary').click();
}

// ---------------------------------------------------------------------------
// Test 1: Post reply to a comment — nested display appears
// ---------------------------------------------------------------------------
test('post reply to comment — reply appears nested under parent', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Parent comment for reply');

  await postReplyToFirstComment(page, 'This is a reply to the parent');

  // Reply text should be visible in the DOM (inside a nested reply container)
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: 'This is a reply to the parent' }),
  ).toBeVisible({ timeout: 10000 });

  // The reply should be inside the .comment-replies nesting container
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'This is a reply to the parent' }),
  ).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 2: Reply appears indented — visual nesting indicator present
// ---------------------------------------------------------------------------
test('reply appears indented under parent comment', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Parent for indent test');

  await postReplyToFirstComment(page, 'Indented reply content');

  // The .comment-replies wrapper carries margin-left per CSS — confirm it exists
  await expect(page.locator('.comment-replies')).toBeVisible({ timeout: 8000 });

  // The reply should have the .comment-reply class (additional indentation styling)
  await expect(page.locator('.comment-reply')).toBeVisible({ timeout: 5000 });

  // Confirm the parent text is NOT inside .comment-replies (i.e. top-level is separate)
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Parent for indent test' }),
  ).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 3: Reply text appears in thread
// ---------------------------------------------------------------------------
test('reply text visible in thread under parent comment', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Thread parent comment');

  await postReplyToFirstComment(page, 'Thread reply text visible');

  // Both parent and reply should be visible
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: 'Thread parent comment' }),
  ).toBeVisible({ timeout: 5000 });
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: 'Thread reply text visible' }),
  ).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// Test 4: Multiple replies on one parent — all 3 appear
// ---------------------------------------------------------------------------
test('multiple replies on one comment — all replies appear under parent', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Parent with many replies');

  // Post three replies sequentially
  for (const replyText of ['Reply one', 'Reply two', 'Reply three']) {
    const replyBtn = page.locator('.btn-reply').first();
    await expect(replyBtn).toBeVisible({ timeout: 5000 });
    await replyBtn.click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
    await page.fill('.comment-reply-form textarea', replyText);
    await page.locator('.comment-reply-form .btn-primary').click();
    // Wait for reply to appear before posting the next one
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({ hasText: replyText }),
    ).toBeVisible({ timeout: 10000 });
  }

  // All three replies should be present inside .comment-replies
  const nestedBodies = page.locator('.comment-replies .comment-body-compact');
  await expect(nestedBodies).toHaveCount(3, { timeout: 8000 });
  await expect(nestedBodies.nth(0)).toContainText('Reply one');
  await expect(nestedBodies.nth(1)).toContainText('Reply two');
  await expect(nestedBodies.nth(2)).toContainText('Reply three');
});

// ---------------------------------------------------------------------------
// Test 5: Reply persists after modal close/reopen
// ---------------------------------------------------------------------------
test('reply persists after closing and reopening card modal', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Persistent parent comment');

  await postReplyToFirstComment(page, 'Persistent reply content');

  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Persistent reply content' }),
  ).toBeVisible({ timeout: 10000 });

  // Close the modal by clicking the overlay area outside it
  await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

  // Reopen the card
  await page.locator('.card-item').click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

  // Reply should still be visible after reload
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Persistent reply content' }),
  ).toBeVisible({ timeout: 8000 });

  // Parent comment should also still be there
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: 'Persistent parent comment' }),
  ).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 6: Reply API returns nested structure — replies array is non-empty
// ---------------------------------------------------------------------------
test('GET /api/cards/:id/comments returns comment with non-empty replies array', async ({ request }) => {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'API Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Reply Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'AR' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'API Reply Card',
        column_id: board.columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  // Post a parent comment
  const parentComment = await (
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { body: 'API parent comment' },
    })
  ).json();

  expect(parentComment.id).toBeTruthy();

  // Post a reply referencing the parent
  await request.post(`${BASE}/api/cards/${card.id}/comments`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { body: 'API reply body', parent_comment_id: parentComment.id },
  });

  // Fetch comments and verify the replies array is populated
  const comments = await (
    await request.get(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  expect(Array.isArray(comments)).toBe(true);
  // Only one top-level comment (the reply is nested)
  expect(comments.length).toBe(1);

  const topLevel = comments[0];
  expect(topLevel.body).toBe('API parent comment');
  expect(Array.isArray(topLevel.replies)).toBe(true);
  expect(topLevel.replies.length).toBe(1);
  expect(topLevel.replies[0].body).toBe('API reply body');
});

// ---------------------------------------------------------------------------
// Test 7: Cancel reply — form disappears, no reply posted
// ---------------------------------------------------------------------------
test('cancel reply — form disappears and no reply is created', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Parent for cancel test');

  const replyBtn = page.locator('.btn-reply').first();
  await expect(replyBtn).toBeVisible({ timeout: 5000 });
  await replyBtn.click();

  await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
  await page.fill('.comment-reply-form textarea', 'This reply will be cancelled');

  // Click the Cancel button (the non-primary btn in the reply actions)
  await page.locator('.comment-reply-form .btn:not(.btn-primary)').click();

  // The reply form should be gone
  await expect(page.locator('.comment-reply-form')).not.toBeVisible({ timeout: 5000 });

  // No reply should exist — the .comment-replies container should not appear
  await expect(page.locator('.comment-replies')).not.toBeVisible({ timeout: 3000 });

  // The cancelled text should not appear anywhere in comments
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: 'This reply will be cancelled' }),
  ).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 8: Reply vs new comment — reply goes under parent, new comment is top-level
// ---------------------------------------------------------------------------
test('reply nests under parent while new top-level comment stays top-level', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'The original parent comment');

  // Post a reply to the first (only) comment
  await postReplyToFirstComment(page, 'Nested reply to parent');
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Nested reply to parent' }),
  ).toBeVisible({ timeout: 10000 });

  // Post a new top-level comment via the main form
  await postTopLevelComment(page, 'A brand-new top-level comment');

  // There should be 2 top-level comment items (parent + new top-level)
  // Top-level items are .comment-item-compact but NOT .comment-reply
  const topLevelItems = page.locator('.comment-item-compact:not(.comment-reply)');
  await expect(topLevelItems).toHaveCount(2, { timeout: 8000 });

  // The nested reply should remain inside .comment-replies (not count as top-level)
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Nested reply to parent' }),
  ).toBeVisible();

  // The new comment should NOT be inside .comment-replies
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'A brand-new top-level comment' }),
  ).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Test 9: Reply chain — reply to a reply (grandchild threading)
// ---------------------------------------------------------------------------
test('reply chain — reply to a reply nests as grandchild if supported', async ({ page, request }) => {
  const { token, cardId } = await setupBoardWithCard(request, page);

  await postTopLevelComment(page, 'Grandparent comment');

  // Post a first-level reply via the UI
  await postReplyToFirstComment(page, 'Child reply');
  await expect(
    page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Child reply' }),
  ).toBeVisible({ timeout: 10000 });

  // Check whether there is a Reply button on the child reply in the UI
  const childReplyBtns = page.locator('.comment-replies .btn-reply');
  const childReplyBtnCount = await childReplyBtns.count();

  if (childReplyBtnCount > 0) {
    // UI supports replying to a reply — exercise that path
    await childReplyBtns.first().click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
    await page.fill('.comment-reply-form textarea', 'Grandchild reply');
    await page.locator('.comment-reply-form .btn-primary').click();

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Grandchild reply' }),
    ).toBeVisible({ timeout: 10000 });
  } else {
    // UI does not expose reply-to-reply; verify via API that grandchild can be created
    // Fetch comments to get the child reply's id
    const comments = await (
      await page.request.get(`${BASE}/api/cards/${cardId}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const childId: number = comments[0].replies[0].id;
    expect(childId).toBeTruthy();

    const grandchild = await (
      await page.request.post(`${BASE}/api/cards/${cardId}/comments`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { body: 'Grandchild reply via API', parent_comment_id: childId },
      })
    ).json();

    expect(grandchild.id).toBeTruthy();
    expect(grandchild.body).toBe('Grandchild reply via API');
  }
});

// ---------------------------------------------------------------------------
// Test 10: Empty reply not submitted — button disabled / no POST
// ---------------------------------------------------------------------------
test('empty reply is not submitted — submit button is disabled when text is blank', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postTopLevelComment(page, 'Parent for empty reply test');

  const replyBtn = page.locator('.btn-reply').first();
  await expect(replyBtn).toBeVisible({ timeout: 5000 });
  await replyBtn.click();

  await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });

  // The submit button should be disabled when textarea is empty
  const submitBtn = page.locator('.comment-reply-form .btn-primary');
  await expect(submitBtn).toBeDisabled();

  // Type something then clear it — button should become disabled again
  await page.fill('.comment-reply-form textarea', 'some text');
  await expect(submitBtn).toBeEnabled();

  await page.fill('.comment-reply-form textarea', '');
  await expect(submitBtn).toBeDisabled();

  // No replies should have been created
  await expect(page.locator('.comment-replies')).not.toBeVisible();
});
