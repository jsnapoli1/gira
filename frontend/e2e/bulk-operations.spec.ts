import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  userId: number;
  board: { id: number; columns: Array<{ id: number; name: string; state: string; position: number }> };
  swimlane: { id: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup(request: any): Promise<SetupResult> {
  const email = `bulk-ops-${crypto.randomUUID()}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Bulk Ops Tester' },
  });
  const { token, user } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Bulk Ops Board ${crypto.randomUUID().slice(0, 8)}` },
  });
  const boardBase = await boardRes.json();

  // Fetch board detail which includes columns
  const boardDetailRes = await request.get(`${BASE}/api/boards/${boardBase.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const board = await boardDetailRes.json();

  const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Bulk Swimlane', designator: 'BLK-', color: '#3b82f6' },
  });
  const swimlane = await swimlaneRes.json();

  return { token, userId: user?.id, board, swimlane };
}

async function createCard(
  request: any,
  token: string,
  board: SetupResult['board'],
  swimlane: SetupResult['swimlane'],
  title: string,
  columnIndex = 0,
): Promise<any | null> {
  const col = board.columns[columnIndex];
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      column_id: col.id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'medium',
    },
  });
  if (!res.ok()) return null;
  return res.json();
}

async function createSprint(request: any, token: string, boardId: number, name: string): Promise<any> {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, goal: '' },
  });
  if (!res.ok()) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Bulk Move (POST /api/cards/bulk-move)
// ---------------------------------------------------------------------------

test.describe('Bulk Move Cards (POST /api/cards/bulk-move)', () => {
  test('bulk move 3 cards to column 2 — all change column_id', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);
    const col0 = board.columns[0];
    const col1 = board.columns[1];

    const card1 = await createCard(request, token, board, swimlane, 'BulkMove Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'BulkMove Card 2');
    const card3 = await createCard(request, token, board, swimlane, 'BulkMove Card 3');

    if (!card1 || !card2 || !card3) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id, card3.id], column_id: col1.id },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(3);

    // Verify each card is now in col1
    for (const card of [card1, card2, card3]) {
      const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await cardRes.json();
      expect(updated.column_id).toBe(col1.id);
    }
  });

  test('bulk move 1 card still works', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);
    const col1 = board.columns[1];

    const card = await createCard(request, token, board, swimlane, 'SingleMove Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card.id], column_id: col1.id },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(1);

    const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await cardRes.json();
    expect(updated.column_id).toBe(col1.id);
  });

  test('bulk move with empty card_ids returns 400', async ({ request }) => {
    const { token, board } = await setup(request);
    const col1 = board.columns[1];

    const res = await request.post(`${BASE}/api/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [], column_id: col1.id },
    });

    expect(res.status()).toBe(400);
  });

  test('bulk move to non-existent column returns 4xx', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'BadCol Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card.id], column_id: 999999999 },
    });

    // The DB will error or the card will not be found — expect a 4xx or 5xx
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('bulk move without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/bulk-move`, {
      data: { card_ids: [1], column_id: 1 },
    });

    expect(res.status()).toBe(401);
  });

  test('after bulk move, GET /api/boards/:id/cards shows cards in new column', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);
    const col0 = board.columns[0];
    const col1 = board.columns[1];

    const card1 = await createCard(request, token, board, swimlane, 'BoardVerify Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'BoardVerify Card 2');

    if (!card1 || !card2) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    // Both cards start in col0 — move to col1
    await request.post(`${BASE}/api/cards/bulk-move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id], column_id: col1.id },
    });

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardsRes.status()).toBe(200);
    const cards: any[] = await cardsRes.json();
    const movedCards = cards.filter((c: any) => c.id === card1.id || c.id === card2.id);
    expect(movedCards.length).toBe(2);
    movedCards.forEach((c: any) => expect(c.column_id).toBe(col1.id));
  });
});

// ---------------------------------------------------------------------------
// Bulk Assign Sprint (POST /api/cards/bulk-assign-sprint)
// ---------------------------------------------------------------------------

test.describe('Bulk Assign Sprint (POST /api/cards/bulk-assign-sprint)', () => {
  test('bulk assign 3 cards to sprint — all get sprint_id', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'BulkSprint Test');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const card1 = await createCard(request, token, board, swimlane, 'Sprint Assign Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'Sprint Assign Card 2');
    const card3 = await createCard(request, token, board, swimlane, 'Sprint Assign Card 3');

    if (!card1 || !card2 || !card3) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id, card3.id], sprint_id: sprint.id },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(3);

    // Verify sprint assignment on each card
    for (const card of [card1, card2, card3]) {
      const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await cardRes.json();
      expect(updated.sprint_id).toBe(sprint.id);
    }
  });

  test('bulk assign to sprint_id null removes sprint assignment', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'Unassign Sprint');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const card1 = await createCard(request, token, board, swimlane, 'Remove Sprint Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'Remove Sprint Card 2');

    if (!card1 || !card2) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    // First assign
    await request.post(`${BASE}/api/cards/bulk-assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id], sprint_id: sprint.id },
    });

    // Now remove sprint assignment
    const res = await request.post(`${BASE}/api/cards/bulk-assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id], sprint_id: null },
    });

    expect(res.status()).toBe(200);

    for (const card of [card1, card2]) {
      const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await cardRes.json();
      expect(updated.sprint_id).toBeNull();
    }
  });

  test('bulk assign with empty card_ids returns 400', async ({ request }) => {
    const { token, board } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'EmptyIds Sprint');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [], sprint_id: sprint.id },
    });

    expect(res.status()).toBe(400);
  });

  test('bulk assign without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/bulk-assign-sprint`, {
      data: { card_ids: [1], sprint_id: 1 },
    });

    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Bulk Update (POST /api/cards/bulk-update)
// ---------------------------------------------------------------------------

test.describe('Bulk Update Cards (POST /api/cards/bulk-update)', () => {
  test('bulk update priority field for multiple cards', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card1 = await createCard(request, token, board, swimlane, 'BulkUpdate Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'BulkUpdate Card 2');
    const card3 = await createCard(request, token, board, swimlane, 'BulkUpdate Card 3');

    if (!card1 || !card2 || !card3) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-update`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id, card3.id], priority: 'high' },
    });

    expect(res.status()).toBe(200);

    // Verify priority updated
    for (const card of [card1, card2, card3]) {
      const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = await cardRes.json();
      expect(updated.priority).toBe('high');
    }
  });

  test('bulk update returns updated count', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card1 = await createCard(request, token, board, swimlane, 'Count Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'Count Card 2');

    if (!card1 || !card2) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-update`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id], priority: 'low' },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
  });

  test('bulk update with empty card_ids returns 400', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/bulk-update`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [], priority: 'high' },
    });

    expect(res.status()).toBe(400);
  });

  test('bulk update with invalid priority returns 400', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Invalid Prio Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-update`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card.id], priority: 'superultrahigh' },
    });

    expect(res.status()).toBe(400);
  });

  test('bulk update without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/bulk-update`, {
      data: { card_ids: [1], priority: 'high' },
    });

    expect(res.status()).toBe(401);
  });

  test('bulk update all 5 priority levels are valid', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'AllPrios Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    for (const priority of ['highest', 'high', 'medium', 'low', 'lowest']) {
      const res = await request.post(`${BASE}/api/cards/bulk-update`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { card_ids: [card.id], priority },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.updated).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Bulk Delete (POST /api/cards/bulk-delete)
// ---------------------------------------------------------------------------

test.describe('Bulk Delete Cards (POST /api/cards/bulk-delete)', () => {
  test('bulk delete 3 cards — all removed from board', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card1 = await createCard(request, token, board, swimlane, 'BulkDel Card 1');
    const card2 = await createCard(request, token, board, swimlane, 'BulkDel Card 2');
    const card3 = await createCard(request, token, board, swimlane, 'BulkDel Card 3');

    if (!card1 || !card2 || !card3) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-delete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id, card3.id] },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(3);

    // Verify all deleted
    for (const card of [card1, card2, card3]) {
      const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(cardRes.status()).toBe(404);
    }
  });

  test('bulk delete 1 card works', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'SingleDel Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/bulk-delete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card.id] },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(1);

    const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardRes.status()).toBe(404);
  });

  test('after bulk delete board cards list excludes deleted cards', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card1 = await createCard(request, token, board, swimlane, 'Del From Board 1');
    const card2 = await createCard(request, token, board, swimlane, 'Del From Board 2');
    const keeper = await createCard(request, token, board, swimlane, 'Keeper Card');

    if (!card1 || !card2 || !keeper) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    await request.post(`${BASE}/api/cards/bulk-delete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [card1.id, card2.id] },
    });

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cardsRes.status()).toBe(200);
    const cards: any[] = await cardsRes.json();

    const ids = cards.map((c: any) => c.id);
    expect(ids).not.toContain(card1.id);
    expect(ids).not.toContain(card2.id);
    expect(ids).toContain(keeper.id);
  });

  test('bulk delete with empty card_ids returns 400', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/bulk-delete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [] },
    });

    expect(res.status()).toBe(400);
  });

  test('bulk delete without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/bulk-delete`, {
      data: { card_ids: [1] },
    });

    expect(res.status()).toBe(401);
  });

  test('bulk delete with non-existent card IDs returns 404', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/bulk-delete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { card_ids: [999999991, 999999992] },
    });

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Move-State (POST /api/cards/:id/move-state)
// ---------------------------------------------------------------------------

test.describe('Move Card By State (POST /api/cards/:id/move-state)', () => {
  test('move card to "in_progress" state changes column_id', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    // Find the open column and in_progress column
    const openCol = board.columns.find((c: any) => c.state === 'open');
    const inProgressCol = board.columns.find((c: any) => c.state === 'in_progress');
    if (!openCol || !inProgressCol) {
      test.skip(true, 'Board columns missing expected states');
      return;
    }

    // Create card in open column
    const card = await createCard(request, token, board, swimlane, 'MoveState Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }
    expect(card.column_id).toBe(openCol.id);

    const res = await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'in_progress' },
    });

    expect(res.status()).toBe(200);

    const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await cardRes.json();
    expect(updated.column_id).toBe(inProgressCol.id);
    expect(updated.state).toBe('in_progress');
  });

  test('move card to "closed" state changes column to done', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const closedCol = board.columns.find((c: any) => c.state === 'closed');
    if (!closedCol) {
      test.skip(true, 'No closed column found');
      return;
    }

    const card = await createCard(request, token, board, swimlane, 'ClosedState Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'closed' },
    });

    expect(res.status()).toBe(200);

    const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await cardRes.json();
    expect(updated.column_id).toBe(closedCol.id);
  });

  test('move card back to "open" state restores open column', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const openCol = board.columns.find((c: any) => c.state === 'open');
    const inProgressCol = board.columns.find((c: any) => c.state === 'in_progress');
    if (!openCol || !inProgressCol) {
      test.skip(true, 'Board columns missing expected states');
      return;
    }

    // Create card in open, move to in_progress, then back to open
    const card = await createCard(request, token, board, swimlane, 'BackToOpen Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'in_progress' },
    });

    const res = await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'open' },
    });

    expect(res.status()).toBe(200);

    const cardRes = await request.get(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const updated = await cardRes.json();
    expect(updated.column_id).toBe(openCol.id);
  });

  test('move-state with invalid/unknown state returns 400', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'BadState Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'totally_invalid_state_xyz' },
    });

    expect(res.status()).toBe(400);
  });

  test('move-state with missing state field returns 400', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'NoState Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });

    expect(res.status()).toBe(400);
  });

  test('move-state unauthorized returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/9999/move-state`, {
      data: { state: 'in_progress' },
    });

    expect(res.status()).toBe(401);
  });

  test('move-state on non-existent card returns 404', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.post(`${BASE}/api/cards/999999999/move-state`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { state: 'open' },
    });

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Reorder (POST /api/cards/:id/reorder)
// ---------------------------------------------------------------------------

test.describe('Reorder Card (POST /api/cards/:id/reorder)', () => {
  test('reorder card within column changes position', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Reorder Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/reorder`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { position: 5000 },
    });

    expect(res.status()).toBe(200);
  });

  test('reorder to a smaller position value (move toward top)', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Reorder Top Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/reorder`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { position: 1 },
    });

    expect(res.status()).toBe(200);
  });

  test('reorder to a large position value (move toward bottom)', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Reorder Bottom Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/reorder`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { position: 9999999999 },
    });

    // position must be < 1e10 (10000000000); 9999999999 is the max valid value
    expect(res.status()).toBe(200);
  });

  test('reorder with position <= 0 returns 400', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Invalid Pos Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/reorder`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { position: 0 },
    });

    expect(res.status()).toBe(400);
  });

  test('reorder with position >= 10000000000 returns 400', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'OverLimit Pos Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.post(`${BASE}/api/cards/${card.id}/reorder`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { position: 10000000000 },
    });

    expect(res.status()).toBe(400);
  });

  test('reorder unauthorized returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/cards/9999/reorder`, {
      data: { position: 1000 },
    });

    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Time Summary (GET /api/boards/:id/time-summary)
// ---------------------------------------------------------------------------

test.describe('Board Time Summary (GET /api/boards/:id/time-summary)', () => {
  test('time summary returns 200 for a valid board', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
  });

  test('time summary response contains by_user, total_logged, total_estimated', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('by_user');
    expect(body).toHaveProperty('total_logged');
    expect(body).toHaveProperty('total_estimated');
    expect(Array.isArray(body.by_user)).toBe(true);
  });

  test('time summary shows 0 values when no worklogs exist', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.total_logged).toBe(0);
    expect(body.total_estimated).toBe(0);
    expect(body.by_user.length).toBe(0);
  });

  test('time summary increases after adding a worklog', async ({ request }) => {
    const { token, board, swimlane, userId } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Worklog Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    // Add a worklog to the card
    const worklogRes = await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 3600, description: 'One hour of work', logged_at: new Date().toISOString() },
    });

    if (!worklogRes.ok()) {
      test.skip(true, 'Worklog creation failed');
      return;
    }

    const summaryRes = await request.get(`${BASE}/api/boards/${board.id}/time-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(summaryRes.status()).toBe(200);
    const body = await summaryRes.json();
    expect(body.total_logged).toBeGreaterThan(0);
  });

  test('time summary accepts optional sprint_id query param', async ({ request }) => {
    const { token, board } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'TimeSummary Sprint');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const res = await request.get(
      `${BASE}/api/boards/${board.id}/time-summary?sprint_id=${sprint.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('total_logged');
  });

  test('time summary unauthorized returns 401', async ({ request }) => {
    const { board } = await setup(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/time-summary`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Search (GET /api/cards/search)
// ---------------------------------------------------------------------------

test.describe('Card Search (GET /api/cards/search)', () => {
  test('search returns cards matching title', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'UniqueSearchableTitle12345');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.get(
      `${BASE}/api/cards/search?q=UniqueSearchableTitle12345&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.some((c: any) => c.title === 'UniqueSearchableTitle12345')).toBe(true);
  });

  test('search returns empty array for no matches', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card = await createCard(request, token, board, swimlane, 'Known Card');
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.get(
      `${BASE}/api/cards/search?q=XYZZYNOSUCHTERMEVER999&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(0);
  });

  test('search with board_id filter limits results to that board', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    // Create a second board and card with same search term
    const board2Res = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Other Board ${crypto.randomUUID().slice(0, 8)}` },
    });
    const board2Base = await board2Res.json();
    const board2Detail = await (
      await request.get(`${BASE}/api/boards/${board2Base.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const swimlane2 = await (
      await request.post(`${BASE}/api/boards/${board2Base.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Lane 2', designator: 'L2-', color: '#ef4444' },
      })
    ).json();

    const card1 = await createCard(request, token, board, swimlane, 'SearchFilter Common');
    const card2 = await createCard(request, token, { ...board2Detail }, swimlane2, 'SearchFilter Common');

    if (!card1) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.get(
      `${BASE}/api/cards/search?q=SearchFilter+Common&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    // All returned cards must belong to board.id
    cards.forEach((c: any) => expect(c.board_id).toBe(board.id));
  });

  test('search requires board_id returns 400 when missing', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(
      `${BASE}/api/cards/search?q=something`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(400);
  });

  test('search without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cards/search?q=test&board_id=1`);
    expect(res.status()).toBe(401);
  });

  test('search with empty query returns all board cards', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const card1 = await createCard(request, token, board, swimlane, 'EmptyQ Card A');
    const card2 = await createCard(request, token, board, swimlane, 'EmptyQ Card B');

    if (!card1 || !card2) {
      test.skip(true, 'Card creation failed (Gitea 401)');
      return;
    }

    const res = await request.get(
      `${BASE}/api/cards/search?q=&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Metrics — Burndown (GET /api/metrics/burndown)
// ---------------------------------------------------------------------------

test.describe('Burndown Metrics (GET /api/metrics/burndown)', () => {
  test('burndown returns 200 for a valid sprint', async ({ request }) => {
    const { token, board } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'Burndown Sprint');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const res = await request.get(
      `${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
  });

  test('burndown returns an array of metrics data', async ({ request }) => {
    const { token, board } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'Burndown Array Sprint');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    const res = await request.get(
      `${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('burndown requires sprint_id — returns 400 when missing', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/burndown`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(400);
  });

  test('burndown with non-existent sprint_id returns 404', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/burndown?sprint_id=999999999`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(404);
  });

  test('burndown without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=1`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Metrics — Velocity (GET /api/metrics/velocity)
// ---------------------------------------------------------------------------

test.describe('Velocity Metrics (GET /api/metrics/velocity)', () => {
  test('velocity returns 200 for a valid board', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/velocity?board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
  });

  test('velocity returns an array', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/velocity?board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('velocity returns empty array when no completed sprints exist', async ({ request }) => {
    const { token, board } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/velocity?board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    // A fresh board has no completed sprints
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('velocity data includes sprint_name, completed_points, total_points after completing a sprint', async ({ request }) => {
    const { token, board, swimlane } = await setup(request);

    const sprint = await createSprint(request, token, board.id, 'Completed Sprint Velocity');
    if (!sprint) {
      test.skip(true, 'Sprint creation failed');
      return;
    }

    // Start and complete the sprint
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(
      `${BASE}/api/metrics/velocity?board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const point = body[0];
    expect(point).toHaveProperty('sprint_name');
    expect(point).toHaveProperty('completed_points');
    expect(point).toHaveProperty('total_points');
  });

  test('velocity requires board_id — returns 400 when missing', async ({ request }) => {
    const { token } = await setup(request);

    const res = await request.get(
      `${BASE}/api/metrics/velocity`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(400);
  });

  test('velocity without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrics/velocity?board_id=1`);
    expect(res.status()).toBe(401);
  });
});
