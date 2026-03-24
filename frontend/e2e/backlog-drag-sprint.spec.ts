import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  firstColumnId: number;
}

async function createUser(request: any): Promise<{ token: string }> {
  const email = `test-bds-${crypto.randomUUID()}@example.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'DnD Tester' },
    })
  ).json();
}

async function setupBoardWithSprint(request: any, sprintName = 'Sprint 1'): Promise<BoardSetup> {
  const { token } = await createUser(request);

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'DnD Test Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const columns: Array<{ id: number; position: number; state: string }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);
  const firstColumnId = sortedColumns[0].id;

  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  return { token, boardId: board.id, sprintId: sprint.id, swimlaneId: swimlane.id, firstColumnId };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
): Promise<{ id: number }> {
  return (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, board_id: boardId, swimlane_id: swimlaneId, column_id: columnId },
    })
  ).json();
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Backlog DnD: Sprint Assignment', () => {
  // -------------------------------------------------------------------------
  // 1. Drag card from backlog to sprint — DnD not reliable in Playwright
  // -------------------------------------------------------------------------
  test.fixme(
    'drag card from backlog section into sprint drop zone',
    // @dnd-kit PointerSensor requires pointer events that Playwright cannot
    // reliably synthesise in headless mode. Use the API-based alternative in
    // test 4 instead.
    async ({ page, request }) => {
      const { token, boardId, sprintId, swimlaneId, firstColumnId } =
        await setupBoardWithSprint(request, 'Drag Target Sprint');

      const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Drag Me Card');

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await page.click('.view-btn:has-text("Backlog")');
      await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

      // Attempt pointer-based DnD from swimlane-backlog card to sprint drop zone
      const cardEl = page.locator('.swimlane-backlog .backlog-card').first();
      const sprintZone = page.locator('.backlog-sprint-cards').first();
      await cardEl.dragTo(sprintZone);

      // After drop the card should appear in the sprint section
      await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Drag Me Card');
      // Backlog section should be empty
      await expect(page.locator('.swimlane-backlog .backlog-card')).toHaveCount(0);
    },
  );

  // -------------------------------------------------------------------------
  // 2. Drag card between two sprints — DnD not reliable in Playwright
  // -------------------------------------------------------------------------
  test.fixme(
    'drag card from one sprint section into another sprint drop zone',
    // @dnd-kit PointerSensor — same issue as above.
    async ({ page, request }) => {
      const { token, boardId, sprintId, swimlaneId, firstColumnId } =
        await setupBoardWithSprint(request, 'Sprint Alpha');

      // Create a second sprint
      const sprint2 = await (
        await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { name: 'Sprint Beta' },
        })
      ).json();

      const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Inter-Sprint Card');
      await assignCardToSprint(request, token, card.id, sprintId);

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await page.click('.view-btn:has-text("Backlog")');
      await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

      // Drag from first sprint zone to second sprint zone
      const sourceZone = page.locator('.backlog-sprint-cards').first();
      const targetZone = page.locator('.backlog-sprint-cards').nth(1);
      await sourceZone.locator('.backlog-card').first().dragTo(targetZone);

      // Card should now be in sprint2's section
      const sprint2Header = page.locator('.backlog-sprint-header h2').filter({ hasText: 'Sprint Beta' });
      await expect(sprint2Header).toBeVisible();
      const sprint2Cards = sprint2Header.locator('~ .backlog-sprint-cards .card-title');
      await expect(sprint2Cards).toContainText('Inter-Sprint Card');
    },
  );

  // -------------------------------------------------------------------------
  // 3. Drag card from sprint back to backlog — DnD not reliable in Playwright
  // -------------------------------------------------------------------------
  test.fixme(
    'drag card from sprint section back to the unassigned backlog section',
    // @dnd-kit PointerSensor — same issue as above.
    async ({ page, request }) => {
      const { token, boardId, sprintId, swimlaneId, firstColumnId } =
        await setupBoardWithSprint(request, 'Drag Out Sprint');

      const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Return Card');
      await assignCardToSprint(request, token, card.id, sprintId);

      await page.addInitScript((t) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${boardId}`);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await page.click('.view-btn:has-text("Backlog")');
      await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

      // Drag from sprint drop zone to backlog section
      const sprintCard = page.locator('.backlog-sprint-cards .backlog-card').first();
      const backlogSection = page.locator('.swimlane-backlog').first();
      await sprintCard.dragTo(backlogSection);

      // Card should now appear under the swimlane backlog (unassigned)
      await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Return Card');
      // Sprint section should be empty
      await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible();
    },
  );

  // -------------------------------------------------------------------------
  // 4. API alternative — assign card to sprint, reload, card appears under
  //    sprint header
  // -------------------------------------------------------------------------
  test('API assign: card appears under sprint header after reload', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } =
      await setupBoardWithSprint(request, 'API Sprint');

    const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'API Assigned Card');
    await assignCardToSprint(request, token, card.id, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card should appear in the sprint section, NOT in the unassigned backlog
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('API Assigned Card');
    await expect(page.locator('.swimlane-backlog .backlog-card')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 5. API alternative — remove card from sprint, reload, card appears in
  //    unassigned section
  // -------------------------------------------------------------------------
  test('API remove: card moves to unassigned section after sprint removal via API', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } =
      await setupBoardWithSprint(request, 'Remove Sprint');

    const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Removed Card');
    // Assign then immediately remove (set sprint_id: null)
    await assignCardToSprint(request, token, card.id, sprintId);
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: null },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card must appear in the swimlane backlog (unassigned section)
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Removed Card');
    // Sprint section must be empty
    await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 6. Sprint card count badge shows correct count after API assignment
  // -------------------------------------------------------------------------
  test('sprint card count badge reflects the number of assigned cards', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } =
      await setupBoardWithSprint(request, 'Count Sprint');

    const card1 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count Card 1');
    const card2 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count Card 2');
    const card3 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count Card 3');

    await assignCardToSprint(request, token, card1.id, sprintId);
    await assignCardToSprint(request, token, card2.id, sprintId);
    await assignCardToSprint(request, token, card3.id, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // The sprint card count badge should say "3 cards"
    await expect(page.locator('.sprint-card-count')).toContainText('3');
  });

  // -------------------------------------------------------------------------
  // 7. Unassigned section — cards not in any sprint appear in unassigned area
  // -------------------------------------------------------------------------
  test('cards without a sprint appear in the unassigned backlog section', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } =
      await setupBoardWithSprint(request, 'Unassigned Sprint');

    // Create one card assigned to the sprint and one left unassigned
    const sprintCard = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      firstColumnId,
      'Sprint Member',
    );
    const backlogCard = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      firstColumnId,
      'Unassigned Member',
    );
    await assignCardToSprint(request, token, sprintCard.id, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // The sprint-assigned card must be in the sprint section
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Sprint Member');
    // The unassigned card must appear in the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Unassigned Member');
    // The unassigned card must NOT appear in the sprint section
    await expect(page.locator('.backlog-sprint-cards .card-title')).not.toContainText(
      'Unassigned Member',
    );
  });

  // -------------------------------------------------------------------------
  // 8. Sprint section collapsible — click sprint header, cards collapse/expand
  // -------------------------------------------------------------------------
  test('clicking sprint header collapses and re-expands the sprint card list', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } =
      await setupBoardWithSprint(request, 'Collapsible Sprint');

    const card = await createCard(
      request,
      token,
      boardId,
      swimlaneId,
      firstColumnId,
      'Collapsible Card',
    );
    await assignCardToSprint(request, token, card.id, sprintId);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Cards should be visible initially
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Collapsible Card');

    // Click the collapse toggle button (ChevronDown icon button inside the sprint header h2)
    await page.click('.backlog-sprint-collapse-btn');

    // Sprint cards section should no longer be visible
    await expect(page.locator('.backlog-sprint-cards')).not.toBeVisible({ timeout: 5000 });

    // Click again to re-expand
    await page.click('.backlog-sprint-collapse-btn');

    // Cards should be visible again
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Collapsible Card');
  });
});
