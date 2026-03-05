package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/auth"
	"github.com/jsnapoli/zira/internal/config"
	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/gitea"
	"github.com/jsnapoli/zira/internal/models"
)

type Server struct {
	Config  *config.Config
	Client  *gitea.Client
	DB      *database.DB
	Port    int
	Version string
}

func New(cfg *config.Config, db *database.DB, version string) *Server {
	var client *gitea.Client
	if cfg.IsConfigured() {
		client = gitea.NewClient(cfg.GiteaURL, cfg.GiteaAPIKey)
	}

	return &Server{
		Config:  cfg,
		Client:  client,
		DB:      db,
		Port:    cfg.Port,
		Version: version,
	}
}

func (s *Server) updateClient() {
	if s.Config.IsConfigured() {
		s.Client = gitea.NewClient(s.Config.GiteaURL, s.Config.GiteaAPIKey)
	}
}

func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Auth routes
	mux.HandleFunc("/api/auth/signup", s.handleSignup)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/auth/me", s.handleMe)

	// Config routes
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/config/status", s.handleConfigStatus)

	// Gitea API routes
	mux.HandleFunc("/api/repos", s.requireAuth(s.handleRepos))
	mux.HandleFunc("/api/issues", s.requireAuth(s.handleIssues))
	mux.HandleFunc("/api/issue", s.requireAuth(s.handleIssue))
	mux.HandleFunc("/api/labels", s.requireAuth(s.handleLabels))
	mux.HandleFunc("/api/milestones", s.requireAuth(s.handleMilestones))

	// Board routes
	mux.HandleFunc("/api/boards", s.requireAuth(s.handleBoards))
	mux.HandleFunc("/api/boards/", s.requireAuth(s.handleBoard))

	// Sprint routes
	mux.HandleFunc("/api/sprints", s.requireAuth(s.handleSprints))
	mux.HandleFunc("/api/sprints/", s.requireAuth(s.handleSprint))

	// Card routes
	mux.HandleFunc("/api/cards", s.requireAuth(s.handleCards))
	mux.HandleFunc("/api/cards/", s.requireAuth(s.handleCard))

	// Metrics routes
	mux.HandleFunc("/api/metrics/burndown", s.requireAuth(s.handleBurndown))
	mux.HandleFunc("/api/metrics/velocity", s.requireAuth(s.handleVelocity))

	// User routes
	mux.HandleFunc("/api/users", s.requireAuth(s.handleUsers))

	// Attachment download route (separate from card routes for direct file access)
	mux.HandleFunc("/api/attachments/", s.requireAuth(s.handleAttachmentDownload))

	// Custom fields routes are handled under /api/boards/{id}/custom-fields
	// Custom field values are handled under /api/cards/{id}/custom-fields

	// Notification routes
	mux.HandleFunc("/api/notifications", s.requireAuth(s.handleNotifications))
	mux.HandleFunc("/api/notifications/", s.requireAuth(s.handleNotification))

	// Health check route (for Docker/Portainer)
	mux.HandleFunc("/healthz", s.handleHealthz)

	// Serve frontend static files
	fs := http.FileServer(http.Dir("./frontend/dist"))
	mux.Handle("/", fs)

	addr := fmt.Sprintf(":%d", s.Port)
	log.Printf("Server starting on %s", addr)
	if s.Config.IsConfigured() {
		log.Printf("Connected to Gitea at %s", s.Config.GiteaURL)
	} else {
		log.Println("Waiting for configuration via UI")
	}
	return http.ListenAndServe(addr, s.corsMiddleware(mux))
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

type contextKey string

const userContextKey contextKey = "user"

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := auth.ExtractTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := auth.ValidateToken(token)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		user, err := s.DB.GetUserByID(claims.UserID)
		if err != nil || user == nil {
			http.Error(w, "User not found", http.StatusUnauthorized)
			return
		}

		r = r.WithContext(setUserContext(r.Context(), user))
		next(w, r)
	}
}

func (s *Server) requireConfig(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.Config.IsConfigured() {
			http.Error(w, "Gitea not configured", http.StatusPreconditionRequired)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": s.Version,
	})
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" || req.DisplayName == "" {
		http.Error(w, "email, password, and display_name are required", http.StatusBadRequest)
		return
	}

	// Check if user exists
	existing, _ := s.DB.GetUserByEmail(req.Email)
	if existing != nil {
		http.Error(w, "User already exists", http.StatusConflict)
		return
	}

	// Hash password
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Create user
	user, err := s.DB.CreateUser(req.Email, hash, req.DisplayName)
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Generate token
	token, err := auth.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to create token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, err := s.DB.GetUserByEmail(req.Email)
	if err != nil || user == nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	if !auth.CheckPassword(req.Password, user.PasswordHash) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := auth.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to create token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user":  user,
		"token": token,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := auth.ExtractTokenFromRequest(r)
	if token == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	claims, err := auth.ValidateToken(token)
	if err != nil {
		http.Error(w, "Invalid token", http.StatusUnauthorized)
		return
	}

	user, err := s.DB.GetUserByID(claims.UserID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (s *Server) handleConfigStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"configured": s.Config.IsConfigured(),
		"gitea_url":  s.Config.GiteaURL,
	})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"gitea_url": s.Config.GiteaURL,
		})
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		GiteaURL    string `json:"gitea_url"`
		GiteaAPIKey string `json:"gitea_api_key"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.GiteaURL == "" || req.GiteaAPIKey == "" {
		http.Error(w, "gitea_url and gitea_api_key are required", http.StatusBadRequest)
		return
	}

	s.Config.GiteaURL = req.GiteaURL
	s.Config.GiteaAPIKey = req.GiteaAPIKey
	s.updateClient()

	if err := s.Config.SaveToFile(); err != nil {
		log.Printf("Warning: failed to save config: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	if !s.Config.IsConfigured() {
		http.Error(w, "Gitea not configured", http.StatusPreconditionRequired)
		return
	}

	repos, err := s.Client.GetRepos()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (s *Server) handleIssues(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")

	if owner == "" || repo == "" {
		http.Error(w, "owner and repo parameters required", http.StatusBadRequest)
		return
	}

	issues, err := s.Client.GetIssues(owner, repo)
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

	issue, err := s.Client.GetIssue(owner, repo, number)
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

	labels, err := s.Client.GetLabels(owner, repo)
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

	milestones, err := s.Client.GetMilestones(owner, repo)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(milestones)
}

// Board handlers

func (s *Server) handleBoards(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	switch r.Method {
	case "GET":
		boards, err := s.DB.ListBoardsForUser(user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(boards)

	case "POST":
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		board, err := s.DB.CreateBoard(req.Name, req.Description, user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(board)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	// Parse board ID from path: /api/boards/{id} or /api/boards/{id}/...
	path := strings.TrimPrefix(r.URL.Path, "/api/boards/")
	parts := strings.Split(path, "/")
	boardID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}

	board, err := s.DB.GetBoardByID(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	// Check membership
	isMember, _, err := s.DB.IsBoardMember(boardID, user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !isMember && board.OwnerID != user.ID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	// Handle sub-routes
	if len(parts) > 1 {
		switch parts[1] {
		case "swimlanes":
			s.handleBoardSwimlanes(w, r, board, parts[2:])
			return
		case "columns":
			s.handleBoardColumns(w, r, board, parts[2:])
			return
		case "members":
			s.handleBoardMembers(w, r, board, parts[2:])
			return
		case "cards":
			s.handleBoardCards(w, r, board)
			return
		case "labels":
			s.handleBoardLabels(w, r, board, parts[2:])
			return
		case "custom-fields":
			s.handleBoardCustomFields(w, r, board, parts[2:])
			return
		}
	}

	switch r.Method {
	case "GET":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(board)

	case "PUT":
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		board.Name = req.Name
		board.Description = req.Description
		if err := s.DB.UpdateBoard(board); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(board)

	case "DELETE":
		if err := s.DB.DeleteBoard(boardID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardSwimlanes(w http.ResponseWriter, r *http.Request, board *models.Board, subParts []string) {
	// Handle /boards/:id/swimlanes/:swimlaneId
	if len(subParts) > 0 {
		swimlaneID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid swimlane ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.DeleteSwimlane(swimlaneID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		swimlanes, err := s.DB.GetBoardSwimlanes(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(swimlanes)

	case "POST":
		var req struct {
			Name       string `json:"name"`
			RepoOwner  string `json:"repo_owner"`
			RepoName   string `json:"repo_name"`
			Designator string `json:"designator"`
			Color      string `json:"color"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Color == "" {
			req.Color = "#6366f1"
		}
		swimlane, err := s.DB.CreateSwimlane(board.ID, req.Name, req.RepoOwner, req.RepoName, req.Designator, req.Color)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(swimlane)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardColumns(w http.ResponseWriter, r *http.Request, board *models.Board, subParts []string) {
	// Handle /boards/:id/columns/:columnId and /boards/:id/columns/:columnId/reorder
	if len(subParts) > 0 {
		columnID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid column ID", http.StatusBadRequest)
			return
		}

		// Handle reorder
		if len(subParts) > 1 && subParts[1] == "reorder" {
			if r.Method == "POST" {
				var req struct {
					Position int `json:"position"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid request", http.StatusBadRequest)
					return
				}
				if err := s.DB.ReorderColumn(columnID, req.Position); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.DeleteColumn(columnID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		columns, err := s.DB.GetBoardColumns(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(columns)

	case "POST":
		var req struct {
			Name  string `json:"name"`
			State string `json:"state"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		column, err := s.DB.CreateColumn(board.ID, req.Name, req.State)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(column)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardMembers(w http.ResponseWriter, r *http.Request, board *models.Board, subParts []string) {
	// Handle DELETE /boards/:id/members/:userId
	if len(subParts) > 0 {
		userID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		if r.Method == "DELETE" {
			if err := s.DB.RemoveBoardMember(board.ID, userID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	switch r.Method {
	case "GET":
		members, err := s.DB.GetBoardMembers(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(members)

	case "POST":
		var req struct {
			UserID int64  `json:"user_id"`
			Role   string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Role == "" {
			req.Role = "member"
		}
		if err := s.DB.AddBoardMember(board.ID, req.UserID, req.Role); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardLabels(w http.ResponseWriter, r *http.Request, board *models.Board, subParts []string) {
	// Handle /boards/:id/labels/:labelId
	if len(subParts) > 0 {
		labelID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid label ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "PUT":
			var req struct {
				Name  string `json:"name"`
				Color string `json:"color"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			if err := s.DB.UpdateLabel(labelID, req.Name, req.Color); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)

		case "DELETE":
			if err := s.DB.DeleteLabel(labelID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		labels, err := s.DB.GetBoardLabels(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(labels)

	case "POST":
		var req struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Color == "" {
			req.Color = "#6366f1"
		}
		label, err := s.DB.CreateLabel(board.ID, req.Name, req.Color)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(label)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardCards(w http.ResponseWriter, r *http.Request, board *models.Board) {
	switch r.Method {
	case "GET":
		cards, err := s.DB.ListCardsForBoard(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cards)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Sprint handlers

func (s *Server) handleSprints(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.URL.Query().Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		sprints, err := s.DB.ListSprintsForBoard(boardID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sprints)

	case "POST":
		var req struct {
			Name      string `json:"name"`
			Goal      string `json:"goal"`
			StartDate string `json:"start_date"`
			EndDate   string `json:"end_date"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		var startDate, endDate *time.Time
		if req.StartDate != "" {
			if t, err := time.Parse("2006-01-02", req.StartDate); err == nil {
				startDate = &t
			}
		}
		if req.EndDate != "" {
			if t, err := time.Parse("2006-01-02", req.EndDate); err == nil {
				endDate = &t
			}
		}
		sprint, err := s.DB.CreateSprint(boardID, req.Name, req.Goal, startDate, endDate)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(sprint)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSprint(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/sprints/")
	parts := strings.Split(path, "/")
	sprintID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid sprint ID", http.StatusBadRequest)
		return
	}

	sprint, err := s.DB.GetSprintByID(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sprint == nil {
		http.Error(w, "Sprint not found", http.StatusNotFound)
		return
	}

	// Handle sub-routes
	if len(parts) > 1 {
		switch parts[1] {
		case "start":
			if r.Method == "POST" {
				if err := s.DB.StartSprint(sprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "complete":
			if r.Method == "POST" {
				if err := s.DB.CompleteSprint(sprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "cards":
			if r.Method == "GET" {
				cards, err := s.DB.ListCardsForSprint(sprintID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(cards)
				return
			}
		case "metrics":
			if r.Method == "GET" {
				metrics, err := s.DB.GetSprintMetrics(sprintID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(metrics)
				return
			}
		}
	}

	switch r.Method {
	case "GET":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sprint)

	case "PUT":
		var req struct {
			Name      string `json:"name"`
			Goal      string `json:"goal"`
			Status    string `json:"status"`
			StartDate string `json:"start_date"`
			EndDate   string `json:"end_date"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		sprint.Name = req.Name
		sprint.Goal = req.Goal
		if req.Status != "" {
			sprint.Status = req.Status
		}
		// Parse start date
		if req.StartDate != "" {
			if t, err := time.Parse("2006-01-02", req.StartDate); err == nil {
				sprint.StartDate = &t
			}
		} else {
			sprint.StartDate = nil
		}
		// Parse end date
		if req.EndDate != "" {
			if t, err := time.Parse("2006-01-02", req.EndDate); err == nil {
				sprint.EndDate = &t
			}
		} else {
			sprint.EndDate = nil
		}
		if err := s.DB.UpdateSprint(sprint); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sprint)

	case "DELETE":
		if err := s.DB.DeleteSprint(sprintID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card handlers

func (s *Server) handleCards(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		var req struct {
			BoardID      int64  `json:"board_id"`
			SwimlaneID   int64  `json:"swimlane_id"`
			ColumnID     int64  `json:"column_id"`
			SprintID     *int64 `json:"sprint_id"`
			ParentID     *int64 `json:"parent_id"`
			IssueType    string `json:"issue_type"`
			Title        string `json:"title"`
			Description  string `json:"description"`
			StoryPoints  *int   `json:"story_points"`
			Priority     string `json:"priority"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		// Get swimlane to find repo info
		swimlanes, err := s.DB.GetBoardSwimlanes(req.BoardID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var swimlane *models.Swimlane
		for _, sl := range swimlanes {
			if sl.ID == req.SwimlaneID {
				swimlane = &sl
				break
			}
		}
		if swimlane == nil {
			http.Error(w, "Swimlane not found", http.StatusBadRequest)
			return
		}

		// Create issue in Gitea if configured
		var giteaIssueID int64 = 0
		if s.Config.IsConfigured() {
			giteaIssue, err := s.Client.CreateIssue(swimlane.RepoOwner, swimlane.RepoName, req.Title, req.Description)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to create Gitea issue: %v", err), http.StatusInternalServerError)
				return
			}
			giteaIssueID = giteaIssue.Number
		} else {
			// Generate a local issue ID based on existing cards count
			cards, _ := s.DB.ListCardsForBoard(req.BoardID)
			giteaIssueID = int64(len(cards) + 1)
		}

		// Get column to determine initial state
		columns, err := s.DB.GetBoardColumns(req.BoardID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		state := "open"
		for _, col := range columns {
			if col.ID == req.ColumnID {
				state = col.State
				break
			}
		}

		// Create card in database
		priority := req.Priority
		if priority == "" {
			priority = "medium"
		}

		issueType := req.IssueType
		if issueType == "" {
			issueType = "task"
		}

		card, err := s.DB.CreateCard(database.CreateCardInput{
			BoardID:      req.BoardID,
			SwimlaneID:   req.SwimlaneID,
			ColumnID:     req.ColumnID,
			SprintID:     req.SprintID,
			ParentID:     req.ParentID,
			IssueType:    issueType,
			GiteaIssueID: giteaIssueID,
			Title:        req.Title,
			Description:  req.Description,
			State:        state,
			StoryPoints:  req.StoryPoints,
			Priority:     priority,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(card)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleCard(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/cards/")
	parts := strings.Split(path, "/")
	cardID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid card ID", http.StatusBadRequest)
		return
	}

	card, err := s.DB.GetCardByID(cardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if card == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}

	// Handle sub-routes
	if len(parts) > 1 {
		switch parts[1] {
		case "move":
			if r.Method == "POST" {
				var req struct {
					ColumnID int64  `json:"column_id"`
					State    string `json:"state"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid request", http.StatusBadRequest)
					return
				}
				if err := s.DB.MoveCard(cardID, req.ColumnID, req.State); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				// Also update Gitea issue state
				if s.Config.IsConfigured() {
					swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
					for _, sl := range swimlanes {
						if sl.ID == card.SwimlaneID {
							s.Client.UpdateIssueState(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.State)
							break
						}
					}
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "assign-sprint":
			if r.Method == "POST" {
				var req struct {
					SprintID *int64 `json:"sprint_id"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid request", http.StatusBadRequest)
					return
				}
				if err := s.DB.AssignCardToSprint(cardID, req.SprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "assignees":
			s.handleCardAssignees(w, r, card, parts[2:])
			return
		case "comments":
			s.handleCardComments(w, r, card)
			return
		case "labels":
			s.handleCardLabels(w, r, card, parts[2:])
			return
		case "attachments":
			s.handleCardAttachments(w, r, card, parts[2:])
			return
		case "custom-fields":
			s.handleCardCustomFields(w, r, card, parts[2:])
			return
		case "children":
			if r.Method == "GET" {
				children, err := s.DB.ListChildCards(cardID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(children)
				return
			}
		}
	}

	switch r.Method {
	case "GET":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card)

	case "PUT":
		var req struct {
			Title        string  `json:"title"`
			Description  string  `json:"description"`
			StoryPoints  *int    `json:"story_points"`
			Priority     string  `json:"priority"`
			DueDate      *string `json:"due_date"`
			TimeEstimate *int    `json:"time_estimate"`
			ParentID     *int64  `json:"parent_id"`
			IssueType    string  `json:"issue_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		card.Title = req.Title
		card.Description = req.Description
		card.StoryPoints = req.StoryPoints
		card.Priority = req.Priority
		card.TimeEstimate = req.TimeEstimate
		card.ParentID = req.ParentID
		if req.IssueType != "" {
			card.IssueType = req.IssueType
		}
		// Parse due date
		if req.DueDate != nil && *req.DueDate != "" {
			parsedDate, err := time.Parse("2006-01-02", *req.DueDate)
			if err == nil {
				card.DueDate = &parsedDate
			}
		} else {
			card.DueDate = nil
		}
		if err := s.DB.UpdateCard(card); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Update Gitea issue
		if s.Config.IsConfigured() {
			swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
			for _, sl := range swimlanes {
				if sl.ID == card.SwimlaneID {
					s.Client.UpdateIssue(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.Title, req.Description)
					break
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card)

	case "DELETE":
		if err := s.DB.DeleteCard(cardID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Metrics handlers

func (s *Server) handleBurndown(w http.ResponseWriter, r *http.Request) {
	sprintIDStr := r.URL.Query().Get("sprint_id")
	if sprintIDStr == "" {
		http.Error(w, "sprint_id required", http.StatusBadRequest)
		return
	}
	sprintID, err := strconv.ParseInt(sprintIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid sprint_id", http.StatusBadRequest)
		return
	}

	metrics, err := s.DB.GetSprintMetrics(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If no historical data, calculate current
	if len(metrics) == 0 {
		current, err := s.DB.CalculateCurrentSprintMetrics(sprintID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		metrics = []models.SprintMetrics{*current}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func (s *Server) handleVelocity(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.URL.Query().Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	sprints, err := s.DB.ListSprintsForBoard(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type VelocityPoint struct {
		SprintName      string `json:"sprint_name"`
		CompletedPoints int    `json:"completed_points"`
		TotalPoints     int    `json:"total_points"`
	}

	var velocity []VelocityPoint
	for _, sprint := range sprints {
		if sprint.Status == "completed" {
			metrics, err := s.DB.CalculateCurrentSprintMetrics(sprint.ID)
			if err != nil {
				continue
			}
			velocity = append(velocity, VelocityPoint{
				SprintName:      sprint.Name,
				CompletedPoints: metrics.CompletedPoints,
				TotalPoints:     metrics.TotalPoints,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(velocity)
}

// Users handler

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	users, err := s.DB.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// Card comments handler (local comments)

func (s *Server) handleCardComments(w http.ResponseWriter, r *http.Request, card *models.Card) {
	switch r.Method {
	case "GET":
		comments, err := s.DB.GetCommentsForCard(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(comments)

	case "POST":
		user := getUserFromContext(r.Context())
		if user == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			Body string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Body == "" {
			http.Error(w, "Comment body is required", http.StatusBadRequest)
			return
		}

		comment, err := s.DB.CreateComment(card.ID, user.ID, req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Notify card assignees about the new comment (except the commenter)
		assignees, _ := s.DB.GetCardAssignees(card.ID)
		link := fmt.Sprintf("/boards/%d?card=%d", card.BoardID, card.ID)
		for _, assignee := range assignees {
			if assignee.ID != user.ID {
				s.createNotification(assignee.ID, "comment", "New comment", fmt.Sprintf("%s commented on: %s", user.DisplayName, card.Title), link)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(comment)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card assignees handler

func (s *Server) handleCardAssignees(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/assignees/:userId
	if len(subParts) > 0 {
		userID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.RemoveCardAssignee(card.ID, userID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		assignees, err := s.DB.GetCardAssignees(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(assignees)

	case "POST":
		var req struct {
			UserID int64 `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if err := s.DB.AddCardAssignee(card.ID, req.UserID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Create notification for the assigned user (if not self-assigning)
		currentUser := getUserFromContext(r.Context())
		if req.UserID != currentUser.ID {
			link := fmt.Sprintf("/boards/%d?card=%d", card.BoardID, card.ID)
			s.createNotification(req.UserID, "assignment", "You've been assigned", fmt.Sprintf("%s assigned you to: %s", currentUser.DisplayName, card.Title), link)
		}

		w.WriteHeader(http.StatusCreated)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card labels handler

func (s *Server) handleCardLabels(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/labels/:labelId
	if len(subParts) > 0 {
		labelID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid label ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.RemoveLabelFromCard(card.ID, labelID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		labels, err := s.DB.GetCardLabels(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(labels)

	case "POST":
		var req struct {
			LabelID int64 `json:"label_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if err := s.DB.AddLabelToCard(card.ID, req.LabelID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card attachments handler

func (s *Server) handleCardAttachments(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/attachments/:attachmentId
	if len(subParts) > 0 {
		attachmentID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid attachment ID", http.StatusBadRequest)
			return
		}

		attachment, err := s.DB.GetAttachmentByID(attachmentID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if attachment == nil || attachment.CardID != card.ID {
			http.Error(w, "Attachment not found", http.StatusNotFound)
			return
		}

		switch r.Method {
		case "DELETE":
			// Delete file from disk
			os.Remove(attachment.StorePath)
			// Delete record from database
			if err := s.DB.DeleteAttachment(attachmentID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		attachments, err := s.DB.GetAttachmentsForCard(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(attachments)

	case "POST":
		user := getUserFromContext(r.Context())
		if user == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Parse multipart form (max 10MB)
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "File too large or invalid form", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "No file provided", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Create attachments directory
		attachDir := getAttachmentsDir()
		if err := os.MkdirAll(attachDir, 0755); err != nil {
			http.Error(w, "Failed to create storage directory", http.StatusInternalServerError)
			return
		}

		// Generate unique filename
		ext := filepath.Ext(header.Filename)
		uniqueName := fmt.Sprintf("%d_%d_%d%s", card.ID, user.ID, time.Now().UnixNano(), ext)
		storePath := filepath.Join(attachDir, uniqueName)

		// Save file
		dst, err := os.Create(storePath)
		if err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			os.Remove(storePath)
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}

		// Detect MIME type
		mimeType := header.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		// Create database record
		attachment, err := s.DB.CreateAttachment(card.ID, user.ID, header.Filename, header.Size, mimeType, storePath)
		if err != nil {
			os.Remove(storePath)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(attachment)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Attachment download handler

func (s *Server) handleAttachmentDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/attachments/")
	attachmentID, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		http.Error(w, "Invalid attachment ID", http.StatusBadRequest)
		return
	}

	attachment, err := s.DB.GetAttachmentByID(attachmentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if attachment == nil {
		http.Error(w, "Attachment not found", http.StatusNotFound)
		return
	}

	// Set headers for download
	w.Header().Set("Content-Type", attachment.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", attachment.Filename))
	http.ServeFile(w, r, attachment.StorePath)
}

func getAttachmentsDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "zira", "attachments")
}

// Custom Fields handlers

func (s *Server) handleBoardCustomFields(w http.ResponseWriter, r *http.Request, board *models.Board, pathParts []string) {
	// Handle specific field by ID
	if len(pathParts) > 0 && pathParts[0] != "" {
		fieldID, err := strconv.ParseInt(pathParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid field ID", http.StatusBadRequest)
			return
		}

		field, err := s.DB.GetCustomFieldDefinition(fieldID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if field == nil || field.BoardID != board.ID {
			http.Error(w, "Custom field not found", http.StatusNotFound)
			return
		}

		switch r.Method {
		case "GET":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(field)

		case "PUT":
			var req struct {
				Name      string `json:"name"`
				FieldType string `json:"field_type"`
				Options   string `json:"options"`
				Required  bool   `json:"required"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			if err := s.DB.UpdateCustomFieldDefinition(fieldID, req.Name, req.FieldType, req.Options, req.Required); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			updatedField, _ := s.DB.GetCustomFieldDefinition(fieldID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(updatedField)

		case "DELETE":
			if err := s.DB.DeleteCustomFieldDefinition(fieldID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// Handle collection
	switch r.Method {
	case "GET":
		fields, err := s.DB.ListCustomFieldsForBoard(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if fields == nil {
			fields = []models.CustomFieldDefinition{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(fields)

	case "POST":
		var req struct {
			Name      string `json:"name"`
			FieldType string `json:"field_type"`
			Options   string `json:"options"`
			Required  bool   `json:"required"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Name == "" || req.FieldType == "" {
			http.Error(w, "Name and field_type are required", http.StatusBadRequest)
			return
		}
		field, err := s.DB.CreateCustomFieldDefinition(board.ID, req.Name, req.FieldType, req.Options, req.Required)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(field)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleCardCustomFields(w http.ResponseWriter, r *http.Request, card *models.Card, pathParts []string) {
	// Handle specific field value by field ID
	if len(pathParts) > 0 && pathParts[0] != "" {
		fieldID, err := strconv.ParseInt(pathParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid field ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "GET":
			value, err := s.DB.GetCustomFieldValue(card.ID, fieldID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if value == nil {
				value = &models.CustomFieldValue{CardID: card.ID, FieldID: fieldID}
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(value)

		case "PUT":
			var req struct {
				Value string `json:"value"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			if err := s.DB.SetCustomFieldValue(card.ID, fieldID, req.Value); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			value, _ := s.DB.GetCustomFieldValue(card.ID, fieldID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(value)

		case "DELETE":
			if err := s.DB.DeleteCustomFieldValue(card.ID, fieldID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// Handle collection - get all custom field values for a card
	switch r.Method {
	case "GET":
		values, err := s.DB.GetCustomFieldValuesForCard(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if values == nil {
			values = []models.CustomFieldValue{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(values)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Notification handlers

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

// Helper function to create notifications
func (s *Server) createNotification(userID int64, notificationType, title, message, link string) {
	s.DB.CreateNotification(userID, notificationType, title, message, link)
}
