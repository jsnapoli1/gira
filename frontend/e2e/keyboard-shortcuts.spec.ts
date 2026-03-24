import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Create a user + board + swimlane via API, inject token, navigate to board,
 * and switch to "All Cards" view so cards are visible without an active sprint.
 */
async function setupBoardWithSwimlane(request: any, page: any, label = 'KbShortcut') {
  const email = `test-kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
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
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  return { board, columns, swimlane, token };
}

/**
 * Also creates a card so the card modal can be opened.
 * The card is created via API BEFORE the page is loaded so it appears on first render.
 */
async function setupBoardWithCard(request: any, page: any, label = 'KbShortcut') {
  const email = `test-kb-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: `${label} User` },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `${label} Board` },
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
      data: { name: 'Test Swimlane', designator: 'TS-', color: '#2196F3' },
    })
  ).json();

  // Create the card BEFORE navigating so it is present on first load
  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Shortcut Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.waitForSelector('.board-page', { timeout: 15000 });

  // Switch to All Cards view so the card is visible without an active sprint
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });

  return { board, columns, swimlane, card, token };
}

// ---------------------------------------------------------------------------
// 'b' key — cycle board views
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'b' — cycle views", () => {
  test("'b' key cycles Board → Backlog → All Cards and back", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'BKey');

    // Default view is Board
    await expect(page.locator('.view-btn.active')).toContainText('Board');

    // Focus the page body to ensure the keydown listener is active
    await page.locator('body').click();

    // b → Backlog
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('Backlog', { timeout: 5000 });

    // b → All Cards
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('All Cards', { timeout: 5000 });

    // b → Board again
    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('Board', { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// '/' key — focus search input
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut '/' — focus search", () => {
  test("'/' key focuses the search input", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'SlashKey');

    // Click somewhere neutral (not an input) first
    await page.locator('body').click();

    await page.keyboard.press('/');

    // The search input inside .search-input should receive focus
    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeFocused({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Escape key — close card modal
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'Escape' — close card modal", () => {
  test('Escape closes an open card modal', async ({ page, request }) => {
    await setupBoardWithCard(request, page, 'EscKey');

    // Open the card detail modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.card-detail-modal-unified')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 'n' key — open add card modal
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'n' — open add card modal", () => {
  test("'n' key opens the Create Card modal when swimlane exists", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'NKey');

    // Focus the page body so the keyboard handler fires
    await page.locator('body').click();

    await page.keyboard.press('n');

    // AddCardModal renders with a heading "Create Card"
    await expect(page.locator('.modal h2:has-text("Create Card")')).toBeVisible({ timeout: 5000 });
  });

  test("'n' key modal can be dismissed with Cancel", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'NKeyCancel');

    await page.locator('body').click();
    await page.keyboard.press('n');

    await page.waitForSelector('.modal h2:has-text("Create Card")', { timeout: 5000 });
    await page.click('.modal .form-actions button:has-text("Cancel")');

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// '?' key — show keyboard shortcuts help
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut '?' — shortcuts help modal", () => {
  test("'?' key opens the keyboard shortcuts modal", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKey');

    await page.locator('body').click();

    await page.keyboard.press('?');

    // Layout.tsx renders a .shortcuts-modal with an h3 "Keyboard Shortcuts"
    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.shortcuts-modal h3')).toContainText('Keyboard Shortcuts');
  });

  test("'?' shortcut modal lists expected shortcuts", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKeyContent');

    await page.locator('body').click();
    await page.keyboard.press('?');

    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 });

    // The table should contain the known keys
    const table = page.locator('.shortcuts-table');
    await expect(table).toContainText('n');
    await expect(table).toContainText('b');
    await expect(table).toContainText('/');
    await expect(table).toContainText('Esc');
  });
});
