package database

import (
	"testing"
	"time"

	"github.com/jsnapoli/gira/internal/models"
)

// createTestSprint is a helper that creates a sprint on the given board.
func createTestSprint(t *testing.T, d *DB, boardID int64, name string) int64 {
	t.Helper()
	sprint, err := d.CreateSprint(boardID, name, "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint(%q) error = %v", name, err)
	}
	return sprint.ID
}

// TestGetSprintByID verifies basic sprint lookup and that board_id is correct.
func TestGetSprintByID(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprintID := createTestSprint(t, d, boardID, "Sprint 1")

	sprint, err := d.GetSprintByID(sprintID)
	if err != nil {
		t.Fatalf("GetSprintByID() error = %v", err)
	}
	if sprint == nil {
		t.Fatal("GetSprintByID() returned nil, want non-nil")
	}
	if sprint.BoardID != boardID {
		t.Errorf("sprint.BoardID = %d, want %d", sprint.BoardID, boardID)
	}
	if sprint.Name != "Sprint 1" {
		t.Errorf("sprint.Name = %q, want %q", sprint.Name, "Sprint 1")
	}
	if sprint.Status != "planning" {
		t.Errorf("sprint.Status = %q, want %q", sprint.Status, "planning")
	}
}

// TestGetSprintByIDNotFound verifies a missing sprint returns nil without error.
func TestGetSprintByIDNotFound(t *testing.T) {
	d := setupTestDB(t)

	sprint, err := d.GetSprintByID(99999)
	if err != nil {
		t.Fatalf("GetSprintByID(missing) error = %v, want nil", err)
	}
	if sprint != nil {
		t.Errorf("GetSprintByID(missing) = %+v, want nil", sprint)
	}
}

// TestAssignCardToSprintCrossBoardValidation is a DB-level helper test.
// It confirms that GetSprintByID reliably exposes the sprint's board_id so
// the handler-level cross-board guard (handleAssignCardSprint) can enforce it.
//
// Scenario: two boards, each with their own sprint; assigning a card from
// board A to board B's sprint must be caught at the handler layer. This test
// verifies the DB primitives return the information needed for that check.
func TestAssignCardToSprintCrossBoardValidation(t *testing.T) {
	d := setupTestDB(t)

	// Board A scaffolding
	_, boardAID, columnAID, swimlaneAID := createTestScaffolding(t, d)
	sprintA := createTestSprint(t, d, boardAID, "Sprint A")

	// Board B — create a second board by creating another user/board pair
	userB, err := d.CreateUser("b@example.com", "hashedpw", "User B")
	if err != nil {
		t.Fatalf("CreateUser board B: %v", err)
	}
	boardB, err := d.CreateBoard("Board B", "", userB.ID)
	if err != nil {
		t.Fatalf("CreateBoard B: %v", err)
	}
	sprintB := createTestSprint(t, d, boardB.ID, "Sprint B")

	// Create a card on board A
	card, err := d.CreateCard(CreateCardInput{
		BoardID:    boardAID,
		SwimlaneID: swimlaneAID,
		ColumnID:   columnAID,
		Title:      "Card on A",
		State:      "open",
		Priority:   "medium",
	})
	if err != nil {
		t.Fatalf("CreateCard: %v", err)
	}

	// Verify sprint A belongs to board A — same board, should pass validation.
	fetchedSprintA, err := d.GetSprintByID(sprintA)
	if err != nil {
		t.Fatalf("GetSprintByID(A): %v", err)
	}
	if fetchedSprintA.BoardID != boardAID {
		t.Errorf("sprintA.BoardID = %d, want %d (same-board check should pass)", fetchedSprintA.BoardID, boardAID)
	}

	// Verify sprint B belongs to board B — cross-board, should fail validation.
	fetchedSprintB, err := d.GetSprintByID(sprintB)
	if err != nil {
		t.Fatalf("GetSprintByID(B): %v", err)
	}
	if fetchedSprintB.BoardID != boardB.ID {
		t.Errorf("sprintB.BoardID = %d, want %d", fetchedSprintB.BoardID, boardB.ID)
	}
	if fetchedSprintB.BoardID == card.BoardID {
		t.Errorf("sprintB.BoardID unexpectedly equals card.BoardID — cross-board guard would not trigger")
	}

	// Assign card to its own board's sprint — must succeed.
	if err := d.AssignCardToSprint(card.ID, &sprintA); err != nil {
		t.Fatalf("AssignCardToSprint(same board) error = %v", err)
	}

	// Confirm the assignment persisted.
	fetched, err := d.GetCardByID(card.ID)
	if err != nil {
		t.Fatalf("GetCardByID: %v", err)
	}
	if fetched.SprintID == nil || *fetched.SprintID != sprintA {
		t.Errorf("card.SprintID = %v, want %d", fetched.SprintID, sprintA)
	}

	// Clearing the sprint assignment (nil) must also succeed.
	if err := d.AssignCardToSprint(card.ID, nil); err != nil {
		t.Fatalf("AssignCardToSprint(nil) error = %v", err)
	}
	fetched, err = d.GetCardByID(card.ID)
	if err != nil {
		t.Fatalf("GetCardByID after clear: %v", err)
	}
	if fetched.SprintID != nil {
		t.Errorf("card.SprintID = %v, want nil after clearing", fetched.SprintID)
	}
	_ = sprintB // used in cross-board assertions above
}

func TestListSprintsForBoard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateSprint(boardID, "Sprint 1", "Goal 1", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}
	_, err = d.CreateSprint(boardID, "Sprint 2", "Goal 2", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	sprints, err := d.ListSprintsForBoard(boardID)
	if err != nil {
		t.Fatalf("ListSprintsForBoard() error = %v", err)
	}
	if len(sprints) != 2 {
		t.Errorf("len(sprints) = %d, want 2", len(sprints))
	}
}

func TestGetActiveSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	active, err := d.GetActiveSprint(boardID)
	if err != nil {
		t.Fatalf("GetActiveSprint() error = %v", err)
	}
	// No active sprint yet (status is 'planning')
	if active != nil {
		t.Error("GetActiveSprint() should return nil for planning sprint")
	}

	d.StartSprint(sprint.ID)

	active, err = d.GetActiveSprint(boardID)
	if err != nil {
		t.Fatalf("GetActiveSprint() error = %v", err)
	}
	if active == nil {
		t.Fatal("GetActiveSprint() returned nil after starting sprint")
	}
	if active.Status != "active" {
		t.Errorf("active.Status = %q, want %q", active.Status, "active")
	}
}

func TestUpdateSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Original", "Old Goal", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	sprint.Name = "Updated"
	sprint.Goal = "New Goal"

	err = d.UpdateSprint(sprint)
	if err != nil {
		t.Fatalf("UpdateSprint() error = %v", err)
	}

	updated, err := d.GetSprintByID(sprint.ID)
	if err != nil {
		t.Fatalf("GetSprintByID() error = %v", err)
	}
	if updated.Name != "Updated" {
		t.Errorf("updated.Name = %q, want %q", updated.Name, "Updated")
	}
}

func TestStartAndCompleteSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	err = d.StartSprint(sprint.ID)
	if err != nil {
		t.Fatalf("StartSprint() error = %v", err)
	}

	started, _ := d.GetSprintByID(sprint.ID)
	if started.Status != "active" {
		t.Errorf("started.Status = %q, want %q", started.Status, "active")
	}

	err = d.CompleteSprint(sprint.ID)
	if err != nil {
		t.Fatalf("CompleteSprint() error = %v", err)
	}

	completed, _ := d.GetSprintByID(sprint.ID)
	if completed.Status != "completed" {
		t.Errorf("completed.Status = %q, want %q", completed.Status, "completed")
	}
}

func TestDeleteSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Deletable", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	err = d.DeleteSprint(sprint.ID)
	if err != nil {
		t.Fatalf("DeleteSprint() error = %v", err)
	}

	notFound, _ := d.GetSprintByID(sprint.ID)
	if notFound != nil {
		t.Error("sprint should be deleted")
	}
}

func TestRecordAndGetSprintMetrics(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	metrics := models.SprintMetrics{
		SprintID:        sprint.ID,
		Date:            time.Now(),
		TotalPoints:     10,
		CompletedPoints: 5,
		RemainingPoints: 5,
		TotalCards:      3,
		CompletedCards:  1,
	}

	err = d.RecordSprintMetrics(sprint.ID, metrics)
	if err != nil {
		t.Fatalf("RecordSprintMetrics() error = %v", err)
	}

	retrieved, err := d.GetSprintMetrics(sprint.ID)
	if err != nil {
		t.Fatalf("GetSprintMetrics() error = %v", err)
	}
	if len(retrieved) != 1 {
		t.Errorf("len(retrieved) = %d, want 1", len(retrieved))
	}
	if retrieved[0].TotalPoints != 10 {
		t.Errorf("retrieved[0].TotalPoints = %d, want 10", retrieved[0].TotalPoints)
	}
}

func TestCalculateCurrentSprintMetrics(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	points := 5
	_, err = d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		SprintID:     &sprint.ID,
		GiteaIssueID: 1,
		Title:        "Card 1",
		State:        "open",
		StoryPoints:  &points,
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	metrics, err := d.CalculateCurrentSprintMetrics(sprint.ID)
	if err != nil {
		t.Fatalf("CalculateCurrentSprintMetrics() error = %v", err)
	}
	if metrics.TotalCards != 1 {
		t.Errorf("metrics.TotalCards = %d, want 1", metrics.TotalCards)
	}
	if metrics.TotalPoints != 5 {
		t.Errorf("metrics.TotalPoints = %d, want 5", metrics.TotalPoints)
	}
}
