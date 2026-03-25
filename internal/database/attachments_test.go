package database

import (
	"testing"
)

func TestCreateAttachment(t *testing.T) {
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

	attachment, err := d.CreateAttachment(card.ID, userID, "test.pdf", 1024, "application/pdf", "/path/to/test.pdf")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}
	if attachment == nil {
		t.Fatal("CreateAttachment() returned nil")
	}
	if attachment.Filename != "test.pdf" {
		t.Errorf("attachment.Filename = %q, want %q", attachment.Filename, "test.pdf")
	}
	if attachment.Size != 1024 {
		t.Errorf("attachment.Size = %d, want %d", attachment.Size, 1024)
	}
}

func TestGetAttachmentByID(t *testing.T) {
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

	created, err := d.CreateAttachment(card.ID, userID, "test.txt", 500, "text/plain", "/path/to/test.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}

	attachment, err := d.GetAttachmentByID(created.ID)
	if err != nil {
		t.Fatalf("GetAttachmentByID() error = %v", err)
	}
	if attachment == nil {
		t.Fatal("GetAttachmentByID() returned nil")
	}
	if attachment.ID != created.ID {
		t.Errorf("attachment.ID = %d, want %d", attachment.ID, created.ID)
	}

	notFound, err := d.GetAttachmentByID(99999)
	if err != nil {
		t.Fatalf("GetAttachmentByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetAttachmentByID() should return nil for non-existent attachment")
	}
}

func TestGetAttachmentsForCard(t *testing.T) {
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

	_, err = d.CreateAttachment(card.ID, userID, "file1.txt", 100, "text/plain", "/path/file1.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}
	_, err = d.CreateAttachment(card.ID, userID, "file2.txt", 200, "text/plain", "/path/file2.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}

	attachments, err := d.GetAttachmentsForCard(card.ID)
	if err != nil {
		t.Fatalf("GetAttachmentsForCard() error = %v", err)
	}
	if len(attachments) != 2 {
		t.Errorf("len(attachments) = %d, want 2", len(attachments))
	}
}

func TestDeleteAttachment(t *testing.T) {
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

	attachment, err := d.CreateAttachment(card.ID, userID, "deletable.txt", 100, "text/plain", "/path/deletable.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}

	err = d.DeleteAttachment(attachment.ID)
	if err != nil {
		t.Fatalf("DeleteAttachment() error = %v", err)
	}

	notFound, err := d.GetAttachmentByID(attachment.ID)
	if err != nil {
		t.Fatalf("GetAttachmentByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("attachment should be nil after deletion")
	}
}

func TestLinkAttachmentsToComment(t *testing.T) {
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

	att1, err := d.CreateAttachment(card.ID, userID, "file1.txt", 100, "text/plain", "/path/file1.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}
	att2, err := d.CreateAttachment(card.ID, userID, "file2.txt", 200, "text/plain", "/path/file2.txt")
	if err != nil {
		t.Fatalf("CreateAttachment() error = %v", err)
	}

	comment, err := d.CreateComment(card.ID, userID, "Test comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	err = d.LinkAttachmentsToComment(comment.ID, []int64{att1.ID, att2.ID})
	if err != nil {
		t.Fatalf("LinkAttachmentsToComment() error = %v", err)
	}

	attachments, err := d.GetAttachmentsForComment(comment.ID)
	if err != nil {
		t.Fatalf("GetAttachmentsForComment() error = %v", err)
	}
	if len(attachments) != 2 {
		t.Errorf("len(attachments) = %d, want 2", len(attachments))
	}
}

func TestGetAttachmentsForComment(t *testing.T) {
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

	comment, err := d.CreateComment(card.ID, userID, "Test comment", nil)
	if err != nil {
		t.Fatalf("CreateComment() error = %v", err)
	}

	attachments, err := d.GetAttachmentsForComment(comment.ID)
	if err != nil {
		t.Fatalf("GetAttachmentsForComment() error = %v", err)
	}
	if len(attachments) != 0 {
		t.Errorf("len(attachments) = %d, want 0", len(attachments))
	}
}
