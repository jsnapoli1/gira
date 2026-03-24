import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Helper: create a fresh user, board, swimlane, and card via API.
 * Returns { token, boardId } and navigates to the board with the modal open.
 */
async function setupBoardWithCard(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  displayName = 'Commenter',
) {
  const email = `test-${crypto.randomUUID()}@test.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Comment Board' },
    })
  ).json();

  // Board creation returns columns directly on the board object
  const columns = board.columns;
  const columnId = columns[0].id;

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    })
  ).json();

  await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card',
      column_id: columnId,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);

  // Switch to All Cards view so card is visible without an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  // Open card detail modal
  await page.locator('.card-item').click();
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

  return { token, boardId: board.id };
}

/** Helper: post a comment via the UI and wait for it to appear */
async function postComment(page: Parameters<Parameters<typeof test>[1]>[0]['page'], text: string) {
  await page.fill('.comment-form-compact textarea', text);
  await page.click('.comment-form-compact button[type="submit"]');
  await expect(page.locator('.comment-body-compact').filter({ hasText: text })).toBeVisible({
    timeout: 8000,
  });
}

// ---------------------------------------------------------------------------
// Edit own comment
// ---------------------------------------------------------------------------
test('edit own comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
  test.fixme(
    true,
    'Edit comment button is not present in the current UI — no pencil/edit button on .comment-item-compact',
  );

  await setupBoardWithCard(request, page);
  await postComment(page, 'Original comment text');

  // Hover over the comment to reveal action buttons
  const commentItem = page.locator('.comment-item-compact').first();
  await commentItem.hover();

  // Click the edit (pencil) button
  const editBtn = commentItem.locator('.comment-actions button[title*="edit" i], .btn-edit, [aria-label*="edit" i]');
  await editBtn.click();

  // Change the text and save
  const editInput = page.locator('.comment-edit-input, .comment-item-compact textarea');
  await editInput.fill('Updated comment text');
  await page.click('.comment-item-compact button:has-text("Save"), .btn-save-comment');

  // Verify updated text
  await expect(page.locator('.comment-body-compact').first()).toContainText('Updated comment text');
  await expect(page.locator('.comment-body-compact').first()).not.toContainText('Original comment text');
});

// ---------------------------------------------------------------------------
// Delete own comment
// ---------------------------------------------------------------------------
test('delete own comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
  test.fixme(
    true,
    'Delete comment button is not present in the current UI — no delete button on .comment-item-compact',
  );

  await setupBoardWithCard(request, page);
  await postComment(page, 'Comment to be deleted');

  // Hover over the comment to reveal action buttons
  const commentItem = page.locator('.comment-item-compact').first();
  await commentItem.hover();

  // Accept the confirm dialog and click delete
  page.once('dialog', (d) => d.accept());
  const deleteBtn = commentItem.locator('.comment-actions button[title*="delete" i], .btn-delete-comment, [aria-label*="delete" i]');
  await deleteBtn.click();

  // Comment should be gone
  await expect(page.locator('.comment-body-compact').filter({ hasText: 'Comment to be deleted' })).not.toBeVisible({
    timeout: 5000,
  });
});

// ---------------------------------------------------------------------------
// Delete comment requires confirmation
// ---------------------------------------------------------------------------
test('delete comment requires confirm — NOT YET IMPLEMENTED', async ({ page, request }) => {
  test.fixme(
    true,
    'Delete comment button is not present in the current UI',
  );

  await setupBoardWithCard(request, page);
  await postComment(page, 'Should survive cancellation');

  const commentItem = page.locator('.comment-item-compact').first();
  await commentItem.hover();

  // Dismiss the confirm dialog (cancel)
  page.once('dialog', (d) => d.dismiss());
  const deleteBtn = commentItem.locator('.comment-actions button[title*="delete" i], .btn-delete-comment, [aria-label*="delete" i]');
  await deleteBtn.click();

  // Comment should still be visible
  await expect(page.locator('.comment-body-compact').filter({ hasText: 'Should survive cancellation' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Reply to a comment
// ---------------------------------------------------------------------------
test('reply to comment', async ({ page, request }) => {
  await setupBoardWithCard(request, page);
  await postComment(page, 'Parent comment for reply test');

  // Click Reply button on the first comment
  const replyBtn = page.locator('.btn-reply').first();
  await expect(replyBtn).toBeVisible({ timeout: 5000 });
  await replyBtn.click();

  // The inline reply form should appear
  await expect(page.locator('.comment-reply-form')).toBeVisible({ timeout: 5000 });

  // Type and submit the reply
  await page.fill('.comment-reply-form textarea', 'This is a reply');
  await page.click('.comment-reply-form .btn-primary');

  // Reply should appear in the thread
  await expect(
    page.locator('.comment-reply .comment-body-compact, .comment-replies .comment-body-compact').filter({ hasText: 'This is a reply' }),
  ).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// @mention dropdown appears
// ---------------------------------------------------------------------------
test('@mention dropdown appears when typing @', async ({ page, request }) => {
  await setupBoardWithCard(request, page);

  // Focus the comment textarea and type "@"
  const textarea = page.locator('.comment-form-compact textarea');
  await textarea.click();
  await textarea.pressSequentially('@');

  // The mention dropdown should appear
  await expect(page.locator('.mention-dropdown')).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// @mention inserts user into textarea
// ---------------------------------------------------------------------------
test('@mention inserts user display name into textarea', async ({ page, request }) => {
  await setupBoardWithCard(request, page, 'Commenter');

  const textarea = page.locator('.comment-form-compact textarea');
  await textarea.click();
  // Type "@Comm" — should match "Commenter"
  await textarea.pressSequentially('@Comm');

  // Wait for dropdown with a mention item matching the display name
  await expect(page.locator('.mention-dropdown')).toBeVisible({ timeout: 5000 });
  const mentionItem = page.locator('.mention-item').filter({ hasText: 'Commenter' });
  await expect(mentionItem).toBeVisible({ timeout: 5000 });

  // Click the suggestion
  await mentionItem.click();

  // The textarea should now contain the mention
  const value = await textarea.inputValue();
  expect(value).toContain('Commenter');
});

// ---------------------------------------------------------------------------
// Emoji in comment
// ---------------------------------------------------------------------------
test('emoji renders correctly in posted comment', async ({ page, request }) => {
  await setupBoardWithCard(request, page);

  const emojiText = 'Testing 🎉';
  await postComment(page, emojiText);

  // The comment body should render the emoji
  await expect(page.locator('.comment-body-compact').filter({ hasText: 'Testing 🎉' })).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Long comment renders without truncation
// ---------------------------------------------------------------------------
test('long comment renders in full without truncation', async ({ page, request }) => {
  await setupBoardWithCard(request, page);

  const longText =
    'This is a very long comment that contains many characters to test that the comment body renders in full without being truncated or causing a layout break in the comments section. It has well over two hundred characters.';

  await postComment(page, longText);

  const commentBody = page.locator('.comment-body-compact').filter({ hasText: longText.slice(0, 40) });
  await expect(commentBody).toBeVisible({ timeout: 5000 });

  // Verify the full text is present (not truncated)
  await expect(commentBody).toContainText(longText);
});

// ---------------------------------------------------------------------------
// Comment count indicator — NOT YET IMPLEMENTED
// ---------------------------------------------------------------------------
test('comment count indicator on card — NOT YET IMPLEMENTED', async ({ page, request }) => {
  test.fixme(
    true,
    'No comment count badge/indicator exists on card items (.card-item) in the current UI',
  );

  await setupBoardWithCard(request, page);
  await postComment(page, 'Count test comment');

  // Close the modal
  await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

  // A count badge should be visible on the card
  const card = page.locator('.card-item').first();
  await expect(card.locator('.comment-count, [data-testid="comment-count"], .card-comment-count')).toBeVisible();
  await expect(card.locator('.comment-count, [data-testid="comment-count"], .card-comment-count')).toContainText('1');
});

// ---------------------------------------------------------------------------
// Comment sort order — oldest first
// ---------------------------------------------------------------------------
test('comments appear in chronological order (oldest first)', async ({ page, request }) => {
  await setupBoardWithCard(request, page);

  // Post three comments in sequence
  await postComment(page, 'Alpha comment');
  await postComment(page, 'Beta comment');
  await postComment(page, 'Gamma comment');

  // All three should be present
  const bodies = page.locator('.comment-body-compact');
  await expect(bodies).toHaveCount(3, { timeout: 8000 });

  // Verify chronological (oldest first) ordering
  await expect(bodies.nth(0)).toContainText('Alpha comment');
  await expect(bodies.nth(1)).toContainText('Beta comment');
  await expect(bodies.nth(2)).toContainText('Gamma comment');
});
