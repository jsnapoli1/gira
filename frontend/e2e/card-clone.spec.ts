/**
 * card-clone.spec.ts — Card duplication/cloning tests
 *
 * FEATURE STATUS: NOT IMPLEMENTED
 *
 * Investigation findings (2026-03-24):
 *
 * Backend:
 *   - No `POST /api/cards/:id/duplicate` route exists in internal/server/server.go.
 *   - The routes registered for /api/cards/{id} are: GET, PUT, DELETE, and sub-routes
 *     for move, move-state, reorder, assign-sprint, assignees, comments, labels,
 *     attachments, custom-fields, worklogs, children, links, activity, and watchers.
 *     No "duplicate" or "clone" sub-route is present.
 *   - The word "duplicate" appears in card_handlers.go only in a Gitea import helper
 *     (duplicate-detection logic during CSV import) and in models/models.go as a
 *     CardLink type constant ("duplicates"), not as an endpoint.
 *
 * Frontend:
 *   - No "Duplicate", "Clone", or "Copy" button exists in CardDetailModal.tsx or
 *     BoardView.tsx.
 *   - The string "duplicates" appears only as a card-link relationship type label,
 *     not as a UI action.
 *
 * All tests are marked test.fixme() pending implementation of the feature.
 * When implemented, remove test.fixme() and fill in the expected selectors /
 * response shapes documented in the comments below.
 *
 * Expected implementation contract:
 *   Endpoint: POST /api/cards/:id/duplicate
 *   Success status: 201 Created
 *   Response body: the newly created card object (same shape as POST /api/cards response)
 *   Copies: title (+ "(copy)" or "(Clone)" suffix), description, priority, story_points,
 *            issue_type, due_date, labels (TBD), column_id, swimlane_id, board_id
 *   Does NOT copy: assignees, worklogs, comments, attachments, watchers, children links
 *   Does NOT copy: sprint_id (clone starts unassigned)
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function setupBoardWithCard(request: any) {
  const email = `test-clone-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Clone Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Clone Test Board' },
    })
  ).json();

  const columns: any[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Clone Swimlane', designator: 'CL-', color: '#4CAF50' },
    })
  ).json();

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Original Card',
      description: 'This is the original description',
      priority: 'high',
      story_points: 5,
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  const card = cardRes.ok() ? await cardRes.json() : null;

  return { token, board, card, columns, swimlane, cardCreated: cardRes.ok() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Card Cloning / Duplication', () => {
  /**
   * Clone card from modal — clone appears in same column with title suffix.
   *
   * Implementation notes:
   *   - A "Duplicate" or "Clone" button should exist in the .card-detail-actions area
   *     of CardDetailModal.tsx.
   *   - Clicking it should call POST /api/cards/:id/duplicate.
   *   - The response should include the new card object.
   *   - The new card should appear immediately in the same column via SSE or optimistic
   *     update.
   *   - The new card's title should be the original title with a "(copy)" suffix (or
   *     similar — match the actual backend convention).
   */
  test.fixme('clone card from modal — resulting clone has same title with copy suffix', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the card modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click the clone/duplicate button
    // TODO: replace with the actual selector once the button is implemented
    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);

    expect(response.status()).toBe(201);

    // Two cards should now be visible (original + clone)
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // The cloned card title should include the original title with a copy marker
    await expect(page.locator('.card-item h4:has-text("Original Card")')).toHaveCount(2, { timeout: 5000 });
    // OR, if the backend appends "(copy)":
    // await expect(page.locator('.card-item h4:has-text("Original Card (copy")')).toBeVisible();
  });

  /**
   * Clone preserves description, priority, and story points.
   *
   * Implementation notes:
   *   - POST /api/cards/:id/duplicate should copy title, description, priority,
   *     story_points, issue_type, and due_date from the source card.
   *   - Open the cloned card's modal and verify these fields match the original.
   */
  test.fixme('clone preserves description, priority, and story points', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open original card modal and trigger duplication
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.waitForResponse(
      (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
    );
    await page.click('.card-detail-actions button:has-text("Duplicate")');
    await page.click('.modal-close-btn');

    // Open the cloned card (the second one)
    const cloneItem = page.locator('.card-item').nth(1);
    await cloneItem.click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Verify description, priority, and story points are copied
    await expect(page.locator('.card-detail-description, .card-detail-body')).toContainText(
      'This is the original description',
      { timeout: 5000 }
    );
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high');
    await expect(page.locator('.card-detail-meta .card-points')).toContainText('5 pts');
  });

  /**
   * Clone does NOT copy assignees — the cloned card starts with no assignees.
   *
   * Implementation notes:
   *   - The duplicate endpoint should intentionally NOT copy card_assignees rows.
   *   - Verify via GET /api/cards/:cloneId/assignees that the list is empty, or
   *     verify the assignee section in the modal shows no assignees.
   */
  test.fixme('clone does NOT copy assignees — cloned card has empty assignee list', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request);

    // Add an assignee to the original card via API
    const me = await (
      await request.get(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: me.id },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the original card and clone it
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const [dupResponse] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);

    const clonedCard = await dupResponse.json();
    await page.click('.modal-close-btn');

    // Verify the cloned card has no assignees via API
    const assignees: any[] = await (
      await request.get(`${BASE}/api/cards/${clonedCard.id}/assignees`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(assignees).toHaveLength(0);
  });

  /**
   * Clone appears in the same column as the original.
   *
   * Implementation notes:
   *   - POST /api/cards/:id/duplicate should set column_id, swimlane_id, and
   *     board_id to the same values as the source card.
   *   - Both the original and the cloned card should be visible under the same
   *     column heading in the board view.
   */
  test.fixme('clone appears in same column as the original card', async ({ page, request }) => {
    const { token, board, columns } = await setupBoardWithCard(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open original card and clone it
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.waitForResponse(
      (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
    );
    await page.click('.card-detail-actions button:has-text("Duplicate")');
    await page.click('.modal-close-btn');

    // Locate the first column on the board (columns[0] is the first column)
    // Both cards should be nested inside that column container.
    // The column header text is typically the column name; replace 'To Do' with
    // whatever the default first-column name is.
    const firstColumn = page.locator('.board-column').first();
    await expect(firstColumn.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });

  /**
   * API: clone card returns new card with different ID.
   *
   * Implementation notes:
   *   - The response from POST /api/cards/:id/duplicate must include a new `id`
   *     that differs from the source card's ID.
   */
  test.fixme('API: clone card returns new card with a different ID', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const cloned = await res.json();
    expect(cloned.id).toBeDefined();
    expect(cloned.id).not.toBe(card.id);
  });

  /**
   * API: cloned card has same title (with optional copy suffix).
   *
   * Implementation notes:
   *   - The title of the cloned card should match the original's title, possibly
   *     with a suffix such as " (copy)" or " (Clone)".
   *   - Use `toContain` rather than exact match so either convention passes.
   */
  test.fixme('API: cloned card title contains the original card title', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const cloned = await res.json();
    expect(cloned.title).toContain('Original Card');
  });

  /**
   * API: cloned card has same description.
   *
   * Implementation notes:
   *   - `description` should be copied verbatim from the source card.
   */
  test.fixme('API: cloned card has same description as original', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const cloned = await res.json();

    // Verify via GET to avoid relying solely on the creation response
    const getRes = await request.get(`${BASE}/api/cards/${cloned.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.ok()).toBe(true);
    const fetched = await getRes.json();
    expect(fetched.description).toBe('This is the original description');
  });

  /**
   * API: cloned card is in the same column as the original.
   *
   * Implementation notes:
   *   - `column_id` should match the source card's column_id.
   */
  test.fixme('API: cloned card is in the same column as the original', async ({ request }) => {
    const { token, card, columns, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const cloned = await res.json();

    expect(cloned.column_id).toBe(columns[0].id);
  });

  /**
   * API: cloned card is in the same swimlane as the original.
   *
   * Implementation notes:
   *   - `swimlane_id` should match the source card's swimlane_id.
   */
  test.fixme('API: cloned card is in the same swimlane as the original', async ({ request }) => {
    const { token, card, swimlane, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const cloned = await res.json();

    expect(cloned.swimlane_id).toBe(swimlane.id);
  });

  /**
   * API: cloned card does NOT copy assignees.
   *
   * Implementation notes:
   *   - Even if the source card has assignees, the duplicate should have none.
   *   - Verify via GET /api/cards/:cloneId/assignees.
   */
  test.fixme('API: cloned card does NOT copy assignees — assignee list is empty', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    // Assign current user to original card
    const me = await (
      await request.get(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: me.id },
    });

    // Clone
    const cloneRes = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cloneRes.status()).toBe(201);
    const cloned = await cloneRes.json();

    // Verify clone has no assignees
    const assigneeRes = await request.get(`${BASE}/api/cards/${cloned.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(assigneeRes.ok()).toBe(true);
    const assignees = await assigneeRes.json();
    expect(Array.isArray(assignees)).toBe(true);
    expect(assignees).toHaveLength(0);
  });

  /**
   * API: cloned card does NOT copy worklogs.
   *
   * Implementation notes:
   *   - Even if the source card has time-tracking entries, the duplicate should have none.
   *   - Verify via GET /api/cards/:cloneId/worklogs (or similar endpoint).
   */
  test.fixme('API: cloned card does NOT copy worklogs', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone API test');
      return;
    }

    // Add a worklog to the original card
    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 3600, description: 'Worked on original' },
    });

    // Clone
    const cloneRes = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cloneRes.status()).toBe(201);
    const cloned = await cloneRes.json();

    // Verify clone has no worklogs
    const worklogRes = await request.get(`${BASE}/api/cards/${cloned.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(worklogRes.ok()).toBe(true);
    const worklogs = await worklogRes.json();
    expect(Array.isArray(worklogs)).toBe(true);
    expect(worklogs).toHaveLength(0);
  });

  /**
   * API: cloning a non-existent card returns 404.
   *
   * Implementation notes:
   *   - POST /api/cards/99999999/duplicate should return 404 Not Found.
   */
  test.fixme('API: clone nonexistent card returns 404', async ({ request }) => {
    const email = `test-clone-404-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Clone 404 Tester' },
      })
    ).json();

    const res = await request.post(`${BASE}/api/cards/99999999/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  /**
   * API: unauthenticated clone request returns 401.
   *
   * Implementation notes:
   *   - POST /api/cards/:id/duplicate without a token should return 401.
   */
  test.fixme('API: unauthenticated clone request returns 401', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping unauthenticated clone test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`);
    expect(res.status()).toBe(401);
  });

  /**
   * UI: clone button is visible in card detail modal.
   *
   * Implementation notes:
   *   - A button with text "Duplicate", "Clone", or "Copy" should exist in the
   *     card detail modal's action area (.card-detail-actions or equivalent).
   */
  test.fixme('UI: clone button visible in card detail modal', async ({ page, request }) => {
    const { token, board, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI clone test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // A duplicate/clone/copy button should be visible
    const cloneBtn = page.locator(
      '.card-detail-actions button:has-text("Duplicate"), ' +
      '.card-detail-actions button:has-text("Clone"), ' +
      '.card-detail-actions button:has-text("Copy")'
    );
    await expect(cloneBtn).toBeVisible({ timeout: 5000 });
  });

  /**
   * UI: clicking clone creates a new card.
   *
   * Implementation notes:
   *   - After clicking "Duplicate", an API call to POST /api/cards/:id/duplicate
   *     should succeed and produce a second card in the board view.
   */
  test.fixme('UI: clicking clone creates a new card in the board', async ({ page, request }) => {
    const { token, board, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI clone test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open card and duplicate
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const [dupeResp] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click(
        '.card-detail-actions button:has-text("Duplicate"), ' +
        '.card-detail-actions button:has-text("Clone")'
      ),
    ]);

    expect(dupeResp.status()).toBe(201);

    // After closing modal, there should be 2 cards
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });

  /**
   * UI: cloned card appears in the same column.
   *
   * Implementation notes:
   *   - Both cards should be in the same .board-column container.
   *   - The column should reflect count = 2 after the clone.
   */
  test.fixme('UI: cloned card appears in same column as the original', async ({ page, request }) => {
    const { token, board, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI clone test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);
    await page.click('.modal-close-btn');

    const firstColumn = page.locator('.board-column').first();
    await expect(firstColumn.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });

  /**
   * UI: cloned card title shows a copy suffix or the original title.
   *
   * Implementation notes:
   *   - After duplication, the new card item on the board should show the original
   *     title (possibly with "(copy)" appended). At minimum it contains the original
   *     title text.
   */
  test.fixme('UI: cloned card title contains the original title text', async ({ page, request }) => {
    const { token, board, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI clone test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);
    await page.click('.modal-close-btn');

    // At least one card item should contain "Original Card" in its title
    const cards = page.locator('.card-item h4, .card-item .card-title');
    const titles = await cards.allTextContents();
    const matchingTitles = titles.filter(t => t.includes('Original Card'));
    expect(matchingTitles.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * UI: cloned card can be opened in its own modal.
   *
   * Implementation notes:
   *   - Clicking the cloned card should open the card detail modal showing the
   *     cloned card's data (not the original).
   *   - The cloned card should have its own unique card ID in the modal header.
   */
  test.fixme('UI: cloned card opens correctly in its own detail modal', async ({ page, request }) => {
    const { token, board, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI clone test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Clone the original card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const [dupeResp] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);
    const cloned = await dupeResp.json();
    await page.click('.modal-close-btn');

    // Click the second card item (the clone)
    const secondCard = page.locator('.card-item').nth(1);
    await secondCard.click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // The modal should be showing — it should not be showing the original's ID
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();
    // Optionally check the card ID shown in the modal header differs from the original
    // TODO: replace with actual card ID selector once feature is implemented
  });

  /**
   * UI: cloned card can be edited independently.
   *
   * Implementation notes:
   *   - After cloning, renaming the cloned card should not affect the original.
   *   - Edit the cloned card's title and verify the original card title is unchanged.
   */
  test.fixme('cloned card can be edited independently without affecting the original', async ({ page, request }) => {
    const { token, board, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone edit test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Clone the card
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const [dupeResp] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/duplicate') && r.request().method() === 'POST'
      ),
      page.click('.card-detail-actions button:has-text("Duplicate")'),
    ]);
    const clonedCard = await dupeResp.json();
    await page.click('.modal-close-btn');

    // Open the cloned card and rename it
    const secondCardItem = page.locator('.card-item').nth(1);
    await secondCardItem.click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const titleInput = page.locator('.card-detail-modal-unified input[name="title"], .card-title-input');
    await titleInput.clear();
    await titleInput.fill('Modified Clone Title');
    await titleInput.press('Enter');
    await page.click('.modal-close-btn');

    // Verify original card title is unchanged via API
    const origRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const origCard = await origRes.json();
    expect(origCard.title).toBe('Original Card');

    // Verify cloned card has new title
    const cloneRes = await request.get(`${BASE}/api/cards/${clonedCard.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cloneFetched = await cloneRes.json();
    expect(cloneFetched.title).toContain('Modified Clone Title');
  });

  /**
   * Clone preserves labels (verify actual behavior).
   *
   * Implementation notes:
   *   - This test verifies whether labels ARE copied to the clone.
   *   - The expected behavior (copy vs. not copy) should be decided during
   *     implementation and this test adjusted accordingly.
   *   - Current assumption: labels ARE copied (they describe the work type,
   *     unlike assignees which describe ownership).
   */
  test.fixme('clone preserves labels from the original card', async ({ request }) => {
    const { token, board, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone labels test');
      return;
    }

    // Create a label on the board
    const labelRes = await request.post(`${BASE}/api/boards/${board.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Bug', color: '#ff0000' },
    });
    const label = await labelRes.json();

    // Attach label to the original card
    await request.post(`${BASE}/api/cards/${card.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { label_id: label.id },
    });

    // Clone the card
    const cloneRes = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cloneRes.status()).toBe(201);
    const cloned = await cloneRes.json();

    // Verify labels are present on the clone
    const labelsRes = await request.get(`${BASE}/api/cards/${cloned.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(labelsRes.ok()).toBe(true);
    const labels: any[] = await labelsRes.json();
    expect(labels.some((l: any) => l.id === label.id)).toBeTruthy();
  });

  /**
   * API: clone response body has the same shape as a regular card GET response.
   *
   * Implementation notes:
   *   - POST /api/cards/:id/duplicate should return a full card object, not a partial.
   *   - Required fields: id, title, board_id, column_id, swimlane_id, priority,
   *     story_points, description.
   */
  test.fixme('API: clone response has all expected card fields', async ({ request }) => {
    const { token, card, board, columns, swimlane, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping clone shape test');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const cloned = await res.json();

    // All required fields should be present
    expect(cloned).toHaveProperty('id');
    expect(cloned).toHaveProperty('title');
    expect(cloned).toHaveProperty('board_id', board.id);
    expect(cloned).toHaveProperty('column_id', columns[0].id);
    expect(cloned).toHaveProperty('swimlane_id', swimlane.id);
    expect(cloned).toHaveProperty('priority', 'high');
    expect(cloned).toHaveProperty('story_points', 5);
    expect(cloned).toHaveProperty('description', 'This is the original description');
  });

  /**
   * API: cloning the same card twice creates two distinct clones.
   *
   * Implementation notes:
   *   - Each call to POST /api/cards/:id/duplicate should produce a new card
   *     with a unique ID, even when called repeatedly on the same source card.
   */
  test.fixme('API: cloning the same card twice creates two separate distinct cards', async ({ request }) => {
    const { token, card, cardCreated } = await setupBoardWithCard(request);
    if (!cardCreated) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping double-clone test');
      return;
    }

    const res1 = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res1.status()).toBe(201);
    const clone1 = await res1.json();

    const res2 = await request.post(`${BASE}/api/cards/${card.id}/duplicate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res2.status()).toBe(201);
    const clone2 = await res2.json();

    // All three IDs must be distinct
    expect(clone1.id).not.toBe(card.id);
    expect(clone2.id).not.toBe(card.id);
    expect(clone1.id).not.toBe(clone2.id);
  });
});
