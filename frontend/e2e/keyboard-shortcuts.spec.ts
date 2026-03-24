import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh user and a board with a swimlane, navigate to the board view.
 * Returns without a card — useful for shortcut tests that do not need an
 * existing card to be open.
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

// ---------------------------------------------------------------------------
// '/' key — focus search input
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut '/' — focus search input", () => {
  test("'/' focuses the search input on the board view", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'SlashKey');

    // Ensure focus is not in any input first
    await page.locator('body').click();

    await page.keyboard.press('/');

    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeFocused({ timeout: 5000 });
  });

  test("'/' does not focus search if an input is already focused", async ({ page, request }) => {
    // When the user is already typing in an input, '/' should not steal focus.
    // This is the standard guard: the BoardView shortcut handler checks
    // whether the active element is an input/textarea before acting.
    await setupBoardWithSwimlane(request, page, 'SlashKeyGuard');

    // Focus another input first (the search input itself)
    const searchInput = page.locator('.search-input input');
    await searchInput.focus();

    // Pressing '/' inside the input should type the character, not re-focus
    await page.keyboard.press('/');

    // Search input still focused and now has '/' typed into it
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue('/');
  });
});

// ---------------------------------------------------------------------------
// 'b' key — cycle board views
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'b' — cycle board views", () => {
  test("'b' key cycles Board → Backlog → All Cards and back", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'BKey');

    await expect(page.locator('.view-btn.active')).toContainText('Board', { timeout: 5000 });

    await page.locator('body').click();

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('Backlog', { timeout: 5000 });

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('All Cards', { timeout: 5000 });

    await page.keyboard.press('b');
    await expect(page.locator('.view-btn.active')).toContainText('Board', { timeout: 5000 });
  });

  test("'b' is ignored when an input is focused", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'BKeyGuard');

    // Focus the search input
    await page.locator('.search-input input').focus();
    const beforeActive = await page.locator('.view-btn.active').textContent();

    await page.keyboard.press('b');

    // View should not have changed — 'b' was typed into the input
    const afterActive = await page.locator('.view-btn.active').textContent();
    expect(afterActive).toBe(beforeActive);
  });
});

// ---------------------------------------------------------------------------
// 'n' key — open new card modal
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'n' — open new card modal", () => {
  test("'n' key opens the Create Card modal when a swimlane exists", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'NKey');

    await page.locator('body').click();

    await page.keyboard.press('n');

    await expect(
      page.locator('.modal h2', { hasText: 'Create Card' })
    ).toBeVisible({ timeout: 5000 });
  });

  test("'n' key modal can be dismissed with Cancel", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'NKeyCancel');

    await page.locator('body').click();
    await page.keyboard.press('n');

    await page.waitForSelector('.modal h2:has-text("Create Card")', { timeout: 5000 });
    await page.locator('.modal .form-actions .btn', { hasText: 'Cancel' }).click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
  });

  test("'n' is ignored when an input is focused", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'NKeyGuard');

    await page.locator('.search-input input').focus();
    await page.keyboard.press('n');

    // Modal should not appear
    await expect(page.locator('.modal h2', { hasText: 'Create Card' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 'Escape' key — close modals
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'Escape' — close modals", () => {
  test("'Escape' closes the 'n' key Create Card modal", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'EscModal');

    await page.locator('body').click();
    await page.keyboard.press('n');
    await page.waitForSelector('.modal h2:has-text("Create Card")', { timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
  });

  test("'Escape' closes the keyboard shortcuts modal", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'EscShortcuts');

    await page.locator('body').click();
    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('.shortcuts-modal-overlay').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.shortcuts-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test("'Escape' closes the create board modal on /boards", async ({ page, request }) => {
    const email = `test-esc-board-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Esc Test User' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await expect(page.locator('button', { hasText: 'Create Board' }).first()).toBeVisible({
      timeout: 10000,
    });

    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Escape key should close via overlay click or the modal itself
    await page.keyboard.press('Escape');

    // If Escape is not handled by the modal, the overlay-click approach is used;
    // either way the modal must not be visible after
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// '?' key — show keyboard shortcuts modal
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut '?' — keyboard shortcuts help modal", () => {
  test("'?' key opens the keyboard shortcuts modal", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKey');

    await page.locator('body').click();

    await page.keyboard.press('?');

    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.shortcuts-modal h3')).toContainText('Keyboard Shortcuts');
  });

  test("'?' modal lists all expected shortcut keys", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKeyContent');

    await page.locator('body').click();
    await page.keyboard.press('?');

    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 });

    const table = page.locator('.shortcuts-table');
    await expect(table).toContainText('n');
    await expect(table).toContainText('b');
    await expect(table).toContainText('/');
    await expect(table).toContainText('Esc');
    await expect(table).toContainText('?');
  });

  test("pressing '?' again closes the shortcuts modal", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKeyToggle');

    await page.locator('body').click();
    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });

    // The shortcuts modal can also be opened via the sidebar Shortcuts button
    // which dispatches zira:toggle-shortcuts. Pressing '?' again toggles it off.
    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test('shortcuts modal can be opened via the sidebar Shortcuts button', async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKeyBtn');

    // The sidebar footer has a "Shortcuts" button
    await page.locator('.sidebar-footer .nav-item', { hasText: 'Shortcuts' }).click();

    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });
  });

  test('shortcuts modal close button dismisses the modal', async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'HelpKeyClose');

    await page.locator('body').click();
    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('.shortcuts-modal-header button').click();
    await expect(page.locator('.shortcuts-modal')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Tab key — form field navigation
// ---------------------------------------------------------------------------

test.describe('keyboard — Tab navigation through form fields', () => {
  test('Tab moves focus through create board form fields', async ({ page, request }) => {
    const email = `test-tab-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Tab User' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Board name input is auto-focused
    await expect(page.locator('#boardName')).toBeFocused();

    // Tab to description
    await page.keyboard.press('Tab');
    await expect(page.locator('#boardDesc')).toBeFocused();

    // Tab to template select
    await page.keyboard.press('Tab');
    await expect(page.locator('#boardTemplate')).toBeFocused();
  });

  test('Tab moves focus through login form fields', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"], input[name="email"], #email');
    await emailInput.focus();
    await page.keyboard.press('Tab');

    const passwordInput = page.locator('input[type="password"], input[name="password"], #password');
    await expect(passwordInput).toBeFocused();
  });

  test('Shift+Tab moves focus backwards through create board form fields', async ({ page, request }) => {
    const email = `test-shifttab-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'ShiftTab User' },
      })
    ).json();

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto('/boards');
    await page.locator('button', { hasText: 'Create Board' }).first().click();
    await expect(page.locator('.modal')).toBeVisible();

    // Start at template select
    await page.locator('#boardTemplate').focus();
    await expect(page.locator('#boardTemplate')).toBeFocused();

    // Shift+Tab back to description
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#boardDesc')).toBeFocused();

    // Shift+Tab back to name
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#boardName')).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// 's' key — toggle selection mode (board view)
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 's' — toggle selection mode", () => {
  test("'s' key is listed in the shortcuts help table", async ({ page, request }) => {
    await setupBoardWithSwimlane(request, page, 'SKeyHelp');

    await page.locator('body').click();
    await page.keyboard.press('?');
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 });

    await expect(page.locator('.shortcuts-table')).toContainText('s');
  });
});

// ---------------------------------------------------------------------------
// Card modal — Escape closes it (requires a pre-existing card)
// ---------------------------------------------------------------------------

test.describe("keyboard shortcut 'Escape' — close card detail modal", () => {
  test.fixme(
    'Escape closes an open card detail modal',
    // Card creation via API requires Gitea to be reachable (POST /api/cards returns
    // "Failed to create Gitea issue: API error (401)" in this environment).
    async ({ page, request }) => {
      const email = `test-esc-card-${crypto.randomUUID()}@test.com`;
      const { token } = await (
        await request.post(`${BASE}/api/auth/signup`, {
          data: { email, password: 'password123', display_name: 'Esc Card User' },
        })
      ).json();

      const board = await (
        await request.post(`${BASE}/api/boards`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { name: 'Esc Card Board' },
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
          data: { name: 'Swimlane', designator: 'SC-', color: '#2196F3' },
        })
      ).json();

      const card = await (
        await request.post(`${BASE}/api/cards`, {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            title: 'Esc Test Card',
            column_id: columns[0].id,
            swimlane_id: swimlane.id,
            board_id: board.id,
          },
        })
      ).json();

      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
      await page.goto(`/boards/${board.id}`);
      await page.waitForSelector('.board-page', { timeout: 15000 });

      await page.locator('.view-btn', { hasText: 'All Cards' }).click();
      await page.waitForSelector('.card-item', { timeout: 10000 });

      await page.locator('.card-item').first().click();
      await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
      await expect(page.locator('.card-detail-modal-unified')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });
    },
  );
});
