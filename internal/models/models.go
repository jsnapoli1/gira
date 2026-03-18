package models

import "time"

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	DisplayName  string    `json:"display_name"`
	AvatarURL    string    `json:"avatar_url"`
	IsAdmin      bool      `json:"is_admin"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// BoardRole represents a user's role on a board
type BoardRole string

const (
	BoardRoleAdmin  BoardRole = "admin"
	BoardRoleMember BoardRole = "member"
	BoardRoleViewer BoardRole = "viewer"
)

// CanEditBoard returns true if the role can edit board settings (admin only)
func (r BoardRole) CanEditBoard() bool {
	return r == BoardRoleAdmin
}

// CanEditCards returns true if the role can create/edit cards (admin + member)
func (r BoardRole) CanEditCards() bool {
	return r == BoardRoleAdmin || r == BoardRoleMember
}

// CanView returns true if the role can view the board (all roles)
func (r BoardRole) CanView() bool {
	return r == BoardRoleAdmin || r == BoardRoleMember || r == BoardRoleViewer
}

type Board struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	OwnerID     int64      `json:"owner_id"`
	Columns     []Column   `json:"columns"`
	Swimlanes   []Swimlane `json:"swimlanes"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Column struct {
	ID       int64  `json:"id"`
	BoardID  int64  `json:"board_id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
	State    string `json:"state"` // Maps to issue state (open, in_progress, closed, etc.)
}

type Swimlane struct {
	ID         int64  `json:"id"`
	BoardID    int64  `json:"board_id"`
	Name       string `json:"name"`
	RepoSource string `json:"repo_source"` // "default_gitea", "custom_gitea", "github"
	RepoURL    string `json:"repo_url"`    // Base URL (empty for default_gitea)
	RepoOwner  string `json:"repo_owner"`
	RepoName   string `json:"repo_name"`
	Designator string `json:"designator"` // Prefix for cards in this lane (e.g., "PROJ-")
	Position   int    `json:"position"`
	Color      string `json:"color"`
}

type Sprint struct {
	ID        int64      `json:"id"`
	BoardID   int64      `json:"board_id"`
	Name      string     `json:"name"`
	Goal      string     `json:"goal"`
	StartDate *time.Time `json:"start_date"`
	EndDate   *time.Time `json:"end_date"`
	Status    string     `json:"status"` // planning, active, completed
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type Card struct {
	ID           int64      `json:"id"`
	BoardID      int64      `json:"board_id"`
	SwimlaneID   int64      `json:"swimlane_id"`
	ColumnID     int64      `json:"column_id"`
	SprintID     *int64     `json:"sprint_id"`
	ParentID     *int64     `json:"parent_id"`  // Parent card ID for hierarchy
	IssueType    string     `json:"issue_type"` // epic, story, task, subtask
	GiteaIssueID int64      `json:"gitea_issue_id"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	State        string     `json:"state"`
	StoryPoints  *int       `json:"story_points"`
	Priority     string     `json:"priority"` // highest, high, medium, low, lowest
	DueDate      *time.Time `json:"due_date"`
	TimeEstimate *int       `json:"time_estimate"` // in minutes
	Position     float64    `json:"position"`
	Labels       []Label    `json:"labels"`
	Assignees    []User     `json:"assignees"`
	Children     []Card     `json:"children,omitempty"` // Child cards (for hierarchy display)
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type Label struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type BoardMember struct {
	ID        int64     `json:"id"`
	BoardID   int64     `json:"board_id"`
	UserID    int64     `json:"user_id"`
	Role      string    `json:"role"` // admin, member, viewer
	CreatedAt time.Time `json:"created_at"`
}

type SprintMetrics struct {
	SprintID        int64     `json:"sprint_id"`
	Date            time.Time `json:"date"`
	TotalPoints     int       `json:"total_points"`
	CompletedPoints int       `json:"completed_points"`
	RemainingPoints int       `json:"remaining_points"`
	TotalCards      int       `json:"total_cards"`
	CompletedCards  int       `json:"completed_cards"`
}

type WorkItem struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
	UserID    int64     `json:"user_id"`
	User      *User     `json:"user,omitempty"`
	TimeSpent int       `json:"time_spent"` // in minutes
	Date      time.Time `json:"date"`
	Notes     string    `json:"notes"`
}

// Comment represents a comment on a card (local, not from Gitea)
type Comment struct {
	ID              int64         `json:"id"`
	CardID          int64         `json:"card_id"`
	UserID          int64         `json:"user_id"`
	ParentCommentID *int64        `json:"parent_comment_id"`
	User            *User         `json:"user,omitempty"`
	Body            string        `json:"body"`
	Attachments     []*Attachment `json:"attachments,omitempty"`
	Replies         []Comment     `json:"replies,omitempty"`
	CreatedAt       time.Time     `json:"created_at"`
	UpdatedAt       time.Time     `json:"updated_at"`
}

// Attachment represents a file attached to a card
type Attachment struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
	CommentID *int64    `json:"comment_id,omitempty"`
	UserID    int64     `json:"user_id"`
	User      *User     `json:"user,omitempty"`
	Filename  string    `json:"filename"`
	Size      int64     `json:"size"`
	MimeType  string    `json:"mime_type"`
	StorePath string    `json:"-"` // Internal path, not exposed to API
	CreatedAt time.Time `json:"created_at"`
}

// CustomFieldDefinition defines a custom field for a board
type CustomFieldDefinition struct {
	ID        int64     `json:"id"`
	BoardID   int64     `json:"board_id"`
	Name      string    `json:"name"`
	FieldType string    `json:"field_type"` // text, number, date, select, checkbox
	Options   string    `json:"options"`    // JSON array for select field options
	Required  bool      `json:"required"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"created_at"`
}

// CustomFieldValue stores a custom field value for a card
type CustomFieldValue struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
	FieldID   int64     `json:"field_id"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Notification represents an in-app notification for a user
type Notification struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Type      string    `json:"type"` // assignment, mention, update, comment
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Link      string    `json:"link"` // URL to navigate to
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"created_at"`
}

// CardLink represents a link between two cards (blocks, is_blocked_by, relates_to, duplicates)
type CardLink struct {
	ID           int64     `json:"id"`
	SourceCardID int64     `json:"source_card_id"`
	TargetCardID int64     `json:"target_card_id"`
	LinkType     string    `json:"link_type"`
	CreatedBy    int64     `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
	// Populated for display
	SourceCard *Card `json:"source_card,omitempty"`
	TargetCard *Card `json:"target_card,omitempty"`
}

// ActivityLog records a change to a card or board entity
type ActivityLog struct {
	ID           int64     `json:"id"`
	BoardID      int64     `json:"board_id"`
	CardID       *int64    `json:"card_id"`
	UserID       int64     `json:"user_id"`
	User         *User     `json:"user,omitempty"`
	Action       string    `json:"action"`      // created, updated, moved, deleted, commented, assigned, unassigned
	EntityType   string    `json:"entity_type"` // card, comment, attachment
	FieldChanged string    `json:"field_changed"`
	OldValue     string    `json:"old_value"`
	NewValue     string    `json:"new_value"`
	CreatedAt    time.Time `json:"created_at"`
}

// SavedFilter represents a saved filter configuration for a board
type SavedFilter struct {
	ID         int64     `json:"id"`
	BoardID    int64     `json:"board_id"`
	OwnerID    int64     `json:"owner_id"`
	Name       string    `json:"name"`
	FilterJSON string    `json:"filter_json"`
	IsShared   bool      `json:"is_shared"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// UserCredential stores user-level API credentials for Gitea/GitHub
type UserCredential struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	Provider    string    `json:"provider"`     // "gitea" or "github"
	ProviderURL string    `json:"provider_url"` // Base URL (empty for GitHub)
	APIToken    string    `json:"-"`            // Never expose in JSON
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
