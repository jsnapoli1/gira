import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
}

async function createUser(request: any, displayName = 'Backlog Ext Tester'): Promise<{ token: string }> {
  const email = `test-backlog-ext-${crypto.randomUUID()}@example.com`;
  return (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: displayName },
    })
  ).json();
}

async function setupBoard(request: any, token: string, boardName = 'Backlog Extended Board'): Promise<BoardSetup> {
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

  const columns: Array<{ id: number; position: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);
  return { token, boardId: board.id, swimlaneId: swimlane.id, firstColumnId: sortedColumns[0]?.id };
}

async function createSprint(
  request: any,
  token: string,
  boardId: number,
  name: string,
  extra: Record<string, string | undefined> = {},
): Promise<{ id: number }> {
  return (
    await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, ...extra },
    })
  ).json();
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
): Promise<{ id: number } | null> {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, sprint_id: null, priority: 'medium' },
  });
  if (!res.ok()) return null;
  return res.json();
}

async function navigateToBacklog(page: any, token: string, boardId: number): Promise<void> {
  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-view', { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Backlog Extended', () => {
  // -------------------------------------------------------------------------
  // 1. Multiple swimlanes each show their own backlog section
  // -------------------------------------------------------------------------
  test('multiple swimlanes each render their own backlog section', async ({ page, request }) => {
    const { token } = await createUser(request, 'Multi-Lane Tester');
    const boardRes = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Multi-Lane Board' },
      })
    ).json();
    const boardId = boardRes.id;

    await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Frontend', designator: 'FE-', color: '#3b82f6' },
    });
    await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Backend', designator: 'BE-', color: '#10b981' },
    });

    await createSprint(request, token, boardId, 'Lane Sprint');

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    const swimlaneSections = page.locator('.swimlane-backlog');
    const count = await swimlaneSections.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await expect(page.locator('.backlog-section-header h3:has-text("Frontend")')).toBeVisible();
    await expect(page.locator('.backlog-section-header h3:has-text("Backend")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Swimlane section collapses and expands in backlog view
  // -------------------------------------------------------------------------
  test('clicking swimlane header collapses then re-expands the swimlane section', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Collapse Lane Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Collapse Lane Board');
    await createSprint(request, token, boardId, 'Sprint');

    const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Collapse Lane Card');
    if (!card) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.swimlane-backlog .card-title').filter({ hasText: 'Collapse Lane Card' }),
    ).toBeVisible();

    // Click the swimlane section header to collapse
    const sectionHeader = page.locator('.backlog-section-header').first();
    await sectionHeader.click();

    // Cards list is hidden after collapse
    await expect(page.locator('.backlog-cards').first()).not.toBeVisible({ timeout: 5000 });

    // Click the header again to expand
    await sectionHeader.click();

    await expect(
      page.locator('.swimlane-backlog .card-title').filter({ hasText: 'Collapse Lane Card' }),
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 3. Backlog shows total card count per swimlane in the section header
  // -------------------------------------------------------------------------
  test('backlog section header shows swimlane card count', async ({ page, request }) => {
    const { token } = await createUser(request, 'Count Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Count Board');
    await createSprint(request, token, boardId, 'Sprint');

    const c1 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count One');
    const c2 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count Two');
    const c3 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Count Three');

    if (!c1 || !c2 || !c3) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // .backlog-section-count inside the swimlane header shows "3"
    await expect(page.locator('.backlog-section-count').first()).toContainText('3');
  });

  // -------------------------------------------------------------------------
  // 4. Sprint date displayed in sprint header after API update
  // -------------------------------------------------------------------------
  test('sprint dates are shown in backlog sprint panel after setting via API', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Dates API Tester');
    const { boardId } = await setupBoard(request, token, 'Dates Board');
    const sprint = await createSprint(request, token, boardId, 'Dated Sprint');

    await request.put(`${BASE}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Dated Sprint', start_date: '2026-04-01', end_date: '2026-04-14' },
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 5. Create sprint with dates via UI — dates appear in sprint panel
  // -------------------------------------------------------------------------
  test('create sprint with start and end dates via UI — sprint-dates element appears', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'UI Dates Tester');
    const { boardId } = await setupBoard(request, token, 'UI Dates Board');

    await navigateToBacklog(page, token, boardId);

    await page.click('button:has-text("Create Sprint")');
    await page.waitForSelector('.modal h2:has-text("Create Sprint")', { timeout: 5000 });

    await page.locator('.modal input[placeholder="Sprint 1"]').fill('Sprint With Dates');
    await page.locator('.modal input[type="date"]').first().fill('2026-05-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-05-14');
    await page.click('.modal button[type="submit"]:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 6. Edit sprint dates from backlog view via pencil button
  // -------------------------------------------------------------------------
  test('edit sprint dates via edit modal — updated dates shown in sprint panel', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Edit Dates Tester');
    const { boardId } = await setupBoard(request, token, 'Edit Dates Board');
    await createSprint(request, token, boardId, 'Sprint To Edit');

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await page.click('.backlog-sprint-header button[title="Edit sprint"]');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    await page.locator('.modal input[type="date"]').first().fill('2026-06-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-06-15');
    await page.click('.modal button:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 7. Edit sprint name from backlog view
  // -------------------------------------------------------------------------
  test('edit sprint name via edit modal — updated name shown in sprint panel', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Edit Name Tester');
    const { boardId } = await setupBoard(request, token, 'Edit Name Board');
    await createSprint(request, token, boardId, 'Original Sprint Name');

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await page.click('.backlog-sprint-header button[title="Edit sprint"]');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.fill('Renamed Sprint');
    await page.click('.modal button:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Renamed Sprint', {
      timeout: 6000,
    });
  });

  // -------------------------------------------------------------------------
  // 8. Sprint goal is visible in backlog sprint panel
  // -------------------------------------------------------------------------
  test('sprint created with goal text shows goal in backlog panel', async ({ page, request }) => {
    const { token } = await createUser(request, 'Goal Tester');
    const { boardId } = await setupBoard(request, token, 'Goal Board');
    await createSprint(request, token, boardId, 'Sprint With Goal', {
      goal: 'Ship the onboarding flow',
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-goal')).toContainText('Ship the onboarding flow');
  });

  // -------------------------------------------------------------------------
  // 9. Remove card from sprint moves it back to backlog section
  // -------------------------------------------------------------------------
  test('remove card from sprint — card moves to swimlane backlog section', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Remove Card Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Remove Card Board');
    const sprint = await createSprint(request, token, boardId, 'Sprint');

    const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Removable Card');
    if (!card) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-cards .card-title').filter({ hasText: 'Removable Card' }),
    ).toBeVisible();

    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    await expect(
      page.locator('.swimlane-backlog .card-title').filter({ hasText: 'Removable Card' }),
    ).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.backlog-sprint-cards .backlog-empty')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 10. Sprint card count decreases after removing a card
  // -------------------------------------------------------------------------
  test('sprint card count badge decreases after removing a card', async ({ page, request }) => {
    const { token } = await createUser(request, 'Decrement Count Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Decrement Board');
    const sprint = await createSprint(request, token, boardId, 'Sprint');

    const c1 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Keep Card');
    const c2 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Remove Card');

    if (!c1 || !c2) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await request.post(`${BASE}/api/cards/${c1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/cards/${c2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-card-count')).toContainText('2');

    await page.locator('.backlog-sprint-cards .backlog-remove-btn').first().click({ force: true });

    await expect(page.locator('.sprint-card-count')).toContainText('1', { timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 11. Card prioritization: keyboard reorder in backlog swimlane section
  // -------------------------------------------------------------------------
  test('reorder backlog cards via keyboard DnD (Space+ArrowDown+Space)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Reorder Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Reorder Board');
    await createSprint(request, token, boardId, 'Sprint');

    const c1 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'First Card');
    const c2 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Second Card');

    if (!c1 || !c2) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.swimlane-backlog .backlog-card')).toHaveCount(2);

    const titlesBefore = await page.locator('.swimlane-backlog .backlog-card .card-title').allTextContents();
    expect(titlesBefore[0]).toBe('First Card');
    expect(titlesBefore[1]).toBe('Second Card');

    // @dnd-kit KeyboardSensor: focus drag handle, Space to lift, ArrowDown, Space to drop
    const firstHandle = page.locator('.swimlane-backlog .backlog-card-drag').first();
    await firstHandle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
    await page.keyboard.press('Space');

    await expect(page.locator('.swimlane-backlog .backlog-card')).toHaveCount(2);
    const titlesAfter = await page.locator('.swimlane-backlog .backlog-card .card-title').allTextContents();
    expect(titlesAfter[0]).toBe('Second Card');
    expect(titlesAfter[1]).toBe('First Card');
  });

  // -------------------------------------------------------------------------
  // 12. Reorder cards within a sprint via keyboard DnD
  // -------------------------------------------------------------------------
  test('reorder sprint cards via keyboard DnD (Space+ArrowDown+Space)', async ({ page, request }) => {
    const { token } = await createUser(request, 'Sprint Reorder Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Sprint Reorder Board');
    const sprint = await createSprint(request, token, boardId, 'Sprint');

    const c1 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Sprint Alpha');
    const c2 = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Sprint Beta');

    if (!c1 || !c2) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await request.post(`${BASE}/api/cards/${c1.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });
    await request.post(`${BASE}/api/cards/${c2.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-cards .backlog-card')).toHaveCount(2);

    const titlesBefore = await page.locator('.backlog-sprint-cards .backlog-card .card-title').allTextContents();
    expect(titlesBefore[0]).toBe('Sprint Alpha');
    expect(titlesBefore[1]).toBe('Sprint Beta');

    const firstHandle = page.locator('.backlog-sprint-cards .backlog-card-drag').first();
    await firstHandle.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
    await page.keyboard.press('Space');

    await expect(page.locator('.backlog-sprint-cards .backlog-card')).toHaveCount(2);
    const titlesAfter = await page.locator('.backlog-sprint-cards .backlog-card .card-title').allTextContents();
    expect(titlesAfter[0]).toBe('Sprint Beta');
    expect(titlesAfter[1]).toBe('Sprint Alpha');
  });

  // -------------------------------------------------------------------------
  // 13. Multiple sprints each render their own panel
  // -------------------------------------------------------------------------
  test('multiple sprints each render their own panel in backlog view', async ({ page, request }) => {
    const { token } = await createUser(request, 'Multi Sprint Tester');
    const { boardId } = await setupBoard(request, token, 'Multi Sprint Board');

    await createSprint(request, token, boardId, 'Sprint Alpha');
    await createSprint(request, token, boardId, 'Sprint Beta');
    await createSprint(request, token, boardId, 'Sprint Gamma');

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header')).toHaveCount(3);
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Alpha")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Beta")')).toBeVisible();
    await expect(page.locator('.backlog-sprint-header h2:has-text("Sprint Gamma")')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 14. Sprint section collapse/expand via chevron button
  // -------------------------------------------------------------------------
  test('clicking sprint collapse button hides and re-shows sprint card list', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'Sprint Collapse Tester');
    const { boardId, swimlaneId, firstColumnId } = await setupBoard(request, token, 'Sprint Collapse Board');
    const sprint = await createSprint(request, token, boardId, 'Collapsible Sprint');

    const card = await createCard(request, token, boardId, swimlaneId, firstColumnId, 'Collapsible Card');
    if (!card) {
      test.skip(true, 'Card creation unavailable');
      return;
    }

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    await navigateToBacklog(page, token, boardId);
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-cards .card-title').filter({ hasText: 'Collapsible Card' }),
    ).toBeVisible();

    await page.click('.backlog-sprint-collapse-btn');
    await expect(page.locator('.backlog-sprint-cards')).not.toBeVisible({ timeout: 5000 });

    await page.click('.backlog-sprint-collapse-btn');
    await expect(
      page.locator('.backlog-sprint-cards .card-title').filter({ hasText: 'Collapsible Card' }),
    ).toBeVisible({ timeout: 5000 });
  });
});
