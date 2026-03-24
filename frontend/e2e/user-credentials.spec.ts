import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || '9002';
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createAndLoginUser(request: any): Promise<{ token: string; email: string }> {
  const email = `creds-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Credentials User' },
  });
  const { token } = await res.json();
  return { token, email };
}

// ---------------------------------------------------------------------------
// API tests — verify credential endpoints directly
// ---------------------------------------------------------------------------

test.describe('User Credentials — API', () => {

  test('GET /api/user/credentials returns empty list for new user', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const creds = await res.json();
    expect(Array.isArray(creds)).toBe(true);
    expect(creds.length).toBe(0);
  });

  test('POST /api/user/credentials creates a Gitea credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'https://gitea.example.com',
        api_token: 'test-gitea-token',
        display_name: 'My Gitea',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.provider).toBe('gitea');
    expect(body.provider_url).toBe('https://gitea.example.com');
    expect(body.display_name).toBe('My Gitea');
    expect(body.has_token).toBe(true);
    // Token must not be echoed back
    expect(body.api_token).toBeUndefined();
  });

  test('POST /api/user/credentials creates a GitHub credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'github',
        api_token: 'ghp_test_token',
        display_name: 'My GitHub',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.provider).toBe('github');
    // GitHub credentials have no provider_url
    expect(body.provider_url).toBeFalsy();
    expect(body.has_token).toBe(true);
  });

  test('POST /api/user/credentials returns 400 when provider is missing', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'some-token' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials returns 400 when api_token is missing', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/user/credentials returns 400 for unknown provider', async ({ request }) => {
    const { token } = await createAndLoginUser(request);
    const res = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'bitbucket', api_token: 'token' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/user/credentials lists created credentials', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'gitea', provider_url: 'https://gitea.example.com', api_token: 'tok1', display_name: 'Gitea 1' },
    });
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_tok2', display_name: 'GitHub' },
    });

    const res = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const creds = await res.json();
    expect(creds.length).toBeGreaterThanOrEqual(2);
    const names = creds.map((c: any) => c.display_name);
    expect(names).toContain('Gitea 1');
    expect(names).toContain('GitHub');
  });

  test('DELETE /api/user/credentials/:id removes the credential', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_delete_me', display_name: 'Delete Me' },
    });
    const cred = await createRes.json();

    const delRes = await request.delete(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const creds = await listRes.json();
    expect(creds.find((c: any) => c.id === cred.id)).toBeUndefined();
  });

  test('PUT /api/user/credentials/:id updates the credential display name', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_original', display_name: 'Original Name' },
    });
    const cred = await createRes.json();

    const updateRes = await request.put(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { api_token: 'ghp_updated', display_name: 'Updated Name' },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.display_name).toBe('Updated Name');
  });

  test('cannot delete another user credential — returns 403 or 404', async ({ request }) => {
    const { token: ownerToken } = await createAndLoginUser(request);
    const { token: otherToken } = await createAndLoginUser(request);

    const createRes = await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { provider: 'github', api_token: 'ghp_owner', display_name: "Owner's Cred" },
    });
    const cred = await createRes.json();

    const delRes = await request.delete(`${BASE}/api/user/credentials/${cred.id}`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect([403, 404]).toContain(delRes.status());
  });

  test('POST /api/user/credentials/test returns JSON with success field', async ({ request }) => {
    const { token } = await createAndLoginUser(request);

    // Test with an unreachable Gitea URL — expect JSON body not a crash
    const res = await request.post(`${BASE}/api/user/credentials/test`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        provider: 'gitea',
        provider_url: 'http://127.0.0.1:1',   // nothing listening here
        api_token: 'bad-token',
      },
    });
    // Backend returns 200 with { success: false } or a 4xx for bad input
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(typeof body.success).toBe('boolean');
      expect(typeof body.message).toBe('string');
    }
  });

  test('unauthenticated request to credentials API returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/user/credentials`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// UI tests — Settings page credential section
// ---------------------------------------------------------------------------

test.describe('User Credentials — UI', () => {

  // ── Navigate to /settings and see credentials section ────────────────────

  test('settings page shows Your API Credentials section with empty state', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Your API Credentials")')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('No API credentials configured yet');
  });

  // ── Add Credential button opens modal ─────────────────────────────────────

  test('Add Credential button opens the credential modal', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();
    await expect(page.locator('.modal-header h2')).toContainText('Add API Credential');
  });

  // ── Provider selection: Gitea vs GitHub tabs ──────────────────────────────

  test('modal shows Gitea and GitHub provider tabs', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.provider-tab:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('.provider-tab:has-text("GitHub")')).toBeVisible();
  });

  // ── Fill Gitea credential form ────────────────────────────────────────────

  test('Gitea tab (default) shows URL field and token field', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('.provider-tab.active:has-text("Gitea")')).toBeVisible();
    await expect(page.locator('#providerUrl')).toBeVisible();
    await expect(page.locator('#apiToken')).toBeVisible();
  });

  // ── Fill GitHub credential form ───────────────────────────────────────────

  test('GitHub tab hides the URL field and shows only token field', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await page.click('.provider-tab:has-text("GitHub")');

    await expect(page.locator('.provider-tab.active:has-text("GitHub")')).toBeVisible();
    await expect(page.locator('#providerUrl')).not.toBeVisible();
    await expect(page.locator('#apiToken')).toBeVisible();
  });

  // ── Test Connection button disabled when form incomplete ─────────────────

  test('Test Connection is disabled until both URL and token are filled for Gitea', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // URL only — still disabled
    await page.fill('#providerUrl', 'https://gitea.example.com');
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();

    // Both URL + token — enabled
    await page.fill('#apiToken', 'test-token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  // ── GitHub only needs token to enable Test Connection ────────────────────

  test('GitHub requires only api_token for Test Connection button to be enabled', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await page.click('.provider-tab:has-text("GitHub")');

    await page.fill('#apiToken', 'ghp_test_token');
    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  // ── Close modal via X button ──────────────────────────────────────────────

  test('modal closes when clicking the X button', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.click('.modal-header .btn-icon');

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  // ── Close modal via overlay click ─────────────────────────────────────────

  test('modal closes when clicking outside (overlay)', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.click('.modal-overlay', { position: { x: 10, y: 10 } });

    await expect(page.locator('.modal-content.credential-modal')).not.toBeVisible();
  });

  // ── Test Connection shows error badge for invalid credentials ─────────────

  test('test connection shows error badge for invalid credentials', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    await page.fill('#providerUrl', 'https://gitea.invalid.example.com');
    await page.fill('#apiToken', 'invalid-token');

    // Mock the test endpoint to return a controlled failure
    await page.route('**/api/user/credentials/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Connection failed' }),
      });
    });

    await page.click('button:has-text("Test Connection")');

    await expect(page.locator('.status-badge.error')).toBeVisible({ timeout: 5000 });
  });

  // ── Submit saves credential to the list ───────────────────────────────────

  test('submitting GitHub credential adds it to the credentials list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Use GitHub (no URL required — simpler to test without real network)
    await page.click('.provider-tab:has-text("GitHub")');
    await page.fill('#apiToken', 'ghp_fake_token_save_test');
    await page.fill('#displayName', 'My Test GitHub');

    await page.click('button[type="submit"]:has-text("Save")');

    // After saving, credential should appear in the list
    await expect(page.locator('.credential-name:has-text("My Test GitHub")')).toBeVisible({ timeout: 5000 });
  });

  // ── Delete credential removes it from the list ───────────────────────────

  test('delete credential removes it from the list', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);

    // Create credential via API first so we have something to delete
    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_to_delete', display_name: 'To Delete' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.credential-name:has-text("To Delete")')).toBeVisible();

    const credItem = page.locator('.credential-item').filter({ hasText: 'To Delete' });
    page.once('dialog', (d) => d.accept());
    await credItem.locator('.btn-danger').click();

    await expect(page.locator('.credential-name:has-text("To Delete")')).not.toBeVisible({ timeout: 5000 });
  });

  // ── Edit credential (update endpoint exists in API, no explicit edit UI) ──

  test.fixme('edit credential modal updates token and display name', async ({ page, request }) => {
    // The PUT /api/user/credentials/:id endpoint exists in the backend,
    // but Settings.tsx does not expose an edit button for credentials.
    // When an edit UI is added, this test should open an edit modal,
    // change the display name, save, and verify the updated name shows.
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/user/credentials`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { provider: 'github', api_token: 'ghp_edit_me', display_name: 'Edit Me' },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    const credItem = page.locator('.credential-item').filter({ hasText: 'Edit Me' });
    await credItem.locator('.btn-edit, button:has-text("Edit")').click();

    await page.fill('#displayName', 'Renamed Cred');
    await page.click('button[type="submit"]:has-text("Save")');

    await expect(page.locator('.credential-name:has-text("Renamed Cred")')).toBeVisible({ timeout: 5000 });
  });

  // ── Admin sees Global Gitea Connection section ────────────────────────────

  test('admin user sees Global Gitea Connection section on settings page', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);

    await request.post(`${BASE}/api/auth/promote-admin`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
  });

  // ── Non-admin does not see Global Gitea Connection section ───────────────

  test('non-admin user does not see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createAndLoginUser(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.settings-section h2:has-text("Global Gitea Connection")')).not.toBeVisible();
  });
});
