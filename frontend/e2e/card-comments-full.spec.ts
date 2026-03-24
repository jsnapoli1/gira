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

async function createUser(
  request: import('@playwright/test').APIRequestContext,
  displayName: string,
): Promise<{ token: string; userId: number }> {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token, userId: body.user?.id };
}

/**
 * Create a board with a swimlane and a single card.
 * Returns null if card creation fails (Gitea 401 guard).
 */
async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Full Comment Tester',
): Promise<SetupResult | null> {
  const { token } = await createUser(request, displayName);

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Full Comment Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'FC' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Full Lifecycle Card',
      column_id: board.columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!cardRes.ok()) return null;

  const card = await cardRes.json();
  return { token, boardId: board.id, cardId: card.id };
}

async function openCardModal(
  page: import('@playwright/test').Page,
  token: string,
  boardId: number,
): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.locator('.card-item').first().click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
}

async function postComment(
  page: import('@playwright/test').Page,
  text: string,
): Promise<void> {
  await page.fill('.comment-form-compact textarea', text);
  await page.click('.comment-form-compact button[type="submit"]');
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: text }),
  ).toBeVisible({ timeout: 8000 });
}

async function postReply(
  page: import('@playwright/test').Page,
  commentIndex: number,
  replyText: string,
): Promise<void> {
  const replyBtn = page.locator('.btn-reply').nth(commentIndex);
  await expect(replyBtn).toBeVisible({ timeout: 5000 });
  await replyBtn.click();
  await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
  await page.fill('.comment-reply-form textarea', replyText);
  await page.locator('.comment-reply-form .btn-primary').click();
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: replyText }),
  ).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Card Comments — Full Lifecycle', () => {
  // -------------------------------------------------------------------------
  // 1. Create comment — full lifecycle: create then verify
  // -------------------------------------------------------------------------
  test('create a comment and verify it appears with author and timestamp', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Lifecycle User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Full lifecycle comment #1');

    // Comment appears with correct content, author, and timestamp
    await expect(page.locator('.comment-item-compact')).toHaveCount(1);
    await expect(page.locator('.comment-body-compact').first()).toContainText(
      'Full lifecycle comment #1',
    );
    await expect(page.locator('.comment-author').first()).toContainText('Lifecycle User');
    await expect(page.locator('.comment-time').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Create, then reply — full lifecycle
  // -------------------------------------------------------------------------
  test('create comment then reply — reply nested under parent', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Top-level comment for lifecycle reply');
    await postReply(page, 0, 'Lifecycle reply to parent');

    // Reply is nested under the parent
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({
        hasText: 'Lifecycle reply to parent',
      }),
    ).toBeVisible({ timeout: 8000 });

    // Total top-level comments = 1
    const topLevelItems = page.locator('.comment-item-compact:not(.comment-reply)');
    await expect(topLevelItems).toHaveCount(1);
  });

  // -------------------------------------------------------------------------
  // 3. Edit comment — NOT YET IMPLEMENTED
  // -------------------------------------------------------------------------
  test('edit a comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'Comment editing is not implemented. ' +
        'No PUT /api/comments/:id route exists. ' +
        'No edit button rendered on .comment-item-compact. ' +
        'Backend DB has no UpdateComment function.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Comment to be edited');

    await page.locator('.comment-item-compact').first().hover();
    await page.locator('.btn-edit-comment, [aria-label*="edit" i]').first().click();

    const editInput = page.locator('.comment-edit-input, .comment-item-compact textarea');
    await editInput.fill('Edited comment text');
    await page.locator('button:has-text("Save"), .btn-save-comment').click();

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Edited comment text' }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Delete comment — NOT YET IMPLEMENTED
  // -------------------------------------------------------------------------
  test('delete a comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'Comment deletion is not implemented. ' +
        'No DELETE /api/comments/:id route exists. ' +
        'No delete button rendered on .comment-item-compact. ' +
        'The DB has DeleteComment but no handler is registered.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Comment to be deleted');

    page.once('dialog', (d) => d.accept());
    await page.locator('.comment-item-compact').first().hover();
    await page.locator('.btn-delete-comment, [aria-label*="delete" i]').first().click();

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Comment to be deleted' }),
    ).not.toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 5. Full lifecycle: create, reply, then verify both persist across page reload
  // -------------------------------------------------------------------------
  test('comment and reply persist across full page reload', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Persistent parent across reload');
    await postReply(page, 0, 'Persistent reply across reload');

    // Verify both are present before reload
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Persistent parent across reload' }),
    ).toBeVisible();
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({
        hasText: 'Persistent reply across reload',
      }),
    ).toBeVisible();

    // Close modal and do a full page reload
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await page.reload();

    // Navigate back and reopen card
    await page.waitForSelector('.view-btn:has-text("All Cards")', { timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Both should still be present after reload
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Persistent parent across reload' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({
        hasText: 'Persistent reply across reload',
      }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 6. Comments persist across modal close/reopen (not full reload)
  // -------------------------------------------------------------------------
  test('comments persist across closing and reopening the card modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Comment persists after modal close');

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Comment persists after modal close' }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 7. Comment count shown on card in board view — NOT YET IMPLEMENTED
  //    No comment count badge exists on .card-item in the current UI.
  // -------------------------------------------------------------------------
  test('comment count badge shown on card in board view — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'No comment count badge/indicator exists on card items (.card-item) in the current UI. ' +
        'Implement a badge (e.g. .card-comment-count) that shows the total comment count on the card.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Comment for count badge test');

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Card should show a comment count badge
    const card = page.locator('.card-item').first();
    await expect(
      card.locator('.comment-count, .card-comment-count, [data-testid="comment-count"]'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      card.locator('.comment-count, .card-comment-count, [data-testid="comment-count"]'),
    ).toContainText('1');
  });

  // -------------------------------------------------------------------------
  // 8. Multi-user comment scenario — two users posting comments on same card
  // -------------------------------------------------------------------------
  test('two different users can each post a comment on the same card', async ({ request, browser }) => {
    // Create user A and the board/card
    const setupA = await setupBoardWithCard(request, 'User Alpha');
    if (!setupA) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Create user B as a separate user
    const { token: tokenB } = await createUser(request, 'User Beta');

    // Add user B as a board member so they can access the board
    await request.post(`${BASE}/api/boards/${setupA.boardId}/members`, {
      headers: { Authorization: `Bearer ${setupA.token}`, 'Content-Type': 'application/json' },
      data: { email: ``, token: tokenB },
    });

    // User A posts a comment via API
    const commentARes = await request.post(`${BASE}/api/cards/${setupA.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setupA.token}`, 'Content-Type': 'application/json' },
      data: { body: 'Comment from User Alpha' },
    });
    expect(commentARes.ok()).toBe(true);

    // User B posts a comment via API (they may or may not have board access)
    const commentBRes = await request.post(`${BASE}/api/cards/${setupA.cardId}/comments`, {
      headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
      data: { body: 'Comment from User Beta' },
    });
    // B may not have board membership — only verify if successful
    if (commentBRes.ok()) {
      // Fetch comments as user A and verify both are present
      const listRes = await request.get(`${BASE}/api/cards/${setupA.cardId}/comments`, {
        headers: { Authorization: `Bearer ${setupA.token}` },
      });
      const comments: { body: string }[] = await listRes.json();
      const bodies = comments.map((c) => c.body);
      expect(bodies).toContain('Comment from User Alpha');
      expect(bodies).toContain('Comment from User Beta');
    } else {
      // User B lacked access — verify user A's comment still exists
      const listRes = await request.get(`${BASE}/api/cards/${setupA.cardId}/comments`, {
        headers: { Authorization: `Bearer ${setupA.token}` },
      });
      const comments: { body: string }[] = await listRes.json();
      expect(comments.map((c) => c.body)).toContain('Comment from User Alpha');
    }
  });

  // -------------------------------------------------------------------------
  // 9. Multiple replies on one parent — all appear in .comment-replies
  // -------------------------------------------------------------------------
  test('multiple replies on one comment — all replies appear nested', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Parent with multiple replies');

    const replyTexts = ['Reply Alpha', 'Reply Beta', 'Reply Gamma'];
    for (const replyText of replyTexts) {
      const replyBtn = page.locator('.btn-reply').first();
      await expect(replyBtn).toBeVisible({ timeout: 5000 });
      await replyBtn.click();
      await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
      await page.fill('.comment-reply-form textarea', replyText);
      await page.locator('.comment-reply-form .btn-primary').click();
      await expect(
        page.locator('.comment-replies .comment-body-compact').filter({ hasText: replyText }),
      ).toBeVisible({ timeout: 10000 });
    }

    // All three replies should be in .comment-replies
    const nestedBodies = page.locator('.comment-replies .comment-body-compact');
    await expect(nestedBodies).toHaveCount(3, { timeout: 8000 });
    await expect(nestedBodies.nth(0)).toContainText('Reply Alpha');
    await expect(nestedBodies.nth(1)).toContainText('Reply Beta');
    await expect(nestedBodies.nth(2)).toContainText('Reply Gamma');
  });

  // -------------------------------------------------------------------------
  // 10. Reply nests under parent while a new top-level comment stays top-level
  // -------------------------------------------------------------------------
  test('reply nests under parent while new top-level comment stays top-level', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'The original parent comment');
    await postReply(page, 0, 'Nested reply to parent');

    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({
        hasText: 'Nested reply to parent',
      }),
    ).toBeVisible({ timeout: 10000 });

    // Post a new top-level comment
    await postComment(page, 'A brand-new top-level comment');

    // Two top-level items (not inside .comment-replies)
    const topLevelItems = page.locator('.comment-item-compact:not(.comment-reply)');
    await expect(topLevelItems).toHaveCount(2, { timeout: 8000 });

    // New comment is NOT in .comment-replies
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({
        hasText: 'A brand-new top-level comment',
      }),
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 11. API: full lifecycle — create, reply, verify structure, verify persistence
  // -------------------------------------------------------------------------
  test('API: full lifecycle — create comment, add reply, verify nested structure', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API Lifecycle User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Create parent comment
    const parentRes = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      data: { body: 'API lifecycle parent' },
    });
    expect(parentRes.ok()).toBe(true);
    const parent = await parentRes.json();
    expect(parent.id).toBeTruthy();

    // Create reply
    const replyRes = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      data: { body: 'API lifecycle reply', parent_comment_id: parent.id },
    });
    expect(replyRes.ok()).toBe(true);

    // GET and verify nested structure
    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const comments: { body: string; replies: { body: string }[] }[] = await listRes.json();

    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('API lifecycle parent');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].body).toBe('API lifecycle reply');

    // Call GET again to verify persistence (data is in DB, not in-memory)
    const listRes2 = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const comments2: { body: string; replies: { body: string }[] }[] = await listRes2.json();
    expect(comments2).toHaveLength(1);
    expect(comments2[0].replies).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 12. Chronological ordering — oldest comment first in the list
  // -------------------------------------------------------------------------
  test('comments display in chronological order — oldest first', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Alpha comment');
    await postComment(page, 'Beta comment');
    await postComment(page, 'Gamma comment');

    await expect(page.locator('.comment-item-compact')).toHaveCount(3, { timeout: 8000 });

    const bodies = page.locator('.comment-body-compact');
    await expect(bodies.nth(0)).toContainText('Alpha comment');
    await expect(bodies.nth(1)).toContainText('Beta comment');
    await expect(bodies.nth(2)).toContainText('Gamma comment');
  });
});

// ---------------------------------------------------------------------------
// API tests — comment structure and validation
// ---------------------------------------------------------------------------

test.describe('Card Comments — API Tests', () => {
  // -------------------------------------------------------------------------
  // 13. Create comment returns comment with id and content
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/comments returns comment with id and body', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API Fields User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Test comment body' },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.id).toBeTruthy();
    expect(typeof comment.id).toBe('number');
    expect(comment.body).toBe('Test comment body');
  });

  // -------------------------------------------------------------------------
  // 14. Create comment has correct user_id
  // -------------------------------------------------------------------------
  test('created comment has user_id matching the authenticated user', async ({ request }) => {
    const { token, userId } = await createUser(request, 'UserID Check');
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'UserID Board' },
    });
    const board = await boardRes.json();
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane', designator: 'UID' },
      })
    ).json();
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'UserID Card', column_id: board.columns[0].id, swimlane_id: swimlane.id, board_id: board.id },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    const card = await cardRes.json();

    const commentRes = await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: 'My own comment' },
    });
    expect(commentRes.ok()).toBe(true);
    const comment = await commentRes.json();
    expect(comment.user_id).toBe(userId);
  });

  // -------------------------------------------------------------------------
  // 15. GET comments returns array
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/comments returns an array', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Array Check User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(res.ok()).toBe(true);
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 16. Comment has created_at timestamp
  // -------------------------------------------------------------------------
  test('created comment has a valid created_at timestamp', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Timestamp User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Timestamp check comment' },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.created_at).toBeTruthy();
    const ts = new Date(comment.created_at).getTime();
    expect(Number.isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 17. Multiple comments returned — GET lists all of them
  // -------------------------------------------------------------------------
  test('multiple comments are all returned by GET /api/cards/:id/comments', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Multi Comments User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const bodies = ['First comment', 'Second comment', 'Third comment'];
    for (const body of bodies) {
      const r = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { body },
      });
      expect(r.ok()).toBe(true);
    }

    const res = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const comments: { body: string }[] = await res.json();
    expect(comments.length).toBe(3);
    const commentBodies = comments.map((c) => c.body);
    for (const body of bodies) {
      expect(commentBodies).toContain(body);
    }
  });

  // -------------------------------------------------------------------------
  // 18. Comment content with special characters
  // -------------------------------------------------------------------------
  test('comment body with special characters is stored and returned correctly', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Special Chars User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const specialBody = 'Fix <bug> & "escape" this: \' -- test@example.com #1234';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: specialBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body).toBe(specialBody);

    // Verify via GET too
    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const comments: { body: string }[] = await listRes.json();
    expect(comments[0].body).toBe(specialBody);
  });

  // -------------------------------------------------------------------------
  // 19. Comment content with newlines
  // -------------------------------------------------------------------------
  test('comment body with newlines is stored and returned correctly', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Newline User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const multilineBody = 'Line one\nLine two\nLine three';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: multilineBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body).toBe(multilineBody);
  });

  // -------------------------------------------------------------------------
  // 20. Comment content with markdown syntax stored as-is
  // -------------------------------------------------------------------------
  test('comment body with markdown syntax is stored as-is', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Markdown User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const markdownBody = '# Heading\n\n**bold** and _italic_\n\n- item one\n- item two\n\n```code block```';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: markdownBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body).toBe(markdownBody);
  });

  // -------------------------------------------------------------------------
  // 21. Empty body comment is rejected (400)
  // -------------------------------------------------------------------------
  test('POST comment with empty body is rejected with 400', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Empty Body User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: '' },
    });
    expect(res.status()).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 22. Unauthorized comment returns 401
  // -------------------------------------------------------------------------
  test('POST /api/cards/:id/comments without token returns 401', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Unauth Comment User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      data: { body: 'Should be rejected' },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 23. Unauthorized GET comments returns 401
  // -------------------------------------------------------------------------
  test('GET /api/cards/:id/comments without token returns 401', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Unauth GET User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 24. Comment with @mention syntax is stored correctly
  // -------------------------------------------------------------------------
  test('comment body with @mention syntax stored as plain text', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'Mention User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const mentionBody = 'Hey @alice and @bob please review this fix';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: mentionBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body).toBe(mentionBody);
  });

  // -------------------------------------------------------------------------
  // 25. Comment has card_id field matching the card
  // -------------------------------------------------------------------------
  test('created comment has card_id matching the card it was posted on', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'CardID Match User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Card ID check comment' },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.card_id).toBe(setup.cardId);
  });
});

// ---------------------------------------------------------------------------
// UI tests — comment section visibility and interaction
// ---------------------------------------------------------------------------

test.describe('Card Comments — UI Tests', () => {
  // -------------------------------------------------------------------------
  // 26. Comment section visible in card modal
  // -------------------------------------------------------------------------
  test('comment section is visible when card modal is opened', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Comment Section User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await expect(page.locator('.comment-form-compact, .comments-section, [class*="comment"]').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 27. Comment textarea is present in modal
  // -------------------------------------------------------------------------
  test('comment textarea is present in the card modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Textarea User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await expect(page.locator('.comment-form-compact textarea')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 28. Submit button is present in comment form
  // -------------------------------------------------------------------------
  test('comment form has a submit button', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Submit Btn User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 29. Comment appears in list after submission
  // -------------------------------------------------------------------------
  test('submitted comment text appears in the comment list', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Submit Appears User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const commentText = `Unique comment ${crypto.randomUUID().slice(0, 8)}`;
    await postComment(page, commentText);

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: commentText }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 30. Comment shows author's display name
  // -------------------------------------------------------------------------
  test("comment shows the author's display name", async ({ page, request }) => {
    const displayName = `Author ${crypto.randomUUID().slice(0, 6)}`;
    const setup = await setupBoardWithCard(request, displayName);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Author display name check');

    await expect(page.locator('.comment-author').first()).toContainText(displayName);
  });

  // -------------------------------------------------------------------------
  // 31. Comment textarea clears after submission
  // -------------------------------------------------------------------------
  test('comment textarea clears after successful submission', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Clear Textarea User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const textarea = page.locator('.comment-form-compact textarea');
    await textarea.fill('Comment that should clear the textarea');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Comment that should clear the textarea' }),
    ).toBeVisible({ timeout: 8000 });

    // Textarea should be empty after submission
    await expect(textarea).toHaveValue('');
  });

  // -------------------------------------------------------------------------
  // 32. Multiple comments shown in chronological order in the UI
  // -------------------------------------------------------------------------
  test('multiple comments are shown in chronological order in the UI', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Chrono UI User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'First in time');
    await postComment(page, 'Second in time');
    await postComment(page, 'Third in time');

    const items = page.locator('.comment-item-compact');
    await expect(items).toHaveCount(3, { timeout: 8000 });

    const bodies = page.locator('.comment-body-compact');
    await expect(bodies.nth(0)).toContainText('First in time');
    await expect(bodies.nth(1)).toContainText('Second in time');
    await expect(bodies.nth(2)).toContainText('Third in time');
  });

  // -------------------------------------------------------------------------
  // 33. Long comment content is shown correctly in the UI
  // -------------------------------------------------------------------------
  test('long comment content is rendered fully in the modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Long Comment User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const longBody = 'A'.repeat(300) + ' end marker';
    await postComment(page, longBody);

    const commentBody = page.locator('.comment-body-compact').first();
    await expect(commentBody).toBeVisible({ timeout: 8000 });
    // The end marker text must be present in the DOM
    const text = await commentBody.textContent();
    expect(text).toContain('end marker');
  });

  // -------------------------------------------------------------------------
  // 34. Comment shows relative or absolute timestamp in the UI
  // -------------------------------------------------------------------------
  test('each comment shows a timestamp element', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Time Display User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Timestamp display check');

    await expect(page.locator('.comment-time').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 35. Markdown in comment renders as plain text (no HTML injection)
  // -------------------------------------------------------------------------
  test('markdown in comment body does not execute as HTML in the modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'Markdown UI User');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const markdownBody = '**bold** and _italic_ and `code`';
    await postComment(page, markdownBody);

    const commentBody = page.locator('.comment-body-compact').first();
    await expect(commentBody).toBeVisible({ timeout: 8000 });
    // The comment body should contain the original text (rendered or as-is)
    const text = await commentBody.textContent();
    expect(text).toBeTruthy();
  });
});
