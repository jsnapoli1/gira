package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/jsnapoli/zira/internal/auth"
	"github.com/jsnapoli/zira/internal/config"
	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/gitea"
	"github.com/jsnapoli/zira/internal/github"
	"github.com/jsnapoli/zira/internal/models"
)

type Server struct {
	Config   *config.Config
	Client   *gitea.Client
	configMu sync.RWMutex // protects Config and Client
	DB       *database.DB
	Port     int
	Version  string
	SSEHub   *SSEHub
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
	// Snapshot config values under read lock to avoid holding lock during DB calls
	s.configMu.RLock()
	giteaURL := s.Config.GiteaURL
	insecureTLS := s.Config.GiteaInsecureTLS
	globalClient := s.Client
	s.configMu.RUnlock()

	switch swimlane.RepoSource {
	case "default_gitea", "":
		// 1. Check swimlane-specific credentials
		token, err := s.DB.GetSwimlaneCredential(swimlane.ID)
		if err != nil {
			return nil, err
		}
		if token != "" {
			return gitea.NewClient(giteaURL, token, insecureTLS), nil
		}

		// 2. Check user credentials for the default Gitea
		if userID > 0 {
			userCred, err := s.DB.GetUserCredential(userID, "gitea", giteaURL)
			if err != nil {
				return nil, err
			}
			if userCred != nil && userCred.APIToken != "" {
				return gitea.NewClient(giteaURL, userCred.APIToken, insecureTLS), nil
			}
		}

		// 3. Fall back to global config
		return globalClient, nil

	case "custom_gitea":
		// 1. Check swimlane-specific credentials
		token, err := s.DB.GetSwimlaneCredential(swimlane.ID)
		if err != nil {
			return nil, err
		}
		if token != "" {
			return gitea.NewClient(swimlane.RepoURL, token, insecureTLS), nil
		}

		// 2. Check user credentials for this custom Gitea URL
		if userID > 0 {
			userCred, err := s.DB.GetUserCredential(userID, "gitea", swimlane.RepoURL)
			if err != nil {
				return nil, err
			}
			if userCred != nil && userCred.APIToken != "" {
				return gitea.NewClient(swimlane.RepoURL, userCred.APIToken, insecureTLS), nil
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
	mux.HandleFunc("POST /api/auth/signup", s.handleSignup)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.requireAuth(s.handleMe))

	// Config routes
	mux.HandleFunc("GET /api/config", s.handleConfigGet)
	mux.HandleFunc("POST /api/config", s.requireAdmin(s.handleConfigPost))
	mux.HandleFunc("GET /api/config/status", s.handleConfigStatus)

	// Admin routes
	mux.HandleFunc("GET /api/admin/users", s.requireAdmin(s.handleGetAdminUsers))
	mux.HandleFunc("PUT /api/admin/users", s.requireAdmin(s.handleUpdateAdminUser))

	// Gitea API routes
	mux.HandleFunc("GET /api/repos", s.requireAuth(s.handleRepos))
	mux.HandleFunc("GET /api/issues", s.requireAuth(s.requireConfig(s.handleIssues)))
	mux.HandleFunc("GET /api/issue", s.requireAuth(s.requireConfig(s.handleIssue)))
	mux.HandleFunc("GET /api/labels", s.requireAuth(s.requireConfig(s.handleLabels)))
	mux.HandleFunc("GET /api/milestones", s.requireAuth(s.requireConfig(s.handleMilestones)))

	// Board routes
	mux.HandleFunc("GET /api/boards", s.requireAuth(s.handleListBoards))
	mux.HandleFunc("POST /api/boards", s.requireAuth(s.handleCreateBoard))

	// Board SSE route (no requireAuth - uses token query param)
	mux.HandleFunc("GET /api/boards/{id}/events", s.handleBoardSSE)

	// Board sub-resource routes
	mux.HandleFunc("GET /api/boards/{id}/swimlanes", s.requireAuth(s.handleGetBoardSwimlanes))
	mux.HandleFunc("POST /api/boards/{id}/swimlanes", s.requireAuth(s.handleCreateBoardSwimlane))
	mux.HandleFunc("DELETE /api/boards/{id}/swimlanes/{swimlaneId}", s.requireAuth(s.handleDeleteBoardSwimlane))

	mux.HandleFunc("GET /api/boards/{id}/columns", s.requireAuth(s.handleGetBoardColumns))
	mux.HandleFunc("POST /api/boards/{id}/columns", s.requireAuth(s.handleCreateBoardColumn))
	mux.HandleFunc("DELETE /api/boards/{id}/columns/{columnId}", s.requireAuth(s.handleDeleteBoardColumn))
	mux.HandleFunc("POST /api/boards/{id}/columns/{columnId}/reorder", s.requireAuth(s.handleReorderBoardColumn))

	mux.HandleFunc("GET /api/boards/{id}/members", s.requireAuth(s.handleGetBoardMembers))
	mux.HandleFunc("POST /api/boards/{id}/members", s.requireAuth(s.handleAddBoardMember))
	mux.HandleFunc("DELETE /api/boards/{id}/members/{userId}", s.requireAuth(s.handleRemoveBoardMember))

	mux.HandleFunc("GET /api/boards/{id}/cards", s.requireAuth(s.handleGetBoardCards))

	mux.HandleFunc("GET /api/boards/{id}/labels", s.requireAuth(s.handleGetBoardLabels))
	mux.HandleFunc("POST /api/boards/{id}/labels", s.requireAuth(s.handleCreateBoardLabel))
	mux.HandleFunc("PUT /api/boards/{id}/labels/{labelId}", s.requireAuth(s.handleUpdateBoardLabel))
	mux.HandleFunc("DELETE /api/boards/{id}/labels/{labelId}", s.requireAuth(s.handleDeleteBoardLabel))

	mux.HandleFunc("GET /api/boards/{id}/custom-fields", s.requireAuth(s.handleGetBoardCustomFields))
	mux.HandleFunc("POST /api/boards/{id}/custom-fields", s.requireAuth(s.handleCreateBoardCustomField))
	mux.HandleFunc("GET /api/boards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleGetBoardCustomField))
	mux.HandleFunc("PUT /api/boards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleUpdateBoardCustomField))
	mux.HandleFunc("DELETE /api/boards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleDeleteBoardCustomField))

	// Board single resource routes (after sub-resources for correct matching)
	mux.HandleFunc("GET /api/boards/{id}", s.requireAuth(s.handleGetBoard))
	mux.HandleFunc("PUT /api/boards/{id}", s.requireAuth(s.handleUpdateBoard))
	mux.HandleFunc("DELETE /api/boards/{id}", s.requireAuth(s.handleDeleteBoard))

	// Sprint routes
	mux.HandleFunc("GET /api/sprints", s.requireAuth(s.handleListSprints))
	mux.HandleFunc("POST /api/sprints", s.requireAuth(s.handleCreateSprint))
	mux.HandleFunc("GET /api/sprints/{id}", s.requireAuth(s.handleGetSprint))
	mux.HandleFunc("PUT /api/sprints/{id}", s.requireAuth(s.handleUpdateSprint))
	mux.HandleFunc("DELETE /api/sprints/{id}", s.requireAuth(s.handleDeleteSprint))
	mux.HandleFunc("POST /api/sprints/{id}/start", s.requireAuth(s.handleStartSprint))
	mux.HandleFunc("POST /api/sprints/{id}/complete", s.requireAuth(s.handleCompleteSprint))
	mux.HandleFunc("GET /api/sprints/{id}/cards", s.requireAuth(s.handleGetSprintCards))
	mux.HandleFunc("GET /api/sprints/{id}/metrics", s.requireAuth(s.handleGetSprintMetrics))

	// Card routes
	mux.HandleFunc("GET /api/cards/search", s.requireAuth(s.handleSearchCards))
	mux.HandleFunc("POST /api/cards", s.requireAuth(s.handleCreateCard))
	mux.HandleFunc("GET /api/cards/{id}", s.requireAuth(s.handleGetCard))
	mux.HandleFunc("PUT /api/cards/{id}", s.requireAuth(s.handleUpdateCard))
	mux.HandleFunc("DELETE /api/cards/{id}", s.requireAuth(s.handleDeleteCard))
	mux.HandleFunc("POST /api/cards/{id}/move", s.requireAuth(s.handleMoveCard))
	mux.HandleFunc("POST /api/cards/{id}/reorder", s.requireAuth(s.handleReorderCard))
	mux.HandleFunc("POST /api/cards/{id}/assign-sprint", s.requireAuth(s.handleAssignCardSprint))
	mux.HandleFunc("GET /api/cards/{id}/assignees", s.requireAuth(s.handleGetCardAssignees))
	mux.HandleFunc("POST /api/cards/{id}/assignees", s.requireAuth(s.handleAddCardAssignee))
	mux.HandleFunc("DELETE /api/cards/{id}/assignees/{userId}", s.requireAuth(s.handleRemoveCardAssignee))
	mux.HandleFunc("GET /api/cards/{id}/comments", s.requireAuth(s.handleGetCardComments))
	mux.HandleFunc("POST /api/cards/{id}/comments", s.requireAuth(s.handleCreateCardComment))
	mux.HandleFunc("GET /api/cards/{id}/labels", s.requireAuth(s.handleGetCardLabels))
	mux.HandleFunc("POST /api/cards/{id}/labels", s.requireAuth(s.handleAddCardLabel))
	mux.HandleFunc("DELETE /api/cards/{id}/labels/{labelId}", s.requireAuth(s.handleRemoveCardLabel))
	mux.HandleFunc("GET /api/cards/{id}/attachments", s.requireAuth(s.handleGetCardAttachments))
	mux.HandleFunc("POST /api/cards/{id}/attachments", s.requireAuth(s.handleUploadCardAttachment))
	mux.HandleFunc("DELETE /api/cards/{id}/attachments/{attachmentId}", s.requireAuth(s.handleDeleteCardAttachment))
	mux.HandleFunc("GET /api/cards/{id}/custom-fields", s.requireAuth(s.handleGetCardCustomFields))
	mux.HandleFunc("GET /api/cards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleGetCardCustomField))
	mux.HandleFunc("PUT /api/cards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleSetCardCustomField))
	mux.HandleFunc("DELETE /api/cards/{id}/custom-fields/{fieldId}", s.requireAuth(s.handleDeleteCardCustomField))
	mux.HandleFunc("GET /api/cards/{id}/worklogs", s.requireAuth(s.handleGetCardWorkLogs))
	mux.HandleFunc("POST /api/cards/{id}/worklogs", s.requireAuth(s.handleCreateCardWorkLog))
	mux.HandleFunc("DELETE /api/cards/{id}/worklogs/{worklogId}", s.requireAuth(s.handleDeleteCardWorkLog))
	mux.HandleFunc("GET /api/cards/{id}/children", s.requireAuth(s.handleGetCardChildren))
	mux.HandleFunc("GET /api/cards/{id}/links", s.requireAuth(s.handleGetCardLinks))
	mux.HandleFunc("POST /api/cards/{id}/links", s.requireAuth(s.handleCreateCardLink))
	mux.HandleFunc("DELETE /api/cards/{id}/links/{linkId}", s.requireAuth(s.handleDeleteCardLink))

	// Metrics routes
	mux.HandleFunc("GET /api/metrics/burndown", s.requireAuth(s.handleBurndown))
	mux.HandleFunc("GET /api/metrics/velocity", s.requireAuth(s.handleVelocity))

	// User routes
	mux.HandleFunc("GET /api/users", s.requireAuth(s.handleUsers))

	// User credentials routes
	mux.HandleFunc("GET /api/user/credentials", s.requireAuth(s.handleListUserCredentials))
	mux.HandleFunc("POST /api/user/credentials", s.requireAuth(s.handleCreateUserCredential))
	mux.HandleFunc("POST /api/user/credentials/test", s.requireAuth(s.handleTestCredential))
	mux.HandleFunc("GET /api/user/credentials/{id}", s.requireAuth(s.handleGetUserCredential))
	mux.HandleFunc("PUT /api/user/credentials/{id}", s.requireAuth(s.handleUpdateUserCredential))
	mux.HandleFunc("DELETE /api/user/credentials/{id}", s.requireAuth(s.handleDeleteUserCredential))

	// Attachment download route (no auth required - IDs are not guessable and images need to load in <img> tags)
	mux.HandleFunc("GET /api/attachments/{id}", s.handleAttachmentDownload)

	// Notification routes
	mux.HandleFunc("GET /api/notifications", s.requireAuth(s.handleGetNotifications))
	mux.HandleFunc("POST /api/notifications", s.requireAuth(s.handleMarkAllNotificationsRead))
	mux.HandleFunc("PUT /api/notifications/{id}", s.requireAuth(s.handleMarkNotificationRead))
	mux.HandleFunc("DELETE /api/notifications/{id}", s.requireAuth(s.handleDeleteNotification))

	// Health check route (for Docker/Portainer)
	mux.HandleFunc("GET /healthz", s.handleHealthz)

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
		s.configMu.RLock()
		configured := s.Config.IsConfigured()
		s.configMu.RUnlock()
		if !configured {
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

// checkBoardMembership verifies the authenticated user has at least the given
// minimum role on the specified board. It returns true if the user is allowed,
// or false after writing an HTTP error response.
func (s *Server) checkBoardMembership(w http.ResponseWriter, r *http.Request, boardID int64, minRole models.BoardRole) bool {
	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return false
	}

	// App admins can access any board
	if user.IsAdmin {
		return true
	}

	// Check board ownership
	board, err := s.DB.GetBoardByID(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return false
	}
	if board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return false
	}
	if board.OwnerID == user.ID {
		return true
	}

	// Check membership
	isMember, role, err := s.DB.IsBoardMember(boardID, user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return false
	}
	if !isMember {
		http.Error(w, "Access denied", http.StatusForbidden)
		return false
	}

	boardRole := models.BoardRole(role)
	switch minRole {
	case models.BoardRoleViewer:
		if boardRole.CanView() {
			return true
		}
	case models.BoardRoleMember:
		if boardRole.CanEditCards() {
			return true
		}
	case models.BoardRoleAdmin:
		if boardRole.CanEditBoard() {
			return true
		}
	}

	http.Error(w, "Insufficient permissions", http.StatusForbidden)
	return false
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"version": s.Version,
	})
}
