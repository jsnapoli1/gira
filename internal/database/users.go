package database

import (
	"database/sql"
	"fmt"

	"github.com/jsnapoli/gira/internal/models"
)

func (d *DB) CreateUser(email, passwordHash, displayName string) (*models.User, error) {
	// Check if this is the first user - if so, make them admin
	var userCount int
	d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount)
	isAdmin := userCount == 0

	result, err := d.Exec(
		`INSERT INTO users (email, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)`,
		email, passwordHash, displayName, isAdmin,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get user id: %w", err)
	}

	return d.GetUserByID(id)
}

func (d *DB) GetUserByID(id int64) (*models.User, error) {
	var user models.User
	err := d.QueryRow(
		`SELECT id, email, password_hash, display_name, avatar_url, is_admin, created_at, updated_at
		 FROM users WHERE id = ?`,
		id,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarURL, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

func (d *DB) GetUserByEmail(email string) (*models.User, error) {
	var user models.User
	err := d.QueryRow(
		`SELECT id, email, password_hash, display_name, avatar_url, is_admin, created_at, updated_at
		 FROM users WHERE email = ?`,
		email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarURL, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

func (d *DB) ListUsers() ([]models.User, error) {
	rows, err := d.Query(
		`SELECT id, email, display_name, avatar_url, is_admin, created_at, updated_at FROM users ORDER BY display_name`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var user models.User
		if err := rows.Scan(&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.IsAdmin, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, user)
	}

	return users, nil
}

// SetUserAdmin sets or unsets admin status for a user
func (d *DB) SetUserAdmin(userID int64, isAdmin bool) error {
	_, err := d.Exec(`UPDATE users SET is_admin = ? WHERE id = ?`, isAdmin, userID)
	if err != nil {
		return fmt.Errorf("failed to set user admin status: %w", err)
	}
	return nil
}

// CountAdmins returns the number of admin users
func (d *DB) CountAdmins() (int, error) {
	var count int
	err := d.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin = 1`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count admins: %w", err)
	}
	return count, nil
}
