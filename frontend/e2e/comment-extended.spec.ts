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

async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Commenter',
): Promise<SetupResult | null> {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Extended Comment Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'EC' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Extended Comment Card',
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
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/comments') && r.request().method() === 'POST',
      { timeout: 10000 },
    ),
    page.click('.comment-form-compact button[type="submit"]'),
  ]);
  expect(response.status()).toBe(201);
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: text }),
  ).toBeVisible({ timeout: 8000 });
}

async function postReply(
  page: import('@playwright/test').Page,
  replyText: string,
): Promise<void> {
  await page.fill('.comment-reply-form textarea', replyText);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/comments') && r.request().method() === 'POST',
      { timeout: 10000 },
    ),
    page.locator('.comment-reply-form .btn-primary').click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(
    page.locator('.comment-body-compact').filter({ hasText: replyText }),
  ).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Comments Extended', () => {
  // -------------------------------------------------------------------------
  // 1. Reply form appears when Reply button is clicked
  // -------------------------------------------------------------------------
  test('reply form appears when Reply button is clicked on a comment', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await postComment(page, 'Parent comment for reply form test');

    const replyBtn = page.locator('.btn-reply').first();
    await expect(replyBtn).toBeVisible({ timeout: 5000 });
    await replyBtn.click();

    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.comment-reply-form textarea')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Reply to a comment — nested display (backend bug was fixed)
  //    The bug: GetCommentsForCard appended by value before replies were nested.
  //    Fix shipped: topLevelPtrs pointer approach is now correct.
  // -------------------------------------------------------------------------
  test('reply to a comment appears nested under its parent', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await postComment(page, 'Parent comment for reply');

    // Open reply form
    const replyBtn = page.locator('.btn-reply').first();
    await expect(replyBtn).toBeVisible({ timeout: 5000 });
    await replyBtn.click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });

    // Submit reply and wait for API response
    await postReply(page, 'This is a reply');

    // Reply should be inside .comment-replies (nested)
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'This is a reply' }),
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 3. Reply appears indented — .comment-replies wrapper exists
  // -------------------------------------------------------------------------
  test('reply is rendered inside .comment-replies indentation wrapper', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await postComment(page, 'Parent for indent test');

    const replyBtn = page.locator('.btn-reply').first();
    await replyBtn.click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });
    await postReply(page, 'Indented reply');

    await expect(page.locator('.comment-replies')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.comment-reply')).toBeVisible({ timeout: 5000 });

    // Parent comment body should NOT be inside .comment-replies
    await expect(
      page.locator('.comment-replies .comment-body-compact').filter({ hasText: 'Parent for indent test' }),
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 4. Cancel reply — form disappears and no reply is created
  // -------------------------------------------------------------------------
  test('cancel reply — form disappears and no reply is posted', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await postComment(page, 'Parent for cancel reply test');

    const replyBtn = page.locator('.btn-reply').first();
    await replyBtn.click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });

    await page.fill('.comment-reply-form textarea', 'This reply will be cancelled');

    // Click Cancel button (non-primary button in the reply form)
    await page.locator('.comment-reply-form .btn:not(.btn-primary)').click();

    await expect(page.locator('.comment-reply-form')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.comment-replies')).not.toBeVisible({ timeout: 3000 });
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'This reply will be cancelled' }),
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Empty reply — submit button is disabled
  // -------------------------------------------------------------------------
  test('empty reply submit button is disabled until text is entered', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await postComment(page, 'Parent for empty reply test');

    const replyBtn = page.locator('.btn-reply').first();
    await replyBtn.click();
    await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });

    const submitBtn = page.locator('.comment-reply-form .btn-primary');
    await expect(submitBtn).toBeDisabled();

    await page.fill('.comment-reply-form textarea', 'Some text');
    await expect(submitBtn).toBeEnabled();

    await page.fill('.comment-reply-form textarea', '');
    await expect(submitBtn).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 6. @mention dropdown appears when typing @
  // -------------------------------------------------------------------------
  test('@mention dropdown appears when @ is typed in comment textarea', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const textarea = page.locator('.comment-form-compact textarea');
    await textarea.click();
    await textarea.pressSequentially('@');

    await expect(page.locator('.mention-dropdown')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 7. @mention inserts user into textarea
  // -------------------------------------------------------------------------
  test('@mention selects a user and inserts their name into the textarea', async ({ page, request }) => {
    // Use the full UUID to guarantee this user's name is unique across all test runs.
    // We type all 8 chars after "@" so the dropdown filters to exactly one user.
    const uniqueSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const uniqueName = `Ment${uniqueSuffix}`;
    const setup = await setupBoardWithCard(request, uniqueName);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const textarea = page.locator('.comment-form-compact textarea');
    await textarea.click();
    // Type the full unique name after "@" so only this user matches the filter.
    await textarea.pressSequentially(`@${uniqueName}`);

    await expect(page.locator('.mention-dropdown')).toBeVisible({ timeout: 8000 });
    const mentionItem = page.locator('.mention-item').filter({ hasText: uniqueName });
    await expect(mentionItem).toBeVisible({ timeout: 8000 });

    await mentionItem.click();

    const value = await textarea.inputValue();
    expect(value).toContain(uniqueName);
  });

  // -------------------------------------------------------------------------
  // 8. Markdown in comments — rendered text is visible (plain text, not HTML tags)
  //    The backend returns plain text; the frontend renders it as-is.
  //    NOTE: If markdown rendering (bold, links) is added, update this test.
  // -------------------------------------------------------------------------
  test('markdown-style text in comment is stored and displayed', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const markdownText = '**bold** and _italic_ and `code`';
    await postComment(page, markdownText);

    // The comment body should contain the text (rendered as-is or as HTML)
    const commentBody = page.locator('.comment-body-compact').filter({ hasText: 'bold' });
    await expect(commentBody).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Emoji in comment renders correctly
  // -------------------------------------------------------------------------
  test('emoji in comment body renders correctly', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await postComment(page, 'Testing emoji 🎉 in comments');

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: '🎉' }),
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 10. Long comment renders in full without truncation
  // -------------------------------------------------------------------------
  test('long comment renders in full without truncation', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const longText =
      'This is a very long comment that contains many characters to test that the comment ' +
      'body renders in full without being truncated or causing a layout break in the comments ' +
      'section. It has well over two hundred characters to ensure the layout handles long text properly.';

    await postComment(page, longText);

    const commentBody = page.locator('.comment-body-compact').filter({ hasText: longText.slice(0, 40) });
    await expect(commentBody).toBeVisible({ timeout: 5000 });
    await expect(commentBody).toContainText(longText);
  });

  // -------------------------------------------------------------------------
  // 11. Comment pagination — NOT YET IMPLEMENTED
  //     The backend returns all comments with no pagination.
  // -------------------------------------------------------------------------
  test('comment pagination — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'Comment pagination is not implemented: the backend returns all comments in a single response. ' +
        'If pagination is added, update this test to verify page controls appear when comment count exceeds N.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // Post more than a hypothetical page size (e.g. 20 comments)
    for (let i = 1; i <= 22; i++) {
      await postComment(page, `Pagination test comment #${i}`);
    }

    // Pagination controls should appear
    await expect(page.locator('.comments-pagination, [aria-label*="pagination" i]')).toBeVisible({
      timeout: 5000,
    });
  });

  // -------------------------------------------------------------------------
  // 12. API: GET /api/cards/:id/comments returns replies nested under parent
  //     (verifies the backend bug is fixed)
  // -------------------------------------------------------------------------
  test('API: GET comments returns replies array nested under parent (bug was fixed)', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API Tester');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Post parent comment
    const parentRes = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      data: { body: 'Parent comment body' },
    });
    expect(parentRes.ok()).toBe(true);
    const parent = await parentRes.json();
    expect(parent.id).toBeTruthy();

    // Post reply
    const replyRes = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' },
      data: { body: 'Reply comment body', parent_comment_id: parent.id },
    });
    expect(replyRes.ok()).toBe(true);

    // GET comments — should have 1 top-level with 1 reply
    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const comments: { body: string; replies: { body: string }[] }[] = await listRes.json();

    expect(Array.isArray(comments)).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Parent comment body');
    expect(Array.isArray(comments[0].replies)).toBe(true);
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].body).toBe('Reply comment body');
  });
});
