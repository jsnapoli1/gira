package database

import (
	"fmt"

	"github.com/jsnapoli/gira/internal/models"
)

// ListIssueTypes returns all custom issue type definitions for a board.
func (d *DB) ListIssueTypes(boardID int64) ([]models.IssueTypeDefinition, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, icon, color, position
		 FROM issue_type_definitions
		 WHERE board_id = ?
		 ORDER BY position, id`, boardID)
	if err != nil {
		return nil, fmt.Errorf("list issue types: %w", err)
	}
	defer rows.Close()

	var types []models.IssueTypeDefinition
	for rows.Next() {
		var t models.IssueTypeDefinition
		if err := rows.Scan(&t.ID, &t.BoardID, &t.Name, &t.Icon, &t.Color, &t.Position); err != nil {
			return nil, fmt.Errorf("scan issue type: %w", err)
		}
		types = append(types, t)
	}
	return types, rows.Err()
}

// CreateIssueType creates a new custom issue type definition for a board.
func (d *DB) CreateIssueType(boardID int64, name, icon, color string) (*models.IssueTypeDefinition, error) {
	// Get next position
	var maxPos int
	d.QueryRow(`SELECT COALESCE(MAX(position), -1) FROM issue_type_definitions WHERE board_id = ?`, boardID).Scan(&maxPos)

	result, err := d.Exec(
		`INSERT INTO issue_type_definitions (board_id, name, icon, color, position)
		 VALUES (?, ?, ?, ?, ?)`,
		boardID, name, icon, color, maxPos+1)
	if err != nil {
		return nil, fmt.Errorf("create issue type: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get issue type id: %w", err)
	}

	return &models.IssueTypeDefinition{
		ID:       id,
		BoardID:  boardID,
		Name:     name,
		Icon:     icon,
		Color:    color,
		Position: maxPos + 1,
	}, nil
}

// GetIssueType returns a single issue type definition by ID.
func (d *DB) GetIssueType(id int64) (*models.IssueTypeDefinition, error) {
	var t models.IssueTypeDefinition
	err := d.QueryRow(
		`SELECT id, board_id, name, icon, color, position
		 FROM issue_type_definitions
		 WHERE id = ?`, id).Scan(&t.ID, &t.BoardID, &t.Name, &t.Icon, &t.Color, &t.Position)
	if err != nil {
		return nil, fmt.Errorf("get issue type: %w", err)
	}
	return &t, nil
}

// UpdateIssueType updates an existing issue type definition.
func (d *DB) UpdateIssueType(id int64, name, icon, color string) error {
	result, err := d.Exec(
		`UPDATE issue_type_definitions SET name = ?, icon = ?, color = ? WHERE id = ?`,
		name, icon, color, id)
	if err != nil {
		return fmt.Errorf("update issue type: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update issue type rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("issue type not found")
	}
	return nil
}

// DeleteIssueType deletes an issue type definition.
func (d *DB) DeleteIssueType(id int64) error {
	result, err := d.Exec(`DELETE FROM issue_type_definitions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete issue type: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete issue type rows affected: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("issue type not found")
	}
	return nil
}
