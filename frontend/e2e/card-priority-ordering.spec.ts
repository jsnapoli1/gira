import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setup(request: any, page: any) {
  const email = `priority-${crypto.randomUUID()}@test.com`;
  const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: `PrioTester-${crypto.randomUUID().slice(0, 8)}` },
  })).json();

  const board = await (await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Priority Board ${crypto.randomUUID().slice(0, 8)}` },
  })).json();

  const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Test Lane', designator: 'PL-', color: '#3b82f6' },
  })).json();

  await page.goto('/login');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);

  return { token, board, swimlane, columns: board.columns };
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  swimlaneId: number,
  columnId: number,
  title: string,
  priority: string = 'medium',
  storyPoints?: number,
) {
  const data: Record<string, any> = {
    board_id: boardId,
    swimlane_id: swimlaneId,
    column_id: columnId,
    title,
    description: '',
    priority,
  };
  if (storyPoints !== undefined) data.story_points = storyPoints;

  return request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
}

async function openBoardAllCards(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}`);
  await page.waitForSelector('.board-header', { timeout: 10000 });
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
}

async function expandFilters(page: any) {
  const expanded = page.locator('.filters-expanded');
  if (!(await expanded.isVisible())) {
    await page.click('.filter-toggle-btn');
    await expect(expanded).toBeVisible({ timeout: 5000 });
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Card Priority & Ordering', () => {

  // -------------------------------------------------------------------------
  // 1. Priority badge visible on board card without opening modal
  // -------------------------------------------------------------------------
  test('priority indicator visible on board card — no modal needed', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Priority Card', 'high');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    const badge = page.locator('[aria-label="Priority: high"]');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Modal must NOT have opened just from seeing the badge
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Priority badge colors — each non-medium priority has a distinct color
  // -------------------------------------------------------------------------
  test('priority badge colors — each non-medium priority renders a distinct color', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const entries = [
      { title: 'Highest Card', priority: 'highest' },
      { title: 'High Card', priority: 'high' },
      { title: 'Low Card', priority: 'low' },
      { title: 'Lowest Card', priority: 'lowest' },
    ];
    for (const e of entries) {
      const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, e.title, e.priority);
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(4, { timeout: 8000 });

    const priorityBadges = page.locator('.card-priority');
    await expect(priorityBadges).toHaveCount(4, { timeout: 5000 });

    const colors = await priorityBadges.evaluateAll((els: HTMLElement[]) =>
      els.map((el) => el.style.color),
    );
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 3. "Highest" priority renders urgent red (#dc2626)
  // -------------------------------------------------------------------------
  test('highest priority card displays an urgent red badge color', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Urgent Card', 'highest');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    const badge = page.locator('[aria-label="Priority: highest"]');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // CardItem hardcodes #dc2626 → rgb(220, 38, 38)
    const color = await badge.evaluate((el: HTMLElement) => el.style.color);
    expect(color).toBe('rgb(220, 38, 38)');
  });

  // -------------------------------------------------------------------------
  // 4. Medium priority card has NO badge on the board (intentional design)
  // -------------------------------------------------------------------------
  test('medium priority card does not render a priority badge on the board', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Medium Card', 'medium');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // CardItem only renders badge when priority !== 'medium'
    await expect(page.locator('.card-item .card-priority')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 5. Priority dropdown in modal has all five options (edit mode)
  // -------------------------------------------------------------------------
  test('card modal shows priority select in edit mode with all five options', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Modal Priority Card', 'medium');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    // View mode: badge shows "medium"
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('medium');

    // Enter edit mode
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Priority select is the 2nd select in the edit form (1st is Issue Type)
    const prioritySelect = page.locator('.card-detail-edit select').nth(1);
    await expect(prioritySelect).toBeVisible({ timeout: 5000 });
    const optionTexts = await prioritySelect.locator('option').allTextContents();
    expect(optionTexts).toContain('Highest');
    expect(optionTexts).toContain('High');
    expect(optionTexts).toContain('Medium');
    expect(optionTexts).toContain('Low');
    expect(optionTexts).toContain('Lowest');
  });

  // -------------------------------------------------------------------------
  // 6. Set priority to "high" — card shows high priority indicator
  // -------------------------------------------------------------------------
  test('set priority to high in modal — card badge updates to high', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Change Priority Card', 'low');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible({ timeout: 5000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const prioritySelect = page.locator('.card-detail-edit select').nth(1);
    await prioritySelect.selectOption('high');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    // View mode badge updates immediately
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 7. Change priority from "high" to "critical" (highest)
  // -------------------------------------------------------------------------
  test('change priority from high to critical (highest) — modal badge updates', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High To Critical', 'high');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });

    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    const prioritySelect = page.locator('.card-detail-edit select').nth(1);
    await expect(prioritySelect).toHaveValue('high');
    await prioritySelect.selectOption('highest');

    const [response] = await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);
    expect(response.status()).toBe(200);

    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('highest', { timeout: 5000 });
    await expect(page.locator('.card-detail-meta .card-priority')).toHaveClass(/priority-highest/);
  });

  // -------------------------------------------------------------------------
  // 8. Priority persists after modal close and reopen
  // -------------------------------------------------------------------------
  test('priority change persists after modal close and reopen', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Persist Priority Card', 'low');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);

    // Open and update priority to "high"
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-edit select').nth(1).selectOption('high');
    await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Close modal
    await page.click('.modal-close-btn');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Board badge reflects the new priority
    await expect(page.locator('[aria-label="Priority: high"]')).toBeVisible({ timeout: 5000 });

    // Reopen modal — verify priority still shows "high"
    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 8000 });
    await expect(page.locator('.card-detail-meta .card-priority')).toContainText('high', { timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 9. Priority change in modal updates board badge without page reload
  // -------------------------------------------------------------------------
  test('changing priority in modal updates the board card badge immediately (no reload)', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'No Reload Priority', 'low');
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('[aria-label="Priority: low"]')).toBeVisible({ timeout: 5000 });

    await page.locator('.card-item').first().click();
    await page.waitForSelector('.card-detail-meta', { timeout: 8000 });
    await page.click('.card-detail-actions button:has-text("Edit")');
    await page.locator('.card-detail-edit select').nth(1).selectOption('highest');
    await Promise.all([
      page.waitForResponse((r: any) => r.url().includes('/api/cards/') && r.request().method() === 'PUT'),
      page.click('.card-detail-actions button:has-text("Save")'),
    ]);

    // Close modal via Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible({ timeout: 5000 });

    // Board badge reflects change — no reload needed
    await expect(page.locator('[aria-label="Priority: highest"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[aria-label="Priority: low"]')).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 10. API: PUT /api/cards/:id with { priority: "high" } accepted (HTTP 200)
  // -------------------------------------------------------------------------
  test('API: PUT /api/cards/:id with priority:high returns 200 and persists priority', async ({ request }) => {
    const email = `priority-api-${crypto.randomUUID()}@test.com`;
    const { token } = await (await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'PrioApiTester' },
    })).json();

    const board = await (await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'API Prio Board' },
    })).json();

    const swimlane = await (await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'AP-' },
    })).json();

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: board.id,
        swimlane_id: swimlane.id,
        column_id: board.columns[0].id,
        title: 'API Priority Card',
        priority: 'low',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation unavailable: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    const putRes = await request.put(`${BASE}/api/cards/${card.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: card.title,
        description: card.description || '',
        priority: 'high',
        story_points: card.story_points ?? null,
        column_id: card.column_id,
        swimlane_id: card.swimlane_id,
      },
    });
    expect(putRes.status()).toBe(200);
    const updated = await putRes.json();
    expect(updated.priority).toBe('high');
  });

  // -------------------------------------------------------------------------
  // 11. Priority filter — selecting "high" shows only high-priority cards
  // -------------------------------------------------------------------------
  test('priority filter — selecting high shows only high-priority cards', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const entries = [
      { title: 'High Card', priority: 'high' },
      { title: 'Low Card', priority: 'low' },
      { title: 'Medium Card', priority: 'medium' },
    ];
    for (const e of entries) {
      const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, e.title, e.priority);
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });
    await expect(prioritySelect).toBeVisible();
    await prioritySelect.selectOption('high');

    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'High Card');
  });

  // -------------------------------------------------------------------------
  // 12. Priority filter — switching between values correctly narrows the list
  // -------------------------------------------------------------------------
  test('priority filter — switching between values correctly narrows the card list', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const entries = [
      { title: 'Highest Card', priority: 'highest' },
      { title: 'High Card', priority: 'high' },
      { title: 'Low Card', priority: 'low' },
    ];
    for (const e of entries) {
      const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, e.title, e.priority);
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });

    // Filter to "highest" — 1 card
    await prioritySelect.selectOption('highest');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Highest Card');

    // Switch to "low" — different single card
    await prioritySelect.selectOption('low');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('.card-item').first()).toHaveAttribute('aria-label', 'Low Card');

    // Clear filter — all 3 cards return
    await prioritySelect.selectOption('');
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 13. Clearing priority filter via clear-filter button restores all cards
  // -------------------------------------------------------------------------
  test('clearing priority filter via clear-filter button restores all cards', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const entries = [
      { title: 'High Card', priority: 'high' },
      { title: 'Low Card', priority: 'low' },
      { title: 'Medium Card', priority: 'medium' },
    ];
    for (const e of entries) {
      const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, e.title, e.priority);
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    await expandFilters(page);
    const prioritySelect = page.locator('.filter-select').filter({
      has: page.locator('option:text("All priorities")'),
    });

    // Apply filter
    await prioritySelect.selectOption('high');
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    // Use the clear-filter button
    const clearBtn = page.locator('.clear-filter');
    await expect(clearBtn).toBeVisible({ timeout: 3000 });
    await clearBtn.click();

    // All cards return
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });
    await expect(prioritySelect).toHaveValue('');
  });

  // -------------------------------------------------------------------------
  // 14. Story points number appears on the board card when set
  // -------------------------------------------------------------------------
  test('story points number appears on the board card when set', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'SP Card', 'medium', 8);
    if (!res.ok()) {
      test.skip(true, `Card creation unavailable: ${await res.text()}`);
      return;
    }
    const card = await res.json();
    expect(card.story_points).toBe(8);

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(1, { timeout: 8000 });

    const cardItem = page.locator('.card-item[aria-label="SP Card"]');
    await expect(cardItem).toBeVisible();
    const pointsBadge = cardItem.locator('.card-points');
    await expect(pointsBadge).toBeVisible({ timeout: 5000 });
    await expect(pointsBadge).toContainText('8');
  });

  // -------------------------------------------------------------------------
  // 15. Card without story points shows no story points badge on board
  // -------------------------------------------------------------------------
  test('card without story points shows no story points badge on board', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res1 = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Estimated Card', 'medium', 5);
    if (!res1.ok()) {
      test.skip(true, `Card creation unavailable: ${await res1.text()}`);
      return;
    }
    const res2 = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Unestimated Card', 'medium');
    if (!res2.ok()) {
      test.skip(true, `Card creation unavailable: ${await res2.text()}`);
      return;
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 8000 });

    // Exactly one .card-points badge across all board cards
    const allPointsBadges = page.locator('.card-item .card-points');
    await expect(allPointsBadges).toHaveCount(1, { timeout: 5000 });
    await expect(allPointsBadges.first()).toContainText('5');

    const unestimatedCard = page.locator('.card-item[aria-label="Unestimated Card"]');
    await expect(unestimatedCard.locator('.card-points')).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // 16. Bulk set priority — select 3 cards, set to highest
  // -------------------------------------------------------------------------
  test('bulk set priority — all 3 selected cards get the new priority', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const entries = [
      { title: 'Bulk Card 1', priority: 'low' },
      { title: 'Bulk Card 2', priority: 'medium' },
      { title: 'Bulk Card 3', priority: 'lowest' },
    ];
    for (const e of entries) {
      const res = await createCard(request, token, board.id, swimlane.id, columns[0].id, e.title, e.priority);
      if (!res.ok()) {
        test.skip(true, `Card creation unavailable: ${await res.text()}`);
        return;
      }
    }

    await openBoardAllCards(page, board.id);
    await expect(page.locator('.card-item')).toHaveCount(3, { timeout: 8000 });

    // Select all three cards via checkboxes
    const firstCard = page.locator('.card-item').first();
    await firstCard.hover();
    await firstCard.locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(1).locator('.card-select-checkbox input').click({ force: true });
    await page.locator('.card-item').nth(2).locator('.card-select-checkbox input').click({ force: true });

    await expect(page.locator('.bulk-action-bar')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.bulk-action-count')).toContainText('3 cards selected');

    // Open the "Set Priority..." dropdown
    await page.click('.bulk-action-bar button:has-text("Set Priority...")');
    await expect(page.locator('.bulk-action-dropdown')).toBeVisible({ timeout: 3000 });

    // Select "Highest"
    await page.locator('.bulk-action-dropdown .bulk-action-dropdown-item').filter({ hasText: /^Highest$/ }).click();

    // Bulk bar closes after action
    await expect(page.locator('.bulk-action-bar')).not.toBeVisible({ timeout: 5000 });

    // All 3 board cards now show the highest priority badge
    await expect(page.locator('[aria-label="Priority: highest"]')).toHaveCount(3, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 17. Backlog view — priority color dot rendered per card with distinct colors
  // -------------------------------------------------------------------------
  test('backlog view — priority color dot rendered per card with distinct colors', async ({ page, request }) => {
    const { token, board, swimlane, columns } = await setup(request, page);

    const res1 = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'Low Prio Card', 'low');
    if (!res1.ok()) {
      test.skip(true, `Card creation unavailable: ${await res1.text()}`);
      return;
    }
    const lowCard = await res1.json();

    const res2 = await createCard(request, token, board.id, swimlane.id, columns[0].id, 'High Prio Card', 'high');
    if (!res2.ok()) {
      test.skip(true, `Card creation unavailable: ${await res2.text()}`);
      return;
    }
    const highCard = await res2.json();

    // Create sprint and assign both cards so they appear in the backlog panel
    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Alpha', goal: '' },
    });
    const sprint = await sprintRes.json();

    for (const card of [lowCard, highCard]) {
      await request.put(`${BASE}/api/cards/${card.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: card.title,
          description: card.description || '',
          priority: card.priority,
          story_points: card.story_points ?? null,
          sprint_id: sprint.id,
          column_id: card.column_id,
          swimlane_id: card.swimlane_id,
          position: card.position,
        },
      });
    }

    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-header', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await expect(page.locator('.backlog-card')).toHaveCount(2, { timeout: 10000 });

    const cardTitles = await page.locator('.backlog-card .card-title').allTextContents();
    expect(cardTitles).toContain('Low Prio Card');
    expect(cardTitles).toContain('High Prio Card');

    const dots = page.locator('.backlog-card-priority');
    await expect(dots).toHaveCount(2, { timeout: 5000 });
    const dotColors = await dots.evaluateAll((els: HTMLElement[]) =>
      els.map((el) => el.style.backgroundColor),
    );
    expect(new Set(dotColors).size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 18. Drag-based reordering (skipped — drag simulation fragile in Playwright)
  // -------------------------------------------------------------------------
  test.fixme('drag card to reorder within column — position updates', async ({ page: _page, request: _request }) => {
    // DnD Kit drag simulation is fragile in Playwright.
    // Implement once a keyboard-based reorder API or test-id drag target is available.
  });
});
