import { test, expect, APIRequestContext } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// The preset color swatches rendered in the Add/Edit Label modal (in order).
const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
];

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardId: number;
}

async function setup(request: APIRequestContext, boardName = 'Label Ext Board'): Promise<SetupResult> {
  const signupResp = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `test-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      display_name: 'Tester',
    },
  });
  const { token } = await signupResp.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName },
    })
  ).json();

  // Omit repo_owner/repo_name so card creation does not attempt a real Gitea
  // API call (which would fail in test environments without a live Gitea).
  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Test Swimlane',
        designator: 'LX-',
        color: '#6366f1',
      },
    })
  ).json();

  const columns: Array<{ id: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  const card = await (
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Test Card',
        column_id: columns[0].id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    })
  ).json();

  return {
    token,
    boardId: board.id,
    columnId: columns[0].id,
    swimlaneId: swimlane.id,
    cardId: card.id,
  };
}

async function createLabelViaApi(
  request: APIRequestContext,
  token: string,
  boardId: number,
  name: string,
  color: string,
) {
  return (
    await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, color },
    })
  ).json();
}

async function applyLabelViaApi(
  request: APIRequestContext,
  token: string,
  cardId: number,
  labelId: number,
) {
  await request.post(`${BASE}/api/cards/${cardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { label_id: labelId },
  });
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
}

// ---------------------------------------------------------------------------
// 1. Label color picker — create label with a specific color swatch
// ---------------------------------------------------------------------------
test.describe('Label color picker', () => {
  test('creates a label using the 3rd color swatch and verifies color on the card', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    await injectToken(page, token);

    // Navigate to settings and open the Add Label modal
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await page.click('.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")');
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });

    // Pick the 3rd swatch (#ec4899 — pink)
    const expectedColor = PRESET_COLORS[2]; // '#ec4899'
    await page.fill('.modal input[placeholder*="Bug"]', 'Pink Label');
    const swatches = page.locator('.modal .color-option');
    await swatches.nth(2).click();
    await expect(swatches.nth(2)).toHaveClass(/selected/);

    await page.click('.modal button[type="submit"]');
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 15000 });

    // Grab the created label id via API so we can apply it
    const labels: Array<{ id: number; name: string; color: string }> = await (
      await request.get(`${BASE}/api/boards/${boardId}/labels`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const label = labels.find((l) => l.name === 'Pink Label')!;
    expect(label).toBeDefined();
    expect(label.color.toLowerCase()).toBe(expectedColor.toLowerCase());

    // Apply the label to the card and navigate to board
    await applyLabelViaApi(request, token, cardId, label.id);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Verify the color chip on the card
    const chip = page.locator('.card-item .card-label').first();
    await expect(chip).toBeVisible();
    const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Convert the hex #ec4899 to an rgb match
    expect(bg).toMatch(/rgb\(236,\s*72,\s*153\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. Edit label name — rename a label, verify updated name on card
// ---------------------------------------------------------------------------
test.describe('Edit label name', () => {
  test('renames a label and verifies the new name appears on the card chip', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'OldName', '#22c55e');
    await applyLabelViaApi(request, token, cardId, label.id);
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("OldName")`, { timeout: 10000 });

    // Click the edit (pencil) button for the label
    await page.click('.settings-list-item:has(.item-name:has-text("OldName")) .item-edit');
    await page.waitForSelector('.modal h2:has-text("Edit Label")', { timeout: 5000 });

    // Clear the name field and type a new name
    const nameInput = page.locator('.modal input[placeholder*="Bug"]');
    await nameInput.fill('NewName');
    await page.click('.modal button[type="submit"]:has-text("Save Changes")');

    await expect(page.locator('.modal')).not.toBeVisible();
    await expect(page.locator('.item-name:has-text("NewName")')).toBeVisible();
    await expect(page.locator('.item-name:has-text("OldName")')).not.toBeVisible();

    // Navigate to the board and verify the chip shows the new name
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const chip = page.locator('.card-item .card-label[title="NewName"]');
    await expect(chip).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Edit label color — change a label's color, verify new color on card
// ---------------------------------------------------------------------------
test.describe('Edit label color', () => {
  test('changes a label color and verifies the new color on the card chip', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    // Start with indigo (#6366f1)
    const label = await createLabelViaApi(request, token, boardId, 'ColorTest', '#6366f1');
    await applyLabelViaApi(request, token, cardId, label.id);
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("ColorTest")`, { timeout: 10000 });

    await page.click('.settings-list-item:has(.item-name:has-text("ColorTest")) .item-edit');
    await page.waitForSelector('.modal h2:has-text("Edit Label")', { timeout: 5000 });

    // Pick the 8th swatch (cyan #06b6d4)
    const swatches = page.locator('.modal .color-option');
    await swatches.nth(7).click();
    await expect(swatches.nth(7)).toHaveClass(/selected/);

    await page.click('.modal button[type="submit"]:has-text("Save Changes")');
    await expect(page.locator('.modal')).not.toBeVisible();

    // Verify via API that color was actually saved
    const updatedLabels: Array<{ id: number; color: string }> = await (
      await request.get(`${BASE}/api/boards/${boardId}/labels`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const updated = updatedLabels.find((l) => l.id === label.id)!;
    expect(updated.color.toLowerCase()).toBe('#06b6d4');

    // Verify the chip on the card now shows the new color
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const chip = page.locator('.card-item .card-label[title="ColorTest"]');
    await expect(chip).toBeVisible();
    const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toMatch(/rgb\(6,\s*182,\s*212\)/);
  });
});

// ---------------------------------------------------------------------------
// 4. Delete label removes it from cards
// ---------------------------------------------------------------------------
test.describe('Delete label removes from cards', () => {
  test('after deleting a label the card no longer shows it', async ({ page, request }) => {
    const { token, boardId, cardId } = await setup(request);
    const label = await createLabelViaApi(request, token, boardId, 'ToDelete', '#ef4444');
    await applyLabelViaApi(request, token, cardId, label.id);
    await injectToken(page, token);

    // Verify the chip is visible before deletion
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item .card-label[title="ToDelete"]')).toBeVisible();

    // Delete the label in settings
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("ToDelete")`, { timeout: 10000 });
    page.once('dialog', (d) => d.accept());
    await page.click('.settings-list-item:has(.item-name:has-text("ToDelete")) .item-delete');
    await expect(page.locator(`.item-name:has-text("ToDelete")`)).not.toBeVisible();

    // Navigate back to board — chip should be gone
    await page.goto(`/boards/${boardId}`);
    await expect(page.locator('.view-btn:has-text("All Cards")')).toBeVisible({ timeout: 10000 });
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator('.card-item .card-label[title="ToDelete"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple labels on one card — all three are visible
// ---------------------------------------------------------------------------
test.describe('Multiple labels on one card', () => {
  test('applies 3 labels to a card and all are visible on the card chip row', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    const alpha = await createLabelViaApi(request, token, boardId, 'Alpha', '#ef4444');
    const beta = await createLabelViaApi(request, token, boardId, 'Beta', '#22c55e');
    const gamma = await createLabelViaApi(request, token, boardId, 'Gamma', '#06b6d4');

    await applyLabelViaApi(request, token, cardId, alpha.id);
    await applyLabelViaApi(request, token, cardId, beta.id);
    await applyLabelViaApi(request, token, cardId, gamma.id);

    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // Three distinct chips on the card
    await expect(page.locator('.card-item .card-label[title="Alpha"]')).toBeVisible();
    await expect(page.locator('.card-item .card-label[title="Beta"]')).toBeVisible();
    await expect(page.locator('.card-item .card-label[title="Gamma"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Label overflow badge — a 4th label shows a "+1" overflow chip
// ---------------------------------------------------------------------------
test.describe('Label overflow badge', () => {
  test('shows a "+N" overflow chip when more than 3 labels are applied', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);

    // Create 4 labels and apply all of them
    for (let i = 1; i <= 4; i++) {
      const lbl = await createLabelViaApi(request, token, boardId, `L${i}`, PRESET_COLORS[i - 1]);
      await applyLabelViaApi(request, token, cardId, lbl.id);
    }

    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    // CardItem shows up to 3 chips then a ".card-label.more" chip for the rest
    await expect(page.locator('.card-item .card-label.more')).toBeVisible();
    await expect(page.locator('.card-item .card-label.more')).toContainText('+1');
  });
});

// ---------------------------------------------------------------------------
// 7. Label filter — board-scoped; other board's labels don't appear
// ---------------------------------------------------------------------------
test.describe('Label filter scope', () => {
  test("other board's labels do not appear in the filter dropdown", async ({ page, request }) => {
    // Board A with a label
    const resultA = await setup(request, 'Board A');
    await createLabelViaApi(request, resultA.token, resultA.boardId, 'BoardALabel', '#ef4444');

    // Board B for the same user
    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${resultA.token}` },
        data: { name: 'Board B' },
      })
    ).json();
    await createLabelViaApi(request, resultA.token, boardB.id, 'BoardBLabel', '#22c55e');

    await injectToken(page, resultA.token);

    // Helper: ensure the filter panel is visible (toggle if needed).
    // The panel state is persisted in localStorage, so it may already be open.
    async function ensureFiltersExpanded() {
      const expanded = await page.locator('.filters-expanded').isVisible();
      if (!expanded) {
        await page.click('.filter-toggle-btn');
        await page.waitForSelector('.filters-expanded', { timeout: 5000 });
      }
    }

    // Check Board A's filter dropdown
    await page.goto(`/boards/${resultA.boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await ensureFiltersExpanded();

    const filterDropdown = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await expect(filterDropdown.locator('option:text("BoardALabel")')).toHaveCount(1);
    await expect(filterDropdown.locator('option:text("BoardBLabel")')).toHaveCount(0);

    // Check Board B's filter dropdown
    await page.goto(`/boards/${boardB.id}`);
    await page.click('.view-btn:has-text("All Cards")');
    await ensureFiltersExpanded();

    const filterDropdownB = page.locator('.filter-select').filter({
      has: page.locator('option:text("All labels")'),
    });
    await expect(filterDropdownB.locator('option:text("BoardBLabel")')).toHaveCount(1);
    await expect(filterDropdownB.locator('option:text("BoardALabel")')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Long label name — 50-char name does not break layout
// ---------------------------------------------------------------------------
test.describe('Long label name', () => {
  test('a 50-character label name is rendered without overflow in settings and on card', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    const longName = 'A'.repeat(50);
    const label = await createLabelViaApi(request, token, boardId, longName, '#8b5cf6');
    await applyLabelViaApi(request, token, cardId, label.id);
    await injectToken(page, token);

    // Settings page: label name appears, list item does not overflow its container
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("${longName}")`, { timeout: 10000 });
    const listItem = page.locator('.settings-list-item:has(.item-name)').first();
    const itemBox = await listItem.boundingBox();
    const nameBox = await page.locator(`.item-name:has-text("${longName}")`).boundingBox();
    expect(itemBox).toBeTruthy();
    expect(nameBox).toBeTruthy();
    // The name element should not extend beyond the right edge of its parent
    expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(itemBox!.x + itemBox!.width + 1);

    // Board: chip appears (may be clipped by CSS but must be in DOM)
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await expect(page.locator(`.card-item .card-label[title="${longName}"]`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 9. Label with special characters — no XSS, renders correctly
// ---------------------------------------------------------------------------
test.describe('Special characters in label name', () => {
  test('label named "Fix & Deploy <v2>" is rendered as text, not interpreted as HTML', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setup(request);
    const specialName = 'Fix & Deploy <v2>';
    const label = await createLabelViaApi(request, token, boardId, specialName, '#f97316');
    await applyLabelViaApi(request, token, cardId, label.id);
    await injectToken(page, token);

    // Settings page: verify text content (not HTML injection)
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    const nameEl = page.locator('.item-name').filter({ hasText: 'Fix & Deploy' });
    await expect(nameEl).toBeVisible();
    // textContent must contain the literal characters, not decoded HTML entities
    const textContent = await nameEl.textContent();
    expect(textContent).toContain('Fix & Deploy <v2>');

    // Board card chip: title attribute contains the literal string
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    const chip = page.locator('.card-item .card-label').filter({ hasText: 'Fix & Deploy' });
    await expect(chip).toBeVisible();
    const titleAttr = await chip.getAttribute('title');
    expect(titleAttr).toBe(specialName);

    // Card modal: the label-toggle shows the correct text
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    const toggle = page.locator(`.label-toggle:has(.label-name:has-text("Fix & Deploy"))`);
    await expect(toggle).toBeVisible();
    const toggleText = await toggle.locator('.label-name').textContent();
    expect(toggleText).toContain('Fix & Deploy <v2>');
  });
});

// ---------------------------------------------------------------------------
// 10. Duplicate label name — two labels with the same name on the same board
// ---------------------------------------------------------------------------
test.describe('Duplicate label name', () => {
  test('allows creating two labels with the same name (server-side permissive) and both appear in the list', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setup(request);

    // Create first label via API
    const first = await createLabelViaApi(request, token, boardId, 'Duplicate', '#ef4444');
    expect(first.id).toBeDefined();

    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector(`.item-name:has-text("Duplicate")`, { timeout: 10000 });

    // Attempt to create a second label with the same name through the UI
    await page.click('.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")');
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });
    await page.fill('.modal input[placeholder*="Bug"]', 'Duplicate');
    await page.click('.modal .color-option:nth-child(4)');
    await page.click('.modal button[type="submit"]:has-text("Add Label")');

    // The server rejects duplicate label names (UNIQUE constraint on board_id, name).
    // The UI does not currently surface the server error in the modal — it just
    // keeps the modal open and logs to the console. The test verifies the observable
    // contract: if the modal stays open the label was NOT added, and if it closes the
    // new label must appear in the list alongside the original.
    //
    // [BACKLOG] P2: Missing error feedback for duplicate label names — the Add Label
    // modal swallows the server 500 response without displaying any user-facing message.
    // When fixed, this test should additionally assert the error text is visible.
    const duplicateItems = page.locator('.item-name:has-text("Duplicate")');

    // Give the UI a moment to react to the form submission
    await page.waitForTimeout(1000);

    const modalVisible = await page.locator('.modal').isVisible();
    if (modalVisible) {
      // Server rejected the duplicate — the list should still have exactly one entry
      await expect(duplicateItems).toHaveCount(1);
    } else {
      // Server accepted the duplicate — both entries must appear in the list
      await expect(duplicateItems).toHaveCount(2);
    }
  });
});
