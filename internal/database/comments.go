package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/zira/internal/models"
)

// CreateComment creates a new comment on a card
func (d *DB) CreateComment(cardID, userID int64, body string, parentCommentID *int64) (*models.Comment, error) {
	result, err := d.Exec(
		`INSERT INTO comments (card_id, user_id, body, parent_comment_id) VALUES (?, ?, ?, ?)`,
		cardID, userID, body, parentCommentID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create comment: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return d.GetCommentByID(id)
}

// GetCommentByID retrieves a comment by ID
func (d *DB) GetCommentByID(id int64) (*models.Comment, error) {
	var comment models.Comment
	err := d.QueryRow(
		`SELECT id, card_id, user_id, body, parent_comment_id, created_at, updated_at FROM comments WHERE id = ?`,
		id,
	).Scan(&comment.ID, &comment.CardID, &comment.UserID, &comment.Body, &comment.ParentCommentID, &comment.CreatedAt, &comment.UpdatedAt)

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
		`SELECT c.id, c.card_id, c.user_id, c.body, c.parent_comment_id, c.created_at, c.updated_at,
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

	var allComments []models.Comment
	for rows.Next() {
		var comment models.Comment
		var user models.User
		var avatarURL sql.NullString

		if err := rows.Scan(
			&comment.ID, &comment.CardID, &comment.UserID, &comment.Body, &comment.ParentCommentID, &comment.CreatedAt, &comment.UpdatedAt,
			&user.ID, &user.Email, &user.DisplayName, &avatarURL,
		); err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}

		if avatarURL.Valid {
			user.AvatarURL = avatarURL.String
		}
		comment.User = &user
		allComments = append(allComments, comment)
	}

	// Load attachments for each comment
	for i := range allComments {
		attachments, err := d.GetAttachmentsForComment(allComments[i].ID)
		if err == nil {
			allComments[i].Attachments = attachments
		}
	}

	// Build thread tree: nest replies under their parents
	commentMap := make(map[int64]*models.Comment)
	for i := range allComments {
		allComments[i].Replies = []models.Comment{}
		commentMap[allComments[i].ID] = &allComments[i]
	}

	// Collect top-level comment pointers first so that reply nesting (via
	// commentMap) is reflected when we dereference at the end.
	var topLevelPtrs []*models.Comment
	for i := range allComments {
		if allComments[i].ParentCommentID != nil {
			if parent, ok := commentMap[*allComments[i].ParentCommentID]; ok {
				parent.Replies = append(parent.Replies, allComments[i])
				continue
			}
		}
		topLevelPtrs = append(topLevelPtrs, &allComments[i])
	}

	topLevel := make([]models.Comment, len(topLevelPtrs))
	for i, p := range topLevelPtrs {
		topLevel[i] = *p
	}

	return topLevel, nil
}

// DeleteComment deletes a comment
func (d *DB) DeleteComment(id int64) error {
	_, err := d.Exec(`DELETE FROM comments WHERE id = ?`, id)
	return err
}
