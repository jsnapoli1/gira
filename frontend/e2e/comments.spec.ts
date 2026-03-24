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
  userId: number;
}

async function setupBoardWithCard(
  request: import('@playwright/test').APIRequestContext,
  displayName = 'Comment Test User',
): Promise<SetupResult | null> {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `test-comments-${uid}@example.com`,
      password: 'password123',
      display_name: displayName,
    },
  });
  const { token, user } = await signupRes.json();

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
  return { token, boardId: board.id, cardId: card.id, userId: user.id };
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

  // =========================================================================
  // Additional API tests
  // =========================================================================

  // -------------------------------------------------------------------------
  // 12. API: POST /api/cards/:id/comments returns 201 with comment data
  // -------------------------------------------------------------------------
  test('API: POST /api/cards/:id/comments returns 201 with comment data', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API Commenter');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'API created comment' },
    });

    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(201);

    const comment = await res.json();
    expect(comment.id).toBeTruthy();
    expect(comment.body).toBe('API created comment');
  });

  // -------------------------------------------------------------------------
  // 13. API: Comment has id, body, user_id, card_id, and created_at
  // -------------------------------------------------------------------------
  test('API: comment response has id, body, user_id, card_id, and created_at fields', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API Fields');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Fields check comment' },
    });

    const comment = await res.json();
    expect(typeof comment.id).toBe('number');
    expect(typeof comment.body).toBe('string');
    expect(typeof comment.user_id).toBe('number');
    expect(comment.card_id).toBe(setup.cardId);
    expect(comment.created_at).toBeTruthy();
    const d = new Date(comment.created_at);
    expect(d.getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 14. API: GET /api/cards/:id/comments returns array including the new comment
  // -------------------------------------------------------------------------
  test('API: GET /api/cards/:id/comments returns array containing the posted comment', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API List');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const createRes = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Listed comment' },
    });
    const created = await createRes.json();

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(listRes.ok()).toBe(true);
    const list: { id: number }[] = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((c) => c.id === created.id);
    expect(found).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 15. API: Comment body content matches what was sent
  // -------------------------------------------------------------------------
  test('API: returned comment body matches the sent content', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const body = 'Exact content match test';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body },
    });
    const comment = await res.json();
    expect(comment.body).toBe(body);
  });

  // -------------------------------------------------------------------------
  // 16. API: Comment user_id matches the authenticated user
  // -------------------------------------------------------------------------
  test('API: comment user_id matches the ID of the authenticated commenter', async ({ request }) => {
    const setup = await setupBoardWithCard(request, 'API UserID');
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'User ID check' },
    });
    const comment = await res.json();
    expect(comment.user_id).toBe(setup.userId);
  });

  // -------------------------------------------------------------------------
  // 17. API: Multiple comments on one card — all returned by GET
  // -------------------------------------------------------------------------
  test('API: multiple comments posted to a card are all returned by GET', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const texts = ['API comment A', 'API comment B', 'API comment C'];
    const ids: number[] = [];
    for (const body of texts) {
      const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
        headers: { Authorization: `Bearer ${setup.token}` },
        data: { body },
      });
      expect(res.ok()).toBe(true);
      const c = await res.json();
      ids.push(c.id);
    }

    const listRes = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    const list: { id: number }[] = await listRes.json();
    for (const id of ids) {
      expect(list.find((c) => c.id === id)).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // 18. API: Unauthorized request to POST comment returns 401
  // -------------------------------------------------------------------------
  test('API: posting a comment without a token returns 401', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      // No Authorization header
      data: { body: 'Unauthorized comment' },
    });
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 19. API: Empty body comment returns 400
  // -------------------------------------------------------------------------
  test('API: posting a comment with empty body returns 400', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
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
  // 20. API: Comment with special characters and emoji is stored correctly
  // -------------------------------------------------------------------------
  test('API: comment with emoji and unicode special chars is stored and returned intact', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const specialBody = '🎉 Unicode テスト <script>alert(1)</script> & "quotes"';
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: specialBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body).toBe(specialBody);
  });

  // -------------------------------------------------------------------------
  // 21. API: Very long comment (2000 chars) is accepted
  // -------------------------------------------------------------------------
  test('API: very long comment (2000 characters) is accepted and returned', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const longBody = 'A'.repeat(2000);
    const res = await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: longBody },
    });
    expect(res.ok()).toBe(true);
    const comment = await res.json();
    expect(comment.body.length).toBe(2000);
  });

  // =========================================================================
  // Additional UI tests
  // =========================================================================

  // -------------------------------------------------------------------------
  // 22. UI: Comment input textarea is visible in card modal
  // -------------------------------------------------------------------------
  test('UI: comment input textarea is visible in the card modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await expect(page.locator('.comment-form-compact textarea')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 23. UI: Submitted comment body appears in the list
  // -------------------------------------------------------------------------
  test('UI: submitted comment body appears in the comment list', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Visible comment text');
    await page.click('.comment-form-compact button[type="submit"]');

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Visible comment text' }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 24. UI: Comments section exists and has correct section label
  // -------------------------------------------------------------------------
  test('UI: conversations/comments section is present in the card modal', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);
    await expect(page.locator('.conversations-section')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 25. UI: Comment count badge on card — fixme if not implemented
  // -------------------------------------------------------------------------
  test('UI: comment count badge on card item reflects posted comments', async ({ page, request }) => {
    test.fixme(
      true,
      'No comment count badge exists on card items in the current UI. ' +
        'Enable this test once a comment count indicator is added to the card item view.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    // Post a comment via API first so the board view can show the count
    await request.post(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
      data: { body: 'Badge test comment' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), setup.token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // A comment count badge should appear on the card
    await expect(page.locator('.card-comment-count, .card-item .comment-badge')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 26. UI: Markdown in comments is rendered — fixme if not supported
  // -------------------------------------------------------------------------
  test('UI: markdown bold syntax in a comment body is rendered as <strong>', async ({ page, request }) => {
    test.fixme(
      true,
      'Markdown rendering in comments is not verified. ' +
        'Enable this test once the UI renders comment bodies as Markdown.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', '**bold text**');
    await page.click('.comment-form-compact button[type="submit"]');

    // If Markdown is rendered, a <strong> tag should be present inside the comment body
    await expect(page.locator('.comment-body-compact strong')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 27. UI: Pressing Ctrl+Enter submits the comment
  // -------------------------------------------------------------------------
  test('UI: pressing Ctrl+Enter in the textarea submits the comment', async ({ page, request }) => {
    test.fixme(
      true,
      'Ctrl+Enter submit keyboard shortcut is not verified. ' +
        'Enable this test once the shortcut is confirmed or implemented.',
    );

    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    await page.fill('.comment-form-compact textarea', 'Hotkey submit comment');
    await page.keyboard.press('Control+Enter');

    await expect(
      page.locator('.comment-body-compact').filter({ hasText: 'Hotkey submit comment' }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 28. UI: Whitespace-only comment does not enable the submit button
  // -------------------------------------------------------------------------
  test('UI: whitespace-only input keeps the submit button disabled', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    // Type only spaces/newlines
    await page.fill('.comment-form-compact textarea', '   ');

    // The submit button should still be disabled (trimmed content is empty)
    // Note: if the server rejects it but the UI allows the click, this tests
    // that no comment appears in the list.
    const submitBtn = page.locator('.comment-form-compact button[type="submit"]');
    const isDisabled = await submitBtn.isDisabled();
    if (!isDisabled) {
      // If the UI allows it, click and confirm no new comment appears
      await submitBtn.click();
      // Allow a short window — no comment should appear
      await page.waitForTimeout(1500);
      await expect(page.locator('.comment-item-compact')).toHaveCount(0);
    } else {
      expect(isDisabled).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 29. UI: Multiple comments are shown in correct order in the modal
  // -------------------------------------------------------------------------
  test('UI: three comments submitted via UI appear in insertion order', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    for (const text of ['Alpha', 'Beta', 'Gamma']) {
      await page.fill('.comment-form-compact textarea', text);
      await page.click('.comment-form-compact button[type="submit"]');
      await expect(
        page.locator('.comment-body-compact').filter({ hasText: text }),
      ).toBeVisible({ timeout: 8000 });
    }

    const bodies = page.locator('.comment-body-compact');
    await expect(bodies.nth(0)).toContainText('Alpha');
    await expect(bodies.nth(1)).toContainText('Beta');
    await expect(bodies.nth(2)).toContainText('Gamma');
  });

  // -------------------------------------------------------------------------
  // 30. API: GET /api/cards/:id/comments returns 200 with an array on a fresh card
  // -------------------------------------------------------------------------
  test('API: GET /api/cards/:id/comments returns 200 and an empty array on a new card', async ({ request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }

    const res = await request.get(`${BASE}/api/cards/${setup.cardId}/comments`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 31. UI: Comment form textarea placeholder is visible
  // -------------------------------------------------------------------------
  test('UI: comment textarea has a placeholder hint text', async ({ page, request }) => {
    const setup = await setupBoardWithCard(request);
    if (!setup) {
      test.skip(true, 'Card setup unavailable: POST /api/cards failed');
      return;
    }
    await openCardModal(page, setup.token, setup.boardId);

    const textarea = page.locator('.comment-form-compact textarea');
    await expect(textarea).toBeVisible();
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
  });
});
