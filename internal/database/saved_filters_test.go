package database

import (
	"testing"
)

func TestCreateSavedFilter(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	filter, err := d.CreateSavedFilter(boardID, userID, "My Filter", `{"assignee":1}`, false)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}
	if filter == nil {
		t.Fatal("CreateSavedFilter() returned nil")
	}
	if filter.Name != "My Filter" {
		t.Errorf("filter.Name = %q, want %q", filter.Name, "My Filter")
	}
	if filter.IsShared {
		t.Error("filter.IsShared should be false")
	}
}

func TestListSavedFilters(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateSavedFilter(boardID, userID, "Filter 1", `{}`, false)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}
	_, err = d.CreateSavedFilter(boardID, userID, "Filter 2", `{}`, true)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}

	filters, err := d.ListSavedFilters(boardID, userID)
	if err != nil {
		t.Fatalf("ListSavedFilters() error = %v", err)
	}
	if len(filters) != 2 {
		t.Errorf("len(filters) = %d, want 2", len(filters))
	}
}

func TestGetSavedFilterByID(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateSavedFilter(boardID, userID, "Test Filter", `{}`, false)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}

	filter, err := d.GetSavedFilterByID(created.ID)
	if err != nil {
		t.Fatalf("GetSavedFilterByID() error = %v", err)
	}
	if filter == nil {
		t.Fatal("GetSavedFilterByID() returned nil")
	}
	if filter.Name != "Test Filter" {
		t.Errorf("filter.Name = %q, want %q", filter.Name, "Test Filter")
	}

	// Test non-existent filter
	notFound, err := d.GetSavedFilterByID(99999)
	if err != nil {
		t.Fatalf("GetSavedFilterByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetSavedFilterByID() should return nil for non-existent filter")
	}
}

func TestUpdateSavedFilter(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateSavedFilter(boardID, userID, "Original", `{}`, false)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}

	err = d.UpdateSavedFilter(created.ID, "Updated", `{"priority":"high"}`, true)
	if err != nil {
		t.Fatalf("UpdateSavedFilter() error = %v", err)
	}

	updated, err := d.GetSavedFilterByID(created.ID)
	if err != nil {
		t.Fatalf("GetSavedFilterByID() error = %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("updated.Name = %q, want %q", updated.Name, "Updated")
	}
	if !updated.IsShared {
		t.Error("updated.IsShared should be true")
	}
}

func TestDeleteSavedFilter(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateSavedFilter(boardID, userID, "Deletable", `{}`, false)
	if err != nil {
		t.Fatalf("CreateSavedFilter() error = %v", err)
	}

	err = d.DeleteSavedFilter(created.ID)
	if err != nil {
		t.Fatalf("DeleteSavedFilter() error = %v", err)
	}

	notFound, err := d.GetSavedFilterByID(created.ID)
	if err != nil {
		t.Fatalf("GetSavedFilterByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("filter should be deleted")
	}
}
