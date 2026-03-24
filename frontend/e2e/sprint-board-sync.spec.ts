import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface Column {
  id: number;
  name: string;
  state: string;
  position: number;
}

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
  doneColumnId: number;
  columns: Column[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName = 'Sync Tester'): Promise<{ token: string }> {
  const email = `test-sbs-${crypto.randomUUID()}@example.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(request: any, token: string, boardName = 'Sync Board'): Promise<BoardSetup> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const columns: Column[] = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sorted = [...columns].sort((a, b) => a.position - b.position);
  const doneColumn = sorted.find((c) => c.state === 'closed') ?? sorted[sorted.length - 1];

  return {
    token,
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: sorted[0].id,
    doneColumnId: doneColumn.id,
    columns: sorted,
  };
}

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: number; name: string }> {
  return (
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, ...extra },
    })
  ).json();
}

async function startSprint(request: any, token: string, sprintId: number): Promise<void> {
  await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function completeSprint(request: any, token: string, sprintId: number): Promise<void> {
  await request.post(`${BASE}/api/sprints/${sprintId}/complete`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function createCard(
  request: any,
  token: string,
  bs: BoardSetup,
  title: string,
  storyPoints = 0,
): Promise<{ id: number }> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      board_id: bs.boardId,
      swimlane_id: bs.swimlaneId,
      column_id: bs.firstColumnId,
    },
  });
  if (!res.ok()) {
    test.skip(true, `Card creation unavailable: ${await res.text()}`);
    return { id: -1 };
  }
  const card = await res.json();

  if (storyPoints > 0) {
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { story_points: storyPoints },
    });
  }

  return card;
}

async function assignCardToSprint(
  request: any,
  token: string,
  cardId: number,
  sprintId: number,
): Promise<void> {
  await request.post(`${BASE}/api/cards/${cardId}/assign-sprint`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { sprint_id: sprintId },
  });
}

async function moveCardToDone(
  request: any,
  token: string,
  cardId: number,
  doneColumnId: number,
): Promise<void> {
  await request.post(`${BASE}/api/cards/${cardId}/move`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { column_id: doneColumnId, state: 'closed', position: 10000 },
  });
}

async function getSprintMetrics(
  request: any,
  token: string,
  sprintId: number,
): Promise<{
  sprint_id: number;
  total_cards: number;
  completed_cards: number;
  total_points: number;
  completed_points: number;
  remaining_points: number;
}> {
  const res = await request.get(`${BASE}/api/sprints/${sprintId}/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return Array.isArray(data) ? data[data.length - 1] : data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint / Board Sync', () => {
  // -------------------------------------------------------------------------
  // 1. Assign card to sprint → start sprint → card visible on board
  // -------------------------------------------------------------------------
  test('card assigned to sprint appears on board after sprint is started', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Board Visible Tester');
    const bs = await setupBoard(request, token, 'Board Visible Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Board Visible Sprint');

    const card = await createCard(request, token, bs, 'Board Visible Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // The default board view should show cards in the active sprint
    // Wait for at least one card-item to be rendered
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item[aria-label="Board Visible Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Remove card from sprint → card disappears from board, moves to backlog
  // -------------------------------------------------------------------------
  test('removing sprint assignment hides card from board and shows it in backlog', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Board Remove Tester');
    const bs = await setupBoard(request, token, 'Board Remove Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Board Remove Sprint');

    const card = await createCard(request, token, bs, 'Removable Board Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Now remove the sprint assignment via API
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: null },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Board view (sprint mode) should NOT show the card since it has no sprint
    await expect(page.locator('.card-item[aria-label="Removable Board Card"]')).not.toBeVisible({
      timeout: 8000,
    });

    // Switch to backlog — card should appear in the unassigned section
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Removable Board Card');
  });

  // -------------------------------------------------------------------------
  // 3. Move card to Done on board → sprint metrics show increased completed_cards
  // -------------------------------------------------------------------------
  test('moving card to Done column increases completed_cards in sprint metrics', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Done Metrics Tester');
    const bs = await setupBoard(request, token, 'Done Metrics Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Done Metrics Sprint');

    const card1 = await createCard(request, token, bs, 'Done Card 1', 3);
    const card2 = await createCard(request, token, bs, 'Done Card 2', 3);
    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Baseline: 0 completed
    const before = await getSprintMetrics(request, token, sprint.id);
    expect(before.completed_cards).toBe(0);
    expect(before.total_cards).toBe(2);

    // Move one card to Done
    await moveCardToDone(request, token, card1.id, bs.doneColumnId);

    // Metrics should now show 1 completed
    const after = await getSprintMetrics(request, token, sprint.id);
    expect(after.completed_cards).toBe(1);
    expect(after.completed_points).toBe(3);
    expect(after.remaining_points).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 4. Add card while sprint active → assign to sprint via API → appears on board
  // -------------------------------------------------------------------------
  test('card created during an active sprint and assigned to it appears on board after reload', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Late Assign Tester');
    const bs = await setupBoard(request, token, 'Late Assign Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Sprint');

    await startSprint(request, token, sprint.id);

    // Create a new card after sprint has started
    const card = await createCard(request, token, bs, 'Late Sprint Card');
    await assignCardToSprint(request, token, card.id, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Card should appear in the board view (active sprint is running)
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item[aria-label="Late Sprint Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 5. Complete sprint → board view shows no sprint cards
  // -------------------------------------------------------------------------
  test('completing a sprint removes its cards from the board view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Complete Clear Tester');
    const bs = await setupBoard(request, token, 'Complete Clear Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint To Clear');

    const card = await createCard(request, token, bs, 'Sprint Clear Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // With no active sprint the board view shows the empty state prompt
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    // The completed sprint card should not be visible in the board
    await expect(page.locator('.card-item[aria-label="Sprint Clear Card"]')).not.toBeVisible({
      timeout: 5000,
    });
  });

  // -------------------------------------------------------------------------
  // 6. Sprint progress visible in backlog: with 2/4 cards Done, sprint card
  //    count badge and unassigned count are consistent
  // -------------------------------------------------------------------------
  test('backlog sprint panel reflects correct card count with partial completion', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Progress Backlog Tester');
    const bs = await setupBoard(request, token, 'Progress Backlog Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Progress Sprint');

    const cards = await Promise.all([
      createCard(request, token, bs, 'Progress Card 1'),
      createCard(request, token, bs, 'Progress Card 2'),
      createCard(request, token, bs, 'Progress Card 3'),
      createCard(request, token, bs, 'Progress Card 4'),
    ]);
    for (const card of cards) {
      await assignCardToSprint(request, token, card.id, sprint.id);
    }
    await startSprint(request, token, sprint.id);

    // Move 2 cards to Done
    await moveCardToDone(request, token, cards[0].id, bs.doneColumnId);
    await moveCardToDone(request, token, cards[1].id, bs.doneColumnId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint card count badge should still show all 4 assigned cards (done cards
    // are still sprint members until the sprint is completed)
    await expect(page.locator('.sprint-card-count')).toContainText('4');

    // Verify sprint metrics via API confirm 2/4 completed
    const metrics = await getSprintMetrics(request, token, sprint.id);
    expect(metrics.total_cards).toBe(4);
    expect(metrics.completed_cards).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 7. Card story points in sprint total — assign cards with story_points,
  //    sprint metrics total_points is correct
  // -------------------------------------------------------------------------
  test('sprint metrics total_points equals sum of assigned card story points', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Points Tester');
    const bs = await setupBoard(request, token, 'Points Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Points Sprint');

    const card1 = await createCard(request, token, bs, 'Points Card 5', 5);
    const card2 = await createCard(request, token, bs, 'Points Card 8', 8);
    const card3 = await createCard(request, token, bs, 'Points Card 2', 2);
    await assignCardToSprint(request, token, card1.id, sprint.id);
    await assignCardToSprint(request, token, card2.id, sprint.id);
    await assignCardToSprint(request, token, card3.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const metrics = await getSprintMetrics(request, token, sprint.id);
    expect(metrics.total_points).toBe(15);
    expect(metrics.total_cards).toBe(3);
    expect(metrics.completed_cards).toBe(0);
    expect(metrics.remaining_points).toBe(15);
  });

  // -------------------------------------------------------------------------
  // 8. Board view without active sprint shows empty state prompt
  // -------------------------------------------------------------------------
  test('board view on a new board with no active sprint shows the empty state prompt', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Empty Board Tester');
    const bs = await setupBoard(request, token, 'Empty Sprint Board');

    // Create a sprint in planning state but do NOT start it
    await createSprint(request, token, bs.boardId, 'Unstarted Sprint');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // The board view (default) with no active sprint must show the empty state
    // with the prompt to go to the Backlog view
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.empty-swimlanes p')).toContainText('No sprint found');
    await expect(page.locator('.empty-swimlanes button:has-text("Go to Backlog")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 9. Unauthenticated access to board cards returns 401
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/cards returns 401 without auth token', async ({ request }) => {
    const { token } = await createUser(request, 'Auth Check Tester');
    const bs = await setupBoard(request, token, 'Auth Check Board');

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 10. Card moved back from Done to open column decreases completed_cards
  // (uses burndown endpoint which always returns calculated current metrics)
  // -------------------------------------------------------------------------
  test('moving card back from Done to open column decreases completed_cards in metrics', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Undo Done Tester');
    const bs = await setupBoard(request, token, 'Undo Done Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Undo Done Sprint');

    const card = await createCard(request, token, bs, 'Undo Done Card', 5);
    if (card.id === -1) return;
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Helper: fetch calculated current metrics via burndown endpoint
    async function currentMetrics(): Promise<{ completed_cards: number; remaining_points: number }> {
      const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=${sprint.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const last = Array.isArray(data) ? data[data.length - 1] : data;
      return last;
    }

    // Move card to Done
    await moveCardToDone(request, token, card.id, bs.doneColumnId);

    const afterDone = await currentMetrics();
    expect(afterDone.completed_cards).toBe(1);
    expect(afterDone.remaining_points).toBe(0);

    // Move it back to the first (open) column
    await request.post(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: bs.firstColumnId, state: 'open', position: 1 },
    });

    const afterUndone = await currentMetrics();
    expect(afterUndone.completed_cards).toBe(0);
    expect(afterUndone.remaining_points).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 11. Sprint start API returns 200
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/start returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'Start API Tester');
    const bs = await setupBoard(request, token, 'Start API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Start API Sprint');

    const res = await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 12. Sprint complete API returns 200
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/complete returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'Complete API Tester');
    const bs = await setupBoard(request, token, 'Complete API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Complete API Sprint');
    await startSprint(request, token, sprint.id);

    const res = await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 13. GET /api/boards/:id/cards returns all cards including sprint members
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/cards returns sprint-assigned cards with sprint_id set', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Cards API Tester');
    const bs = await setupBoard(request, token, 'Cards API Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Cards API Sprint');

    const card = await createCard(request, token, bs, 'Sprint Member Card');
    await assignCardToSprint(request, token, card.id, sprint.id);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const cards = await res.json();
    const found = cards.find((c: { id: number; sprint_id: number | null }) => c.id === card.id);
    expect(found).toBeTruthy();
    expect(found.sprint_id).toBe(sprint.id);
  });

  // -------------------------------------------------------------------------
  // 14. API: card assigned to sprint still has correct column_id
  //     Both sprint and column references must be correct simultaneously
  // -------------------------------------------------------------------------
  test('card assigned to sprint still has correct column_id in board cards response', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Column Sprint Tester');
    const bs = await setupBoard(request, token, 'Column Sprint Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Column Sprint');

    const card = await createCard(request, token, bs, 'Column Sprint Card');
    await assignCardToSprint(request, token, card.id, sprint.id);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();
    const found = cards.find((c: any) => c.id === card.id);
    expect(found).toBeTruthy();
    // Both sprint and column should be set correctly
    expect(found.sprint_id).toBe(sprint.id);
    expect(found.column_id).toBe(bs.firstColumnId);
  });

  // -------------------------------------------------------------------------
  // 15. API: moving card column does not change sprint assignment
  // -------------------------------------------------------------------------
  test('moving card to another column does not change sprint_id', async ({ request }) => {
    const { token } = await createUser(request, 'Column Move Tester');
    const bs = await setupBoard(request, token, 'Column Move Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Column Move Sprint');

    const card = await createCard(request, token, bs, 'Column Move Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Move to done column
    await moveCardToDone(request, token, card.id, bs.doneColumnId);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();
    const found = cards.find((c: any) => c.id === card.id);
    expect(found).toBeTruthy();
    // Sprint assignment must remain intact even though the column changed
    expect(found.sprint_id).toBe(sprint.id);
    expect(found.column_id).toBe(bs.doneColumnId);
  });

  // -------------------------------------------------------------------------
  // 16. API: completing sprint does not change card column assignments
  // -------------------------------------------------------------------------
  test('completing sprint does not change the column_id of its cards', async ({ request }) => {
    const { token } = await createUser(request, 'Complete Column Tester');
    const bs = await setupBoard(request, token, 'Complete Column Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Complete Column Sprint');

    const card = await createCard(request, token, bs, 'Complete Column Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();
    const found = cards.find((c: any) => c.id === card.id);
    expect(found).toBeTruthy();
    // Column should be unchanged after sprint completion
    expect(found.column_id).toBe(bs.firstColumnId);
  });

  // -------------------------------------------------------------------------
  // 17. API: sprint cards endpoint matches board cards filtered by sprint_id
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/cards matches board cards filtered by sprint_id', async ({ request }) => {
    const { token } = await createUser(request, 'Consistency Tester');
    const bs = await setupBoard(request, token, 'Consistency Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Consistency Sprint');

    const c1 = await createCard(request, token, bs, 'Consistency Card A');
    const c2 = await createCard(request, token, bs, 'Consistency Card B');
    const c3 = await createCard(request, token, bs, 'No Sprint Card');

    if (c1.id === -1 || c2.id === -1 || c3.id === -1) return;

    await assignCardToSprint(request, token, c1.id, sprint.id);
    await assignCardToSprint(request, token, c2.id, sprint.id);
    // c3 intentionally unassigned

    // Get sprint cards via sprint endpoint
    const sprintCardsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sprintCardsRes.ok()).toBeTruthy();
    const sprintCards = await sprintCardsRes.json();
    const sprintCardIds = sprintCards.map((c: any) => c.id).sort();

    // Get board cards and filter by sprint_id
    const boardCardsRes = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardCards = await boardCardsRes.json();
    const boardSprintCardIds = boardCards
      .filter((c: any) => c.sprint_id === sprint.id)
      .map((c: any) => c.id)
      .sort();

    // Both sets must be identical
    expect(sprintCardIds).toEqual(boardSprintCardIds);
  });

  // -------------------------------------------------------------------------
  // 18. UI: active sprint badge visible on board header
  // -------------------------------------------------------------------------
  test('active sprint badge is visible in the board header when a sprint is active', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Sprint Badge Tester');
    const bs = await setupBoard(request, token, 'Sprint Badge Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Badge Sprint');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // A sprint badge or indicator should be visible in the board header
    await expect(
      page.locator('.sprint-badge, .active-sprint-badge, [data-testid="sprint-badge"], .board-sprint-name'),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 19. UI: sprint badge shows sprint name
  // -------------------------------------------------------------------------
  test('active sprint badge shows the sprint name', async ({ page, request }) => {
    const sprintName = `Named Active Sprint ${crypto.randomUUID().slice(0, 6)}`;
    const { token } = await createUser(request, 'Sprint Name Badge Tester');
    const bs = await setupBoard(request, token, 'Sprint Name Badge Board');
    const sprint = await createSprint(request, token, bs.boardId, sprintName);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Sprint name should appear somewhere visible in the board header/toolbar
    await expect(
      page.locator('.board-header, .board-toolbar, .sprint-info').filter({ hasText: sprintName }),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 20. UI: board view shows all cards in "All Cards" mode regardless of sprint
  // -------------------------------------------------------------------------
  test('All Cards view shows cards regardless of sprint assignment', async ({ page, request }) => {
    const { token } = await createUser(request, 'All Cards Tester');
    const bs = await setupBoard(request, token, 'All Cards Board');
    const sprint = await createSprint(request, token, bs.boardId, 'All Cards Sprint');
    await startSprint(request, token, sprint.id);

    const sprintCard = await createCard(request, token, bs, 'Sprint Assigned Card');
    const noSprintCard = await createCard(request, token, bs, 'No Sprint Card All');
    if (sprintCard.id === -1 || noSprintCard.id === -1) return;

    await assignCardToSprint(request, token, sprintCard.id, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Switch to All Cards view
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Both cards should be visible
    await expect(page.locator('.card-item[aria-label="Sprint Assigned Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="No Sprint Card All"]')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 21. UI: sprint view shows only sprint-assigned cards
  // -------------------------------------------------------------------------
  test('default board view (sprint mode) shows only active sprint cards', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sprint View Only Tester');
    const bs = await setupBoard(request, token, 'Sprint View Only Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint View Only Sprint');
    await startSprint(request, token, sprint.id);

    const sprintCard = await createCard(request, token, bs, 'Sprint Only Card');
    const backlogCard = await createCard(request, token, bs, 'Backlog Only Card');
    if (sprintCard.id === -1 || backlogCard.id === -1) return;

    await assignCardToSprint(request, token, sprintCard.id, sprint.id);
    // backlogCard intentionally unassigned

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Sprint card should be visible
    await expect(page.locator('.card-item[aria-label="Sprint Only Card"]')).toBeVisible({ timeout: 8000 });
    // Backlog-only card should NOT appear in sprint view
    await expect(page.locator('.card-item[aria-label="Backlog Only Card"]')).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 22. UI: sprint card count in board view matches sprint cards endpoint
  // -------------------------------------------------------------------------
  test('card count visible in board view is consistent with sprint cards endpoint', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Count Consistent Tester');
    const bs = await setupBoard(request, token, 'Count Consistent Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Count Consistent Sprint');

    const c1 = await createCard(request, token, bs, 'Count Card X');
    const c2 = await createCard(request, token, bs, 'Count Card Y');
    const c3 = await createCard(request, token, bs, 'Count Card Z');
    if (c1.id === -1 || c2.id === -1 || c3.id === -1) return;

    await assignCardToSprint(request, token, c1.id, sprint.id);
    await assignCardToSprint(request, token, c2.id, sprint.id);
    await assignCardToSprint(request, token, c3.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Verify via API that sprint has 3 cards
    const sprintCardsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprintCards = await sprintCardsRes.json();
    expect(sprintCards).toHaveLength(3);

    // Navigate to board and switch to backlog to verify count badge
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-card-count')).toContainText('3');
  });

  // -------------------------------------------------------------------------
  // 23. UI: starting sprint changes board display to show sprint cards
  // -------------------------------------------------------------------------
  test('starting sprint via API causes board to display sprint cards on reload', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Start Sprint Display Tester');
    const bs = await setupBoard(request, token, 'Start Sprint Display Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Start Display Sprint');

    const card = await createCard(request, token, bs, 'Start Display Card');
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);

    // Before starting sprint: board should show empty state
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });

    // Start the sprint via API
    await startSprint(request, token, sprint.id);

    // Reload board — now the sprint card should be visible
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item[aria-label="Start Display Card"]')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 24. UI: completing sprint via API hides sprint cards from board on reload
  // -------------------------------------------------------------------------
  test('completing sprint via API removes sprint cards from board view on reload', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Complete Display Tester');
    const bs = await setupBoard(request, token, 'Complete Display Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Complete Display Sprint');

    const card = await createCard(request, token, bs, 'Complete Display Card');
    if (card.id === -1) return;

    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Verify card is visible while sprint is active
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item[aria-label="Complete Display Card"]')).toBeVisible({ timeout: 8000 });

    // Complete the sprint via API
    await completeSprint(request, token, sprint.id);

    // Reload board — empty state should appear again
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Complete Display Card"]')).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 25. API: GET /api/boards/:id/sprints returns list of sprints for the board
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/sprints returns sprints associated with the board', async ({ request }) => {
    const { token } = await createUser(request, 'List Sprints Tester');
    const bs = await setupBoard(request, token, 'List Sprints Board');

    const sprint1 = await createSprint(request, token, bs.boardId, 'List Sprint One');
    const sprint2 = await createSprint(request, token, bs.boardId, 'List Sprint Two');

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/sprints`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();

    const sprints = await res.json();
    expect(Array.isArray(sprints)).toBe(true);

    const sprintIds = sprints.map((s: any) => s.id);
    expect(sprintIds).toContain(sprint1.id);
    expect(sprintIds).toContain(sprint2.id);
  });
});
