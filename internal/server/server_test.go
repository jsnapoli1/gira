package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/jsnapoli/gira/internal/auth"
	"github.com/jsnapoli/gira/internal/config"
	"github.com/jsnapoli/gira/internal/database"
	"github.com/jsnapoli/gira/internal/models"
)

func setupTestServer(t *testing.T) (*Server, *database.DB) {
	t.Helper()

	// Create a unique temp database for this test
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	os.Setenv("DB_PATH", dbPath)

	db, err := database.New()
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	cfg := &config.Config{
		Port: 9999,
	}

	srv := New(cfg, db, "test")
	return srv, db
}

func testEmail(name string) string {
	return fmt.Sprintf("%s@test.com", name)
}

func TestNew(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	os.Setenv("DB_PATH", dbPath)

	db, err := database.New()
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	defer db.Close()

	cfg := &config.Config{
		Port: 8080,
	}

	srv := New(cfg, db, "1.0.0")

	if srv == nil {
		t.Fatal("New returned nil")
	}
	if srv.Port != 8080 {
		t.Errorf("expected Port 8080, got %d", srv.Port)
	}
	if srv.Version != "1.0.0" {
		t.Errorf("expected Version '1.0.0', got %q", srv.Version)
	}
	if srv.SSEHub == nil {
		t.Error("SSEHub should not be nil")
	}
}

func TestHandleHealthz(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()

	srv.handleHealthz(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["status"] != "ok" {
		t.Errorf("expected status 'ok', got %q", resp["status"])
	}

	if resp["version"] != "test" {
		t.Errorf("expected version 'test', got %q", resp["version"])
	}
}

func TestRequireAuth_NoToken(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	handler := srv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestRequireAuth_InvalidToken(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	handler := srv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestRequireAuth_ValidToken(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, err := db.CreateUser(testEmail("valid-token"), "hashedpassword", "Test User")
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	token, err := auth.GenerateToken(user)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	handler := srv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		user := getUserFromContext(r.Context())
		if user == nil {
			t.Error("user should be in context")
		}
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestRequireAdmin_NotAdmin(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	// Create first user (will be auto-promoted to admin)
	_, err := db.CreateUser(testEmail("first-user"), "hashedpassword", "First User")
	if err != nil {
		t.Fatalf("failed to create first user: %v", err)
	}

	// Create second user (not an admin)
	user, err := db.CreateUser(testEmail("not-admin"), "hashedpassword", "Regular User")
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	token, err := auth.GenerateToken(user)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	handler := srv.requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", w.Code)
	}
}

func TestRequireAdmin_Admin(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, err := db.CreateUser(testEmail("is-admin"), "hashedpassword", "Admin User")
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	if err := db.SetUserAdmin(user.ID, true); err != nil {
		t.Fatalf("failed to promote user to admin: %v", err)
	}

	token, err := auth.GenerateToken(user)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	handler := srv.requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestRequireBoardRole(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, err := db.CreateUser(testEmail("board-role"), "hashedpassword", "Member User")
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	board, err := db.CreateBoard("Test Board Role", "Test Description", user.ID)
	if err != nil {
		t.Fatalf("failed to create board: %v", err)
	}

	if err := db.AddBoardMember(board.ID, user.ID, "member"); err != nil {
		t.Fatalf("failed to add board member: %v", err)
	}

	token, err := auth.GenerateToken(user)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	handler := srv.requireBoardRole(models.BoardRoleViewer, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx := setBoardRoleContext(req.Context(), "member")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestCheckBoardMembership_Admin(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	admin, err := db.CreateUser(testEmail("board-admin"), "hashedpassword", "Admin User")
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	if err := db.SetUserAdmin(admin.ID, true); err != nil {
		t.Fatalf("failed to promote user to admin: %v", err)
	}

	// Re-fetch user to get updated IsAdmin field
	admin, err = db.GetUserByID(admin.ID)
	if err != nil {
		t.Fatalf("failed to re-fetch admin user: %v", err)
	}

	owner, err := db.CreateUser(testEmail("board-owner"), "hashedpassword", "Owner")
	if err != nil {
		t.Fatalf("failed to create owner: %v", err)
	}

	board, err := db.CreateBoard("Test Board Membership", "Description", owner.ID)
	if err != nil {
		t.Fatalf("failed to create board: %v", err)
	}

	req := httptest.NewRequest("GET", "/test", nil)
	ctx := setUserContext(req.Context(), admin)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	result := srv.checkBoardMembership(w, req, board.ID, models.BoardRoleMember)

	if !result {
		t.Error("admin should have access to any board")
	}
}

func TestCorsMiddleware(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	handler := srv.corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Errorf("expected CORS origin header, got %q", w.Header().Get("Access-Control-Allow-Origin"))
	}

	req = httptest.NewRequest("OPTIONS", "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w = httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for OPTIONS, got %d", w.Code)
	}
}

func TestHandleSignup(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	tests := []struct {
		name       string
		body       map[string]interface{}
		wantStatus int
	}{
		{
			name:       "valid signup",
			body:       map[string]interface{}{"email": "signup@test.com", "password": "password123", "display_name": "Test User"},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing email",
			body:       map[string]interface{}{"password": "password123", "display_name": "Test User"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing password",
			body:       map[string]interface{}{"email": "no-pw@test.com", "display_name": "Test User"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "duplicate email",
			body:       map[string]interface{}{"email": "signup@test.com", "password": "password123", "display_name": "Duplicate"},
			wantStatus: http.StatusConflict,
		},
		{
			name:       "invalid json",
			body:       nil,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body *bytes.Buffer
			if tt.body != nil {
				jsonBody, _ := json.Marshal(tt.body)
				body = bytes.NewBuffer(jsonBody)
			} else {
				body = bytes.NewBufferString("invalid json")
			}

			req := httptest.NewRequest("POST", "/api/auth/signup", body)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			srv.handleSignup(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("handleSignup() status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}

func TestHandleLogin(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	// Create a test user
	hash, _ := auth.HashPassword("password123")
	db.CreateUser("login-test@test.com", hash, "Login User")

	tests := []struct {
		name       string
		body       map[string]interface{}
		wantStatus int
	}{
		{
			name:       "valid login",
			body:       map[string]interface{}{"email": "login-test@test.com", "password": "password123"},
			wantStatus: http.StatusOK,
		},
		{
			name:       "wrong password",
			body:       map[string]interface{}{"email": "login-test@test.com", "password": "wrongpassword"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "non-existent user",
			body:       map[string]interface{}{"email": "nobody@test.com", "password": "password123"},
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsonBody, _ := json.Marshal(tt.body)
			req := httptest.NewRequest("POST", "/api/auth/login", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			srv.handleLogin(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("handleLogin() status = %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}

func TestHandleMe(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser("me@test.com", "hashedpw", "Me User")
	token, _ := auth.GenerateToken(user)

	// Use the requireAuth middleware wrapper to set the user context
	handler := srv.requireAuth(srv.handleMe)

	req := httptest.NewRequest("GET", "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleMe() status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["email"] != "me@test.com" {
		t.Errorf("handleMe() email = %v, want me@test.com", resp["email"])
	}
}

func TestHandleConfigGet(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()

	srv.handleConfigGet(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleConfigGet() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleConfigStatus(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	req := httptest.NewRequest("GET", "/api/config/status", nil)
	w := httptest.NewRecorder()

	srv.handleConfigStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleConfigStatus() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestCheckAuthRateLimit(t *testing.T) {
	// Loopback addresses should always be allowed
	if !checkAuthRateLimit("127.0.0.1:8080") {
		t.Error("checkAuthRateLimit() should allow loopback IPv4")
	}
	if !checkAuthRateLimit("[::1]:8080") {
		t.Error("checkAuthRateLimit() should allow loopback IPv6")
	}
	if !checkAuthRateLimit("::ffff:127.0.0.1:8080") {
		t.Error("checkAuthRateLimit() should allow IPv4-mapped loopback")
	}
}

func TestHandleListBoards(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser("boards@test.com", "hashedpw", "Boards User")
	token, _ := auth.GenerateToken(user)

	handler := srv.requireAuth(srv.handleListBoards)

	req := httptest.NewRequest("GET", "/api/boards", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListBoards() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateBoard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser("create-board@test.com", "hashedpw", "Board Creator")
	token, _ := auth.GenerateToken(user)

	handler := srv.requireAuth(srv.handleCreateBoard)

	body := map[string]interface{}{"name": "Test Board", "description": "Test Description"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/boards", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateBoard() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleUsers(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser("users@test.com", "hashedpw", "Users List")
	token, _ := auth.GenerateToken(user)

	handler := srv.requireAuth(srv.handleUsers)

	req := httptest.NewRequest("GET", "/api/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleUsers() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleDashboard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser("dashboard@test.com", "hashedpw", "Dashboard User")
	token, _ := auth.GenerateToken(user)

	handler := srv.requireAuth(srv.handleDashboard)

	req := httptest.NewRequest("GET", "/api/dashboard", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleDashboard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

// Helper to create a test user with board
func setupTestBoard(t *testing.T, srv *Server, db *database.DB) (*models.User, string, *models.Board) {
	t.Helper()
	user, _ := db.CreateUser(testEmail("board-test"), "hashedpw", "Board Test")
	token, _ := auth.GenerateToken(user)
	board, _ := db.CreateBoard("Test Board", "Description", user.ID)
	return user, token, board
}

func TestHandleGetBoard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoard)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleUpdateBoard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleUpdateBoard)

	body := map[string]interface{}{"name": "Updated Board", "description": "Updated Description"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("PUT", fmt.Sprintf("/api/boards/%d", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleUpdateBoard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleDeleteBoard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleDeleteBoard)

	req := httptest.NewRequest("DELETE", fmt.Sprintf("/api/boards/%d", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("handleDeleteBoard() status = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestHandleGetBoardSwimlanes(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardSwimlanes)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/swimlanes", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardSwimlanes() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateBoardSwimlane(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateBoardSwimlane)

	body := map[string]interface{}{"name": "Test Swimlane", "repo_owner": "owner", "repo_name": "repo", "designator": "TEST"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/swimlanes", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateBoardSwimlane() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetBoardColumns(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardColumns)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/columns", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardColumns() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateBoardColumn(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateBoardColumn)

	body := map[string]interface{}{"name": "New Column", "state": "open"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/columns", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateBoardColumn() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetBoardMembers(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardMembers)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/members", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardMembers() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleAddBoardMember(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	newUser, _ := db.CreateUser(testEmail("new-member"), "hashedpw", "New Member")
	_ = user

	handler := srv.requireAuth(srv.handleAddBoardMember)

	body := map[string]interface{}{"user_id": newUser.ID, "role": "member"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/members", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleAddBoardMember() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetBoardCards(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardCards)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/cards", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardCards() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetBoardLabels(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardLabels)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/labels", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardLabels() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateBoardLabel(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateBoardLabel)

	body := map[string]interface{}{"name": "Bug", "color": "#ff0000"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/labels", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateBoardLabel() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetBoardCustomFields(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetBoardCustomFields)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/custom-fields", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetBoardCustomFields() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateBoardCustomField(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateBoardCustomField)

	body := map[string]interface{}{"name": "Priority", "field_type": "select", "options": "high,low", "required": true}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/custom-fields", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateBoardCustomField() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleListSavedFilters(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleListSavedFilters)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/filters", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListSavedFilters() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleListCardTemplates(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleListCardTemplates)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/templates", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListCardTemplates() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateCardTemplate(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateCardTemplate)

	body := map[string]interface{}{"name": "Bug Template", "issue_type": "bug", "description_template": "Steps to reproduce:"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/templates", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateCardTemplate() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleListIssueTypes(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleListIssueTypes)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/issue-types", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListIssueTypes() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateIssueType(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateIssueType)

	body := map[string]interface{}{"name": "Bug", "icon": "bug", "color": "#ff0000"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/boards/%d/issue-types", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateIssueType() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetWorkflow(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetWorkflow)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/boards/%d/workflow", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", board.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetWorkflow() status = %d, want %d", w.Code, http.StatusOK)
	}
}

// Card handler tests

func TestHandleCreateCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	// Create a swimlane for the board
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	// Get board with columns
	boardWithDetails, _ := db.GetBoardByID(board.ID)

	handler := srv.requireAuth(srv.handleCreateCard)

	body := map[string]interface{}{
		"board_id":    board.ID,
		"swimlane_id": swimlane.ID,
		"column_id":   boardWithDetails.Columns[0].ID,
		"title":       "Test Card",
		"description": "Test Description",
		"priority":    "high",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/cards", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateCard() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")
	boardWithDetails, _ := db.GetBoardByID(board.ID)

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCard)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleUpdateCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")
	boardWithDetails, _ := db.GetBoardByID(board.ID)

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleUpdateCard)

	body := map[string]interface{}{"title": "Updated Card", "description": "Updated Description"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("PATCH", fmt.Sprintf("/api/cards/%d", card.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleUpdateCard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleDeleteCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")
	boardWithDetails, _ := db.GetBoardByID(board.ID)

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleDeleteCard)

	req := httptest.NewRequest("DELETE", fmt.Sprintf("/api/cards/%d", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("handleDeleteCard() status = %d, want %d", w.Code, http.StatusNoContent)
	}
}

func TestHandleSearchCards(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleSearchCards)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/search?board_id=%d", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleSearchCards() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardComments(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardComments)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/comments", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardComments() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateCardComment(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleCreateCardComment)

	body := map[string]interface{}{"body": "Test comment"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/cards/%d/comments", card.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateCardComment() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetCardAssignees(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardAssignees)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/assignees", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardAssignees() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleAddCardAssignee(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleAddCardAssignee)

	body := map[string]interface{}{"user_id": user.ID}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/cards/%d/assignees", card.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleAddCardAssignee() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

func TestHandleGetCardLabels(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardLabels)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/labels", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardLabels() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardAttachments(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardAttachments)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/attachments", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardAttachments() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardWorkLogs(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardWorkLogs)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/worklogs", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardWorkLogs() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardActivity(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardActivity)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/activity", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardActivity() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardLinks(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardLinks)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/links", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardLinks() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardWatchers(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardWatchers)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/watchers", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardWatchers() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardCustomFields(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardCustomFields)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/custom-fields", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardCustomFields() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleGetCardChildren(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleGetCardChildren)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/cards/%d/children", card.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetCardChildren() status = %d, want %d", w.Code, http.StatusOK)
	}
}

// Sprint handler tests

func TestHandleListSprints(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleListSprints)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/sprints?board_id=%d", board.ID), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListSprints() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateSprint(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateSprint)

	body := map[string]interface{}{"name": "Sprint 1", "goal": "Complete feature"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/sprints?board_id=%d", board.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateSprint() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

// Notification handler tests

func TestHandleGetNotifications(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, _ := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleGetNotifications)

	req := httptest.NewRequest("GET", "/api/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetNotifications() status = %d, want %d", w.Code, http.StatusOK)
	}
}

// Credential handler tests

func TestHandleListUserCredentials(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, _ := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleListUserCredentials)

	req := httptest.NewRequest("GET", "/api/user/credentials", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleListUserCredentials() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleCreateUserCredential(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, _ := setupTestBoard(t, srv, db)
	_ = user

	handler := srv.requireAuth(srv.handleCreateUserCredential)

	body := map[string]interface{}{"provider": "github", "api_token": "test-token", "display_name": "GitHub"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/user/credentials", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("handleCreateUserCredential() status = %d, want %d", w.Code, http.StatusCreated)
	}
}

// More card handler tests

func TestHandleMoveCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleMoveCard)

	body := map[string]interface{}{"column_id": boardWithDetails.Columns[1].ID, "state": "in_progress"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/cards/%d/move", card.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleMoveCard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleReorderCard(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, token, board := setupTestBoard(t, srv, db)
	_ = user

	boardWithDetails, _ := db.GetBoardByID(board.ID)
	swimlane, _ := db.CreateSwimlane(board.ID, "Default", "owner", "repo", "TEST-", "#6366f1")

	card, _ := db.CreateCard(database.CreateCardInput{
		BoardID:    board.ID,
		SwimlaneID: swimlane.ID,
		ColumnID:   boardWithDetails.Columns[0].ID,
		Title:      "Test Card",
		State:      "open",
	})

	handler := srv.requireAuth(srv.handleReorderCard)

	body := map[string]interface{}{"position": 1000.0}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/cards/%d/reorder", card.ID), bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", card.ID))
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleReorderCard() status = %d, want %d", w.Code, http.StatusOK)
	}
}

// Admin handler tests

func TestHandleGetAdminUsers(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	user, _ := db.CreateUser(testEmail("admin-list"), "hashedpw", "Admin User")
	db.SetUserAdmin(user.ID, true)
	token, _ := auth.GenerateToken(user)

	handler := srv.requireAdmin(srv.handleGetAdminUsers)

	req := httptest.NewRequest("GET", "/api/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handleGetAdminUsers() status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandlePromoteAdmin(t *testing.T) {
	srv, db := setupTestServer(t)
	defer db.Close()

	admin, _ := db.CreateUser(testEmail("admin-promote"), "hashedpw", "Admin")
	db.SetUserAdmin(admin.ID, true)
	token, _ := auth.GenerateToken(admin)

	newUser, _ := db.CreateUser(testEmail("to-promote"), "hashedpw", "To Promote")

	handler := srv.requireAdmin(srv.handlePromoteAdmin)

	body := map[string]interface{}{"user_id": newUser.ID, "is_admin": true}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/api/admin/promote", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("handlePromoteAdmin() status = %d, want %d", w.Code, http.StatusOK)
	}
}
