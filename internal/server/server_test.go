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
