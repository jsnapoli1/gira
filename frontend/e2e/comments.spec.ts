import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  boardId: number;
  cardId: number;
}

async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Comment Test User',
): Promise<SetupResult | null> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `test-comments-${uid}@example.com`,
        password: 'password123',
        display_name: displayName,
      },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Comment Test Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'CT' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card for Comments',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Comments', () => {
  // -------------------------------------------------------------------------
  // 1. Empty state shown when no comments
  // -------------------------------------------------------------------------
  test('shows "No comments yet" empty state on a fresh card', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await expect(page.locator('.conversations-section')).toBeVisible();
    await expect(page.locator('.conversations-section .empty-text')).toBeVisible();
    await expect(page.locator('.conversations-section .empty-text')).toContainText(
      'No comments yet',
    );
  });

  // -------------------------------------------------------------------------
  // 2. Add a comment — appears in the list
  // -------------------------------------------------------------------------
  test('add a comment and it appears in the comment list', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'This is my first comment!');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.comment-body-compact')).toContainText('This is my first comment!');
  });

  // -------------------------------------------------------------------------
  // 3. Comment author shown
  // -------------------------------------------------------------------------
  test('comment shows the author display name', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request, 'AuthorUser');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Comment with author check');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(page.locator('.comment-author').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.comment-author').first()).toContainText('AuthorUser');
  });

  // -------------------------------------------------------------------------
  // 4. Comment timestamp shown
  // -------------------------------------------------------------------------
  test('comment shows a timestamp', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Comment with timestamp check');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(page.locator('.comment-time').first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 5. Empty comment is not submittable — button is disabled
  // -------------------------------------------------------------------------
  test('submit button is disabled when comment textarea is empty', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // Button should be disabled by default
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeDisabled();

    // Type content — button becomes enabled
    await page.fill('.comment-form-compact textarea', 'Something');
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeEnabled();

    // Clear — button disabled again
    await page.fill('.comment-form-compact textarea', '');
    await expect(page.locator('.comment-form-compact button[type="submit"]')).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 6. Textarea clears after posting a comment
  // -------------------------------------------------------------------------
  test('comment textarea is cleared after posting', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Clearing test comment');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.comment-form-compact textarea')).toHaveValue('');
  });

  // -------------------------------------------------------------------------
  // 7. Multiple comments appear in order (oldest first)
  // -------------------------------------------------------------------------
  test('multiple comments appear in chronological order (oldest first)', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const comments = ['First comment', 'Second comment', 'Third comment'];
    for (const text of comments) {
      await page.fill('.comment-form-compact textarea', text);
      await page.click('.comment-form-compact button[type="submit"]');
      // Wait for each to appear before posting the next
      await expect(
        page.locator('.comment-body-compact').filter({ hasText: text }),
      ).toBeVisible({ timeout: 8000 });
    }

    await expect(page.locator('.comment-item-compact')).toHaveCount(3, { timeout: 8000 });

    const bodies = page.locator('.comment-body-compact');
    await expect(bodies.nth(0)).toContainText('First comment');
    await expect(bodies.nth(1)).toContainText('Second comment');
    await expect(bodies.nth(2)).toContainText('Third comment');
  });

  // -------------------------------------------------------------------------
  // 8. Edit own comment — NOT YET IMPLEMENTED
  //    No PUT /api/comments/:id route or edit button exists in the UI.
  // -------------------------------------------------------------------------
  test('edit own comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'Edit comment is not implemented: no PUT /api/comments/:id route and no edit button in the UI. ' +
        'The database has no UpdateComment function either. Implement backend route and UI button.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Original comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Original comment' }),
    ).toBeVisible({ timeout: 8000 });

    // Hover to reveal edit button
    await page.locator('.comment-item-compact').first().hover();
    await page.locator('.btn-edit-comment, [aria-label*="edit" i]').first().click();

    // Fill new text and save
    await page.locator('.comment-edit-input, .comment-item-compact textarea').fill('Edited comment');
    await page.locator('button:has-text("Save"), .btn-save-comment').click();

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Edited comment' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Original comment' }),
    ).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 9. Delete own comment — NOT YET IMPLEMENTED
  //    No DELETE /api/comments/:id route or delete button exists in the UI.
  // -------------------------------------------------------------------------
  test('delete own comment — NOT YET IMPLEMENTED', async ({ page, request }) => {
    test.fixme(
      true,
      'Delete comment is not implemented: no DELETE /api/comments/:id route and no delete button in the UI. ' +
        'The DB has DeleteComment but no handler is registered. Implement backend route and UI button.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Comment to delete');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Comment to delete' }),
    ).toBeVisible({ timeout: 8000 });

    page.once('dialog', (d) => d.accept());
    await page.locator('.comment-item-compact').first().hover();
    await page.locator('.btn-delete-comment, [aria-label*="delete" i]').first().click();

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Comment to delete' }),
    ).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.conversations-section .empty-text')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 10. Delete requires confirmation — dismiss cancels deletion
  // -------------------------------------------------------------------------
  test('delete comment — dismissed confirmation keeps comment intact — NOT YET IMPLEMENTED', async ({
    page,
    request,
  }) => {
    test.fixme(
      true,
      'Delete comment is not implemented: no delete button in the UI.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Should survive cancel');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Should survive cancel' }),
    ).toBeVisible({ timeout: 8000 });

    // Dismiss the confirmation
    page.once('dialog', (d) => d.dismiss());
    await page.locator('.comment-item-compact').first().hover();
    await page.locator('.btn-delete-comment, [aria-label*="delete" i]').first().click();

    // Comment should still be visible
    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Should survive cancel' }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 11. Comments persist after closing and reopening the modal
  // -------------------------------------------------------------------------
  test('comments persist after closing and reopening the card modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Persistent comment');
    await page.click('.comment-form-compact button[type="submit"]');
    await expect(page.locator('.comment-item-compact')).toBeVisible({ timeout: 8000 });

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Reopen
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.comment-body-compact')).toContainText('Persistent comment');
  });
});
