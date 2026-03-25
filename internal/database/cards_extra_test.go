package database

import (
	"testing"
	"time"
)

func TestSearchCards(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, columnID, swimlaneID := createTestScaffolding(t, d)
	_ = userID

	_, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Test Card One",
		Description:  "Description one",
		State:        "open",
		Priority:     "high",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	_, err = d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 2,
		Title:        "Test Card Two",
		Description:  "Description two",
		State:        "closed",
		Priority:     "low",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	// Search by query
	cards, total, err := d.SearchCards(CardSearchParams{
		BoardID: boardID,
		Query:   "One",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("SearchCards() error = %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want 1", total)
	}
	if len(cards) != 1 {
		t.Errorf("len(cards) = %d, want 1", len(cards))
	}

	// Search by priority
	cards, total, err = d.SearchCards(CardSearchParams{
		BoardID:  boardID,
		Priority: "high",
		Limit:    10,
	})
	if err != nil {
		t.Fatalf("SearchCards() error = %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want 1", total)
	}

	// Search by state
	cards, total, err = d.SearchCards(CardSearchParams{
		BoardID: boardID,
		State:   "closed",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("SearchCards() error = %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want 1", total)
	}
}

func TestUpdateCard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Original Title",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	card.Title = "Updated Title"
	card.Description = "Updated Description"
	card.Priority = "high"
	storyPoints := 5
	card.StoryPoints = &storyPoints

	err = d.UpdateCard(card)
	if err != nil {
		t.Fatalf("UpdateCard() error = %v", err)
	}

	updated, err := d.GetCardByID(card.ID)
	if err != nil {
		t.Fatalf("GetCardByID() error = %v", err)
	}
	if updated.Title != "Updated Title" {
		t.Errorf("updated.Title = %q, want %q", updated.Title, "Updated Title")
	}
	if updated.Priority != "high" {
		t.Errorf("updated.Priority = %q, want %q", updated.Priority, "high")
	}
}

func TestListCardsForSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "Goal", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	_, err = d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		SprintID:     &sprint.ID,
		GiteaIssueID: 1,
		Title:        "Sprint Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	cards, err := d.ListCardsForSprint(sprint.ID)
	if err != nil {
		t.Fatalf("ListCardsForSprint() error = %v", err)
	}
	if len(cards) != 1 {
		t.Errorf("len(cards) = %d, want 1", len(cards))
	}
}

func TestBulkMoveCards(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	card1, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Card 1",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	card2, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 2,
		Title:        "Card 2",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	col, err := d.CreateColumn(boardID, "New Column", "open")
	if err != nil {
		t.Fatalf("CreateColumn() error = %v", err)
	}

	err = d.BulkMoveCards([]int64{card1.ID, card2.ID}, col.ID, "open")
	if err != nil {
		t.Fatalf("BulkMoveCards() error = %v", err)
	}

	updated1, _ := d.GetCardByID(card1.ID)
	updated2, _ := d.GetCardByID(card2.ID)
	if updated1.ColumnID != col.ID {
		t.Errorf("updated1.ColumnID = %d, want %d", updated1.ColumnID, col.ID)
	}
	if updated2.ColumnID != col.ID {
		t.Errorf("updated2.ColumnID = %d, want %d", updated2.ColumnID, col.ID)
	}
}

func TestBulkAssignSprint(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	sprint, err := d.CreateSprint(boardID, "Sprint 1", "Goal", nil, nil)
	if err != nil {
		t.Fatalf("CreateSprint() error = %v", err)
	}

	card1, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Card 1",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	card2, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 2,
		Title:        "Card 2",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	sprintID := sprint.ID
	err = d.BulkAssignSprint([]int64{card1.ID, card2.ID}, &sprintID)
	if err != nil {
		t.Fatalf("BulkAssignSprint() error = %v", err)
	}

	updated1, _ := d.GetCardByID(card1.ID)
	updated2, _ := d.GetCardByID(card2.ID)
	if updated1.SprintID == nil || *updated1.SprintID != sprint.ID {
		t.Errorf("updated1.SprintID should be %d", sprint.ID)
	}
	if updated2.SprintID == nil || *updated2.SprintID != sprint.ID {
		t.Errorf("updated2.SprintID should be %d", sprint.ID)
	}
}

func TestBulkDeleteCards(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	card1, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Card 1",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	card2, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 2,
		Title:        "Card 2",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	err = d.BulkDeleteCards([]int64{card1.ID, card2.ID})
	if err != nil {
		t.Fatalf("BulkDeleteCards() error = %v", err)
	}

	deleted1, _ := d.GetCardByID(card1.ID)
	deleted2, _ := d.GetCardByID(card2.ID)
	if deleted1 != nil {
		t.Error("card1 should be deleted")
	}
	if deleted2 != nil {
		t.Error("card2 should be deleted")
	}
}

func TestListChildCards(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	parent, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Parent Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	_, err = d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		ParentID:     &parent.ID,
		GiteaIssueID: 2,
		Title:        "Child Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	children, err := d.ListChildCards(parent.ID)
	if err != nil {
		t.Fatalf("ListChildCards() error = %v", err)
	}
	if len(children) != 1 {
		t.Errorf("len(children) = %d, want 1", len(children))
	}
}

func TestGetUserAssignedCards(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Assigned Card",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	err = d.AddCardAssignee(card.ID, userID)
	if err != nil {
		t.Fatalf("AddCardAssignee() error = %v", err)
	}

	cards, err := d.GetUserAssignedCards(userID, 10)
	if err != nil {
		t.Fatalf("GetUserAssignedCards() error = %v", err)
	}
	if len(cards) == 0 {
		t.Error("GetUserAssignedCards() returned empty list")
	}
}

func TestDeleteCard(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "To Delete",
		State:        "open",
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}

	err = d.DeleteCard(card.ID)
	if err != nil {
		t.Fatalf("DeleteCard() error = %v", err)
	}

	deleted, _ := d.GetCardByID(card.ID)
	if deleted != nil {
		t.Error("card should be deleted")
	}
}

func TestCreateCard_WithDueDate(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

	dueDate := time.Now().Add(24 * time.Hour)
	card, err := d.CreateCard(CreateCardInput{
		BoardID:      boardID,
		SwimlaneID:   swimlaneID,
		ColumnID:     columnID,
		GiteaIssueID: 1,
		Title:        "Card With Due Date",
		State:        "open",
		DueDate:      &dueDate,
	})
	if err != nil {
		t.Fatalf("CreateCard() error = %v", err)
	}
	if card.DueDate == nil {
		t.Error("card.DueDate should not be nil")
	}
}
