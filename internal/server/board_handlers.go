package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/jsnapoli/zira/internal/models"
)

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
