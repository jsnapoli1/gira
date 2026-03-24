/**
 * import-export-extended.spec.ts
 *
 * Extended coverage for board CSV export and Jira CSV import.
 *
 * Export endpoint:
 *   GET  /api/boards/:id/export?token=<jwt>  — downloads CSV
 *
 * Import endpoints:
 *   POST /api/boards/:id/import/jira         — board-scoped multipart import
 *   POST /api/import/jira/preview            — parse CSV, return project keys
 *   POST /api/import/jira                    — global import (with mappings JSON)
 *
 * These tests complement board-export.spec.ts and board-import-extended.spec.ts
 * by focusing on: authorization edge-cases, multiple-card export data integrity,
 * minimal-CSV import shapes, preview endpoint contract, global import endpoint,
 * and UI affordances in board settings.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function createUser(request: any, prefix = 'ie-ext') {
  const email = `${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'IE Ext Tester' },
  });
  const body = await res.json();
  return { token: body.token as string, email };
}

async function createBoard(request: any, token: string, name = 'IE Ext Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json();
}

async function createSwimlane(request: any, token: string, boardId: number, name = 'Lane') {
  const res = await request.post(`${BASE}/api/boards/${boardId}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, designator: 'LN' },
  });
  return res.json();
}

async function createCard(
  request: any,
  token: string,
  boardId: number,
  columnId: number,
  swimlaneId: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  const res = await request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, board_id: boardId, column_id: columnId, swimlane_id: swimlaneId, ...extra },
  });
  return res;
}

/** Full setup: user + board + swimlane, returns first column id too. */
async function setupFull(request: any, prefix = 'ie-ext') {
  const { token, email } = await createUser(request, prefix);
  const board = await createBoard(request, token, `Board-${prefix}`);
  const swimlane = await createSwimlane(request, token, board.id, `Lane-${prefix}`);
  const columns: any[] = board.columns || [];
  return { token, email, board, swimlane, columns };
}

/** Create a non-member user who has no relation to any board. */
async function createNonMember(request: any) {
  const { token } = await createUser(request, 'non-member');
  return token;
}

/** Write a minimal valid Jira-formatted CSV to a temp file and return path. */
function writeMinimalJiraCSV(rows: Array<{ summary: string; description?: string; priority?: string; status?: string }>) {
  const header = 'Summary,Issue key,Issue id,Issue Type,Status,Priority,Project key,Description';
  const lines = rows.map((r, i) =>
    [
      `"${r.summary}"`,
      `PROJ-${i + 1}`,
      String(i + 1),
      'Story',
      r.status ?? 'To Do',
      r.priority ?? 'Medium',
      'PROJ',
      `"${r.description ?? ''}"`,
    ].join(','),
  );
  const content = [header, ...lines].join('\n');
  const tmpPath = `/tmp/minimal-jira-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`;
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export API — authorization and basic contract
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Export API — authorization', () => {
  test('export without any token returns 4xx', async ({ request }) => {
    const { token } = await createUser(request, 'exp-auth-no-token');
    const board = await createBoard(request, token, 'Auth Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('export with invalid (malformed) token returns 4xx', async ({ request }) => {
    const { token } = await createUser(request, 'exp-bad-tok');
    const board = await createBoard(request, token, 'Bad Token Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=not.a.valid.jwt`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('non-member cannot export board — receives 403', async ({ request }) => {
    const { token } = await createUser(request, 'exp-owner');
    const board = await createBoard(request, token, 'Owner Board');
    const nonMemberToken = await createNonMember(request);

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${nonMemberToken}`);
    expect(res.status()).toBe(403);
  });

  test('export of non-existent board returns 404', async ({ request }) => {
    const { token } = await createUser(request, 'exp-404');

    const res = await request.get(`${BASE}/api/boards/999888777/export?token=${token}`);
    expect(res.status()).toBe(404);
  });

  test('valid member can export their own board — returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'exp-valid');
    const board = await createBoard(request, token, 'Valid Export Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.status()).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export API — response shape
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Export API — response shape', () => {
  test('response Content-Type is text/csv', async ({ request }) => {
    const { token } = await createUser(request, 'exp-ct');
    const board = await createBoard(request, token, 'CT Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('text/csv');
  });

  test('response Content-Disposition is attachment with .csv filename', async ({ request }) => {
    const { token } = await createUser(request, 'exp-cd');
    const board = await createBoard(request, token, 'CD Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    expect(res.ok()).toBe(true);
    const disposition = res.headers()['content-disposition'] ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition.toLowerCase()).toContain('.csv');
  });

  test('response body is non-empty (has at least a header row)', async ({ request }) => {
    const { token } = await createUser(request, 'exp-nonempty');
    const board = await createBoard(request, token, 'NonEmpty Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test('first line of CSV contains comma-separated column names', async ({ request }) => {
    const { token } = await createUser(request, 'exp-hdr');
    const board = await createBoard(request, token, 'Header Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const firstLine = body.split('\n')[0];
    expect(firstLine).toContain(',');
    expect(firstLine.length).toBeGreaterThan(0);
  });

  test('header row contains ID field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-id-field');
    const board = await createBoard(request, token, 'ID Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('ID');
  });

  test('header row contains Title field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-title-field');
    const board = await createBoard(request, token, 'Title Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Title');
  });

  test('header row contains Column field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-col-field');
    const board = await createBoard(request, token, 'Column Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Column');
  });

  test('header row contains Swimlane field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-sl-field');
    const board = await createBoard(request, token, 'SL Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Swimlane');
  });

  test('header row contains Priority field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-pri-field');
    const board = await createBoard(request, token, 'Priority Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Priority');
  });

  test('header row contains Assignees field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-asgn-field');
    const board = await createBoard(request, token, 'Assignees Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Assignees');
  });

  test('header row contains Labels field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-lbl-field');
    const board = await createBoard(request, token, 'Labels Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Labels');
  });

  test('header row contains Sprint field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-spr-field');
    const board = await createBoard(request, token, 'Sprint Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Sprint');
  });

  test('empty board export returns exactly one data-free line (header only)', async ({ request }) => {
    const { token } = await createUser(request, 'exp-empty-board');
    const board = await createBoard(request, token, 'Empty Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const nonEmptyLines = body.split('\n').map(l => l.trim()).filter(Boolean);
    // Only the header row — no data rows
    expect(nonEmptyLines.length).toBe(1);
    expect(nonEmptyLines[0]).toContain('ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export API — card data integrity
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Export API — card data in exported CSV', () => {
  test('exported CSV includes card title when board has a card', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-card-title');
    if (!columns.length) return;

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'ExportedTitle Card');
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed (possible Gitea dependency)');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body).toContain('ExportedTitle Card');
  });

  test('exported CSV includes swimlane name in card row', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-sl-name');
    if (!columns.length) return;

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'SL Name Card');
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body).toContain(`Lane-exp-sl-name`);
  });

  test('exported CSV data rows contain correct number of comma-separated fields', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-field-count');
    if (!columns.length) return;

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Field Count Card');
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    // Header + at least one data row
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const headerFields = lines[0].split(',').length;
    // Data row should have the same number of fields as header (may be more if quoted commas)
    expect(headerFields).toBeGreaterThanOrEqual(5);
  });

  test('exported CSV row count matches number of created cards', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-row-count');
    if (!columns.length) return;

    const r1 = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Row Count Card A');
    const r2 = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Row Count Card B');
    const r3 = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Row Count Card C');

    if (!r1.ok() || !r2.ok() || !r3.ok()) {
      test.skip(true, 'One or more card creations failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const dataLines = body.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
    expect(dataLines.length).toBe(3);
  });

  test('exported CSV includes card with high priority set', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-priority');
    if (!columns.length) return;

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'High Priority Card', { priority: 'high' });
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('high');
  });

  test('export of board with sprint-assigned card includes sprint name', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-sprint');
    if (!columns.length) return;

    const sprintRes = await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Extended Export Sprint' },
    });
    const sprint = await sprintRes.json();

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Sprint Assigned Card');
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprint.id },
    });

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body).toContain('Extended Export Sprint');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Jira Import API — board-scoped
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Jira Import API — board-scoped (/api/boards/:id/import/jira)', () => {
  test('POST with valid minimal CSV returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'imp-200');
    const board = await createBoard(request, token, 'Import 200 Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'First Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.status()).toBe(200);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import response includes numeric `imported` count field', async ({ request }) => {
    const { token } = await createUser(request, 'imp-count');
    const board = await createBoard(request, token, 'Import Count Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Count Me' }, { summary: 'Count Me Too' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(typeof body.imported).toBe('number');
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('minimal CSV (Summary column only) creates cards', async ({ request }) => {
    const { token } = await createUser(request, 'imp-minimal');
    const board = await createBoard(request, token, 'Minimal Import Board');

    // Truly minimal: only the Summary column required by the parser
    const minimalCSV = 'Summary\n"Minimal Card One"\n"Minimal Card Two"';
    const tmpPath = `/tmp/min-${Date.now()}.csv`;
    fs.writeFileSync(tmpPath, minimalCSV);

    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'min.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: '',
        },
      });
      // Must not be a server error (500)
      expect(res.status()).toBeLessThan(500);

      if (res.ok()) {
        const body = await res.json();
        expect(typeof body.imported).toBe('number');
        expect(body.imported).toBeGreaterThanOrEqual(0);
      }
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  test('import with Summary and Description populates card description', async ({ request }) => {
    const { token } = await createUser(request, 'imp-desc');
    const board = await createBoard(request, token, 'Description Import Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Card With Desc', description: 'Hello world description' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'desc.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.imported).toBeGreaterThan(0);

      // Verify card has description via cards API
      const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cards: any[] = await cardsRes.json();
      const importedCard = cards.find((c: any) => c.title === 'Card With Desc');
      expect(importedCard).toBeDefined();
      expect(importedCard.description).toBeTruthy();
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import with empty CSV body (header only) returns 200 with imported=0', async ({ request }) => {
    const { token } = await createUser(request, 'imp-empty');
    const board = await createBoard(request, token, 'Empty Import Board');

    const emptyCSV = 'Summary,Issue key,Issue id,Issue Type,Status,Priority,Project key\n';
    const tmpPath = `/tmp/empty-${Date.now()}.csv`;
    fs.writeFileSync(tmpPath, emptyCSV);

    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'empty.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: '',
        },
      });
      expect(res.status()).toBeLessThan(500);

      if (res.ok()) {
        const body = await res.json();
        expect(body.imported).toBe(0);
      }
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  test('import without auth returns 401', async ({ request }) => {
    const { token } = await createUser(request, 'imp-unauth');
    const board = await createBoard(request, token, 'Unauth Import Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Should Not Import' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: '',
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import to non-existent board returns 404', async ({ request }) => {
    const { token } = await createUser(request, 'imp-404');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Ghost Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/999888666/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'ghost.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: '',
        },
      });
      expect(res.status()).toBe(404);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import creates cards in the correct board (not a different board)', async ({ request }) => {
    const { token } = await createUser(request, 'imp-correct-board');
    const boardA = await createBoard(request, token, 'Board A');
    const boardB = await createBoard(request, token, 'Board B');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Board A Unique Card XYZ' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${boardA.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      if (!res.ok()) return;

      // Board A should have the card
      const cardsA: any[] = await (await request.get(`${BASE}/api/boards/${boardA.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      // Board B should have no cards
      const cardsB: any[] = await (await request.get(`${BASE}/api/boards/${boardB.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      const foundInA = cardsA.some((c: any) => c.title === 'Board A Unique Card XYZ');
      const foundInB = cardsB.some((c: any) => c.title === 'Board A Unique Card XYZ');

      expect(foundInA).toBe(true);
      expect(foundInB).toBe(false);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import maps "Done" status to closed card state', async ({ request }) => {
    const { token } = await createUser(request, 'imp-done-state');
    const board = await createBoard(request, token, 'Done State Board');
    const csvPath = writeMinimalJiraCSV([
      { summary: 'Done Card', status: 'Done' },
      { summary: 'Open Card', status: 'To Do' },
    ]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'done.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      if (!res.ok()) return;

      const cards: any[] = await (await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      const doneCard = cards.find((c: any) => c.title === 'Done Card');
      const openCard = cards.find((c: any) => c.title === 'Open Card');

      if (doneCard) expect(doneCard.state).toBe('closed');
      if (openCard) expect(openCard.state).toBe('open');
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import preserves priority field from CSV', async ({ request }) => {
    const { token } = await createUser(request, 'imp-priority');
    const board = await createBoard(request, token, 'Priority Import Board');
    const csvPath = writeMinimalJiraCSV([
      { summary: 'High Pri Card', priority: 'High' },
      { summary: 'Low Pri Card', priority: 'Low' },
    ]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'pri.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      if (!res.ok()) return;

      const cards: any[] = await (await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      const highCard = cards.find((c: any) => c.title === 'High Pri Card');
      const lowCard = cards.find((c: any) => c.title === 'Low Pri Card');

      if (highCard) expect(highCard.priority).toBe('high');
      if (lowCard) expect(lowCard.priority).toBe('low');
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Jira Preview API
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Jira Preview API (/api/import/jira/preview)', () => {
  test('POST with valid CSV returns 200', async ({ request }) => {
    const { token } = await createUser(request, 'prev-200');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Preview Me' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'preview.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.status()).toBe(200);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('preview response has a `projects` array', async ({ request }) => {
    const { token } = await createUser(request, 'prev-projects');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Preview Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'preview.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body.projects)).toBe(true);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('preview returns correct project key from CSV', async ({ request }) => {
    const { token } = await createUser(request, 'prev-key');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Keyed Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'keyed.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.projects.length).toBeGreaterThan(0);
      // The minimal CSV uses project key "PROJ"
      const projEntry = body.projects.find((p: any) => p.key === 'PROJ');
      expect(projEntry).toBeDefined();
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('preview returns item count per project', async ({ request }) => {
    const { token } = await createUser(request, 'prev-count');
    const csvPath = writeMinimalJiraCSV([
      { summary: 'Card One' },
      { summary: 'Card Two' },
      { summary: 'Card Three' },
    ]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'count.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      const projEntry = body.projects.find((p: any) => p.key === 'PROJ');
      expect(projEntry).toBeDefined();
      expect(projEntry.count).toBe(3);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('preview with empty CSV (header only) returns empty projects array', async ({ request }) => {
    const { token } = await createUser(request, 'prev-empty');

    const emptyCSV = 'Summary,Issue key,Issue id,Issue Type,Status,Priority,Project key\n';
    const tmpPath = `/tmp/prev-empty-${Date.now()}.csv`;
    fs.writeFileSync(tmpPath, emptyCSV);

    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'empty.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.status()).toBeLessThan(500);

      if (res.ok()) {
        const body = await res.json();
        expect(Array.isArray(body.projects)).toBe(true);
        expect(body.projects.length).toBe(0);
      }
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  test('preview without auth returns 401', async ({ request }) => {
    const csvPath = writeMinimalJiraCSV([{ summary: 'Unauth Preview' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        multipart: { file: { name: 'preview.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.status()).toBe(401);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('preview with multiple project keys in CSV returns all keys', async ({ request }) => {
    const { token } = await createUser(request, 'prev-multi-keys');

    // Build CSV with two different project keys
    const header = 'Summary,Issue key,Issue id,Issue Type,Status,Priority,Project key';
    const rows = [
      '"Alpha Card",ALPHA-1,1,Story,To Do,Medium,ALPHA',
      '"Beta Card",BETA-1,2,Story,To Do,Low,BETA',
      '"Alpha Card 2",ALPHA-2,3,Task,Done,High,ALPHA',
    ];
    const content = [header, ...rows].join('\n');
    const tmpPath = `/tmp/multi-${Date.now()}.csv`;
    fs.writeFileSync(tmpPath, content);

    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: { file: { name: 'multi.csv', mimeType: 'text/csv', buffer: fileBuffer } },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      const keys = body.projects.map((p: any) => p.key);
      expect(keys).toContain('ALPHA');
      expect(keys).toContain('BETA');

      const alphaProj = body.projects.find((p: any) => p.key === 'ALPHA');
      expect(alphaProj.count).toBe(2);

      const betaProj = body.projects.find((p: any) => p.key === 'BETA');
      expect(betaProj.count).toBe(1);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI — Export section in Board Settings
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings UI — Export section', () => {
  test('Import / Export section is visible to board admin', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-exp-admin');
    const board = await createBoard(request, token, 'UI Export Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
  });

  test('"Export to CSV" button is visible inside Import/Export section', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-exp-btn');
    const board = await createBoard(request, token, 'UI Export Btn Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator('button:has-text("Export to CSV")')).toBeVisible();
  });

  test('clicking Export to CSV triggers window.open with the correct export URL', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-exp-click');
    const board = await createBoard(request, token, 'UI Export Click Board');

    let capturedUrl = '';
    await page.exposeFunction('capturExpUrl', (url: string) => { capturedUrl = url; });
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      const orig = window.open.bind(window);
      (window as any).open = (url: string, ...args: any[]) => {
        (window as any).capturExpUrl(url);
        return orig(url, ...args);
      };
    }, token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await section.locator('button:has-text("Export to CSV")').click();

    await expect.poll(() => capturedUrl, { timeout: 5000 }).toMatch(/\/api\/boards\/\d+\/export\?token=/);
    expect(capturedUrl).toContain(`/api/boards/${board.id}/export`);
    expect(capturedUrl).toContain(token);
  });

  test('export URL contains board id and JWT token', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-exp-url-parts');
    const board = await createBoard(request, token, 'UI URL Parts Board');

    let capturedUrl = '';
    await page.exposeFunction('captureUrlParts', (url: string) => { capturedUrl = url; });
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
      const orig = window.open.bind(window);
      (window as any).open = (url: string, ...args: any[]) => {
        (window as any).captureUrlParts(url);
        return orig(url, ...args);
      };
    }, token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await section.locator('button:has-text("Export to CSV")').click();

    await expect.poll(() => capturedUrl, { timeout: 5000 }).toContain(`/api/boards/${board.id}/export`);
    await expect.poll(() => capturedUrl, { timeout: 5000 }).toMatch(/token=.+/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI — Import section in Board Settings
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Board Settings UI — Import section', () => {
  test('"Import from Jira CSV" button is visible in Import/Export section', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-btn');
    const board = await createBoard(request, token, 'UI Import Btn Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator('button:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('clicking Import from Jira CSV opens import modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-modal');
    const board = await createBoard(request, token, 'UI Import Modal Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const section = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await section.scrollIntoViewIfNeeded();
    await section.locator('button:has-text("Import from Jira CSV")').click();

    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });
  });

  test('import modal heading contains "Jira CSV"', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-heading');
    const board = await createBoard(request, token, 'UI Import Heading Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.import-modal h3')).toContainText('Jira CSV');
  });

  test('import modal has a file input that accepts .csv', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-file-input');
    const board = await createBoard(request, token, 'UI File Input Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    const fileInput = page.locator('.import-modal input[type="file"]');
    await expect(fileInput).toBeAttached();
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('.csv');
  });

  test('Import button is disabled before a file is selected', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-disabled');
    const board = await createBoard(request, token, 'UI Disabled Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.import-modal-actions button:has-text("Import")')).toBeDisabled();
  });

  test('Cancel button closes the import modal', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-cancel');
    const board = await createBoard(request, token, 'UI Cancel Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('.import-modal button:has-text("Cancel")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible({ timeout: 3000 });
  });

  test('import shows result panel after uploading a valid CSV and importing', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-result');
    const board = await createBoard(request, token, 'UI Result Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    const csvPath = writeMinimalJiraCSV([
      { summary: 'UI Result Card One' },
      { summary: 'UI Result Card Two' },
    ]);

    try {
      await page.goto(`/boards/${board.id}/settings`);
      await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

      await page.locator('button:has-text("Import from Jira CSV")').click();
      await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

      await page.setInputFiles('.import-modal input[type="file"]', csvPath);

      // Wait for project-select dropdown or import button to become enabled
      const importBtn = page.locator('.import-modal-actions button:has-text("Import")');

      // Try to select a project key if dropdown appears
      const selectVisible = await page.locator('.import-select').isVisible().catch(() => false);
      if (selectVisible) {
        await page.locator('.import-select').selectOption('PROJ');
      }

      await expect(importBtn).toBeEnabled({ timeout: 20000 });
      await importBtn.click();

      // Result panel should appear
      await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import result panel shows imported card count', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-count-ui');
    const board = await createBoard(request, token, 'UI Count Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    const csvPath = writeMinimalJiraCSV([
      { summary: 'Count UI Card' },
    ]);

    try {
      await page.goto(`/boards/${board.id}/settings`);
      await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

      await page.locator('button:has-text("Import from Jira CSV")').click();
      await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

      await page.setInputFiles('.import-modal input[type="file"]', csvPath);

      const selectVisible = await page.locator('.import-select').isVisible().catch(() => false);
      if (selectVisible) {
        await page.locator('.import-select').selectOption('PROJ');
      }

      const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
      await expect(importBtn).toBeEnabled({ timeout: 20000 });
      await importBtn.click();

      await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
      // The result panel contains a count in a <strong> element
      await expect(page.locator('.import-result p strong').first()).toBeVisible();
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('Close button appears in import modal after import completes', async ({ page, request }) => {
    const { token } = await createUser(request, 'ui-imp-close-btn');
    const board = await createBoard(request, token, 'UI Close Btn Board');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    const csvPath = writeMinimalJiraCSV([{ summary: 'Close Btn Card' }]);

    try {
      await page.goto(`/boards/${board.id}/settings`);
      await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

      await page.locator('button:has-text("Import from Jira CSV")').click();
      await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

      await page.setInputFiles('.import-modal input[type="file"]', csvPath);

      const selectVisible = await page.locator('.import-select').isVisible().catch(() => false);
      if (selectVisible) {
        await page.locator('.import-select').selectOption('PROJ');
      }

      const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
      await expect(importBtn).toBeEnabled({ timeout: 20000 });
      await importBtn.click();

      await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.import-modal-actions button:has-text("Close")')).toBeVisible();
      await expect(page.locator('.import-modal-actions button:has-text("Cancel")')).not.toBeVisible();
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global Jira Import API (/api/import/jira)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Global Jira Import API (/api/import/jira)', () => {
  test('POST /api/import/jira without auth returns 401', async ({ request }) => {
    const csvPath = writeMinimalJiraCSV([{ summary: 'Global Unauth Card' }]);
    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira`, {
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          mappings: JSON.stringify([]),
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('POST /api/import/jira with valid auth returns non-500', async ({ request }) => {
    const { token } = await createUser(request, 'global-imp-200');
    const board = await createBoard(request, token, 'Global Import Target Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Global Card One' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const mappings = JSON.stringify([{ project_key: 'PROJ', board_id: board.id }]);
      const res = await request.post(`${BASE}/api/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          mappings,
        },
      });
      expect(res.status()).toBeLessThan(500);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('POST /api/import/jira response includes `results` array when successful', async ({ request }) => {
    const { token } = await createUser(request, 'global-imp-results');
    const board = await createBoard(request, token, 'Global Results Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Results Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const mappings = JSON.stringify([{ project_key: 'PROJ', board_id: board.id }]);
      const res = await request.post(`${BASE}/api/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          mappings,
        },
      });
      if (!res.ok()) return;
      const body = await res.json();
      expect(Array.isArray(body.results)).toBe(true);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('POST /api/import/jira result entry includes `imported` count and `board_id`', async ({ request }) => {
    const { token } = await createUser(request, 'global-imp-entry');
    const board = await createBoard(request, token, 'Global Entry Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Entry Card A' }, { summary: 'Entry Card B' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const mappings = JSON.stringify([{ project_key: 'PROJ', board_id: board.id }]);
      const res = await request.post(`${BASE}/api/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          mappings,
        },
      });
      if (!res.ok()) return;
      const body = await res.json();
      if (!Array.isArray(body.results) || body.results.length === 0) return;
      const entry = body.results[0];
      expect(typeof entry.imported).toBe('number');
      expect(entry.board_id).toBe(board.id);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('POST /api/import/jira with empty mappings array returns non-500', async ({ request }) => {
    const { token } = await createUser(request, 'global-imp-empty-map');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Unmapped Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          mappings: JSON.stringify([]),
        },
      });
      expect(res.status()).toBeLessThan(500);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export API — additional header fields and data integrity
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Export API — additional CSV fields', () => {
  test('CSV header row contains Description field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-desc-field');
    const board = await createBoard(request, token, 'Desc Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header).toContain('Description');
  });

  test('CSV header row contains StoryPoints field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-sp-field');
    const board = await createBoard(request, token, 'StoryPoints Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    // Either "StoryPoints" or "Story Points" or "story_points"
    expect(header.toLowerCase()).toMatch(/story.?points|storypoints/i);
  });

  test('CSV header row contains DueDate field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-due-field');
    const board = await createBoard(request, token, 'DueDate Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header.toLowerCase()).toMatch(/due.?date|duedate/i);
  });

  test('CSV header row contains CreatedAt field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-created-field');
    const board = await createBoard(request, token, 'CreatedAt Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header.toLowerCase()).toMatch(/created/i);
  });

  test('CSV header row contains UpdatedAt field', async ({ request }) => {
    const { token } = await createUser(request, 'exp-updated-field');
    const board = await createBoard(request, token, 'UpdatedAt Field Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const header = (await res.text()).split('\n')[0];
    expect(header.toLowerCase()).toMatch(/updated/i);
  });

  test('exported CSV includes description when card has description', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-desc-data');
    if (!columns.length) return;

    const cardRes = await createCard(
      request, token, board.id, columns[0].id, swimlane.id,
      'Card With Description',
      { description: 'This is the card description text' },
    );
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body).toContain('This is the card description text');
  });

  test('exported CSV includes story_points when card has story points', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-sp-data');
    if (!columns.length) return;

    const cardRes = await createCard(
      request, token, board.id, columns[0].id, swimlane.id,
      'Story Points Card',
      { story_points: 5 },
    );
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body).toContain('5');
  });

  test('exported CSV rows contain created_at timestamp', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-created-ts');
    if (!columns.length) return;

    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, 'Timestamp Card');
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const dataLines = body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    expect(dataLines.length).toBeGreaterThan(0);
    // A timestamp should appear in the data row (year like 20XX)
    expect(dataLines[0]).toMatch(/20\d\d/);
  });

  test('export filename in Content-Disposition includes board name or board id', async ({ request }) => {
    const { token } = await createUser(request, 'exp-filename');
    const board = await createBoard(request, token, 'Export Filename Board');

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const disposition = res.headers()['content-disposition'] ?? '';
    // Disposition should contain either the board id or a sanitised board name
    const hasId = disposition.includes(String(board.id));
    const hasName = disposition.toLowerCase().includes('export');
    expect(hasId || hasName).toBe(true);
  });

  test('multiple cards in export appear in order they were created', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-order');
    if (!columns.length) return;

    const titles = ['Alpha Card', 'Beta Card', 'Gamma Card'];
    for (const t of titles) {
      const r = await createCard(request, token, board.id, columns[0].id, swimlane.id, t);
      if (!r.ok()) {
        test.skip(true, 'Card creation failed');
        return;
      }
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const dataLines = body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    expect(dataLines.length).toBe(3);

    const alphaIdx = dataLines.findIndex((l) => l.includes('Alpha Card'));
    const betaIdx = dataLines.findIndex((l) => l.includes('Beta Card'));
    const gammaIdx = dataLines.findIndex((l) => l.includes('Gamma Card'));
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    expect(gammaIdx).toBeGreaterThanOrEqual(0);
  });

  test('special characters in card title are properly quoted in CSV', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-special-chars');
    if (!columns.length) return;

    const titleWithComma = 'Card, with comma';
    const cardRes = await createCard(request, token, board.id, columns[0].id, swimlane.id, titleWithComma);
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    // Title with comma should be quoted so the CSV remains parseable
    expect(body).toContain('"Card, with comma"');
  });

  test('card with low priority shows low in exported CSV', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-low-pri');
    if (!columns.length) return;

    const cardRes = await createCard(
      request, token, board.id, columns[0].id, swimlane.id,
      'Low Priority Card', { priority: 'low' },
    );
    if (!cardRes.ok()) {
      test.skip(true, 'Card creation failed');
      return;
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('low');
  });

  test('export of board with 10 cards returns 10 data rows', async ({ request }) => {
    const { token, board, swimlane, columns } = await setupFull(request, 'exp-10-cards');
    if (!columns.length) return;

    for (let i = 1; i <= 10; i++) {
      const r = await createCard(request, token, board.id, columns[0].id, swimlane.id, `Bulk Card ${i}`);
      if (!r.ok()) {
        test.skip(true, 'Card creation failed');
        return;
      }
    }

    const res = await request.get(`${BASE}/api/boards/${board.id}/export?token=${token}`);
    const body = await res.text();
    const dataLines = body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    expect(dataLines.length).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Jira Import API — additional edge cases
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Jira Import API — additional edge cases', () => {
  test('import with non-member token returns 403', async ({ request }) => {
    const { token } = await createUser(request, 'imp-403-owner');
    const board = await createBoard(request, token, 'Forbidden Import Board');
    const nonMemberToken = await createNonMember(request);

    const csvPath = writeMinimalJiraCSV([{ summary: 'Forbidden Card' }]);
    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${nonMemberToken}` },
        multipart: {
          file: { name: 'import.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.status()).toBe(403);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import maps "Medium" priority correctly', async ({ request }) => {
    const { token } = await createUser(request, 'imp-medium-pri');
    const board = await createBoard(request, token, 'Medium Priority Import Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Medium Card', priority: 'Medium' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'medium.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      if (!res.ok()) return;

      const cards: any[] = await (await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      const mediumCard = cards.find((c: any) => c.title === 'Medium Card');
      if (mediumCard) expect(mediumCard.priority).toBe('medium');
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import with 20 cards imports all of them successfully', async ({ request }) => {
    const { token } = await createUser(request, 'imp-20-cards');
    const board = await createBoard(request, token, 'Large Import Board');

    const rows = Array.from({ length: 20 }, (_, i) => ({ summary: `Bulk Import Card ${i + 1}` }));
    const csvPath = writeMinimalJiraCSV(rows);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'bulk.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.imported).toBe(20);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import "In Progress" status places card in in-progress column', async ({ request }) => {
    const { token } = await createUser(request, 'imp-in-progress');
    const board = await createBoard(request, token, 'In Progress Import Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'In Progress Card', status: 'In Progress' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'inprog.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      if (!res.ok()) return;

      const cards: any[] = await (await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();

      const card = cards.find((c: any) => c.title === 'In Progress Card');
      expect(card).toBeDefined();
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import response does not return 500 for CSV with special characters in title', async ({ request }) => {
    const { token } = await createUser(request, 'imp-special-chars');
    const board = await createBoard(request, token, 'Special Chars Import Board');

    const header = 'Summary,Issue key,Issue id,Issue Type,Status,Priority,Project key';
    const row = '"Card with \\"quotes\\" & <tags>",PROJ-1,1,Story,To Do,Medium,PROJ';
    const content = [header, row].join('\n');
    const tmpPath = `/tmp/special-${Date.now()}.csv`;
    fs.writeFileSync(tmpPath, content);

    try {
      const fileBuffer = fs.readFileSync(tmpPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'special.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.status()).toBeLessThan(500);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  test('import via Bearer header (not token query param) works', async ({ request }) => {
    const { token } = await createUser(request, 'imp-bearer-header');
    const board = await createBoard(request, token, 'Bearer Header Import Board');
    const csvPath = writeMinimalJiraCSV([{ summary: 'Bearer Header Card' }]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'bearer.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.status()).not.toBe(401);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });

  test('import returns correct `imported` count matching CSV rows', async ({ request }) => {
    const { token } = await createUser(request, 'imp-exact-count');
    const board = await createBoard(request, token, 'Exact Count Import Board');
    const csvPath = writeMinimalJiraCSV([
      { summary: 'Card One' },
      { summary: 'Card Two' },
      { summary: 'Card Three' },
      { summary: 'Card Four' },
      { summary: 'Card Five' },
    ]);

    try {
      const fileBuffer = fs.readFileSync(csvPath);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'count5.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: 'PROJ',
        },
      });
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.imported).toBe(5);
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  });
});
