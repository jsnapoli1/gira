package database

import (
	"fmt"
	"strings"

	"github.com/jsnapoli/zira/internal/models"
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
		ID:    id,
		Name:  name,
		Color: color,
	}, nil
}

func (d *DB) GetBoardLabels(boardID int64) ([]models.Label, error) {
	rows, err := d.Query(
		`SELECT id, name, color FROM labels WHERE board_id = ? ORDER BY name`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get labels: %w", err)
	}
	defer rows.Close()

	labels := []models.Label{}
	for rows.Next() {
		var label models.Label
		if err := rows.Scan(&label.ID, &label.Name, &label.Color); err != nil {
			return nil, fmt.Errorf("failed to scan label: %w", err)
		}
		labels = append(labels, label)
	}

	return labels, nil
}

func (d *DB) DeleteLabel(id int64) error {
	_, err := d.Exec(`DELETE FROM labels WHERE id = ?`, id)
	return err
}

func (d *DB) UpdateLabel(id int64, name, color string) error {
	_, err := d.Exec(
		`UPDATE labels SET name = ?, color = ? WHERE id = ?`,
		name, color, id,
	)
	return err
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
		`SELECT l.id, l.name, l.color
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

	var labels []models.Label
	for rows.Next() {
		var label models.Label
		if err := rows.Scan(&label.ID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		labels = append(labels, label)
	}
	return labels, nil
}

// GetLabelsForCards fetches labels for multiple cards in one query
func (d *DB) GetLabelsForCards(cardIDs []int64) (map[int64][]models.Label, error) {
	if len(cardIDs) == 0 {
		return make(map[int64][]models.Label), nil
	}

	placeholders := make([]string, len(cardIDs))
	args := make([]interface{}, len(cardIDs))
	for i, id := range cardIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := `SELECT cl.card_id, l.id, l.name, l.color
		FROM labels l
		JOIN card_labels cl ON l.id = cl.label_id
		WHERE cl.card_id IN (` + strings.Join(placeholders, ",") + `)
		ORDER BY l.name`

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int64][]models.Label)
	for rows.Next() {
		var cardID int64
		var label models.Label
		if err := rows.Scan(&cardID, &label.ID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		result[cardID] = append(result[cardID], label)
	}

	return result, nil
}
