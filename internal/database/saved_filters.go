package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/gira/internal/models"
)

func (d *DB) CreateSavedFilter(boardID, ownerID int64, name, filterJSON string, isShared bool) (*models.SavedFilter, error) {
	isSharedInt := 0
	if isShared {
		isSharedInt = 1
	}
	result, err := d.Exec(
		`INSERT INTO saved_filters (board_id, owner_id, name, filter_json, is_shared) VALUES (?, ?, ?, ?, ?)`,
		boardID, ownerID, name, filterJSON, isSharedInt,
	)
	if err != nil {
		return nil, fmt.Errorf("create saved filter: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get last insert id: %w", err)
	}
	return d.GetSavedFilterByID(id)
}

func (d *DB) ListSavedFilters(boardID, userID int64) ([]models.SavedFilter, error) {
	rows, err := d.Query(
		`SELECT id, board_id, owner_id, name, filter_json, is_shared, created_at, updated_at
		 FROM saved_filters
		 WHERE board_id = ? AND (owner_id = ? OR is_shared = 1)
		 ORDER BY name`,
		boardID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list saved filters: %w", err)
	}
	defer rows.Close()

	var filters []models.SavedFilter
	for rows.Next() {
		var f models.SavedFilter
		var isShared int
		if err := rows.Scan(&f.ID, &f.BoardID, &f.OwnerID, &f.Name, &f.FilterJSON, &isShared, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan saved filter: %w", err)
		}
		f.IsShared = isShared == 1
		filters = append(filters, f)
	}
	return filters, rows.Err()
}

func (d *DB) GetSavedFilterByID(id int64) (*models.SavedFilter, error) {
	var f models.SavedFilter
	var isShared int
	err := d.QueryRow(
		`SELECT id, board_id, owner_id, name, filter_json, is_shared, created_at, updated_at
		 FROM saved_filters WHERE id = ?`, id,
	).Scan(&f.ID, &f.BoardID, &f.OwnerID, &f.Name, &f.FilterJSON, &isShared, &f.CreatedAt, &f.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get saved filter: %w", err)
	}
	f.IsShared = isShared == 1
	return &f, nil
}

func (d *DB) UpdateSavedFilter(id int64, name, filterJSON string, isShared bool) error {
	isSharedInt := 0
	if isShared {
		isSharedInt = 1
	}
	_, err := d.Exec(
		`UPDATE saved_filters SET name = ?, filter_json = ?, is_shared = ?, updated_at = ? WHERE id = ?`,
		name, filterJSON, isSharedInt, time.Now(), id,
	)
	if err != nil {
		return fmt.Errorf("update saved filter: %w", err)
	}
	return nil
}

func (d *DB) DeleteSavedFilter(id int64) error {
	_, err := d.Exec(`DELETE FROM saved_filters WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete saved filter: %w", err)
	}
	return nil
}
