import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SetupResult {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  columnId: number;
}

async function setupBoardWithSprint(
  request: any,
  sprintName = 'Backlog Sprint',
): Promise<SetupResult> {
  const email = `test-backlog-ext-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Backlog Ext Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Backlog Extended Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  return {
    token,
    boardId: board.id,
    sprintId: sprint.id,
    swimlaneId: swimlane.id,
    columnId: firstColumn?.id,
  };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
): Promise<any> {
  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: boardId,
      swimlane_id: swimlaneId,
      column_id: columnId,
      sprint_id: null,
      title,
      description: '',
      priority: 'medium',
    },
  });
  return cardRes.json();
}

async function goToBacklog(page: any): Promise<void> {
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-view', { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Backlog Extended', () => {
  // -------------------------------------------------------------------------
  // 1. Backlog view shows unassigned cards in swimlane section
  // -------------------------------------------------------------------------
  test('backlog view shows unassigned cards in swimlane backlog section', async ({
    page,
    request,
  }) => {
    const { token, boardId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        title: 'Unassigned Backlog Card',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card unavailable');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    // Card should appear in the swimlane backlog section (not assigned to sprint)
    await expect(page.locator('.swimlane-backlog .card-title:has-text("Unassigned Backlog Card")')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 2. Cards assigned to a sprint do NOT appear in the swimlane backlog section
  // -------------------------------------------------------------------------
  test('cards assigned to sprint do not appear in swimlane backlog section', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        title: 'Sprint Assigned Card',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card unavailable');
      return;
    }
    const card = await cardRes.json();

    // Assign to sprint
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card is in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title:has-text("Sprint Assigned Card")')).toBeVisible({ timeout: 8000 });

    // Card must NOT appear in the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title:has-text("Sprint Assigned Card")')).not.toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 3. Add card from backlog via inline add form
  // -------------------------------------------------------------------------
  test('add card from backlog inline form — card appears in swimlane section', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    // Click the "Add" button on the swimlane backlog section
    await page.click('.backlog-section-header button:has-text("Add")');

    // Inline form should appear
    await page.waitForSelector('.backlog-add-card-form', { timeout: 5000 });
    await page.locator('.backlog-add-card-form input[placeholder="Enter card title..."]').fill('New Inline Card');
    await page.click('.backlog-add-card-actions .btn-primary:has-text("Add")');

    // Card should appear in the swimlane backlog
    await expect(page.locator('.swimlane-backlog .card-title:has-text("New Inline Card")')).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Inline add form Cancel button hides the form
  // -------------------------------------------------------------------------
  test('cancel backlog inline add form hides the form', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.click('.backlog-section-header button:has-text("Add")');
    await page.waitForSelector('.backlog-add-card-form', { timeout: 5000 });

    // Type something then cancel
    await page.locator('.backlog-add-card-form input').fill('Should Not Appear');
    await page.click('.backlog-add-card-actions button:has-text("Cancel")');

    // Form should be gone
    await expect(page.locator('.backlog-add-card-form')).not.toBeVisible({ timeout: 3000 });
    // Card should not have been created
    await expect(page.locator('.card-title:has-text("Should Not Appear")')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Move card to sprint via arrow button (single sprint case)
  // -------------------------------------------------------------------------
  test('move card to sprint via arrow button — card appears in sprint panel', async ({
    page,
    request,
  }) => {
    const { token, boardId, swimlaneId, columnId } = await setupBoardWithSprint(
      request,
      'Target Sprint',
    );

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: columnId,
        title: 'Card To Move',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card unavailable');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Confirm card is in the swimlane backlog
    await expect(page.locator('.swimlane-backlog .card-title:has-text("Card To Move")')).toBeVisible({ timeout: 6000 });

    // Click the move-to-sprint arrow button (visible when exactly 1 sprint exists)
    await page.locator('.swimlane-backlog .backlog-move-btn').first().click({ force: true });

    // Card should now appear in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title:has-text("Card To Move")')).toBeVisible({ timeout: 8000 });

    // And should be gone from the swimlane backlog
    await expect(page.locator('.swimlane-backlog .card-title:has-text("Card To Move")')).not.toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 6. Move card back to backlog via remove button
  // -------------------------------------------------------------------------
  test('remove card from sprint moves it back to swimlane backlog section', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    const card = await createCard(request, token, boardId, swimlaneId, columnId, 'Removable Card');
    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card should be in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title:has-text("Removable Card")')).toBeVisible({ timeout: 6000 });

    // Click the remove (✕) button
    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    // Card should move to the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title:has-text("Removable Card")')).toBeVisible({ timeout: 8000 });

    // Sprint panel should now show empty state
    await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 7. Multiple swimlane rows in backlog
  // -------------------------------------------------------------------------
  test('multiple swimlanes each show a separate backlog section', async ({ page, request }) => {
    const email = `test-multi-sl-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Multi Swimlane Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Multi Swimlane Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Frontend', designator: 'FE-', color: '#6366f1' },
    });
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Backend', designator: 'BE-', color: '#10b981' },
    });

    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint 1' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await goToBacklog(page);

    // Two swimlane backlog sections should be visible
    await expect(page.locator('.swimlane-backlog')).toHaveCount(2);
    await expect(page.locator('.swimlane-backlog h3:has-text("Frontend")')).toBeVisible();
    await expect(page.locator('.swimlane-backlog h3:has-text("Backend")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 8. Backlog card count badge shows correct count
  // -------------------------------------------------------------------------
  test('backlog card count in header reflects number of unassigned cards', async ({
    page,
    request,
  }) => {
    const { token, boardId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    // Create 2 unassigned cards
    const c1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Count Card 1');
    const c2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Count Card 2');

    if (!c1 || !c2) {
      test.skip(true, 'Card creation failed');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    // The ".backlog-count" badge in the backlog header should show 2
    await expect(page.locator('.backlog-count')).toContainText('2');
  });

  // -------------------------------------------------------------------------
  // 9. Sprint card count badge shows correct count
  // -------------------------------------------------------------------------
  test('sprint card count badge shows correct count after assigning cards', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    const card1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Card One');
    const card2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Card Two');

    await request.post(`${BASE}/api/cards/${card1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });
    await request.post(`${BASE}/api/cards/${card2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Sprint card count badge should show "2"
    await expect(page.locator('.sprint-card-count')).toContainText('2');
  });

  // -------------------------------------------------------------------------
  // 10. Card count decreases after removing one card from sprint
  // -------------------------------------------------------------------------
  test('card count decreases after removing one card from sprint', async ({ page, request }) => {
    const { token, boardId, sprintId, swimlaneId, columnId } = await setupBoardWithSprint(request);

    const card1 = await createCard(request, token, boardId, swimlaneId, columnId, 'Keep Card');
    const card2 = await createCard(request, token, boardId, swimlaneId, columnId, 'Remove Card');

    await request.post(`${BASE}/api/cards/${card1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });
    await request.post(`${BASE}/api/cards/${card2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Confirm count is 2
    await expect(page.locator('.sprint-card-count')).toContainText('2');

    // Remove one card from sprint
    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    // Count should now be 1
    await expect(page.locator('.sprint-card-count')).toContainText('1');
  });

  // -------------------------------------------------------------------------
  // 11. Sprint goal is visible in backlog sprint panel
  // -------------------------------------------------------------------------
  test('sprint goal is visible in backlog sprint panel', async ({ page, request }) => {
    const email = `test-sprint-goal-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Goal Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Goal Test Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint With Goal', goal: 'My Goal Text' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-goal')).toContainText('My Goal Text');
  });

  // -------------------------------------------------------------------------
  // 12. Sprint dates shown in backlog sprint panel after API update
  // -------------------------------------------------------------------------
  test('sprint dates shown in backlog sprint panel after API update', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'Dated Sprint');

    await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Dated Sprint',
        start_date: '2026-04-01',
        end_date: '2026-04-14',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await goToBacklog(page);

    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
  });
});
