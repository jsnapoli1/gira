package database

import (
	"testing"
)

func TestCreateNotification(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	notification, err := d.CreateNotification(userID, "info", "Test Title", "Test Message", "/test")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}
	if notification == nil {
		t.Fatal("CreateNotification() returned nil")
	}
	if notification.Title != "Test Title" {
		t.Errorf("notification.Title = %q, want %q", notification.Title, "Test Title")
	}
	if notification.Message != "Test Message" {
		t.Errorf("notification.Message = %q, want %q", notification.Message, "Test Message")
	}
	if notification.Link != "/test" {
		t.Errorf("notification.Link = %q, want %q", notification.Link, "/test")
	}
}

func TestGetNotificationByID(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	created, err := d.CreateNotification(userID, "info", "Title", "Message", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	notification, err := d.GetNotificationByID(created.ID)
	if err != nil {
		t.Fatalf("GetNotificationByID() error = %v", err)
	}
	if notification == nil {
		t.Fatal("GetNotificationByID() returned nil")
	}
	if notification.ID != created.ID {
		t.Errorf("notification.ID = %d, want %d", notification.ID, created.ID)
	}

	notFound, err := d.GetNotificationByID(99999)
	if err != nil {
		t.Fatalf("GetNotificationByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("GetNotificationByID() should return nil for non-existent notification")
	}
}

func TestGetNotificationsForUser(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateNotification(userID, "info", "First", "Message 1", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}
	_, err = d.CreateNotification(userID, "warning", "Second", "Message 2", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	notifications, err := d.GetNotificationsForUser(userID, 10)
	if err != nil {
		t.Fatalf("GetNotificationsForUser() error = %v", err)
	}
	if len(notifications) != 2 {
		t.Errorf("len(notifications) = %d, want 2", len(notifications))
	}
}

func TestGetUnreadNotificationCount(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateNotification(userID, "info", "Unread 1", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}
	_, err = d.CreateNotification(userID, "info", "Unread 2", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	count, err := d.GetUnreadNotificationCount(userID)
	if err != nil {
		t.Fatalf("GetUnreadNotificationCount() error = %v", err)
	}
	if count != 2 {
		t.Errorf("count = %d, want 2", count)
	}
}

func TestMarkNotificationRead(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	notification, err := d.CreateNotification(userID, "info", "To Read", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	err = d.MarkNotificationRead(notification.ID)
	if err != nil {
		t.Fatalf("MarkNotificationRead() error = %v", err)
	}

	count, err := d.GetUnreadNotificationCount(userID)
	if err != nil {
		t.Fatalf("GetUnreadNotificationCount() error = %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

func TestMarkAllNotificationsRead(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	_, err := d.CreateNotification(userID, "info", "One", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}
	_, err = d.CreateNotification(userID, "info", "Two", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	err = d.MarkAllNotificationsRead(userID)
	if err != nil {
		t.Fatalf("MarkAllNotificationsRead() error = %v", err)
	}

	count, err := d.GetUnreadNotificationCount(userID)
	if err != nil {
		t.Fatalf("GetUnreadNotificationCount() error = %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

func TestDeleteNotification(t *testing.T) {
	d := setupTestDB(t)
	userID, _, _, _ := createTestScaffolding(t, d)

	notification, err := d.CreateNotification(userID, "info", "To Delete", "", "")
	if err != nil {
		t.Fatalf("CreateNotification() error = %v", err)
	}

	err = d.DeleteNotification(notification.ID)
	if err != nil {
		t.Fatalf("DeleteNotification() error = %v", err)
	}

	notFound, err := d.GetNotificationByID(notification.ID)
	if err != nil {
		t.Fatalf("GetNotificationByID() error = %v", err)
	}
	if notFound != nil {
		t.Error("notification should be nil after deletion")
	}
}
