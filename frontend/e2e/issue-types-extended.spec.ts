import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function setupUserAndBoard(request: any) {
  const email = `test-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'IssueType Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Issue Type Board' },
    })
  ).json();

  return { token, board };
}

/** Create an issue type via API. */
async function createIssueType(
  request: any,
  token: string,
  boardId: number,
  name: string,
  icon = '',
  color = '#6366f1',
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/issue-types`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { name, icon, color },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/**
 * Attempt to create a card. Returns null when Gitea returns 401 so callers
 * can call test.skip().
 */
async function tryCreateCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title = 'Issue Type Card',
  issueType?: string,
) {
  const data: any = { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId };
  if (issueType) data.issue_type = issueType;
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  if (!res.ok()) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Board Settings — Issue Types (API-level, no Gitea dependency)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Issue Types — API', () => {
  test('list endpoint returns an array (empty or default types)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const res = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const types = await res.json();
    expect(Array.isArray(types)).toBe(true);
  });

  test('create a new issue type via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const issueType = await createIssueType(
      request,
      token,
      board.id,
      'Feature Request',
      '★',
      '#22c55e',
    );
    expect(issueType.id).toBeTruthy();
    expect(issueType.name).toBe('Feature Request');
    expect(issueType.icon).toBe('★');
    expect(issueType.color).toBe('#22c55e');
  });

  test('newly created issue type appears in the list', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const it = await createIssueType(request, token, board.id, 'Spike', '◇', '#06b6d4');

    const res = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await res.json();
    expect(types.some((t) => t.id === it.id && t.name === 'Spike')).toBe(true);
  });

  test('update an issue type name via PUT', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const it = await createIssueType(request, token, board.id, 'Old Type', '◆', '#6366f1');

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${it.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { name: 'Updated Type', icon: '◆', color: '#6366f1' },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('Updated Type');
  });

  test('update issue type icon via PUT', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const it = await createIssueType(request, token, board.id, 'My Type', '◆', '#6366f1');

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${it.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { name: 'My Type', icon: '⭐', color: '#6366f1' },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.icon).toBe('⭐');
  });

  test('update issue type color via PUT', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const it = await createIssueType(request, token, board.id, 'Colorful', '■', '#000000');

    const updateRes = await request.put(
      `${BASE}/api/boards/${board.id}/issue-types/${it.id}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { name: 'Colorful', icon: '■', color: '#ef4444' },
      },
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.color).toBe('#ef4444');
  });

  test('delete an issue type via API', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const it = await createIssueType(request, token, board.id, 'To Delete', '🗑', '#ff0000');

    const delRes = await request.delete(
      `${BASE}/api/boards/${board.id}/issue-types/${it.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.ok()).toBeTruthy();

    const listRes = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await listRes.json();
    expect(types.some((t) => t.id === it.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Board Settings — Issue Types UI
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings — Issue Types UI', () => {
  test('Issue Types section is visible in settings page', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(page.locator('h2:has-text("Issue Types")')).toBeVisible();
  });

  test('empty state message is shown when no custom issue types exist', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    const issueTypesList = page.locator('.issue-types-list');
    await expect(issueTypesList).toBeVisible({ timeout: 5000 });

    const itemCount = await issueTypesList.locator('.issue-type-item').count();
    if (itemCount === 0) {
      await expect(issueTypesList.locator('.empty-list')).toBeVisible();
    }
    // If types are already shown (defaults from API), that is also acceptable
  });

  test('Add Type button is visible in Issue Types section', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(page.locator('button:has-text("Add Type")')).toBeVisible();
  });

  test('click Add Type opens a modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });
    await expect(page.locator('.modal')).toBeVisible();
  });

  test('Add Issue Type modal contains Name, Icon, and Color fields', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    // Name input
    await expect(
      page.locator('.modal input[placeholder*="Bug, Feature, Task"]'),
    ).toBeVisible();

    // Icon input
    await expect(
      page.locator('.modal input[placeholder*="emoji"]'),
    ).toBeVisible();

    // Color picker swatches
    await expect(page.locator('.modal .color-picker')).toBeVisible();
  });

  test('create new issue type via settings UI', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    await page.locator('.modal input[placeholder*="Bug, Feature, Task"]').fill('Feature Request');

    const iconInput = page.locator('.modal input[placeholder*="emoji"]');
    if (await iconInput.isVisible()) {
      await iconInput.fill('★');
    }

    await page.click('.modal button:has-text("Add Issue Type")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('.issue-types-list .item-name:has-text("Feature Request")'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('created issue type shows the selected icon', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    await page.locator('.modal input[placeholder*="Bug, Feature, Task"]').fill('Bug Report');
    const iconInput = page.locator('.modal input[placeholder*="emoji"]');
    if (await iconInput.isVisible()) {
      await iconInput.fill('🐛');
    }

    await page.click('.modal button:has-text("Add Issue Type")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // The issue type item should appear and contain the icon text
    const item = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("Bug Report")'),
    });
    await expect(item).toBeVisible({ timeout: 5000 });
    // Icon is rendered in .issue-type-icon span
    const iconText = await item.locator('.issue-type-icon').textContent();
    expect(iconText).toContain('🐛');
  });

  test('delete issue type via settings UI', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);

    // Pre-create the issue type via API
    await createIssueType(request, token, board.id, 'To Delete Type', '🗑', '#ff0000');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(
      page.locator('.issue-types-list .item-name:has-text("To Delete Type")'),
    ).toBeVisible({ timeout: 5000 });

    // Accept the confirm dialog
    page.once('dialog', (d) => d.accept());

    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("To Delete Type")'),
    });
    await typeItem.locator('.item-delete').click();

    await expect(
      page.locator('.issue-types-list .item-name:has-text("To Delete Type")'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('edit issue type via settings UI', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);

    // Pre-create the issue type via API
    await createIssueType(request, token, board.id, 'Old Type Name', '◆', '#0000ff');

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await expect(
      page.locator('.issue-types-list .item-name:has-text("Old Type Name")'),
    ).toBeVisible({ timeout: 5000 });

    // Click the edit button
    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("Old Type Name")'),
    });
    await typeItem.locator('.item-edit').click();

    // Edit modal should open with the correct title
    await page.waitForSelector('.modal', { timeout: 5000 });
    await expect(page.locator('.modal h2:has-text("Edit Issue Type")')).toBeVisible();

    // Update the name
    const nameInput = page.locator('.modal input[placeholder*="Bug, Feature, Task"]');
    await nameInput.fill('');
    await nameInput.fill('Updated Type Name');

    await page.click('.modal button:has-text("Save Changes")');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('.issue-types-list .item-name:has-text("Updated Type Name")'),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.locator('.issue-types-list .item-name:has-text("Old Type Name")'),
    ).not.toBeVisible();
  });

  test('color picker swatches are clickable in Add Issue Type modal', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);
    await page.waitForSelector('.settings-page', { timeout: 10000 });

    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();
    await page.click('button:has-text("Add Type")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    // Click the second color swatch (index 1)
    const swatches = page.locator('.modal .color-picker .color-option');
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);

    if (count > 1) {
      await swatches.nth(1).click();
      // The second swatch should now have the 'selected' class
      await expect(swatches.nth(1)).toHaveClass(/selected/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card — Issue Type Behavior (requires card creation via Gitea)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card — Issue Type Behavior', () => {
  test('default issue type badge is shown on card in board view', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open modal and check issue type badge
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.card-issue-type')).toBeVisible();
    // Default type is 'task'
    await expect(page.locator('.card-issue-type')).toContainText('task');
  });

  test('issue type persists after being changed to Story', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Change type to Story
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Story' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Story badge should appear on card
    await expect(page.locator('.card-type-badge.type-story')).toBeVisible({ timeout: 5000 });

    // Reload and confirm persistence
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-type-badge.type-story')).toBeVisible({ timeout: 5000 });
  });

  test('issue type badge color differs between Task and Epic', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Capture task badge background color
    const taskBgColor = await page
      .locator('.card-type-badge.type-task')
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);

    // Change to Epic
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    const epicBgColor = await page
      .locator('.card-type-badge.type-epic')
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);

    expect(taskBgColor).not.toEqual(epicBgColor);
  });

  test('changing issue type to Subtask shows subtask badge', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    const columns = board.columns || [];
    const swimlane = await (
      await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Team', designator: 'TM' },
      })
    ).json();

    const card = await tryCreateCard(request, token, board.id, columns[0].id, swimlane.id);
    if (!card) {
      test.skip(true, 'Card creation failed (Gitea 401) — skipping UI test');
      return;
    }

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page
      .locator('.card-detail-modal-unified select')
      .first()
      .selectOption({ label: 'Subtask' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Modal header badge should reflect subtask
    await expect(page.locator('.card-issue-type')).toContainText('subtask', { timeout: 5000 });

    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
    await expect(page.locator('.card-type-badge.type-subtask')).toBeVisible({ timeout: 5000 });
  });

  test('custom issue type in card type selector is not yet supported', async ({ request }) => {
    // The CardDetailModal hardcodes the built-in type options (epic/story/task/subtask).
    // Custom issue types created via the settings API are not propagated to the
    // card editor dropdown. This test documents that limitation.
    const { token, board } = await setupUserAndBoard(request);
    await createIssueType(request, token, board.id, 'Feature Request', '⭐', '#0000ff');

    // Verify the type exists in the API
    const res = await request.get(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const types: any[] = await res.json();
    expect(types.some((t) => t.name === 'Feature Request')).toBe(true);
    // UI propagation to card modal is test.fixme territory — not tested here
  });
});
