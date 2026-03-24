/**
 * multi-board.spec.ts
 *
 * Tests that verify boards are fully isolated from one another. Resources
 * created on board A (labels, sprints, columns, swimlanes, members) must not
 * bleed into board B, and vice versa.
 *
 * Card-creation tests are wrapped with try/catch and use test.fixme where the
 * POST /api/cards endpoint may return Gitea 401 in some environments.
 */

import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function createLabel(
  request: any,
  token: string,
  boardId: number,
  name: string,
  color = '#ef4444',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, color },
  });
  return (await res.json()) as { id: number; name: string };
}

async function createSprint(request: any, token: string, boardId: number, name: string) {
  const res = await request.post(`${BASE}/api/sprints?board_id=${boardId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return (await res.json()) as { id: number; name: string };
}

async function createSwimlane(request: any, token: string, boardId: number, name: string) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator: 'MB-', color: '#6366f1' },
  });
  return (await res.json()) as { id: number; name: string };
}

async function getColumns(request: any, token: string, boardId: number) {
  const res = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as { id: number; name: string; state: string }[];
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

/** Attempt to create a card, returning { ok, card }. Gracefully handles Gitea 401. */
async function tryCreateCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
): Promise<{ ok: boolean; card: any }> {
  try {
    const res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { board_id: boardId, swimlane_id: swimlaneId, column_id: columnId, title },
    });
    if (!res.ok()) return { ok: false, card: null };
    const card = await res.json();
    if (!card || !card.id) return { ok: false, card: null };
    return { ok: true, card };
  } catch {
    return { ok: false, card: null };
  }
}

// ---------------------------------------------------------------------------
// Board list isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — board list', () => {
  test('user can own multiple boards and all appear in /boards list', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'MultiOwner', 'mb-own');
    await createBoard(request, token, 'Alpha Board');
    await createBoard(request, token, 'Beta Board');
    await createBoard(request, token, 'Gamma Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('Alpha Board'))).toBe(true);
    expect(names.some((n) => n.includes('Beta Board'))).toBe(true);
    expect(names.some((n) => n.includes('Gamma Board'))).toBe(true);
  });

  test('/boards page shows only boards the user has access to', async ({ page, request }) => {
    const { token: tokenOwner } = await createUser(request, 'ListOwner', 'mb-list-own');
    const { token: tokenMember, user: userMember } = await createUser(
      request,
      'ListMember',
      'mb-list-mem',
    );

    const ownedBoard = await createBoard(request, tokenOwner, 'Owner Only Board');
    const sharedBoard = await createBoard(request, tokenOwner, 'Shared Board');
    await addMember(request, tokenOwner, sharedBoard.id, userMember.id);
    await createBoard(request, tokenMember, 'My Own Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenMember);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    const names = await page.locator('.board-card h3').allTextContents();
    expect(names.some((n) => n.includes('Shared Board'))).toBe(true);
    expect(names.some((n) => n.includes('My Own Board'))).toBe(true);
    // Board not shared with this member should not appear.
    expect(names.some((n) => n.includes('Owner Only Board'))).toBe(false);
  });

  test('navigating from board A to board B updates the board name in the header', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SwitchUser', 'mb-switch');
    const boardA = await createBoard(request, token, 'First Board');
    const boardB = await createBoard(request, token, 'Second Board');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-header h1')).toContainText('First Board', { timeout: 10000 });

    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.board-header h1')).toContainText('Second Board', { timeout: 10000 });
  });

  test('navigating between boards via /boards list links to the correct board', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'NavUser', 'mb-nav');
    const boardA = await createBoard(request, token, 'Nav Board Alpha');
    const boardB = await createBoard(request, token, 'Nav Board Beta');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });

    // Click the link for Board Alpha.
    await page.locator('.board-card').filter({ hasText: 'Nav Board Alpha' }).click();
    await expect(page.locator('.board-header h1')).toContainText('Nav Board Alpha', {
      timeout: 10000,
    });

    // Navigate back and click Board Beta.
    await page.goto('/boards');
    await page.waitForSelector('.board-card', { timeout: 10000 });
    await page.locator('.board-card').filter({ hasText: 'Nav Board Beta' }).click();
    await expect(page.locator('.board-header h1')).toContainText('Nav Board Beta', {
      timeout: 10000,
    });

    void boardA;
    void boardB;
  });
});

// ---------------------------------------------------------------------------
// Label isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — label isolation', () => {
  test('label created on board A does not appear in board B settings', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'LabelScope', 'mb-label');
    const boardA = await createBoard(request, token, 'Label Board A');
    const boardB = await createBoard(request, token, 'Label Board B');

    await createLabel(request, token, boardA.id, 'BoardA-Only', '#22c55e');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Verify label exists on boardA settings.
    await page.goto(`/boards/${boardA.id}/settings`);
    await expect(
      page.locator('.settings-section:has(h2:has-text("Labels")) .item-name:has-text("BoardA-Only")'),
    ).toBeVisible({ timeout: 10000 });

    // Verify label does NOT exist on boardB settings.
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await expect(page.locator('.item-name:has-text("BoardA-Only")')).not.toBeVisible();
  });

  test('labels on board A and board B can have the same name without conflict', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'LabelConflict', 'mb-lbl-conflict');
    const boardA = await createBoard(request, token, 'Conflict Label Board A');
    const boardB = await createBoard(request, token, 'Conflict Label Board B');

    // Create labels with the same name on both boards.
    const labelA = await createLabel(request, token, boardA.id, 'SharedName', '#3b82f6');
    const labelB = await createLabel(request, token, boardB.id, 'SharedName', '#f59e0b');

    // They must have different IDs (board-scoped).
    expect(labelA.id).not.toBe(labelB.id);
  });

  test('deleting a label on board A does not affect board B labels', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'LabelDelete', 'mb-lbl-del');
    const boardA = await createBoard(request, token, 'Del Label Board A');
    const boardB = await createBoard(request, token, 'Del Label Board B');

    const labelA = await createLabel(request, token, boardA.id, 'Delete Me', '#ef4444');
    await createLabel(request, token, boardB.id, 'Keep Me', '#22c55e');

    // Delete the label on board A via API.
    await request.delete(`${BASE}/api/boards/${boardA.id}/labels/${labelA.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // Board B label should still exist.
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await expect(page.locator('.item-name:has-text("Keep Me")')).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Sprint isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — sprint isolation', () => {
  test('sprint created on board A does not appear on board B', async ({ page, request }) => {
    const { token } = await createUser(request, 'SprintScope', 'mb-sprint');
    const boardA = await createBoard(request, token, 'Sprint Board A');
    const boardB = await createBoard(request, token, 'Sprint Board B');

    await createSprint(request, token, boardA.id, 'Sprint Alpha');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // BoardA backlog should show Sprint Alpha.
    await page.goto(`/boards/${boardA.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Alpha' }),
    ).toBeVisible({ timeout: 8000 });

    // BoardB backlog should NOT show Sprint Alpha.
    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Alpha' }),
    ).not.toBeVisible();
  });

  test('sprint created via API is only returned for its own board', async ({ request }) => {
    const { token } = await createUser(request, 'SprintAPI', 'mb-sprint-api');
    const boardA = await createBoard(request, token, 'Sprint API Board A');
    const boardB = await createBoard(request, token, 'Sprint API Board B');

    const sprint = await createSprint(request, token, boardA.id, 'API Sprint');

    // Fetch sprints for boardA.
    const sprintsA = await (
      await request.get(`${BASE}/api/sprints?board_id=${boardA.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json() as any[];

    // Fetch sprints for boardB.
    const sprintsB = await (
      await request.get(`${BASE}/api/sprints?board_id=${boardB.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json() as any[];

    expect(sprintsA.some((s: any) => s.id === sprint.id)).toBe(true);
    expect(sprintsB.some((s: any) => s.id === sprint.id)).toBe(false);
  });

  test('multiple sprints on board A are all visible in backlog and none on board B', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SprintMulti', 'mb-sprint-multi');
    const boardA = await createBoard(request, token, 'Multi Sprint Board A');
    const boardB = await createBoard(request, token, 'Multi Sprint Board B');

    await createSprint(request, token, boardA.id, 'Sprint One');
    await createSprint(request, token, boardA.id, 'Sprint Two');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint One' }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Two' }),
    ).toBeVisible({ timeout: 8000 });

    await page.goto(`/boards/${boardB.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-view')).toBeVisible();
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint One' }),
    ).not.toBeVisible();
    await expect(
      page.locator('.backlog-sprint-panel').filter({ hasText: 'Sprint Two' }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Column isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — column isolation', () => {
  test('custom column added to board A does not appear in board B settings', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'ColScope', 'mb-col');
    const boardA = await createBoard(request, token, 'Column Board A');
    const boardB = await createBoard(request, token, 'Column Board B');

    // Add a custom column to boardA only.
    await request.post(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'QA Review', position: 99 },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // BoardA settings shows the custom column.
    await page.goto(`/boards/${boardA.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Columns")', { timeout: 10000 });
    await expect(
      page.locator(
        '.settings-section:has(h2:has-text("Columns")) .item-name:has-text("QA Review")',
      ),
    ).toBeVisible({ timeout: 8000 });

    // BoardB settings does not show it.
    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Columns")', { timeout: 10000 });
    await expect(page.locator('.item-name:has-text("QA Review")')).not.toBeVisible();
  });

  test('columns for board A and board B are returned separately by the API', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'ColAPIScope', 'mb-col-api');
    const boardA = await createBoard(request, token, 'Col API Board A');
    const boardB = await createBoard(request, token, 'Col API Board B');

    // Add a uniquely-named column to boardA only.
    await request.post(`${BASE}/api/boards/${boardA.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Only On A', position: 99 },
    });

    const colsA = await getColumns(request, token, boardA.id);
    const colsB = await getColumns(request, token, boardB.id);

    expect(colsA.some((c) => c.name === 'Only On A')).toBe(true);
    expect(colsB.some((c) => c.name === 'Only On A')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Member isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — member isolation', () => {
  test('user added to board A cannot access board B', async ({ page, request }) => {
    const { token: tokenOwner } = await createUser(request, 'MemberOwner', 'mb-mem-own');
    const { token: tokenB, user: userB } = await createUser(request, 'MemberUserB', 'mb-mem-b');
    const boardA = await createBoard(request, tokenOwner, 'Member Board A');
    const boardB = await createBoard(request, tokenOwner, 'Member Board B');

    // Add userB to boardA only.
    await addMember(request, tokenOwner, boardA.id, userB.id);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), tokenB);

    // Board A should be accessible.
    await page.goto(`/boards/${boardA.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Board B should be forbidden.
    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.error, .board-error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.board-page')).not.toBeVisible();
  });

  test('removing a member from board A does not affect their access to board B', async ({
    request,
  }) => {
    const { token: tokenOwner } = await createUser(request, 'RemoveOwner', 'mb-rem-own');
    const { user: userC } = await createUser(request, 'UserC', 'mb-rem-c');
    const boardA = await createBoard(request, tokenOwner, 'Remove Board A');
    const boardB = await createBoard(request, tokenOwner, 'Remove Board B');

    // Add userC to both boards.
    await addMember(request, tokenOwner, boardA.id, userC.id);
    await addMember(request, tokenOwner, boardB.id, userC.id);

    // Remove userC from boardA only.
    const membersRes = await request.get(`${BASE}/api/boards/${boardA.id}/members`, {
      headers: { Authorization: `Bearer ${tokenOwner}` },
    });
    const members: any[] = await membersRes.json();
    const memberRecord = members.find((m: any) => m.user_id === userC.id);
    if (memberRecord) {
      await request.delete(`${BASE}/api/boards/${boardA.id}/members/${memberRecord.user_id}`, {
        headers: { Authorization: `Bearer ${tokenOwner}` },
      });
    }

    // Fetch members of boardB — userC should still be listed.
    const membersBRes = await request.get(`${BASE}/api/boards/${boardB.id}/members`, {
      headers: { Authorization: `Bearer ${tokenOwner}` },
    });
    const membersB: any[] = await membersBRes.json();
    expect(membersB.some((m: any) => m.user_id === userC.id)).toBe(true);
  });

  test('board member list on board A differs from board B', async ({ request }) => {
    const { token: tokenOwner } = await createUser(request, 'DiffMemberOwner', 'mb-diffmem');
    const { user: userX } = await createUser(request, 'UserX', 'mb-diffmem-x');
    const { user: userY } = await createUser(request, 'UserY', 'mb-diffmem-y');
    const boardA = await createBoard(request, tokenOwner, 'Diff Member Board A');
    const boardB = await createBoard(request, tokenOwner, 'Diff Member Board B');

    await addMember(request, tokenOwner, boardA.id, userX.id);
    await addMember(request, tokenOwner, boardB.id, userY.id);

    const membersA = await (
      await request.get(`${BASE}/api/boards/${boardA.id}/members`, {
        headers: { Authorization: `Bearer ${tokenOwner}` },
      })
    ).json() as any[];

    const membersB = await (
      await request.get(`${BASE}/api/boards/${boardB.id}/members`, {
        headers: { Authorization: `Bearer ${tokenOwner}` },
      })
    ).json() as any[];

    expect(membersA.some((m: any) => m.user_id === userX.id)).toBe(true);
    expect(membersA.some((m: any) => m.user_id === userY.id)).toBe(false);
    expect(membersB.some((m: any) => m.user_id === userY.id)).toBe(true);
    expect(membersB.some((m: any) => m.user_id === userX.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Card isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — card isolation', () => {
  test.fixme(
    'cards on board A do not appear on board B in All Cards view',
    async ({ page, request }) => {
      // fixme: Depends on POST /api/cards succeeding (Gitea 401 in some environments).
      const { token } = await createUser(request, 'CardScope', 'mb-card');
      const boardA = await createBoard(request, token, 'Card Board A');
      const boardB = await createBoard(request, token, 'Card Board B');

      const swimlaneA = await createSwimlane(request, token, boardA.id, 'TeamA');
      const colsA = await getColumns(request, token, boardA.id);

      await createSwimlane(request, token, boardB.id, 'TeamB');

      const { ok } = await tryCreateCard(
        request,
        token,
        boardA.id,
        swimlaneA.id,
        colsA[0].id,
        'BoardA Unique Card',
      );
      if (!ok) {
        test.skip(true, 'POST /api/cards returned non-2xx — skipping card isolation assertion');
        return;
      }

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

      // BoardA All Cards view shows the card.
      await page.goto(`/boards/${boardA.id}`);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await page.click('.view-btn:has-text("All Cards")');
      await expect(page.locator('.card-title:has-text("BoardA Unique Card")')).toBeVisible({
        timeout: 8000,
      });

      // BoardB All Cards view does not show it.
      await page.goto(`/boards/${boardB.id}`);
      await page.waitForSelector('.board-page', { timeout: 10000 });
      await page.click('.view-btn:has-text("All Cards")');
      await page.waitForTimeout(1000);
      await expect(page.locator('.card-title:has-text("BoardA Unique Card")')).not.toBeVisible();
    },
  );

  test.fixme(
    'card count on board B is not affected by creating cards on board A',
    async ({ request }) => {
      // fixme: Depends on POST /api/cards succeeding.
      const { token } = await createUser(request, 'CardCount', 'mb-card-count');
      const boardA = await createBoard(request, token, 'Count Board A');
      const boardB = await createBoard(request, token, 'Count Board B');

      const swimlaneA = await createSwimlane(request, token, boardA.id, 'Lane A');
      const colsA = await getColumns(request, token, boardA.id);

      // Get initial card count for boardB.
      const initialCardsB = await (
        await request.get(`${BASE}/api/boards/${boardB.id}/cards`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json() as any[];
      const initialCountB = initialCardsB.length;

      // Create a card on boardA.
      const { ok } = await tryCreateCard(
        request,
        token,
        boardA.id,
        swimlaneA.id,
        colsA[0].id,
        'Card Only On A',
      );
      if (!ok) {
        test.skip(true, 'POST /api/cards returned non-2xx — skipping card count isolation');
        return;
      }

      // BoardB card count should be unchanged.
      const afterCardsB = await (
        await request.get(`${BASE}/api/boards/${boardB.id}/cards`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json() as any[];
      expect(afterCardsB.length).toBe(initialCountB);
    },
  );
});

// ---------------------------------------------------------------------------
// Swimlane isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — swimlane isolation', () => {
  test('swimlane created on board A does not appear in board B settings', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SwimlaneScope', 'mb-sw-scope');
    const boardA = await createBoard(request, token, 'Swimlane Board A');
    const boardB = await createBoard(request, token, 'Swimlane Board B');

    await createSwimlane(request, token, boardA.id, 'BoardA Swimlane');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Swimlanes")', { timeout: 10000 });
    await expect(
      page.locator('.settings-list-item').filter({ hasText: 'BoardA Swimlane' }),
    ).toBeVisible({ timeout: 8000 });

    await page.goto(`/boards/${boardB.id}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Swimlanes")', { timeout: 10000 });
    await expect(
      page.locator('.settings-list-item').filter({ hasText: 'BoardA Swimlane' }),
    ).not.toBeVisible();
  });

  test('swimlane API returns only swimlanes for the requested board', async ({ request }) => {
    const { token } = await createUser(request, 'SwimlaneAPI', 'mb-sw-api');
    const boardA = await createBoard(request, token, 'SW API Board A');
    const boardB = await createBoard(request, token, 'SW API Board B');

    const swA = await createSwimlane(request, token, boardA.id, 'Only On Board A');

    const swimlanesA = await (
      await request.get(`${BASE}/api/boards/${boardA.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json() as any[];

    const swimlanesB = await (
      await request.get(`${BASE}/api/boards/${boardB.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json() as any[];

    expect(swimlanesA.some((s: any) => s.id === swA.id)).toBe(true);
    expect(swimlanesB.some((s: any) => s.id === swA.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Settings isolation
// ---------------------------------------------------------------------------

test.describe('Multi-Board — settings isolation', () => {
  test('renaming board A does not change board B name', async ({ page, request }) => {
    const { token } = await createUser(request, 'RenameUser', 'mb-rename');
    const boardA = await createBoard(request, token, 'Rename Board A');
    const boardB = await createBoard(request, token, 'Rename Board B');

    // Rename board A via API.
    await request.put(`${BASE}/api/boards/${boardA.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Renamed Board A' },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardB.id}`);
    await expect(page.locator('.board-header h1')).toContainText('Rename Board B', {
      timeout: 10000,
    });
    await expect(page.locator('.board-header h1')).not.toContainText('Renamed Board A');
  });

  test('board settings page shows the correct board name for each board', async ({
    page,
    request,
  }) => {
    const { token } = await createUser(request, 'SettingsIso', 'mb-settings');
    const boardA = await createBoard(request, token, 'Settings Board A');
    const boardB = await createBoard(request, token, 'Settings Board B');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${boardA.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.settings-page')).toContainText('Settings Board A');

    await page.goto(`/boards/${boardB.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.settings-page')).toContainText('Settings Board B');
  });
});
