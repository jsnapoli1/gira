package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jsnapoli/zira/internal/models"
)

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	switch r.Method {
	case "GET":
		// Get notifications for current user
		limitStr := r.URL.Query().Get("limit")
		limit := 50
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
				limit = l
			}
		}

		notifications, err := s.DB.GetNotificationsForUser(user.ID, limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if notifications == nil {
			notifications = []models.Notification{}
		}

		// Also get unread count
		unreadCount, _ := s.DB.GetUnreadNotificationCount(user.ID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"notifications": notifications,
			"unread_count":  unreadCount,
		})

	case "POST":
		// Mark all as read
		action := r.URL.Query().Get("action")
		if action == "mark-all-read" {
			if err := s.DB.MarkAllNotificationsRead(user.ID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "Unknown action", http.StatusBadRequest)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleNotification(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	// Parse notification ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/notifications/")
	parts := strings.Split(path, "/")
	notificationID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid notification ID", http.StatusBadRequest)
		return
	}

	// Get notification and verify ownership
	notification, err := s.DB.GetNotificationByID(notificationID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if notification == nil || notification.UserID != user.ID {
		http.Error(w, "Notification not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case "PUT":
		// Mark as read
		if err := s.DB.MarkNotificationRead(notificationID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		notification.Read = true
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(notification)

	case "DELETE":
		if err := s.DB.DeleteNotification(notificationID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
