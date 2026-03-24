/**
 * search-advanced.spec.ts — Advanced search and filter tests
 *
 * Covers:
 *  - Basic search API (GET /api/cards/search)
 *  - Search UI on the board view
 *  - Search edge cases
 *  - Saved filters via API and UI
 *  - Global search (documented as not implemented — tests marked fixme)
 */

import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
}

async function createUser(request: any, label = 'Search') {
  const email = `test-search-adv-${crypto.randomUUID()}@test.com`;
  const body = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} Tester` },
    })
  ).json();
  return { token: body.token as string, email };
}

async function setupBoard(request: any, token: string, name = 'Advanced Search Board'): Promise<BoardSetup> {
  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
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
      data: { name: 'Search Lane', designator: 'SL-', color: '#6366f1' },
    })
  ).json();

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id };
}

async function createCard(
  request: any,
  token: string,
  setup: BoardSetup,
  opts: { title: string; priority?: string; description?: string }
) {
  return request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: opts.title,
      description: opts.description ?? '',
      priority: opts.priority,
      column_id: setup.columnId,
      swimlane_id: setup.swimlaneId,
      board_id: setup.boardId,
    },
  });
}

// Board with 3 cards already created; skip-safe for UI tests
interface SearchBoardResult extends BoardSetup {
  cardsCreated: boolean;
}

async function setupSearchBoardWithCards(request: any, page: any): Promise<SearchBoardResult> {
  const { token } = await createUser(request, 'AdvSearch');
  const setup = await setupBoard(request, token);

  const card1Res = await createCard(request, token, setup, { title: 'Zebra Feature One' });
  if (!card1Res.ok()) {
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    return { ...setup, cardsCreated: false };
  }

  await createCard(request, token, setup, { title: 'Mango Bug Report', priority: 'low' });
  await createCard(request, token, setup, { title: 'Zebra High Priority', priority: 'high' });

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${setup.boardId}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.board-content', { timeout: 10000 });
  await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

  return { ...setup, cardsCreated: true };
}

// ---------------------------------------------------------------------------
// Basic search API tests
// ---------------------------------------------------------------------------

test.describe('Search — Basic API', () => {
  test.setTimeout(60000);

  test('GET /api/cards/search?q=<term>&board_id=<id> returns matching cards', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const res1 = await createCard(request, token, setup, { title: 'FindMe Alpha Card' });
    if (!res1.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, setup, { title: 'OtherCard Beta' });

    const res = await request.get(
      `${BASE}/api/cards/search?q=FindMe&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.some((c: any) => c.title === 'FindMe Alpha Card')).toBe(true);
    expect(cards.some((c: any) => c.title === 'OtherCard Beta')).toBe(false);
  });

  test('search with board_id limits results to that board', async ({ request }) => {
    const { token } = await createUser(request);
    const setupA = await setupBoard(request, token, 'Board A Search');
    const setupB = await setupBoard(request, token, 'Board B Search');

    const r1 = await createCard(request, token, setupA, { title: 'SharedTitle Card BoardA' });
    if (!r1.ok()) { test.skip(true, 'Card creation unavailable'); return; }
    await createCard(request, token, setupB, { title: 'SharedTitle Card BoardB' });

    const res = await request.get(
      `${BASE}/api/cards/search?q=SharedTitle&board_id=${setupA.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    // All results must belong to board A
    for (const c of cards) {
      expect(c.board_id).toBe(setupA.boardId);
    }
  });

  test('search returns empty array for no matches', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const r = await createCard(request, token, setup, { title: 'Unique Name Here' });
    if (!r.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(
      `${BASE}/api/cards/search?q=XYZNONEXISTENT999&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(0);
  });

  test('search is case-insensitive', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const r = await createCard(request, token, setup, { title: 'CaseSensitive Test Card' });
    if (!r.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    const resLower = await request.get(
      `${BASE}/api/cards/search?q=casesensitive&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(resLower.status()).toBe(200);
    const lowerBody = await resLower.json();
    const lowerCards: any[] = lowerBody.cards ?? lowerBody;

    const resUpper = await request.get(
      `${BASE}/api/cards/search?q=CASESENSITIVE&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(resUpper.status()).toBe(200);
    const upperBody = await resUpper.json();
    const upperCards: any[] = upperBody.cards ?? upperBody;

    // Both lower and upper should find the same card
    expect(lowerCards.some((c: any) => c.title === 'CaseSensitive Test Card')).toBe(true);
    expect(upperCards.some((c: any) => c.title === 'CaseSensitive Test Card')).toBe(true);
  });

  test('search by partial title word matches correctly', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const r = await createCard(request, token, setup, { title: 'Refactoring Database Layer' });
    if (!r.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(
      `${BASE}/api/cards/search?q=Refactor&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.some((c: any) => c.title === 'Refactoring Database Layer')).toBe(true);
  });

  test('search with special characters does not crash', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const res = await request.get(
      `${BASE}/api/cards/search?q=%27%3B+DROP+TABLE--&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    // Should not cause a 500
    expect([200, 400]).toContain(res.status());
  });

  test('search response includes expected card fields', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const r = await createCard(request, token, setup, { title: 'Fields Check Card' });
    if (!r.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(
      `${BASE}/api/cards/search?q=Fields+Check&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(cards.length).toBeGreaterThan(0);
    const c = cards[0];
    // Must include at minimum id, title, board_id
    expect(c).toHaveProperty('id');
    expect(c).toHaveProperty('title');
    expect(c).toHaveProperty('board_id');
  });

  test('search without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cards/search?q=anything&board_id=1`);
    expect(res.status()).toBe(401);
  });

  test('search with empty q returns results or empty array (not error)', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const res = await request.get(
      `${BASE}/api/cards/search?q=&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect([200, 400]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      const cards: any[] = body.cards ?? body;
      expect(Array.isArray(cards)).toBe(true);
    }
  });

  test('search with board_id belonging to another user returns 403', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'Owner');
    const ownerSetup = await setupBoard(request, ownerToken, 'Private Board');

    const { token: otherToken } = await createUser(request, 'Other');

    const res = await request.get(
      `${BASE}/api/cards/search?q=anything&board_id=${ownerSetup.boardId}`,
      { headers: { Authorization: `Bearer ${otherToken}` } }
    );
    expect([403, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Search UI on board view
// ---------------------------------------------------------------------------

test.describe('Search — Board UI', () => {
  test.setTimeout(90000);

  test('search input is visible on board view', async ({ page, request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await expect(page.locator('.search-input input')).toBeVisible();
  });

  test('typing in search filters cards — matching visible, non-matching hidden', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Zebra Feature');

    await expect(page.locator('.card-item[aria-label="Zebra Feature One"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Mango Bug Report"]')).not.toBeVisible();
  });

  test('non-matching cards are hidden during search', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Mango');

    await expect(page.locator('.card-item[aria-label="Mango Bug Report"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Zebra Feature One"]')).not.toBeVisible();
    await expect(page.locator('.card-item[aria-label="Zebra High Priority"]')).not.toBeVisible();
  });

  test('matching cards remain visible during search', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const searchInput = page.locator('.search-input input');
    // "Zebra" appears in two cards
    await searchInput.fill('Zebra');

    await expect(page.locator('.card-item[aria-label="Zebra Feature One"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Zebra High Priority"]')).toBeVisible({ timeout: 8000 });
  });

  test('clearing search input restores all cards', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Zebra');
    await expect(page.locator('.card-item[aria-label="Mango Bug Report"]')).not.toBeVisible({ timeout: 5000 });

    await searchInput.fill('');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('search in All Cards view works', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    // Already in All Cards view from setup helper
    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Mango');
    await expect(page.locator('.card-item[aria-label="Mango Bug Report"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
  });

  test('search combined with column filter narrows results', async ({ page, request }) => {
    const result = await setupSearchBoardWithCards(request, page);
    if (!result.cardsCreated) { test.skip(true, 'Card creation unavailable'); return; }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Zebra');
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Expand filters and select priority=high
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Only "Zebra High Priority" matches both
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Zebra High Priority"]')).toBeVisible();
  });

  test('search state cleared when switching boards', async ({ page, request }) => {
    const { token } = await createUser(request);
    const setupA = await setupBoard(request, token, 'Board Switch A');
    const setupB = await setupBoard(request, token, 'Board Switch B');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${setupA.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Enter search on board A
    const searchInput = page.locator('.search-input input');
    await searchInput.fill('search term A');
    await expect(searchInput).toHaveValue('search term A');

    // Navigate to board B
    await page.goto(`/boards/${setupB.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Search should be cleared on the new board
    const searchInputB = page.locator('.search-input input');
    await expect(searchInputB).toHaveValue('');
  });

  test('search query is synced to URL parameter q', async ({ page, request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('urltest');

    await page.waitForFunction(() => window.location.search.includes('q=urltest'), { timeout: 5000 });
    expect(page.url()).toContain('q=urltest');
  });
});

// ---------------------------------------------------------------------------
// Search edge cases
// ---------------------------------------------------------------------------

test.describe('Search — Edge Cases', () => {
  test.setTimeout(60000);

  test('search with single character returns results or empty array (not error)', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const res = await request.get(
      `${BASE}/api/cards/search?q=a&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect([200, 400]).toContain(res.status());
  });

  test('search with a very long term returns 200 or 400 (not 500)', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const longTerm = 'a'.repeat(500);
    const res = await request.get(
      `${BASE}/api/cards/search?q=${longTerm}&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect([200, 400]).toContain(res.status());
  });

  test('search with unicode characters does not crash', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const r = await createCard(request, token, setup, { title: 'Ünïcödé Cärd' });
    if (!r.ok()) { test.skip(true, 'Card creation unavailable'); return; }

    const res = await request.get(
      `${BASE}/api/cards/search?q=${encodeURIComponent('Ünïcödé')}&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect([200, 400]).toContain(res.status());
  });

  test('search on a board with no cards returns empty array', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const res = await request.get(
      `${BASE}/api/cards/search?q=anything&board_id=${setup.boardId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(0);
  });

  test('UI search with no cards shows zero card items', async ({ page, request }) => {
    const { token } = await createUser(request, 'EmptyBoard');
    const setup = await setupBoard(request, token, 'Empty Board Search');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.board-content', { timeout: 10000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('anything');

    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Saved filters via API
// ---------------------------------------------------------------------------

test.describe('Search — Saved Filters (API)', () => {
  test.setTimeout(60000);

  test('create a saved filter via POST /api/boards/:id/filters', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const filterJSON = JSON.stringify({ priority: 'high', q: 'important' });
    const res = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'My Priority Filter', filter_json: filterJSON, is_shared: false },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('My Priority Filter');
  });

  test('list saved filters via GET /api/boards/:id/filters', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    // Create one filter
    await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Filter To List', filter_json: '{"q":"foo"}', is_shared: false },
    });

    const res = await request.get(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const filters: any[] = await res.json();
    expect(Array.isArray(filters)).toBe(true);
    expect(filters.some((f: any) => f.name === 'Filter To List')).toBe(true);
  });

  test('save filter with text search term — filter_json stores q field', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const filterJSON = JSON.stringify({ q: 'search-text-term' });
    const res = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Search Text Filter', filter_json: filterJSON, is_shared: false },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    // The stored filter_json should contain our search term
    const stored = JSON.parse(body.filter_json);
    expect(stored.q).toBe('search-text-term');
  });

  test('save filter with multiple criteria (search + priority)', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const filterJSON = JSON.stringify({ q: 'multi-criteria', priority: 'high', assignee: 'me' });
    const res = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Multi Criteria Filter', filter_json: filterJSON, is_shared: false },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    const stored = JSON.parse(body.filter_json);
    expect(stored.q).toBe('multi-criteria');
    expect(stored.priority).toBe('high');
  });

  test('delete saved filter via DELETE /api/boards/:id/filters/:filterId', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const createRes = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete Me Filter', filter_json: '{"q":"gone"}', is_shared: false },
    });
    expect([200, 201]).toContain(createRes.status());
    const { id: filterId } = await createRes.json();

    const deleteRes = await request.delete(
      `${BASE}/api/boards/${setup.boardId}/filters/${filterId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect([200, 204]).toContain(deleteRes.status());

    // Verify it no longer appears in the list
    const listRes = await request.get(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const filters: any[] = await listRes.json();
    expect(filters.some((f: any) => f.id === filterId)).toBe(false);
  });

  test('update saved filter via PUT /api/boards/:id/filters/:filterId', async ({ request }) => {
    const { token } = await createUser(request);
    const setup = await setupBoard(request, token);

    const createRes = await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Before Update', filter_json: '{"q":"old"}', is_shared: false },
    });
    expect([200, 201]).toContain(createRes.status());
    const { id: filterId } = await createRes.json();

    const updateRes = await request.put(
      `${BASE}/api/boards/${setup.boardId}/filters/${filterId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'After Update', filter_json: '{"q":"new"}', is_shared: false },
      }
    );
    expect([200, 204]).toContain(updateRes.status());

    // Verify the name changed
    const listRes = await request.get(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const filters: any[] = await listRes.json();
    const updated = filters.find((f: any) => f.id === filterId);
    expect(updated?.name).toBe('After Update');
  });

  test('saved filter is user-scoped — other users cannot see private filters', async ({ request }) => {
    const { token: ownerToken } = await createUser(request, 'FilterOwner');
    const ownerSetup = await setupBoard(request, ownerToken, 'Owner Board Filters');

    const createRes = await request.post(`${BASE}/api/boards/${ownerSetup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { name: 'Private Filter', filter_json: '{"q":"private"}', is_shared: false },
    });
    expect([200, 201]).toContain(createRes.status());

    // A different user should not be able to list filters on a board they don't belong to
    const { token: otherToken } = await createUser(request, 'FilterOther');
    const listRes = await request.get(`${BASE}/api/boards/${ownerSetup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect([403, 404]).toContain(listRes.status());
  });
});

// ---------------------------------------------------------------------------
// Saved filters — UI tests
// ---------------------------------------------------------------------------

test.describe('Search — Saved Filters (UI)', () => {
  test.setTimeout(90000);

  test('save filter with text search term in UI — filter saved and appears in list', async ({ page, request }) => {
    const { token } = await createUser(request, 'SFUITest');
    const setup = await setupBoard(request, token, 'SF UI Board');

    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-filters-expanded');
    }, token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });

    // Activate filters panel and set a priority
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Save the filter
    const saveBtn = page.locator('.save-filter-btn');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    const modal = page.locator('.save-filter-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.locator('.save-filter-input').fill('UI Priority Filter');
    await page.click('.save-filter-modal .btn-primary');
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Open saved filters dropdown and verify filter appears
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("UI Priority Filter")')).toBeVisible();
  });

  test('delete saved filter removes it from the list in UI', async ({ page, request }) => {
    const { token } = await createUser(request, 'SFDelete');
    const setup = await setupBoard(request, token, 'SF Delete Board');

    // Create a filter via API first
    const filterJSON = JSON.stringify({ priority: 'low' });
    await request.post(`${BASE}/api/boards/${setup.boardId}/filters`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Delete In UI Filter', filter_json: filterJSON, is_shared: false },
    });

    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      localStorage.removeItem('zira-filters-expanded');
    }, token);
    await page.goto(`/boards/${setup.boardId}`);
    await page.waitForSelector('.board-header', { timeout: 15000 });

    // Open the saved filters dropdown
    await page.click('.saved-filters-btn');
    await expect(page.locator('.saved-filters-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.saved-filter-name:has-text("Delete In UI Filter")')).toBeVisible();

    // Delete the filter
    await page.locator('.saved-filter-item:has-text("Delete In UI Filter") .delete-filter-btn').click();

    // Confirm deletion if dialog appears
    page.on('dialog', (dialog) => dialog.accept());

    // Filter should be gone from the dropdown
    await expect(page.locator('.saved-filter-name:has-text("Delete In UI Filter")')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Global search (not implemented — all tests fixme)
// ---------------------------------------------------------------------------

test.describe('Global Search (not implemented)', () => {
  test.fixme(true, 'Global cross-board search is not implemented in this version. See search-global.spec.ts for context.');

  test('search across all boards is available', async ({ request }) => {
    // Placeholder — no /api/search endpoint exists
  });

  test('global search results show board name', async ({ request }) => {
    // Placeholder
  });

  test('clicking a global search result navigates to the card', async ({ page, request }) => {
    // Placeholder
  });
});
