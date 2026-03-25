package database

import (
	"testing"
)

func TestCreateCustomFieldDefinition(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	field, err := d.CreateCustomFieldDefinition(boardID, "Priority", "select", "high,medium,low", true)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}
	if field == nil {
		t.Fatal("CreateCustomFieldDefinition() returned nil")
	}
	if field.Name != "Priority" {
		t.Errorf("field.Name = %q, want %q", field.Name, "Priority")
	}
	if field.FieldType != "select" {
		t.Errorf("field.FieldType = %q, want %q", field.FieldType, "select")
	}
	if !field.Required {
		t.Error("field.Required should be true")
	}
}

func TestGetCustomFieldDefinition(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateCustomFieldDefinition(boardID, "Status", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	field, err := d.GetCustomFieldDefinition(created.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldDefinition() error = %v", err)
	}
	if field == nil {
		t.Fatal("GetCustomFieldDefinition() returned nil")
	}
	if field.Name != "Status" {
		t.Errorf("field.Name = %q, want %q", field.Name, "Status")
	}

	notFound, err := d.GetCustomFieldDefinition(99999)
	if err != nil {
		t.Fatalf("GetCustomFieldDefinition() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetCustomFieldDefinition() should return nil for non-existent field")
	}
}

func TestListCustomFieldsForBoard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateCustomFieldDefinition(boardID, "Field 1", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}
	_, err = d.CreateCustomFieldDefinition(boardID, "Field 2", "number", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	fields, err := d.ListCustomFieldsForBoard(boardID)
	if err != nil {
		t.Fatalf("ListCustomFieldsForBoard() error = %v", err)
	}
	if len(fields) != 2 {
		t.Errorf("len(fields) = %d, want 2", len(fields))
	}
}

func TestUpdateCustomFieldDefinition(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	field, err := d.CreateCustomFieldDefinition(boardID, "Original", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	err = d.UpdateCustomFieldDefinition(field.ID, "Updated", "select", "a,b,c", true)
	if err != nil {
		t.Fatalf("UpdateCustomFieldDefinition() error = %v", err)
	}

	updated, err := d.GetCustomFieldDefinition(field.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldDefinition() error = %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("updated.Name = %q, want %q", updated.Name, "Updated")
	}
	if updated.FieldType != "select" {
		t.Errorf("updated.FieldType = %q, want %q", updated.FieldType, "select")
	}
}

func TestDeleteCustomFieldDefinition(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	field, err := d.CreateCustomFieldDefinition(boardID, "Deletable", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	err = d.DeleteCustomFieldDefinition(field.ID)
	if err != nil {
		t.Fatalf("DeleteCustomFieldDefinition() error = %v", err)
	}

	notFound, err := d.GetCustomFieldDefinition(field.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldDefinition() error = %v", err)
	}
	if notFound != nil {
		t.Error("field should be deleted")
	}
}

func TestSetAndGetCustomFieldValue(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	field, err := d.CreateCustomFieldDefinition(boardID, "Priority", "select", "high,low", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Test Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	err = d.SetCustomFieldValue(card.ID, field.ID, "high")
	if err != nil {
		t.Fatalf("SetCustomFieldValue() error = %v", err)
	}

	value, err := d.GetCustomFieldValue(card.ID, field.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldValue() error = %v", err)
	}
	if value == nil {
		t.Fatal("GetCustomFieldValue() returned nil")
	}
	if value.Value != "high" {
		t.Errorf("value.Value = %q, want %q", value.Value, "high")
	}

	// Update the value
	err = d.SetCustomFieldValue(card.ID, field.ID, "low")
	if err != nil {
		t.Fatalf("SetCustomFieldValue() update error = %v", err)
	}

	updated, err := d.GetCustomFieldValue(card.ID, field.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldValue() error = %v", err)
	}
	if updated.Value != "low" {
		t.Errorf("updated.Value = %q, want %q", updated.Value, "low")
	}
}

func TestGetCustomFieldValuesForCard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	field1, err := d.CreateCustomFieldDefinition(boardID, "Field 1", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}
	field2, err := d.CreateCustomFieldDefinition(boardID, "Field 2", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Test Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	d.SetCustomFieldValue(card.ID, field1.ID, "value1")
	d.SetCustomFieldValue(card.ID, field2.ID, "value2")

	values, err := d.GetCustomFieldValuesForCard(card.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldValuesForCard() error = %v", err)
	}
	if len(values) != 2 {
		t.Errorf("len(values) = %d, want 2", len(values))
	}
}

func TestDeleteCustomFieldValue(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	field, err := d.CreateCustomFieldDefinition(boardID, "Deletable", "text", "", false)
	if err != nil {
		t.Fatalf("CreateCustomFieldDefinition() error = %v", err)
	}

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Test Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	d.SetCustomFieldValue(card.ID, field.ID, "value")

	err = d.DeleteCustomFieldValue(card.ID, field.ID)
	if err != nil {
		t.Fatalf("DeleteCustomFieldValue() error = %v", err)
	}

	notFound, err := d.GetCustomFieldValue(card.ID, field.ID)
	if err != nil {
		t.Fatalf("GetCustomFieldValue() error = %v", err)
	}
	if notFound != nil {
		t.Error("value should be deleted")
	}
}

func TestGetCustomFieldValue_NotFound(t *testing.T) {
	d := setupTestDB(t)

	value, err := d.GetCustomFieldValue(99999, 99999)
	if err != nil {
		t.Fatalf("GetCustomFieldValue() error = %v", err)
	}
	if value != nil {
		t.Error("GetCustomFieldValue() should return nil for non-existent value")
	}
}
