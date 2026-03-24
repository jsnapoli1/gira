import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Create a user, board, swimlane, and two cards with distinct titles.
 * Return everything needed for search tests.
 */
async function setupSearchBoard(request: any, page: any) {
  const email = `test-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

  const card1 = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Alpha Feature Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  const card2 = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Beta Bug Report',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  // Create a high-priority card for the combined filter test
  const card3 = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Alpha High Priority',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
        priority: 'high',
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to All Cards view so cards are visible without an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.board-grid', { timeout: 10000 });

  // Wait for all 3 cards to be visible
  await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 12000 });

  return { board, card1, card2, card3, columns, swimlane, token };
}

// ---------------------------------------------------------------------------

test.describe('Card Search', () => {
  test('search input is visible in the board header', async ({ page, request }) => {
    await setupSearchBoard(request, page);
    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeVisible();
  });

  test('search by title filters cards — matching card visible, non-matching hidden', async ({ page, request }) => {
    await setupSearchBoard(request, page);

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha Feature');

    // Only "Alpha Feature Card" should remain
    await expect(page.locator('.card-item[aria-label="Alpha Feature Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible();
  });

  test('search is case-insensitive', async ({ page, request }) => {
    await setupSearchBoard(request, page);

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('alpha feature');

    await expect(page.locator('.card-item[aria-label="Alpha Feature Card"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible();
  });

  test('clearing search restores all cards', async ({ page, request }) => {
    await setupSearchBoard(request, page);

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha');

    // Confirm filter applied — only "Alpha" cards visible
    await expect(page.locator('.card-item[aria-label="Beta Bug Report"]')).not.toBeVisible({ timeout: 8000 });

    // Clear the input
    await searchInput.fill('');

    // All 3 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  test('search with no matching results shows no card items', async ({ page, request }) => {
    await setupSearchBoard(request, page);

    const searchInput = page.locator('.search-input input');
    await searchInput.fill('ZZZNONEXISTENT');

    // No card items should be visible
    await expect(page.locator('.card-item')).toHaveCount(0, { timeout: 8000 });
  });

  test('search + priority filter combined — only cards matching both criteria shown', async ({ page, request }) => {
    await setupSearchBoard(request, page);

    // Type "Alpha" in search — filters to "Alpha Feature Card" and "Alpha High Priority"
    const searchInput = page.locator('.search-input input');
    await searchInput.fill('Alpha');
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Now expand filters and set priority=high
    await page.click('.filter-toggle-btn');
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 5000 });

    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await prioritySelect.selectOption('high');

    // Only "Alpha High Priority" should be visible (matches both Alpha search AND high priority)
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item[aria-label="Alpha High Priority"]')).toBeVisible();
  });

  test('backend search API returns matching cards', async ({ request }) => {
    // We need a fresh board for this API-only test
    const email = `test-search-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

    // Create two cards
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Alpha Feature Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

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
    const cards: any[] = body.cards;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const found = cards.some((c: any) => c.title === 'Alpha Feature Card');
    expect(found).toBe(true);
    // Beta Bug Report should not be in results
    const betaFound = cards.some((c: any) => c.title === 'Beta Bug Report');
    expect(betaFound).toBe(false);
  });
});
