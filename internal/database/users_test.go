package database

import (
	"testing"
)

func TestCreateUser(t *testing.T) {
	d := setupTestDB(t)

	user, err := d.CreateUser("test@example.com", "hashedpw", "Test User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if user == nil {
		t.Fatal("CreateUser() returned nil")
	}
	if user.Email != "test@example.com" {
		t.Errorf("user.Email = %q, want %q", user.Email, "test@example.com")
	}
	if user.DisplayName != "Test User" {
		t.Errorf("user.DisplayName = %q, want %q", user.DisplayName, "Test User")
	}
	if !user.IsAdmin {
		t.Error("first user should be admin")
	}
}

func TestGetUserByID(t *testing.T) {
	d := setupTestDB(t)

	created, err := d.CreateUser("getbyid@example.com", "hashedpw", "Get By ID")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	user, err := d.GetUserByID(created.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if user == nil {
		t.Fatal("GetUserByID() returned nil")
	}
	if user.ID != created.ID {
		t.Errorf("user.ID = %d, want %d", user.ID, created.ID)
	}

	notFound, err := d.GetUserByID(99999)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetUserByID() should return nil for non-existent user")
	}
}

func TestGetUserByEmail(t *testing.T) {
	d := setupTestDB(t)

	created, err := d.CreateUser("getbyemail@example.com", "hashedpw", "Get By Email")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	user, err := d.GetUserByEmail("getbyemail@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail() error = %v", err)
	}
	if user == nil {
		t.Fatal("GetUserByEmail() returned nil")
	}
	if user.ID != created.ID {
		t.Errorf("user.ID = %d, want %d", user.ID, created.ID)
	}

	notFound, err := d.GetUserByEmail("nonexistent@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetUserByEmail() should return nil for non-existent email")
	}
}

func TestListUsers(t *testing.T) {
	d := setupTestDB(t)

	_, err := d.CreateUser("user1@example.com", "hashedpw", "User 1")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	_, err = d.CreateUser("user2@example.com", "hashedpw", "User 2")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	users, err := d.ListUsers()
	if err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}
	if len(users) < 2 {
		t.Errorf("len(users) = %d, want >= 2", len(users))
	}
}

func TestSetUserAdmin(t *testing.T) {
	d := setupTestDB(t)

	user, err := d.CreateUser("admin@example.com", "hashedpw", "Admin User")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	if !user.IsAdmin {
		t.Error("first user should be admin")
	}

	err = d.SetUserAdmin(user.ID, false)
	if err != nil {
		t.Fatalf("SetUserAdmin() error = %v", err)
	}

	updated, err := d.GetUserByID(user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if updated.IsAdmin {
		t.Error("user should not be admin after SetUserAdmin(false)")
	}

	err = d.SetUserAdmin(user.ID, true)
	if err != nil {
		t.Fatalf("SetUserAdmin() error = %v", err)
	}

	updated, err = d.GetUserByID(user.ID)
	if err != nil {
		t.Fatalf("GetUserByID() error = %v", err)
	}
	if !updated.IsAdmin {
		t.Error("user should be admin after SetUserAdmin(true)")
	}
}

func TestCountAdmins(t *testing.T) {
	d := setupTestDB(t)

	count, err := d.CountAdmins()
	if err != nil {
		t.Fatalf("CountAdmins() error = %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}

	_, err = d.CreateUser("admin1@example.com", "hashedpw", "Admin 1")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	count, err = d.CountAdmins()
	if err != nil {
		t.Fatalf("CountAdmins() error = %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}

	_, err = d.CreateUser("user1@example.com", "hashedpw", "User 1")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	count, err = d.CountAdmins()
	if err != nil {
		t.Fatalf("CountAdmins() error = %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1 (second user should not be admin)", count)
	}
}
