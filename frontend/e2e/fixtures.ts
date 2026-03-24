/**
 * Custom Playwright fixtures for Zira E2E tests.
 *
 * Re-exports `test` and `expect` so spec files can use:
 *   import { test, expect } from '../fixtures';
 *
 * Existing tests that import from '@playwright/test' directly are unaffected.
 *
 * Fixtures provided
 * -----------------
 * authenticatedPage
 *   A browser page with a valid JWT token injected into localStorage.
 *   The user is created and logged in via API — no UI forms are used.
 *
 * boardContext
 *   Extends authenticatedPage with a pre-created board and one swimlane.
 *   The browser is navigated to /boards/:id before the test begins.
 *   Provides: { page, token, board, swimlane, columns }
 *
 * cardContext
 *   Extends boardContext with a pre-created card in the first column.
 *   Provides: { page, token, board, swimlane, columns, card }
 */

import { test as base, expect, Page } from '@playwright/test';
import * as api from './helpers/api';

// Re-export expect so spec files can import it from here.
export { expect };

// ---------------------------------------------------------------------------
// Fixture type declarations
// ---------------------------------------------------------------------------

interface AuthenticatedPageFixture {
  /** A page that has a valid JWT token set in localStorage. */
  authenticatedPage: {
    page: Page;
    token: string;
    user: api.ApiUser;
  };
}

interface BoardContextFixture {
  /**
   * A ready-to-use board context:
   *   - Authenticated page (token in localStorage)
   *   - Pre-created board with default Kanban columns
   *   - Pre-created swimlane
   *   - Browser navigated to /boards/:id
   */
  boardContext: {
    page: Page;
    token: string;
    user: api.ApiUser;
    board: api.ApiBoard;
    swimlane: api.ApiSwimlane;
    columns: api.ApiColumn[];
  };
}

interface CardContextFixture {
  /**
   * Extends boardContext with a pre-created card in the first column.
   */
  cardContext: {
    page: Page;
    token: string;
    user: api.ApiUser;
    board: api.ApiBoard;
    swimlane: api.ApiSwimlane;
    columns: api.ApiColumn[];
    card: api.ApiCard;
  };
}

type ZiraFixtures = AuthenticatedPageFixture & BoardContextFixture & CardContextFixture;

// ---------------------------------------------------------------------------
// Fixture implementations
// ---------------------------------------------------------------------------

export const test = base.extend<ZiraFixtures>({
  // -------------------------------------------------------------------------
  // authenticatedPage
  // -------------------------------------------------------------------------
  authenticatedPage: async ({ page, request }, use) => {
    const email = api.randomEmail();
    const password = 'password123';

    // Sign up via API — never touch the UI form for setup.
    const { token, user } = await api.signup(request, {
      email,
      password,
      displayName: 'Test User',
    });

    // Inject the token into localStorage before any navigation so the React
    // app picks it up on the first render.
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    // Navigate to a neutral authenticated page to initialise the app.
    await page.goto('/dashboard');

    await use({ page, token, user });
  },

  // -------------------------------------------------------------------------
  // boardContext
  // -------------------------------------------------------------------------
  boardContext: async ({ page, request }, use) => {
    const email = api.randomEmail();
    const password = 'password123';

    // Create and log in the user via API.
    const { token, user } = await api.signup(request, {
      email,
      password,
      displayName: 'Board Test User',
    });

    // Create board via API.
    const { board } = await api.createBoard(request, token, {
      name: `Test Board ${crypto.randomUUID().slice(0, 8)}`,
      description: 'Created by boardContext fixture',
    });

    // Create a swimlane via API.
    const { swimlane } = await api.createSwimlane(request, token, board.id, {
      name: 'Test Swimlane',
      designator: 'TEST-',
      color: '#6366f1',
    });

    // Fetch the real column IDs created by the board template.
    const { columns } = await api.getBoardColumns(request, token, board.id);

    // Inject token into localStorage before navigation.
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    // Navigate directly to the board.
    await page.goto(`/boards/${board.id}`);

    await use({ page, token, user, board, swimlane, columns });
  },

  // -------------------------------------------------------------------------
  // cardContext
  // -------------------------------------------------------------------------
  cardContext: async ({ page, request }, use) => {
    const email = api.randomEmail();
    const password = 'password123';

    // Create and log in the user via API.
    const { token, user } = await api.signup(request, {
      email,
      password,
      displayName: 'Card Test User',
    });

    // Create board via API.
    const { board } = await api.createBoard(request, token, {
      name: `Card Test Board ${crypto.randomUUID().slice(0, 8)}`,
      description: 'Created by cardContext fixture',
    });

    // Create a swimlane via API.
    const { swimlane } = await api.createSwimlane(request, token, board.id, {
      name: 'Test Swimlane',
      designator: 'CARD-',
      color: '#6366f1',
    });

    // Fetch the real column IDs.
    const { columns } = await api.getBoardColumns(request, token, board.id);

    // Use the first column to place the card.
    const firstColumn = columns[0];

    // Create card via API.
    const { card } = await api.createCard(request, token, {
      title: 'Test Card',
      columnId: firstColumn.id,
      swimlaneId: swimlane.id,
      boardId: board.id,
    });

    // Inject token into localStorage before navigation.
    await page.addInitScript((t: string) => {
      localStorage.setItem('token', t);
    }, token);

    // Navigate directly to the board.
    await page.goto(`/boards/${board.id}`);

    await use({ page, token, user, board, swimlane, columns, card });
  },
});
