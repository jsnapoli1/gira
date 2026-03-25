package database

import (
	"testing"
)

func TestCreateIssueType(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	issueType, err := d.CreateIssueType(boardID, "Bug", "bug", "#ff0000")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}
	if issueType == nil {
		t.Fatal("CreateIssueType() returned nil")
	}
	if issueType.Name != "Bug" {
		t.Errorf("issueType.Name = %q, want %q", issueType.Name, "Bug")
	}
	if issueType.Icon != "bug" {
		t.Errorf("issueType.Icon = %q, want %q", issueType.Icon, "bug")
	}
	if issueType.Color != "#ff0000" {
		t.Errorf("issueType.Color = %q, want %q", issueType.Color, "#ff0000")
	}
}

func TestListIssueTypes(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateIssueType(boardID, "Bug", "bug", "#ff0000")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}
	_, err = d.CreateIssueType(boardID, "Feature", "star", "#00ff00")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}

	types, err := d.ListIssueTypes(boardID)
	if err != nil {
		t.Fatalf("ListIssueTypes() error = %v", err)
	}
	if len(types) != 2 {
		t.Errorf("len(types) = %d, want 2", len(types))
	}
}

func TestGetIssueType(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateIssueType(boardID, "Task", "check", "#0000ff")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}

	issueType, err := d.GetIssueType(created.ID)
	if err != nil {
		t.Fatalf("GetIssueType() error = %v", err)
	}
	if issueType == nil {
		t.Fatal("GetIssueType() returned nil")
	}
	if issueType.Name != "Task" {
		t.Errorf("issueType.Name = %q, want %q", issueType.Name, "Task")
	}

	// Test non-existent issue type
	_, err = d.GetIssueType(99999)
	if err == nil {
		t.Error("GetIssueType() should return error for non-existent ID")
	}
}

func TestUpdateIssueType(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateIssueType(boardID, "Original", "icon", "#ffffff")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}

	err = d.UpdateIssueType(created.ID, "Updated", "new-icon", "#000000")
	if err != nil {
		t.Fatalf("UpdateIssueType() error = %v", err)
	}

	updated, err := d.GetIssueType(created.ID)
	if err != nil {
		t.Fatalf("GetIssueType() error = %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("updated.Name = %q, want %q", updated.Name, "Updated")
	}
	if updated.Icon != "new-icon" {
		t.Errorf("updated.Icon = %q, want %q", updated.Icon, "new-icon")
	}

	// Test updating non-existent issue type
	err = d.UpdateIssueType(99999, "Name", "icon", "#000")
	if err == nil {
		t.Error("UpdateIssueType() should return error for non-existent ID")
	}
}

func TestDeleteIssueType(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateIssueType(boardID, "Deletable", "trash", "#ff0000")
	if err != nil {
		t.Fatalf("CreateIssueType() error = %v", err)
	}

	err = d.DeleteIssueType(created.ID)
	if err != nil {
		t.Fatalf("DeleteIssueType() error = %v", err)
	}

	// Test deleting non-existent issue type
	err = d.DeleteIssueType(99999)
	if err == nil {
		t.Error("DeleteIssueType() should return error for non-existent ID")
	}
}
