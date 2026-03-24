import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

test.describe('Column WIP Limits', () => {
  let token: string;
  let boardId: number;
  let columns: any[];
  let swimlaneId: number;

  test.beforeEach(async ({ request, page }) => {
    const email = `test-wip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'WIP Tester' },
    });
    token = (await signupRes.json()).token;

    // Create board
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'WIP Board' },
    });
    const board = await boardRes.json();
    boardId = board.id;

    // Fetch columns
    const columnsRes = await request.get(`${BASE}/api/boards/${boardId}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    columns = await columnsRes.json();

    // Create a swimlane
    const swimlaneRes = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team', designator: 'TM' },
    });
    const swimlane = await swimlaneRes.json();
    swimlaneId = swimlane.id;

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
  });

  test('column card count shown when cards exist', async ({ request, page }) => {
    // Create 2 cards in the first column
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card 1',
        column_id: columns[0].id,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card 2',
        column_id: columns[0].id,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    // Switch to All Cards view so cards are visible without a sprint
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 10000 });

    // Column header should show count badge for the column containing our cards
    const columnCountBadge = page.locator('.column-count').first();
    await expect(columnCountBadge).toBeVisible({ timeout: 8000 });
    await expect(columnCountBadge).toHaveText('2');
  });

  test('column count badge absent when column has no cards', async ({ page }) => {
    // No cards created — navigate and switch to All Cards view
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });

    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.board-content')).toBeVisible({ timeout: 8000 });

    // No cards, so no .column-count badges should appear
    await expect(page.locator('.column-count')).toHaveCount(0);
  });

  test.fixme('set WIP limit in board settings', async ({ page }) => {
    // WIP limit configuration in board settings is not yet implemented.
    // The Column type and settings UI have no wip_limit field.
    await page.goto(`/boards/${boardId}/settings`);
    const wipInput = page.locator('input[name="wip_limit"]').first();
    await expect(wipInput).toBeVisible({ timeout: 8000 });
    await wipInput.fill('3');
    await page.locator('button:has-text("Save")').first().click();
  });

  test.fixme('WIP limit indicator shown in column header', async ({ page }) => {
    // WIP limit display in column headers is not yet implemented.
    // When wip_limit > 0, the column header should show "X/3" format.
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    const wipIndicator = page.locator('.wip-limit').first();
    await expect(wipIndicator).toBeVisible({ timeout: 8000 });
  });

  test.fixme('WIP exceeded styling applied when cards exceed limit', async ({ request, page }) => {
    // WIP limit enforcement and exceeded styling (.wip-exceeded) are not yet implemented.
    // Create 4 cards, set WIP limit to 3, verify exceeded class on column header.
    for (let i = 1; i <= 4; i++) {
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: `Card ${i}`,
          column_id: columns[0].id,
          swimlane_id: swimlaneId,
          board_id: boardId,
        },
      });
    }
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.wip-exceeded')).toBeVisible({ timeout: 8000 });
  });

  test.fixme('WIP limit 0 means unlimited — no limit indicator shown', async ({ page }) => {
    // WIP limit = 0 means no limit is enforced.
    // When wip_limit is 0 or unset, no limit indicator should appear in the column header.
    await page.goto(`/boards/${boardId}`);
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.wip-limit')).toHaveCount(0);
  });
});
