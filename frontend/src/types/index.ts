export interface User {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export type BoardRole = 'admin' | 'member' | 'viewer';

export type RepoSource = 'default_gitea' | 'custom_gitea' | 'github';

export interface Board {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  columns: Column[];
  swimlanes: Swimlane[];
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  state: string;
}

export interface Swimlane {
  id: number;
  board_id: number;
  name: string;
  repo_source: RepoSource;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  designator: string;
  position: number;
  color: string;
}

export interface Sprint {
  id: number;
  board_id: number;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  status: 'planning' | 'active' | 'completed';
  created_at: string;
  updated_at: string;
}

export type IssueType = 'epic' | 'story' | 'task' | 'subtask';

export interface Card {
  id: number;
  board_id: number;
  swimlane_id: number;
  column_id: number;
  sprint_id: number | null;
  parent_id: number | null;
  issue_type: IssueType;
  gitea_issue_id: number;
  title: string;
  description: string;
  state: string;
  story_points: number | null;
  priority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
  due_date: string | null;
  time_estimate: number | null;
  position: number;
  labels: Label[];
  assignees: User[];
  children?: Card[];
  created_at: string;
  updated_at: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface SprintMetrics {
  sprint_id: number;
  date: string;
  total_points: number;
  completed_points: number;
  remaining_points: number;
  total_cards: number;
  completed_cards: number;
}

export interface VelocityPoint {
  sprint_name: string;
  completed_points: number;
  total_points: number;
}

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    id: number;
    login: string;
  };
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Comment {
  id: number;
  card_id: number;
  user_id: number;
  parent_comment_id?: number | null;
  body: string;
  user?: {
    id: number;
    email: string;
    display_name: string;
    avatar_url: string;
  };
  attachments?: Attachment[];
  replies?: Comment[];
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: number;
  card_id: number;
  user_id: number;
  filename: string;
  size: number;
  mime_type: string;
  user?: {
    id: number;
    email: string;
    display_name: string;
    avatar_url: string;
  };
  created_at: string;
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

export interface CustomFieldDefinition {
  id: number;
  board_id: number;
  name: string;
  field_type: CustomFieldType;
  options: string; // JSON array for select options
  required: boolean;
  position: number;
  created_at: string;
}

export interface CustomFieldValue {
  id: number;
  card_id: number;
  field_id: number;
  value: string;
  created_at: string;
  updated_at: string;
}

export type NotificationType = 'assignment' | 'mention' | 'update' | 'comment';

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export interface WorkLog {
  id: number;
  card_id: number;
  user_id: number;
  user?: User;
  time_spent: number; // in minutes
  date: string;
  notes: string;
}

export interface WorkLogsResponse {
  work_logs: WorkLog[];
  total_logged: number; // total minutes logged
  time_estimate: number | null; // estimated minutes
}

export interface UserCredential {
  id: number;
  provider: 'gitea' | 'github';
  provider_url: string;
  display_name: string;
  has_token: boolean;
  created_at: string;
}

export interface SavedFilter {
  id: number;
  board_id: number;
  owner_id: number;
  name: string;
  filter_json: string;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface CardSearchResult {
  cards: Card[];
  total: number;
}

export interface BoardMember {
  id: number;
  board_id: number;
  user_id: number;
  role: string;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  board_id: number;
  card_id: number | null;
  user_id: number;
  user?: User;
  action: string;
  entity_type: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  created_at: string;
}

export interface GiteaUser {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
}

export interface GiteaMilestone {
  id: number;
  title: string;
  description: string;
  state: string;
  due_on: string;
}

export type LinkType = 'blocks' | 'is_blocked_by' | 'relates_to' | 'duplicates';

export interface CardLink {
  id: number;
  source_card_id: number;
  target_card_id: number;
  link_type: LinkType;
  created_by: number;
  created_at: string;
  source_card?: Card;
  target_card?: Card;
}

export interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Label[];
  assignees: GiteaUser[];
  milestone: GiteaMilestone | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardCardWithBoard extends Card {
  board_name: string;
}

export interface DashboardSprintWithProgress extends Sprint {
  total_cards: number;
  completed_cards: number;
  total_points: number;
  completed_points: number;
  board_name: string;
}

export interface DashboardResponse {
  boards: Board[];
  my_cards: DashboardCardWithBoard[];
  active_sprints: DashboardSprintWithProgress[];
}
