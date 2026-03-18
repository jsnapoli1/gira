package models

import "testing"

func TestBoardRoleCanEditBoard(t *testing.T) {
	tests := []struct {
		role BoardRole
		want bool
	}{
		{BoardRoleAdmin, true},
		{BoardRoleMember, false},
		{BoardRoleViewer, false},
		{BoardRole("unknown"), false},
	}
	for _, tt := range tests {
		t.Run(string(tt.role), func(t *testing.T) {
			if got := tt.role.CanEditBoard(); got != tt.want {
				t.Errorf("BoardRole(%q).CanEditBoard() = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

func TestBoardRoleCanEditCards(t *testing.T) {
	tests := []struct {
		role BoardRole
		want bool
	}{
		{BoardRoleAdmin, true},
		{BoardRoleMember, true},
		{BoardRoleViewer, false},
		{BoardRole("unknown"), false},
	}
	for _, tt := range tests {
		t.Run(string(tt.role), func(t *testing.T) {
			if got := tt.role.CanEditCards(); got != tt.want {
				t.Errorf("BoardRole(%q).CanEditCards() = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

func TestBoardRoleCanView(t *testing.T) {
	tests := []struct {
		role BoardRole
		want bool
	}{
		{BoardRoleAdmin, true},
		{BoardRoleMember, true},
		{BoardRoleViewer, true},
		{BoardRole("unknown"), false},
	}
	for _, tt := range tests {
		t.Run(string(tt.role), func(t *testing.T) {
			if got := tt.role.CanView(); got != tt.want {
				t.Errorf("BoardRole(%q).CanView() = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}
