package database

import (
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

// GetWorkflowRules returns all workflow rules for a board.
func (d *DB) GetWorkflowRules(boardID int64) ([]models.WorkflowRule, error) {
	rows, err := d.Query(`SELECT id, board_id, from_column_id, to_column_id FROM workflow_rules WHERE board_id = ?`, boardID)
	if err != nil {
		return nil, fmt.Errorf("get workflow rules: %w", err)
	}
	defer rows.Close()

	var rules []models.WorkflowRule
	for rows.Next() {
		var r models.WorkflowRule
		if err := rows.Scan(&r.ID, &r.BoardID, &r.FromColumnID, &r.ToColumnID); err != nil {
			return nil, fmt.Errorf("scan workflow rule: %w", err)
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

// SetWorkflowRules replaces all workflow rules for a board.
func (d *DB) SetWorkflowRules(boardID int64, rules []models.WorkflowRule) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM workflow_rules WHERE board_id = ?`, boardID); err != nil {
		return fmt.Errorf("delete old workflow rules: %w", err)
	}

	stmt, err := tx.Prepare(`INSERT INTO workflow_rules (board_id, from_column_id, to_column_id) VALUES (?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	for _, r := range rules {
		if _, err := stmt.Exec(boardID, r.FromColumnID, r.ToColumnID); err != nil {
			return fmt.Errorf("insert workflow rule: %w", err)
		}
	}

	return tx.Commit()
}

// IsTransitionAllowed checks whether moving a card from one column to another
// is permitted by the board's workflow rules. If no rules exist for the board,
// all transitions are allowed (backward compatible).
func (d *DB) IsTransitionAllowed(boardID, fromColumnID, toColumnID int64) (bool, error) {
	// Same column is always allowed (reordering within a column)
	if fromColumnID == toColumnID {
		return true, nil
	}

	var count int
	err := d.QueryRow(`SELECT COUNT(*) FROM workflow_rules WHERE board_id = ?`, boardID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("count workflow rules: %w", err)
	}

	// No rules means all transitions are allowed
	if count == 0 {
		return true, nil
	}

	var matchCount int
	err = d.QueryRow(
		`SELECT COUNT(*) FROM workflow_rules WHERE board_id = ? AND from_column_id = ? AND to_column_id = ?`,
		boardID, fromColumnID, toColumnID,
	).Scan(&matchCount)
	if err != nil {
		return false, fmt.Errorf("check transition: %w", err)
	}

	return matchCount > 0, nil
}
