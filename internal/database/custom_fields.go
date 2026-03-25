package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/gira/internal/models"
)

// Custom Field Definitions

func (d *DB) CreateCustomFieldDefinition(boardID int64, name, fieldType, options string, required bool) (*models.CustomFieldDefinition, error) {
	// Get max position
	var maxPos sql.NullInt64
	d.QueryRow(`SELECT MAX(position) FROM custom_field_definitions WHERE board_id = ?`, boardID).Scan(&maxPos)
	position := 0
	if maxPos.Valid {
		position = int(maxPos.Int64) + 1
	}

	result, err := d.Exec(
		`INSERT INTO custom_field_definitions (board_id, name, field_type, options, required, position) VALUES (?, ?, ?, ?, ?, ?)`,
		boardID, name, fieldType, options, required, position,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create custom field: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return d.GetCustomFieldDefinition(id)
}

func (d *DB) GetCustomFieldDefinition(id int64) (*models.CustomFieldDefinition, error) {
	var field models.CustomFieldDefinition
	var options sql.NullString

	err := d.QueryRow(
		`SELECT id, board_id, name, field_type, options, required, position, created_at
		 FROM custom_field_definitions WHERE id = ?`,
		id,
	).Scan(&field.ID, &field.BoardID, &field.Name, &field.FieldType, &options, &field.Required, &field.Position, &field.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get custom field: %w", err)
	}

	if options.Valid {
		field.Options = options.String
	}

	return &field, nil
}

func (d *DB) ListCustomFieldsForBoard(boardID int64) ([]models.CustomFieldDefinition, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, field_type, options, required, position, created_at
		 FROM custom_field_definitions WHERE board_id = ? ORDER BY position`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list custom fields: %w", err)
	}
	defer rows.Close()

	var fields []models.CustomFieldDefinition
	for rows.Next() {
		var field models.CustomFieldDefinition
		var options sql.NullString

		if err := rows.Scan(&field.ID, &field.BoardID, &field.Name, &field.FieldType, &options, &field.Required, &field.Position, &field.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan custom field: %w", err)
		}

		if options.Valid {
			field.Options = options.String
		}

		fields = append(fields, field)
	}

	return fields, nil
}

func (d *DB) UpdateCustomFieldDefinition(id int64, name, fieldType, options string, required bool) error {
	_, err := d.Exec(
		`UPDATE custom_field_definitions SET name = ?, field_type = ?, options = ?, required = ? WHERE id = ?`,
		name, fieldType, options, required, id,
	)
	return err
}

func (d *DB) DeleteCustomFieldDefinition(id int64) error {
	_, err := d.Exec(`DELETE FROM custom_field_definitions WHERE id = ?`, id)
	return err
}

// Custom Field Values

func (d *DB) SetCustomFieldValue(cardID, fieldID int64, value string) error {
	_, err := d.Exec(
		`INSERT INTO custom_field_values (card_id, field_id, value, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(card_id, field_id) DO UPDATE SET value = ?, updated_at = ?`,
		cardID, fieldID, value, time.Now(), value, time.Now(),
	)
	return err
}

func (d *DB) GetCustomFieldValue(cardID, fieldID int64) (*models.CustomFieldValue, error) {
	var value models.CustomFieldValue
	var valueStr sql.NullString

	err := d.QueryRow(
		`SELECT id, card_id, field_id, value, created_at, updated_at
		 FROM custom_field_values WHERE card_id = ? AND field_id = ?`,
		cardID, fieldID,
	).Scan(&value.ID, &value.CardID, &value.FieldID, &valueStr, &value.CreatedAt, &value.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get custom field value: %w", err)
	}

	if valueStr.Valid {
		value.Value = valueStr.String
	}

	return &value, nil
}

func (d *DB) GetCustomFieldValuesForCard(cardID int64) ([]models.CustomFieldValue, error) {
	rows, err := d.Query(
		`SELECT id, card_id, field_id, value, created_at, updated_at
		 FROM custom_field_values WHERE card_id = ?`,
		cardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get custom field values: %w", err)
	}
	defer rows.Close()

	var values []models.CustomFieldValue
	for rows.Next() {
		var value models.CustomFieldValue
		var valueStr sql.NullString

		if err := rows.Scan(&value.ID, &value.CardID, &value.FieldID, &valueStr, &value.CreatedAt, &value.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan custom field value: %w", err)
		}

		if valueStr.Valid {
			value.Value = valueStr.String
		}

		values = append(values, value)
	}

	return values, nil
}

func (d *DB) DeleteCustomFieldValue(cardID, fieldID int64) error {
	_, err := d.Exec(`DELETE FROM custom_field_values WHERE card_id = ? AND field_id = ?`, cardID, fieldID)
	return err
}
