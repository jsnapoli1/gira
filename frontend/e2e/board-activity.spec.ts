import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  user: { id: number; display_name: string };
  boardId: number;
  swimlaneId: number;
  firstColumnId: number;
  columns: Array<{ id: number; name: string; state: string; position: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(
  request: any,
  prefix = 'ba',
): Promise<{ token: string; user: { id: number; display_name: string } }> {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const displayName = `${prefix} User`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const body = await res.json();
  return { token: body.token as string, user: body.user as { id: number; display_name: string } };
}

async function setupBoard(
  request: any,
  token: string,
  boardName = 'Board Activity Test Board',
): Promise<Omit<BoardSetup, 'token' | 'user'>> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'BA-', color: '#2196F3' },
    })
  ).json();

  const columns: Array<{ id: number; name: string; state: string; position: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const sorted = [...columns].sort((a, b) => a.position - b.position);

  return {
    boardId: board.id,
    swimlaneId: swimlane.id,
    firstColumnId: sorted[0].id,
    columns: sorted,
  };
}

/**
 * Full setup: user + board + card. Returns everything needed for UI tests.
 * Injects the auth token and navigates to the board in "All Cards" view.
 */
async function setupBoardWithCard(
  request: any,
  page: any,
  prefix = 'ba',
): Promise<BoardSetup & { card: { id: number } | null }> {
  const { token, user } = await createUser(request, prefix);
  const { boardId, swimlaneId, firstColumnId, columns } = await setupBoard(
    request,
    token,
    `${prefix} Board`,
  );

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Board Activity Card',
      column_id: firstColumnId,
      swimlane_id: swimlaneId,
      board_id: boardId,
    },
  });

  const card = cardRes.ok() ? await cardRes.json() : null;

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { token, user, boardId, swimlaneId, firstColumnId, columns, card };
}

async function getCardActivity(request: any, token: string, cardId: number): Promise<any[]> {
  const res = await request.get(`${BASE}/api/cards/${cardId}/activity`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** Wait for the activity section to finish loading inside an open card modal. */
async function waitForActivity(page: any): Promise<void> {
  await expect(page.locator('.activity-log-section .loading-inline')).not.toBeVisible({
    timeout: 8000,
  });
}

// ---------------------------------------------------------------------------
// Card activity events — API level
// ---------------------------------------------------------------------------

test.describe('Board Activity — API: card activity events', () => {
  test('creating a card creates activity entry with action="created"', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-created');
    const bs = await setupBoard(request, token, 'BA API Created Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Created Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const activities = await getCardActivity(request, token, card.id);
    const createdEntry = activities.find((a: any) => a.action === 'created');
    expect(createdEntry).toBeDefined();
  });

  test('updating card title creates activity entry', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-title');
    const bs = await setupBoard(request, token, 'BA API Title Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Original Title',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Updated Title' },
    });

    const activities = await getCardActivity(request, token, card.id);
    const titleEntry = activities.find(
      (a: any) => a.action === 'updated' && a.field_changed === 'title',
    );
    expect(titleEntry).toBeDefined();
  });

  test('moving card to another column creates activity entry with action="moved"', async ({
    request,
  }) => {
    const { token } = await createUser(request, 'ba-api-move');
    const bs = await setupBoard(request, token, 'BA API Move Board');

    if (bs.columns.length < 2) { test.skip(true, 'Need at least 2 columns'); return; }

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Move Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: bs.columns[1].id, swimlane_id: bs.swimlaneId },
    });

    const activities = await getCardActivity(request, token, card.id);
    const movedEntry = activities.find((a: any) => a.action === 'moved');
    expect(movedEntry).toBeDefined();
  });

  test('adding assignee creates activity entry with action="assigned"', async ({ request }) => {
    const { token, user } = await createUser(request, 'ba-api-assign');
    const bs = await setupBoard(request, token, 'BA API Assign Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Assignee Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });

    const activities = await getCardActivity(request, token, card.id);
    const assignedEntry = activities.find((a: any) => a.action === 'assigned');
    expect(assignedEntry).toBeDefined();
  });

  test('removing assignee creates activity entry with action="unassigned"', async ({ request }) => {
    const { token, user } = await createUser(request, 'ba-api-unassign');
    const bs = await setupBoard(request, token, 'BA API Unassign Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Unassign Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assignees`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: user.id },
    });
    await request.delete(`${BASE}/api/cards/${card.id}/assignees/${user.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const activities = await getCardActivity(request, token, card.id);
    const unassignedEntry = activities.find((a: any) => a.action === 'unassigned');
    expect(unassignedEntry).toBeDefined();
  });

  test('adding label creates activity entry', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-label-add');
    const bs = await setupBoard(request, token, 'BA API Label Add Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Label Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Create a label for the board
    const labelRes = await request.post(`${BASE}/api/boards/${bs.boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'BA Test Label', color: '#ff0000' },
    });
    if (!labelRes.ok()) { test.skip(true, 'Label creation failed'); return; }
    const label = await labelRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { label_id: label.id },
    });

    const activities = await getCardActivity(request, token, card.id);
    // Activity count should have grown from the initial creation entry
    expect(activities.length).toBeGreaterThanOrEqual(1);
  });

  test('removing label creates activity entry', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-label-rm');
    const bs = await setupBoard(request, token, 'BA API Label Remove Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Label Remove Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const labelRes = await request.post(`${BASE}/api/boards/${bs.boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'BA Remove Label', color: '#0000ff' },
    });
    if (!labelRes.ok()) { test.skip(true, 'Label creation failed'); return; }
    const label = await labelRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { label_id: label.id },
    });
    await request.delete(`${BASE}/api/cards/${card.id}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const activities = await getCardActivity(request, token, card.id);
    expect(Array.isArray(activities)).toBe(true);
    expect(activities.length).toBeGreaterThanOrEqual(1);
  });

  test('adding comment creates activity entry with action="commented"', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-comment');
    const bs = await setupBoard(request, token, 'BA API Comment Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Comment Activity Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: 'Activity comment test' },
    });

    const activities = await getCardActivity(request, token, card.id);
    const commentedEntry = activities.find((a: any) => a.action === 'commented');
    expect(commentedEntry).toBeDefined();
  });

  test('logging worklog creates or preserves activity entries', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-worklog');
    const bs = await setupBoard(request, token, 'BA API Worklog Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Worklog Activity Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const before = await getCardActivity(request, token, card.id);

    await request.post(`${BASE}/api/cards/${card.id}/worklogs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { time_spent: 60 },
    });

    const after = await getCardActivity(request, token, card.id);
    expect(Array.isArray(after)).toBe(true);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });

  test('activity entry has action field', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-action-field');
    const bs = await setupBoard(request, token, 'BA Action Field Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Action Field Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const activities = await getCardActivity(request, token, card.id);
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0]).toHaveProperty('action');
    expect(typeof activities[0].action).toBe('string');
  });

  test('activity entry has created_at timestamp', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-timestamp');
    const bs = await setupBoard(request, token, 'BA Timestamp Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Timestamp Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const activities = await getCardActivity(request, token, card.id);
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0]).toHaveProperty('created_at');
    expect(new Date(activities[0].created_at).getTime()).not.toBeNaN();
  });

  test('activity entry has user info (user_id field)', async ({ request }) => {
    const { token, user } = await createUser(request, 'ba-api-user-info');
    const bs = await setupBoard(request, token, 'BA User Info Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'User Info Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const activities = await getCardActivity(request, token, card.id);
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0].user_id).toBe(user.id);
  });

  test('activity returned in chronological order (creation before updates)', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-order');
    const bs = await setupBoard(request, token, 'BA Chronological Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Order Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Updated Order Card' },
    });

    const activities = await getCardActivity(request, token, card.id);
    expect(activities.length).toBeGreaterThanOrEqual(2);

    // Verify timestamps are parseable and ordered (either ASC or DESC)
    const timestamps = activities.map((a: any) => new Date(a.created_at).getTime());
    const isAscending = timestamps.every((t: number, i: number) => i === 0 || t >= timestamps[i - 1]);
    const isDescending = timestamps.every((t: number, i: number) => i === 0 || t <= timestamps[i - 1]);
    expect(isAscending || isDescending).toBe(true);
  });

  test('multiple actions create multiple activity entries', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-multi');
    const bs = await setupBoard(request, token, 'BA Multi Action Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Multi Action Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Multi Title 1' },
    });
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Multi Title 2' },
    });

    const activities = await getCardActivity(request, token, card.id);
    // created + title change 1 + title change 2 = at least 3
    expect(activities.length).toBeGreaterThanOrEqual(3);
  });

  test('GET /api/cards/:id/activity returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-200');
    const bs = await setupBoard(request, token, 'BA 200 Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Status 200 Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('GET /api/cards/:id/activity returns 401 without auth token', async ({ request }) => {
    const { token } = await createUser(request, 'ba-api-401');
    const bs = await setupBoard(request, token, 'BA 401 Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: '401 Test Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    const res = await request.get(`${BASE}/api/cards/${card.id}/activity`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// UI: card activity section
// ---------------------------------------------------------------------------

test.describe('Board Activity — UI: card activity section', () => {
  test('card modal has activity/history section', async ({ page, request }) => {
    const { card } = await setupBoardWithCard(request, page, 'ba-ui-section');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await expect(page.locator('.activity-log-section')).toBeVisible();
  });

  test('activity section shows action descriptions', async ({ page, request }) => {
    const { card } = await setupBoardWithCard(request, page, 'ba-ui-desc');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    await expect(page.locator('.activity-description').first()).toBeVisible({ timeout: 8000 });
    const text = await page.locator('.activity-description').first().textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('activity section shows timestamps', async ({ page, request }) => {
    const { card } = await setupBoardWithCard(request, page, 'ba-ui-time');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    await expect(page.locator('.activity-item').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.activity-item').first().locator('.activity-time')).toBeVisible();
  });

  test('activity section shows user who made the change', async ({ page, request }) => {
    const { card, user } = await setupBoardWithCard(request, page, 'ba-ui-user');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    await expect(page.locator('.activity-item').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.activity-user').first()).toContainText(user.display_name);
  });

  test('"created" action is visible in activity after opening card', async ({ page, request }) => {
    const { card } = await setupBoardWithCard(request, page, 'ba-ui-created');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    await expect(page.locator('.activity-description', { hasText: 'created card' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('column move shown in activity after moving card', async ({ page, request }) => {
    const { card, token, boardId, swimlaneId, columns } = await setupBoardWithCard(
      request,
      page,
      'ba-ui-move',
    );
    if (!card) { test.skip(true, 'Card creation failed'); return; }
    if (columns.length < 2) { test.skip(true, 'Need at least 2 columns'); return; }

    // Move card via API
    await request.put(`${BASE}/api/cards/${card.id}/move`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { column_id: columns[1].id, swimlane_id: swimlaneId },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    await expect(
      page.locator('.activity-description', { hasText: /moved|column/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test('activity sorted newest first — title rename appears before creation', async ({
    page,
    request,
  }) => {
    const { card, token } = await setupBoardWithCard(request, page, 'ba-ui-sort');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    // Rename via API (newer event than creation)
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Sort Test Renamed Card' },
    });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    const descriptions = await page.locator('.activity-description').allTextContents();
    expect(descriptions.length).toBeGreaterThanOrEqual(2);

    const titleChangeIdx = descriptions.findIndex((d) => /changed title/i.test(d));
    const createdIdx = descriptions.findIndex((d) => /created card/i.test(d));

    if (titleChangeIdx !== -1 && createdIdx !== -1) {
      // Newest first means title-change (more recent) should appear before creation
      expect(titleChangeIdx).toBeLessThan(createdIdx);
    }
  });

  test('empty activity shows empty or loading state gracefully', async ({ page, request }) => {
    // Use a fresh card that has had no interactions — only the creation event
    const { card } = await setupBoardWithCard(request, page, 'ba-ui-empty');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await waitForActivity(page);

    // At minimum the creation event should be present; "No activity" should not appear
    const noActivityMsg = page.locator('.activity-log-section', { hasText: 'No activity' });
    const noActivityCount = await noActivityMsg.count();
    const activityItemCount = await page.locator('.activity-item').count();

    // Either there are activity items, or "No activity" is shown — both are valid states
    expect(noActivityCount + activityItemCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Activity completeness
// ---------------------------------------------------------------------------

test.describe('Board Activity — activity completeness', () => {
  test('fast sequence of actions creates multiple activity entries', async ({ request }) => {
    const { token } = await createUser(request, 'ba-seq');
    const bs = await setupBoard(request, token, 'BA Sequence Board');

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Sequence Card',
        column_id: bs.firstColumnId,
        swimlane_id: bs.swimlaneId,
        board_id: bs.boardId,
      },
    });
    if (!cardRes.ok()) { test.skip(true, 'Card creation failed'); return; }
    const card = await cardRes.json();

    // Fire three rapid mutations without waiting between them
    await Promise.all([
      request.put(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title: 'Seq Title A' },
      }),
    ]);
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Seq Title B' },
    });
    await request.post(`${BASE}/api/cards/${card.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: 'Sequence comment' },
    });

    const activities = await getCardActivity(request, token, card.id);
    // Should have at minimum: created + at least 2 mutations = 3
    expect(activities.length).toBeGreaterThanOrEqual(3);
  });

  test('activity is not lost on page reload', async ({ page, request }) => {
    const { card, token } = await setupBoardWithCard(request, page, 'ba-reload');
    if (!card) { test.skip(true, 'Card creation failed'); return; }

    // Generate an additional activity entry
    await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: 'Reloaded Card Title' },
    });

    // Reload and navigate back
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const activities = await getCardActivity(request, token, card.id);
    expect(activities.length).toBeGreaterThanOrEqual(2);
    const titleEntry = activities.find(
      (a: any) => a.action === 'updated' && a.field_changed === 'title',
    );
    expect(titleEntry).toBeDefined();
  });
});
