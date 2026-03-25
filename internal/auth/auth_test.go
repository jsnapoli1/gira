package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jsnapoli/gira/internal/models"
)

func TestGenerateAndValidateToken(t *testing.T) {
	user := &models.User{
		ID:      42,
		Email:   "test@example.com",
		IsAdmin: true,
	}

	tokenString, err := GenerateToken(user)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	if tokenString == "" {
		t.Fatal("GenerateToken() returned empty string")
	}

	claims, err := ValidateToken(tokenString)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.UserID != user.ID {
		t.Errorf("claims.UserID = %d, want %d", claims.UserID, user.ID)
	}
	if claims.Email != user.Email {
		t.Errorf("claims.Email = %q, want %q", claims.Email, user.Email)
	}
	if claims.IsAdmin != user.IsAdmin {
		t.Errorf("claims.IsAdmin = %v, want %v", claims.IsAdmin, user.IsAdmin)
	}
	if claims.Subject != "42" {
		t.Errorf("claims.Subject = %q, want %q", claims.Subject, "42")
	}
}

func TestExpiredToken(t *testing.T) {
	// Build a token that expired in the past
	claims := Claims{
		UserID:  1,
		Email:   "expired@example.com",
		IsAdmin: false,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			Subject:   "1",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(getJWTSecret())
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	_, err = ValidateToken(tokenString)
	if err != ErrExpiredToken {
		t.Errorf("ValidateToken() error = %v, want %v", err, ErrExpiredToken)
	}
}

func TestInvalidToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{"empty string", ""},
		{"garbage", "not-a-jwt-token"},
		{"truncated", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx"},
		{"wrong signature", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.wrongsignature"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ValidateToken(tt.token)
			if err != ErrInvalidToken {
				t.Errorf("ValidateToken(%q) error = %v, want %v", tt.token, err, ErrInvalidToken)
			}
		})
	}
}

func TestHashAndCheckPassword(t *testing.T) {
	password := "s3cureP@ssw0rd"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash == "" {
		t.Fatal("HashPassword() returned empty string")
	}
	if hash == password {
		t.Fatal("HashPassword() returned plaintext password")
	}

	if !CheckPassword(password, hash) {
		t.Error("CheckPassword() returned false for correct password")
	}
	if CheckPassword("wrongpassword", hash) {
		t.Error("CheckPassword() returned true for wrong password")
	}
}

func TestExtractTokenFromRequest(t *testing.T) {
	tests := []struct {
		name          string
		authHeader    string
		expectedToken string
	}{
		{
			name:          "valid bearer token",
			authHeader:    "Bearer my-jwt-token",
			expectedToken: "my-jwt-token",
		},
		{
			name:          "empty header",
			authHeader:    "",
			expectedToken: "",
		},
		{
			name:          "invalid format - no bearer prefix",
			authHeader:    "my-jwt-token",
			expectedToken: "",
		},
		{
			name:          "invalid format - too many parts",
			authHeader:    "Bearer token extra",
			expectedToken: "",
		},
		{
			name:          "case insensitive bearer",
			authHeader:    "bearer my-jwt-token",
			expectedToken: "my-jwt-token",
		},
		{
			name:          "BEARER uppercase",
			authHeader:    "BEARER my-jwt-token",
			expectedToken: "my-jwt-token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}

			token := ExtractTokenFromRequest(req)
			if token != tt.expectedToken {
				t.Errorf("ExtractTokenFromRequest() = %q, want %q", token, tt.expectedToken)
			}
		})
	}
}

func TestGetJWTSecret_WithEnvVar(t *testing.T) {
	originalSecret := os.Getenv("JWT_SECRET")
	defer os.Setenv("JWT_SECRET", originalSecret)

	testSecret := "my-custom-secret-for-testing"
	os.Setenv("JWT_SECRET", testSecret)

	secret := getJWTSecret()
	if string(secret) != testSecret {
		t.Errorf("getJWTSecret() = %q, want %q", string(secret), testSecret)
	}
}

func TestGetJWTSecret_Default(t *testing.T) {
	originalSecret := os.Getenv("JWT_SECRET")
	defer os.Setenv("JWT_SECRET", originalSecret)

	os.Unsetenv("JWT_SECRET")

	secret := getJWTSecret()
	if string(secret) != "gira-default-secret-change-in-production" {
		t.Errorf("getJWTSecret() = %q, want default secret", string(secret))
	}
}

func TestGenerateToken_AdminUser(t *testing.T) {
	user := &models.User{
		ID:      1,
		Email:   "admin@example.com",
		IsAdmin: true,
	}

	tokenString, err := GenerateToken(user)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	claims, err := ValidateToken(tokenString)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if !claims.IsAdmin {
		t.Error("claims.IsAdmin should be true for admin user")
	}
}

func TestGenerateToken_NonAdminUser(t *testing.T) {
	user := &models.User{
		ID:      2,
		Email:   "user@example.com",
		IsAdmin: false,
	}

	tokenString, err := GenerateToken(user)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	claims, err := ValidateToken(tokenString)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.IsAdmin {
		t.Error("claims.IsAdmin should be false for non-admin user")
	}
}

func TestClaims_Structure(t *testing.T) {
	claims := Claims{
		UserID:  100,
		Email:   "claims@example.com",
		IsAdmin: true,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   "100",
		},
	}

	if claims.UserID != 100 {
		t.Errorf("claims.UserID = %d, want 100", claims.UserID)
	}
	if claims.Email != "claims@example.com" {
		t.Errorf("claims.Email = %q, want 'claims@example.com'", claims.Email)
	}
	if !claims.IsAdmin {
		t.Error("claims.IsAdmin should be true")
	}
}

func TestValidateToken_UnexpectedSigningMethod(t *testing.T) {
	// Create an RSA private key
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	// Create a token signed with RS256 instead of HS256
	claims := Claims{
		UserID:  1,
		Email:   "test@example.com",
		IsAdmin: false,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   "1",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign RSA token: %v", err)
	}

	// Try to validate with our HS256 validator - should fail with unexpected signing method
	_, err = ValidateToken(tokenString)
	if err == nil {
		t.Error("ValidateToken() should fail with RSA token")
	}
	// The error should be ErrInvalidToken because the signing method check triggers
	if err != ErrInvalidToken {
		t.Errorf("ValidateToken() with RS256 error = %v, want %v", err, ErrInvalidToken)
	}
}
