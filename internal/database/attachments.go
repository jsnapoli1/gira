package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

// CreateAttachment creates a new attachment record
func (d *DB) CreateAttachment(cardID, userID int64, filename string, size int64, mimeType, storePath string) (*models.Attachment, error) {
	result, err := d.Exec(
		`INSERT INTO attachments (card_id, user_id, filename, size, mime_type, store_path) VALUES (?, ?, ?, ?, ?, ?)`,
		cardID, userID, filename, size, mimeType, storePath,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create attachment: %w", err)
	}

	id, _ := result.LastInsertId()
	return d.GetAttachmentByID(id)
}

// GetAttachmentByID retrieves an attachment by ID
func (d *DB) GetAttachmentByID(id int64) (*models.Attachment, error) {
	var attachment models.Attachment
	err := d.QueryRow(
		`SELECT id, card_id, user_id, filename, size, mime_type, store_path, created_at FROM attachments WHERE id = ?`,
		id,
	).Scan(&attachment.ID, &attachment.CardID, &attachment.UserID, &attachment.Filename, &attachment.Size, &attachment.MimeType, &attachment.StorePath, &attachment.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get attachment: %w", err)
	}

	// Load user info
	user, err := d.GetUserByID(attachment.UserID)
	if err == nil && user != nil {
		attachment.User = user
	}

	return &attachment, nil
}

// GetAttachmentsForCard retrieves all attachments for a card
func (d *DB) GetAttachmentsForCard(cardID int64) ([]models.Attachment, error) {
	rows, err := d.Query(
		`SELECT a.id, a.card_id, a.user_id, a.filename, a.size, a.mime_type, a.store_path, a.created_at,
				u.id, u.email, u.display_name, u.avatar_url
		 FROM attachments a
		 LEFT JOIN users u ON a.user_id = u.id
		 WHERE a.card_id = ?
		 ORDER BY a.created_at ASC`,
		cardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list attachments: %w", err)
	}
	defer rows.Close()

	var attachments []models.Attachment
	for rows.Next() {
		var attachment models.Attachment
		var user models.User
		var avatarURL sql.NullString

		if err := rows.Scan(
			&attachment.ID, &attachment.CardID, &attachment.UserID, &attachment.Filename, &attachment.Size, &attachment.MimeType, &attachment.StorePath, &attachment.CreatedAt,
			&user.ID, &user.Email, &user.DisplayName, &avatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}

		if avatarURL.Valid {
			user.AvatarURL = avatarURL.String
		}
		attachment.User = &user
		attachments = append(attachments, attachment)
	}

	if attachments == nil {
		attachments = []models.Attachment{}
	}

	return attachments, nil
}

// DeleteAttachment deletes an attachment record (file cleanup is handled separately)
func (d *DB) DeleteAttachment(id int64) error {
	_, err := d.Exec(`DELETE FROM attachments WHERE id = ?`, id)
	return err
}

// LinkAttachmentsToComment links existing attachments to a comment
func (d *DB) LinkAttachmentsToComment(commentID int64, attachmentIDs []int64) error {
	for _, attID := range attachmentIDs {
		_, err := d.Exec(`UPDATE attachments SET comment_id = ? WHERE id = ?`, commentID, attID)
		if err != nil {
			return fmt.Errorf("failed to link attachment %d to comment: %w", attID, err)
		}
	}
	return nil
}

// GetAttachmentsForComment retrieves all attachments linked to a comment
func (d *DB) GetAttachmentsForComment(commentID int64) ([]*models.Attachment, error) {
	rows, err := d.Query(
		`SELECT id, card_id, comment_id, user_id, filename, size, mime_type, store_path, created_at
		 FROM attachments WHERE comment_id = ? ORDER BY created_at ASC`,
		commentID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get attachments for comment: %w", err)
	}
	defer rows.Close()

	var attachments []*models.Attachment
	for rows.Next() {
		var att models.Attachment
		var commentID sql.NullInt64
		if err := rows.Scan(&att.ID, &att.CardID, &commentID, &att.UserID, &att.Filename, &att.Size, &att.MimeType, &att.StorePath, &att.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		if commentID.Valid {
			att.CommentID = &commentID.Int64
		}
		attachments = append(attachments, &att)
	}
	return attachments, nil
}
