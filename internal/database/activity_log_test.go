package database

import (
	"testing"
)

func TestLogActivity(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

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

	cardID := card.ID
	err = d.LogActivity(boardID, &cardID, userID, "create", "card", "title", "", "Test Card")
	if err != nil {
		t.Fatalf("LogActivity() error = %v", err)
	}
}

func TestGetCardActivity(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

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

	cardID := card.ID
	err = d.LogActivity(boardID, &cardID, userID, "create", "card", "", "", "")
	if err != nil {
		t.Fatalf("LogActivity() error = %v", err)
	}
	err = d.LogActivity(boardID, &cardID, userID, "update", "card", "title", "Old", "New")
	if err != nil {
		t.Fatalf("LogActivity() error = %v", err)
	}

	activities, err := d.GetCardActivity(card.ID, 10, 0)
	if err != nil {
		t.Fatalf("GetCardActivity() error = %v", err)
	}
	if len(activities) != 2 {
		t.Errorf("len(activities) = %d, want 2", len(activities))
	}
}

func TestGetBoardActivity(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

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

	cardID := card.ID
	err = d.LogActivity(boardID, &cardID, userID, "create", "card", "", "", "")
	if err != nil {
		t.Fatalf("LogActivity() error = %v", err)
	}

	activities, err := d.GetBoardActivity(boardID, 10, 0)
	if err != nil {
		t.Fatalf("GetBoardActivity() error = %v", err)
	}
	if len(activities) == 0 {
		t.Error("GetBoardActivity() returned empty list")
	}
}

func TestLogActivity_WithoutCard(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	err := d.LogActivity(boardID, nil, userID, "create", "board", "", "", "")
	if err != nil {
		t.Fatalf("LogActivity() error = %v", err)
	}

	activities, err := d.GetBoardActivity(boardID, 10, 0)
	if err != nil {
		t.Fatalf("GetBoardActivity() error = %v", err)
	}
	if len(activities) == 0 {
		t.Error("GetBoardActivity() returned empty list")
	}
}
