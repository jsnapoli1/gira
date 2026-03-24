import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Shared setup helper
// Creates a unique user, board, swimlane, and up to three cards.
// Returns everything needed for search tests.
// ---------------------------------------------------------------------------
interface SearchSetup {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardsCreated: boolean;
}

async function setupSearchBoard(request: any, page: any): Promise<SearchSetup> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `test-search-${suffix}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Search Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Search Test Board' },
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
      data: { name: 'Team', designator: 'TM-', color: '#6366f1' },
    })
  ).json();

  // Attempt to create three cards — POST /api/cards can return 401 when Gitea
  // integration is not configured.  Guard every card creation individually.
  let cardsCreated = false;

  const card1Res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Alpha Feature Card',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  if (!card1Res.ok()) {
    // Card creation unavailable — navigate to board without cards
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });
    return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id, cardsCreated: false };
  }

  await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Beta Bug Report',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });

  await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Alpha High Priority',
      column_id: columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
      priority: 'high',
    },
  });

  cardsCreated = true;

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to All Cards view so cards are visible without an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.board-grid, .board-content', { timeout: 10000 });

  // Wait for all 3 cards
  await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id, cardsCreated };
}

// ---------------------------------------------------------------------------

test.describe('Card Search', () => {
  test('search input is visible in the board header', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-search-visible-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Search Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Search Visibility Board' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    // Search input lives in .board-header-actions .search-input
    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', /search/i);
  });

  test('search by title filters cards — matching card visible, non-matching hidden', async ({ page, request }) => {
    const setup = await setupSearchBoard(request, page);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable — Gitea integration required');
      return;
    }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha Feature');

    // Only "Alpha Feature Card" should remain visible
    await expect(page.locator('.card-item[aria-label="Alpha Feature Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible();
    // "Alpha High Priority" also contains "Alpha" but not "Alpha Feature" — should be hidden
    await expect(page.locator('.card-item[aria-label="Alpha High Priority"]')).not.toBeVisible();
  });

  test('search is case-insensitive', async ({ page, request }) => {
    const setup = await setupSearchBoard(request, page);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable — Gitea integration required');
      return;
    }

    const searchInput = page.locator('.search-input input');
    // Lowercase "alpha feature" should match "Alpha Feature Card"
    await searchInput.fill('alpha feature');

    await expect(page.locator('.card-item[aria-label="Alpha Feature Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible();
  });

  test('clearing search restores all cards', async ({ page, request }) => {
    const setup = await setupSearchBoard(request, page);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable — Gitea integration required');
      return;
    }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha');

    // Confirm only Alpha cards are visible
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible({ timeout: 8000 });

    // Clear the input
    await searchInput.fill('');

    // All 3 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('search with no matching results shows zero card items', async ({ page, request }) => {
    const setup = await setupSearchBoard(request, page);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable — Gitea integration required');
      return;
    }

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('ZZZNONEXISTENTQUERY');

    // No card items should be visible
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  test('keyboard shortcut "/" focuses the search input', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-search-kb-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'KB Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'KB Search Board' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeVisible();

    // Ensure focus is NOT on a text input before pressing '/'
    await page.locator('body').click();
    await page.keyboard.press('/');

    // The search input should now be focused
    await expect(searchInput).toBeFocused();
  });

  test('search + priority filter combined — only cards matching both criteria shown', async ({ page, request }) => {
    const setup = await setupSearchBoard(request, page);
    if (!setup.cardsCreated) {
      test.skip(true, 'Card creation unavailable — Gitea integration required');
      return;
    }

    // Search for "Alpha" — should show "Alpha Feature Card" and "Alpha High Priority" (2 cards)
    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha');
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Expand filters and set priority=high
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Only "Alpha High Priority" matches both search and priority filter
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Alpha High Priority"]')).toBeVisible();
  });

  test('backend search API GET /api/cards/search returns matching cards', async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-search-api-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'API Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'API Search Board' },
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
        data: { name: 'API Lane', designator: 'AL-', color: '#3b82f6' },
      })
    ).json();

    const card1Res = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Alpha Feature Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    if (!card1Res.ok()) {
      test.skip(true, `Card creation unavailable: ${await card1Res.text()}`);
      return;
    }

    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Beta Bug Report',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    // Call the backend search endpoint
    const searchRes = await request.get(
      `${BASE}/api/cards/search?q=Alpha&board_id=${board.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(searchRes.status()).toBe(200);

    const body = await searchRes.json();
    // API response shape: { cards: Card[], total: number }
    const cards: any[] = body.cards ?? body;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(1);

    const found = cards.some((c: any) => c.title === 'Alpha Feature Card');
    expect(found).toBe(true);

    // "Beta Bug Report" does not contain "Alpha" — should not appear
    const betaFound = cards.some((c: any) => c.title === 'Beta Bug Report');
    expect(betaFound).toBe(false);
  });

  test('search input updates URL query param q', async ({ page, request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `test-search-url-${suffix}@test.com`;

    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'URL Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'URL Search Board' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 15000 });

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('hello');

    // BoardView syncs filter state to URL params — wait for URL to update
    await page.waitForFunction(() => window.location.search.includes('q=hello'), { timeout: 5000 });
    expect(page.url()).toContain('q=hello');
  });
});
