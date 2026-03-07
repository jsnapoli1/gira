package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/jsnapoli/zira/internal/models"
)

func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())
	boards, err := s.DB.ListBoardsForUser(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(boards)
}

func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())
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
}

// loadBoardAndRole parses the board ID from the path, loads the board,
// checks membership, determines the user's role, and stores it in context.
// Returns the board and updated request, or nil if an error was written.
func (s *Server) loadBoardAndRole(w http.ResponseWriter, r *http.Request) (*models.Board, *http.Request) {
	user := getUserFromContext(r.Context())

	boardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return nil, r
	}

	board, err := s.DB.GetBoardByID(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, r
	}
	if board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return nil, r
	}

	// Check membership and determine role
	var boardRole models.BoardRole
	if user.IsAdmin {
		boardRole = models.BoardRoleAdmin
	} else if board.OwnerID == user.ID {
		boardRole = models.BoardRoleAdmin
	} else {
		isMember, role, err := s.DB.IsBoardMember(boardID, user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return nil, r
		}
		if !isMember {
			http.Error(w, "Access denied", http.StatusForbidden)
			return nil, r
		}
		boardRole = models.BoardRole(role)
	}

	r = r.WithContext(setBoardRoleContext(r.Context(), boardRole))
	return board, r
}

func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanView() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(board)
}

func (s *Server) handleUpdateBoard(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	if err := s.DB.DeleteBoard(board.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Swimlane handlers

func (s *Server) handleGetBoardSwimlanes(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleCreateBoardSwimlane(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleDeleteBoardSwimlane(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return // loadBoardAndRole already wrote the error
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	swimlaneID, err := strconv.ParseInt(r.PathValue("swimlaneId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid swimlane ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteSwimlane(swimlaneID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Column handlers

func (s *Server) handleGetBoardColumns(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleCreateBoardColumn(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleDeleteBoardColumn(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	columnID, err := strconv.ParseInt(r.PathValue("columnId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid column ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteColumn(columnID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleReorderBoardColumn(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	columnID, err := strconv.ParseInt(r.PathValue("columnId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid column ID", http.StatusBadRequest)
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
}

// Member handlers

func (s *Server) handleGetBoardMembers(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleAddBoardMember(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
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
}

func (s *Server) handleRemoveBoardMember(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	userID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.RemoveBoardMember(board.ID, userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Board cards handler

func (s *Server) handleGetBoardCards(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	cards, err := s.DB.ListCardsForBoard(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cards)
}

// Board labels handlers

func (s *Server) handleGetBoardLabels(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	labels, err := s.DB.GetBoardLabels(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(labels)
}

func (s *Server) handleCreateBoardLabel(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
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
}

func (s *Server) handleUpdateBoardLabel(w http.ResponseWriter, r *http.Request) {
	_, _ = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	labelID, err := strconv.ParseInt(r.PathValue("labelId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid label ID", http.StatusBadRequest)
		return
	}
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
}

func (s *Server) handleDeleteBoardLabel(w http.ResponseWriter, r *http.Request) {
	_, _ = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	labelID, err := strconv.ParseInt(r.PathValue("labelId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid label ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteLabel(labelID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Board custom fields handlers

func (s *Server) handleGetBoardCustomFields(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
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
}

func (s *Server) handleCreateBoardCustomField(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
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
}

func (s *Server) handleGetBoardCustomField(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(field)
}

func (s *Server) handleUpdateBoardCustomField(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
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
}

func (s *Server) handleDeleteBoardCustomField(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
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
	if err := s.DB.DeleteCustomFieldDefinition(fieldID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
