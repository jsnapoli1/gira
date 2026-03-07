package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

func (d *DB) CreateNotification(userID int64, notificationType, title, message, link string) (*models.Notification, error) {
	result, err := d.Exec(
		`INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)`,
		userID, notificationType, title, message, link,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return d.GetNotificationByID(id)
}

func (d *DB) GetNotificationByID(id int64) (*models.Notification, error) {
	var notification models.Notification
	var link sql.NullString

	err := d.QueryRow(
		`SELECT id, user_id, type, title, message, link, read, created_at
		 FROM notifications WHERE id = ?`,
		id,
	).Scan(&notification.ID, &notification.UserID, &notification.Type, &notification.Title, &notification.Message, &link, &notification.Read, &notification.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get notification: %w", err)
	}

	if link.Valid {
		notification.Link = link.String
	}

	return &notification, nil
}

func (d *DB) GetNotificationsForUser(userID int64, limit int) ([]models.Notification, error) {
	rows, err := d.Query(
		`SELECT id, user_id, type, title, message, link, read, created_at
		 FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get notifications: %w", err)
	}
	defer rows.Close()

	var notifications []models.Notification
	for rows.Next() {
		var notification models.Notification
		var link sql.NullString

		if err := rows.Scan(&notification.ID, &notification.UserID, &notification.Type, &notification.Title, &notification.Message, &link, &notification.Read, &notification.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}

		if link.Valid {
			notification.Link = link.String
		}

		notifications = append(notifications, notification)
	}

	return notifications, nil
}

func (d *DB) GetUnreadNotificationCount(userID int64) (int, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count unread notifications: %w", err)
	}
	return count, nil
}

func (d *DB) MarkNotificationRead(id int64) error {
	_, err := d.Exec(`UPDATE notifications SET read = 1 WHERE id = ?`, id)
	return err
}

func (d *DB) MarkAllNotificationsRead(userID int64) error {
	_, err := d.Exec(`UPDATE notifications SET read = 1 WHERE user_id = ?`, userID)
	return err
}

func (d *DB) DeleteNotification(id int64) error {
	_, err := d.Exec(`DELETE FROM notifications WHERE id = ?`, id)
	return err
}
