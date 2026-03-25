package database

import (
	"testing"
)

func TestAddWatcher(t *testing.T) {
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

	err = d.AddWatcher(card.ID, userID)
	if err != nil {
		t.Fatalf("AddWatcher() error = %v", err)
	}
}

func TestRemoveWatcher(t *testing.T) {
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

	d.AddWatcher(card.ID, userID)

	err = d.RemoveWatcher(card.ID, userID)
	if err != nil {
		t.Fatalf("RemoveWatcher() error = %v", err)
	}
}

func TestGetWatchers(t *testing.T) {
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

	d.AddWatcher(card.ID, userID)

	watchers, err := d.GetWatchers(card.ID)
	if err != nil {
		t.Fatalf("GetWatchers() error = %v", err)
	}
	if len(watchers) != 1 {
		t.Errorf("len(watchers) = %d, want 1", len(watchers))
	}
	if watchers[0].ID != userID {
		t.Errorf("watchers[0].ID = %d, want %d", watchers[0].ID, userID)
	}
}

func TestGetWatchers_Empty(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, columnID, swimlaneID := createTestScaffolding(t, d)

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

	watchers, err := d.GetWatchers(card.ID)
	if err != nil {
		t.Fatalf("GetWatchers() error = %v", err)
	}
	if len(watchers) != 0 {
		t.Errorf("len(watchers) = %d, want 0", len(watchers))
	}
}
