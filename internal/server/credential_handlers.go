package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/gitea"
	"github.com/jsnapoli/zira/internal/github"
)

// UserCredentialResponse is the response format for credentials (without token)
type UserCredentialResponse struct {
	ID          int64  `json:"id"`
	Provider    string `json:"provider"`
	ProviderURL string `json:"provider_url"`
	DisplayName string `json:"display_name"`
	HasToken    bool   `json:"has_token"`
	CreatedAt   string `json:"created_at"`
}

func (s *Server) handleUserCredentials(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	switch r.Method {
	case "GET":
		// List all credentials for the user (tokens masked)
		creds, err := s.DB.GetUserCredentials(user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Convert to response format (without tokens)
		resp := make([]UserCredentialResponse, len(creds))
		for i, c := range creds {
			resp[i] = UserCredentialResponse{
				ID:          c.ID,
				Provider:    c.Provider,
				ProviderURL: c.ProviderURL,
				DisplayName: c.DisplayName,
				HasToken:    c.APIToken != "",
				CreatedAt:   c.CreatedAt.Format(time.RFC3339),
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)

	case "POST":
		// Create a new credential
		var req struct {
			Provider    string `json:"provider"`
			ProviderURL string `json:"provider_url"`
			APIToken    string `json:"api_token"`
			DisplayName string `json:"display_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.Provider == "" || req.APIToken == "" {
			http.Error(w, "provider and api_token are required", http.StatusBadRequest)
			return
		}

		if req.Provider != "gitea" && req.Provider != "github" {
			http.Error(w, "provider must be 'gitea' or 'github'", http.StatusBadRequest)
			return
		}

		// GitHub doesn't need a URL
		if req.Provider == "github" {
			req.ProviderURL = ""
		}

		cred, err := s.DB.CreateOrUpdateUserCredential(user.ID, req.Provider, req.ProviderURL, req.APIToken, req.DisplayName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := UserCredentialResponse{
			ID:          cred.ID,
			Provider:    cred.Provider,
			ProviderURL: cred.ProviderURL,
			DisplayName: cred.DisplayName,
			HasToken:    true,
			CreatedAt:   cred.CreatedAt.Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(resp)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleUserCredential(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	// Parse credential ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/user/credentials/")
	parts := strings.Split(path, "/")
	if parts[0] == "" {
		http.Error(w, "Credential ID required", http.StatusBadRequest)
		return
	}

	credID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid credential ID", http.StatusBadRequest)
		return
	}

	// Get credential and verify ownership
	cred, err := s.DB.GetUserCredentialByID(credID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if cred == nil || cred.UserID != user.ID {
		http.Error(w, "Credential not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case "GET":
		resp := UserCredentialResponse{
			ID:          cred.ID,
			Provider:    cred.Provider,
			ProviderURL: cred.ProviderURL,
			DisplayName: cred.DisplayName,
			HasToken:    cred.APIToken != "",
			CreatedAt:   cred.CreatedAt.Format(time.RFC3339),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)

	case "PUT":
		var req struct {
			APIToken    string `json:"api_token"`
			DisplayName string `json:"display_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		updated, err := s.DB.UpdateUserCredential(credID, user.ID, req.APIToken, req.DisplayName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := UserCredentialResponse{
			ID:          updated.ID,
			Provider:    updated.Provider,
			ProviderURL: updated.ProviderURL,
			DisplayName: updated.DisplayName,
			HasToken:    updated.APIToken != "",
			CreatedAt:   updated.CreatedAt.Format(time.RFC3339),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)

	case "DELETE":
		if err := s.DB.DeleteUserCredential(credID, user.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTestCredential(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Provider    string `json:"provider"`
		ProviderURL string `json:"provider_url"`
		APIToken    string `json:"api_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Provider == "" || req.APIToken == "" {
		http.Error(w, "provider and api_token are required", http.StatusBadRequest)
		return
	}

	var testErr error
	switch req.Provider {
	case "gitea":
		if req.ProviderURL == "" {
			http.Error(w, "provider_url is required for Gitea", http.StatusBadRequest)
			return
		}
		s.configMu.RLock()
		insecureTLS := s.Config.GiteaInsecureTLS
		s.configMu.RUnlock()
		client := gitea.NewClient(req.ProviderURL, req.APIToken, insecureTLS)
		_, testErr = client.GetRepos()
	case "github":
		client := github.NewClient(req.APIToken)
		_, testErr = client.GetRepos()
	default:
		http.Error(w, "provider must be 'gitea' or 'github'", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if testErr != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": testErr.Error(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Connection successful",
	})
}
