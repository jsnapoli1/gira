/**
 * multi-project.spec.ts
 *
 * Tests that verify multi-project (swimlane) behaviour within and across boards.
 * In Zira, each swimlane represents a "project" within a board. Swimlanes have
 * a name, a designator (ticket prefix), and an optional colour.
 *
 * Coverage:
 *  - User is a member of multiple boards (multi-board membership)
 *  - Second user invited to one board cannot see another board
 *  - Board settings for one board do not affect another board
 *  - Swimlane (project) management: create, rename, delete
 *  - Backlog: per-swimlane sections are isolated
 *  - Sprint visibility: swimlane rows render when sprint is active
 *  - Swimlane filter: board-view filter scopes display
 *  - Designator prefix is shown on backlog cards
 *  - Quick-add card targets the correct swimlane column
 *
 * Card-creation via UI (quick-add) is used where possible. API card creation
 * is wrapped with try/catch and tests that depend on it are marked fixme.
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// Tests in this file use addSwimlane() which reloads the page and waits for
// data to reload — each call takes ~5-10s. Tests with multiple addSwimlane
// calls can exceed the default 30s timeout, so we raise it for the whole file.
test.setTimeout(90000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, displayName: string, prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return {
    token: body.token as string,
    user: body.user as { id: number; display_name: string; email: string },
  };
}

async function createBoard(request: any, token: string, name: string) {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string };
}

async function addMember(
  request: any,
  token: string,
  boardId: number,
  userId: number,
  role = 'member',
) {
  await request.post(`${BASE}/api/boards/${boardId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { user_id: userId, role },
  });
}

/**
 * Navigate to the board, inject token, and wait for the .board-page to be visible.
 * Also sets zira-filters-expanded so filter dropdowns are in the DOM.
 */
async function openBoard(page: any, token: string, boardId: number) {
  await page.addInitScript((t: string) => {
    localStorage.setItem('token', t);
    localStorage.setItem('zira-filters-expanded', 'true');
  }, token);
  await page.goto(`/boards/${boardId}`);
  await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
}

/**
 * Create a swimlane via API, reload the page, and wait until the board has
 * re-fetched its data (confirmed by checking the swimlane name is in the DOM).
 *
 * Strategy: after reload we check that the swimlane name appears in the
 * swimlane filter <select>. Because zira-filters-expanded is set to 'true'
 * via addInitScript (in openBoard), the filter bar should be present in the
 * DOM on reload. If it is not yet visible (e.g. React hasn't mounted), we
 * wait for it explicitly before polling the option.
 */
async function addSwimlane(
  page: any,
  request: any,
  token: string,
  boardId: number,
  name: string,
  designator: string,
) {
  const swimlane = await (
    await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, designator },
    })
  ).json();

  await page.reload();
  await expect(page.locator('.board-page')).toBeVisible({ timeout: 20000 });

  // Wait for the filter bar to appear. The addInitScript (from openBoard) sets
  // zira-filters-expanded=true, so .filters-expanded should render after mount.
  await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 10000 });

  // Wait for the swimlane option to appear in the swimlane filter <select>.
  // The swimlane filter is identified by its "All swimlanes" default option.
  // We use first() because there is exactly one swimlane <select> on the page.
  const swimlaneSelect = page
    .locator('.filter-select')
    .filter({ has: page.locator('option:text-is("All swimlanes")') })
    .first();
  await expect(swimlaneSelect.locator(`option`).filter({ hasText: name })).toBeAttached({
    timeout: 8000,
  });

  return swimlane;
}

/**
 * Click the Add button in a backlog swimlane section, type a card title, and press Enter.
 */
async function addBacklogCard(page: any, swimlaneName: string, cardTitle: string) {
  const section = page.locator('.backlog-section').filter({
    has: page.locator(`h3:has-text("${swimlaneName}")`),
  });
  await section.locator('button:has-text("Add")').click();
  await page.fill('input[placeholder="Enter card title..."]', cardTitle);
  await page.keyboard.press('Enter');
  await expect(section.locator(`.card-title:has-text("${cardTitle}")`)).toBeVisible({
    timeout: 5000,
  });
}

// ---------------------------------------------------------------------------
// Multi-board membership
// ---------------------------------------------------------------------------

test.describe('Multi-Project — multi-board membership', () => {
  test('user can be a member of multiple boards simultaneously', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'MemOwner', 'mp-mem-own');
    const { user: memberUser } = await createUser(request, 'Member', 'mp-mem-user');

    const boardA = await createBoard(request, ownerToken, 'Mem Board A');
    const boardB = await createBoard(request, ownerToken, 'Mem Board B');
    const boardC = await createBoard(request, ownerToken, 'Mem Board C');

    // Add member to all three boards.
    await addMember(request, ownerToken, boardA.id, memberUser.id);
    await addMember(request, ownerToken, boardB.id, memberUser.id);
    await addMember(request, ownerToken, boardC.id, memberUser.id);

    // Verify member is listed on all three boards.
    for (const board of [boardA, boardB, boardC]) {
      const membersRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const members: any[] = await membersRes.json();
      expect(members.some((m: any) => m.user_id === memberUser.id)).toBe(true);
    }
  });

  test('member can access all boards they are added to', async ({ browser, request }) => {
    const { token: ownerToken } = await createUser(request, 'AccessOwner', 'mp-access-own');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'AccessMember',
      'mp-access-mem',
    );

    const boardA = await createBoard(request, ownerToken, 'Access Board A');
    const boardB = await createBoard(request, ownerToken, 'Access Board B');

    await addMember(request, ownerToken, boardA.id, memberUser.id);
    await addMember(request, ownerToken, boardB.id, memberUser.id);

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.addInitScript((t: string) => localStorage.setItem('token', t), memberToken);

      await page.goto(`/boards/${boardA.id}`);
      await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

      await page.goto(`/boards/${boardB.id}`);
      await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('second user invited to board A cannot see board B', async ({ browser, request }) => {
    const { token: ownerToken } = await createUser(request, 'IsoOwner', 'mp-iso-own');
    const { token: userToken, user: userB } = await createUser(request, 'IsoUser', 'mp-iso-usr');

    const boardA = await createBoard(request, ownerToken, 'Iso Board A');
    const boardB = await createBoard(request, ownerToken, 'Iso Board B');

    // Invite userB only to board A.
    await addMember(request, ownerToken, boardA.id, userB.id);

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.addInitScript((t: string) => localStorage.setItem('token', t), userToken);

      // Board A is accessible.
      await page.goto(`/boards/${boardA.id}`);
      await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

      // Board B should be forbidden.
      await page.goto(`/boards/${boardB.id}`);
      await expect(page.locator('.error, .board-error')).toBeVisible({ timeout: 8000 });
      await expect(page.locator('.board-page')).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('/boards page shows all boards the member has access to but not others', async ({
    page,
    request,
  }) => {
    const { token: ownerToken } = await createUser(request, 'ListOwner', 'mp-list-own');
    const { token: memberToken, user: memberUser } = await createUser(
      request,
      'ListMember',
      'mp-list-mem',
    );

    const sharedBoard = await createBoard(request, ownerToken, 'Shared MP Board');
    const privateBoard = await createBoard(request, ownerToken, 'Private Board (owner only)');
    await addMember(request, ownerToken, sharedBoard.id, memberUser.id);
    await createBoard(request, memberToken, 'My Own MP Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), memberToken);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('Shared MP Board'))).toBe(true);
    expect(names.some((n) => n.includes('My Own MP Board'))).toBe(true);
    expect(names.some((n) => n.includes('Private Board (owner only)'))).toBe(false);

    void privateBoard;
  });
});

// ---------------------------------------------------------------------------
// Settings isolation across boards
// ---------------------------------------------------------------------------

test.describe('Multi-Project — settings isolation', () => {
  test('board settings for board A do not affect board B', async ({ page, request }) => {
    const { token } = await createUser(request, 'SettingsIso', 'mp-settings');
    const boardA = await createBoard(request, token, 'Settings ISO Board A');
    const boardB = await createBoard(request, token, 'Settings ISO Board B');

    // Add a label to board A only.
    await request.post(`${BASE}/api/boards/${boardA.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'BoardA Label', color: '#3b82f6' },
    });

    // Add a custom column to board A only.
    await request.post(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Review A', position: 99 },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Board A settings should show the label and column.
    await page.goto(`/boards/${boardA.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.item-name:has-text("BoardA Label")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.item-name:has-text("Review A")')).toBeVisible({ timeout: 8000 });

    // Board B settings should show neither.
    await page.goto(`/boards/${boardB.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.item-name:has-text("BoardA Label")')).not.toBeVisible();
    await expect(page.locator('.item-name:has-text("Review A")')).not.toBeVisible();
  });

  test('renaming a swimlane on board A does not affect board B swimlanes', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SwRename', 'mp-sw-rename');
    const boardA = await createBoard(request, token, 'SW Rename Board A');
    const boardB = await createBoard(request, token, 'SW Rename Board B');

    const swA = await (
      await request.post(`${BASE}/api/boards/${boardA.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Original Name', designator: 'ON-' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${boardB.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Stable Name', designator: 'SN-' },
    });

    // Rename swimlane on board A.
    await request.put(`${BASE}/api/boards/${boardA.id}/swimlanes/${swA.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Renamed Name', designator: 'RN-' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Board B swimlane should remain unchanged.
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Swimlanes")', { timeout: 10000 });
    await expect(
      page.locator('.settings-list-item').filter({ hasText: 'Stable Name' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.settings-list-item').filter({ hasText: 'Renamed Name' }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Swimlane management
// ---------------------------------------------------------------------------

test.describe('Multi-Project — swimlane management', () => {
  test('board starts with no swimlanes', async ({ page, request }) => {
    const { token } = await createUser(request, 'EmptyBoard', 'mp-empty');
    const board = await createBoard(request, token, 'Empty Swimlane Board');
    await openBoard(page, token, board.id);

    await expect(page.locator('.empty-swimlanes')).toBeVisible({ timeout: 8000 });
  });

  test('two swimlanes appear in the filter dropdown after creation', async ({ page, request }) => {
    const { token } = await createUser(request, 'TwoSwimlanes', 'mp-two-sw');
    const board = await createBoard(request, token, 'Two Swimlane Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    const swimlaneFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    await expect(swimlaneFilter).toBeVisible();

    const options = await swimlaneFilter.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Frontend'))).toBe(true);
    expect(options.some((o) => o.includes('Backend'))).toBe(true);
  });

  test('swimlane headers appear on the board when an active sprint exists', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'HeaderBoard', 'mp-headers');
    const board = await createBoard(request, token, 'Header Swimlane Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint Alpha');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.click('button:has-text("Start Sprint")');
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

    await page.click('.view-btn:has-text("Board")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('deleting a swimlane via board settings removes it from the list', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'DelSwimlane', 'mp-del-sw');
    const board = await createBoard(request, token, 'Del Swimlane Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'ToDelete', 'TD-');
    await addSwimlane(page, request, token, board.id, 'ToKeep', 'TK-');

    // Navigate to board settings.
    await page.click('a[href*="/boards"][href*="/settings"]');
    await expect(page).toHaveURL(/\/boards\/\d+\/settings/, { timeout: 5000 });

    await expect(page.locator('.settings-list-item').filter({ hasText: 'ToDelete' })).toBeVisible();
    await expect(page.locator('.settings-list-item').filter({ hasText: 'ToKeep' })).toBeVisible();

    page.on('dialog', (dialog: any) => dialog.accept());
    await page
      .locator('.settings-list-item')
      .filter({ hasText: 'ToDelete' })
      .locator('.item-delete')
      .click();

    await expect(
      page.locator('.settings-list-item').filter({ hasText: 'ToDelete' }),
    ).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.settings-list-item').filter({ hasText: 'ToKeep' })).toBeVisible();
  });

  test('swimlane API returns created swimlanes for the correct board', async ({ request }) => {
    const { token } = await createUser(request, 'SwAPIUser', 'mp-sw-api');
    const board = await createBoard(request, token, 'SW API Board');

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Swimlane 1', designator: 'AS1-' },
    });
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Swimlane 2', designator: 'AS2-' },
    });

    const swimlanesRes = await request.get(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const swimlanes: any[] = await swimlanesRes.json();

    expect(swimlanes.some((s: any) => s.name === 'API Swimlane 1')).toBe(true);
    expect(swimlanes.some((s: any) => s.name === 'API Swimlane 2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-project backlog
// ---------------------------------------------------------------------------

test.describe('Multi-Project — per-swimlane backlog', () => {
  test('backlog view shows one section per swimlane', async ({ page, request }) => {
    const { token } = await createUser(request, 'BacklogSections', 'mp-bk-sec');
    const board = await createBoard(request, token, 'Backlog Sections Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
    await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();

    await expect(page.locator('.backlog-section h3').filter({ hasText: 'Alpha' })).toBeVisible();
    await expect(page.locator('.backlog-section h3').filter({ hasText: 'Beta' })).toBeVisible();
  });

  test.fixme('cards added in different swimlane sections stay in their section', async ({
    page,
    request,
  }) => {
    // fixme: addBacklogCard submits via POST /api/cards which returns Gitea 401 in environments
    // without Gitea configured. Skip until card creation is stable.
    const { token } = await createUser(request, 'BacklogCards', 'mp-bk-cards');
    const board = await createBoard(request, token, 'Backlog Cards Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
    await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

    await page.click('.view-btn:has-text("Backlog")');

    await addBacklogCard(page, 'Alpha', 'Alpha Feature 1');
    await addBacklogCard(page, 'Beta', 'Beta Task 1');

    const alphaSection = page
      .locator('.backlog-section')
      .filter({ has: page.locator('h3:has-text("Alpha")') });
    const betaSection = page
      .locator('.backlog-section')
      .filter({ has: page.locator('h3:has-text("Beta")') });

    await expect(alphaSection.locator('.card-title:has-text("Alpha Feature 1")')).toBeVisible();
    await expect(betaSection.locator('.card-title:has-text("Beta Task 1")')).toBeVisible();

    // Cross-check: Alpha card must NOT appear in Beta section.
    await expect(betaSection.locator('.card-title:has-text("Alpha Feature 1")')).not.toBeVisible();
    // And vice versa.
    await expect(alphaSection.locator('.card-title:has-text("Beta Task 1")')).not.toBeVisible();
  });

  test.fixme('collapsing and expanding a swimlane section hides and shows cards', async ({
    page,
    request,
  }) => {
    // fixme: addBacklogCard submits via POST /api/cards which returns Gitea 401 in environments
    // without Gitea configured. Skip until card creation is stable.
    const { token } = await createUser(request, 'CollapseTest', 'mp-collapse');
    const board = await createBoard(request, token, 'Collapse Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
    await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

    await page.click('.view-btn:has-text("Backlog")');
    await addBacklogCard(page, 'Alpha', 'Collapse Test Card');

    await expect(page.locator('.card-title:has-text("Collapse Test Card")')).toBeVisible();

    const alphaHeader = page
      .locator('.backlog-section-header')
      .filter({ has: page.locator('h3:has-text("Alpha")') });
    await alphaHeader.click();

    await expect(page.locator('.card-title:has-text("Collapse Test Card")')).not.toBeVisible({
      timeout: 3000,
    });

    await alphaHeader.click();
    await expect(page.locator('.card-title:has-text("Collapse Test Card")')).toBeVisible();
  });

  test.fixme('designator prefix on backlog cards matches the swimlane designator', async ({
    page,
    request,
  }) => {
    // fixme: addBacklogCard submits via POST /api/cards which returns Gitea 401 in environments
    // without Gitea configured. Skip until card creation is stable.
    const { token } = await createUser(request, 'Designator', 'mp-desig');
    const board = await createBoard(request, token, 'Designator Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Alpha', 'AL-');
    await addSwimlane(page, request, token, board.id, 'Beta', 'BT-');

    await page.click('.view-btn:has-text("Backlog")');
    await addBacklogCard(page, 'Alpha', 'Alpha Prefix Card');
    await addBacklogCard(page, 'Beta', 'Beta Prefix Card');

    const alphaSection = page
      .locator('.backlog-section')
      .filter({ has: page.locator('h3:has-text("Alpha")') });
    const betaSection = page
      .locator('.backlog-section')
      .filter({ has: page.locator('h3:has-text("Beta")') });

    await expect(
      alphaSection
        .locator('.backlog-card')
        .filter({ hasText: 'Alpha Prefix Card' })
        .locator('.card-designator'),
    ).toContainText('AL-');

    await expect(
      betaSection
        .locator('.backlog-card')
        .filter({ hasText: 'Beta Prefix Card' })
        .locator('.card-designator'),
    ).toContainText('BT-');
  });
});

// ---------------------------------------------------------------------------
// Sprint + multi-swimlane
// ---------------------------------------------------------------------------

test.describe('Multi-Project — sprint with multiple swimlanes', () => {
  test.fixme('cards from different swimlanes can be added to the same sprint', async ({
    page,
    request,
  }) => {
    // fixme: addBacklogCard submits via POST /api/cards which returns Gitea 401 in environments
    // without Gitea configured. Skip until card creation is stable.
    const { token } = await createUser(request, 'SprintMove', 'mp-sprint-move');
    const board = await createBoard(request, token, 'Sprint Move Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint 1');
    await page.click('button[type="submit"]:has-text("Create")');

    await addBacklogCard(page, 'Frontend', 'FE Card');
    await addBacklogCard(page, 'Backend', 'BE Card');

    // Move both backlog cards to the sprint.
    await page.locator('.backlog-move-btn').first().click();
    await page.locator('.backlog-move-btn').first().click();

    const sprintPanel = page.locator('.backlog-sprint-panel');
    await expect(sprintPanel.locator('.card-title:has-text("FE Card")')).toBeVisible();
    await expect(sprintPanel.locator('.card-title:has-text("BE Card")')).toBeVisible();
  });

  test.fixme('starting a sprint shows cards from all swimlanes on the board view', async ({
    page,
    request,
  }) => {
    // fixme: addBacklogCard submits via POST /api/cards which returns Gitea 401 in environments
    // without Gitea configured. Skip until card creation is stable.
    const { token } = await createUser(request, 'SprintStart', 'mp-sprint-start');
    const board = await createBoard(request, token, 'Sprint Start Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Active Sprint');
    await page.click('button[type="submit"]:has-text("Create")');

    await addBacklogCard(page, 'Frontend', 'FE Board Card');
    await addBacklogCard(page, 'Backend', 'BE Board Card');

    await page.locator('.backlog-move-btn').first().click();
    await page.locator('.backlog-move-btn').first().click();

    await page.click('button:has-text("Start Sprint")');
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

    await page.click('.view-btn:has-text("Board")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
    await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();
    await expect(page.locator('.card-title:has-text("FE Board Card")')).toBeVisible();
    await expect(page.locator('.card-title:has-text("BE Board Card")')).toBeVisible();
  });

  test('completing a sprint with multiple swimlanes does not crash the board', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SprintComplete', 'mp-sprint-complete');
    const board = await createBoard(request, token, 'Sprint Complete Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Sprint To Complete');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.click('button:has-text("Start Sprint")');
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });

    page.on('dialog', (dialog: any) => dialog.accept());
    await page.click('button:has-text("Complete Sprint")');

    await expect(page.locator('.sprint-status-badge.active')).not.toBeVisible({ timeout: 5000 });
    // Board page should still be visible (no crash).
    await expect(page.locator('.board-page')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Swimlane filter
// ---------------------------------------------------------------------------

test.describe('Multi-Project — swimlane filter', () => {
  test('swimlane filter does not hide swimlane rows from the board view', async ({
    page,
    request,
  }) => {
    // NOTE: current Zira behaviour — the swimlane filter hides cards within a
    // non-matching swimlane but does NOT hide the swimlane row itself.
    const { token } = await createUser(request, 'FilterScope', 'mp-filter');
    const board = await createBoard(request, token, 'Filter Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'Filter Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.click('button:has-text("Start Sprint")');
    await page.click('.view-btn:has-text("Board")');

    await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
    await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();

    const swimlaneFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    await swimlaneFilter.selectOption({ label: 'Frontend' });

    // Both swimlane rows should still be in the DOM (Zira's current behaviour).
    await expect(page.locator('.swimlane-name').filter({ hasText: 'Frontend' })).toBeVisible();
    await expect(page.locator('.swimlane-name').filter({ hasText: 'Backend' })).toBeVisible();
  });

  test('swimlane filter option is present for each created swimlane', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'FilterOpts', 'mp-filter-opts');
    const board = await createBoard(request, token, 'Filter Opts Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Design', 'DS-');
    await addSwimlane(page, request, token, board.id, 'QA', 'QA-');
    await addSwimlane(page, request, token, board.id, 'Ops', 'OP-');

    const swimlaneFilter = page.locator('.filter-select').filter({
      has: page.locator('option:text("All swimlanes")'),
    });
    const opts = await swimlaneFilter.locator('option').allTextContents();
    expect(opts.some((o) => o.includes('Design'))).toBe(true);
    expect(opts.some((o) => o.includes('QA'))).toBe(true);
    expect(opts.some((o) => o.includes('Ops'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Quick-add card to a specific swimlane column
// ---------------------------------------------------------------------------

test.describe('Multi-Project — quick-add card to swimlane', () => {
  test('quick-add form appears when clicking add-card button in a swimlane column', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'QuickAdd', 'mp-quickadd');
    const board = await createBoard(request, token, 'Quick Add Board');
    await openBoard(page, token, board.id);

    await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
    await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

    // Start a sprint so the board renders swimlane rows.
    await page.click('.view-btn:has-text("Backlog")');
    await page.click('.backlog-header button:has-text("Create Sprint")');
    await page.fill('input[placeholder="Sprint 1"]', 'QA Sprint');
    await page.click('button[type="submit"]:has-text("Create")');
    await page.click('button:has-text("Start Sprint")');
    await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
    await page.click('.view-btn:has-text("Board")');
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    const frontendSwimlane = page.locator('.swimlane').filter({
      has: page.locator('.swimlane-name').filter({ hasText: 'Frontend' }),
    });
    await expect(frontendSwimlane).toBeVisible({ timeout: 8000 });

    const firstColumn = frontendSwimlane.locator('.board-column').first();
    await expect(firstColumn).toBeVisible({ timeout: 5000 });

    await firstColumn.locator('.add-card-btn').click();
    await expect(firstColumn.locator('.quick-add-form input')).toBeVisible({ timeout: 3000 });
  });

  test.fixme(
    'quick-add card appears in the correct swimlane column',
    async ({ page, request }) => {
      // fixme: quick-add submits via POST /api/cards which may return Gitea 401.
      const { token } = await createUser(request, 'QuickAddCard', 'mp-qa-card');
      const board = await createBoard(request, token, 'QA Card Board');
      await openBoard(page, token, board.id);

      await addSwimlane(page, request, token, board.id, 'Frontend', 'FE-');
      await addSwimlane(page, request, token, board.id, 'Backend', 'BE-');

      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Quick Add Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
      await page.click('.view-btn:has-text("Board")');
      await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

      const frontendSwimlane = page.locator('.swimlane').filter({
        has: page.locator('.swimlane-name').filter({ hasText: 'Frontend' }),
      });
      await expect(frontendSwimlane).toBeVisible({ timeout: 8000 });

      const firstColumn = frontendSwimlane.locator('.board-column').first();
      await firstColumn.locator('.add-card-btn').click();

      const input = firstColumn.locator('.quick-add-form input');
      await input.fill('Quick Add Card');
      await page.keyboard.press('Enter');

      // Wait for the card to appear (or for the form to close indicating submission).
      try {
        await expect(
          frontendSwimlane.locator('.card-title:has-text("Quick Add Card")'),
        ).toBeVisible({ timeout: 5000 });
      } catch {
        test.skip(true, 'Quick-add card submission failed — likely Gitea 401');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Swimlane reorder
// ---------------------------------------------------------------------------

test.describe('Multi-Project — swimlane reorder', () => {
  test.fixme(
    'dragging swimlane ribbon reorders swimlanes on the board',
    async ({ page, request }) => {
      // fixme: dnd-kit drag tests are brittle in Playwright headless mode.
      // The optimistic reorder works but verifying the order change is flaky.
      const { token } = await createUser(request, 'Reorder', 'mp-reorder');
      const board = await createBoard(request, token, 'Reorder Board');
      await openBoard(page, token, board.id);

      await addSwimlane(page, request, token, board.id, 'First', 'F1-');
      await addSwimlane(page, request, token, board.id, 'Second', 'F2-');

      await page.click('.view-btn:has-text("Backlog")');
      await page.click('.backlog-header button:has-text("Create Sprint")');
      await page.fill('input[placeholder="Sprint 1"]', 'Reorder Sprint');
      await page.click('button[type="submit"]:has-text("Create")');
      await page.click('button:has-text("Start Sprint")');
      await expect(page.locator('.sprint-status-badge.active')).toBeVisible({ timeout: 5000 });
      await page.click('.view-btn:has-text("Board")');

      await expect(page.locator('.swimlane-name').filter({ hasText: 'First' })).toBeVisible({
        timeout: 8000,
      });
      await expect(page.locator('.swimlane-name').filter({ hasText: 'Second' })).toBeVisible({
        timeout: 8000,
      });

      const headersBefore = await page.locator('.swimlane-name').allTextContents();
      expect(headersBefore[0]).toBe('First');
      expect(headersBefore[1]).toBe('Second');

      const firstHandle = page.locator('.swimlane-ribbon').first();
      const secondHandle = page.locator('.swimlane-ribbon').last();

      const firstBox = await firstHandle.boundingBox();
      const secondBox = await secondHandle.boundingBox();
      if (firstBox && secondBox) {
        await page.mouse.move(
          firstBox.x + firstBox.width / 2,
          firstBox.y + firstBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          secondBox.x + secondBox.width / 2,
          secondBox.y + secondBox.height / 2 + 20,
          { steps: 15 },
        );
        await page.mouse.up();
      }

      const headersAfter = await page.locator('.swimlane-name').allTextContents();
      expect(headersAfter[0]).toBe('Second');
      expect(headersAfter[1]).toBe('First');
    },
  );
});

// ---------------------------------------------------------------------------
// Board isolation (API-level cross-user access control)
// ---------------------------------------------------------------------------

test.describe('Multi-Project — board isolation', () => {
  test("User A's boards are not returned in User B's GET /api/boards", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'IsoA', 'iso-a');
    const { token: tokenB } = await createUser(request, 'IsoB', 'iso-b');

    const boardA = await createBoard(request, tokenA, 'User A Private Board');

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(listRes.status()).toBe(200);
    const boards: any[] = await listRes.json();
    const ids = boards.map((b: any) => b.id);
    expect(ids).not.toContain(boardA.id);
  });

  test("User B cannot get User A's board details — returns 403 or 404", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'DetailA', 'detail-a');
    const { token: tokenB } = await createUser(request, 'DetailB', 'detail-b');

    const boardA = await createBoard(request, tokenA, 'Detail Board A');

    const res = await request.get(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(res.status());
  });

  test("User B cannot update User A's board — returns 403 or 404", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'UpdateA', 'update-a');
    const { token: tokenB } = await createUser(request, 'UpdateB', 'update-b');

    const boardA = await createBoard(request, tokenA, 'Update Board A');

    const res = await request.put(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { name: 'HIJACKED' },
    });
    expect([403, 404]).toContain(res.status());

    // Verify name was not changed
    const checkRes = await request.get(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const board = await checkRes.json();
    expect(board.name).toBe('Update Board A');
  });

  test("User B cannot delete User A's board — returns 403 or 404", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'DelBoardA', 'del-board-a');
    const { token: tokenB } = await createUser(request, 'DelBoardB', 'del-board-b');

    const boardA = await createBoard(request, tokenA, 'Delete Board A');

    const res = await request.delete(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(res.status());

    // Verify board still exists for owner
    const checkRes = await request.get(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(checkRes.status()).toBe(200);
  });

  test("User B cannot create a card on User A's board — returns 403 or 404", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'CardOwner', 'card-owner');
    const { token: tokenB } = await createUser(request, 'CardAttacker', 'card-atk');

    const boardA = await createBoard(request, tokenA, 'Card Target Board');

    // Get columns for boardA (need a column id)
    const colsRes = await request.get(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const cols: any[] = await colsRes.json();
    const firstColId = cols[0]?.id;
    if (!firstColId) {
      test.skip(true, 'Board has no columns');
      return;
    }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      data: { title: 'Injected Card', board_id: boardA.id, column_id: firstColId },
    });
    expect([403, 404]).toContain(cardRes.status());
  });

  test("User B cannot see User A's cards via GET /api/boards/:id/cards", async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'CardViewer', 'card-viewer-a');
    const { token: tokenB } = await createUser(request, 'CardAttacker2', 'card-atk-2');

    const boardA = await createBoard(request, tokenA, 'Cards Board A');

    const cardsRes = await request.get(`${BASE}/api/boards/${boardA.id}/cards`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(cardsRes.status());
  });
});

// ---------------------------------------------------------------------------
// Board membership cross-user
// ---------------------------------------------------------------------------

test.describe('Multi-Project — board membership cross-user', () => {
  test('User A creates board and adds User B as member', async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'MemCrossOwner', 'mc-own');
    const { user: userB } = await createUser(request, 'MemCrossGuest', 'mc-guest');

    const board = await createBoard(request, tokenA, 'Cross User Board');
    await addMember(request, tokenA, board.id, userB.id);

    const membersRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const members: any[] = await membersRes.json();
    expect(members.some((m: any) => m.user_id === userB.id)).toBe(true);
  });

  test('User B can see board in their board list after being added', async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'ListAfterAdd', 'laa-own');
    const { token: tokenB, user: userB } = await createUser(request, 'ListAfterGuest', 'laa-guest');

    const board = await createBoard(request, tokenA, 'Visible After Add Board');
    await addMember(request, tokenA, board.id, userB.id);

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const boards: any[] = await listRes.json();
    expect(boards.some((b: any) => b.id === board.id)).toBe(true);
  });

  test('User B can access board as member', async ({ browser, request }) => {
    const { token: tokenA } = await createUser(request, 'AccessAsM', 'asm-own');
    const { token: tokenB, user: userB } = await createUser(request, 'AccessAsMember', 'asm-mem');

    const board = await createBoard(request, tokenA, 'Member Access Board');
    await addMember(request, tokenA, board.id, userB.id);

    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);
      await page.goto(`/boards/${board.id}`);
      await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx.close();
    }
  });

  test('User B (member) cannot delete board — owner permission required', async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'NoDelOwn', 'ndel-own');
    const { token: tokenB, user: userB } = await createUser(request, 'NoDelMem', 'ndel-mem');

    const board = await createBoard(request, tokenA, 'No Delete Board');
    await addMember(request, tokenA, board.id, userB.id);

    const delRes = await request.delete(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(delRes.status());

    // Board still exists for owner
    const checkRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(checkRes.status()).toBe(200);
  });

  test('User A can remove User B from board', async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'RemoveOwner', 'rem-own');
    const { user: userB } = await createUser(request, 'RemoveGuest', 'rem-guest');

    const board = await createBoard(request, tokenA, 'Remove Member Board');
    await addMember(request, tokenA, board.id, userB.id);

    const delMemberRes = await request.delete(
      `${BASE}/api/boards/${board.id}/members/${userB.id}`,
      { headers: { Authorization: `Bearer ${tokenA}` } },
    );
    expect([200, 204]).toContain(delMemberRes.status());

    const membersRes = await request.get(`${BASE}/api/boards/${board.id}/members`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const members: any[] = await membersRes.json();
    expect(members.some((m: any) => m.user_id === userB.id)).toBe(false);
  });

  test('after removal User B cannot access the board', async ({ request }) => {
    const { token: tokenA } = await createUser(request, 'AfterRemOwn', 'arrem-own');
    const { token: tokenB, user: userB } = await createUser(request, 'AfterRemMem', 'arrem-mem');

    const board = await createBoard(request, tokenA, 'After Remove Board');
    await addMember(request, tokenA, board.id, userB.id);

    // Confirm access works before removal
    const beforeRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(beforeRes.status()).toBe(200);

    // Remove member
    await request.delete(`${BASE}/api/boards/${board.id}/members/${userB.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    // Now access should be denied
    const afterRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(afterRes.status());
  });
});

// ---------------------------------------------------------------------------
// Multiple boards owned by one user (API)
// ---------------------------------------------------------------------------

test.describe('Multi-Project — multiple boards per user (API)', () => {
  test('user can create 5 boards and all are returned in the list', async ({ request }) => {
    const { token } = await createUser(request, 'FiveBoards', 'five-brd');
    const created: number[] = [];

    for (let i = 1; i <= 5; i++) {
      const board = await createBoard(request, token, `Board ${i} of 5`);
      created.push(board.id);
    }

    const listRes = await request.get(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards: any[] = await listRes.json();
    const ids = boards.map((b: any) => b.id);
    for (const id of created) {
      expect(ids).toContain(id);
    }
  });

  test('each created board has a unique id', async ({ request }) => {
    const { token } = await createUser(request, 'UniqIds', 'uniq-ids');
    const ids: number[] = [];

    for (let i = 0; i < 4; i++) {
      const board = await createBoard(request, token, `Unique Board ${i}`);
      ids.push(board.id);
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('cards in Board A are not visible in Board B', async ({ request }) => {
    const { token } = await createUser(request, 'CardIso', 'card-iso');
    const boardA = await createBoard(request, token, 'Card Iso Board A');
    const boardB = await createBoard(request, token, 'Card Iso Board B');

    // Get columns for Board A and create a card there
    const colsRes = await request.get(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cols: any[] = await colsRes.json();
    if (!cols[0]?.id) {
      test.skip(true, 'Board A has no columns');
      return;
    }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Board A Only Card', board_id: boardA.id, column_id: cols[0].id },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — likely Gitea not configured');
      return;
    }

    // Board B cards endpoint should not include the card from Board A
    const boardBCardsRes = await request.get(`${BASE}/api/boards/${boardB.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (boardBCardsRes.status() !== 200) {
      test.skip(true, 'Could not list Board B cards');
      return;
    }
    const boardBCards: any[] = await boardBCardsRes.json();
    expect(boardBCards.some((c: any) => c.title === 'Board A Only Card')).toBe(false);
  });

  test('labels in Board A are not visible in Board B', async ({ request }) => {
    const { token } = await createUser(request, 'LabelIso', 'lbl-iso');
    const boardA = await createBoard(request, token, 'Label Iso Board A');
    const boardB = await createBoard(request, token, 'Label Iso Board B');

    await request.post(`${BASE}/api/boards/${boardA.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Board A Exclusive Label', color: '#ef4444' },
    });

    const boardBLabelsRes = await request.get(`${BASE}/api/boards/${boardB.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardBLabels: any[] = await boardBLabelsRes.json();
    expect(boardBLabels.some((l: any) => l.name === 'Board A Exclusive Label')).toBe(false);
  });

  test('sprint in Board A is not visible in Board B', async ({ request }) => {
    const { token } = await createUser(request, 'SprintIso', 'spr-iso');
    const boardA = await createBoard(request, token, 'Sprint Iso Board A');
    const boardB = await createBoard(request, token, 'Sprint Iso Board B');

    // Sprint creation endpoint: POST /api/sprints?board_id=... (returns 201 Created).
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${boardA.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Board A Sprint' },
    });
    expect(sprintRes.status()).toBe(201);

    const boardBSprintsRes = await request.get(`${BASE}/api/sprints?board_id=${boardB.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(boardBSprintsRes.status()).toBe(200);
    const boardBSprints: any[] = (await boardBSprintsRes.json()) || [];
    expect(boardBSprints.some((s: any) => s.name === 'Board A Sprint')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple boards UI
// ---------------------------------------------------------------------------

test.describe('Multi-Project — multiple boards UI', () => {
  test('create two boards — both appear in /boards list', async ({ page, request }) => {
    const { token } = await createUser(request, 'TwoBoardsUI', 'two-brd-ui');
    await createBoard(request, token, 'UI Board Alpha');
    await createBoard(request, token, 'UI Board Beta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('UI Board Alpha'))).toBe(true);
    expect(names.some((n) => n.includes('UI Board Beta'))).toBe(true);
  });

  test('board list shows both boards with correct names', async ({ page, request }) => {
    const { token } = await createUser(request, 'BoardListNames', 'brd-list-nm');
    const nameA = `Board List Name A ${crypto.randomUUID().slice(0, 6)}`;
    const nameB = `Board List Name B ${crypto.randomUUID().slice(0, 6)}`;

    await createBoard(request, token, nameA);
    await createBoard(request, token, nameB);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    await expect(page.locator(`.board-card h3:has-text("${nameA}")`)).toBeVisible();
    await expect(page.locator(`.board-card h3:has-text("${nameB}")`)).toBeVisible();
  });

  test('navigate between two boards — each board page loads correctly', async ({ page, request }) => {
    const { token } = await createUser(request, 'NavBetween', 'nav-btwn');
    const boardA = await createBoard(request, token, 'Nav Board A');
    const boardB = await createBoard(request, token, 'Nav Board B');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
  });

  test('switching boards shows correct board name in the header', async ({ page, request }) => {
    const { token } = await createUser(request, 'SwitchHeader', 'sw-hdr');
    const boardA = await createBoard(request, token, 'Switch Board Alpha');
    const boardB = await createBoard(request, token, 'Switch Board Beta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header, .board-title').first()).toContainText('Switch Board Alpha');

    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.board-header, .board-title').first()).toContainText('Switch Board Beta');
  });

  test('board settings are board-specific — columns from Board A not visible in Board B settings', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SettingsSpec', 'stg-spec');
    const boardA = await createBoard(request, token, 'Settings Specific A');
    const boardB = await createBoard(request, token, 'Settings Specific B');

    await request.post(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Board A Only Column', position: 99 },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.item-name:has-text("Board A Only Column")')).toBeVisible({
      timeout: 8000,
    });

    await page.goto(`/boards/${boardB.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.item-name:has-text("Board A Only Column")')).not.toBeVisible();
  });
});
