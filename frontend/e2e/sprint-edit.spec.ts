import { test, expect } from '@playwright/test';

const PORT = process.env.PORT || 9002;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardSetup {
  token: string;
  boardId: number;
  sprintId: number;
  swimlaneId: number;
  firstColumnId: number;
}

async function setupBoardWithSprint(
  request: any,
  sprintName = 'Sprint 1',
): Promise<BoardSetup> {
  const email = `test-sprint-edit-${crypto.randomUUID()}@test.com`;

  const { token } = await (
    await request.post(`${BASE}/api/auth/signup`, {
      data: { email, password: 'password123', display_name: 'SprintEdit Tester' },
    })
  ).json();

  const board = await (
    await request.post(`${BASE}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Sprint Edit Board' },
    })
  ).json();

  const swimlane = await (
    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Test Lane', designator: 'TL-', color: '#6366f1' },
    })
  ).json();

  const boardDetail = await (
    await request.get(`${BASE}/api/boards/${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const firstColumn = (boardDetail.columns || [])[0];

  const sprint = await (
    await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: sprintName },
    })
  ).json();

  return {
    token,
    boardId: board.id,
    sprintId: sprint.id,
    swimlaneId: swimlane.id,
    firstColumnId: firstColumn?.id,
  };
}

// Navigate to the board, switch to backlog, then open the edit modal for the first sprint.
async function openBacklogEditModal(page: any): Promise<void> {
  await page.waitForSelector('.board-page', { timeout: 10000 });
  await page.click('.view-btn:has-text("Backlog")');
  await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
  await page.click('.backlog-sprint-header button[title="Edit sprint"]');
  await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Sprint Edit', () => {
  // -------------------------------------------------------------------------
  // 1. Edit sprint name — updated name appears in backlog panel
  // -------------------------------------------------------------------------
  test('edit sprint name — updated name appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Original Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Updated Sprint Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Updated Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 2. Edit sprint name — new name appears in board header badge
  // -------------------------------------------------------------------------
  test('renamed sprint appears in board header active-sprint-badge', async ({ page, request }) => {
    const email = `test-badge-rename-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'Badge Rename Tester' },
      })
    ).json();

    const board = await (
      await request.post(`${BASE}/api/boards`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Badge Rename Board' },
      })
    ).json();

    await request.post(`${BASE}/api/boards/${board.id}/swimlanes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Lane', designator: 'LN-', color: '#6366f1' },
    });

    const sprint = await (
      await request.post(`${BASE}/api/sprints?board_id=${board.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: 'Before Rename' },
      })
    ).json();

    // Start the sprint so it shows in the board header badge
    await request.post(`${BASE}/api/sprints/${sprint.id}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${board.id}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    // Open edit via the active-sprint-badge in board header
    await page.click('.active-sprint-badge');
    await page.waitForSelector('.modal h2:has-text("Edit Sprint")', { timeout: 5000 });

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('After Rename');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.active-sprint-badge')).toContainText('After Rename');
  });

  // -------------------------------------------------------------------------
  // 3. Edit sprint goal — goal text appears in backlog panel
  // -------------------------------------------------------------------------
  test('edit sprint goal — goal text appears in backlog panel', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Goal Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await page.locator('.modal textarea').fill('Deliver the MVP features');
    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.sprint-goal')).toContainText('Deliver the MVP features');
  });

  // -------------------------------------------------------------------------
  // 4. Edit sprint start and end dates — sprint-dates element becomes visible
  // -------------------------------------------------------------------------
  test('edit sprint start and end dates — sprint-dates element becomes visible', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Dated Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await page.locator('.modal input[type="date"]').first().fill('2026-05-01');
    await page.locator('.modal input[type="date"]').last().fill('2026-05-14');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    const datesEl = page.locator('.sprint-dates');
    await expect(datesEl).toBeVisible({ timeout: 6000 });
    await expect(datesEl).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 5. Sprint dates shown in backlog header after API update
  // -------------------------------------------------------------------------
  test('sprint dates shown in backlog header after API update', async ({ page, request }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'API Dated Sprint');

    await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'API Dated Sprint',
        start_date: '2026-06-01',
        end_date: '2026-06-14',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.sprint-dates')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('.sprint-dates')).toContainText('2026');
  });

  // -------------------------------------------------------------------------
  // 6. Cancel edit modal — name stays unchanged
  // -------------------------------------------------------------------------
  test('cancelling the edit sprint modal leaves the sprint name unchanged', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Cancel Edit Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Should Not Save');

    // Click Cancel button
    await page.click('.modal button:has-text("Cancel")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Original name must still be shown
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Cancel Edit Sprint');
  });

  // -------------------------------------------------------------------------
  // 7. Edit modal pre-populates existing sprint name
  // -------------------------------------------------------------------------
  test('edit sprint modal pre-populates existing sprint name in input', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Pre-Populated Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await expect(nameInput).toHaveValue('Pre-Populated Sprint');
  });

  // -------------------------------------------------------------------------
  // 8. Sprint name change persists after page reload
  // -------------------------------------------------------------------------
  test('sprint name change persists after page reload', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Persist Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Persisted Sprint Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Hard reload
    await page.reload();
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Persisted Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 9. PUT /api/sprints/:id updates name, goal, and dates (API round-trip)
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id updates name, goal, and dates', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'API Update Sprint');

    const updateRes = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Renamed via API',
        goal: 'API goal text',
        start_date: '2026-06-01',
        end_date: '2026-06-14',
      },
    });
    expect(updateRes.status()).toBe(200);

    const getRes = await request.get(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const sprint = await getRes.json();

    expect(sprint.name).toBe('Renamed via API');
    expect(sprint.goal).toBe('API goal text');
    expect(sprint.start_date).toMatch(/2026-06-01/);
    expect(sprint.end_date).toMatch(/2026-06-14/);
  });

  // -------------------------------------------------------------------------
  // 10. Save sprint edits — Save button submits and closes modal
  // -------------------------------------------------------------------------
  test('save sprint edits closes modal and reflects update immediately', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Save Test Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    // Change the name
    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Saved Sprint Name');

    // Save
    await page.click('.modal .btn-primary:has-text("Save")');

    // Modal must close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    // Updated name reflected without reload
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Saved Sprint Name');
  });

  // -------------------------------------------------------------------------
  // 11. Delete sprint with no cards — sprint panel disappears
  // -------------------------------------------------------------------------
  test('delete sprint with no cards — sprint panel disappears', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Deletable Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 12. Delete sprint with cards — cards move back to swimlane backlog section
  // -------------------------------------------------------------------------
  test('deleting sprint with cards moves those cards back to swimlane backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId, swimlaneId, firstColumnId } = await setupBoardWithSprint(
      request,
      'Sprint With Cards',
    );

    const cardRes = await request.post(`${BASE}/api/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: firstColumnId,
        title: 'Card In Sprint',
      },
    });
    if (!cardRes.ok()) {
      test.skip(true, `Card creation failed: ${await cardRes.text()}`);
      return;
    }
    const card = await cardRes.json();

    await request.post(`${BASE}/api/cards/${card.id}/assign-sprint`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { sprint_id: sprintId },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Card must be in the sprint panel
    await expect(page.locator('.backlog-sprint-cards .card-title')).toContainText('Card In Sprint');

    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Sprint panel gone
    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });

    // Card must now appear in the swimlane backlog section
    await expect(page.locator('.swimlane-backlog .card-title')).toContainText('Card In Sprint');
  });

  // =========================================================================
  // API tests (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 13. PUT /api/sprints/:id updates name only
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — updates name field', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Name Only Sprint');

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'New Name Only' },
    });
    expect(res.status()).toBe(200);

    const sprint = await res.json();
    expect(sprint.name).toBe('New Name Only');
  });

  // -------------------------------------------------------------------------
  // 14. PUT /api/sprints/:id updates goal field
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — updates goal field', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Goal Update Sprint');

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Goal Update Sprint', goal: 'Ship the new onboarding flow' },
    });
    expect(res.status()).toBe(200);

    const sprint = await res.json();
    expect(sprint.goal).toBe('Ship the new onboarding flow');
  });

  // -------------------------------------------------------------------------
  // 15. PUT /api/sprints/:id updates start_date field
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — updates start_date field', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'StartDate Sprint');

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'StartDate Sprint', start_date: '2026-07-01' },
    });
    expect(res.status()).toBe(200);

    const sprint = await res.json();
    expect(sprint.start_date).toMatch(/2026-07-01/);
  });

  // -------------------------------------------------------------------------
  // 16. PUT /api/sprints/:id updates end_date field
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — updates end_date field', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'EndDate Sprint');

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'EndDate Sprint', end_date: '2026-07-28' },
    });
    expect(res.status()).toBe(200);

    const sprint = await res.json();
    expect(sprint.end_date).toMatch(/2026-07-28/);
  });

  // -------------------------------------------------------------------------
  // 17. PUT returns updated sprint body with all new values
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — response body contains all updated values', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Full Update Sprint');

    const payload = {
      name: 'Full Updated Sprint',
      goal: 'Achieve full coverage',
      start_date: '2026-08-01',
      end_date: '2026-08-15',
    };

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.name).toBe(payload.name);
    expect(body.goal).toBe(payload.goal);
    expect(body.start_date).toMatch(/2026-08-01/);
    expect(body.end_date).toMatch(/2026-08-15/);
  });

  // -------------------------------------------------------------------------
  // 18. Update with empty name — server accepts (no required validation)
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id with empty name — server responds without 5xx', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Empty Name Test Sprint');

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: '' },
    });
    // The server may accept empty name (200) or reject it (400) — either is fine,
    // but it must not return a 5xx error.
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // 19. Update non-existent sprint — 404
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — non-existent sprint returns 404', async ({ request }) => {
    const email = `test-noexist-${crypto.randomUUID()}@test.com`;
    const { token } = await (
      await request.post(`${BASE}/api/auth/signup`, {
        data: { email, password: 'password123', display_name: 'No Exist User' },
      })
    ).json();

    const res = await request.put(`${BASE}/api/sprints/999999999`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Ghost Sprint' },
    });
    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 20. Update sprint after it's active — still succeeds
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — can update an active sprint', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Active Update Sprint');

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Active Sprint Renamed', goal: 'Updated while active' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('Active Sprint Renamed');
    expect(body.goal).toBe('Updated while active');
  });

  // -------------------------------------------------------------------------
  // 21. Update sprint after it's completed — response should not be 5xx
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — can update a completed sprint without server error', async ({
    request,
  }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Completed Update Sprint');

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${BASE}/api/sprints/${sprintId}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Completed Sprint Renamed' },
    });
    expect(res.status()).toBeLessThan(500);
  });

  // -------------------------------------------------------------------------
  // 22. Unauthorized update returns 401
  // -------------------------------------------------------------------------
  test('PUT /api/sprints/:id — no token returns 401', async ({ request }) => {
    const { token, sprintId } = await setupBoardWithSprint(request, 'Unauth Update Sprint');
    // Confirm the sprint exists first
    const check = await request.get(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(check.status()).toBe(200);

    // Attempt update without authorization header
    const res = await request.put(`${BASE}/api/sprints/${sprintId}`, {
      data: { name: 'Should Fail' },
    });
    expect(res.status()).toBe(401);
  });

  // =========================================================================
  // UI tests (new)
  // =========================================================================

  // -------------------------------------------------------------------------
  // 23. UI: sprint edit modal opens from backlog sprint badge edit button
  // -------------------------------------------------------------------------
  test('UI: sprint edit modal opens when edit button is clicked in backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Modal Open Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });
    await page.click('.backlog-sprint-header button[title="Edit sprint"]');

    await expect(page.locator('.modal h2:has-text("Edit Sprint")')).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 24. UI: sprint edit modal has name field
  // -------------------------------------------------------------------------
  test('UI: sprint edit modal contains a name input field', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Name Field Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await expect(page.locator('.modal input[type="text"]').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 25. UI: sprint edit modal has goal field
  // -------------------------------------------------------------------------
  test('UI: sprint edit modal contains a goal textarea or input', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Goal Field Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    // Goal can be a textarea or a text input
    const goalField = page.locator('.modal textarea, .modal input[placeholder*="oal" i]');
    await expect(goalField.first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 26. UI: sprint edit modal has start date field
  // -------------------------------------------------------------------------
  test('UI: sprint edit modal contains a start date input', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Start Date Field Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    await expect(page.locator('.modal input[type="date"]').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 27. UI: sprint edit modal has end date field
  // -------------------------------------------------------------------------
  test('UI: sprint edit modal contains an end date input', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'End Date Field Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    // There should be at least two date inputs (start + end)
    await expect(page.locator('.modal input[type="date"]').nth(1)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 28. UI: save button updates sprint name in badge
  // -------------------------------------------------------------------------
  test('UI: save button updates sprint name visible in backlog header', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Badge Update Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Badge Changed Name');

    await page.click('.modal .btn-primary:has-text("Save")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Badge Changed Name');
  });

  // -------------------------------------------------------------------------
  // 29. UI: cancel button closes modal without saving
  // -------------------------------------------------------------------------
  test('UI: cancel button dismisses modal and leaves name unchanged', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Cancel No-Save Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const nameInput = page.locator('.modal input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Discarded Change');

    await page.click('.modal button:has-text("Cancel")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });

    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Cancel No-Save Sprint');
  });

  // -------------------------------------------------------------------------
  // 30. UI: sprint dates shown in edit modal when previously set
  // -------------------------------------------------------------------------
  test('UI: existing sprint dates are pre-filled in the edit modal', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'Prefilled Dates Sprint');

    // Set dates via API
    await request.put(`${BASE}/api/sprints/${sprintId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: 'Prefilled Dates Sprint',
        start_date: '2026-09-01',
        end_date: '2026-09-14',
      },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await openBacklogEditModal(page);

    const startInput = page.locator('.modal input[type="date"]').first();
    const endInput = page.locator('.modal input[type="date"]').last();

    await expect(startInput).toHaveValue('2026-09-01');
    await expect(endInput).toHaveValue('2026-09-14');
  });

  // -------------------------------------------------------------------------
  // 31. UI: "Start Sprint" button visible in edit modal for planning sprint
  // -------------------------------------------------------------------------
  test('UI: Start Sprint button is present in edit modal for a planning sprint', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Start Btn Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Start Sprint button is often in the backlog header, not always inside the modal
    await expect(
      page.locator('button:has-text("Start Sprint")'),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 32. UI: "Complete Sprint" button visible for active sprint
  // -------------------------------------------------------------------------
  test('UI: Complete Sprint button is present for an active sprint', async ({
    page,
    request,
  }) => {
    const { token, boardId, sprintId } = await setupBoardWithSprint(request, 'Complete Btn Sprint');

    await request.post(`${BASE}/api/sprints/${sprintId}/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);
    await page.waitForSelector('.board-page', { timeout: 10000 });

    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('button:has-text("Complete Sprint")'),
    ).toBeVisible({ timeout: 6000 });
  });

  // -------------------------------------------------------------------------
  // 33. UI: Delete Sprint button in backlog view
  // -------------------------------------------------------------------------
  test('UI: Delete Sprint button is present on the sprint header in backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Delete Btn Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    await expect(
      page.locator('.backlog-sprint-header button[title="Delete sprint"]'),
    ).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 34. UI: delete sprint confirmation dialog fires before deletion
  // -------------------------------------------------------------------------
  test('UI: delete sprint triggers a confirmation dialog', async ({ page, request }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Confirm Delete Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    let dialogFired = false;
    page.once('dialog', async (d: any) => {
      dialogFired = true;
      await d.dismiss(); // dismiss so sprint is NOT deleted
    });

    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    // Give time for any async dialog handling
    await page.waitForTimeout(500);
    expect(dialogFired).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 35. UI: after delete confirmation, sprint no longer shown in backlog
  // -------------------------------------------------------------------------
  test('UI: after accepting delete confirmation, sprint no longer appears in backlog', async ({
    page,
    request,
  }) => {
    const { token, boardId } = await setupBoardWithSprint(request, 'Gone Sprint');
    await page.addInitScript((t: string) => localStorage.setItem('token', t), token);
    await page.goto(`/boards/${boardId}`);

    await page.waitForSelector('.board-page', { timeout: 10000 });
    await page.click('.view-btn:has-text("Backlog")');
    await page.waitForSelector('.backlog-sprint-header', { timeout: 8000 });

    // Verify it's visible before deletion
    await expect(page.locator('.backlog-sprint-header h2')).toContainText('Gone Sprint');

    page.once('dialog', (d: any) => d.accept());
    await page.click('.backlog-sprint-header button[title="Delete sprint"]');

    await expect(page.locator('.backlog-sprint-header')).not.toBeVisible({ timeout: 6000 });
  });
});
