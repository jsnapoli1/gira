package database

import (
	"testing"

	"github.com/jsnapoli/gira/internal/models"
)

func TestGetWorkflowRules(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	rules, err := d.GetWorkflowRules(boardID)
	if err != nil {
		t.Fatalf("GetWorkflowRules() error = %v", err)
	}
	if len(rules) != 0 {
		t.Errorf("len(rules) = %d, want 0", len(rules))
	}
}

func TestSetWorkflowRules(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}

	if len(board.Columns) < 2 {
		t.Fatal("need at least 2 columns for workflow test")
	}

	rules := []models.WorkflowRule{
		{BoardID: boardID, FromColumnID: board.Columns[0].ID, ToColumnID: board.Columns[1].ID},
	}

	err = d.SetWorkflowRules(boardID, rules)
	if err != nil {
		t.Fatalf("SetWorkflowRules() error = %v", err)
	}

	retrieved, err := d.GetWorkflowRules(boardID)
	if err != nil {
		t.Fatalf("GetWorkflowRules() error = %v", err)
	}
	if len(retrieved) != 1 {
		t.Errorf("len(retrieved) = %d, want 1", len(retrieved))
	}
}

func TestIsTransitionAllowed_NoRules(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}

	if len(board.Columns) < 2 {
		t.Fatal("need at least 2 columns for workflow test")
	}

	allowed, err := d.IsTransitionAllowed(boardID, board.Columns[0].ID, board.Columns[1].ID)
	if err != nil {
		t.Fatalf("IsTransitionAllowed() error = %v", err)
	}
	if !allowed {
		t.Error("transition should be allowed when no rules exist")
	}
}

func TestIsTransitionAllowed_SameColumn(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}

	allowed, err := d.IsTransitionAllowed(boardID, board.Columns[0].ID, board.Columns[0].ID)
	if err != nil {
		t.Fatalf("IsTransitionAllowed() error = %v", err)
	}
	if !allowed {
		t.Error("same column transition should always be allowed")
	}
}

func TestIsTransitionAllowed_WithRules(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}

	if len(board.Columns) < 3 {
		t.Fatal("need at least 3 columns for workflow test")
	}

	// Only allow transition from column 0 to column 1
	rules := []models.WorkflowRule{
		{BoardID: boardID, FromColumnID: board.Columns[0].ID, ToColumnID: board.Columns[1].ID},
	}
	d.SetWorkflowRules(boardID, rules)

	// Allowed transition
	allowed, err := d.IsTransitionAllowed(boardID, board.Columns[0].ID, board.Columns[1].ID)
	if err != nil {
		t.Fatalf("IsTransitionAllowed() error = %v", err)
	}
	if !allowed {
		t.Error("transition from col 0 to col 1 should be allowed")
	}

	// Disallowed transition
	allowed, err = d.IsTransitionAllowed(boardID, board.Columns[0].ID, board.Columns[2].ID)
	if err != nil {
		t.Fatalf("IsTransitionAllowed() error = %v", err)
	}
	if allowed {
		t.Error("transition from col 0 to col 2 should not be allowed")
	}
}
