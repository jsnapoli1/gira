import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;
const JIRA_CSV_PATH = '/Users/jsnapoli1/Documents/open-source/zira/jira.csv';

async function setupUserAndBoard(page: any, request: any) {
  const email = `test-jira-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const signupRes = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Import Tester' },
  });
  const { token } = await signupRes.json();

  const boardRes = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Import Test Board' },
  });
  const board = await boardRes.json();

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  return { token, board };
}

test.describe('Jira CSV Import Wizard', () => {
  test('import section is visible in board settings', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);

    // Wait for settings page to load
    await expect(page.locator('.settings-page')).toBeVisible();

    // Find the Import / Export section
    const importSection = page.locator('.settings-section').filter({ hasText: 'Import / Export' });
    await expect(importSection).toBeVisible();
    await expect(importSection.locator('h2')).toContainText('Import / Export');

    // Both export and import buttons should be present
    await expect(importSection.locator('button:has-text("Export to CSV")')).toBeVisible();
    await expect(importSection.locator('button:has-text("Import from Jira CSV")')).toBeVisible();
  });

  test('uploading CSV shows project selection (mapping step)', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // Open the import modal
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await expect(page.locator('.import-modal h3')).toContainText('Import from Jira CSV');

    // Upload the CSV file
    await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);

    // After upload, the preview endpoint parses the CSV and populates project keys.
    // The select dropdown appears once project keys arrive.
    await expect(page.locator('.import-select')).toBeVisible({ timeout: 15000 });
  });

  test('column mapping dropdown exists after uploading CSV', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // Open import modal and upload CSV
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);

    // Wait for the project selection dropdown to appear
    const projectSelect = page.locator('.import-select');
    await expect(projectSelect).toBeVisible({ timeout: 15000 });

    // Verify at least one option is present (besides "All Projects")
    const options = await projectSelect.locator('option').count();
    expect(options).toBeGreaterThan(1);
  });

  test('cancel resets import modal to initial state', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // Open import modal and upload CSV
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);

    // Wait for project selection to appear (confirms upload was processed)
    await expect(page.locator('.import-select')).toBeVisible({ timeout: 15000 });

    // Click Cancel
    await page.locator('.import-modal-actions button:has-text("Cancel")').click();

    // Modal should be closed
    await expect(page.locator('.import-modal')).not.toBeVisible();

    // Re-open modal — should be back to initial state (no project select)
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();
    await expect(page.locator('.import-select')).not.toBeVisible();
  });

  test('complete import shows success result', async ({ page, request }) => {
    const { board } = await setupUserAndBoard(page, request);
    await page.goto(`/boards/${board.id}/settings`);
    await expect(page.locator('.settings-page')).toBeVisible();

    // Open import modal
    await page.locator('button:has-text("Import from Jira CSV")').click();
    await expect(page.locator('.import-modal')).toBeVisible();

    // Upload CSV
    await page.setInputFiles('.import-modal input[type="file"]', JIRA_CSV_PATH);

    // Wait for project selection to appear (preview loaded)
    await expect(page.locator('.import-select')).toBeVisible({ timeout: 15000 });

    // Click Import (accept all projects default)
    const importBtn = page.locator('.import-modal-actions button:has-text("Import")');
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    // Wait for import result to display — may take a moment with a large CSV
    await expect(page.locator('.import-result')).toBeVisible({ timeout: 30000 });

    // Result should show how many cards were imported
    await expect(page.locator('.import-result p strong')).toBeVisible();
  });
});
