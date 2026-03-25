package database

import (
	"testing"
)

func TestCreateComment(t *testing.T) {
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

	comment, err := d.CreateComment(card.ID, userID, "This is a test comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}
	if comment == nil {
		t.Fatal("CreateComment() returned nil")
	}
	if comment.Body != "This is a test comment" {
		t.Errorf("comment.Body = %q, want %q", comment.Body, "This is a test comment")
	}
	if comment.UserID != userID {
		t.Errorf("comment.UserID = %d, want %d", comment.UserID, userID)
	}
}

func TestGetCommentByID(t *testing.T) {
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

	created, err := d.CreateComment(card.ID, userID, "Test", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	comment, err := d.GetCommentByID(created.ID)
	if err != nil {
		t.Fatalf("GetCommentByID() error = %v", err)
	}
	if comment == nil {
		t.Fatal("GetCommentByID() returned nil")
	}
	if comment.ID != created.ID {
		t.Errorf("comment.ID = %d, want %d", comment.ID, created.ID)
	}

	notFound, err := d.GetCommentByID(99999)
	if err != nil {
		t.Fatalf("GetCommentByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetCommentByID() should return nil for non-existent comment")
	}
}

func TestGetCommentsForCard(t *testing.T) {
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

	_, err = d.CreateComment(card.ID, userID, "First comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}
	_, err = d.CreateComment(card.ID, userID, "Second comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	comments, err := d.GetCommentsForCard(card.ID)
	if err != nil {
		t.Fatalf("GetCommentsForCard() error = %v", err)
	}
	if len(comments) != 2 {
		t.Errorf("len(comments) = %d, want 2", len(comments))
	}
}

func TestDeleteComment(t *testing.T) {
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

	comment, err := d.CreateComment(card.ID, userID, "To be deleted", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	err = d.DeleteComment(comment.ID)
	if err != nil {
		t.Fatalf("DeleteComment() error = %v", err)
	}

	notFound, err := d.GetCommentByID(comment.ID)
	if err != nil {
		t.Fatalf("GetCommentByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("comment should be nil after deletion")
	}
}

func TestCreateReplyComment(t *testing.T) {
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

	parent, err := d.CreateComment(card.ID, userID, "Parent comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	parentID := parent.ID
	reply, err := d.CreateComment(card.ID, userID, "Reply comment", &parentID)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}
	if reply.ParentCommentID == nil {
		t.Fatal("reply.ParentCommentID should not be nil")
	}
	if *reply.ParentCommentID != parent.ID {
		t.Errorf("*reply.ParentCommentID = %d, want %d", *reply.ParentCommentID, parent.ID)
	}
}
