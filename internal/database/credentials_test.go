package database

import (
	"testing"
)

func TestCreateOrUpdateUserCredential(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	cred, err := d.CreateOrUpdateUserCredential(userID, "github", "", "test-token", "My GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}
	if cred == nil {
		t.Fatal("CreateOrUpdateUserCredential() returned nil")
	}
	if cred.APIToken != "test-token" {
		t.Errorf("cred.APIToken = %q, want %q", cred.APIToken, "test-token")
	}

	// Update the credential
	updated, err := d.CreateOrUpdateUserCredential(userID, "github", "", "new-token", "Updated GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() update error = %v", err)
	}
	if updated.APIToken != "new-token" {
		t.Errorf("updated.APIToken = %q, want %q", updated.APIToken, "new-token")
	}
}

func TestGetUserCredential(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateOrUpdateUserCredential(userID, "gitea", "https://gitea.example.com", "my-token", "My Gitea")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	cred, err := d.GetUserCredential(userID, "gitea", "https://gitea.example.com")
	if err != nil {
		t.Fatalf("GetUserCredential() error = %v", err)
	}
	if cred == nil {
		t.Fatal("GetUserCredential() returned nil")
	}
	if cred.APIToken != "my-token" {
		t.Errorf("cred.APIToken = %q, want %q", cred.APIToken, "my-token")
	}

	notFound, err := d.GetUserCredential(userID, "github", "")
	if err != nil {
		t.Fatalf("GetUserCredential() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetUserCredential() should return nil for non-existent credential")
	}
}

func TestGetUserCredentials(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateOrUpdateUserCredential(userID, "github", "", "token1", "GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}
	_, err = d.CreateOrUpdateUserCredential(userID, "gitea", "https://gitea.example.com", "token2", "Gitea")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	creds, err := d.GetUserCredentials(userID)
	if err != nil {
		t.Fatalf("GetUserCredentials() error = %v", err)
	}
	if len(creds) != 2 {
		t.Errorf("len(creds) = %d, want 2", len(creds))
	}
}

func TestDeleteUserCredential(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	cred, err := d.CreateOrUpdateUserCredential(userID, "github", "", "token", "GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	err = d.DeleteUserCredential(cred.ID, userID)
	if err != nil {
		t.Fatalf("DeleteUserCredential() error = %v", err)
	}

	notFound, err := d.GetUserCredentialByID(cred.ID)
	if err != nil {
		t.Fatalf("GetUserCredentialByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("credential should be deleted")
	}
}

func TestDeleteUserCredential_WrongUser(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	otherUser, err := d.CreateUser("other@example.com", "hashedpw", "Other User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	cred, err := d.CreateOrUpdateUserCredential(userID, "github", "", "token", "GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	err = d.DeleteUserCredential(cred.ID, otherUser.ID)
	if err == nil {
		t.Error("DeleteUserCredential() should fail for wrong user")
	}
}

func TestGetUserCredentialByID(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateOrUpdateUserCredential(userID, "github", "", "token", "GitHub")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	cred, err := d.GetUserCredentialByID(created.ID)
	if err != nil {
		t.Fatalf("GetUserCredentialByID() error = %v", err)
	}
	if cred == nil {
		t.Fatal("GetUserCredentialByID() returned nil")
	}
	if cred.ID != created.ID {
		t.Errorf("cred.ID = %d, want %d", cred.ID, created.ID)
	}

	notFound, err := d.GetUserCredentialByID(99999)
	if err != nil {
		t.Fatalf("GetUserCredentialByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetUserCredentialByID() should return nil for non-existent ID")
	}
}

func TestUpdateUserCredential(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateOrUpdateUserCredential(userID, "github", "", "old-token", "Old Name")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	updated, err := d.UpdateUserCredential(created.ID, userID, "new-token", "New Name")
	if err != nil {
		t.Fatalf("UpdateUserCredential() error = %v", err)
	}
	if updated.APIToken != "new-token" {
		t.Errorf("updated.APIToken = %q, want %q", updated.APIToken, "new-token")
	}
	if updated.DisplayName != "New Name" {
		t.Errorf("updated.DisplayName = %q, want %q", updated.DisplayName, "New Name")
	}
}

func TestUpdateUserCredential_EmptyToken(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateOrUpdateUserCredential(userID, "github", "", "keep-token", "Old Name")
	if err != nil {
		t.Fatalf("CreateOrUpdateUserCredential() error = %v", err)
	}

	updated, err := d.UpdateUserCredential(created.ID, userID, "", "Updated Name")
	if err != nil {
		t.Fatalf("UpdateUserCredential() error = %v", err)
	}
	if updated.APIToken != "keep-token" {
		t.Errorf("updated.APIToken = %q, want %q", updated.APIToken, "keep-token")
	}
}
