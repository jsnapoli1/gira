/**
 * Typed API seeding client for Playwright E2E tests.
 *
 * All functions use Playwright's APIRequestContext and hit the backend directly
 * (bypassing the Vite dev-server proxy) so they can be called from setup
 * fixtures without a running browser page.
 *
 * Base URL resolution order:
 *   1. PLAYWRIGHT_BASE_URL env var
 *   2. http://localhost:5173  (Vite default)
 *
 * API calls go to /api/* which the Vite proxy forwards to the backend.
 */

import { APIRequestContext, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Response shape interfaces
// ---------------------------------------------------------------------------

export interface ApiUser {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
}

export interface ApiBoard {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  columns: ApiColumn[];
  swimlanes: ApiSwimlane[];
  created_at: string;
  updated_at: string;
}

export interface ApiColumn {
  id: number;
  board_id: number;
  name: string;
  position: number;
  state: string;
}

export interface ApiSwimlane {
  id: number;
  board_id: number;
  name: string;
  repo_source: string;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  designator: string;
  position: number;
  color: string;
  label: string;
}

export interface ApiCard {
  id: number;
  board_id: number;
  swimlane_id: number;
  column_id: number;
  sprint_id: number | null;
  parent_id: number | null;
  issue_type: string;
  gitea_issue_id: number;
  title: string;
  description: string;
  state: string;
  story_points: number | null;
  priority: string;
  due_date: string | null;
  time_estimate: number | null;
  position: number;
  labels: ApiLabel[];
  assignees: ApiUser[];
  created_at: string;
  updated_at: string;
}

export interface ApiSprint {
  id: number;
  board_id: number;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ApiLabel {
  id: number;
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Request payload interfaces
// ---------------------------------------------------------------------------

export interface SignupData {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface CreateBoardData {
  name: string;
  description?: string;
}

export interface CreateSwimlaneData {
  name: string;
  repo?: string;
  designator?: string;
  color?: string;
}

export interface CreateCardData {
  title: string;
  columnId: number;
  swimlaneId: number;
  boardId: number;
}

export interface CreateSprintData {
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

export interface CreateLabelData {
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the base URL for API calls.
 * Reads PLAYWRIGHT_BASE_URL first, falls back to http://localhost:5173.
 */
function baseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
}

/**
 * Returns a random unique email address using crypto.randomUUID().
 */
export function randomEmail(): string {
  return `test-${crypto.randomUUID()}@example.com`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Creates a new user account via POST /api/auth/signup.
 */
export async function signup(
  request: APIRequestContext,
  data: SignupData,
): Promise<AuthResponse> {
  const response = await request.post(`${baseUrl()}/api/auth/signup`, {
    data: {
      email: data.email,
      password: data.password,
      display_name: data.displayName,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<AuthResponse>;
}

/**
 * Logs in an existing user via POST /api/auth/login.
 */
export async function login(
  request: APIRequestContext,
  data: LoginData,
): Promise<AuthResponse> {
  const response = await request.post(`${baseUrl()}/api/auth/login`, {
    data: {
      email: data.email,
      password: data.password,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<AuthResponse>;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/**
 * Creates a new board via POST /api/boards.
 */
export async function createBoard(
  request: APIRequestContext,
  token: string,
  data: CreateBoardData,
): Promise<{ board: ApiBoard }> {
  const response = await request.post(`${baseUrl()}/api/boards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: data.name,
      description: data.description ?? '',
    },
  });
  expect(response.ok()).toBeTruthy();
  const board = (await response.json()) as ApiBoard;
  return { board };
}

/**
 * Fetches all columns for a board via GET /api/boards/:id/columns.
 */
export async function getBoardColumns(
  request: APIRequestContext,
  token: string,
  boardId: number,
): Promise<{ columns: ApiColumn[] }> {
  const response = await request.get(
    `${baseUrl()}/api/boards/${boardId}/columns`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  const columns = (await response.json()) as ApiColumn[];
  return { columns };
}

// ---------------------------------------------------------------------------
// Swimlanes
// ---------------------------------------------------------------------------

/**
 * Creates a swimlane on a board via POST /api/boards/:id/swimlanes.
 */
export async function createSwimlane(
  request: APIRequestContext,
  token: string,
  boardId: number,
  data: CreateSwimlaneData,
): Promise<{ swimlane: ApiSwimlane }> {
  const response = await request.post(
    `${baseUrl()}/api/boards/${boardId}/swimlanes`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: data.name,
        repo_source: 'default_gitea',
        repo_owner: '',
        repo_name: data.repo ?? '',
        designator: data.designator ?? '',
        color: data.color ?? '#6366f1',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const swimlane = (await response.json()) as ApiSwimlane;
  return { swimlane };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Creates a card via POST /api/cards.
 */
export async function createCard(
  request: APIRequestContext,
  token: string,
  data: CreateCardData,
): Promise<{ card: ApiCard }> {
  const response = await request.post(`${baseUrl()}/api/cards`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      board_id: data.boardId,
      swimlane_id: data.swimlaneId,
      column_id: data.columnId,
      title: data.title,
    },
  });
  expect(response.ok()).toBeTruthy();
  const card = (await response.json()) as ApiCard;
  return { card };
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

/**
 * Creates a sprint via POST /api/sprints?board_id=:id.
 */
export async function createSprint(
  request: APIRequestContext,
  token: string,
  boardId: number,
  data: CreateSprintData,
): Promise<{ sprint: ApiSprint }> {
  const response = await request.post(
    `${baseUrl()}/api/sprints?board_id=${boardId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: data.name,
        goal: data.goal ?? '',
        start_date: data.startDate ?? '',
        end_date: data.endDate ?? '',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const sprint = (await response.json()) as ApiSprint;
  return { sprint };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Creates a label on a board via POST /api/boards/:id/labels.
 */
export async function createLabel(
  request: APIRequestContext,
  token: string,
  boardId: number,
  data: CreateLabelData,
): Promise<{ label: ApiLabel }> {
  const response = await request.post(
    `${baseUrl()}/api/boards/${boardId}/labels`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: data.name,
        color: data.color,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const label = (await response.json()) as ApiLabel;
  return { label };
}
