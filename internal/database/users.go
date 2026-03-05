package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

func (d *DB) CreateUser(email, passwordHash, displayName string) (*models.User, error) {
	result, err := d.Exec(
		`INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)`,
		email, passwordHash, displayName,
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
		`SELECT id, email, password_hash, display_name, avatar_url, created_at, updated_at
		 FROM users WHERE id = ?`,
		id,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarURL, &user.CreatedAt, &user.UpdatedAt)

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
		`SELECT id, email, password_hash, display_name, avatar_url, created_at, updated_at
		 FROM users WHERE email = ?`,
		email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarURL, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

func (d *DB) UpdateUser(user *models.User) error {
	_, err := d.Exec(
		`UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
		user.DisplayName, user.AvatarURL, time.Now(), user.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}
	return nil
}

func (d *DB) ListUsers() ([]models.User, error) {
	rows, err := d.Query(
		`SELECT id, email, password_hash, display_name, avatar_url, created_at, updated_at FROM users ORDER BY display_name`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var user models.User
		if err := rows.Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.AvatarURL, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, user)
	}

	return users, nil
}
