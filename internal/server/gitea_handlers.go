package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jsnapoli/zira/internal/gitea"
	"github.com/jsnapoli/zira/internal/github"
)

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	token := r.URL.Query().Get("token")
	customURL := r.URL.Query().Get("url")

	// Default to default_gitea
	if source == "" {
		source = "default_gitea"
	}

	// Snapshot config/client under read lock
	s.configMu.RLock()
	configured := s.Config.IsConfigured()
	client := s.Client
	insecureTLS := s.Config.GiteaInsecureTLS
	s.configMu.RUnlock()

	switch source {
	case "default_gitea":
		if !configured {
			http.Error(w, "Gitea not configured", http.StatusPreconditionRequired)
			return
		}
		repos, err := client.GetRepos()
		if err != nil {
			if strings.Contains(err.Error(), "read:user") {
				// Token lacks read:user scope — return empty list so UI falls back to manual entry
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode([]gitea.Repository{})
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(repos)

	case "custom_gitea":
		if token == "" || customURL == "" {
			http.Error(w, "token and url required for custom_gitea", http.StatusBadRequest)
			return
		}
		customClient := gitea.NewClient(customURL, token, insecureTLS)
		repos, err := customClient.GetRepos()
		if err != nil {
			if strings.Contains(err.Error(), "read:user") {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode([]gitea.Repository{})
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(repos)

	case "github":
		if token == "" {
			http.Error(w, "token required for github", http.StatusBadRequest)
			return
		}
		client := github.NewClient(token)
		repos, err := client.GetRepos()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(repos)

	default:
		http.Error(w, "invalid source parameter", http.StatusBadRequest)
	}
}

func (s *Server) handleIssues(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")

	if owner == "" || repo == "" {
		http.Error(w, "owner and repo parameters required", http.StatusBadRequest)
		return
	}

	s.configMu.RLock()
	client := s.Client
	s.configMu.RUnlock()

	issues, err := client.GetIssues(owner, repo)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issues)
}

func (s *Server) handleIssue(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")
	numberStr := r.URL.Query().Get("number")

	if owner == "" || repo == "" || numberStr == "" {
		http.Error(w, "owner, repo, and number parameters required", http.StatusBadRequest)
		return
	}

	number, err := strconv.ParseInt(numberStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid issue number", http.StatusBadRequest)
		return
	}

	s.configMu.RLock()
	client := s.Client
	s.configMu.RUnlock()

	issue, err := client.GetIssue(owner, repo, number)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issue)
}

func (s *Server) handleLabels(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")

	if owner == "" || repo == "" {
		http.Error(w, "owner and repo parameters required", http.StatusBadRequest)
		return
	}

	s.configMu.RLock()
	client := s.Client
	s.configMu.RUnlock()

	labels, err := client.GetLabels(owner, repo)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(labels)
}

func (s *Server) handleMilestones(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")

	if owner == "" || repo == "" {
		http.Error(w, "owner and repo parameters required", http.StatusBadRequest)
		return
	}

	s.configMu.RLock()
	client := s.Client
	s.configMu.RUnlock()

	milestones, err := client.GetMilestones(owner, repo)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(milestones)
}
