package server

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jsnapoli/zira/internal/auth"
	"github.com/jsnapoli/zira/internal/models"
)

// handleDashboard returns a combined dashboard view with boards, assigned cards, and active sprints.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	boards, err := s.DB.ListBoardsForUser(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if boards == nil {
		boards = []models.Board{}
	}

	myCards, err := s.DB.GetUserAssignedCards(user.ID, 20)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if myCards == nil {
		myCards = []models.Card{}
	}

	activeSprints, err := s.DB.GetActiveSprintsForUser(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if activeSprints == nil {
		activeSprints = []models.Sprint{}
	}

	// For active sprints, compute card counts
	type sprintWithProgress struct {
		models.Sprint
		TotalCards     int    `json:"total_cards"`
		CompletedCards int    `json:"completed_cards"`
		TotalPoints    int    `json:"total_points"`
		CompletedPts   int    `json:"completed_points"`
		BoardName      string `json:"board_name"`
	}

	sprintsOut := make([]sprintWithProgress, 0, len(activeSprints))
	for _, sp := range activeSprints {
		swp := sprintWithProgress{Sprint: sp}
		board, err := s.DB.GetBoardByID(sp.BoardID)
		if err == nil && board != nil {
			swp.BoardName = board.Name
		}
		sprintCards, err := s.DB.ListCardsForSprint(sp.ID)
		if err == nil {
			swp.TotalCards = len(sprintCards)
			for _, c := range sprintCards {
				if c.State == "closed" || c.State == "done" {
					swp.CompletedCards++
					if c.StoryPoints != nil {
						swp.CompletedPts += *c.StoryPoints
					}
				}
				if c.StoryPoints != nil {
					swp.TotalPoints += *c.StoryPoints
				}
			}
		}
		sprintsOut = append(sprintsOut, swp)
	}

	// Build board name map for cards
	boardNameMap := make(map[int64]string)
	for _, b := range boards {
		boardNameMap[b.ID] = b.Name
	}

	type cardWithBoard struct {
		models.Card
		BoardName string `json:"board_name"`
	}

	cardsOut := make([]cardWithBoard, 0, len(myCards))
	for _, c := range myCards {
		cwb := cardWithBoard{Card: c}
		if name, ok := boardNameMap[c.BoardID]; ok {
			cwb.BoardName = name
		} else {
			board, err := s.DB.GetBoardByID(c.BoardID)
			if err == nil && board != nil {
				cwb.BoardName = board.Name
				boardNameMap[c.BoardID] = board.Name
			}
		}
		cardsOut = append(cardsOut, cwb)
	}

	result := struct {
		Boards        []models.Board       `json:"boards"`
		MyCards       []cardWithBoard      `json:"my_cards"`
		ActiveSprints []sprintWithProgress `json:"active_sprints"`
	}{
		Boards:        boards,
		MyCards:       cardsOut,
		ActiveSprints: sprintsOut,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

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

// Saved filter handlers

func (s *Server) handleListSavedFilters(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanView() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	user := getUserFromContext(r.Context())
	filters, err := s.DB.ListSavedFilters(board.ID, user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if filters == nil {
		filters = []models.SavedFilter{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(filters)
}

func (s *Server) handleCreateSavedFilter(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanView() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	user := getUserFromContext(r.Context())
	var req struct {
		Name       string `json:"name"`
		FilterJSON string `json:"filter_json"`
		IsShared   bool   `json:"is_shared"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.FilterJSON == "" {
		http.Error(w, "Filter JSON is required", http.StatusBadRequest)
		return
	}
	if len(req.FilterJSON) > 65536 {
		http.Error(w, "Filter JSON exceeds maximum size (64KB)", http.StatusBadRequest)
		return
	}
	// Validate filter_json is valid JSON
	var jsonCheck json.RawMessage
	if err := json.Unmarshal([]byte(req.FilterJSON), &jsonCheck); err != nil {
		http.Error(w, "filter_json must be valid JSON", http.StatusBadRequest)
		return
	}
	filter, err := s.DB.CreateSavedFilter(board.ID, user.ID, req.Name, req.FilterJSON, req.IsShared)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(filter)
}

func (s *Server) handleUpdateSavedFilter(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	user := getUserFromContext(r.Context())
	filterID, err := strconv.ParseInt(r.PathValue("filterId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid filter ID", http.StatusBadRequest)
		return
	}
	filter, err := s.DB.GetSavedFilterByID(filterID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if filter == nil || filter.BoardID != board.ID {
		http.Error(w, "Filter not found", http.StatusNotFound)
		return
	}
	if filter.OwnerID != user.ID {
		http.Error(w, "Only the filter owner can update it", http.StatusForbidden)
		return
	}
	var req struct {
		Name       string `json:"name"`
		FilterJSON string `json:"filter_json"`
		IsShared   bool   `json:"is_shared"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.FilterJSON != "" {
		if len(req.FilterJSON) > 65536 {
			http.Error(w, "Filter JSON exceeds maximum size (64KB)", http.StatusBadRequest)
			return
		}
		var jsonCheck json.RawMessage
		if err := json.Unmarshal([]byte(req.FilterJSON), &jsonCheck); err != nil {
			http.Error(w, "filter_json must be valid JSON", http.StatusBadRequest)
			return
		}
	}
	if err := s.DB.UpdateSavedFilter(filterID, req.Name, req.FilterJSON, req.IsShared); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	updated, _ := s.DB.GetSavedFilterByID(filterID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (s *Server) handleDeleteSavedFilter(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	user := getUserFromContext(r.Context())
	filterID, err := strconv.ParseInt(r.PathValue("filterId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid filter ID", http.StatusBadRequest)
		return
	}
	filter, err := s.DB.GetSavedFilterByID(filterID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if filter == nil || filter.BoardID != board.ID {
		http.Error(w, "Filter not found", http.StatusNotFound)
		return
	}
	if filter.OwnerID != user.ID {
		http.Error(w, "Only the filter owner can delete it", http.StatusForbidden)
		return
	}
	if err := s.DB.DeleteSavedFilter(filterID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

// handleExportBoardCards exports all cards for a board as CSV.
func (s *Server) handleExportBoardCards(w http.ResponseWriter, r *http.Request) {
	boardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
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
	board, err := s.DB.GetBoardByID(boardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}
	if board.OwnerID != user.ID && !user.IsAdmin {
		isMember, _, err := s.DB.IsBoardMember(boardID, user.ID)
		if err != nil || !isMember {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
	}
	cards, err := s.DB.ListCardsForBoard(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sprintsList, _ := s.DB.ListSprintsForBoard(boardID)
	sprintMap := make(map[int64]string)
	for _, sp := range sprintsList {
		sprintMap[sp.ID] = sp.Name
	}
	columns, _ := s.DB.GetBoardColumns(boardID)
	columnMap := make(map[int64]string)
	for _, col := range columns {
		columnMap[col.ID] = col.Name
	}
	swimlanes, _ := s.DB.GetBoardSwimlanes(boardID)
	swimlaneMap := make(map[int64]string)
	for _, sl := range swimlanes {
		swimlaneMap[sl.ID] = sl.Name
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s-cards.csv\"", board.Name))
	writer := csv.NewWriter(w)
	defer writer.Flush()
	writer.Write([]string{"ID", "Title", "Type", "State", "Column", "Swimlane", "Priority", "Assignees", "Labels", "Sprint", "Story Points", "Due Date", "Created"})
	for _, c := range cards {
		assigneeNames := make([]string, len(c.Assignees))
		for i, a := range c.Assignees {
			assigneeNames[i] = a.DisplayName
		}
		labelNames := make([]string, len(c.Labels))
		for i, l := range c.Labels {
			labelNames[i] = l.Name
		}
		sp := ""
		if c.SprintID != nil {
			sp = sprintMap[*c.SprintID]
		}
		pts := ""
		if c.StoryPoints != nil {
			pts = strconv.Itoa(*c.StoryPoints)
		}
		due := ""
		if c.DueDate != nil {
			due = c.DueDate.Format("2006-01-02")
		}
		writer.Write([]string{
			strconv.FormatInt(c.ID, 10), c.Title, c.IssueType, c.State,
			columnMap[c.ColumnID], swimlaneMap[c.SwimlaneID], c.Priority,
			strings.Join(assigneeNames, "; "), strings.Join(labelNames, "; "),
			sp, pts, due, c.CreatedAt.Format("2006-01-02"),
		})
	}
}
