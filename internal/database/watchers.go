package database

import (
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

// AddWatcher adds a user as a watcher of a card.
func (d *DB) AddWatcher(cardID, userID int64) error {
	_, err := d.Exec(`INSERT OR IGNORE INTO card_watchers (card_id, user_id) VALUES (?, ?)`, cardID, userID)
	if err != nil {
		return fmt.Errorf("add watcher: %w", err)
	}
	return nil
}

// RemoveWatcher removes a user from watching a card.
func (d *DB) RemoveWatcher(cardID, userID int64) error {
	_, err := d.Exec(`DELETE FROM card_watchers WHERE card_id = ? AND user_id = ?`, cardID, userID)
	if err != nil {
		return fmt.Errorf("remove watcher: %w", err)
	}
	return nil
}

// GetWatchers returns the list of users watching a card.
func (d *DB) GetWatchers(cardID int64) ([]models.User, error) {
	rows, err := d.Query(`
		SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_admin, u.created_at, u.updated_at
		FROM card_watchers cw
		JOIN users u ON u.id = cw.user_id
		WHERE cw.card_id = ?
		ORDER BY u.display_name
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("get watchers: %w", err)
	}
	defer rows.Close()

	var watchers []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.AvatarURL, &u.IsAdmin, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan watcher: %w", err)
		}
		watchers = append(watchers, u)
	}
	return watchers, rows.Err()
}
