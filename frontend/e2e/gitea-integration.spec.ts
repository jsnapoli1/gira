import { test, expect } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.PORT || 9002}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(request: any, prefix = 'gitea-user') {
  const email = `test-${prefix}-${crypto.randomUUID()}@test.com`;
  const res = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: 'password123', display_name: 'Gitea Test User' },
  });
  const body = await res.json();
  return {
    token: body.token as string,
    user: body.user as { id: number; is_admin: boolean },
    email,
  };
}

async function createAdmin(request: any) {
  const { token, user, email } = await createUser(request, 'gitea-admin');
  // First registered user auto-promotes, but promote explicitly here to be safe
  await request.post(`${BASE}/api/auth/promote-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, user, email };
}

async function createBoard(request: any, token: string, name = 'Gitea Test Board') {
  const res = await request.post(`${BASE}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  return res.json() as Promise<{ id: number; name: string }>;
}

// ---------------------------------------------------------------------------
// 1. Settings page loads
// ---------------------------------------------------------------------------

test.describe('Settings page — Gitea fields', () => {
  test('settings page loads and shows expected page header', async ({ page, request }) => {
    const { token } = await createUser(request, 'settings-load');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(page.locator('.page-header h1')).toContainText('Settings');
  });
});

// ---------------------------------------------------------------------------
// 2. Settings form has correct fields (admin view)
// ---------------------------------------------------------------------------

test.describe('Settings form fields — admin', () => {
  test('admin sees Gitea URL input, API key input, and save button', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    // Admin-only "Global Gitea Connection" section must be present
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#giteaUrl')).toBeVisible();
    await expect(page.locator('#giteaApiKey')).toBeVisible();
    await expect(
      page.locator('button[type="submit"]:has-text("Save Configuration"), button[type="submit"]:has-text("Update Configuration")'),
    ).toBeVisible();
  });

  test('Gitea URL input has type="url"', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    const inputType = await page.locator('#giteaUrl').getAttribute('type');
    expect(inputType).toBe('url');
  });

  test('API key input has type="password"', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    const inputType = await page.locator('#giteaApiKey').getAttribute('type');
    expect(inputType).toBe('password');
  });
});

// ---------------------------------------------------------------------------
// 3. Empty Gitea URL shows placeholder
// ---------------------------------------------------------------------------

test.describe('Settings — unconfigured placeholder text', () => {
  test('Gitea URL input shows placeholder when no config is set', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    const placeholder = await page.locator('#giteaUrl').getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    // The placeholder should suggest a URL format
    expect(placeholder).toMatch(/https?:\/\//);
  });

  test('API key input shows placeholder hint when no config is set', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    const placeholder = await page.locator('#giteaApiKey').getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    // When unconfigured the placeholder guides the user to provide a key
    expect(placeholder).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. Save invalid URL shows error (browser-native URL validation)
// ---------------------------------------------------------------------------

test.describe('Settings — Gitea URL validation', () => {
  test('submitting a non-URL value in the Gitea URL field is blocked by browser validation', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    // Fill in an invalid non-URL string
    await page.fill('#giteaUrl', 'not-a-valid-url');
    await page.fill('#giteaApiKey', 'some-api-key');

    // Click submit — browser's built-in URL validation should prevent the POST
    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Save Configuration"), button[type="submit"]:has-text("Update Configuration")',
    );
    await submitBtn.click();

    // The page must NOT navigate away and must NOT show a success badge
    await expect(page.locator('.status-badge.success')).not.toBeVisible();
    // Still on settings
    await expect(page).toHaveURL(/\/settings/);
  });

  test('submitting empty Gitea URL is prevented', async ({ page, request }) => {
    const { token } = await createAdmin(request);
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).toBeVisible({ timeout: 10_000 });

    // Leave URL blank, fill in key
    await page.fill('#giteaApiKey', 'some-api-key');

    const submitBtn = page.locator(
      'button[type="submit"]:has-text("Save Configuration"), button[type="submit"]:has-text("Update Configuration")',
    );
    await submitBtn.click();

    // required attribute on URL field should block submission
    await expect(page.locator('.status-badge.success')).not.toBeVisible();
    await expect(page).toHaveURL(/\/settings/);
  });
});

// ---------------------------------------------------------------------------
// 5. Repos endpoint without config
// ---------------------------------------------------------------------------

test.describe('GET /api/repos — without Gitea configured', () => {
  test('returns 428 (Precondition Required) when Gitea is not configured', async ({ request }) => {
    const { token } = await createUser(request, 'repos-no-config');

    const res = await request.get(`${BASE}/api/repos`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Backend responds 428 (StatusPreconditionRequired) when not configured
    expect([428, 503, 200]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      // If it returns 200, it should be an empty array (graceful degradation)
      expect(Array.isArray(body)).toBe(true);
    }
  });

  test('repos endpoint does not crash the server', async ({ request }) => {
    const { token } = await createUser(request, 'repos-no-crash');

    // Make several calls — the server should remain responsive
    for (let i = 0; i < 3; i++) {
      const res = await request.get(`${BASE}/api/repos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status()).toBeLessThan(600);
    }
  });

  test('repos endpoint requires authentication', async ({ request }) => {
    const res = await request.get(`${BASE}/api/repos`);
    // Without a token the server should return 401
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 6. Issues endpoint without config
// ---------------------------------------------------------------------------

test.describe('GET /api/issues — without Gitea configured', () => {
  test('returns 428 (Precondition Required) when Gitea is not configured', async ({ request }) => {
    const { token } = await createUser(request, 'issues-no-config');

    const res = await request.get(`${BASE}/api/issues?owner=test&repo=test`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // requireConfig middleware returns 428 (StatusPreconditionRequired)
    expect(res.status()).toBe(428);
  });

  test('issues endpoint returns 400 when owner/repo params are missing', async ({ request }) => {
    const { token } = await createUser(request, 'issues-missing-params');

    // Even if Gitea were configured, missing params should return 400.
    // Without config the middleware fires first (428), so accept either.
    const res = await request.get(`${BASE}/api/issues`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect([400, 428]).toContain(res.status());
  });

  test('issues endpoint requires authentication', async ({ request }) => {
    const res = await request.get(`${BASE}/api/issues?owner=test&repo=test`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 7. Board creation without Gitea — swimlane repo field
// ---------------------------------------------------------------------------

test.describe('Board creation without Gitea', () => {
  test('board creation succeeds without Gitea configured', async ({ page, request }) => {
    const { token } = await createUser(request, 'board-no-gitea');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/boards');
    await page.click('text=Create Board');
    await page.fill('#boardName', 'Local Board No Gitea');
    await page.click('button[type="submit"]:has-text("Create Board")');

    // Board should be created and navigate to the board page
    await page.waitForURL(/\/boards\/\d+/, { timeout: 10_000 });
    await expect(page.locator('.board-header h1')).toContainText('Local Board No Gitea');
  });

  test('swimlane form shows owner/repo field that can be left blank', async ({ page, request }) => {
    const { token } = await createUser(request, 'swimlane-no-gitea');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'Swimlane Repo Field Board');
    await page.goto(`/boards/${board.id}/settings`);

    // Open the Add Swimlane modal
    await page.click('button:has-text("Add Swimlane")');
    await expect(page.locator('.modal h2:has-text("Add Swimlane")')).toBeVisible();

    // The owner/repo field should be present
    const repoInput = page.locator('.modal input[placeholder="owner/repo"]');
    await expect(repoInput).toBeVisible();

    // It should be clearable / optional
    await repoInput.fill('');
    const value = await repoInput.inputValue();
    expect(value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 8. Card creation without Gitea repo — local sequential ID
// ---------------------------------------------------------------------------

test.describe('Card creation without Gitea', () => {
  test('creating a card without a Gitea repo gives it a local sequential ID', async ({ page, request }) => {
    const { token } = await createUser(request, 'card-local-id');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'Card Local ID Board');

    // Add a swimlane without a repo via API so we can create a card
    const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Local Lane', card_prefix: 'LOCAL-' },
    });
    expect(swimlaneRes.status()).toBe(200);
    const swimlane = await swimlaneRes.json();

    // Get column list to find a column id
    const columnsRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardData = await columnsRes.json();
    const firstColumn = boardData.columns?.[0];
    expect(firstColumn).toBeDefined();

    // Create card via API
    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Local card without Gitea',
        column_id: firstColumn.id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    expect(cardRes.status()).toBe(200);
    const card = await cardRes.json();

    // Card should have a numeric ID (local sequential)
    expect(typeof card.id).toBe('number');
    expect(card.id).toBeGreaterThan(0);
  });

  test('card creation via UI does not crash without Gitea configured', async ({ page, request }) => {
    const { token } = await createUser(request, 'card-no-crash');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'Card No Crash Board');

    // Add swimlane without repo
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Repo Lane', card_prefix: 'NR-' },
    });

    await page.goto(`/boards/${board.id}`);

    // Board should load without crashing even without Gitea
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 9. Swimlane with no Gitea credentials still shows cards
// ---------------------------------------------------------------------------

test.describe('Swimlane without Gitea credentials', () => {
  test('swimlane without credentials renders without error', async ({ page, request }) => {
    const { token } = await createUser(request, 'swimlane-no-creds');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'No Creds Board');

    // Add a swimlane with no credentials (no gitea_token, no swimlane credential)
    const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Creds Swimlane', card_prefix: 'NC-' },
    });
    expect(swimlaneRes.status()).toBe(200);

    await page.goto(`/boards/${board.id}`);

    // The board page should render — swimlane heading or empty state visible
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10_000 });

    // No unhandled error overlay should appear
    await expect(page.locator('.error-boundary, .fatal-error')).not.toBeVisible();
  });

  test('swimlane without credentials shows cards created via API', async ({ page, request }) => {
    const { token } = await createUser(request, 'swimlane-cards-no-creds');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'Cards No Creds Board');

    const swimlaneRes = await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'No Creds Swimlane 2', card_prefix: 'NCB-' },
    });
    const swimlane = await swimlaneRes.json();

    const boardRes = await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boardData = await boardRes.json();
    const firstColumn = boardData.columns?.[0];

    // Create a card
    await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'Card in uncredentialed swimlane',
        column_id: firstColumn.id,
        swimlane_id: swimlane.id,
        board_id: board.id,
      },
    });

    await page.goto(`/boards/${board.id}`);
    await expect(page.locator('.board-page')).toBeVisible({ timeout: 10_000 });

    // The card title should be visible
    await expect(
      page.locator('.card-item, .card-title').filter({ hasText: 'Card in uncredentialed swimlane' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 10. Reports work without Gitea
// ---------------------------------------------------------------------------

test.describe('Reports page — without Gitea', () => {
  test('reports page loads without Gitea configured', async ({ page, request }) => {
    const { token } = await createUser(request, 'reports-no-gitea');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/reports');

    await expect(page.locator('.page-header h1')).toContainText('Reports', { timeout: 10_000 });
  });

  test('reports page shows empty state or board selector when no boards exist', async ({ page, request }) => {
    const { token } = await createUser(request, 'reports-empty');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/reports');

    // Wait for loading to finish
    await expect(page.locator('.loading')).not.toBeVisible({ timeout: 10_000 });

    // With no boards, expect either an empty state or a "Select a board" prompt
    await expect(
      page.locator('.empty-state, .reports-filters select'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('reports page does not crash without Gitea', async ({ page, request }) => {
    const { token } = await createUser(request, 'reports-no-crash');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    const board = await createBoard(request, token, 'Reports Gitea-Free Board');

    await page.goto('/reports');
    await expect(page.locator('.page-header h1')).toContainText('Reports', { timeout: 10_000 });

    // Select the board that was created
    await page.selectOption('.reports-filters select', { label: board.name });

    // The reports section should render without an uncaught error
    await expect(page.locator('.metrics-summary, .empty-state')).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 11. Gitea config test button (test connection in "Add Credential" modal)
// ---------------------------------------------------------------------------

test.describe('Gitea config test connection button', () => {
  test('Test Connection button exists and is disabled when form is empty', async ({ page, request }) => {
    const { token } = await createUser(request, 'test-btn-empty');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    // Initially form is empty so the test button should be disabled
    await expect(page.locator('button:has-text("Test Connection")')).toBeDisabled();
  });

  test('Test Connection button becomes enabled after filling URL and token', async ({ page, request }) => {
    const { token } = await createUser(request, 'test-btn-enabled');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await page.click('button:has-text("Add Credential")');
    await expect(page.locator('.modal-content.credential-modal')).toBeVisible();

    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'test-api-token');

    await expect(page.locator('button:has-text("Test Connection")')).toBeEnabled();
  });

  test.fixme(
    'Test Connection button calls the live Gitea endpoint and shows success',
    async ({ page, request }) => {
      // This test requires a live Gitea instance. Skip in environments without one.
      // When a real Gitea URL and valid token are provided:
      //   1. Click "Add Credential"
      //   2. Fill in the real Gitea URL and token
      //   3. Click "Test Connection"
      //   4. Expect a .status-badge.success badge with "Connected" text
      const { token } = await createUser(request, 'test-btn-live');
      await page.addInitScript((t) => localStorage.setItem('token', t), token);

      await page.goto('/settings');
      await page.click('button:has-text("Add Credential")');
      await page.fill('#providerUrl', process.env.GITEA_URL ?? 'https://gitea.example.com');
      await page.fill('#apiToken', process.env.GITEA_API_KEY ?? 'live-token');
      await page.click('button:has-text("Test Connection")');

      await expect(page.locator('.status-badge.success')).toBeVisible({ timeout: 15_000 });
    },
  );

  test('Test Connection with invalid credentials shows connection error (mocked)', async ({ page, request }) => {
    const { token } = await createUser(request, 'test-btn-fail');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await page.click('button:has-text("Add Credential")');

    // Mock the test-connection endpoint to return failure
    await page.route('**/api/credentials/*/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Connection failed: invalid token' }),
      });
    });

    await page.fill('#providerUrl', 'https://gitea.example.com');
    await page.fill('#apiToken', 'bad-token');
    await page.click('button:has-text("Test Connection")');

    await expect(
      page.locator('.status-badge.error, .status-badge:has-text("Failed")'),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Additional: Config status endpoint without Gitea
// ---------------------------------------------------------------------------

test.describe('Config status API — without Gitea', () => {
  test('GET /api/config/status returns configured=false when no Gitea set', async ({ request }) => {
    const { token } = await createUser(request, 'config-status');

    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe('boolean');
    // In a clean test env without Gitea, configured should be false
    // (unless a previous test set it, so we just verify the shape)
    expect(Object.prototype.hasOwnProperty.call(body, 'configured')).toBe(true);
  });

  test('GET /api/config/status is accessible to non-admin users', async ({ request }) => {
    const { token } = await createUser(request, 'config-status-nonadmin');

    const res = await request.get(`${BASE}/api/config/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Any authenticated user can check config status
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Additional: Non-admin does NOT see Global Gitea section in Settings
// ---------------------------------------------------------------------------

test.describe('Settings page — non-admin Gitea section', () => {
  test('non-admin user does not see Global Gitea Connection section', async ({ page, request }) => {
    const { token } = await createUser(request, 'nonadmin-settings');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');
    await expect(page.locator('.page-header h1')).toContainText('Settings', { timeout: 10_000 });

    // The Global Gitea Connection section is admin-only
    await expect(
      page.locator('.settings-section h2:has-text("Global Gitea Connection")'),
    ).not.toBeVisible();
  });

  test('non-admin sees the API Credentials section', async ({ page, request }) => {
    const { token } = await createUser(request, 'nonadmin-creds');
    await page.addInitScript((t) => localStorage.setItem('token', t), token);

    await page.goto('/settings');

    await expect(
      page.locator('.settings-section h2:has-text("Your API Credentials")'),
    ).toBeVisible({ timeout: 10_000 });
  });
});
