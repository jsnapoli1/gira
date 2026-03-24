import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any): Promise<{ token: string; email: string; displayName: string }> {
  const email = `settings-${crypto.randomUUID()}@test.com`;
  const displayName = 'Settings Test User';
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: displayName },
  });
  const { token } = await res.json();
  return { token, email, displayName };
}

async function createAdminUser(request: any): Promise<{ token: string; email: string }> {
  const { token, email } = await createUser(request);
  await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, email };
}

// ---------------------------------------------------------------------------
// API tests — config endpoints
// ---------------------------------------------------------------------------

test.describe('Settings — Config API', () => {

  test('GET /api/config/status returns configured field', async ({ request }) => {
    const { token } = await createUser(request);
    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
  });

  test('GET /api/config returns gitea_url field', async ({ request }) => {
    const { token } = await createUser(request);
    const res = await request.get(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect('gitea_url' in body).toBe(true);
  });

  test('POST /api/config saves Gitea URL and returns success', async ({ request }) => {
    // Only admin can change global config, but the POST endpoint is accessible
    // by any authenticated user per the current route setup
    const { token } = await createAdminUser(request);
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'https://gitea-settings-test.example.com', gitea_api_key: 'test-key-123' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('POST /api/config returns 400 when gitea_url is missing', async ({ request }) => {
    const { token } = await createAdminUser(request);
    const res = await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_api_key: 'some-key' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/config/status returns configured true after saving URL and key', async ({ request }) => {
    const { token } = await createAdminUser(request);

    // Save config
    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: 'https://gitea-status-test.example.com',
        gitea_api_key: 'status-test-key',
      },
    });

    const statusRes = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.configured).toBe(true);
    expect(status.gitea_url).toBe('https://gitea-status-test.example.com');
  });

  test('GET /api/config is a public endpoint — returns 200 without auth', async ({ request }) => {
    // GET /api/config is intentionally public (no requireAuth middleware).
    // Only POST /api/config requires admin auth.
    const res = await request.get(`${BASE}/api/config`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect('gitea_url' in body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UI tests — Settings page
// ---------------------------------------------------------------------------

test.describe('Settings — UI', () => {

  // ── Navigate to settings page ─────────────────────────────────────────────

  test('navigating to /settings shows the Settings page header', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });

  // ── User profile section ──────────────────────────────────────────────────

  test('settings page shows user profile with display name', async ({ page, request }) => {
    const { token, displayName } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Profile")')).toBeVisible();
    await expect(page.locator('.profile-info h3')).toContainText(displayName);
  });

  // ── User credentials section visible to all ───────────────────────────────

  test('settings page shows Your API Credentials section for all users', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
  });

  // ── About section ─────────────────────────────────────────────────────────

  test('settings page shows About Zira section with version', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("About Zira")')).toBeVisible();
    await expect(page.locator('.about-info')).toContainText('Version: 1.0.0');
  });

  // ── Admin-only: Global Gitea Connection section ───────────────────────────

  test('admin sees Global Gitea Connection section with URL and API Key fields', async ({ page, request }) => {
    const { token } = await createAdminUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
  });

  // ── Non-admin does not see Global Gitea Connection ────────────────────────

  test('non-admin does not see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).not.toBeVisible();
  });

  // ── Gitea URL field ───────────────────────────────────────────────────────

  test('admin can type a Gitea URL into the giteaUrl field', async ({ page, request }) => {
    const { token } = await createAdminUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible();

    // Triple-click to select all existing content before typing
    await page.locator('#giteaUrl').click({ clickCount: 3 });
    await page.fill('#giteaUrl', 'https://gitea.ui-test.example.com');
    await expect(page.locator('#giteaUrl')).toHaveValue('https://gitea.ui-test.example.com');
  });

  // ── API token field ───────────────────────────────────────────────────────

  test('admin Gitea API Key field is a password input', async ({ page, request }) => {
    const { token } = await createAdminUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaApiKey')).toHaveAttribute('type', 'password');
  });

  // ── Save settings (PUT /api/config) ──────────────────────────────────────

  test('admin saving valid Gitea config shows success status badge', async ({ page, request }) => {
    const { token } = await createAdminUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('#giteaUrl')).toBeVisible();

    await page.fill('#giteaUrl', 'https://gitea.save-test.example.com');
    await page.fill('#giteaApiKey', 'save-test-api-key');

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    // Should show success status badge (use first() in case a "Connected" badge is also showing)
    await expect(page.locator('.status-badge.success').first()).toBeVisible({ timeout: 5000 });
  });

  // ── Connection status indicator shown when already configured ─────────────

  test('already-configured admin sees Connected status badge on settings load', async ({ page, request }) => {
    const { token } = await createAdminUser(request);

    // Pre-configure via API
    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: 'https://gitea.preconfigured.example.com',
        gitea_api_key: 'preconfigured-key',
      },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    // After configuring, the UI shows a "Connected to Gitea" badge
    await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.status-badge.success')).toContainText('Connected');
  });

  // ── Update configuration (already configured — button text changes) ───────

  test('button text changes to Update Configuration when already configured', async ({ page, request }) => {
    const { token } = await createAdminUser(request);

    // Pre-configure
    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        gitea_url: 'https://gitea.update-test.example.com',
        gitea_api_key: 'update-test-key',
      },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('button:has-text("Update Configuration")')).toBeVisible({ timeout: 8000 });
  });

  // ── API key field placeholder changes when already configured ─────────────

  test('API key placeholder is either masked (configured) or descriptive (unconfigured)', async ({ page, request }) => {
    // This test verifies that the placeholder attribute is set to one of the two
    // valid values defined in Settings.tsx. Due to the shared global config, the
    // exact value depends on the current configuration state.
    const { token } = await createAdminUser(request);

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    const placeholder = await page.locator('#giteaApiKey').getAttribute('placeholder');
    // Either '••••••••' (configured) or 'Your Gitea API key' (unconfigured)
    expect(
      placeholder === '••••••••' || placeholder === 'Your Gitea API key'
    ).toBe(true);
  });

  // ── Insecure TLS checkbox (no UI for it currently) ────────────────────────

  test.fixme('insecure TLS checkbox toggles GiteaInsecureTLS in config', async ({ page, request }) => {
    // Settings.tsx currently has no insecure TLS checkbox in the UI.
    // The GiteaInsecureTLS field exists in config.go but is not exposed.
    // When a checkbox is added, this test should:
    //   1. Load settings as admin
    //   2. Check the "Allow insecure TLS" checkbox
    //   3. Save
    //   4. Verify the saved config reflects insecure_tls: true
    const { token } = await createAdminUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.check('input[name="insecureTls"], #insecureTls');

    const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Update Configuration")');
    await saveBtn.click();

    await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 5000 });
  });

  // ── Clear/reset settings (no dedicated reset UI) ──────────────────────────

  test.fixme('clear/reset Gitea settings via UI returns to unconfigured state', async ({ page, request }) => {
    // Settings.tsx has no "Clear" or "Reset" button.
    // When one is added, this test should:
    //   1. Load settings as admin (with config already set)
    //   2. Click "Clear" / "Reset" button
    //   3. Confirm the dialog
    //   4. Verify status shows "Not Connected" and URL field is empty
    const { token } = await createAdminUser(request);

    await request.post(`${BASE}/api/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { gitea_url: 'https://gitea.clear-test.example.com', gitea_api_key: 'clear-key' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    page.once('dialog', (d) => d.accept());
    await page.click('button:has-text("Clear"), button:has-text("Reset")');

    await expect(page.locator('#giteaUrl')).toHaveValue('');
    await expect(page.locator('.status-badge.success')).not.toBeVisible();
  });
});
