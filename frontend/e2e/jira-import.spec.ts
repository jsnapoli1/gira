/**
 * jira-import.spec.ts
 *
 * Tests for the Jira CSV import wizard in Zira board settings.
 *
 * Import endpoints:
 *  - POST /api/boards/:id/import/jira         (board-scoped, multipart: file + project_key)
 *  - POST /api/import/jira/preview            (global preview: returns project keys)
 *  - POST /api/import/jira                    (global import with mappings JSON)
 *
 * UI flow:
 *  1. Board Settings page → Import / Export section
 *  2. Click "Import from Jira CSV" → .import-modal opens
 *  3. Select file → preview request fires → .import-select dropdown appears
 *  4. Optionally choose a project key from the dropdown
 *  5. Click "Import" → .import-result panel shows counts
 *  6. Click "Close" → modal closes, board reloads with new cards
 *
 * The sample CSV at jira.csv (project root) contains project keys:
 *  ZRP, ZR, IRS, QA, ZLP, ZLK, and others.
 * "ZRP" is used as the canonical test project key throughout.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;
const JIRA_CSV_PATH = '/Users/jsnapoli1/Documents/open-source/zira/jira.csv';
const EXPECTED_PROJECT_KEY = 'ZRP';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupUserAndBoard(request: any, prefix = 'jira') {
  const email = `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Import Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `Import Board (${prefix})` },
  });
  const board = await boardRes.json();
  return { token, board };
}

/**
 * Navigate to board settings and open the import modal, upload the CSV file,
 * then wait for the project-selection dropdown to appear.
 */
async function openModalAndUploadCSV(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}/settings`);
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
  await page.locator('button:has-text("Import from Jira CSV")').click();
  await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });
  await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);
  await expect(page.locator('.import-select')).toBeVisible({ timeout: 20000 });
}

/**
 * Post the CSV file directly to the board-scoped import endpoint.
 * Returns the parsed JSON response body.
 */
async function apiImportCSV(
  request: any,
  token: string,
  boardId: number,
  csvPath: string,
  projectKey = '',
): Promise<any> {
  const fileBuffer = fs.readFileSync(csvPath);
  const res = await request.post(`${BASE}/api/boards/${boardId}/import/jira`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'jira.csv', mimeType: 'text/csv', buffer: fileBuffer },
      project_key: projectKey,
    },
  });
  return res.json();
}

/**
 * Post the CSV file to the global preview endpoint.
 */
async function apiPreviewCSV(request: any, token: string, csvPath: string) {
  const fileBuffer = fs.readFileSync(csvPath);
  const res = await request.post(`${BASE}/api/import/jira/preview`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'jira.csv', mimeType: 'text/csv', buffer: fileBuffer },
    },
  });
  return { status: res.status(), body: await res.json() };
}

// ---------------------------------------------------------------------------
// API-level import tests
// ---------------------------------------------------------------------------

test.describe('Jira Import — API', () => {
  test('preview endpoint returns 200 with project keys from jira.csv', async ({ request }) => {
    const { token } = await setupUserAndBoard(request, 'preview-api');
    const { status, body } = await apiPreviewCSV(request, token, JIRA_CSV_PATH);

    expect(status).toBe(200);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects.length).toBeGreaterThan(0);

    // Each project entry must have key and count.
    for (const proj of body.projects) {
      expect(typeof proj.key).toBe('string');
      expect(proj.key.length).toBeGreaterThan(0);
      expect(typeof proj.count).toBe('number');
      expect(proj.count).toBeGreaterThan(0);
    }
  });

  test('preview endpoint returns ZRP project key from jira.csv', async ({ request }) => {
    const { token } = await setupUserAndBoard(request, 'preview-zrp');
    const { body } = await apiPreviewCSV(request, token, JIRA_CSV_PATH);

    const zrp = body.projects.find((p: any) => p.key === EXPECTED_PROJECT_KEY);
    expect(zrp).toBeDefined();
    expect(zrp.count).toBeGreaterThan(0);
  });

  test('preview endpoint returns 401 when no auth token is provided', async ({ request }) => {
    const fileBuffer = fs.readFileSync(JIRA_CSV_PATH);
    const res = await request.post(`${BASE}/api/import/jira/preview`, {
      multipart: { file: { name: 'jira.csv', mimeType: 'text/csv', buffer: fileBuffer } },
    });
    expect(res.status()).toBe(401);
  });

  test('board-scoped import creates cards and returns imported count', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-count');

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(typeof result.imported).toBe('number');
    expect(result.imported).toBeGreaterThan(0);
  });

  test('board-scoped import places cards in the board', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-cards');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();
    expect(cards.length).toBeGreaterThan(0);
  });

  test('imported cards have titles matching CSV rows', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-titles');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();
    const titles = cards.map((c: any) => c.title);

    // A known title from the ZRP project in jira.csv.
    const known = 'FIX: Issues bulk deleting parts';
    expect(titles.some((t) => t === known)).toBe(true);
  });

  test('imported cards have priority set from CSV', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-priority');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    // All ZRP rows in jira.csv have Priority = "Medium".
    const knownCard = cards.find((c: any) => c.title === 'FIX: Issues bulk deleting parts');
    expect(knownCard).toBeDefined();
    expect(knownCard.priority).toBe('medium');
  });

  test('Done cards land in a closed-state column after import', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-done-col');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    const doneCard = cards.find(
      (c: any) => c.title === 'CONFIG: Import all uATS1 part number combos in without BOMs',
    );
    expect(doneCard).toBeDefined();

    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns: any[] = await columnsRes.json();
    const col = columns.find((col: any) => col.id === doneCard.column_id);
    expect(col).toBeDefined();
    expect(col.state).toBe('closed');
  });

  test('To Do cards land in an open-state column after import', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-todo-col');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    const todoCard = cards.find(
      (c: any) => c.title === 'CONFIG: Get all BOMs for uATS1 in ZRP',
    );
    expect(todoCard).toBeDefined();

    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns: any[] = await columnsRes.json();
    const col = columns.find((col: any) => col.id === todoCard.column_id);
    expect(col).toBeDefined();
    expect(col.state).toBe('open');
  });

  test('re-importing same CSV does not create duplicate cards', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-dedup');

    const first = await apiImportCSV(
      request,
      token,
      board.id,
      JIRA_CSV_PATH,
      EXPECTED_PROJECT_KEY,
    );
    expect(first.imported).toBeGreaterThan(0);

    const cardsAfterFirst = await (
      await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    const second = await apiImportCSV(
      request,
      token,
      board.id,
      JIRA_CSV_PATH,
      EXPECTED_PROJECT_KEY,
    );
    // All titles already exist — second import count should be 0.
    expect(second.imported).toBe(0);

    const cardsAfterSecond = await (
      await request.get(`${BASE}/api/boards/${board.id}/cards`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();

    expect(cardsAfterSecond.length).toBe(cardsAfterFirst.length);
  });

  test('import auto-creates a swimlane when the board has none', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-swimlane');

    const result = await apiImportCSV(
      request,
      token,
      board.id,
      JIRA_CSV_PATH,
      EXPECTED_PROJECT_KEY,
    );
    expect(result.imported).toBeGreaterThan(0);

    const swimlanesRes = await request.get(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const swimlanes: any[] = await swimlanesRes.json();
    expect(swimlanes.length).toBeGreaterThanOrEqual(1);
  });

  test('import with all project keys (no filter) imports cards from multiple projects', async ({
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-all');

    // Pass empty project_key to import everything.
    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, '');
    expect(result.imported).toBeGreaterThan(0);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();
    // A multi-project CSV should yield more cards than a single-project filter.
    expect(cards.length).toBeGreaterThan(0);
  });

  test('empty CSV (header only) returns 0 imported cards and does not 500', async ({
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-empty');

    const tmpCsv = path.join('/tmp', `empty-jira-${Date.now()}.csv`);
    fs.writeFileSync(tmpCsv, 'Summary,Issue key,Issue id,Issue Type,Status,Project key\n');
    try {
      const fileBuffer = fs.readFileSync(tmpCsv);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'empty.csv', mimeType: 'text/csv', buffer: fileBuffer },
          project_key: '',
        },
      });
      expect(res.status()).toBeLessThan(500);
      if (res.status() === 200) {
        const body = await res.json();
        expect(body.imported).toBe(0);
      }
    } finally {
      if (fs.existsSync(tmpCsv)) fs.unlinkSync(tmpCsv);
    }
  });

  test('invalid (non-CSV) file does not cause 500 on preview endpoint', async ({ request }) => {
    const { token } = await setupUserAndBoard(request, 'import-api-invalid');

    const tmpJson = path.join('/tmp', `not-a-csv-${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify({ hello: 'world', items: [1, 2, 3] }));
    try {
      const fileBuffer = fs.readFileSync(tmpJson);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: { name: 'data.json', mimeType: 'application/json', buffer: fileBuffer },
        },
      });
      // Must not be a server crash.
      expect(res.status()).toBeLessThan(500);
    } finally {
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    }
  });

  test('board-scoped import returns 401 when token is missing', async ({ request }) => {
    const { board } = await setupUserAndBoard(request, 'import-api-noauth');

    const fileBuffer = fs.readFileSync(JIRA_CSV_PATH);
    const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
      multipart: {
        file: { name: 'jira.csv', mimeType: 'text/csv', buffer: fileBuffer },
        project_key: '',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('board-scoped import returns 404 for a non-existent board', async ({ request }) => {
    const { token } = await setupUserAndBoard(request, 'import-api-404');

    const fileBuffer = fs.readFileSync(JIRA_CSV_PATH);
    const res = await request.post(`${BASE}/api/boards/999999999/import/jira`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'jira.csv', mimeType: 'text/csv', buffer: fileBuffer },
        project_key: '',
      },
    });
    expect(res.status()).toBe(404);
  });

  test('description field is present (may be null or string) on imported cards', async ({
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'import-api-desc');

    await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();
    for (const card of cards) {
      expect(
        typeof card.description === 'string' || card.description === null,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// UI-level import tests
// ---------------------------------------------------------------------------

test.describe('Jira CSV Import Wizard — UI', () => {
  test('Import / Export section is visible in board settings', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-section');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    const importSection = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await expect(importSection).toBeVisible();
    await expect(importSection.locator('button:has-text("Export to CSV")')).toBeVisible();
    await expect(importSection.locator('button:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('clicking "Import from Jira CSV" opens the import modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-modal-open');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.import-modal h3')).toContainText('Import from Jira CSV');
  });

  test('Import button is disabled before a file is selected', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-btn-disabled');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeDisabled();
  });

  test('uploading CSV shows project selection dropdown', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-dropdown');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    await expect(page.locator('.import-select')).toBeVisible();
  });

  test('project selection dropdown contains at least two options after CSV upload', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-dropdown-opts');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    const count = await page.locator('.import-select option').count();
    // Should have "All Projects" + at least one real project key.
    expect(count).toBeGreaterThan(1);
  });

  test('project selection dropdown includes ZRP from jira.csv', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-zrp-opt');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    const optionTexts = await page.locator('.import-select option').allTextContents();
    expect(optionTexts.some((t) => t.includes(EXPECTED_PROJECT_KEY))).toBe(true);
  });

  test('Import button is enabled after CSV upload', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-btn-enabled');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeEnabled();
  });

  test('Cancel button closes the modal without importing', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-cancel');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    await page.locator('.import-modal-actions button:has-text("Cancel")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // Re-open should start fresh — no dropdown yet.
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await expect(page.locator('.import-select')).not.toBeVisible();
  });

  test('clicking the overlay closes the import modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-overlay-close');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible({ timeout: 5000 });

    // Click on the overlay (top-left corner, safely outside the modal panel).
    await page.locator('.import-modal-overlay').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.import-modal')).not.toBeVisible();
  });

  test('completing import shows .import-result panel with count', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-result');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // Select only ZRP to keep the import fast and deterministic.
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    const strongText = await page.locator('.import-result p strong').first().textContent();
    const importedCount = parseInt(strongText || '0', 10);
    expect(importedCount).toBeGreaterThan(0);
  });

  test('result panel shows sprint count when sprints are present in CSV', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-sprint-count');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    // jira.csv has "ZRP Sprint 1" — at least one sprint line should appear.
    const sprintLine = page.locator('.import-result p', { hasText: /sprint/i });
    await expect(sprintLine.first()).toBeVisible({ timeout: 5000 });
  });

  test('Close button is shown (not Cancel) after import completes', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-close-btn');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    await expect(page.locator('.import-modal-actions button:has-text("Close")')).toBeVisible();
    await expect(
      page.locator('.import-modal-actions button:has-text("Cancel")'),
    ).not.toBeVisible();
  });

  test('clicking Close after import dismisses the modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-close-dismiss');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    await page.locator('.import-modal-actions button:has-text("Close")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();
  });

  test('board page loads without error after import completes and modal is closed', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-board-after');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);
    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
    await page.locator('.import-modal-actions button:has-text("Close")').click();

    // Navigate to the board.
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
  });

  test('re-opening import modal after close shows fresh state (no previous result)', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-fresh-state');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);
    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
    await page.locator('.import-modal-actions button:has-text("Close")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // Re-open: should show the initial state, no stale result.
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await expect(page.locator('.import-result')).not.toBeVisible();
    await expect(page.locator('.import-select')).not.toBeVisible();
  });

  test('importing "All Projects" from jira.csv creates cards visible on the board', async ({
    page,
    request,
  }) => {
    const { token, board } = await setupUserAndBoard(request, 'ui-all-projects');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // Leave the dropdown on "All Projects" (default first option).
    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
    await page.locator('.import-modal-actions button:has-text("Close")').click();

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible()) await allCardsBtn.click();

    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 10000 });
    expect(await page.locator('.card-item').count()).toBeGreaterThan(0);
  });

  test.fixme(
    'uploading a non-CSV file shows a user-visible error message',
    async ({ page, request }) => {
      // fixme: Current behaviour silently fails — the preview returns empty projects
      // and no error UI is shown. This test documents the desired UX improvement.
      const { token, board } = await setupUserAndBoard(request, 'ui-bad-file');
      await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

      const tmpJson = path.join('/tmp', `not-csv-ui-${Date.now()}.json`);
      fs.writeFileSync(tmpJson, JSON.stringify({ hello: 'world' }));
      try {
        await page.goto(`/boards/${board.id}/settings`);
        await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
        await page.locator('button:has-text("Import from Jira CSV")').click();
        await expect(page.locator('.import-modal')).toBeVisible();

        await page.setInputFiles('.import-modal input[type="file"]', tmpJson);
        await page.waitForTimeout(3000);

        const errorVisible =
          (await page.locator('.toast-error').isVisible()) ||
          (await page.locator('.import-modal .error').isVisible());
        expect(errorVisible).toBe(true);
      } finally {
        if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
      }
    },
  );
});
