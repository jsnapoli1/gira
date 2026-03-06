const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  // Handle empty responses (204 No Content, or empty body with 200/201)
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text);
}

// Auth
export const auth = {
  signup: (email: string, password: string, displayName: string) =>
    request<{ user: any; token: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    }),

  login: (email: string, password: string) =>
    request<{ user: any; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<any>('/auth/me'),
};

// Config
export const config = {
  getStatus: () => request<{ configured: boolean; gitea_url: string }>('/config/status'),
  save: (giteaUrl: string, giteaApiKey: string) =>
    request('/config', {
      method: 'POST',
      body: JSON.stringify({ gitea_url: giteaUrl, gitea_api_key: giteaApiKey }),
    }),
};

// Boards
export const boards = {
  list: () => request<any[]>('/boards'),
  get: (id: number) => request<any>(`/boards/${id}`),
  create: (name: string, description: string) =>
    request<any>('/boards', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  update: (id: number, name: string, description: string) =>
    request<any>(`/boards/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    }),
  delete: (id: number) =>
    request(`/boards/${id}`, { method: 'DELETE' }),

  // Swimlanes
  getSwimlanes: (boardId: number) => request<any[]>(`/boards/${boardId}/swimlanes`),
  addSwimlane: (boardId: number, data: {
    name: string;
    repo_source?: 'default_gitea' | 'custom_gitea' | 'github';
    repo_url?: string;
    repo_owner: string;
    repo_name: string;
    designator: string;
    color?: string;
    api_token?: string;
  }) =>
    request<any>(`/boards/${boardId}/swimlanes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Columns
  getColumns: (boardId: number) => request<any[]>(`/boards/${boardId}/columns`),
  addColumn: (boardId: number, name: string, state: string) =>
    request<any>(`/boards/${boardId}/columns`, {
      method: 'POST',
      body: JSON.stringify({ name, state }),
    }),
  deleteColumn: (boardId: number, columnId: number) =>
    request(`/boards/${boardId}/columns/${columnId}`, { method: 'DELETE' }),
  reorderColumn: (boardId: number, columnId: number, newPosition: number) =>
    request(`/boards/${boardId}/columns/${columnId}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ position: newPosition }),
    }),

  // Swimlane delete
  deleteSwimlane: (boardId: number, swimlaneId: number) =>
    request(`/boards/${boardId}/swimlanes/${swimlaneId}`, { method: 'DELETE' }),

  // Cards
  getCards: (boardId: number) => request<any[]>(`/boards/${boardId}/cards`),

  // Members
  getMembers: (boardId: number) => request<any[]>(`/boards/${boardId}/members`),
  addMember: (boardId: number, userId: number, role: string) =>
    request(`/boards/${boardId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    }),
  removeMember: (boardId: number, userId: number) =>
    request(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),

  // Labels
  getLabels: (boardId: number) => request<any[]>(`/boards/${boardId}/labels`),
  createLabel: (boardId: number, name: string, color: string) =>
    request<any>(`/boards/${boardId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  updateLabel: (boardId: number, labelId: number, name: string, color: string) =>
    request(`/boards/${boardId}/labels/${labelId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, color }),
    }),
  deleteLabel: (boardId: number, labelId: number) =>
    request(`/boards/${boardId}/labels/${labelId}`, { method: 'DELETE' }),

  // Custom Fields
  getCustomFields: (boardId: number) => request<any[]>(`/boards/${boardId}/custom-fields`),
  createCustomField: (boardId: number, name: string, fieldType: string, options: string, required: boolean) =>
    request<any>(`/boards/${boardId}/custom-fields`, {
      method: 'POST',
      body: JSON.stringify({ name, field_type: fieldType, options, required }),
    }),
  updateCustomField: (boardId: number, fieldId: number, name: string, fieldType: string, options: string, required: boolean) =>
    request<any>(`/boards/${boardId}/custom-fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, field_type: fieldType, options, required }),
    }),
  deleteCustomField: (boardId: number, fieldId: number) =>
    request(`/boards/${boardId}/custom-fields/${fieldId}`, { method: 'DELETE' }),
};

// Sprints
export const sprints = {
  list: (boardId: number) => request<any[]>(`/sprints?board_id=${boardId}`),
  get: (id: number) => request<any>(`/sprints/${id}`),
  create: (boardId: number, name: string, goal: string, startDate?: string, endDate?: string) =>
    request<any>(`/sprints?board_id=${boardId}`, {
      method: 'POST',
      body: JSON.stringify({ name, goal, start_date: startDate, end_date: endDate }),
    }),
  update: (id: number, data: { name?: string; goal?: string; status?: string; start_date?: string; end_date?: string }) =>
    request<any>(`/sprints/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: number) =>
    request(`/sprints/${id}`, { method: 'DELETE' }),
  start: (id: number) =>
    request(`/sprints/${id}/start`, { method: 'POST' }),
  complete: (id: number) =>
    request(`/sprints/${id}/complete`, { method: 'POST' }),
  getCards: (id: number) => request<any[]>(`/sprints/${id}/cards`),
  getMetrics: (id: number) => request<any[]>(`/sprints/${id}/metrics`),
};

// Cards
export const cards = {
  create: (data: {
    board_id: number;
    swimlane_id: number;
    column_id: number;
    sprint_id?: number | null;
    parent_id?: number | null;
    issue_type?: string;
    title: string;
    description: string;
    story_points?: number | null;
    priority?: string;
  }) =>
    request<any>('/cards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: number) => request<any>(`/cards/${id}`),
  update: (id: number, data: { title: string; description: string; story_points?: number | null; priority?: string; due_date?: string | null; time_estimate?: number | null; parent_id?: number | null; issue_type?: string }) =>
    request<any>(`/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getChildren: (id: number) => request<any[]>(`/cards/${id}/children`),
  delete: (id: number) =>
    request(`/cards/${id}`, { method: 'DELETE' }),
  move: (id: number, columnId: number, state: string) =>
    request(`/cards/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ column_id: columnId, state }),
    }),
  assignToSprint: (id: number, sprintId: number | null) =>
    request(`/cards/${id}/assign-sprint`, {
      method: 'POST',
      body: JSON.stringify({ sprint_id: sprintId }),
    }),
  addAssignee: (id: number, userId: number) =>
    request(`/cards/${id}/assignees`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  removeAssignee: (id: number, userId: number) =>
    request(`/cards/${id}/assignees/${userId}`, { method: 'DELETE' }),
  getAssignees: (id: number) => request<any[]>(`/cards/${id}/assignees`),
  getComments: (id: number) => request<any[]>(`/cards/${id}/comments`),
  addComment: (id: number, body: string) =>
    request<any>(`/cards/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  getLabels: (id: number) => request<any[]>(`/cards/${id}/labels`),
  addLabel: (id: number, labelId: number) =>
    request(`/cards/${id}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_id: labelId }),
    }),
  removeLabel: (id: number, labelId: number) =>
    request(`/cards/${id}/labels/${labelId}`, { method: 'DELETE' }),
  getAttachments: (id: number) => request<any[]>(`/cards/${id}/attachments`),
  uploadAttachment: async (id: number, file: File) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/api/cards/${id}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Upload failed: ${response.status}`);
    }
    return response.json();
  },
  deleteAttachment: (cardId: number, attachmentId: number) =>
    request(`/cards/${cardId}/attachments/${attachmentId}`, { method: 'DELETE' }),

  // Custom Field Values
  getCustomFieldValues: (cardId: number) => request<any[]>(`/cards/${cardId}/custom-fields`),
  setCustomFieldValue: (cardId: number, fieldId: number, value: string) =>
    request<any>(`/cards/${cardId}/custom-fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deleteCustomFieldValue: (cardId: number, fieldId: number) =>
    request(`/cards/${cardId}/custom-fields/${fieldId}`, { method: 'DELETE' }),

  // Work Logs (Time Tracking)
  getWorkLogs: (cardId: number) =>
    request<{ work_logs: any[]; total_logged: number; time_estimate: number | null }>(`/cards/${cardId}/worklogs`),
  addWorkLog: (cardId: number, data: { time_spent: number; date: string; notes: string }) =>
    request<{ work_logs: any[]; total_logged: number; time_estimate: number | null }>(`/cards/${cardId}/worklogs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteWorkLog: (cardId: number, worklogId: number) =>
    request(`/cards/${cardId}/worklogs/${worklogId}`, { method: 'DELETE' }),
};

// Metrics
export const metrics = {
  burndown: (sprintId: number) => request<any[]>(`/metrics/burndown?sprint_id=${sprintId}`),
  velocity: (boardId: number) => request<any[]>(`/metrics/velocity?board_id=${boardId}`),
};

// Repos (supports multiple sources)
export const repos = {
  getRepos: (source?: 'default_gitea' | 'custom_gitea' | 'github', token?: string, url?: string) => {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (token) params.set('token', token);
    if (url) params.set('url', url);
    const query = params.toString();
    return request<any[]>(`/repos${query ? `?${query}` : ''}`);
  },
  getIssues: (owner: string, repo: string) => request<any[]>(`/issues?owner=${owner}&repo=${repo}`),
};

// Backwards compatibility alias
export const gitea = repos;

// Users
export const users = {
  list: () => request<any[]>('/users'),
};

// Notifications
export const notifications = {
  list: (limit?: number) => request<{ notifications: any[]; unread_count: number }>(`/notifications${limit ? `?limit=${limit}` : ''}`),
  markRead: (id: number) => request<any>(`/notifications/${id}`, { method: 'PUT' }),
  markAllRead: () => request<void>('/notifications?action=mark-all-read', { method: 'POST' }),
  delete: (id: number) => request<void>(`/notifications/${id}`, { method: 'DELETE' }),
};

// Admin
export const admin = {
  listUsers: () => request<any[]>('/admin/users'),
  setUserAdmin: (userId: number, isAdmin: boolean) =>
    request<any>('/admin/users', {
      method: 'PUT',
      body: JSON.stringify({ user_id: userId, is_admin: isAdmin }),
    }),
};

// User Credentials
export const credentials = {
  list: () => request<any[]>('/user/credentials'),
  create: (data: { provider: string; provider_url?: string; api_token: string; display_name?: string }) =>
    request<any>('/user/credentials', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { api_token?: string; display_name?: string }) =>
    request<any>(`/user/credentials/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request(`/user/credentials/${id}`, { method: 'DELETE' }),
  test: (data: { provider: string; provider_url?: string; api_token: string }) =>
    request<{ success: boolean; message: string }>('/user/credentials/test', { method: 'POST', body: JSON.stringify(data) }),
};
