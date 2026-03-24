import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

async function setupWithCard(page: any) {
  const email = `test-worklogs-${crypto.randomUUID()}@test.com`;
  const { token } = await (
    await page.request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'Worklog Test User' },
    })
  ).json();

  const board = await (
    await page.request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Worklog Test Board' },
    })
  ).json();

  const swimlane = await (
    await page.request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Swimlane', designator: 'TEST-' },
    })
  ).json();

  const cardRes = await page.request.post(`${BASE}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Test Card for Worklogs',
      column_id: board.columns[0].id,
      swimlane_id: swimlane.id,
      board_id: board.id,
    },
  });
  if (!cardRes.ok()) {
    test.skip(true, `Card creation failed (likely Gitea 401): ${await cardRes.text()}`);
    return;
  }

  await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
  await page.goto(`/boards/${board.id}`);
  await page.click('.view-btn:has-text("All Cards")');
  await page.waitForSelector('.card-item', { timeout: 10000 });
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
}

test('should show compact time tracking section', async ({ page }) => {
  await setupWithCard(page);
  await expect(page.locator('.time-tracking-compact')).toBeVisible();
  await expect(page.locator('.time-tracking-header')).toContainText('Time Tracking');
});

test('should show time logged initially as 0m', async ({ page }) => {
  await setupWithCard(page);
  await expect(page.locator('.time-tracking-stats .time-logged')).toBeVisible();
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('0m logged');
});

test('should log time via compact input', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
});

test('should update time logged total after adding entry', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '90');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 30m logged', { timeout: 5000 });
});

test('should clear input after logging time', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  await expect(page.locator('.time-input-mini')).toHaveValue('');
});

test('should disable Log button when time is not entered', async ({ page }) => {
  await setupWithCard(page);
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
  await page.fill('.time-input-mini', '30');
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeEnabled();
  await page.fill('.time-input-mini', '');
  await expect(page.locator('.time-tracking-actions button:has-text("Log")')).toBeDisabled();
});

test('should format hours and minutes correctly', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '125');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('2h 5m logged', { timeout: 5000 });
});

test('should accumulate logged time across multiple entries', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '30');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('30m logged', { timeout: 5000 });
  await page.fill('.time-input-mini', '45');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h 15m logged', { timeout: 5000 });
});

test('should persist time logged after closing modal', async ({ page }) => {
  await setupWithCard(page);
  await page.fill('.time-input-mini', '60');
  await page.click('.time-tracking-actions button:has-text("Log")');
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-detail-modal-unified')).not.toBeVisible();
  await page.click('.card-item');
  await page.waitForSelector('.card-detail-modal-unified', { timeout: 5000 });
  await expect(page.locator('.time-tracking-stats .time-logged')).toContainText('1h logged', { timeout: 5000 });
});

test('should show time tracking section inline without tabs', async ({ page }) => {
  await setupWithCard(page);
  await expect(page.locator('.tab-btn')).toHaveCount(0);
  await expect(page.locator('.time-tracking-compact')).toBeVisible();
});
