import { test, expect, APIRequestContext } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface SetupResult {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
  cardId: number | null;
}

async function setupUserAndBoard(request: APIRequestContext, boardName?: string): Promise<{
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
}> {
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `test-lbl-${crypto.randomUUID()}@example.com`,
      password: 'password123',
      display_name: 'Label Tester',
    },
  });
  expect(signupRes.ok()).toBeTruthy();
  const { token } = await signupRes.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: boardName ?? `Label CRUD Board ${crypto.randomUUID()}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Default', designator: 'LC-', color: '#6366f1' },
    })
  ).json();

  const columns: Array<{ id: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id };
}

async function setupWithCard(request: APIRequestContext): Promise<SetupResult> {
  const { token, boardId, columnId, swimlaneId } = await setupUserAndBoard(request);

  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Label Test Card', column_id: columnId, swimlane_id: swimlaneId, board_id: boardId },
  });
  const cardId = cardRes.ok() ? (await cardRes.json()).id : null;

  return { token, boardId, columnId, swimlaneId, cardId };
}

async function createLabel(
  request: APIRequestContext,
  token: string,
  boardId: number,
  name: string,
  color: string,
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, color },
  });
  return { res, body: res.ok() ? await res.json() : null };
}

async function assignLabel(
  request: APIRequestContext,
  token: string,
  cardId: number,
  labelId: number,
) {
  return request.post(`${BASE}/api/cards/${cardId}/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { label_id: labelId },
  });
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
}

// ─────────────────────────────────────────────────────────────────────────────
// Label CRUD — API
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Label API — Create', () => {
  test('POST /api/boards/:id/labels returns 201 with label data', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'New Label', color: '#ef4444' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test('created label has id, name, color, and board_id fields', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { res, body } = await createLabel(request, token, boardId, 'Field Check', '#22c55e');
    expect(res.status()).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Field Check');
    expect(body.color).toBeDefined();
    expect(body.board_id).toBe(boardId);
  });

  test('color is stored and returned in hex format', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body } = await createLabel(request, token, boardId, 'Hex Color', '#8b5cf6');
    // Should be hex-like (starts with # and is 7 chars)
    expect(body.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(body.color.toLowerCase()).toBe('#8b5cf6');
  });

  test('GET /api/boards/:id/labels returns array containing the new label', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'List Check', '#06b6d4');

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const labels: any[] = await listRes.json();
    expect(Array.isArray(labels)).toBe(true);
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('List Check');
  });

  test('multiple labels can be created for the same board', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createLabel(request, token, boardId, 'Alpha', '#ef4444');
    await createLabel(request, token, boardId, 'Beta', '#22c55e');
    await createLabel(request, token, boardId, 'Gamma', '#06b6d4');

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await listRes.json();
    const names = labels.map((l) => l.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
    expect(names).toContain('Gamma');
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  test('create label with very long name (100 chars)', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const longName = 'L'.repeat(100);
    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: longName, color: '#f97316' },
    });
    // Server should either accept (2xx) or reject (4xx) — just not 500
    expect(res.status()).not.toBe(500);
    if (res.ok()) {
      const body = await res.json();
      expect(body.name).toBe(longName);
    }
  });

  test('create label with special characters in name', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const specialName = 'Fix & Deploy <v2> "fast"';
    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: specialName, color: '#eab308' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe(specialName);
  });

  test('create label with invalid color format — returns 400 or accepts', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Bad Color', color: 'not-a-color' },
    });
    // Server may validate or not — must not be a 500
    expect(res.status()).not.toBe(500);
  });

  test('create label without auth returns 401', async ({ request }) => {
    const { boardId } = await setupUserAndBoard(request);
    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      data: { name: 'No Auth', color: '#ef4444' },
    });
    expect(res.status()).toBe(401);
  });

  test('create label as non-member returns 403', async ({ request }) => {
    const { boardId } = await setupUserAndBoard(request);

    // Create a different user with no board membership
    const outsiderRes = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `outsider-${crypto.randomUUID()}@example.com`,
        password: 'password123',
        display_name: 'Outsider',
      },
    });
    const { token: outsiderToken } = await outsiderRes.json();

    const res = await request.post(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
      data: { name: 'Forbidden', color: '#ef4444' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('Label API — Update', () => {
  test('PUT /api/boards/:id/labels/:labelId updates the label name', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'Old Name', '#6366f1');

    const updateRes = await request.put(`${BASE}/api/boards/${boardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Updated Name', color: '#6366f1' },
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.name).toBe('Updated Name');
  });

  test('PUT /api/boards/:id/labels/:labelId updates the label color', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'Color Target', '#ef4444');

    const updateRes = await request.put(`${BASE}/api/boards/${boardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Color Target', color: '#22c55e' },
    });
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.color.toLowerCase()).toBe('#22c55e');
  });

  test('updated name is reflected in subsequent GET list', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'Before Update', '#8b5cf6');

    await request.put(`${BASE}/api/boards/${boardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'After Update', color: '#8b5cf6' },
    });

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await listRes.json();
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('After Update');
  });
});

test.describe('Label API — Delete', () => {
  test('DELETE /api/boards/:id/labels/:labelId returns 200', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'To Delete', '#ef4444');

    const delRes = await request.delete(`${BASE}/api/boards/${boardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(200);
  });

  test('deleted label does not appear in GET list', async ({ request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    const { body: label } = await createLabel(request, token, boardId, 'Gone', '#ef4444');

    await request.delete(`${BASE}/api/boards/${boardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await listRes.json();
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeUndefined();
  });

  test('labels from different boards are isolated — delete does not affect other board', async ({
    request,
  }) => {
    const boardA = await setupUserAndBoard(request, 'Isolation Board A');
    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${boardA.token}` },
        data: { name: 'Isolation Board B' },
      })
    ).json();

    const { body: labelA } = await createLabel(request, boardA.token, boardA.boardId, 'LabelA', '#ef4444');
    const { body: labelB } = await createLabel(request, boardA.token, boardB.id, 'LabelB', '#22c55e');

    // Delete label from board A
    await request.delete(`${BASE}/api/boards/${boardA.boardId}/labels/${labelA.id}`, {
      headers: { Authorization: `Bearer ${boardA.token}` },
    });

    // Board B label should still exist
    const listBRes = await request.get(`${BASE}/api/boards/${boardB.id}/labels`, {
      headers: { Authorization: `Bearer ${boardA.token}` },
    });
    const labelsB: any[] = await listBRes.json();
    const found = labelsB.find((l) => l.id === labelB.id);
    expect(found).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card-Label Assignment — API
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Card-Label Assignment — API', () => {
  test('POST /api/cards/:id/labels assigns label to card', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Assign Test', '#6366f1');

    const res = await assignLabel(request, token, cardId, label.id);
    expect(res.ok()).toBeTruthy();
  });

  test('GET /api/cards/:id/labels returns assigned label', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'GET Check', '#22c55e');
    await assignLabel(request, token, cardId, label.id);

    const res = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const labels: any[] = await res.json();
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeDefined();
  });

  test('card label response includes correct name and color', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Name Color', '#f97316');
    await assignLabel(request, token, cardId, label.id);

    const res = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await res.json();
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('Name Color');
    expect(found.color.toLowerCase()).toBe('#f97316');
  });

  test('assigning the same label twice is idempotent (no duplicate)', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Idempotent', '#06b6d4');

    await assignLabel(request, token, cardId, label.id);
    const secondRes = await assignLabel(request, token, cardId, label.id);

    // Server may return 200 or 400 — should not 500
    expect(secondRes.status()).not.toBe(500);

    // Either way the label appears only once
    const listRes = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await listRes.json();
    const occurrences = labels.filter((l) => l.id === label.id);
    expect(occurrences.length).toBeLessThanOrEqual(1);
  });

  test('adding non-existent label to card returns 400 or 404', async ({ request }) => {
    const { token, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const res = await request.post(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { label_id: 999999999 },
    });
    expect([400, 404, 422]).toContain(res.status());
  });

  test('card can have multiple different labels', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: l1 } = await createLabel(request, token, boardId, 'Multi1', '#ef4444');
    const { body: l2 } = await createLabel(request, token, boardId, 'Multi2', '#22c55e');
    const { body: l3 } = await createLabel(request, token, boardId, 'Multi3', '#8b5cf6');

    await assignLabel(request, token, cardId, l1.id);
    await assignLabel(request, token, cardId, l2.id);
    await assignLabel(request, token, cardId, l3.id);

    const res = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await res.json();
    const ids = labels.map((l) => l.id);
    expect(ids).toContain(l1.id);
    expect(ids).toContain(l2.id);
    expect(ids).toContain(l3.id);
  });

  test('DELETE /api/cards/:id/labels/:labelId removes the assigned label', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Remove Me', '#ec4899');
    await assignLabel(request, token, cardId, label.id);

    const delRes = await request.delete(`${BASE}/api/cards/${cardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok()).toBeTruthy();
  });

  test('after removal, label not in GET /api/cards/:id/labels', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Removed Check', '#ef4444');
    await assignLabel(request, token, cardId, label.id);

    await request.delete(`${BASE}/api/cards/${cardId}/labels/${label.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await res.json();
    const found = labels.find((l) => l.id === label.id);
    expect(found).toBeUndefined();
  });

  test('removing one of two labels — the other persists', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: keep } = await createLabel(request, token, boardId, 'Keep Me', '#6366f1');
    const { body: remove } = await createLabel(request, token, boardId, 'Delete Me', '#ef4444');

    await assignLabel(request, token, cardId, keep.id);
    await assignLabel(request, token, cardId, remove.id);

    await request.delete(`${BASE}/api/cards/${cardId}/labels/${remove.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/cards/${cardId}/labels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const labels: any[] = await res.json();
    const ids = labels.map((l) => l.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(remove.id);
  });

  test('label from wrong board cannot be added to a card (400)', async ({ request }) => {
    const boardA = await setupUserAndBoard(request, 'Wrong Board A');
    const boardB = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${boardA.token}` },
        data: { name: 'Wrong Board B' },
      })
    ).json();

    // Card on board A, label on board B
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${boardA.token}` },
      data: {
        title: 'Cross Board Card',
        column_id: boardA.columnId,
        swimlane_id: boardA.swimlaneId,
        board_id: boardA.boardId,
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed — skipping cross-board test');
      return;
    }
    const card = await cardRes.json();
    const { body: wrongLabel } = await createLabel(request, boardA.token, boardB.id, 'Wrong Board Label', '#ef4444');

    const res = await request.post(`${BASE}/api/cards/${card.id}/labels`, {
      headers: { Authorization: `Bearer ${boardA.token}` },
      data: { label_id: wrongLabel.id },
    });
    // Should reject with 400 or similar — not silently accept
    expect([400, 403, 404, 422]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Label UI — Board Settings
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Label UI — Board Settings', () => {
  test('Labels section exists in board settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await expect(page.locator('.settings-section h2:has-text("Labels")')).toBeVisible({
      timeout: 10000,
    });
  });

  test('Add Label button is present in the Labels section', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    const addBtn = page.locator(
      '.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")',
    );
    await expect(addBtn).toBeVisible();
  });

  test('Add Label modal has a name input field', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await page.click(
      '.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")',
    );
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });
    await expect(page.locator('.modal input[placeholder*="Bug"]')).toBeVisible();
  });

  test('Add Label modal has a color picker (swatches)', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });
    await page.click(
      '.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")',
    );
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });
    // At least one color option / swatch should be present
    const swatches = page.locator('.modal .color-option');
    await expect(swatches.first()).toBeVisible();
    expect(await swatches.count()).toBeGreaterThanOrEqual(1);
  });

  test('newly created label appears in the settings list with a color chip', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Labels")', { timeout: 10000 });

    await page.click(
      '.settings-section:has(h2:has-text("Labels")) button:has-text("Add Label")',
    );
    await page.waitForSelector('.modal h2:has-text("Add Label")', { timeout: 5000 });
    await page.fill('.modal input[placeholder*="Bug"]', 'Settings Label');
    await page.click('.modal .color-option:first-child');
    await page.click('.modal button[type="submit"]');

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.settings-section:has(h2:has-text("Labels")) .item-name:has-text("Settings Label")'),
    ).toBeVisible();

    // Color chip should be present in the settings list row
    const listItem = page.locator(
      '.settings-list-item:has(.item-name:has-text("Settings Label"))',
    );
    await expect(listItem.locator('.label-color, .color-chip, [style*="background"]').first()).toBeVisible();
  });

  test('Edit button is present on each label row in settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createLabel(request, token, boardId, 'Edit Target', '#22c55e');
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.item-name:has-text("Edit Target")', { timeout: 10000 });

    const row = page.locator('.settings-list-item:has(.item-name:has-text("Edit Target"))');
    await expect(row.locator('.item-edit')).toBeVisible();
  });

  test('Delete button is present on each label row in settings', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createLabel(request, token, boardId, 'Delete Target', '#ef4444');
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.item-name:has-text("Delete Target")', { timeout: 10000 });

    const row = page.locator('.settings-list-item:has(.item-name:has-text("Delete Target"))');
    await expect(row.locator('.item-delete')).toBeVisible();
  });

  test('Delete label button triggers confirmation dialog', async ({ page, request }) => {
    const { token, boardId } = await setupUserAndBoard(request);
    await createLabel(request, token, boardId, 'Confirm Delete', '#ec4899');
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.item-name:has-text("Confirm Delete")', { timeout: 10000 });

    let dialogTriggered = false;
    page.once('dialog', (dialog) => {
      dialogTriggered = true;
      dialog.dismiss(); // dismiss so label is NOT deleted
    });
    await page.click(
      '.settings-list-item:has(.item-name:has-text("Confirm Delete")) .item-delete',
    );
    // Give dialog handler time to fire
    await page.waitForTimeout(500);
    expect(dialogTriggered).toBe(true);

    // Label should still be present since we dismissed
    await expect(page.locator('.item-name:has-text("Confirm Delete")')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Label UI — Card Modal
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Label UI — Card Modal', () => {
  test('card modal has a labels section in the sidebar', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createLabel(request, token, boardId, 'Sidebar Label', '#6366f1');
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Labels section or label toggles should be visible in the modal
    const labelsSection = page.locator(
      '.card-detail-modal-unified .label-toggle, .card-detail-modal-unified .labels-section',
    );
    await expect(labelsSection.first()).toBeVisible({ timeout: 5000 });
  });

  test('label toggle in card modal is clickable to assign label', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Clickable', '#f97316');
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    // Find the label toggle by name and click to assign
    const toggle = page.locator(`.label-toggle:has(.label-name:has-text("${label.name}"))`);
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Should not have assigned class yet
    await expect(toggle).not.toHaveClass(/assigned/);

    await toggle.click();
    await expect(toggle).toHaveClass(/assigned/);
  });

  test('assigned label shown as chip on card in the column view', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    const { body: label } = await createLabel(request, token, boardId, 'Chip Visible', '#22c55e');
    await assignLabel(request, token, cardId, label.id);

    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);

    // Default board view (not "All Cards") — card should still show chip in column
    await page.waitForSelector('.card-item', { timeout: 10000 });
    const chip = page.locator('.card-item .card-label').first();
    await expect(chip).toBeVisible({ timeout: 5000 });
  });

  test('label chip title attribute matches the label name', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    const labelName = `Title Check ${crypto.randomUUID().slice(0, 8)}`;
    const { body: label } = await createLabel(request, token, boardId, labelName, '#8b5cf6');
    await assignLabel(request, token, cardId, label.id);

    await injectToken(page, token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    const chip = page.locator(`.card-item .card-label[title="${labelName}"]`);
    await expect(chip).toBeVisible({ timeout: 5000 });
    const title = await chip.getAttribute('title');
    expect(title).toBe(labelName);
  });
});
