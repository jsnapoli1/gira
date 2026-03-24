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

  const card = await (
    await request.post(`${BASE}/api/cards`, {
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
    })
  ).json();

  return { token, board, card, columns, swimlane };
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
});
