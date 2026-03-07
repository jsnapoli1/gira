package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/auth"
	"github.com/jsnapoli/zira/internal/config"
	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/gitea"
	"github.com/jsnapoli/zira/internal/github"
	"github.com/jsnapoli/zira/internal/models"
)

type Server struct {
	Config  *config.Config
	Client  *gitea.Client
	DB      *database.DB
	Port    int
	Version string
	SSEHub  *SSEHub
}

func New(cfg *config.Config, db *database.DB, version string) *Server {
	var client *gitea.Client
	if cfg.IsConfigured() {
		client = gitea.NewClient(cfg.GiteaURL, cfg.GiteaAPIKey, cfg.GiteaInsecureTLS)
	}

	return &Server{
		Config:  cfg,
		Client:  client,
		DB:      db,
		Port:    cfg.Port,
		Version: version,
		SSEHub:  NewSSEHub(),
	}
}

func (s *Server) updateClient() {
	if s.Config.IsConfigured() {
		s.Client = gitea.NewClient(s.Config.GiteaURL, s.Config.GiteaAPIKey, s.Config.GiteaInsecureTLS)
	}
}

// getGiteaClientForSwimlane returns the appropriate Gitea client for a swimlane
// Priority: swimlane credentials > user credentials > global config
func (s *Server) getGiteaClientForSwimlane(swimlane *models.Swimlane, userID int64) (*gitea.Client, error) {
	switch swimlane.RepoSource {
	case "default_gitea", "":
		// 1. Check swimlane-specific credentials
		token, err := s.DB.GetSwimlaneCredential(swimlane.ID)
		if err != nil {
			return nil, err
		}
		if token != "" {
			return gitea.NewClient(s.Config.GiteaURL, token, s.Config.GiteaInsecureTLS), nil
		}

		// 2. Check user credentials for the default Gitea
		if userID > 0 {
			userCred, err := s.DB.GetUserCredential(userID, "gitea", s.Config.GiteaURL)
			if err != nil {
				return nil, err
			}
			if userCred != nil && userCred.APIToken != "" {
				return gitea.NewClient(s.Config.GiteaURL, userCred.APIToken, s.Config.GiteaInsecureTLS), nil
			}
		}

		// 3. Fall back to global config
		return s.Client, nil

	case "custom_gitea":
		// 1. Check swimlane-specific credentials
		token, err := s.DB.GetSwimlaneCredential(swimlane.ID)
		if err != nil {
			return nil, err
		}
		if token != "" {
			return gitea.NewClient(swimlane.RepoURL, token, s.Config.GiteaInsecureTLS), nil
		}

		// 2. Check user credentials for this custom Gitea URL
		if userID > 0 {
			userCred, err := s.DB.GetUserCredential(userID, "gitea", swimlane.RepoURL)
			if err != nil {
				return nil, err
			}
			if userCred != nil && userCred.APIToken != "" {
				return gitea.NewClient(swimlane.RepoURL, userCred.APIToken, s.Config.GiteaInsecureTLS), nil
			}
		}

		return nil, fmt.Errorf("no credentials for custom gitea swimlane")

	default:
		return nil, fmt.Errorf("unsupported repo source for Gitea client: %s", swimlane.RepoSource)
	}
}

// getGitHubClientForSwimlane returns a GitHub client for a swimlane
// Priority: swimlane credentials > user credentials
func (s *Server) getGitHubClientForSwimlane(swimlane *models.Swimlane, userID int64) (*github.Client, error) {
	if swimlane.RepoSource != "github" {
		return nil, fmt.Errorf("swimlane is not a GitHub source")
	}

	// 1. Check swimlane-specific credentials
	token, err := s.DB.GetSwimlaneCredential(swimlane.ID)
	if err != nil {
		return nil, err
	}
	if token != "" {
		return github.NewClient(token), nil
	}

	// 2. Check user credentials for GitHub
	if userID > 0 {
		userCred, err := s.DB.GetUserCredential(userID, "github", "")
		if err != nil {
			return nil, err
		}
		if userCred != nil && userCred.APIToken != "" {
			return github.NewClient(userCred.APIToken), nil
		}
	}

	return nil, fmt.Errorf("no credentials for GitHub swimlane")
}

func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Auth routes
	mux.HandleFunc("/api/auth/signup", s.handleSignup)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/auth/me", s.handleMe)

	// Config routes (POST requires admin)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/config/status", s.handleConfigStatus)

	// Admin routes
	mux.HandleFunc("/api/admin/users", s.requireAdmin(s.handleAdminUsers))

	// Gitea API routes
	mux.HandleFunc("/api/repos", s.requireAuth(s.handleRepos))
	mux.HandleFunc("/api/issues", s.requireAuth(s.handleIssues))
	mux.HandleFunc("/api/issue", s.requireAuth(s.handleIssue))
	mux.HandleFunc("/api/labels", s.requireAuth(s.handleLabels))
	mux.HandleFunc("/api/milestones", s.requireAuth(s.handleMilestones))

	// Board routes
	mux.HandleFunc("/api/boards", s.requireAuth(s.handleBoards))
	// SSE route for real-time board updates (must be before /api/boards/ to match first)
	mux.HandleFunc("/api/boards/", func(w http.ResponseWriter, r *http.Request) {
		// Check if this is an SSE events request
		if strings.HasSuffix(r.URL.Path, "/events") {
			s.handleBoardSSE(w, r)
			return
		}
		// Otherwise, use the regular board handler (with auth)
		s.requireAuth(s.handleBoard)(w, r)
	})

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

	// User credentials routes
	mux.HandleFunc("/api/user/credentials", s.requireAuth(s.handleUserCredentials))
	mux.HandleFunc("/api/user/credentials/", s.requireAuth(s.handleUserCredential))
	mux.HandleFunc("/api/user/credentials/test", s.requireAuth(s.handleTestCredential))

	// Attachment download route (no auth required - IDs are not guessable and images need to load in <img> tags)
	mux.HandleFunc("/api/attachments/", s.handleAttachmentDownload)

	// Custom fields routes are handled under /api/boards/{id}/custom-fields
	// Custom field values are handled under /api/cards/{id}/custom-fields

	// Notification routes
	mux.HandleFunc("/api/notifications", s.requireAuth(s.handleNotifications))
	mux.HandleFunc("/api/notifications/", s.requireAuth(s.handleNotification))

	// Health check route (for Docker/Portainer)
	mux.HandleFunc("/healthz", s.handleHealthz)

	// Serve frontend static files with SPA fallback
	mux.HandleFunc("/", s.handleSPA)

	addr := fmt.Sprintf(":%d", s.Port)
	log.Printf("Server starting on %s", addr)
	if s.Config.IsConfigured() {
		log.Printf("Connected to Gitea at %s", s.Config.GiteaURL)
	} else {
		log.Println("Waiting for configuration via UI")
	}
	return http.ListenAndServe(addr, s.corsMiddleware(mux))
}

// handleSPA serves the frontend with SPA fallback for client-side routing
func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	// Static file directory
	staticDir := "./frontend/dist"

	// Clean the path
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	// Try to serve the file directly
	filePath := filepath.Join(staticDir, path)

	// Check if file exists
	info, err := os.Stat(filePath)
	if err == nil && !info.IsDir() {
		// File exists, serve it
		http.ServeFile(w, r, filePath)
		return
	}

	// File doesn't exist - serve index.html for SPA routing
	// This handles routes like /boards/1, /settings, etc.
	http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
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

// requireAdmin wraps a handler to require app-level admin privileges
func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		user := getUserFromContext(r.Context())
		if user == nil || !user.IsAdmin {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
		next(w, r)
	})
}

// requireBoardRole wraps a handler to require a minimum board role
// The board must be loaded into context before calling this middleware
func (s *Server) requireBoardRole(minRole models.BoardRole, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := getBoardRoleFromContext(r.Context())
		user := getUserFromContext(r.Context())

		// App admins can access any board
		if user != nil && user.IsAdmin {
			next(w, r)
			return
		}

		// Check role hierarchy
		switch minRole {
		case models.BoardRoleViewer:
			if role.CanView() {
				next(w, r)
				return
			}
		case models.BoardRoleMember:
			if role.CanEditCards() {
				next(w, r)
				return
			}
		case models.BoardRoleAdmin:
			if role.CanEditBoard() {
				next(w, r)
				return
			}
		}

		http.Error(w, "Insufficient permissions", http.StatusForbidden)
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

	// POST requires admin authentication
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

	if !user.IsAdmin {
		http.Error(w, "Admin access required", http.StatusForbidden)
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

	if req.GiteaURL == "" {
		http.Error(w, "gitea_url is required", http.StatusBadRequest)
		return
	}

	// If API key is empty and config is already set, keep the existing key
	if req.GiteaAPIKey == "" && !s.Config.IsConfigured() {
		http.Error(w, "gitea_api_key is required for initial configuration", http.StatusBadRequest)
		return
	}

	s.Config.GiteaURL = req.GiteaURL
	if req.GiteaAPIKey != "" {
		s.Config.GiteaAPIKey = req.GiteaAPIKey
	}
	s.updateClient()

	if err := s.Config.SaveToFile(); err != nil {
		log.Printf("Warning: failed to save config: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	token := r.URL.Query().Get("token")
	customURL := r.URL.Query().Get("url")

	// Default to default_gitea
	if source == "" {
		source = "default_gitea"
	}

	switch source {
	case "default_gitea":
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

	case "custom_gitea":
		if token == "" || customURL == "" {
			http.Error(w, "token and url required for custom_gitea", http.StatusBadRequest)
			return
		}
		client := gitea.NewClient(customURL, token, s.Config.GiteaInsecureTLS)
		repos, err := client.GetRepos()
		if err != nil {
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

	// Check membership and determine role
	var boardRole models.BoardRole
	if user.IsAdmin {
		// App admins get full admin access to any board
		boardRole = models.BoardRoleAdmin
	} else if board.OwnerID == user.ID {
		// Board owner is always admin
		boardRole = models.BoardRoleAdmin
	} else {
		isMember, role, err := s.DB.IsBoardMember(boardID, user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !isMember {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
		boardRole = models.BoardRole(role)
	}

	// Store board role in context for sub-handlers
	r = r.WithContext(setBoardRoleContext(r.Context(), boardRole))

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
		// Viewer+ can view board
		if !boardRole.CanView() {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(board)

	case "PUT":
		// Admin only can edit board settings
		if !boardRole.CanEditBoard() {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
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
		// Admin only can delete board
		if !boardRole.CanEditBoard() {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
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
	boardRole := getBoardRoleFromContext(r.Context())

	// Handle /boards/:id/swimlanes/:swimlaneId
	if len(subParts) > 0 {
		swimlaneID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid swimlane ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			// Admin only can delete swimlanes
			if !boardRole.CanEditBoard() {
				http.Error(w, "Admin access required", http.StatusForbidden)
				return
			}
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
		// Viewer+ can view swimlanes
		if !boardRole.CanView() {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
		swimlanes, err := s.DB.GetBoardSwimlanes(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(swimlanes)

	case "POST":
		// Admin only can create swimlanes
		if !boardRole.CanEditBoard() {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
		var req struct {
			Name       string `json:"name"`
			RepoSource string `json:"repo_source"`
			RepoURL    string `json:"repo_url"`
			RepoOwner  string `json:"repo_owner"`
			RepoName   string `json:"repo_name"`
			Designator string `json:"designator"`
			Color      string `json:"color"`
			APIToken   string `json:"api_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Color == "" {
			req.Color = "#6366f1"
		}
		if req.RepoSource == "" {
			req.RepoSource = "default_gitea"
		}
		swimlane, err := s.DB.CreateSwimlaneWithSource(board.ID, req.Name, req.RepoSource, req.RepoURL, req.RepoOwner, req.RepoName, req.Designator, req.Color)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Store credentials if provided for non-default sources
		if req.APIToken != "" && req.RepoSource != "default_gitea" {
			if err := s.DB.SetSwimlaneCredential(swimlane.ID, req.APIToken); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(swimlane)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleBoardColumns(w http.ResponseWriter, r *http.Request, board *models.Board, subParts []string) {
	boardRole := getBoardRoleFromContext(r.Context())

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
				// Admin only can reorder columns
				if !boardRole.CanEditBoard() {
					http.Error(w, "Admin access required", http.StatusForbidden)
					return
				}
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
			// Admin only can delete columns
			if !boardRole.CanEditBoard() {
				http.Error(w, "Admin access required", http.StatusForbidden)
				return
			}
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
		// Viewer+ can view columns
		if !boardRole.CanView() {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
		columns, err := s.DB.GetBoardColumns(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(columns)

	case "POST":
		// Admin only can create columns
		if !boardRole.CanEditBoard() {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
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
	boardRole := getBoardRoleFromContext(r.Context())

	// Handle DELETE /boards/:id/members/:userId
	if len(subParts) > 0 {
		userID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		if r.Method == "DELETE" {
			// Admin only can remove members
			if !boardRole.CanEditBoard() {
				http.Error(w, "Admin access required", http.StatusForbidden)
				return
			}
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
		// Viewer+ can view members
		if !boardRole.CanView() {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
		members, err := s.DB.GetBoardMembers(board.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(members)

	case "POST":
		// Admin only can add members
		if !boardRole.CanEditBoard() {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}
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
			BoardID     int64  `json:"board_id"`
			SwimlaneID  int64  `json:"swimlane_id"`
			ColumnID    int64  `json:"column_id"`
			SprintID    *int64 `json:"sprint_id"`
			ParentID    *int64 `json:"parent_id"`
			IssueType   string `json:"issue_type"`
			Title       string `json:"title"`
			Description string `json:"description"`
			StoryPoints *int   `json:"story_points"`
			Priority    string `json:"priority"`
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

		// Create issue in the appropriate provider
		var giteaIssueID int64 = 0
		user := getUserFromContext(r.Context())

		switch swimlane.RepoSource {
		case "github":
			client, err := s.getGitHubClientForSwimlane(swimlane, user.ID)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to get GitHub client: %v", err), http.StatusInternalServerError)
				return
			}
			issue, err := client.CreateIssue(swimlane.RepoOwner, swimlane.RepoName, req.Title, req.Description)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to create GitHub issue: %v", err), http.StatusInternalServerError)
				return
			}
			giteaIssueID = issue.Number

		case "default_gitea", "custom_gitea", "":
			client, err := s.getGiteaClientForSwimlane(swimlane, user.ID)
			if err != nil {
				// If no client available, generate local ID
				cards, _ := s.DB.ListCardsForBoard(req.BoardID)
				giteaIssueID = int64(len(cards) + 1)
			} else if client != nil {
				giteaIssue, err := client.CreateIssue(swimlane.RepoOwner, swimlane.RepoName, req.Title, req.Description)
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

		default:
			// Generate a local issue ID
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

		// Broadcast card_created event
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_created",
			BoardID:   card.BoardID,
			Payload:   card,
			Timestamp: time.Now(),
			UserID:    user.ID,
		})

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
				// Also update issue state in the appropriate provider
				user := getUserFromContext(r.Context())
				swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
				for _, sl := range swimlanes {
					if sl.ID == card.SwimlaneID {
						switch sl.RepoSource {
						case "github":
							if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
								client.UpdateIssueState(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.State)
							}
						default:
							if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
								client.UpdateIssueState(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.State)
							}
						}
						break
					}
				}

				// Broadcast card_moved event
				s.SSEHub.Broadcast(BoardEvent{
					Type:      "card_moved",
					BoardID:   card.BoardID,
					Payload:   map[string]interface{}{"card_id": cardID, "column_id": req.ColumnID, "state": req.State},
					Timestamp: time.Now(),
					UserID:    user.ID,
				})

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
		case "worklogs":
			s.handleCardWorkLogs(w, r, card, parts[2:])
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

		// Update issue in the appropriate provider
		user := getUserFromContext(r.Context())
		swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
		for _, sl := range swimlanes {
			if sl.ID == card.SwimlaneID {
				switch sl.RepoSource {
				case "github":
					if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
						client.UpdateIssue(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.Title, req.Description)
					}
				default:
					if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
						client.UpdateIssue(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.Title, req.Description)
					}
				}
				break
			}
		}

		// Broadcast card_updated event
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_updated",
			BoardID:   card.BoardID,
			Payload:   card,
			Timestamp: time.Now(),
			UserID:    user.ID,
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card)

	case "DELETE":
		user := getUserFromContext(r.Context())
		boardID := card.BoardID
		if err := s.DB.DeleteCard(cardID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Broadcast card_deleted event
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_deleted",
			BoardID:   boardID,
			Payload:   map[string]interface{}{"card_id": cardID},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})

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
			Body          string  `json:"body"`
			AttachmentIDs []int64 `json:"attachment_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.Body == "" && len(req.AttachmentIDs) == 0 {
			http.Error(w, "Comment body or attachments required", http.StatusBadRequest)
			return
		}

		comment, err := s.DB.CreateComment(card.ID, user.ID, req.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Sync comment to Gitea/GitHub if card has a linked issue
		if card.GiteaIssueID > 0 && req.Body != "" {
			swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
			for _, sl := range swimlanes {
				if sl.ID == card.SwimlaneID {
					// Format comment with user attribution
					giteaBody := fmt.Sprintf("**%s** commented:\n\n%s", user.DisplayName, req.Body)
					switch sl.RepoSource {
					case "github":
						if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
							client.CreateIssueComment(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, giteaBody)
						}
					default:
						if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
							client.CreateIssueComment(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, giteaBody)
						}
					}
					break
				}
			}
		}

		// Link attachments to the comment
		if len(req.AttachmentIDs) > 0 {
			if err := s.DB.LinkAttachmentsToComment(comment.ID, req.AttachmentIDs); err != nil {
				log.Printf("Failed to link attachments to comment: %v", err)
			}
			// Reload comment to get attachments
			comment.Attachments, _ = s.DB.GetAttachmentsForComment(comment.ID)
		}

		// Parse @mentions from comment body and notify mentioned users
		link := fmt.Sprintf("/boards/%d?card=%d", card.BoardID, card.ID)
		mentionedUserIDs := s.parseMentions(req.Body)
		notifiedUsers := make(map[int64]bool)

		for _, mentionedID := range mentionedUserIDs {
			if mentionedID != user.ID {
				s.createNotification(mentionedID, "mention", "You were mentioned", fmt.Sprintf("%s mentioned you in: %s", user.DisplayName, card.Title), link)
				notifiedUsers[mentionedID] = true
			}
		}

		// Notify card assignees about the new comment (except the commenter and already notified users)
		assignees, _ := s.DB.GetCardAssignees(card.ID)
		for _, assignee := range assignees {
			if assignee.ID != user.ID && !notifiedUsers[assignee.ID] {
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

// Card work logs handler

func (s *Server) handleCardWorkLogs(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle DELETE /cards/:id/worklogs/:worklogId
	if len(subParts) > 0 && subParts[0] != "" {
		worklogID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid work log ID", http.StatusBadRequest)
			return
		}

		worklog, err := s.DB.GetWorkLogByID(worklogID)
		if err != nil {
			http.Error(w, "Work log not found", http.StatusNotFound)
			return
		}
		if worklog.CardID != card.ID {
			http.Error(w, "Work log not found", http.StatusNotFound)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.DeleteWorkLog(worklogID); err != nil {
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
		workLogs, err := s.DB.GetWorkItems(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Get total time logged
		totalTime, err := s.DB.GetTotalTimeLogged(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Return both work logs and summary
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"work_logs":     workLogs,
			"total_logged":  totalTime,
			"time_estimate": card.TimeEstimate,
		})

	case "POST":
		user := getUserFromContext(r.Context())
		if user == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			TimeSpent int    `json:"time_spent"` // in minutes
			Date      string `json:"date"`       // YYYY-MM-DD
			Notes     string `json:"notes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		if req.TimeSpent <= 0 {
			http.Error(w, "Time spent must be greater than 0", http.StatusBadRequest)
			return
		}

		// Parse date
		var logDate time.Time
		if req.Date != "" {
			parsedDate, err := time.Parse("2006-01-02", req.Date)
			if err != nil {
				http.Error(w, "Invalid date format (use YYYY-MM-DD)", http.StatusBadRequest)
				return
			}
			logDate = parsedDate
		} else {
			logDate = time.Now()
		}

		if err := s.DB.LogWork(card.ID, user.ID, req.TimeSpent, logDate, req.Notes); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Return updated work logs list
		workLogs, _ := s.DB.GetWorkItems(card.ID)
		totalTime, _ := s.DB.GetTotalTimeLogged(card.ID)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"work_logs":     workLogs,
			"total_logged":  totalTime,
			"time_estimate": card.TimeEstimate,
		})

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
			// Delete record from database first to avoid orphaned rows
			if err := s.DB.DeleteAttachment(attachmentID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			// Remove file from disk; if this fails, log it but don't error
			// (an orphaned file on disk is less harmful than an orphaned DB row)
			filePath := attachment.StorePath
			if !filepath.IsAbs(filePath) {
				filePath = filepath.Join(getAttachmentsDir(), filePath)
			}
			if err := os.Remove(filePath); err != nil {
				log.Printf("warning: failed to remove attachment file %s: %v", filePath, err)
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

		// Generate unique filename (stored in DB, not full path)
		ext := filepath.Ext(header.Filename)
		uniqueName := fmt.Sprintf("%d_%d_%d%s", card.ID, user.ID, time.Now().UnixNano(), ext)
		fullPath := filepath.Join(attachDir, uniqueName)

		// Save file
		dst, err := os.Create(fullPath)
		if err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			os.Remove(fullPath)
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}

		// Detect MIME type
		mimeType := header.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		// Create database record - store only the unique filename, not full path
		attachment, err := s.DB.CreateAttachment(card.ID, user.ID, header.Filename, header.Size, mimeType, uniqueName)
		if err != nil {
			os.Remove(fullPath)
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

	// Resolve the full path - StorePath may be just a filename (new) or full path (legacy)
	filePath := attachment.StorePath
	if !filepath.IsAbs(filePath) {
		filePath = filepath.Join(getAttachmentsDir(), filePath)
	}

	// Read file and serve with proper headers
	data, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Failed to read attachment", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", attachment.MimeType)
	// Use inline for images so they display in browser, attachment for other files
	disposition := "attachment"
	if strings.HasPrefix(attachment.MimeType, "image/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, attachment.Filename))
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(data)), 10))
	w.Write(data)
}

func getAttachmentsDir() string {
	// Check for DATA_DIR environment variable first (for Docker)
	if dataDir := os.Getenv("DATA_DIR"); dataDir != "" {
		return filepath.Join(dataDir, "attachments")
	}
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

// parseMentions extracts @mentions from text and returns user IDs
// Supports @display_name format (display names are matched case-insensitively)
func (s *Server) parseMentions(body string) []int64 {
	// Match @username patterns - supports spaces in names when quoted: @"John Doe" or @John
	mentionRegex := regexp.MustCompile(`@"([^"]+)"|@(\S+)`)
	matches := mentionRegex.FindAllStringSubmatch(body, -1)

	if len(matches) == 0 {
		return nil
	}

	// Get all users to match against
	users, err := s.DB.ListUsers()
	if err != nil {
		return nil
	}

	// Build a map of lowercase display names to user IDs
	nameToID := make(map[string]int64)
	for _, u := range users {
		nameToID[strings.ToLower(u.DisplayName)] = u.ID
	}

	var mentionedIDs []int64
	seen := make(map[int64]bool)

	for _, match := range matches {
		// match[1] is the quoted name, match[2] is the unquoted name
		name := match[1]
		if name == "" {
			name = match[2]
		}
		name = strings.ToLower(name)

		if userID, ok := nameToID[name]; ok && !seen[userID] {
			mentionedIDs = append(mentionedIDs, userID)
			seen[userID] = true
		}
	}

	return mentionedIDs
}

// Admin handlers

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		// List all users with admin status
		users, err := s.DB.ListUsers()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(users)

	case "PUT":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// User credential handlers

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
		client := gitea.NewClient(req.ProviderURL, req.APIToken, s.Config.GiteaInsecureTLS)
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
