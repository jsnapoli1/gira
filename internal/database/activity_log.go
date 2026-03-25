package database

import (
	"fmt"

	"github.com/jsnapoli/gira/internal/models"
)

// LogActivity records an activity log entry. Errors are returned but callers
// should generally log and discard them so activity logging never blocks the
// primary operation.
func (d *DB) LogActivity(boardID int64, cardID *int64, userID int64, action, entityType, fieldChanged, oldValue, newValue string) error {
	_, err := d.Exec(
		`INSERT INTO activity_log (board_id, card_id, user_id, action, entity_type, field_changed, old_value, new_value)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		boardID, cardID, userID, action, entityType, fieldChanged, oldValue, newValue,
	)
	if err != nil {
		return fmt.Errorf("failed to log activity: %w", err)
	}
	return nil
}

// GetCardActivity returns activity log entries for a specific card, ordered by
// most recent first. The User field is populated via a JOIN.
func (d *DB) GetCardActivity(cardID int64, limit, offset int) ([]models.ActivityLog, error) {
	rows, err := d.Query(
		`SELECT a.id, a.board_id, a.card_id, a.user_id, a.action, a.entity_type,
		        COALESCE(a.field_changed, ''), COALESCE(a.old_value, ''), COALESCE(a.new_value, ''), a.created_at,
		        u.id, u.email, u.display_name, u.avatar_url
		 FROM activity_log a
		 LEFT JOIN users u ON a.user_id = u.id
		 WHERE a.card_id = ?
		 ORDER BY a.created_at DESC
		 LIMIT ? OFFSET ?`,
		cardID, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get card activity: %w", err)
	}
	defer rows.Close()

	return scanActivityLogs(rows)
}

// GetBoardActivity returns activity log entries for a specific board, ordered by
// most recent first. The User field is populated via a JOIN.
func (d *DB) GetBoardActivity(boardID int64, limit, offset int) ([]models.ActivityLog, error) {
	rows, err := d.Query(
		`SELECT a.id, a.board_id, a.card_id, a.user_id, a.action, a.entity_type,
		        COALESCE(a.field_changed, ''), COALESCE(a.old_value, ''), COALESCE(a.new_value, ''), a.created_at,
		        u.id, u.email, u.display_name, u.avatar_url
		 FROM activity_log a
		 LEFT JOIN users u ON a.user_id = u.id
		 WHERE a.board_id = ?
		 ORDER BY a.created_at DESC
		 LIMIT ? OFFSET ?`,
		boardID, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get board activity: %w", err)
	}
	defer rows.Close()

	return scanActivityLogs(rows)
}

func scanActivityLogs(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
}) ([]models.ActivityLog, error) {
	var activities []models.ActivityLog
	for rows.Next() {
		var a models.ActivityLog
		var user models.User
		var cardID *int64
		if err := rows.Scan(
			&a.ID, &a.BoardID, &cardID, &a.UserID,
			&a.Action, &a.EntityType, &a.FieldChanged,
			&a.OldValue, &a.NewValue, &a.CreatedAt,
			&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan activity log: %w", err)
		}
		a.CardID = cardID
		a.User = &user
		activities = append(activities, a)
	}
	return activities, nil
}
