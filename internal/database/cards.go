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
	Position     float64
}

func (d *DB) CreateCard(input CreateCardInput) (*models.Card, error) {
	issueType := input.IssueType
	if issueType == "" {
		issueType = "task"
	}
	position := input.Position
	if position == 0 {
		maxPos, _ := d.GetMaxPosition(input.BoardID, input.ColumnID)
		position = maxPos + 1000
	}
	result, err := d.Exec(
		`INSERT INTO cards (board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate, position)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.BoardID, input.SwimlaneID, input.ColumnID, input.SprintID, input.ParentID, issueType, input.GiteaIssueID, input.Title, input.Description, input.State, input.StoryPoints, input.Priority, input.DueDate, input.TimeEstimate, position,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create card: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
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
		`SELECT id, board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate, position, created_at, updated_at
		 FROM cards WHERE id = ?`,
		id,
	).Scan(&card.ID, &card.BoardID, &card.SwimlaneID, &card.ColumnID, &sprintID, &parentID, &issueType, &card.GiteaIssueID, &card.Title, &card.Description, &card.State, &storyPoints, &card.Priority, &dueDate, &timeEstimate, &card.Position, &card.CreatedAt, &card.UpdatedAt)

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
	query := `SELECT id, board_id, swimlane_id, column_id, sprint_id, parent_id, issue_type, gitea_issue_id, title, description, state, story_points, priority, due_date, time_estimate, position, created_at, updated_at
		 FROM cards ` + whereClause + ` ORDER BY position, created_at`

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

		if err := rows.Scan(&card.ID, &card.BoardID, &card.SwimlaneID, &card.ColumnID, &sprintID, &parentID, &issueType, &card.GiteaIssueID, &card.Title, &card.Description, &card.State, &storyPoints, &card.Priority, &dueDate, &timeEstimate, &card.Position, &card.CreatedAt, &card.UpdatedAt); err != nil {
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

// CardSearchParams defines filters for searching cards.
type CardSearchParams struct {
	BoardID   int64
	Query     string  // text search on title/description
	Assignee  *int64  // filter by assignee user ID
	LabelIDs  []int64 // filter by label IDs (AND logic)
	Priority  string  // filter by priority
	State     string  // filter by state
	SprintID  *int64  // filter by sprint (use -1 for "no sprint"/backlog)
	IssueType string  // filter by issue type
	Overdue   bool    // filter cards with due_date < now
	DueBefore *time.Time
	DueAfter  *time.Time
	Limit     int
	Offset    int
}

// SearchCards returns cards matching the given filters and the total count.
func (d *DB) SearchCards(params CardSearchParams) ([]models.Card, int, error) {
	var conditions []string
	var args []interface{}

	conditions = append(conditions, "board_id = ?")
	args = append(args, params.BoardID)

	if params.Query != "" {
		conditions = append(conditions, "(title LIKE ? OR description LIKE ?)")
		q := "%" + params.Query + "%"
		args = append(args, q, q)
	}

	if params.Assignee != nil {
		conditions = append(conditions, "id IN (SELECT card_id FROM card_assignees WHERE user_id = ?)")
		args = append(args, *params.Assignee)
	}

	if len(params.LabelIDs) > 0 {
		placeholders := make([]string, len(params.LabelIDs))
		for i, lid := range params.LabelIDs {
			placeholders[i] = "?"
			args = append(args, lid)
		}
		conditions = append(conditions, "id IN (SELECT card_id FROM card_labels WHERE label_id IN ("+strings.Join(placeholders, ",")+"))")
	}

	if params.Priority != "" {
		conditions = append(conditions, "priority = ?")
		args = append(args, params.Priority)
	}

	if params.State != "" {
		conditions = append(conditions, "state = ?")
		args = append(args, params.State)
	}

	if params.SprintID != nil {
		if *params.SprintID == -1 {
			conditions = append(conditions, "sprint_id IS NULL")
		} else {
			conditions = append(conditions, "sprint_id = ?")
			args = append(args, *params.SprintID)
		}
	}

	if params.IssueType != "" {
		conditions = append(conditions, "issue_type = ?")
		args = append(args, params.IssueType)
	}

	if params.Overdue {
		conditions = append(conditions, "due_date IS NOT NULL AND due_date < datetime('now')")
	}

	if params.DueBefore != nil {
		conditions = append(conditions, "due_date IS NOT NULL AND due_date <= ?")
		args = append(args, *params.DueBefore)
	}

	if params.DueAfter != nil {
		conditions = append(conditions, "due_date IS NOT NULL AND due_date >= ?")
		args = append(args, *params.DueAfter)
	}

	whereClause := "WHERE " + strings.Join(conditions, " AND ")

	// Get total count
	countQuery := "SELECT COUNT(*) FROM cards " + whereClause
	var total int
	if err := d.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count search results: %w", err)
	}

	// Apply limit and offset
	limit := params.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := params.Offset
	if offset < 0 {
		offset = 0
	}

	cards, err := d.listCards(whereClause+" ORDER BY created_at DESC LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to search cards: %w", err)
	}

	return cards, total, nil
}

func (d *DB) UpdateCard(card *models.Card) error {
	_, err := d.Exec(
		`UPDATE cards SET swimlane_id = ?, column_id = ?, sprint_id = ?, parent_id = ?, issue_type = ?, title = ?, description = ?, state = ?, story_points = ?, priority = ?, due_date = ?, time_estimate = ?, position = ?, updated_at = ?
		 WHERE id = ?`,
		card.SwimlaneID, card.ColumnID, card.SprintID, card.ParentID, card.IssueType, card.Title, card.Description, card.State, card.StoryPoints, card.Priority, card.DueDate, card.TimeEstimate, card.Position, time.Now(), card.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update card: %w", err)
	}
	return nil
}

func (d *DB) MoveCard(cardID, columnID int64, state string, position float64) error {
	_, err := d.Exec(
		`UPDATE cards SET column_id = ?, state = ?, position = ?, updated_at = ? WHERE id = ?`,
		columnID, state, position, time.Now(), cardID,
	)
	return err
}

func (d *DB) ReorderCard(cardID int64, newPosition float64) error {
	_, err := d.Exec(
		`UPDATE cards SET position = ?, updated_at = ? WHERE id = ?`,
		newPosition, time.Now(), cardID,
	)
	return err
}

func (d *DB) GetMaxPosition(boardID, columnID int64) (float64, error) {
	var pos sql.NullFloat64
	err := d.QueryRow(
		`SELECT MAX(position) FROM cards WHERE board_id = ? AND column_id = ?`,
		boardID, columnID,
	).Scan(&pos)
	if err != nil || !pos.Valid {
		return 0, err
	}
	return pos.Float64, nil
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

// BulkMoveCards moves multiple cards to a target column with the given state
func (d *DB) BulkMoveCards(cardIDs []int64, columnID int64, state string) error {
	if len(cardIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(cardIDs))
	args := make([]interface{}, 0, len(cardIDs)+3)
	args = append(args, columnID, state, time.Now())
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	_, err := d.Exec(
		`UPDATE cards SET column_id = ?, state = ?, updated_at = ? WHERE id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	return err
}

// BulkAssignSprint assigns multiple cards to a sprint (or nil for backlog)
func (d *DB) BulkAssignSprint(cardIDs []int64, sprintID *int64) error {
	if len(cardIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(cardIDs))
	args := make([]interface{}, 0, len(cardIDs)+2)
	args = append(args, sprintID, time.Now())
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	_, err := d.Exec(
		`UPDATE cards SET sprint_id = ?, updated_at = ? WHERE id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	return err
}

// BulkUpdatePriority updates priority for multiple cards
func (d *DB) BulkUpdatePriority(cardIDs []int64, priority string) error {
	if len(cardIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(cardIDs))
	args := make([]interface{}, 0, len(cardIDs)+2)
	args = append(args, priority, time.Now())
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	_, err := d.Exec(
		`UPDATE cards SET priority = ?, updated_at = ? WHERE id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	return err
}

// BulkDeleteCards deletes multiple cards
func (d *DB) BulkDeleteCards(cardIDs []int64) error {
	if len(cardIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(cardIDs))
	args := make([]interface{}, len(cardIDs))
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	_, err := d.Exec(
		`DELETE FROM cards WHERE id IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
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
		`SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.updated_at
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
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.CreatedAt, &u.UpdatedAt); err != nil {
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
		`SELECT w.id, w.card_id, w.user_id, w.time_spent, w.date, w.notes,
		        u.id, u.email, u.display_name, u.avatar_url
		 FROM work_items w
		 LEFT JOIN users u ON w.user_id = u.id
		 WHERE w.card_id = ?
		 ORDER BY w.date DESC`,
		cardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []models.WorkItem
	for rows.Next() {
		var w models.WorkItem
		var user models.User
		if err := rows.Scan(&w.ID, &w.CardID, &w.UserID, &w.TimeSpent, &w.Date, &w.Notes,
			&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL); err != nil {
			return nil, err
		}
		w.User = &user
		items = append(items, w)
	}
	return items, nil
}

func (d *DB) GetTotalTimeLogged(cardID int64) (int, error) {
	var total int
	err := d.QueryRow(
		`SELECT COALESCE(SUM(time_spent), 0) FROM work_items WHERE card_id = ?`,
		cardID,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

func (d *DB) DeleteWorkLog(id int64) error {
	_, err := d.Exec(`DELETE FROM work_items WHERE id = ?`, id)
	return err
}

func (d *DB) GetWorkLogByID(id int64) (*models.WorkItem, error) {
	var w models.WorkItem
	err := d.QueryRow(
		`SELECT id, card_id, user_id, time_spent, date, notes FROM work_items WHERE id = ?`,
		id,
	).Scan(&w.ID, &w.CardID, &w.UserID, &w.TimeSpent, &w.Date, &w.Notes)
	if err != nil {
		return nil, err
	}
	return &w, nil
}
