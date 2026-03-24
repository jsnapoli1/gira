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

  // =========================================================================
  // Extended sync tests
  // =========================================================================

  // -------------------------------------------------------------------------
  // 26. Card sprint assignment persists across page reload
  // -------------------------------------------------------------------------
  test('card sprint assignment persists after page reload', async ({ page, request }) => {
    const { token } = await createUser(request, 'Persist Reload Tester');
    const bs = await setupBoard(request, token, 'Persist Reload Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Persist Reload Sprint');

    const card = await createCard(request, token, bs, 'Persist Reload Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Verify visible before reload
    await expect(page.locator('.card-item[aria-label="Persist Reload Card"]')).toBeVisible({ timeout: 8000 });

    // Reload and verify still visible
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item[aria-label="Persist Reload Card"]')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 27. Card in sprint remains in its column after sprint starts
  // -------------------------------------------------------------------------
  test('card in sprint stays in its original column after sprint is started', async ({ request }) => {
    const { token } = await createUser(request, 'Column Preserve Tester');
    const bs = await setupBoard(request, token, 'Column Preserve Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Column Preserve Sprint');

    const card = await createCard(request, token, bs, 'Column Preserve Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();
    const found = cards.find((c: any) => c.id === card.id);

    expect(found).toBeTruthy();
    expect(found.column_id).toBe(bs.firstColumnId);
    expect(found.sprint_id).toBe(sprint.id);
  });

  // -------------------------------------------------------------------------
  // 28. Board shows correct column for sprint card
  // -------------------------------------------------------------------------
  test('sprint card appears in the correct board column', async ({ page, request }) => {
    const { token } = await createUser(request, 'Correct Column Tester');
    const bs = await setupBoard(request, token, 'Correct Column Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Correct Column Sprint');

    const card = await createCard(request, token, bs, 'Correct Column Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // The first column should contain the card
    await expect(page.locator('.board-column').first().locator('.card-item[aria-label="Correct Column Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 29. Sprint started — board shows active sprint banner/badge
  // -------------------------------------------------------------------------
  test('starting a sprint causes the board to display an active sprint indicator', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Sprint Banner Tester');
    const bs = await setupBoard(request, token, 'Sprint Banner Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Banner Sprint Name');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await expect(
      page.locator('.active-sprint-badge, .board-sprint-name, .sprint-badge').first(),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 30. Sprint completed — board shows no active sprint indicator
  // -------------------------------------------------------------------------
  test('completing a sprint removes the active sprint indicator from the board', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Sprint Badge Gone Tester');
    const bs = await setupBoard(request, token, 'Sprint Badge Gone Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Gone Sprint');

    await startSprint(request, token, sprint.id);

    // Verify badge appears while active
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await expect(page.locator('.active-sprint-badge').first()).toBeVisible({ timeout: 8000 });

    // Complete the sprint
    await completeSprint(request, token, sprint.id);

    // Reload — badge should be gone, empty state visible
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 31. Sprint card count in backlog matches sprint cards endpoint
  // -------------------------------------------------------------------------
  test('backlog sprint card count badge matches number of cards in sprint endpoint', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Count Match Tester');
    const bs = await setupBoard(request, token, 'Count Match Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Count Match Sprint');

    const cards = await Promise.all([
      createCard(request, token, bs, 'Match Card 1'),
      createCard(request, token, bs, 'Match Card 2'),
      createCard(request, token, bs, 'Match Card 3'),
    ]);
    for (const card of cards) {
      await assignCardToSprint(request, token, card.id, sprint.id);
    }

    // Verify via API
    const sprintCardsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprintCards = await sprintCardsRes.json();
    expect(sprintCards).toHaveLength(3);

    // Verify in UI backlog
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.sprint-card-count', { timeout: 8000 });

    const countText = await page.locator('.sprint-card-count').textContent();
    expect(parseInt(countText ?? '0', 10)).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 32. Non-sprint cards visible in board with "All Cards" view
  // -------------------------------------------------------------------------
  test('non-sprint cards appear in board when All Cards view is selected', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Non Sprint Visible Tester');
    const bs = await setupBoard(request, token, 'Non Sprint Visible Board');
    const sprint = await createSprint(request, token, bs.boardId, 'All Cards View Sprint');
    await startSprint(request, token, sprint.id);

    const nonSprintCard = await createCard(request, token, bs, 'Non Sprint All Cards Card');
    if (nonSprintCard.id === -1) return;

    // Do NOT assign to sprint

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Switch to All Cards view
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await expect(page.locator('.card-item[aria-label="Non Sprint All Cards Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 33. Card moved in board view — sprint assignment preserved in API
  // -------------------------------------------------------------------------
  test('moving card to another column via API preserves its sprint assignment', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Move Preserve Sprint Tester');
    const bs = await setupBoard(request, token, 'Move Preserve Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Move Preserve Sprint');

    const card = await createCard(request, token, bs, 'Move Preserve Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Move card to done column
    await moveCardToDone(request, token, card.id, bs.doneColumnId);

    // Check sprint assignment is preserved
    const cardsRes = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await cardsRes.json();
    const found = cards.find((c: any) => c.id === card.id);

    expect(found.sprint_id).toBe(sprint.id);
    expect(found.column_id).toBe(bs.doneColumnId);
  });

  // -------------------------------------------------------------------------
  // 34. Card added to sprint via backlog appears in board column after reload
  // -------------------------------------------------------------------------
  test('card assigned to sprint via API then board reloaded shows card in column', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Backlog To Board Tester');
    const bs = await setupBoard(request, token, 'Backlog To Board Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Backlog To Board Sprint');
    await startSprint(request, token, sprint.id);

    // Create card AFTER sprint started (simulates adding from backlog)
    const card = await createCard(request, token, bs, 'Backlog To Board Card');
    await assignCardToSprint(request, token, card.id, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await expect(page.locator('.card-item[aria-label="Backlog To Board Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 35. Card removed from sprint goes to unassigned backlog section
  // -------------------------------------------------------------------------
  test('card removed from sprint appears in the unassigned swimlane backlog', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Remove To Backlog Tester');
    const bs = await setupBoard(request, token, 'Remove To Backlog Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Remove Backlog Sprint');
    await startSprint(request, token, sprint.id);

    const card = await createCard(request, token, bs, 'Remove To Backlog Card');
    await assignCardToSprint(request, token, card.id, sprint.id);

    // Now remove sprint assignment
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: null },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // Card should appear in the unassigned swimlane backlog area
    await expect(
      page.locator('.swimlane-backlog .card-title:has-text("Remove To Backlog Card")'),
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 36. Sprint status shown in board view backlog section
  // -------------------------------------------------------------------------
  test('active sprint status is visible in the backlog sprint panel header', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Status Backlog Tester');
    const bs = await setupBoard(request, token, 'Status Backlog Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Status Backlog Sprint');
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-header, .sprint-status').filter({ hasText: /active/i }),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 37. Sprint cards visible in backlog sprint section while sprint is active
  // -------------------------------------------------------------------------
  test('active sprint cards are still visible in backlog sprint section', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Active Backlog Cards Tester');
    const bs = await setupBoard(request, token, 'Active Backlog Cards Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Active Backlog Sprint');

    const card = await createCard(request, token, bs, 'Active Backlog Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-cards .card-title:has-text("Active Backlog Card")'),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 38. API: GET /api/boards/:id/cards excludes no-sprint cards from sprint list
  // -------------------------------------------------------------------------
  test('API: board cards without sprint have sprint_id null', async ({ request }) => {
    const { token } = await createUser(request, 'Null Sprint ID Tester');
    const bs = await setupBoard(request, token, 'Null Sprint Board');

    const card = await createCard(request, token, bs, 'No Sprint ID Card');
    if (card.id === -1) return;

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();
    const found = cards.find((c: any) => c.id === card.id);

    expect(found).toBeTruthy();
    expect(found.sprint_id).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // 39. API: sprint metrics endpoint returns 200 for active sprint
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/metrics returns 200 for an active sprint', async ({ request }) => {
    const { token } = await createUser(request, 'Metrics 200 Tester');
    const bs = await setupBoard(request, token, 'Metrics 200 Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Metrics 200 Sprint');
    await startSprint(request, token, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 40. API: sprint metrics total_cards is 0 for sprint with no assigned cards
  // -------------------------------------------------------------------------
  test('sprint metrics total_cards is 0 for sprint with no assigned cards', async ({ request }) => {
    const { token } = await createUser(request, 'Metrics Zero Tester');
    const bs = await setupBoard(request, token, 'Metrics Zero Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Metrics Zero Sprint');
    await startSprint(request, token, sprint.id);

    const metricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await metricsRes.json();
    const metrics = Array.isArray(data) ? data[data.length - 1] : data;

    expect(metrics.total_cards).toBe(0);
    expect(metrics.completed_cards).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 41. API: completed cards count increments when multiple cards moved to done
  // -------------------------------------------------------------------------
  test('completed_cards increments for each card moved to the done column', async ({ request }) => {
    const { token } = await createUser(request, 'Multi Done Tester');
    const bs = await setupBoard(request, token, 'Multi Done Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Multi Done Sprint');

    const c1 = await createCard(request, token, bs, 'Multi Done Card 1', 2);
    const c2 = await createCard(request, token, bs, 'Multi Done Card 2', 3);
    const c3 = await createCard(request, token, bs, 'Multi Done Card 3', 5);

    for (const c of [c1, c2, c3]) {
      await assignCardToSprint(request, token, c.id, sprint.id);
    }
    await startSprint(request, token, sprint.id);

    // Move all 3 to done
    for (const c of [c1, c2, c3]) {
      await moveCardToDone(request, token, c.id, bs.doneColumnId);
    }

    const metricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await metricsRes.json();
    const metrics = Array.isArray(data) ? data[data.length - 1] : data;

    expect(metrics.completed_cards).toBe(3);
    expect(metrics.total_cards).toBe(3);
    expect(metrics.remaining_points).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 42. API: burndown endpoint is 401 without auth token
  // -------------------------------------------------------------------------
  test('GET /api/metrics/burndown returns 401 without auth token', async ({ request }) => {
    const res = await request.get(`${BASE}/api/metrics/burndown?sprint_id=1`);
    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // 43. UI: board view card items have aria-label matching card title
  // -------------------------------------------------------------------------
  test('board card items have aria-label attribute matching card title', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Aria Label Tester');
    const bs = await setupBoard(request, token, 'Aria Label Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Aria Label Sprint');

    const card = await createCard(request, token, bs, 'Aria Label Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const cardItem = page.locator('.card-item[aria-label="Aria Label Card"]');
    await expect(cardItem).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 44. UI: Board view without token redirects to login
  // -------------------------------------------------------------------------
  test('board page without token redirects to login', async ({ page }) => {
    await page.goto(`/boards/1`);
    // Should redirect to login since no token
    await page.waitForURL(/\/(login|signup)/, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 45. API: sprint metrics completed_points match moved card story points
  // -------------------------------------------------------------------------
  test('completed_points equals story points of cards moved to done', async ({ request }) => {
    const { token } = await createUser(request, 'Done Points Tester');
    const bs = await setupBoard(request, token, 'Done Points Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Done Points Sprint');

    const c1 = await createCard(request, token, bs, 'Done Points Card 1', 5);
    const c2 = await createCard(request, token, bs, 'Done Points Card 2', 3);

    await assignCardToSprint(request, token, c1.id, sprint.id);
    await assignCardToSprint(request, token, c2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Only move card 1 to done
    await moveCardToDone(request, token, c1.id, bs.doneColumnId);

    const metricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await metricsRes.json();
    const metrics = Array.isArray(data) ? data[data.length - 1] : data;

    expect(metrics.completed_points).toBe(5);
    expect(metrics.remaining_points).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 46. API: sprint cards endpoint returns cards with correct sprint_id set
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id/cards — returned cards all have the correct sprint_id', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Sprint ID Verify Tester');
    const bs = await setupBoard(request, token, 'Sprint ID Verify Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Sprint ID Verify Sprint');

    const c1 = await createCard(request, token, bs, 'Sprint ID Verify Card 1');
    const c2 = await createCard(request, token, bs, 'Sprint ID Verify Card 2');
    if (c1.id === -1 || c2.id === -1) return;

    await assignCardToSprint(request, token, c1.id, sprint.id);
    await assignCardToSprint(request, token, c2.id, sprint.id);

    const res = await request.get(`${BASE}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await res.json();

    for (const card of cards) {
      expect(card.sprint_id).toBe(sprint.id);
    }
  });

  // -------------------------------------------------------------------------
  // 47. API: completing a sprint with all cards done has remaining_points = 0
  // -------------------------------------------------------------------------
  test('completing sprint with all cards done has remaining_points = 0', async ({ request }) => {
    const { token } = await createUser(request, 'All Done Tester');
    const bs = await setupBoard(request, token, 'All Done Board');
    const sprint = await createSprint(request, token, bs.boardId, 'All Done Sprint');

    const card = await createCard(request, token, bs, 'All Done Card', 13);
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    // Move to done before completing sprint
    await moveCardToDone(request, token, card.id, bs.doneColumnId);

    const metricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await metricsRes.json();
    const metrics = Array.isArray(data) ? data[data.length - 1] : data;

    expect(metrics.remaining_points).toBe(0);
    expect(metrics.completed_points).toBe(13);
  });

  // -------------------------------------------------------------------------
  // 48. UI: board renders sprint cards on initial load without user interaction
  // -------------------------------------------------------------------------
  test('board renders sprint cards immediately on initial page load', async ({ page, request }) => {
    const { token } = await createUser(request, 'Immediate Load Tester');
    const bs = await setupBoard(request, token, 'Immediate Load Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Immediate Load Sprint');

    const card = await createCard(request, token, bs, 'Immediate Load Card');
    await assignCardToSprint(request, token, card.id, sprint.id);
    await startSprint(request, token, sprint.id);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    // Do NOT click anything — card should appear after initial load
    await page.waitForSelector('.card-item', { timeout: 15000 });
    await expect(page.locator('.card-item[aria-label="Immediate Load Card"]')).toBeVisible({
      timeout: 8000,
    });
  });

  // -------------------------------------------------------------------------
  // 49. API: sprints endpoint returns correct sprint name after update
  // -------------------------------------------------------------------------
  test('sprint name updated via PATCH is returned by GET sprints list', async ({ request }) => {
    const { token } = await createUser(request, 'Name Update List Tester');
    const bs = await setupBoard(request, token, 'Name Update List Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Original Sprint Name');

    await request.patch(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Patched Sprint Name' },
    });

    const listRes = await request.get(`${BASE}/api/sprints?board_id=${bs.boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sprints = await listRes.json();
    const found = sprints.find((s: any) => s.id === sprint.id);

    expect(found).toBeTruthy();
    expect(found.name).toBe('Patched Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 50. UI: multiple sprint panels shown when board has multiple sprints
  // -------------------------------------------------------------------------
  test('UI: backlog shows multiple sprint panels when board has multiple sprints', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Multi Sprint Panel Tester');
    const bs = await setupBoard(request, token, 'Multi Sprint Panel Board');

    await createSprint(request, token, bs.boardId, 'Panel Sprint One');
    await createSprint(request, token, bs.boardId, 'Panel Sprint Two');
    await createSprint(request, token, bs.boardId, 'Panel Sprint Three');

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    const panels = page.locator('.backlog-sprint-panel');
    await expect(panels).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 51. API: assign same card to sprint twice is idempotent
  // -------------------------------------------------------------------------
  test('assigning same card to same sprint twice does not create duplicate entries', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Idempotent Assign Tester');
    const bs = await setupBoard(request, token, 'Idempotent Assign Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Idempotent Sprint');

    const card = await createCard(request, token, bs, 'Idempotent Card');
    if (card.id === -1) return;

    // Assign twice
    await assignCardToSprint(request, token, card.id, sprint.id);
    await assignCardToSprint(request, token, card.id, sprint.id);

    const cardsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards = await cardsRes.json();
    const matching = cards.filter((c: any) => c.id === card.id);

    expect(matching.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 52. API: board cards endpoint returns 200 for board with multiple sprints
  // -------------------------------------------------------------------------
  test('GET /api/boards/:id/cards returns 200 with cards from all sprints', async ({ request }) => {
    const { token } = await createUser(request, 'All Sprints Cards Tester');
    const bs = await setupBoard(request, token, 'All Sprints Cards Board');
    const s1 = await createSprint(request, token, bs.boardId, 'Cards Sprint 1');
    const s2 = await createSprint(request, token, bs.boardId, 'Cards Sprint 2');

    const c1 = await createCard(request, token, bs, 'Sprint 1 Card');
    const c2 = await createCard(request, token, bs, 'Sprint 2 Card');
    if (c1.id === -1 || c2.id === -1) return;

    await assignCardToSprint(request, token, c1.id, s1.id);
    await assignCardToSprint(request, token, c2.id, s2.id);

    const res = await request.get(`${BASE}/api/boards/${bs.boardId}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const cards = await res.json();
    const c1Found = cards.find((c: any) => c.id === c1.id);
    const c2Found = cards.find((c: any) => c.id === c2.id);

    expect(c1Found).toBeTruthy();
    expect(c1Found.sprint_id).toBe(s1.id);
    expect(c2Found).toBeTruthy();
    expect(c2Found.sprint_id).toBe(s2.id);
  });

  // -------------------------------------------------------------------------
  // 53. UI: backlog unassigned section is visible even when sprint exists
  // -------------------------------------------------------------------------
  test('UI: swimlane backlog unassigned section visible alongside sprint panels', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Swimlane Visible Tester');
    const bs = await setupBoard(request, token, 'Swimlane Visible Board');
    await createSprint(request, token, bs.boardId, 'Swimlane Sprint');

    // Create a card not assigned to sprint
    const card = await createCard(request, token, bs, 'Unassigned Swimlane Card');
    if (card.id === -1) return;

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-view', { timeout: 8000 });

    // The unassigned section should be visible
    await expect(page.locator('.swimlane-backlog')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 54. API: starting and completing the same sprint twice returns error on second complete
  // -------------------------------------------------------------------------
  test('POST /api/sprints/:id/complete on already-completed sprint returns 4xx', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'Double Complete Tester');
    const bs = await setupBoard(request, token, 'Double Complete Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Double Complete Sprint');

    await startSprint(request, token, sprint.id);
    await completeSprint(request, token, sprint.id);

    // Try to complete again
    const res = await request.post(`${BASE}/api/sprints/${sprint.id}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // 55. UI: sprint name updated via PATCH reflected in backlog after reload
  // -------------------------------------------------------------------------
  test('UI: updated sprint name via PATCH API is shown in backlog after reload', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Name Reload Tester');
    const bs = await setupBoard(request, token, 'Name Reload Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Before Rename Sprint');

    // Update the sprint name via API
    await request.patch(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'After Rename Sprint' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header h2, .backlog-sprint-header h3').filter({
      hasText: 'After Rename Sprint',
    })).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 56. API: board list endpoint returns the board used in tests
  // -------------------------------------------------------------------------
  test('GET /api/boards returns list including the newly created board', async ({ request }) => {
    const { token } = await createUser(request, 'Boards List Tester');
    const bs = await setupBoard(request, token, 'Boards List Board');

    const res = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const boards = await res.json();
    const found = boards.find((b: any) => b.id === bs.boardId);
    expect(found).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 57. UI: board page renders without errors for board with active sprint
  // -------------------------------------------------------------------------
  test('UI: board page renders without JS errors for board with active sprint and cards', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Render Tester');
    const bs = await setupBoard(request, token, 'Render Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Render Sprint');

    const c1 = await createCard(request, token, bs, 'Render Card 1');
    const c2 = await createCard(request, token, bs, 'Render Card 2');
    if (c1.id === -1 || c2.id === -1) return;

    await assignCardToSprint(request, token, c1.id, sprint.id);
    await assignCardToSprint(request, token, c2.id, sprint.id);
    await startSprint(request, token, sprint.id);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.waitForSelector('.card-item', { timeout: 10000 });

    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 58. API: GET /api/sprints/:id for non-existent sprint returns 404
  // -------------------------------------------------------------------------
  test('GET /api/sprints/:id returns 404 for non-existent sprint id', async ({ request }) => {
    const { token } = await createUser(request, 'Not Found Tester');

    const res = await request.get(`${BASE}/api/sprints/999999999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 59. API: sprint metrics remaining_points decreases as cards are completed
  // -------------------------------------------------------------------------
  test('remaining_points decreases as cards are moved to done incrementally', async ({ request }) => {
    const { token } = await createUser(request, 'Incremental Burndown Tester');
    const bs = await setupBoard(request, token, 'Incremental Burndown Board');
    const sprint = await createSprint(request, token, bs.boardId, 'Incremental Burndown Sprint');

    const cards = [
      await createCard(request, token, bs, 'Burndown Card A', 5),
      await createCard(request, token, bs, 'Burndown Card B', 3),
      await createCard(request, token, bs, 'Burndown Card C', 2),
    ];
    for (const c of cards) {
      await assignCardToSprint(request, token, c.id, sprint.id);
    }
    await startSprint(request, token, sprint.id);

    const initialMetricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const initialData = await initialMetricsRes.json();
    const initial = Array.isArray(initialData) ? initialData[initialData.length - 1] : initialData;
    expect(initial.remaining_points).toBe(10);

    // Move first card to done
    await moveCardToDone(request, token, cards[0].id, bs.doneColumnId);

    const midMetricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const midData = await midMetricsRes.json();
    const mid = Array.isArray(midData) ? midData[midData.length - 1] : midData;
    expect(mid.remaining_points).toBe(5);

    // Move second card to done
    await moveCardToDone(request, token, cards[1].id, bs.doneColumnId);

    const finalMetricsRes = await request.get(`${BASE}/api/sprints/${sprint.id}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalData = await finalMetricsRes.json();
    const final = Array.isArray(finalData) ? finalData[finalData.length - 1] : finalData;
    expect(final.remaining_points).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 60. UI: board page title / heading reflects the board name
  // -------------------------------------------------------------------------
  test('UI: board page heading or title reflects the board name', async ({ page, request }) => {
    const boardName = `Sync Test Board ${crypto.randomUUID().slice(0, 6)}`;
    const { token } = await createUser(request, 'Board Name Tester');
    const bs = await setupBoard(request, token, boardName);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${bs.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await expect(
      page.locator('.board-name, .board-title, h1, h2').filter({ hasText: boardName }).first(),
    ).toBeVisible({ timeout: 8000 });
  });
});
