package server

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/jsnapoli/gira/internal/auth"
)

// Simple in-memory rate limiter for auth endpoints
var authRateLimiter = struct {
	sync.Mutex
	attempts map[string][]time.Time
}{attempts: make(map[string][]time.Time)}

func checkAuthRateLimit(remoteAddr string) bool {
	// Exempt loopback addresses — rate-limiting provides no security benefit
	// for requests from the local machine and breaks parallel E2E test suites.
	// Use net.ParseIP().IsLoopback() to correctly handle IPv4-mapped IPv6
	// addresses (::ffff:127.0.0.1) that appear when the Go server listens on
	// dual-stack ":PORT" and receives an IPv4 connection on macOS/Linux.
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr // no port in address, use as-is
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}

	authRateLimiter.Lock()
	defer authRateLimiter.Unlock()
	now := time.Now()
	window := now.Add(-1 * time.Minute)
	// Remove old entries
	recent := authRateLimiter.attempts[host]
	filtered := recent[:0]
	for _, t := range recent {
		if t.After(window) {
			filtered = append(filtered, t)
		}
	}
	authRateLimiter.attempts[host] = filtered
	if len(filtered) >= 10 { // max 10 attempts per minute
		return false
	}
	authRateLimiter.attempts[host] = append(filtered, now)
	return true
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if !checkAuthRateLimit(r.RemoteAddr) {
		http.Error(w, "Too many requests, try again later", http.StatusTooManyRequests)
		return
	}
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Signup decode error: %v", err)
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
		log.Printf("Failed to hash password: %v", err)
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Create user
	user, err := s.DB.CreateUser(req.Email, hash, req.DisplayName)
	if err != nil {
		log.Printf("Failed to create user in DB: %v", err)
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
	if !checkAuthRateLimit(r.RemoteAddr) {
		http.Error(w, "Too many requests, try again later", http.StatusTooManyRequests)
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
	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// handlePromoteAdmin promotes a user to admin.
// Self-promotion: POST with no body or empty user_id promotes the caller.
// Promote another: POST with { user_id } promotes that user (requires caller to be admin).
func (s *Server) handlePromoteAdmin(w http.ResponseWriter, r *http.Request) {
	caller := getUserFromContext(r.Context())
	if caller == nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	// Try to parse request body for user_id
	var req struct {
		UserID int64 `json:"user_id"`
	}
	// Ignore decode errors — empty body means self-promotion
	json.NewDecoder(r.Body).Decode(&req)

	targetID := req.UserID
	if targetID == 0 {
		// Self-promotion
		targetID = caller.ID
	} else if targetID != caller.ID {
		// Promoting another user — requires admin
		if !caller.IsAdmin {
			http.Error(w, "Admin access required to promote other users", http.StatusForbidden)
			return
		}
	}

	if err := s.DB.SetUserAdmin(targetID, true); err != nil {
		http.Error(w, "Failed to promote user", http.StatusInternalServerError)
		return
	}

	user, err := s.DB.GetUserByID(targetID)
	if err != nil {
		http.Error(w, "Failed to fetch user", http.StatusInternalServerError)
		return
	}
	if user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}
