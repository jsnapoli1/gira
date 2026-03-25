package database

import (
	"testing"
)

func TestBoardTemplateColumns(t *testing.T) {
	tests := []struct {
		name     string
		template string
		expected int
	}{
		{"kanban", "kanban", 3},
		{"scrum", "scrum", 5},
		{"bug_triage", "bug_triage", 5},
		{"default", "", 4},
		{"unknown", "unknown", 4},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cols := BoardTemplateColumns(tt.template)
			if len(cols) != tt.expected {
				t.Errorf("BoardTemplateColumns(%q) returned %d columns, want %d", tt.template, len(cols), tt.expected)
			}
		})
	}
}

func TestListBoardsForUser(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	boards, err := d.ListBoardsForUser(userID)
	if err != nil {
		t.Fatalf("ListBoardsForUser() error = %v", err)
	}
	if len(boards) == 0 {
		t.Error("ListBoardsForUser() returned empty list")
	}
}

func TestUpdateBoard(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)
	_ = userID

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}

	board.Name = "Updated Board"
	board.Description = "Updated Description"

	err = d.UpdateBoard(board)
	if err != nil {
		t.Fatalf("UpdateBoard() error = %v", err)
	}

	updated, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}
	if updated.Name != "Updated Board" {
		t.Errorf("board.Name = %q, want %q", updated.Name, "Updated Board")
	}
	if updated.Description != "Updated Description" {
		t.Errorf("board.Description = %q, want %q", updated.Description, "Updated Description")
	}
}

func TestDeleteBoard(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)
	_ = userID

	err := d.DeleteBoard(boardID)
	if err != nil {
		t.Fatalf("DeleteBoard() error = %v", err)
	}

	board, err := d.GetBoardByID(boardID)
	if err != nil {
		t.Fatalf("GetBoardByID() error = %v", err)
	}
	if board != nil {
		t.Error("board should be nil after deletion")
	}
}

func TestAddBoardMember(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	newUser, err := d.CreateUser("member@example.com", "hashedpw", "Member User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	err = d.AddBoardMember(boardID, newUser.ID, "member")
	if err != nil {
		t.Fatalf("AddBoardMember() error = %v", err)
	}

	isMember, role, err := d.IsBoardMember(boardID, newUser.ID)
	if err != nil {
		t.Fatalf("IsBoardMember() error = %v", err)
	}
	if !isMember {
		t.Error("user should be a board member")
	}
	if role != "member" {
		t.Errorf("role = %q, want %q", role, "member")
	}
	_ = userID
}

func TestRemoveBoardMember(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	newUser, err := d.CreateUser("removable@example.com", "hashedpw", "Removable User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	err = d.AddBoardMember(boardID, newUser.ID, "member")
	if err != nil {
		t.Fatalf("AddBoardMember() error = %v", err)
	}

	err = d.RemoveBoardMember(boardID, newUser.ID)
	if err != nil {
		t.Fatalf("RemoveBoardMember() error = %v", err)
	}

	isMember, _, err := d.IsBoardMember(boardID, newUser.ID)
	if err != nil {
		t.Fatalf("IsBoardMember() error = %v", err)
	}
	if isMember {
		t.Error("user should not be a board member after removal")
	}
	_ = userID
}

func TestUpdateBoardMemberRole(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	newUser, err := d.CreateUser("updatable@example.com", "hashedpw", "Updatable User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	err = d.AddBoardMember(boardID, newUser.ID, "member")
	if err != nil {
		t.Fatalf("AddBoardMember() error = %v", err)
	}

	err = d.UpdateBoardMemberRole(boardID, newUser.ID, "admin")
	if err != nil {
		t.Fatalf("UpdateBoardMemberRole() error = %v", err)
	}

	_, role, err := d.IsBoardMember(boardID, newUser.ID)
	if err != nil {
		t.Fatalf("IsBoardMember() error = %v", err)
	}
	if role != "admin" {
		t.Errorf("role = %q, want %q", role, "admin")
	}
	_ = userID
}

func TestGetBoardMembers(t *testing.T) {
	d := setupTestDB(t)
	userID, boardID, _, _ := createTestScaffolding(t, d)

	members, err := d.GetBoardMembers(boardID)
	if err != nil {
		t.Fatalf("GetBoardMembers() error = %v", err)
	}
	if len(members) == 0 {
		t.Error("GetBoardMembers() returned empty list")
	}

	// Check that owner is in the members list
	found := false
	for _, m := range members {
		if m.UserID == userID {
			found = true
			if m.Role != "admin" {
				t.Errorf("owner role = %q, want %q", m.Role, "admin")
			}
		}
	}
	if !found {
		t.Error("owner not found in board members")
	}
}

func TestCreateColumn(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	col, err := d.CreateColumn(boardID, "New Column", "open")
	if err != nil {
		t.Fatalf("CreateColumn() error = %v", err)
	}
	if col.Name != "New Column" {
		t.Errorf("col.Name = %q, want %q", col.Name, "New Column")
	}
}

func TestDeleteColumn(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	col, err := d.CreateColumn(boardID, "Deletable Column", "open")
	if err != nil {
		t.Fatalf("CreateColumn() error = %v", err)
	}

	err = d.DeleteColumn(col.ID)
	if err != nil {
		t.Fatalf("DeleteColumn() error = %v", err)
	}
}

func TestReorderColumn(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	col, err := d.CreateColumn(boardID, "Reorderable Column", "open")
	if err != nil {
		t.Fatalf("CreateColumn() error = %v", err)
	}

	err = d.ReorderColumn(col.ID, 5)
	if err != nil {
		t.Fatalf("ReorderColumn() error = %v", err)
	}
}

func TestReorderSwimlane(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, swimlaneID := createTestScaffolding(t, d)

	err := d.ReorderSwimlane(swimlaneID, 5)
	if err != nil {
		t.Fatalf("ReorderSwimlane() error = %v", err)
	}
	_ = boardID
}

func TestDeleteSwimlane(t *testing.T) {
	d := setupTestDB(t)
	_, boardID, _, _ := createTestScaffolding(t, d)

	swimlane, err := d.CreateSwimlane(boardID, "Deletable", "owner", "repo", "DEL-", "#ff0000")
	if err != nil {
		t.Fatalf("CreateSwimlane() error = %v", err)
	}

	err = d.DeleteSwimlane(swimlane.ID)
	if err != nil {
		t.Fatalf("DeleteSwimlane() error = %v", err)
	}
}

func TestSetAndGetSwimlaneCredential(t *testing.T) {
	d := setupTestDB(t)
	_, _, _, swimlaneID := createTestScaffolding(t, d)

	err := d.SetSwimlaneCredential(swimlaneID, "my-secret-token")
	if err != nil {
		t.Fatalf("SetSwimlaneCredential() error = %v", err)
	}

	token, err := d.GetSwimlaneCredential(swimlaneID)
	if err != nil {
		t.Fatalf("GetSwimlaneCredential() error = %v", err)
	}
	if token != "my-secret-token" {
		t.Errorf("token = %q, want %q", token, "my-secret-token")
	}
}

func TestGetSwimlaneByID(t *testing.T) {
	d := setupTestDB(t)
	_, _, _, swimlaneID := createTestScaffolding(t, d)

	swimlane, err := d.GetSwimlaneByID(swimlaneID)
	if err != nil {
		t.Fatalf("GetSwimlaneByID() error = %v", err)
	}
	if swimlane == nil {
		t.Fatal("GetSwimlaneByID() returned nil")
	}
	if swimlane.ID != swimlaneID {
		t.Errorf("swimlane.ID = %d, want %d", swimlane.ID, swimlaneID)
	}
}
