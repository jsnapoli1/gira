package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

// CreateComment creates a new comment on a card
func (d *DB) CreateComment(cardID, userID int64, body string) (*models.Comment, error) {
	result, err := d.Exec(
		`INSERT INTO comments (card_id, user_id, body) VALUES (?, ?, ?)`,
		cardID, userID, body,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create comment: %w", err)
	}

	id, _ := result.LastInsertId()
	return d.GetCommentByID(id)
}

// GetCommentByID retrieves a comment by ID
func (d *DB) GetCommentByID(id int64) (*models.Comment, error) {
	var comment models.Comment
	err := d.QueryRow(
		`SELECT id, card_id, user_id, body, created_at, updated_at FROM comments WHERE id = ?`,
		id,
	).Scan(&comment.ID, &comment.CardID, &comment.UserID, &comment.Body, &comment.CreatedAt, &comment.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get comment: %w", err)
	}

	// Load user info
	user, err := d.GetUserByID(comment.UserID)
	if err == nil && user != nil {
		comment.User = user
	}

	return &comment, nil
}

// GetCommentsForCard retrieves all comments for a card
func (d *DB) GetCommentsForCard(cardID int64) ([]models.Comment, error) {
	rows, err := d.Query(
		`SELECT c.id, c.card_id, c.user_id, c.body, c.created_at, c.updated_at,
				u.id, u.email, u.display_name, u.avatar_url
		 FROM comments c
		 LEFT JOIN users u ON c.user_id = u.id
		 WHERE c.card_id = ?
		 ORDER BY c.created_at ASC`,
		cardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list comments: %w", err)
	}
	defer rows.Close()

	var comments []models.Comment
	for rows.Next() {
		var comment models.Comment
		var user models.User
		var avatarURL sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.CardID, &comment.UserID, &comment.Body, &comment.CreatedAt, &comment.UpdatedAt,
			&user.ID, &user.Email, &user.DisplayName, &avatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}

		if avatarURL.Valid {
			user.AvatarURL = avatarURL.String
		}
		comment.User = &user
		comments = append(comments, comment)
	}

	if comments == nil {
		comments = []models.Comment{}
	}

	// Load attachments for each comment
	for i := range comments {
		attachments, err := d.GetAttachmentsForComment(comments[i].ID)
		if err == nil {
			comments[i].Attachments = attachments
		}
	}

	return comments, nil
}

// UpdateComment updates a comment's body
func (d *DB) UpdateComment(id int64, body string) error {
	_, err := d.Exec(
		`UPDATE comments SET body = ?, updated_at = ? WHERE id = ?`,
		body, time.Now(), id,
	)
	return err
}

// DeleteComment deletes a comment
func (d *DB) DeleteComment(id int64) error {
	_, err := d.Exec(`DELETE FROM comments WHERE id = ?`, id)
	return err
}
