package server

import (
	"context"

	"github.com/jsnapoli/gira/internal/models"
)

const boardRoleContextKey contextKey = "boardRole"

func setUserContext(ctx context.Context, user *models.User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

func getUserFromContext(ctx context.Context) *models.User {
	user, ok := ctx.Value(userContextKey).(*models.User)
	if !ok {
		return nil
	}
	return user
}

func setBoardRoleContext(ctx context.Context, role models.BoardRole) context.Context {
	return context.WithValue(ctx, boardRoleContextKey, role)
}

func getBoardRoleFromContext(ctx context.Context) models.BoardRole {
	role, ok := ctx.Value(boardRoleContextKey).(models.BoardRole)
	if !ok {
		return ""
	}
	return role
}
