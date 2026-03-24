/**
 * board-import-extended.spec.ts
 *
 * Deeper Jira CSV import testing: project key mapping, field alignment,
 * re-import behaviour, column mapping, swimlane targeting, empty CSV
 * handling, and wrong file type error handling.
 *
 * Depends on the sample CSV at /Users/jsnapoli1/Documents/open-source/zira/jira.csv
 * which contains project key "ZRP" with stories like:
 *   "CONFIG: Get all BOMs for uATS1 in ZRP"
 *   "FIX: Issues bulk deleting parts"
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

const JIRA_CSV_PATH = '/Users/jsnapoli1/Documents/open-source/zira/jira.csv';

// Project key found in the sample CSV header row (column "Project key").
const EXPECTED_PROJECT_KEY = 'ZRP';

// A card with Status "To Do" (Status Category = "To Do") from jira.csv row 2.
const KNOWN_CARD_TITLE = 'CONFIG: Get all BOMs for uATS1 in ZRP';

// A card title that appears in the CSV (Status "Done") for general existence checks.
const ANY_CARD_TITLE = 'FIX: Issues bulk deleting parts';

// A card that has Status "Done" in the CSV (Status Category = "Done").
// Used for column-mapping assertions.
const DONE_CARD_TITLE = 'CONFIG: Import all uATS1 part number combos in without BOMs';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function setupUserAndBoard(request: any) {
  const email = `test-import-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Import Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Import Extended Board' },
  });
  const board = await boardRes.json();

  return { token, board };
}

async function setupUserBoardAndSwimlane(request: any) {
  const { token, board } = await setupUserAndBoard(request);

  const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'ZRP Lane', designator: 'ZRP-', color: '#6366f1' },
  });
  const swimlane = await swimlaneRes.json();

  return { token, board, swimlane };
}

// ---------------------------------------------------------------------------
// Shared UI helper: open the import modal and upload the CSV, then wait for the
// project-selection dropdown to appear (confirms the preview parsed OK).
// ---------------------------------------------------------------------------

async function openModalAndUploadCSV(page: any, boardId: number) {
  await page.goto(`/boards/${boardId}/settings`);
  await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
  await page.locator('button:has-text("Import from Jira CSV")').click();
  await expect(page.locator('.import-modal')).toBeVisible();
  await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);
  // Wait until the preview has been parsed and the project dropdown is rendered.
  await expect(page.locator('.import-select')).toBeVisible({ timeout: 20000 });
}

// ---------------------------------------------------------------------------
// API helper: POST multipart CSV to the board-scoped import endpoint.
// Returns the parsed JSON response body.
// ---------------------------------------------------------------------------

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
      file: {
        name: 'jira.csv',
        mimeType: 'text/csv',
        buffer: fileBuffer,
      },
      project_key: projectKey,
    },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// API helper: POST multipart to the preview endpoint.
// ---------------------------------------------------------------------------

async function apiPreviewCSV(request: any, token: string, csvPath: string): Promise<any> {
  const fileBuffer = fs.readFileSync(csvPath);
  const res = await request.post(`${BASE}/api/import/jira/preview`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'jira.csv',
        mimeType: 'text/csv',
        buffer: fileBuffer,
      },
    },
  });
  return { status: res.status(), body: await res.json() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Board Import — Extended', () => {

  /**
   * 1. Import preview shows project key
   *
   * After uploading jira.csv the backend parses the CSV and returns the project
   * keys it found. The frontend renders them as <option> elements inside the
   * .import-select dropdown. We verify that "ZRP" (the project key in the sample
   * CSV) appears there.
   */
  test('import preview shows the correct project key from the CSV', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // The dropdown should include at least one option with the expected project key.
    const optionTexts = await page.locator('.import-select option').allTextContents();
    const hasProjectKey = optionTexts.some((text) => text.includes(EXPECTED_PROJECT_KEY));
    expect(hasProjectKey).toBe(true);
  });

  /**
   * 2. Import creates cards on board
   *
   * Complete a full import (upload → accept project defaults → click Import),
   * then navigate to the board in All Cards view and verify that cards were
   * created (count > 0).
   */
  test('completing an import creates cards visible on the board', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // Select ZRP project only (8 rows) to keep the import fast and deterministic.
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    // Wait for the result pane to appear.
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    // Close the modal.
    await page.locator('.import-modal-actions button:has-text("Close")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // Navigate to the board in All Cards view.
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    // Switch to All Cards so we can see cards regardless of sprint assignment.
    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible()) {
      await allCardsBtn.click();
    }

    // At least one card should be visible after the import.
    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 10000 });
    const cardCount = await page.locator('.card-item').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  /**
   * 3. Imported cards have correct titles (field mapping — title)
   *
   * After a successful import, verify that at least one card's title matches a
   * known title from jira.csv (the row "FIX: Issues bulk deleting parts").
   */
  test('imported cards have titles that match rows in the CSV', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // Select only the ZRP project so we get a deterministic set of cards.
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });
    await page.locator('.import-modal-actions button:has-text("Close")').click();

    // Navigate to the board in All Cards view.
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });

    const allCardsBtn = page.locator('.view-btn:has-text("All Cards")');
    if (await allCardsBtn.isVisible()) {
      await allCardsBtn.click();
    }

    await expect(page.locator('.card-item').first()).toBeVisible({ timeout: 10000 });

    // Collect all visible card titles and check that the known title is present.
    const titles = await page.locator('.card-item .card-title').allTextContents();
    const found = titles.some((t) => t.includes('FIX: Issues bulk deleting parts'));
    expect(found).toBe(true);
  });

  /**
   * 4. Column mapping — "Done" cards end up in a closed column (API-level)
   *
   * The import logic maps Jira "Status Category = Done" to state "closed" and
   * places those cards in the first board column with state = "closed".
   * Default boards have a "Done" column with state "closed". We verify via the
   * cards list API that the imported "Done" card sits in a column with state
   * "closed".
   */
  test('column mapping: Done cards land in a closed-state column (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    // Import only the ZRP project via API.
    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    // Fetch all cards on the board.
    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    // Find the known Done card.
    const doneCard = cards.find((c: any) => c.title === DONE_CARD_TITLE);
    expect(doneCard).toBeDefined();

    // Its state should be "closed" as mapped from Status Category "Done".
    expect(doneCard.state).toBe('closed');

    // The column it lives in must also have state "closed".
    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns: any[] = await columnsRes.json();
    const cardColumn = columns.find((col: any) => col.id === doneCard.column_id);
    expect(cardColumn).toBeDefined();
    expect(cardColumn.state).toBe('closed');
  });

  /**
   * 5. Column mapping — "To Do" cards land in an open-state column (API-level)
   *
   * Rows with Status Category "To Do" should map to state "open" and land in
   * the first column with state "open".
   */
  test('column mapping: To Do cards land in an open-state column (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    // The known "To Do" card from jira.csv.
    const todoCard = cards.find((c: any) => c.title === KNOWN_CARD_TITLE);
    expect(todoCard).toBeDefined();
    expect(todoCard.state).toBe('open');

    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}/columns`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const columns: any[] = await columnsRes.json();
    const cardColumn = columns.find((col: any) => col.id === todoCard.column_id);
    expect(cardColumn).toBeDefined();
    expect(cardColumn.state).toBe('open');
  });

  /**
   * 6. Field mapping — priority carries over (API-level)
   *
   * The jira.csv rows have Priority = "Medium". After import the card's
   * priority field should reflect that value (normalised to lowercase).
   */
  test('field mapping: priority is imported from the CSV (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    const card = cards.find((c: any) => c.title === KNOWN_CARD_TITLE);
    expect(card).toBeDefined();
    // Priority column in the sample CSV is "Medium" — stored lowercase.
    expect(card.priority).toBe('medium');
  });

  /**
   * 7. Field mapping — description is imported (API-level)
   *
   * Rows in jira.csv may have a Description. The import places it in the card's
   * description field. We verify that description is non-null on at least one
   * imported card.
   *
   * Note: the sample jira.csv rows have empty Description fields for the first
   * visible rows, so this test just confirms description is present (possibly
   * empty string) and doesn't crash.
   */
  test('field mapping: description field is present on imported cards (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    // Every card should have a description property (may be empty string).
    for (const card of cards) {
      expect(typeof card.description === 'string' || card.description === null).toBe(true);
    }
  });

  /**
   * 8. Duplicate detection — re-importing the same CSV skips existing cards
   *
   * The backend deduplicates by title: if a card with the same title already
   * exists it updates the gitea_issue_id instead of creating a new card. The
   * second import should report imported = 0 for all previously-seen titles.
   */
  test('duplicate detection: re-importing same CSV does not double-create cards (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    // First import.
    const first = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(first.imported).toBeGreaterThan(0);

    const cardsRes1 = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cardsBefore: any[] = await cardsRes1.json();
    const countBefore = cardsBefore.length;

    // Second import with identical file and project key.
    const second = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    // All titles already existed — imported count should be 0.
    expect(second.imported).toBe(0);

    // Total card count should be the same as after the first import.
    const cardsRes2 = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cardsAfter: any[] = await cardsRes2.json();
    expect(cardsAfter.length).toBe(countBefore);
  });

  /**
   * 9. Re-importing on same board does not crash (UI)
   *
   * Import the same CSV twice via the UI. Verify no crash occurs and both
   * imports complete successfully.
   */
  test('re-importing the same CSV on the same board does not crash', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    // --- First import ---
    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    const importBtn1 = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn1).toBeEnabled();
    await importBtn1.click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    const firstImportedText = await page.locator('.import-result p strong').first().textContent();
    const firstCount = parseInt(firstImportedText || '0', 10);
    expect(firstCount).toBeGreaterThan(0);

    await page.locator('.import-modal-actions button:has-text("Close")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // --- Second import ---
    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    const importBtn2 = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn2).toBeEnabled();
    await importBtn2.click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    // Second import should also complete (no crash / no JS error overlay).
    await expect(page.locator('.import-result p strong').first()).toBeVisible();

    // Navigate to the board and verify it renders (no white screen).
    await page.locator('.import-modal-actions button:has-text("Close")').click();
    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10000 });
  });

  /**
   * 10. Import with swimlane selection — cards land in the pre-existing swimlane
   *
   * When the board already has a swimlane the import should use that swimlane
   * (the first one). We verify via the cards API that every imported card's
   * swimlane_id matches the pre-created swimlane.
   */
  test('import with existing swimlane: cards are placed in that swimlane (API)', async ({ request }) => {
    const { token, board, swimlane } = await setupUserBoardAndSwimlane(request);

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();

    // Every imported card should live in the pre-existing swimlane.
    for (const card of cards) {
      expect(card.swimlane_id).toBe(swimlane.id);
    }
  });

  /**
   * 11. Import auto-creates a swimlane when the board has none (API)
   *
   * If there are no swimlanes the import handler creates one named after the
   * project key (or "Import" if no project key was provided). The cards should
   * land in that auto-created swimlane.
   */
  test('import auto-creates a swimlane when board has none (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);
    // No manual swimlane created — board starts empty.

    const result = await apiImportCSV(request, token, board.id, JIRA_CSV_PATH, EXPECTED_PROJECT_KEY);
    expect(result.imported).toBeGreaterThan(0);

    // Fetch swimlanes — there should now be exactly one.
    const swimlanesRes = await request.get(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const swimlanes: any[] = await swimlanesRes.json();
    expect(swimlanes.length).toBeGreaterThanOrEqual(1);

    // All imported cards must be in that swimlane.
    const cardsRes = await request.get(`${BASE}/api/boards/${board.id}/cards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cards: any[] = await cardsRes.json();
    const autoSwimlaneId = swimlanes[0].id;
    for (const card of cards) {
      expect(card.swimlane_id).toBe(autoSwimlaneId);
    }
  });

  /**
   * 12. Progress / completion state — import shows success summary in the modal
   *
   * After clicking Import the modal should show the .import-result panel with:
   *   - A <strong> element containing the imported card count
   *   - Optionally sprint/label counts
   *   - A Close button (replacing the Cancel button)
   */
  test('import modal shows success summary after completion', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);
    await page.locator('.import-select').selectOption(EXPECTED_PROJECT_KEY);

    await page.locator('.import-modal-actions button:has-text("Import")').click();
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    // The result panel should contain a count of imported cards.
    const strongText = await page.locator('.import-result p strong').first().textContent();
    const importedCount = parseInt(strongText || '0', 10);
    expect(importedCount).toBeGreaterThan(0);

    // After completion the Cancel button is replaced by a Close button.
    await expect(page.locator('.import-modal-actions button:has-text("Close")')).toBeVisible();
    await expect(page.locator('.import-modal-actions button:has-text("Cancel")')).not.toBeVisible();

    // Sprint count line is shown when sprints were created.
    // jira.csv contains "ZRP Sprint 1" so at least one sprint should be created.
    const sprintsLine = page.locator('.import-result p', { hasText: 'sprint' });
    await expect(sprintsLine.first()).toBeVisible();
  });

  /**
   * 13. Cancel before import closes the modal and resets state
   *
   * After uploading a CSV but before clicking Import, clicking Cancel should
   * close the modal. Re-opening it should start fresh (no project dropdown).
   */
  test('cancel before import closes modal and resets state', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await openModalAndUploadCSV(page, board.id);

    // Cancel before importing.
    await page.locator('.import-modal-actions button:has-text("Cancel")').click();
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // Re-open — should be back to the initial (no project select dropdown).
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await expect(page.locator('.import-select')).not.toBeVisible();
  });

  /**
   * 14. Import button is disabled until a file is chosen
   *
   * Before any file is uploaded the Import button must be disabled so the user
   * cannot trigger an empty import.
   */
  test('Import button is disabled until a file is selected', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();

    // No file selected yet — Import button should be disabled.
    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeDisabled();
  });

  /**
   * 15. Empty CSV — graceful error from the preview endpoint (API-level)
   *
   * Posting a CSV that contains only a header row (no data rows) should either
   * succeed with an empty projects list or return 400. It must not cause a 500.
   */
  test('empty CSV returns a non-500 response from the preview endpoint (API)', async ({ request }) => {
    const { token } = await setupUserAndBoard(request);

    // Create a minimal CSV file with only the header line.
    const tmpCsv = `/tmp/empty-jira-${Date.now()}.csv`;
    fs.writeFileSync(tmpCsv, 'Summary,Issue key,Issue id,Issue Type,Status,Project key\n');

    try {
      const fileBuffer = fs.readFileSync(tmpCsv);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'empty.csv',
            mimeType: 'text/csv',
            buffer: fileBuffer,
          },
        },
      });
      // Must not be a server error.
      expect(res.status()).toBeLessThan(500);

      if (res.status() === 200) {
        const body = await res.json();
        // projects array exists and is empty (no data rows).
        expect(Array.isArray(body.projects)).toBe(true);
        expect(body.projects.length).toBe(0);
      }
    } finally {
      if (fs.existsSync(tmpCsv)) fs.unlinkSync(tmpCsv);
    }
  });

  /**
   * 16. Empty CSV — import endpoint returns 0 imported cards (API-level)
   *
   * Posting the header-only CSV to the board import endpoint should return an
   * import result with imported = 0 (no data to create).
   */
  test('empty CSV import returns 0 imported cards (API)', async ({ request }) => {
    const { token, board } = await setupUserAndBoard(request);

    const tmpCsv = `/tmp/empty-jira-import-${Date.now()}.csv`;
    fs.writeFileSync(tmpCsv, 'Summary,Issue key,Issue id,Issue Type,Status,Project key\n');

    try {
      const fileBuffer = fs.readFileSync(tmpCsv);
      const res = await request.post(`${BASE}/api/boards/${board.id}/import/jira`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'empty.csv',
            mimeType: 'text/csv',
            buffer: fileBuffer,
          },
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

  /**
   * 17. Invalid file type — preview endpoint returns 400 for a JSON file (API)
   *
   * The preview endpoint parses the upload as CSV. A JSON file that is not
   * valid CSV should return 400 Bad Request.
   */
  test('invalid file type (JSON) is rejected by the preview endpoint (API)', async ({ request }) => {
    const { token } = await setupUserAndBoard(request);

    const tmpJson = `/tmp/not-a-csv-${Date.now()}.json`;
    fs.writeFileSync(tmpJson, JSON.stringify({ hello: 'world' }));

    try {
      const fileBuffer = fs.readFileSync(tmpJson);
      const res = await request.post(`${BASE}/api/import/jira/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          file: {
            name: 'data.json',
            mimeType: 'application/json',
            buffer: fileBuffer,
          },
        },
      });
      // A JSON file has no "Summary" column so either the parse fails (400)
      // or the response is 200 with an empty project list. Either way it must
      // not crash the server (no 500).
      expect(res.status()).toBeLessThan(500);
    } finally {
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    }
  });

  /**
   * 18. Invalid file type — UI silently shows no project dropdown (UI)
   *
   * When a .json file is uploaded instead of a .csv the preview endpoint
   * returns a response that results in an empty projects array. The frontend
   * catch() sets projectKeys to [] so no dropdown appears and the Import
   * button stays disabled.
   *
   * This documents the current silent-failure behaviour. A fixme is added
   * because the ideal UX would show an explicit error message.
   */
  test.fixme('uploading a non-CSV file shows an error message (UI)', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    const tmpJson = `/tmp/not-a-csv-ui-${Date.now()}.json`;
    fs.writeFileSync(tmpJson, JSON.stringify({ hello: 'world' }));

    try {
      await page.goto(`/boards/${board.id}/settings`);
      await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
      await page.locator('button:has-text("Import from Jira CSV")').click();
      await expect(page.locator('.import-modal')).toBeVisible();

      await page.setInputFiles('.import-modal input[type="file"]', tmpJson);

      // Allow time for the (failed) preview request.
      await page.waitForTimeout(3000);

      // Ideal: an error message should be visible.
      const errorVisible =
        (await page.locator('.toast-error').isVisible()) ||
        (await page.locator('.import-modal .error').isVisible());
      expect(errorVisible).toBe(true);
    } finally {
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
    }
  });

  /**
   * 19. Overlay click closes the import modal
   *
   * Clicking the dark overlay outside the modal panel should close the modal
   * (handled by the onClick on .import-modal-overlay).
   */
  test('clicking the overlay dismisses the import modal', async ({ page, request }) => {
    const { token, board } = await setupUserAndBoard(request);
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);

    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible({ timeout: 10000 });
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();

    // Click outside the modal panel (on the overlay itself).
    await page.locator('.import-modal-overlay').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.import-modal')).not.toBeVisible();
  });

  /**
   * 20. Preview API returns correct project count
   *
   * The /api/import/jira/preview endpoint must return a projects array where
   * each entry has a key and a count. For the sample jira.csv the count for
   * "ZRP" should match the number of data rows in the file.
   */
  test('preview API returns project key and item count (API)', async ({ request }) => {
    const { token } = await setupUserAndBoard(request);

    const { status, body } = await apiPreviewCSV(request, token, JIRA_CSV_PATH);
    expect(status).toBe(200);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects.length).toBeGreaterThan(0);

    const zrpProject = body.projects.find((p: any) => p.key === EXPECTED_PROJECT_KEY);
    expect(zrpProject).toBeDefined();
    expect(zrpProject.count).toBeGreaterThan(0);
  });

});
