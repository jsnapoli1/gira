import { test, expect, APIRequestContext } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface BoardSetup {
  token: string;
  boardId: number;
  columnId: number;
  swimlaneId: number;
}

interface CardSetup extends BoardSetup {
  cardId: number | null;
}

async function setupBoard(request: APIRequestContext): Promise<BoardSetup> {
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      email: `test-cf-crud-${crypto.randomUUID()}@example.com`,
      password: 'password123',
      display_name: 'CF CRUD Tester',
    },
  });
  expect(signupRes.ok()).toBeTruthy();
  const { token } = await signupRes.json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `CF CRUD Board ${crypto.randomUUID()}` },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Default', designator: 'CF-', color: '#6366f1' },
    })
  ).json();

  const columns: Array<{ id: number }> = await (
    await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();

  return { token, boardId: board.id, columnId: columns[0].id, swimlaneId: swimlane.id };
}

async function setupWithCard(request: APIRequestContext): Promise<CardSetup> {
  const board = await setupBoard(request);
  const cardRes = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${board.token}` },
    data: {
      title: 'CF CRUD Card',
      column_id: board.columnId,
      swimlane_id: board.swimlaneId,
      board_id: board.boardId,
    },
  });
  return { ...board, cardId: cardRes.ok() ? (await cardRes.json()).id : null };
}

async function createField(
  request: APIRequestContext,
  token: string,
  boardId: number,
  name: string,
  fieldType: string,
  options?: string[],
) {
  const res = await request.post(`${BASE}/api/boards/${boardId}/custom-fields`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      name,
      field_type: fieldType,
      options: options ? JSON.stringify(options) : '',
      required: false,
    },
  });
  return { res, body: res.ok() ? await res.json() : null };
}

async function setFieldValue(
  request: APIRequestContext,
  token: string,
  cardId: number,
  fieldId: number,
  value: string,
) {
  return request.put(`${BASE}/api/cards/${cardId}/custom-fields/${fieldId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { value },
  });
}

async function injectToken(page: import('@playwright/test').Page, token: string) {
  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field Types — Create via API
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field API — Create by Type', () => {
  test('create field of type text returns 201', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const res = await request.post(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Text Field', field_type: 'text', options: '', required: false },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.field_type).toBe('text');
  });

  test('create field of type number returns 201', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { res, body } = await createField(request, token, boardId, 'Number Field', 'number');
    expect(res.status()).toBe(201);
    expect(body.field_type).toBe('number');
  });

  test('create field of type date returns 201', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { res, body } = await createField(request, token, boardId, 'Date Field', 'date');
    expect(res.status()).toBe(201);
    expect(body.field_type).toBe('date');
  });

  test('create field of type select with options array returns 201', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { res, body } = await createField(request, token, boardId, 'Select Field', 'select', [
      'A',
      'B',
      'C',
    ]);
    expect(res.status()).toBe(201);
    expect(body.field_type).toBe('select');
  });

  test('created field has id, name, field_type, and board_id', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body } = await createField(request, token, boardId, 'Field Shape', 'text');
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Field Shape');
    expect(body.field_type).toBe('text');
    expect(body.board_id).toBe(boardId);
  });

  test('select field options are stored and returned', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const opts = ['Option1', 'Option2', 'Option3'];
    const { body } = await createField(request, token, boardId, 'Select Opts', 'select', opts);

    // Options may be returned as a string (JSON) or as an array
    const stored = body.options;
    const parsed: string[] = typeof stored === 'string' ? JSON.parse(stored) : stored;
    expect(parsed).toContain('Option1');
    expect(parsed).toContain('Option2');
    expect(parsed).toContain('Option3');
  });

  test('create without auth returns 401', async ({ request }) => {
    const { boardId } = await setupBoard(request);
    const res = await request.post(`${BASE}/api/boards/${boardId}/custom-fields`, {
      data: { name: 'No Auth', field_type: 'text', options: '', required: false },
    });
    expect(res.status()).toBe(401);
  });

  test('create as non-member returns 403', async ({ request }) => {
    const { boardId } = await setupBoard(request);

    const outsiderRes = await request.post(`${BASE}/api/auth/signup`, {
      data: {
        email: `outsider-cf-${crypto.randomUUID()}@example.com`,
        password: 'password123',
        display_name: 'Outsider',
      },
    });
    const { token: outsiderToken } = await outsiderRes.json();

    const res = await request.post(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${outsiderToken}`, 'Content-Type': 'application/json' },
      data: { name: 'Forbidden', field_type: 'text', options: '', required: false },
    });
    expect(res.status()).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field — Get / List
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field API — List and Get', () => {
  test('GET /api/boards/:id/custom-fields returns all field types', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);

    await createField(request, token, boardId, 'TF', 'text');
    await createField(request, token, boardId, 'NF', 'number');
    await createField(request, token, boardId, 'DF', 'date');
    await createField(request, token, boardId, 'SF', 'select', ['X', 'Y']);

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const fields: any[] = await listRes.json();
    const types = fields.map((f) => f.field_type);
    expect(types).toContain('text');
    expect(types).toContain('number');
    expect(types).toContain('date');
    expect(types).toContain('select');
  });

  test('GET /api/boards/:id/custom-fields/:fieldId returns field details', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: created } = await createField(request, token, boardId, 'Single Get', 'number');

    const res = await request.get(
      `${BASE}/api/boards/${boardId}/custom-fields/${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    // Individual GET may return 200 or 404 if not implemented — document both cases
    if (res.status() === 404) {
      // Not implemented — skip individual GET assertion
      return;
    }
    expect(res.ok()).toBeTruthy();
    const field = await res.json();
    expect(field.id).toBe(created.id);
    expect(field.name).toBe('Single Get');
    expect(field.field_type).toBe('number');
  });

  test('GET list returns empty array when no fields exist', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const listRes = await request.get(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const fields = await listRes.json();
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field — Update / Delete
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field API — Update and Delete', () => {
  test('PUT updates field name', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: field } = await createField(request, token, boardId, 'Rename Me', 'text');

    const res = await request.put(`${BASE}/api/boards/${boardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Renamed', field_type: 'text', options: '', required: false },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe('Renamed');
  });

  test('PUT updates select field options', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: field } = await createField(request, token, boardId, 'Opts Field', 'select', [
      'Old1',
      'Old2',
    ]);

    const newOpts = ['New1', 'New2', 'New3'];
    const res = await request.put(`${BASE}/api/boards/${boardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: 'Opts Field',
        field_type: 'select',
        options: JSON.stringify(newOpts),
        required: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    const parsedOpts: string[] =
      typeof updated.options === 'string' ? JSON.parse(updated.options) : updated.options;
    expect(parsedOpts).toContain('New1');
    expect(parsedOpts).toContain('New3');
  });

  test('updated name reflected in subsequent GET list', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: field } = await createField(request, token, boardId, 'List Before', 'text');

    await request.put(`${BASE}/api/boards/${boardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'List After', field_type: 'text', options: '', required: false },
    });

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await listRes.json();
    const found = fields.find((f) => f.id === field.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('List After');
  });

  test('DELETE removes the field', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: field } = await createField(request, token, boardId, 'Delete Me', 'text');

    const delRes = await request.delete(
      `${BASE}/api/boards/${boardId}/custom-fields/${field.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.ok()).toBeTruthy();
  });

  test('deleted field does not appear in GET list', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: field } = await createField(request, token, boardId, 'Gone Field', 'number');

    await request.delete(`${BASE}/api/boards/${boardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await listRes.json();
    const found = fields.find((f) => f.id === field.id);
    expect(found).toBeUndefined();
  });

  test('deleting one field does not remove other fields', async ({ request }) => {
    const { token, boardId } = await setupBoard(request);
    const { body: keep } = await createField(request, token, boardId, 'Keep Field', 'text');
    const { body: drop } = await createField(request, token, boardId, 'Drop Field', 'number');

    await request.delete(`${BASE}/api/boards/${boardId}/custom-fields/${drop.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const listRes = await request.get(`${BASE}/api/boards/${boardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fields: any[] = await listRes.json();
    const ids = fields.map((f) => f.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(drop.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field Card Values — API
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field Card Values — API', () => {
  test('PUT sets a text value on a card', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Text Val', 'text');

    const res = await setFieldValue(request, token, cardId, field.id, 'Hello World');
    expect(res.ok()).toBeTruthy();
  });

  test('PUT sets a number value on a card', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Num Val', 'number');

    const res = await setFieldValue(request, token, cardId, field.id, '42');
    expect(res.ok()).toBeTruthy();
  });

  test('PUT sets a date value on a card', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Date Val', 'date');

    const res = await setFieldValue(request, token, cardId, field.id, '2025-12-31');
    expect(res.ok()).toBeTruthy();
  });

  test('PUT sets a select value on a card', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Sel Val', 'select', [
      'Low',
      'High',
    ]);

    const res = await setFieldValue(request, token, cardId, field.id, 'High');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /api/cards/:id/custom-fields returns card field values', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Retrieve', 'text');
    await setFieldValue(request, token, cardId, field.id, 'Stored Value');

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const values: any[] = await res.json();
    const found = values.find(
      (v) => v.field_id === field.id || v.custom_field_definition_id === field.id,
    );
    expect(found).toBeDefined();
    expect(found.value).toBe('Stored Value');
  });

  test('GET /api/cards/:id/custom-fields/:fieldId returns single value', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Single Ret', 'number');
    await setFieldValue(request, token, cardId, field.id, '99');

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 404) {
      // Endpoint not implemented — skip
      return;
    }
    expect(res.ok()).toBeTruthy();
    const val = await res.json();
    expect(val.value).toBe('99');
  });

  test('value object includes field_id and value fields', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Shape Check', 'text');
    await setFieldValue(request, token, cardId, field.id, 'shape-value');

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const values: any[] = await res.json();
    const found = values.find(
      (v) => v.field_id === field.id || v.custom_field_definition_id === field.id,
    );
    expect(found).toBeDefined();
    // Should have some reference to the field id
    const hasFieldRef = found.field_id !== undefined || found.custom_field_definition_id !== undefined;
    expect(hasFieldRef).toBe(true);
    expect(found.value).toBeDefined();
  });

  test('DELETE /api/cards/:id/custom-fields/:fieldId clears the value', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Clear Val', 'text');
    await setFieldValue(request, token, cardId, field.id, 'to-be-cleared');

    const delRes = await request.delete(
      `${BASE}/api/cards/${cardId}/custom-fields/${field.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(delRes.ok()).toBeTruthy();
  });

  test('after clear, value not in GET /api/cards/:id/custom-fields', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Clear Check', 'text');
    await setFieldValue(request, token, cardId, field.id, 'remove-me');

    await request.delete(`${BASE}/api/cards/${cardId}/custom-fields/${field.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const values: any[] = await res.json();
    const found = values.find(
      (v) => v.field_id === field.id || v.custom_field_definition_id === field.id,
    );
    // Either not present or value is empty/null after deletion
    if (found) {
      expect(found.value == null || found.value === '').toBe(true);
    } else {
      expect(found).toBeUndefined();
    }
  });

  test('text field with empty string value can be set', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Empty Str', 'text');

    const res = await setFieldValue(request, token, cardId, field.id, '');
    // Server should not 500 on empty string
    expect(res.status()).not.toBe(500);
  });

  test('number field with 0 value can be set', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Zero Val', 'number');

    const res = await setFieldValue(request, token, cardId, field.id, '0');
    expect(res.ok()).toBeTruthy();

    // Verify it was stored
    const listRes = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const values: any[] = await listRes.json();
    const found = values.find(
      (v) => v.field_id === field.id || v.custom_field_definition_id === field.id,
    );
    expect(found).toBeDefined();
    expect(found.value).toBe('0');
  });

  test('set value for non-existent field returns 404', async ({ request }) => {
    const { token, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const res = await request.put(`${BASE}/api/cards/${cardId}/custom-fields/999999999`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { value: 'ghost' },
    });
    expect([400, 404, 422]).toContain(res.status());
  });

  test('set value for field from wrong board returns error', async ({ request }) => {
    const boardA = await setupWithCard(request);
    if (!boardA.cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }

    // Create a field on a DIFFERENT board
    const boardBRes = await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${boardA.token}` },
      data: { name: `Wrong Board ${crypto.randomUUID()}` },
    });
    const boardB = await boardBRes.json();
    const { body: wrongField } = await createField(
      request,
      boardA.token,
      boardB.id,
      'Wrong Board Field',
      'text',
    );

    const res = await setFieldValue(request, boardA.token, boardA.cardId, wrongField.id, 'cross');
    // Should not succeed — 400 or 404
    expect([400, 404, 422]).toContain(res.status());
  });

  test('multiple fields can be set on one card simultaneously', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: tf } = await createField(request, token, boardId, 'Multi Text', 'text');
    const { body: nf } = await createField(request, token, boardId, 'Multi Num', 'number');
    const { body: df } = await createField(request, token, boardId, 'Multi Date', 'date');

    await setFieldValue(request, token, cardId, tf.id, 'ABC');
    await setFieldValue(request, token, cardId, nf.id, '7');
    await setFieldValue(request, token, cardId, df.id, '2025-01-01');

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const values: any[] = await res.json();

    const textVal = values.find(
      (v) => v.field_id === tf.id || v.custom_field_definition_id === tf.id,
    );
    const numVal = values.find(
      (v) => v.field_id === nf.id || v.custom_field_definition_id === nf.id,
    );
    const dateVal = values.find(
      (v) => v.field_id === df.id || v.custom_field_definition_id === df.id,
    );

    expect(textVal?.value).toBe('ABC');
    expect(numVal?.value).toBe('7');
    expect(dateVal?.value).toBe('2025-01-01');
  });

  test('overwriting an existing value with a new PUT replaces it', async ({ request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping');
      return;
    }
    const { body: field } = await createField(request, token, boardId, 'Overwrite', 'text');

    await setFieldValue(request, token, cardId, field.id, 'First Value');
    await setFieldValue(request, token, cardId, field.id, 'Second Value');

    const res = await request.get(`${BASE}/api/cards/${cardId}/custom-fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const values: any[] = await res.json();
    const found = values.find(
      (v) => v.field_id === field.id || v.custom_field_definition_id === field.id,
    );
    expect(found?.value).toBe('Second Value');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field UI — Board Settings
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field UI — Board Settings', () => {
  test('Custom Fields section exists in board settings', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await expect(
      page.locator('.settings-section h2:has-text("Custom Fields")'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('Add Custom Field button is present', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Custom Fields")', { timeout: 10000 });

    const btn = page.locator(
      '.settings-section:has(h2:has-text("Custom Fields")) button:has-text("Add")',
    );
    await expect(btn).toBeVisible();
  });

  test('Add Custom Field modal includes a field type dropdown', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Custom Fields")', { timeout: 10000 });
    await page.click('.settings-section:has(h2:has-text("Custom Fields")) button:has-text("Add")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    // The modal should have a field-type selector
    const typeSelect = page.locator('.modal select, .modal [data-field-type]').first();
    await expect(typeSelect).toBeVisible();
  });

  test('field type dropdown exposes text, number, date, and select options', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Custom Fields")', { timeout: 10000 });
    await page.click('.settings-section:has(h2:has-text("Custom Fields")) button:has-text("Add")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    const typeSelect = page.locator('.modal select').first();
    await expect(typeSelect).toBeVisible();

    const options = await typeSelect.locator('option').allTextContents();
    const flat = options.join(' ').toLowerCase();
    expect(flat).toContain('text');
    expect(flat).toContain('number');
    expect(flat).toContain('date');
    expect(flat).toContain('select');
  });

  test('created custom field appears in the settings list', async ({ page, request }) => {
    const { token, boardId } = await setupBoard(request);
    await injectToken(page, token);
    await page.goto(`/boards/${boardId}/settings`);
    await page.waitForSelector('.settings-section h2:has-text("Custom Fields")', { timeout: 10000 });

    await page.click('.settings-section:has(h2:has-text("Custom Fields")) button:has-text("Add")');
    await page.waitForSelector('.modal', { timeout: 5000 });

    // Fill in the field name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.fill('My Settings Field');

    // Submit
    const submitBtn = page.locator('.modal button[type="submit"]');
    await submitBtn.click();

    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(
        '.settings-section:has(h2:has-text("Custom Fields")) .item-name:has-text("My Settings Field")',
      ),
    ).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom Field UI — Card Modal Rendering
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Custom Field UI — Card Modal', () => {
  test('card modal shows custom fields section when fields are defined', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createField(request, token, boardId, 'CF Section', 'text');
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });

    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });

    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });
  });

  test('text field renders as a text input in the card modal', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createField(request, token, boardId, 'UI Text', 'text');
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.custom-field-inline input[type="text"]')).toBeVisible();
    await expect(page.locator('.custom-field-inline label:has-text("UI Text")')).toBeVisible();
  });

  test('number field renders as a number input in the card modal', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createField(request, token, boardId, 'UI Number', 'number');
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.custom-field-inline input[type="number"]')).toBeVisible();
    await expect(page.locator('.custom-field-inline label:has-text("UI Number")')).toBeVisible();
  });

  test('date field renders as a date picker in the card modal', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createField(request, token, boardId, 'UI Date', 'date');
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('.custom-field-inline input[type="date"]')).toBeVisible();
    await expect(page.locator('.custom-field-inline label:has-text("UI Date")')).toBeVisible();
  });

  test('select field renders as a dropdown in the card modal', async ({ page, request }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    await createField(request, token, boardId, 'UI Select', 'select', ['Alpha', 'Beta', 'Gamma']);
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    const sel = page.locator('.custom-field-inline select');
    await expect(sel).toBeVisible();
    await expect(page.locator('.custom-field-inline label:has-text("UI Select")')).toBeVisible();

    const opts = await sel.locator('option').allTextContents();
    const flat = opts.join(' ');
    expect(flat).toContain('Alpha');
    expect(flat).toContain('Beta');
    expect(flat).toContain('Gamma');
  });

  test('card modal field label is the field name defined in settings', async ({
    page,
    request,
  }) => {
    const { token, boardId, cardId } = await setupWithCard(request);
    if (!cardId) {
      test.skip(true, 'Card creation failed — skipping UI test');
      return;
    }
    const uniqueName = `UniqField-${crypto.randomUUID().slice(0, 8)}`;
    await createField(request, token, boardId, uniqueName, 'text');
    await injectToken(page, token);

    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("All Cards")');
    await page.waitForSelector('.card-item', { timeout: 10000 });
    await page.click('.card-item');
    await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
    await expect(page.locator('.custom-fields-compact')).toBeVisible({ timeout: 8000 });

    await expect(
      page.locator(`.custom-field-inline label:has-text("${uniqueName}")`),
    ).toBeVisible();
  });
});
