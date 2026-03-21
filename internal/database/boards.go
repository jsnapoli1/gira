package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

// BoardTemplateColumns returns the column definitions for a given board template.
// Supported templates: "kanban", "scrum", "bug_triage". Empty string uses default columns.
type BoardColumn struct {
	Name     string
	State    string
	Position int
}

func BoardTemplateColumns(template string) []BoardColumn {
	switch template {
	case "scrum":
		return []BoardColumn{
			{"Backlog", "open", 0},
			{"To Do", "open", 1},
			{"In Progress", "in_progress", 2},
			{"Review", "in_progress", 3},
			{"Done", "closed", 4},
		}
	case "bug_triage":
		return []BoardColumn{
			{"New", "open", 0},
			{"Confirmed", "open", 1},
			{"In Progress", "in_progress", 2},
			{"Fixed", "closed", 3},
			{"Won't Fix", "closed", 4},
		}
	case "kanban":
		return []BoardColumn{
			{"To Do", "open", 0},
			{"In Progress", "in_progress", 1},
			{"Done", "closed", 2},
		}
	default:
		// Default columns (same as before)
		return []BoardColumn{
			{"To Do", "open", 0},
			{"In Progress", "in_progress", 1},
			{"In Review", "review", 2},
			{"Done", "closed", 3},
		}
	}
}

func (d *DB) CreateBoard(name, description string, ownerID int64) (*models.Board, error) {
	return d.CreateBoardWithTemplate(name, description, ownerID, "")
}

func (d *DB) CreateBoardWithTemplate(name, description string, ownerID int64, template string) (*models.Board, error) {
	tx, err := d.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		`INSERT INTO boards (name, description, owner_id) VALUES (?, ?, ?)`,
		name, description, ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create board: %w", err)
	}

	boardID, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get board id: %w", err)
	}

	// Create columns based on template
	columns := BoardTemplateColumns(template)
	for _, col := range columns {
		_, err := tx.Exec(
			`INSERT INTO columns (board_id, name, position, state) VALUES (?, ?, ?, ?)`,
			boardID, col.Name, col.Position, col.State,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create default column: %w", err)
		}
	}

	// Add owner as board admin
	_, err = tx.Exec(
		`INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'admin')`,
		boardID, ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to add board member: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return d.GetBoardByID(boardID)
}

func (d *DB) GetBoardByID(id int64) (*models.Board, error) {
	var board models.Board
	err := d.QueryRow(
		`SELECT id, name, description, owner_id, created_at, updated_at FROM boards WHERE id = ?`,
		id,
	).Scan(&board.ID, &board.Name, &board.Description, &board.OwnerID, &board.CreatedAt, &board.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get board: %w", err)
	}

	// Fetch columns
	columns, err := d.GetBoardColumns(id)
	if err != nil {
		return nil, err
	}
	board.Columns = columns

	// Fetch swimlanes
	swimlanes, err := d.GetBoardSwimlanes(id)
	if err != nil {
		return nil, err
	}
	board.Swimlanes = swimlanes

	return &board, nil
}

func (d *DB) GetBoardColumns(boardID int64) ([]models.Column, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, position, state FROM columns WHERE board_id = ? ORDER BY position`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}
	defer rows.Close()

	columns := []models.Column{}
	for rows.Next() {
		var col models.Column
		if err := rows.Scan(&col.ID, &col.BoardID, &col.Name, &col.Position, &col.State); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		columns = append(columns, col)
	}

	return columns, nil
}

func (d *DB) GetBoardSwimlanes(boardID int64) ([]models.Swimlane, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, COALESCE(repo_source, 'default_gitea'), COALESCE(repo_url, ''), repo_owner, repo_name, designator, position, color, COALESCE(label, '')
		 FROM swimlanes WHERE board_id = ? ORDER BY position`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get swimlanes: %w", err)
	}
	defer rows.Close()

	swimlanes := []models.Swimlane{}
	for rows.Next() {
		var sl models.Swimlane
		if err := rows.Scan(&sl.ID, &sl.BoardID, &sl.Name, &sl.RepoSource, &sl.RepoURL, &sl.RepoOwner, &sl.RepoName, &sl.Designator, &sl.Position, &sl.Color, &sl.Label); err != nil {
			return nil, fmt.Errorf("failed to scan swimlane: %w", err)
		}
		swimlanes = append(swimlanes, sl)
	}

	return swimlanes, nil
}

func (d *DB) ListBoardsForUser(userID int64) ([]models.Board, error) {
	rows, err := d.Query(
		`SELECT DISTINCT b.id, b.name, b.description, b.owner_id, b.created_at, b.updated_at
		 FROM boards b
		 LEFT JOIN board_members bm ON b.id = bm.board_id
		 WHERE b.owner_id = ? OR bm.user_id = ?
		 ORDER BY b.updated_at DESC`,
		userID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list boards: %w", err)
	}
	defer rows.Close()

	var boards []models.Board
	for rows.Next() {
		var board models.Board
		if err := rows.Scan(&board.ID, &board.Name, &board.Description, &board.OwnerID, &board.CreatedAt, &board.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan board: %w", err)
		}
		boards = append(boards, board)
	}

	return boards, nil
}

func (d *DB) UpdateBoard(board *models.Board) error {
	_, err := d.Exec(
		`UPDATE boards SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
		board.Name, board.Description, time.Now(), board.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update board: %w", err)
	}
	return nil
}

func (d *DB) DeleteBoard(id int64) error {
	_, err := d.Exec(`DELETE FROM boards WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete board: %w", err)
	}
	return nil
}

func (d *DB) CreateSwimlane(boardID int64, name, repoOwner, repoName, designator, color string) (*models.Swimlane, error) {
	return d.CreateSwimlaneWithSource(boardID, name, "default_gitea", "", repoOwner, repoName, designator, color)
}

func (d *DB) CreateSwimlaneWithSource(boardID int64, name, repoSource, repoURL, repoOwner, repoName, designator, color string) (*models.Swimlane, error) {
	return d.CreateSwimlaneWithSourceAndLabel(boardID, name, repoSource, repoURL, repoOwner, repoName, designator, color, "")
}

func (d *DB) CreateSwimlaneWithSourceAndLabel(boardID int64, name, repoSource, repoURL, repoOwner, repoName, designator, color, label string) (*models.Swimlane, error) {
	// Get next position
	var maxPos sql.NullInt64
	d.QueryRow(`SELECT MAX(position) FROM swimlanes WHERE board_id = ?`, boardID).Scan(&maxPos)
	position := 0
	if maxPos.Valid {
		position = int(maxPos.Int64) + 1
	}

	result, err := d.Exec(
		`INSERT INTO swimlanes (board_id, name, repo_source, repo_url, repo_owner, repo_name, designator, position, color, label)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		boardID, name, repoSource, repoURL, repoOwner, repoName, designator, position, color, label,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create swimlane: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return &models.Swimlane{
		ID:         id,
		BoardID:    boardID,
		Name:       name,
		RepoSource: repoSource,
		RepoURL:    repoURL,
		RepoOwner:  repoOwner,
		RepoName:   repoName,
		Designator: designator,
		Position:   position,
		Color:      color,
		Label:      label,
	}, nil
}

func (d *DB) ReorderSwimlane(swimlaneID int64, newPosition int) error {
	var boardID int64
	var currentPos int
	err := d.QueryRow(`SELECT board_id, position FROM swimlanes WHERE id = ?`, swimlaneID).Scan(&boardID, &currentPos)
	if err != nil {
		return err
	}

	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if newPosition < currentPos {
		_, err = tx.Exec(
			`UPDATE swimlanes SET position = position + 1
			 WHERE board_id = ? AND position >= ? AND position < ?`,
			boardID, newPosition, currentPos,
		)
	} else {
		_, err = tx.Exec(
			`UPDATE swimlanes SET position = position - 1
			 WHERE board_id = ? AND position > ? AND position <= ?`,
			boardID, currentPos, newPosition,
		)
	}
	if err != nil {
		return err
	}

	_, err = tx.Exec(`UPDATE swimlanes SET position = ? WHERE id = ?`, newPosition, swimlaneID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (d *DB) DeleteSwimlane(id int64) error {
	_, err := d.Exec(`DELETE FROM swimlanes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete swimlane: %w", err)
	}
	return nil
}

func (d *DB) CreateColumn(boardID int64, name, state string) (*models.Column, error) {
	var maxPos sql.NullInt64
	d.QueryRow(`SELECT MAX(position) FROM columns WHERE board_id = ?`, boardID).Scan(&maxPos)
	position := 0
	if maxPos.Valid {
		position = int(maxPos.Int64) + 1
	}

	result, err := d.Exec(
		`INSERT INTO columns (board_id, name, position, state) VALUES (?, ?, ?, ?)`,
		boardID, name, position, state,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create column: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return &models.Column{
		ID:       id,
		BoardID:  boardID,
		Name:     name,
		Position: position,
		State:    state,
	}, nil
}

func (d *DB) DeleteColumn(id int64) error {
	_, err := d.Exec(`DELETE FROM columns WHERE id = ?`, id)
	return err
}

func (d *DB) ReorderColumn(columnID int64, newPosition int) error {
	// Get the column's board and current position
	var boardID int64
	var currentPos int
	err := d.QueryRow(`SELECT board_id, position FROM columns WHERE id = ?`, columnID).Scan(&boardID, &currentPos)
	if err != nil {
		return err
	}

	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if newPosition < currentPos {
		// Moving up: shift columns between newPosition and currentPos-1 down
		_, err = tx.Exec(
			`UPDATE columns SET position = position + 1
			 WHERE board_id = ? AND position >= ? AND position < ?`,
			boardID, newPosition, currentPos,
		)
	} else {
		// Moving down: shift columns between currentPos+1 and newPosition up
		_, err = tx.Exec(
			`UPDATE columns SET position = position - 1
			 WHERE board_id = ? AND position > ? AND position <= ?`,
			boardID, currentPos, newPosition,
		)
	}
	if err != nil {
		return err
	}

	// Set the column's new position
	_, err = tx.Exec(`UPDATE columns SET position = ? WHERE id = ?`, newPosition, columnID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (d *DB) AddBoardMember(boardID, userID int64, role string) error {
	_, err := d.Exec(
		`INSERT OR REPLACE INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)`,
		boardID, userID, role,
	)
	return err
}

func (d *DB) RemoveBoardMember(boardID, userID int64) error {
	_, err := d.Exec(
		`DELETE FROM board_members WHERE board_id = ? AND user_id = ?`,
		boardID, userID,
	)
	return err
}

func (d *DB) GetBoardMembers(boardID int64) ([]models.BoardMember, error) {
	rows, err := d.Query(
		`SELECT id, board_id, user_id, role, created_at FROM board_members WHERE board_id = ?`,
		boardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []models.BoardMember
	for rows.Next() {
		var m models.BoardMember
		if err := rows.Scan(&m.ID, &m.BoardID, &m.UserID, &m.Role, &m.CreatedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, nil
}

func (d *DB) IsBoardMember(boardID, userID int64) (bool, string, error) {
	var role string
	err := d.QueryRow(
		`SELECT role FROM board_members WHERE board_id = ? AND user_id = ?`,
		boardID, userID,
	).Scan(&role)

	if err == sql.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return true, role, nil
}

// SetSwimlaneCredential stores an API token for a swimlane
func (d *DB) SetSwimlaneCredential(swimlaneID int64, apiToken string) error {
	_, err := d.Exec(
		`INSERT OR REPLACE INTO swimlane_credentials (swimlane_id, api_token) VALUES (?, ?)`,
		swimlaneID, apiToken,
	)
	if err != nil {
		return fmt.Errorf("failed to set swimlane credential: %w", err)
	}
	return nil
}

// GetSwimlaneCredential retrieves the API token for a swimlane
func (d *DB) GetSwimlaneCredential(swimlaneID int64) (string, error) {
	var token string
	err := d.QueryRow(
		`SELECT api_token FROM swimlane_credentials WHERE swimlane_id = ?`,
		swimlaneID,
	).Scan(&token)

	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get swimlane credential: %w", err)
	}
	return token, nil
}

// GetSwimlaneByID retrieves a swimlane by ID
func (d *DB) GetSwimlaneByID(id int64) (*models.Swimlane, error) {
	var sl models.Swimlane
	err := d.QueryRow(
		`SELECT id, board_id, name, COALESCE(repo_source, 'default_gitea'), COALESCE(repo_url, ''), repo_owner, repo_name, designator, position, color, COALESCE(label, '')
		 FROM swimlanes WHERE id = ?`,
		id,
	).Scan(&sl.ID, &sl.BoardID, &sl.Name, &sl.RepoSource, &sl.RepoURL, &sl.RepoOwner, &sl.RepoName, &sl.Designator, &sl.Position, &sl.Color, &sl.Label)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get swimlane: %w", err)
	}
	return &sl, nil
}
