import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

test.describe('Card Overdue Display', () => {
  let token: string;
  let boardId: number;
  let columns: any[];
  let swimlaneId: number;

  test.beforeEach(async ({ request, page }) => {
    const email = `test-overdue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    const signupRes = await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Due Date Tester' },
    });
    token = (await signupRes.json()).token;

    // Create board
    const boardRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Due Date Board' },
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

  // Helper: create a card and update its due_date via PUT.
  // The backend PUT handler expects due_date as YYYY-MM-DD (not full ISO).
  async function createCardWithDueDate(
    request: any,
    title: string,
    dueDateYMD: string | null,
  ): Promise<any> {
    const createRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title,
        column_id: columns[0].id,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });
    const card = await createRes.json();
    if (dueDateYMD !== null) {
      await request.put(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: card.title,
          description: card.description || '',
          due_date: dueDateYMD,
        },
      });
    }
    return card;
  }

  // Format a Date as YYYY-MM-DD
  function toYMD(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  test('overdue card shows due date badge with overdue styling', async ({ request, page }) => {
    await createCardWithDueDate(request, 'Overdue Card', '2020-01-01');

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

    // The due date badge should be present with the overdue class
    const dueBadge = page.locator('.card-item .card-due-date.overdue');
    await expect(dueBadge).toBeVisible({ timeout: 8000 });
    await expect(dueBadge).toContainText('Overdue');
  });

  test('due-soon card shows due date badge with due-soon styling', async ({ request, page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createCardWithDueDate(request, 'Due Soon Card', toYMD(tomorrow));

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

    // The due date badge should have due-soon class (not overdue)
    const dueBadge = page.locator('.card-item .card-due-date.due-soon');
    await expect(dueBadge).toBeVisible({ timeout: 8000 });
  });

  test('card due next month shows neutral (not-urgent) due date badge', async ({ request, page }) => {
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    await createCardWithDueDate(request, 'Future Card', toYMD(nextMonth));

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

    // Should show a due date badge but without overdue or due-soon class
    const dueBadge = page.locator('.card-item .card-due-date');
    await expect(dueBadge).toBeVisible({ timeout: 8000 });
    await expect(dueBadge).not.toHaveClass(/overdue/);
    await expect(dueBadge).not.toHaveClass(/due-soon/);
  });

  test('card with no due date shows no due date badge', async ({ request, page }) => {
    // Create card with no due date
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'No Due Date Card',
        column_id: columns[0].id,
        swimlane_id: swimlaneId,
        board_id: boardId,
      },
    });

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

    // No .card-due-date badge should exist
    await expect(page.locator('.card-item .card-due-date')).toHaveCount(0);
  });

  test('overdue filter shows only overdue cards', async ({ request, page }) => {
    // Create overdue card
    await createCardWithDueDate(request, 'Overdue Card', '2020-06-01');
    // Create future due card
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    await createCardWithDueDate(request, 'Future Card', toYMD(nextMonth));

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 10000 });

    // Expand filters
    await page.locator('.filter-toggle-btn').click();
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 6000 });

    // Click the overdue filter button
    const overdueBtn = page.locator('.filter-overdue');
    await expect(overdueBtn).toBeVisible();
    await overdueBtn.click();

    // Only the overdue card should be visible
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Overdue Card');
  });

  test('overdue warning in card modal', async ({ request, page }) => {
    await createCardWithDueDate(request, 'Overdue Modal Card', '2018-03-15');

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 10000 });

    // Open the card modal by clicking the card
    await page.locator('.card-item').first().click();

    // The modal should be open — use the unified modal class
    await expect(page.locator('.modal.card-detail-modal-unified')).toBeVisible({ timeout: 8000 });

    // The due date in the modal header meta should have the overdue class
    const modalDue = page.locator('.card-due.overdue');
    await expect(modalDue).toBeVisible({ timeout: 8000 });
  });

  test('clearing overdue filter shows all cards again', async ({ request, page }) => {
    // Create overdue and future cards
    await createCardWithDueDate(request, 'Overdue Card', '2020-01-01');
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);
    await createCardWithDueDate(request, 'Future Card', toYMD(nextMonth));

    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.board-header')).toBeVisible({ timeout: 10000 });
    await page.locator('.view-btn', { hasText: /All Cards/i }).click();
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 10000 });

    // Enable overdue filter
    await page.locator('.filter-toggle-btn').click();
    await expect(page.locator('.filters-expanded')).toBeVisible({ timeout: 6000 });
    await page.locator('.filter-overdue').click();
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Clear all filters via the clear button (X icon next to filter toggle)
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 6000 });
    await clearBtn.click();

    // All 2 cards should be visible again
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });
  });
});
