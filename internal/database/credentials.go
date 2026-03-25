package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/gira/internal/models"
)

// CreateOrUpdateUserCredential creates or updates a user credential
func (d *DB) CreateOrUpdateUserCredential(userID int64, provider, providerURL, apiToken, displayName string) (*models.UserCredential, error) {
	now := time.Now()

	// Try to update existing credential first
	result, err := d.Exec(`
		UPDATE user_credentials
		SET api_token = ?, display_name = ?, updated_at = ?
		WHERE user_id = ? AND provider = ? AND provider_url = ?
	`, apiToken, displayName, now, userID, provider, providerURL)
	if err != nil {
		return nil, fmt.Errorf("update user credential: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected > 0 {
		// Updated existing credential
		return d.GetUserCredential(userID, provider, providerURL)
	}

	// Insert new credential
	res, err := d.Exec(`
		INSERT INTO user_credentials (user_id, provider, provider_url, api_token, display_name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, userID, provider, providerURL, apiToken, displayName, now, now)
	if err != nil {
		return nil, fmt.Errorf("insert user credential: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return &models.UserCredential{
		ID:          id,
		UserID:      userID,
		Provider:    provider,
		ProviderURL: providerURL,
		APIToken:    apiToken,
		DisplayName: displayName,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

// GetUserCredential retrieves a specific user credential
func (d *DB) GetUserCredential(userID int64, provider, providerURL string) (*models.UserCredential, error) {
	var cred models.UserCredential
	err := d.QueryRow(`
		SELECT id, user_id, provider, provider_url, api_token, display_name, created_at, updated_at
		FROM user_credentials
		WHERE user_id = ? AND provider = ? AND provider_url = ?
	`, userID, provider, providerURL).Scan(
		&cred.ID, &cred.UserID, &cred.Provider, &cred.ProviderURL,
		&cred.APIToken, &cred.DisplayName, &cred.CreatedAt, &cred.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user credential: %w", err)
	}
	return &cred, nil
}

// GetUserCredentials retrieves all credentials for a user
func (d *DB) GetUserCredentials(userID int64) ([]models.UserCredential, error) {
	rows, err := d.Query(`
		SELECT id, user_id, provider, provider_url, api_token, display_name, created_at, updated_at
		FROM user_credentials
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("get user credentials: %w", err)
	}
	defer rows.Close()

	var creds []models.UserCredential
	for rows.Next() {
		var cred models.UserCredential
		if err := rows.Scan(
			&cred.ID, &cred.UserID, &cred.Provider, &cred.ProviderURL,
			&cred.APIToken, &cred.DisplayName, &cred.CreatedAt, &cred.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user credential: %w", err)
		}
		creds = append(creds, cred)
	}
	return creds, nil
}

// GetUserCredentialByID retrieves a credential by its ID
func (d *DB) GetUserCredentialByID(id int64) (*models.UserCredential, error) {
	var cred models.UserCredential
	err := d.QueryRow(`
		SELECT id, user_id, provider, provider_url, api_token, display_name, created_at, updated_at
		FROM user_credentials
		WHERE id = ?
	`, id).Scan(
		&cred.ID, &cred.UserID, &cred.Provider, &cred.ProviderURL,
		&cred.APIToken, &cred.DisplayName, &cred.CreatedAt, &cred.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user credential by id: %w", err)
	}
	return &cred, nil
}

// DeleteUserCredential deletes a credential, verifying ownership
func (d *DB) DeleteUserCredential(id, userID int64) error {
	result, err := d.Exec(`
		DELETE FROM user_credentials
		WHERE id = ? AND user_id = ?
	`, id, userID)
	if err != nil {
		return fmt.Errorf("delete user credential: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("credential not found or not owned by user")
	}
	return nil
}

// UpdateUserCredential updates a credential's token and/or display name
func (d *DB) UpdateUserCredential(id, userID int64, apiToken, displayName string) (*models.UserCredential, error) {
	now := time.Now()

	// Build update query dynamically based on what's provided
	if apiToken != "" {
		_, err := d.Exec(`
			UPDATE user_credentials
			SET api_token = ?, display_name = ?, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, apiToken, displayName, now, id, userID)
		if err != nil {
			return nil, fmt.Errorf("update user credential: %w", err)
		}
	} else {
		_, err := d.Exec(`
			UPDATE user_credentials
			SET display_name = ?, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, displayName, now, id, userID)
		if err != nil {
			return nil, fmt.Errorf("update user credential: %w", err)
		}
	}

	return d.GetUserCredentialByID(id)
}
