/**
 * card-archiving.spec.ts — Card archiving / soft-delete behavior tests
 *
 * FEATURE STATUS: NOT IMPLEMENTED
 *
 * Investigation findings (2026-03-24):
 *
 * Backend:
 *   - The `PUT /api/cards/:id` handler (handleUpdateCard in card_handlers.go)
 *     accepts only: title, description, story_points, priority, due_date,
 *     time_estimate, parent_id, and issue_type.  There is no `archived` field.
 *   - The Card struct in internal/models/models.go has no `Archived` or
 *     `deleted_at` field.
 *   - No migration in internal/database/database.go adds an `archived` column
 *     to the `cards` table.
 *   - No separate "archive" endpoint (e.g. POST /api/cards/:id/archive or
 *     PUT /api/cards/:id with archived:true) exists in server.go.
 *   - Searching all of internal/ for "archive" yields zero matches.
 *
 * Frontend:
 *   - No "Archive" button exists in CardDetailModal.tsx or BoardView.tsx.
 *   - No "show archived" toggle exists in board or backlog views.
 *   - The only use of the word "archived" in BoardView.tsx is a comment noting
 *     that "done cards are archived" in a metaphorical sense (they move to a
 *     closed column when a sprint completes) — this is not a soft-delete feature.
 *
 * Implementation guidance (for the engineer who picks this up):
 *   1. Add `archived BOOLEAN NOT NULL DEFAULT 0` column to the cards table via a
 *      new migration in internal/database/database.go.
 *   2. Add `Archived bool` to the Card model in internal/models/models.go.
 *   3. Extend handleUpdateCard to accept and persist `archived`.
 *   4. Filter out archived cards in the board, backlog, and sprint query helpers
 *      (unless a query param `include_archived=true` is passed).
 *   5. Add an "Archive" button to CardDetailModal.tsx (distinct from the
 *      hard-delete "Delete" button).
 *   6. Add an "Unarchive" action — either a dedicated button in an
 *      "archived cards" view, or the same Archive toggle button shown in the
 *      modal when the card is already archived.
 *   7. Optionally add a "Show archived" toggle to the board / backlog views that
 *      passes include_archived=true to the board fetch.
 *
 * All tests are marked test.fixme() pending implementation.
 * When implemented, remove test.fixme() and adjust selectors / request shapes
 * to match the actual implementation.
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function setupBoardWithCard(request: any) {
  const email = `test-archive-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Archive Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Archive Test Board' },
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
      data: { name: 'Archive Swimlane', designator: 'AR-', color: '#FF9800' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card To Archive',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return { token, board, card, columns, swimlane };
}

async function setupBoardWithSprintAndCard(request: any) {
  const base = await setupBoardWithCard(request);
  const { token, board, card } = base;

  // Create a sprint
  const sprint = await (
    await request.post(`${BASE}/api/boards/${board.id}/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Archive Sprint', start_date: '2030-01-01', end_date: '2030-01-14' },
    })
  ).json();

  // Assign the card to the sprint
  await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprint.id },
  });

  return { ...base, sprint };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Card Archiving', () => {
  /**
   * Archive card from modal — card disappears from board view.
   *
   * Implementation notes:
   *   - An "Archive" button should be present in .card-detail-actions (separate
   *     from the hard-delete .btn-danger button).
   *   - Clicking Archive should send PUT /api/cards/:id with { archived: true }.
   *   - The board should no longer render the card after the response succeeds.
   *   - The card should remain in the database (soft-delete, not removed).
   */
  test.fixme('archive card from modal — card disappears from board view', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the card modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // Click Archive — no confirm dialog expected (non-destructive, reversible)
    // TODO: replace with the actual button selector once implemented
    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.card-detail-actions button:has-text("Archive")'),
    ]);
    expect(response.status()).toBe(200);

    // Modal should close and board should show no cards
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  /**
   * Archived cards are excluded from the backlog view.
   *
   * Implementation notes:
   *   - Archive the card via API (PUT /api/cards/:id { archived: true }).
   *   - Navigate to the Backlog view — the card should not appear in any
   *     .backlog-card element.
   *   - The GET /api/boards/:id/cards (or equivalent backlog query) must filter
   *     WHERE archived = 0 by default.
   */
  test.fixme('archived cards excluded from backlog view', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request);

    // Archive the card directly via API
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: '',
        priority: '',
        archived: true,
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Switch to Backlog view
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-section, .backlog-header')).toBeVisible({ timeout: 8000 });

    // No .backlog-card elements should be rendered
    await expect(page.locator('.backlog-card')).toHaveCount(0);
  });

  /**
   * Archived cards are excluded from the active sprint.
   *
   * Implementation notes:
   *   - Archive a card that is assigned to an active sprint.
   *   - The sprint panel should not show the archived card.
   *   - The card's sprint_id FK should be preserved in the DB so that unarchiving
   *     restores it to the same sprint (or the sprint assignment can be cleared on
   *     archive — document the chosen behaviour in the implementation).
   */
  test.fixme('archived cards excluded from active sprint panel', async ({ page, request }) => {
    const { token, board, card, sprint } = await setupBoardWithSprintAndCard(request);

    // Archive the card via API
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: '',
        priority: '',
        archived: true,
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Switch to Backlog view to see sprint panel
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-sprint-header')).toBeVisible({ timeout: 8000 });

    // Sprint panel should contain no card rows
    await expect(page.locator('.backlog-sprint-cards .backlog-card')).toHaveCount(0);
  });

  /**
   * "Show archived" toggle — when toggled on, archived cards appear.
   *
   * Implementation notes:
   *   - A toggle button (e.g. "Show Archived" or an eye-icon button) should exist
   *     in the board toolbar or backlog header.
   *   - When active it should pass a query parameter (e.g. include_archived=true)
   *     to the board/backlog data fetch, causing archived cards to render with a
   *     visual indicator (e.g. .card-item.archived or opacity/badge).
   *   - If the toggle is board-view-only, test it there. If backlog-only, adjust.
   */
  test.fixme('show archived toggle reveals archived cards on the board', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request);

    // Archive the card via API
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: '',
        priority: '',
        archived: true,
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    // By default the archived card should NOT appear
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });

    // Toggle "Show Archived"
    // TODO: replace with the actual button/checkbox selector once implemented
    await page.click('button:has-text("Show Archived"), label:has-text("Show Archived")');

    // The archived card should now be visible (possibly with an .archived class)
    await expect(page.locator('.card-item, .card-item.archived')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item')).toContainText('Card To Archive');
  });

  /**
   * Unarchive card — card returns to board view.
   *
   * Implementation notes:
   *   - When viewing an archived card (via the "show archived" toggle, or via a
   *     dedicated "Archived Cards" section), an "Unarchive" button should appear.
   *   - Clicking it sends PUT /api/cards/:id { archived: false }.
   *   - After the response the card should be visible in the normal board view
   *     without needing the "show archived" toggle.
   */
  test.fixme('unarchive card — card returns to normal board view', async ({ page, request }) => {
    const { token, board, card } = await setupBoardWithCard(request);

    // Archive the card via API
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: '',
        priority: '',
        archived: true,
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    await page.click('.view-btn:has-text("All Cards")');

    // Enable the "show archived" toggle so we can see the card
    await page.click('button:has-text("Show Archived"), label:has-text("Show Archived")');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Open the archived card and unarchive it
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'
      ),
      page.click('.card-detail-actions button:has-text("Unarchive")'),
    ]);
    expect(response.status()).toBe(200);

    // Close modal, disable show-archived toggle, card should still appear
    await page.click('.modal-close-btn');
    // Toggle show-archived off (if it's a toggle button, clicking again hides archived)
    await page.click('button:has-text("Show Archived"), label:has-text("Show Archived")');

    // The card should still be visible because it is no longer archived
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item')).toContainText('Card To Archive');
  });

  /**
   * Archive vs hard-delete: archive is reversible, delete is not.
   *
   * Implementation notes:
   *   - This test documents the contract: archiving is a soft-delete, deletion is
   *     permanent.
   *   - Archive: PUT /api/cards/:id { archived: true } — card persists in DB.
   *   - Delete: DELETE /api/cards/:id — card row is removed from DB.
   *   - After archiving, GET /api/cards/:id should return the card (200 OK).
   *   - After deleting, GET /api/cards/:id should return 404.
   *   - This test verifies both paths via direct API calls, then confirms the
   *     hard-deleted card cannot be unarchived (the ID no longer exists).
   */
  test.fixme('archive is reversible — deleted card returns 404, archived card returns 200', async ({ page, request }) => {
    const email = `test-archive-del-${crypto.randomUUID()}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Archive Del Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Archive Del Board' },
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
        data: { name: 'Del Swimlane', designator: 'DL-', color: '#E91E63' },
      })
    ).json();

    // Create two cards: one to archive, one to hard-delete
    const cardToArchive = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Will Be Archived',
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    const cardToDelete = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Will Be Deleted',
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // Archive one card
    const archiveResponse = await request.put(`${BASE}/api/cards/${cardToArchive.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: cardToArchive.title,
        description: '',
        priority: '',
        archived: true,
      },
    });
    expect(archiveResponse.status()).toBe(200);

    // Hard-delete the other card
    const deleteResponse = await request.delete(`${BASE}/api/cards/${cardToDelete.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.status()).toBe(204);

    // Archived card still accessible (soft-delete)
    const fetchArchived = await request.get(`${BASE}/api/cards/${cardToArchive.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fetchArchived.status()).toBe(200);
    const archivedData = await fetchArchived.json();
    expect(archivedData.archived).toBe(true);

    // Deleted card is gone (hard-delete)
    const fetchDeleted = await request.get(`${BASE}/api/cards/${cardToDelete.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fetchDeleted.status()).toBe(404);

    // Unarchive the soft-deleted card — should succeed
    const unarchiveResponse = await request.put(`${BASE}/api/cards/${cardToArchive.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: cardToArchive.title,
        description: '',
        priority: '',
        archived: false,
      },
    });
    expect(unarchiveResponse.status()).toBe(200);
    const unarchived = await unarchiveResponse.json();
    expect(unarchived.archived).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Always-run API tests — permanent deletion behaviour (no archive feature needed)
// These tests verify the current hard-delete contract and run regardless of
// whether the archive feature is ever implemented.
// ---------------------------------------------------------------------------

test.describe('Card Deletion (always-run API tests)', () => {
  /**
   * DELETE /api/cards/:id is permanent — subsequent GET returns 404.
   *
   * This documents the current hard-delete contract. Once archiving is
   * implemented, the Archive button should be the preferred reversible action
   * and the Delete button should continue to behave as a hard-delete.
   *
   * [BACKLOG] P2: Add card archiving — soft-delete that hides cards from
   * board/backlog without permanent deletion. Users currently must delete
   * cards which is irreversible and loses all card history.
   */
  test('card deletion is permanent — DELETE then GET returns 404', async ({ request }) => {
    const email = `test-del-permanent-${crypto.randomUUID()}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Del Permanent Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Del Permanent Board' },
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
        data: { name: 'Del Swimlane', designator: 'DP-', color: '#9C27B0' },
      })
    ).json();

    // Create the card
    const card = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Card To Permanently Delete',
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();
    expect(card.id).toBeDefined();

    // Verify card exists before deletion
    const beforeDelete = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(beforeDelete.status()).toBe(200);

    // Hard-delete the card
    const deleteResp = await request.delete(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteResp.status()).toBe(204);

    // Deletion is permanent — GET must return 404
    const afterDelete = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(afterDelete.status()).toBe(404);
  });

  /**
   * Deleted card is no longer included in the board's card list.
   *
   * After DELETE /api/cards/:id the board fetch (GET /api/boards/:id/cards)
   * must not return the deleted card. This guards against stale data being
   * served from a cache or a soft-delete path that wasn't cleaned up.
   *
   * [BACKLOG] P2: Add card archiving — once implemented, archived cards should
   * also be excluded from this list by default (only returned when
   * include_archived=true is passed).
   */
  test('deleted card is removed from board card list', async ({ request }) => {
    const email = `test-del-list-${crypto.randomUUID()}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Del List Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Del List Board' },
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
        data: { name: 'List Swimlane', designator: 'DL-', color: '#FF5722' },
      })
    ).json();

    // Create two cards so we can assert the board list shrinks by exactly one
    const cardA = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Card A — Keep',
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    const cardB = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Card B — Delete',
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          board_id: board.id,
        },
      })
    ).json();

    // Both cards present on the board
    const beforeList: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(beforeList.map((c: any) => c.id)).toContain(cardA.id);
    expect(beforeList.map((c: any) => c.id)).toContain(cardB.id);

    // Delete card B
    const deleteResp = await request.delete(`${BASE}/api/cards/${cardB.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteResp.status()).toBe(204);

    // Board list should no longer contain the deleted card
    const afterList: any[] = await (
      await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const afterIds = afterList.map((c: any) => c.id);
    expect(afterIds).toContain(cardA.id);
    expect(afterIds).not.toContain(cardB.id);
  });
});
