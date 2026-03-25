package database

import (
	"testing"
)

func TestCreateLabel(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	label, err := d.CreateLabel(boardID, "Bug", "#ff0000")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}
	if label == nil {
		t.Fatal("CreateLabel() returned nil")
	}
	if label.Name != "Bug" {
		t.Errorf("label.Name = %q, want %q", label.Name, "Bug")
	}
	if label.Color != "#ff0000" {
		t.Errorf("label.Color = %q, want %q", label.Color, "#ff0000")
	}
}

func TestGetBoardLabels(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateLabel(boardID, "Feature", "#00ff00")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}
	_, err = d.CreateLabel(boardID, "Bug", "#ff0000")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}

	labels, err := d.GetBoardLabels(boardID)
	if err != nil {
		t.Fatalf("GetBoardLabels() error = %v", err)
	}
	if len(labels) != 2 {
		t.Errorf("len(labels) = %d, want 2", len(labels))
	}
}

func TestDeleteLabel(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	label, err := d.CreateLabel(boardID, "Deletable", "#0000ff")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}

	err = d.DeleteLabel(label.ID)
	if err != nil {
		t.Fatalf("DeleteLabel() error = %v", err)
	}

	labels, err := d.GetBoardLabels(boardID)
	if err != nil {
		t.Fatalf("GetBoardLabels() error = %v", err)
	}
	if len(labels) != 0 {
		t.Errorf("len(labels) = %d, want 0", len(labels))
	}
}

func TestUpdateLabel(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	label, err := d.CreateLabel(boardID, "Original", "#ffffff")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}

	updated, err := d.UpdateLabel(label.ID, "Updated", "#000000")
	if err != nil {
		t.Fatalf("UpdateLabel() error = %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("label.Name = %q, want %q", updated.Name, "Updated")
	}
	if updated.Color != "#000000" {
		t.Errorf("label.Color = %q, want %q", updated.Color, "#000000")
	}
}

func TestGetLabelByID(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	label, err := d.CreateLabel(boardID, "Test", "#123456")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
	}

	found, err := d.GetLabelByID(label.ID)
	if err != nil {
		t.Fatalf("GetLabelByID() error = %v", err)
	}
	if found == nil {
		t.Fatal("GetLabelByID() returned nil")
	}
	if found.Name != "Test" {
		t.Errorf("label.Name = %q, want %q", found.Name, "Test")
	}

	notFound, err := d.GetLabelByID(99999)
	if err != nil {
		t.Fatalf("GetLabelByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetLabelByID() should return nil for non-existent label")
	}
}

func TestAddAndRemoveLabelFromCard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	label, err := d.CreateLabel(boardID, "Card Label", "#abcdef")
	if err != nil {
		t.Fatalf("CreateLabel() error = %v", err)
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

	err = d.AddLabelToCard(card.ID, label.ID)
	if err != nil {
		t.Fatalf("AddLabelToCard() error = %v", err)
	}

	labels, err := d.GetCardLabels(card.ID)
	if err != nil {
		t.Fatalf("GetCardLabels() error = %v", err)
	}
	if len(labels) != 1 {
		t.Errorf("len(labels) = %d, want 1", len(labels))
	}

	err = d.RemoveLabelFromCard(card.ID, label.ID)
	if err != nil {
		t.Fatalf("RemoveLabelFromCard() error = %v", err)
	}

	labels, err = d.GetCardLabels(card.ID)
	if err != nil {
		t.Fatalf("GetCardLabels() error = %v", err)
	}
	if len(labels) != 0 {
		t.Errorf("len(labels) = %d, want 0", len(labels))
	}
}
