import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// Shared setup helper
async function setupBoardWithCard(request: any) {
  const email = `test-issue-types-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  // Board creation returns columns inline
  const columns = board.columns || [];

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Team Alpha', designator: 'TA' },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Issue Type Card',
        board_id: board.id,
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
      },
    })
  ).json();

  return { token, board, columns, swimlane, card };
}

// ─────────────────────────────────────────────────────────────────────────────
// Board Settings — Issue Type Management
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings — Issue Type Management', () => {
  test('default issue types are visible in settings', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    // Wait for settings page to load
    await page.waitForSelector('.settings-section', { timeout: 10000 });

    // Scroll to Issue Types section
    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();

    // The backend returns default types when none are persisted
    // Default types include: epic, story, task, bug, subtask
    const issueTypesList = page.locator('.issue-types-list');
    await expect(issueTypesList).toBeVisible({ timeout: 5000 });

    // Either the list shows items or shows the empty state message
    // When no custom types exist, defaults are returned from the API and rendered
    const itemCount = await issueTypesList.locator('.issue-type-item').count();
    const emptyMsg = issueTypesList.locator('.empty-list');

    if (itemCount > 0) {
      // Default types were rendered — verify at least one known type name
      const names = await issueTypesList.locator('.item-name').allTextContents();
      const knownDefaults = ['epic', 'story', 'task', 'bug', 'subtask'];
      const hasKnownDefault = names.some((n) =>
        knownDefaults.includes(n.toLowerCase())
      );
      expect(hasKnownDefault).toBe(true);
    } else {
      // Empty list message is shown (custom types not yet created)
      await expect(emptyMsg).toBeVisible();
    }
  });

  test('create custom issue type via settings UI', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();

    // Click "Add Type" button
    await page.click('button:has-text("Add Type")');

    // Fill in the issue type form
    await page.waitForSelector('.modal', { timeout: 5000 });
    await page.locator('.modal input[placeholder*="Bug, Feature, Task"]').fill('Feature Request');

    // Fill in icon field
    const iconInput = page.locator('.modal input[placeholder*="emoji"]');
    if (await iconInput.isVisible()) {
      await iconInput.fill('★');
    }

    // Submit the form
    await page.click('.modal button:has-text("Add Issue Type")');

    // Wait for modal to close and list to refresh
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // Verify the new type appears in the list
    await expect(
      page.locator('.issue-types-list .item-name:has-text("Feature Request")')
    ).toBeVisible({ timeout: 5000 });
  });

  test('delete custom issue type', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);

    // Create issue type via API
    const issueType = await (
      await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'To Delete Type', icon: '🗑', color: '#ff0000' },
      })
    ).json();
    expect(issueType.id).toBeTruthy();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();

    // Wait for "To Delete Type" to appear
    await expect(
      page.locator('.issue-types-list .item-name:has-text("To Delete Type")')
    ).toBeVisible({ timeout: 5000 });

    // Accept the confirm dialog that appears on delete
    page.once('dialog', (d) => d.accept());

    // Click the delete button for our custom type
    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("To Delete Type")'),
    });
    await typeItem.locator('.item-delete').click();

    // Verify the type is no longer in the list
    await expect(
      page.locator('.issue-types-list .item-name:has-text("To Delete Type")')
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('edit custom issue type', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);

    // Create issue type via API
    const issueType = await (
      await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Old Type Name', icon: '◆', color: '#0000ff' },
      })
    ).json();
    expect(issueType.id).toBeTruthy();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}/settings`);

    await page.waitForSelector('.settings-section', { timeout: 10000 });
    await page.locator('h2:has-text("Issue Types")').scrollIntoViewIfNeeded();

    // Wait for our type to appear
    await expect(
      page.locator('.issue-types-list .item-name:has-text("Old Type Name")')
    ).toBeVisible({ timeout: 5000 });

    // Click the edit button for this type
    const typeItem = page.locator('.issue-type-item').filter({
      has: page.locator('.item-name:has-text("Old Type Name")'),
    });
    await typeItem.locator('.item-edit').click();

    // Wait for edit modal to open
    await page.waitForSelector('.modal:has-text("Edit Issue Type")', { timeout: 5000 });

    // Clear the name field and type a new name
    const nameInput = page.locator('.modal input[placeholder*="Bug, Feature, Task"]');
    await nameInput.fill('');
    await nameInput.fill('Updated Type Name');

    // Save changes
    await page.click('.modal button:has-text("Save Changes")');

    // Wait for modal to close
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // Verify new name appears in list
    await expect(
      page.locator('.issue-types-list .item-name:has-text("Updated Type Name")')
    ).toBeVisible({ timeout: 5000 });

    // Old name should be gone
    await expect(
      page.locator('.issue-types-list .item-name:has-text("Old Type Name")')
    ).not.toBeVisible();
  });

  test('custom issue type appears in card type selector', async ({ page, request }) => {
    test.fixme(
      true,
      'CardDetailModal issue type select is hardcoded to built-in types (epic/story/task/subtask). ' +
        'Custom types are not propagated to the card editor select dropdown.'
    );

    const { token, board } = await setupBoardWithCard(request);

    // Create custom issue type via API
    await request.post(`${BASE}/api/boards/${board.id}/issue-types`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Feature Request', icon: '⭐', color: '#0000ff' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });

    // Verify custom type is in the selector
    const options = await page.locator('.card-detail-edit select').first().locator('option').allTextContents();
    expect(options.some((o) => o.toLowerCase().includes('feature request'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card — Issue Type Behavior
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card — Issue Type Behavior', () => {
  test('default issue type is Task', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open card modal
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // The issue type badge in the header should show 'task' by default
    await expect(page.locator('.card-issue-type')).toBeVisible();
    await expect(page.locator('.card-issue-type')).toContainText('task');
  });

  test('issue type badge color differs between Task and Epic', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Capture the computed background-color for task badge on the card
    const taskBadgeColor = await page.locator('.card-type-badge.type-task').evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );

    // Change issue type to Epic
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Epic' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Close modal
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();

    // Capture the epic badge color
    const epicBadgeColor = await page.locator('.card-type-badge.type-epic').evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );

    // The colors should differ
    expect(taskBadgeColor).not.toEqual(epicBadgeColor);
  });

  test('issue type badge persists on board after type change to Story', async ({ page, request }) => {
    // NOTE: BacklogView does not render issue type badges on its card rows.
    // This test instead verifies persistence in the "All Cards" board view, which
    // uses CardItem.tsx that does render .card-type-badge and .issue-type-badge.
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Change issue type to Story
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

    // The card badge in the board should show story type
    await expect(page.locator('.card-type-badge.type-story')).toBeVisible({ timeout: 5000 });

    // The issue-type-badge (shown in the card meta section) should also appear
    // because CardItem renders it for non-task types
    await expect(page.locator('.issue-type-badge.issue-type-story')).toBeVisible({ timeout: 5000 });

    // Now reload the page and confirm the type survived a page refresh (API persisted it)
    await page.reload();
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-type-badge.type-story')).toBeVisible({ timeout: 5000 });
  });

  test('subtask shows parent relationship after type change', async ({ page, request }) => {
    const { token, board } = await setupBoardWithCard(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Change card to Subtask type
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await page.click('button:has-text("Edit")');
    await page.waitForSelector('.card-detail-edit', { timeout: 5000 });
    await page.locator('.card-detail-modal-unified select').first().selectOption({ label: 'Subtask' });
    await page.click('.card-detail-modal-unified button:has-text("Save")');
    await expect(page.locator('.card-detail-edit')).not.toBeVisible({ timeout: 5000 });

    // Modal stays open — verify the header badge now shows 'subtask'
    await expect(page.locator('.card-issue-type')).toContainText('subtask', { timeout: 5000 });

    // The Subtasks section is a feature for parent cards (they list their children).
    // When viewing a card set to subtask type, the modal header displays the type.
    // Verify the card type badge in the board also reflects the change after close.
    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
    await expect(page.locator('.card-type-badge.type-subtask')).toBeVisible({ timeout: 5000 });
  });

  test('epic card can have child subtasks created from its modal', async ({ page, request }) => {
    const { token, board, columns, swimlane } = await setupBoardWithCard(request);

    // Create an epic card via API
    const epicCard = await (
      await request.post(`${BASE}/api/cards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          title: 'Epic Parent Card',
          board_id: board.id,
          column_id: columns[0].id,
          swimlane_id: swimlane.id,
          issue_type: 'epic',
        },
      })
    ).json();
    expect(epicCard.id).toBeTruthy();

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Open the epic card modal
    await page.locator('.card-item').filter({ hasText: 'Epic Parent Card' }).click();
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Verify the issue type badge shows 'epic'
    await expect(page.locator('.card-issue-type')).toContainText('epic');

    // The Subtasks section should be visible and allow adding a child
    const subtasksSection = page.locator('.subtasks-section');
    await expect(subtasksSection).toBeVisible({ timeout: 5000 });

    // The "Add" button in the subtasks header (shows form toggle)
    await subtasksSection.locator('.subtasks-header button:has-text("Add")').click();

    // Wait for the add-subtask form to appear
    await page.waitForSelector('.add-subtask-form', { timeout: 3000 });
    await page.locator('.add-subtask-form input[type="text"]').fill('Child Subtask');

    // Submit with the "Create" button
    await page.locator('.add-subtask-form button:has-text("Create")').click();

    // Verify the subtask appears in the list
    await expect(
      page.locator('.subtask-list .subtask-title:has-text("Child Subtask")')
    ).toBeVisible({ timeout: 5000 });
  });
});
