package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jsnapoli/gira/internal/gitea"
	"github.com/jsnapoli/gira/internal/github"
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

func (s *Server) handleListUserCredentials(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

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
}

func (s *Server) handleCreateUserCredential(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

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
}

func (s *Server) handleGetUserCredential(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	credID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
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
}

func (s *Server) handleUpdateUserCredential(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	credID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
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
}

func (s *Server) handleDeleteUserCredential(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	credID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
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

	if err := s.DB.DeleteUserCredential(credID, user.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTestCredential(w http.ResponseWriter, r *http.Request) {
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
		testErr = client.TestConnection()
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
