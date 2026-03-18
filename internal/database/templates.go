package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

func (d *DB) CreateCardTemplate(boardID int64, name, issueType, descriptionTemplate string) (*models.CardTemplate, error) {
	if issueType == "" {
		issueType = "task"
	}
	result, err := d.Exec(
		`INSERT INTO card_templates (board_id, name, issue_type, description_template) VALUES (?, ?, ?, ?)`,
		boardID, name, issueType, descriptionTemplate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create card template: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get template id: %w", err)
	}
	var t models.CardTemplate
	err = d.QueryRow(
		`SELECT id, board_id, name, issue_type, description_template, created_at FROM card_templates WHERE id = ?`,
		id,
	).Scan(&t.ID, &t.BoardID, &t.Name, &t.IssueType, &t.DescriptionTemplate, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to get card template: %w", err)
	}
	return &t, nil
}

func (d *DB) ListCardTemplates(boardID int64) ([]models.CardTemplate, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, issue_type, description_template, created_at FROM card_templates WHERE board_id = ? ORDER BY name`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list card templates: %w", err)
	}
	defer rows.Close()

	var templates []models.CardTemplate
	for rows.Next() {
		var t models.CardTemplate
		if err := rows.Scan(&t.ID, &t.BoardID, &t.Name, &t.IssueType, &t.DescriptionTemplate, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan card template: %w", err)
		}
		templates = append(templates, t)
	}
	return templates, nil
}

func (d *DB) DeleteCardTemplate(id int64) error {
	result, err := d.Exec(`DELETE FROM card_templates WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete card template: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}
