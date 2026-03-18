package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jsnapoli/zira/internal/models"
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
