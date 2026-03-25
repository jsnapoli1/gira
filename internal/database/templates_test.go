package database

import (
	"database/sql"
	"testing"
)

func TestCreateCardTemplate(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	template, err := d.CreateCardTemplate(boardID, "Bug Template", "bug", "Steps to reproduce:\n\nExpected:\n\nActual:")
	if err != nil {
		t.Fatalf("CreateCardTemplate() error = %v", err)
	}
	if template == nil {
		t.Fatal("CreateCardTemplate() returned nil")
	}
	if template.Name != "Bug Template" {
		t.Errorf("template.Name = %q, want %q", template.Name, "Bug Template")
	}
	if template.IssueType != "bug" {
		t.Errorf("template.IssueType = %q, want %q", template.IssueType, "bug")
	}
}

func TestCreateCardTemplate_DefaultIssueType(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	template, err := d.CreateCardTemplate(boardID, "Default Template", "", "Description")
	if err != nil {
		t.Fatalf("CreateCardTemplate() error = %v", err)
	}
	if template.IssueType != "task" {
		t.Errorf("template.IssueType = %q, want %q", template.IssueType, "task")
	}
}

func TestListCardTemplates(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateCardTemplate(boardID, "Template 1", "bug", "")
	if err != nil {
		t.Fatalf("CreateCardTemplate() error = %v", err)
	}
	_, err = d.CreateCardTemplate(boardID, "Template 2", "feature", "")
	if err != nil {
		t.Fatalf("CreateCardTemplate() error = %v", err)
	}

	templates, err := d.ListCardTemplates(boardID)
	if err != nil {
		t.Fatalf("ListCardTemplates() error = %v", err)
	}
	if len(templates) != 2 {
		t.Errorf("len(templates) = %d, want 2", len(templates))
	}
}

func TestDeleteCardTemplate(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateCardTemplate(boardID, "Deletable", "task", "")
	if err != nil {
		t.Fatalf("CreateCardTemplate() error = %v", err)
	}

	err = d.DeleteCardTemplate(created.ID)
	if err != nil {
		t.Fatalf("DeleteCardTemplate() error = %v", err)
	}

	// Test deleting non-existent template
	err = d.DeleteCardTemplate(99999)
	if err != sql.ErrNoRows {
		t.Errorf("DeleteCardTemplate() error = %v, want sql.ErrNoRows", err)
	}
}
