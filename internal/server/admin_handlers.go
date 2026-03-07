package server

import (
	"encoding/json"
	"net/http"
)

// Users handler

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.DB.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// Admin handlers

func (s *Server) handleGetAdminUsers(w http.ResponseWriter, r *http.Request) {
	// List all users with admin status
	users, err := s.DB.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

func (s *Server) handleUpdateAdminUser(w http.ResponseWriter, r *http.Request) {
	// Set/unset admin status for a user
	var req struct {
		UserID  int64 `json:"user_id"`
		IsAdmin bool  `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Prevent removing the last admin
	if !req.IsAdmin {
		adminCount, err := s.DB.CountAdmins()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Check if the user being demoted is currently an admin
		user, err := s.DB.GetUserByID(req.UserID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if user == nil {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		if user.IsAdmin && adminCount <= 1 {
			http.Error(w, "Cannot remove the last admin", http.StatusBadRequest)
			return
		}
	}

	if err := s.DB.SetUserAdmin(req.UserID, req.IsAdmin); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return updated user
	user, err := s.DB.GetUserByID(req.UserID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
