package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/gira/internal/models"
)

func (d *DB) CreateLabel(boardID int64, name, color string) (*models.Label, error) {
	result, err := d.Exec(
		`INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)`,
		boardID, name, color,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create label: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return &models.Label{
		ID:      id,
		BoardID: boardID,
		Name:    name,
		Color:   color,
	}, nil
}

func (d *DB) GetBoardLabels(boardID int64) ([]models.Label, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, color FROM labels WHERE board_id = ? ORDER BY name`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get labels: %w", err)
	}
	defer rows.Close()

	labels := []models.Label{}
	for rows.Next() {
		var label models.Label
		if err := rows.Scan(&label.ID, &label.BoardID, &label.Name, &label.Color); err != nil {
			return nil, fmt.Errorf("failed to scan label: %w", err)
		}
		labels = append(labels, label)
	}

	return labels, nil
}

func (d *DB) DeleteLabel(id int64) error {
	if _, err := d.Exec(`DELETE FROM card_labels WHERE label_id = ?`, id); err != nil {
		return err
	}
	_, err := d.Exec(`DELETE FROM labels WHERE id = ?`, id)
	return err
}

func (d *DB) UpdateLabel(id int64, name, color string) (*models.Label, error) {
	_, err := d.Exec(
		`UPDATE labels SET name = ?, color = ? WHERE id = ?`,
		name, color, id,
	)
	if err != nil {
		return nil, err
	}
	var label models.Label
	err = d.QueryRow(`SELECT id, board_id, name, color FROM labels WHERE id = ?`, id).
		Scan(&label.ID, &label.BoardID, &label.Name, &label.Color)
	if err != nil {
		return nil, err
	}
	return &label, nil
}

// GetLabelByID returns a label by its ID, or nil if not found.
func (d *DB) GetLabelByID(id int64) (*models.Label, error) {
	var label models.Label
	err := d.QueryRow(`SELECT id, board_id, name, color FROM labels WHERE id = ?`, id).
		Scan(&label.ID, &label.BoardID, &label.Name, &label.Color)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &label, nil
}

func (d *DB) AddLabelToCard(cardID, labelID int64) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)`,
		cardID, labelID,
	)
	return err
}

func (d *DB) RemoveLabelFromCard(cardID, labelID int64) error {
	_, err := d.Exec(
		`DELETE FROM card_labels WHERE card_id = ? AND label_id = ?`,
		cardID, labelID,
	)
	return err
}

func (d *DB) GetCardLabels(cardID int64) ([]models.Label, error) {
	rows, err := d.Query(
		`SELECT l.id, l.board_id, l.name, l.color
		 FROM labels l
		 JOIN card_labels cl ON l.id = cl.label_id
		 WHERE cl.card_id = ?
		 ORDER BY l.name`,
		cardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := []models.Label{}
	for rows.Next() {
		var label models.Label
		if err := rows.Scan(&label.ID, &label.BoardID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		labels = append(labels, label)
	}
	return labels, nil
}
