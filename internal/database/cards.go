package database

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

type CreateCardInput struct {
	BoardID      int64
	SwimlaneID   int64
	ColumnID     int64
	SprintID     *int64
	ParentID     *int64
	IssueType    string
	GiteaIssueID int64
	Title        string
	Description  string
	State        string
	StoryPoints  *int
	Priority     string
	DueDate      *time.Time
	TimeEstimate *int
}

func (d *DB) CreateCard(input CreateCardInput) (*models.Card, error) {
	issueType := input.IssueType
	if issueType == "" {
		issueType = "task"
	}
	result, err := d.Exec(
		`INSERT INTO cards (board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.BoardID, input.SwimlaneID, input.ColumnID, input.SprintID, input.ParentID, issueType, input.GiteaIssueID, input.Title, input.Description, input.State, input.StoryPoints, input.Priority, input.DueDate, input.TimeEstimate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create card: %w", err)
	}

	id, _ := result.LastInsertId()
	return d.GetCardByID(id)
}

func (d *DB) GetCardByID(id int64) (*models.Card, error) {
	var card models.Card
	var sprintID sql.NullInt64
	var parentID sql.NullInt64
	var issueType sql.NullString
	var storyPoints sql.NullInt64
	var dueDate sql.NullTime
	var timeEstimate sql.NullInt64

	err := d.QueryRow(
		`SELECT id, board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate, created_at, updated_at
		 FROM cards WHERE id = ?`,
		id,
	).Scan(&card.ID, &card.BoardID, &card.SwimlaneID, &card.ColumnID, &sprintID, &parentID, &issueType, &card.GiteaIssueID, &card.Title, &card.Description, &card.State, &storyPoints, &card.Priority, &dueDate, &timeEstimate, &card.CreatedAt, &card.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get card: %w", err)
	}

	if sprintID.Valid {
		card.SprintID = &sprintID.Int64
	}
	if parentID.Valid {
		card.ParentID = &parentID.Int64
	}
	if issueType.Valid {
		card.IssueType = issueType.String
	} else {
		card.IssueType = "task"
	}
	if storyPoints.Valid {
		sp := int(storyPoints.Int64)
		card.StoryPoints = &sp
	}
	if dueDate.Valid {
		card.DueDate = &dueDate.Time
	}
	if timeEstimate.Valid {
		te := int(timeEstimate.Int64)
		card.TimeEstimate = &te
	}

	// Initialize empty slices
	card.Labels = []models.Label{}
	card.Assignees = []models.User{}

	return &card, nil
}

func (d *DB) GetCardByGiteaIssue(boardID, swimlaneID, giteaIssueID int64) (*models.Card, error) {
	var card models.Card
	var sprintID sql.NullInt64
	var storyPoints sql.NullInt64

	err := d.QueryRow(
		`SELECT id, board_id, swimlane_id, column_id, sprint_id, gitea_issue_id, title, description, state, story_points, priority, created_at, updated_at
		 FROM cards WHERE board_id = ? AND swimlane_id = ? AND gitea_issue_id = ?`,
		boardID, swimlaneID, giteaIssueID,
	).Scan(&card.ID, &card.BoardID, &card.SwimlaneID, &card.ColumnID, &sprintID, &card.GiteaIssueID, &card.Title, &card.Description, &card.State, &storyPoints, &card.Priority, &card.CreatedAt, &card.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get card: %w", err)
	}

	if sprintID.Valid {
		card.SprintID = &sprintID.Int64
	}
	if storyPoints.Valid {
		sp := int(storyPoints.Int64)
		card.StoryPoints = &sp
	}

	return &card, nil
}

func (d *DB) ListCardsForBoard(boardID int64) ([]models.Card, error) {
	return d.listCards(`WHERE board_id = ?`, boardID)
}

func (d *DB) ListCardsForSprint(sprintID int64) ([]models.Card, error) {
	return d.listCards(`WHERE sprint_id = ?`, sprintID)
}

func (d *DB) ListCardsForBacklog(boardID int64) ([]models.Card, error) {
	return d.listCards(`WHERE board_id = ? AND sprint_id IS NULL`, boardID)
}

func (d *DB) listCards(whereClause string, args ...interface{}) ([]models.Card, error) {
	query := `SELECT id, board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate, created_at, updated_at
		 FROM cards ` + whereClause + ` ORDER BY created_at`

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list cards: %w", err)
	}
	defer rows.Close()

	var cards []models.Card
	for rows.Next() {
		var card models.Card
		var sprintID sql.NullInt64
		var parentID sql.NullInt64
		var issueType sql.NullString
		var storyPoints sql.NullInt64
		var dueDate sql.NullTime
		var timeEstimate sql.NullInt64

		if err := rows.Scan(&card.ID, &card.BoardID, &card.SwimlaneID, &card.ColumnID, &sprintID, &parentID, &issueType, &card.GiteaIssueID, &card.Title, &card.Description, &card.State, &storyPoints, &card.Priority, &dueDate, &timeEstimate, &card.CreatedAt, &card.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan card: %w", err)
		}

		if sprintID.Valid {
			card.SprintID = &sprintID.Int64
		}
		if parentID.Valid {
			card.ParentID = &parentID.Int64
		}
		if issueType.Valid {
			card.IssueType = issueType.String
		} else {
			card.IssueType = "task"
		}
		if storyPoints.Valid {
			sp := int(storyPoints.Int64)
			card.StoryPoints = &sp
		}
		if dueDate.Valid {
			card.DueDate = &dueDate.Time
		}
		if timeEstimate.Valid {
			te := int(timeEstimate.Int64)
			card.TimeEstimate = &te
		}

		// Initialize empty slices
		card.Labels = []models.Label{}
		card.Assignees = []models.User{}

		cards = append(cards, card)
	}

	// Fetch assignees for all cards
	if len(cards) > 0 {
		cardIDs := make([]interface{}, len(cards))
		placeholders := make([]string, len(cards))
		cardMap := make(map[int64]*models.Card)
		for i, c := range cards {
			cardIDs[i] = c.ID
			placeholders[i] = "?"
			cardMap[c.ID] = &cards[i]
		}

		assigneeQuery := `SELECT ca.card_id, u.id, u.email, u.display_name, u.avatar_url
			FROM card_assignees ca
			JOIN users u ON ca.user_id = u.id
			WHERE ca.card_id IN (` + strings.Join(placeholders, ",") + `)`

		assigneeRows, err := d.Query(assigneeQuery, cardIDs...)
		if err == nil {
			defer assigneeRows.Close()
			for assigneeRows.Next() {
				var cardID int64
				var user models.User
				if err := assigneeRows.Scan(&cardID, &user.ID, &user.Email, &user.DisplayName, &user.AvatarURL); err == nil {
					if card, ok := cardMap[cardID]; ok {
						card.Assignees = append(card.Assignees, user)
					}
				}
			}
		}

		// Fetch labels for all cards
		labelQuery := `SELECT cl.card_id, l.id, l.name, l.color
			FROM card_labels cl
			JOIN labels l ON cl.label_id = l.id
			WHERE cl.card_id IN (` + strings.Join(placeholders, ",") + `)
			ORDER BY l.name`

		labelRows, err := d.Query(labelQuery, cardIDs...)
		if err == nil {
			defer labelRows.Close()
			for labelRows.Next() {
				var cardID int64
				var label models.Label
				if err := labelRows.Scan(&cardID, &label.ID, &label.Name, &label.Color); err == nil {
					if card, ok := cardMap[cardID]; ok {
						card.Labels = append(card.Labels, label)
					}
				}
			}
		}
	}

	return cards, nil
}

func (d *DB) UpdateCard(card *models.Card) error {
	_, err := d.Exec(
		`UPDATE cards SET swimlane_id = ?, column_id = ?, sprint_id = ?, parent_id = ?, issue_type = ?, title = ?, description = ?, state = ?, story_points = ?, priority = ?, due_date = ?, time_estimate = ?, updated_at = ?
		 WHERE id = ?`,
		card.SwimlaneID, card.ColumnID, card.SprintID, card.ParentID, card.IssueType, card.Title, card.Description, card.State, card.StoryPoints, card.Priority, card.DueDate, card.TimeEstimate, time.Now(), card.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update card: %w", err)
	}
	return nil
}

func (d *DB) MoveCard(cardID, columnID int64, state string) error {
	_, err := d.Exec(
		`UPDATE cards SET column_id = ?, state = ?, updated_at = ? WHERE id = ?`,
		columnID, state, time.Now(), cardID,
	)
	return err
}

func (d *DB) AssignCardToSprint(cardID int64, sprintID *int64) error {
	_, err := d.Exec(
		`UPDATE cards SET sprint_id = ?, updated_at = ? WHERE id = ?`,
		sprintID, time.Now(), cardID,
	)
	return err
}

func (d *DB) DeleteCard(id int64) error {
	_, err := d.Exec(`DELETE FROM cards WHERE id = ?`, id)
	return err
}

// ListChildCards returns all cards that have the given card as their parent
func (d *DB) ListChildCards(parentID int64) ([]models.Card, error) {
	return d.listCards(`WHERE parent_id = ?`, parentID)
}

// SetCardParent updates the parent_id and issue_type of a card
func (d *DB) SetCardParent(cardID int64, parentID *int64, issueType string) error {
	_, err := d.Exec(
		`UPDATE cards SET parent_id = ?, issue_type = ?, updated_at = ? WHERE id = ?`,
		parentID, issueType, time.Now(), cardID,
	)
	return err
}

// Card assignees

func (d *DB) AddCardAssignee(cardID, userID int64) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO card_assignees (card_id, user_id) VALUES (?, ?)`,
		cardID, userID,
	)
	return err
}

func (d *DB) RemoveCardAssignee(cardID, userID int64) error {
	_, err := d.Exec(
		`DELETE FROM card_assignees WHERE card_id = ? AND user_id = ?`,
		cardID, userID,
	)
	return err
}

func (d *DB) GetCardAssignees(cardID int64) ([]models.User, error) {
	rows, err := d.Query(
		`SELECT u.id, u.email, u.password_hash, u.display_name, u.avatar_url, u.created_at, u.updated_at
		 FROM users u
		 JOIN card_assignees ca ON u.id = ca.user_id
		 WHERE ca.card_id = ?`,
		cardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

// Work tracking

func (d *DB) LogWork(cardID, userID int64, timeSpent int, date time.Time, notes string) error {
	_, err := d.Exec(
		`INSERT INTO work_items (card_id, user_id, time_spent, date, notes) VALUES (?, ?, ?, ?, ?)`,
		cardID, userID, timeSpent, date, notes,
	)
	return err
}

func (d *DB) GetWorkItems(cardID int64) ([]models.WorkItem, error) {
	rows, err := d.Query(
		`SELECT id, card_id, user_id, time_spent, date, notes FROM work_items WHERE card_id = ? ORDER BY date DESC`,
		cardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.WorkItem
	for rows.Next() {
		var w models.WorkItem
		if err := rows.Scan(&w.ID, &w.CardID, &w.UserID, &w.TimeSpent, &w.Date, &w.Notes); err != nil {
			return nil, err
		}
		items = append(items, w)
	}
	return items, nil
}
