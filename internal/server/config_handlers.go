package server

import (
	"encoding/json"
	"log"
	"net/http"
)

func (s *Server) handleConfigStatus(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	configured := s.Config.IsConfigured()
	giteaURL := s.Config.GiteaURL
	s.configMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"configured": configured,
		"gitea_url":  giteaURL,
	})
}

func (s *Server) handleConfigGet(w http.ResponseWriter, r *http.Request) {
	s.configMu.RLock()
	giteaURL := s.Config.GiteaURL
	s.configMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"gitea_url": giteaURL,
	})
}

func (s *Server) handleConfigPost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GiteaURL    string `json:"gitea_url"`
		GiteaAPIKey string `json:"gitea_api_key"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.GiteaURL == "" {
		http.Error(w, "gitea_url is required", http.StatusBadRequest)
		return
	}

	// If API key is empty and config is already set, keep the existing key
	s.configMu.RLock()
	configured := s.Config.IsConfigured()
	s.configMu.RUnlock()
	if req.GiteaAPIKey == "" && !configured {
		http.Error(w, "gitea_api_key is required for initial configuration", http.StatusBadRequest)
		return
	}

	s.configMu.Lock()
	s.Config.GiteaURL = req.GiteaURL
	if req.GiteaAPIKey != "" {
		s.Config.GiteaAPIKey = req.GiteaAPIKey
	}
	s.updateClient()
	saveErr := s.Config.SaveToFile()
	s.configMu.Unlock()

	if saveErr != nil {
		log.Printf("Warning: failed to save config: %v", saveErr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}
