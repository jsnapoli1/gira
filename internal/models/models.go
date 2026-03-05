package models

import "time"

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	DisplayName  string    `json:"display_name"`
	AvatarURL    string    `json:"avatar_url"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Board struct {
	ID          int64       `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	OwnerID     int64       `json:"owner_id"`
	Columns     []Column    `json:"columns"`
	Swimlanes   []Swimlane  `json:"swimlanes"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
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
	RepoOwner  string `json:"repo_owner"`
	RepoName   string `json:"repo_name"`
	Designator string `json:"designator"` // Prefix for cards in this lane (e.g., "PROJ-")
	Position   int    `json:"position"`
	Color      string `json:"color"`
}

type Sprint struct {
	ID          int64      `json:"id"`
	BoardID     int64      `json:"board_id"`
	Name        string     `json:"name"`
	Goal        string     `json:"goal"`
	StartDate   *time.Time `json:"start_date"`
	EndDate     *time.Time `json:"end_date"`
	Status      string     `json:"status"` // planning, active, completed
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Card struct {
	ID           int64      `json:"id"`
	BoardID      int64      `json:"board_id"`
	SwimlaneID   int64      `json:"swimlane_id"`
	ColumnID     int64      `json:"column_id"`
	SprintID     *int64     `json:"sprint_id"`
	ParentID     *int64     `json:"parent_id"`     // Parent card ID for hierarchy
	IssueType    string     `json:"issue_type"`    // epic, story, task, subtask
	GiteaIssueID int64      `json:"gitea_issue_id"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	State        string     `json:"state"`
	StoryPoints  *int       `json:"story_points"`
	Priority     string     `json:"priority"` // highest, high, medium, low, lowest
	DueDate      *time.Time `json:"due_date"`
	TimeEstimate *int       `json:"time_estimate"` // in minutes
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
	SprintID           int64     `json:"sprint_id"`
	Date               time.Time `json:"date"`
	TotalPoints        int       `json:"total_points"`
	CompletedPoints    int       `json:"completed_points"`
	RemainingPoints    int       `json:"remaining_points"`
	TotalCards         int       `json:"total_cards"`
	CompletedCards     int       `json:"completed_cards"`
}

type WorkItem struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
	UserID    int64     `json:"user_id"`
	TimeSpent int       `json:"time_spent"` // in minutes
	Date      time.Time `json:"date"`
	Notes     string    `json:"notes"`
}

// Comment represents a comment on a card (local, not from Gitea)
type Comment struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
	UserID    int64     `json:"user_id"`
	User      *User     `json:"user,omitempty"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Attachment represents a file attached to a card
type Attachment struct {
	ID        int64     `json:"id"`
	CardID    int64     `json:"card_id"`
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
	Type      string    `json:"type"`    // assignment, mention, update, comment
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Link      string    `json:"link"`    // URL to navigate to
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"created_at"`
}
