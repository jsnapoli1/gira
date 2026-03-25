package server

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/gira/internal/auth"
	"github.com/jsnapoli/gira/internal/database"
	"github.com/jsnapoli/gira/internal/models"
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
		Template    string `json:"template"` // "kanban", "scrum", "bug_triage", or empty
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	board, err := s.DB.CreateBoardWithTemplate(req.Name, req.Description, user.ID, req.Template)
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
		Label      string `json:"label"`
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
	swimlane, err := s.DB.CreateSwimlaneWithSourceAndLabel(board.ID, req.Name, req.RepoSource, req.RepoURL, req.RepoOwner, req.RepoName, req.Designator, req.Color, req.Label)
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

func (s *Server) handleReorderBoardSwimlane(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
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
	var req struct {
		Position int `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := s.DB.ReorderSwimlane(swimlaneID, req.Position); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
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

func (s *Server) handleUpdateBoardMember(w http.ResponseWriter, r *http.Request) {
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
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		http.Error(w, "role is required", http.StatusBadRequest)
		return
	}
	if err := s.DB.UpdateBoardMemberRole(board.ID, userID, req.Role); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
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
	if userID == board.OwnerID {
		http.Error(w, "Cannot remove the board owner", http.StatusForbidden)
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
	if cards == nil {
		cards = []models.Card{}
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
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
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
	updated, err := s.DB.UpdateLabel(labelID, req.Name, req.Color)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (s *Server) handleDeleteBoardLabel(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
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
	w.WriteHeader(http.StatusOK)
}

// Workflow handlers

func (s *Server) handleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	board, _ := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	rules, err := s.DB.GetWorkflowRules(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if rules == nil {
		rules = []models.WorkflowRule{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rules)
}

func (s *Server) handleSetWorkflow(w http.ResponseWriter, r *http.Request) {
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
		Rules []struct {
			FromColumnID int64 `json:"from_column_id"`
			ToColumnID   int64 `json:"to_column_id"`
		} `json:"rules"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	var rules []models.WorkflowRule
	for _, r := range req.Rules {
		rules = append(rules, models.WorkflowRule{
			FromColumnID: r.FromColumnID,
			ToColumnID:   r.ToColumnID,
		})
	}
	if err := s.DB.SetWorkflowRules(board.ID, rules); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Return the saved rules
	saved, err := s.DB.GetWorkflowRules(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if saved == nil {
		saved = []models.WorkflowRule{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(saved)
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

// Card template handlers

func (s *Server) handleListCardTemplates(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanView() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	templates, err := s.DB.ListCardTemplates(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if templates == nil {
		templates = []models.CardTemplate{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(templates)
}

func (s *Server) handleCreateCardTemplate(w http.ResponseWriter, r *http.Request) {
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
		Name                string `json:"name"`
		IssueType           string `json:"issue_type"`
		DescriptionTemplate string `json:"description_template"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.DescriptionTemplate == "" {
		http.Error(w, "Description template is required", http.StatusBadRequest)
		return
	}
	tmpl, err := s.DB.CreateCardTemplate(board.ID, req.Name, req.IssueType, req.DescriptionTemplate)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tmpl)
}

func (s *Server) handleDeleteCardTemplate(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	templateID, err := strconv.ParseInt(r.PathValue("templateId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteCardTemplate(templateID); err != nil {
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

// Issue type handlers

var defaultIssueTypes = []models.IssueTypeDefinition{
	{Name: "epic", Icon: "\u26a1", Color: "#7c3aed"},
	{Name: "story", Icon: "\U0001f4d6", Color: "#2563eb"},
	{Name: "task", Icon: "\u2713", Color: "#16a34a"},
	{Name: "bug", Icon: "\U0001f41b", Color: "#dc2626"},
	{Name: "subtask", Icon: "\u21b3", Color: "#6b7280"},
}

func (s *Server) handleListIssueTypes(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanView() {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	types, err := s.DB.ListIssueTypes(board.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if len(types) == 0 {
		types = defaultIssueTypes
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(types)
}

func (s *Server) handleCreateIssueType(w http.ResponseWriter, r *http.Request) {
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
		Icon  string `json:"icon"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.Color == "" {
		req.Color = "#6366f1"
	}
	issueType, err := s.DB.CreateIssueType(board.ID, req.Name, req.Icon, req.Color)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(issueType)
}

func (s *Server) handleUpdateIssueType(w http.ResponseWriter, r *http.Request) {
	board, r := s.loadBoardAndRole(w, r)
	if board == nil {
		return
	}
	boardRole := getBoardRoleFromContext(r.Context())
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	typeID, err := strconv.ParseInt(r.PathValue("typeId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid type ID", http.StatusBadRequest)
		return
	}
	var req struct {
		Name  string `json:"name"`
		Icon  string `json:"icon"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if err := s.DB.UpdateIssueType(typeID, req.Name, req.Icon, req.Color); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	updated, err := s.DB.GetIssueType(typeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (s *Server) handleDeleteIssueType(w http.ResponseWriter, r *http.Request) {
	_, r = s.loadBoardAndRole(w, r)
	boardRole := getBoardRoleFromContext(r.Context())
	if boardRole == "" {
		return
	}
	if !boardRole.CanEditBoard() {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	typeID, err := strconv.ParseInt(r.PathValue("typeId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid type ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteIssueType(typeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// jiraCSVData holds parsed CSV data for reuse across import functions.
type jiraCSVData struct {
	headers       []string
	dataRows      [][]string
	colIdx        map[string]int
	labelIndices  []int
	sprintIndices []int
}

// parseJiraCSV reads a CSV file and returns parsed data with column indices.
func parseJiraCSV(file io.Reader) (*jiraCSVData, error) {
	csvReader := csv.NewReader(file)
	csvReader.LazyQuotes = true
	csvReader.FieldsPerRecord = -1

	allRows, err := csvReader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("failed to parse CSV: %w", err)
	}
	if len(allRows) < 2 {
		return nil, fmt.Errorf("CSV has no data rows")
	}

	data := &jiraCSVData{
		headers:  allRows[0],
		dataRows: allRows[1:],
		colIdx:   map[string]int{},
	}

	for i, h := range data.headers {
		h = strings.TrimSpace(h)
		switch h {
		case "Summary":
			data.colIdx["Summary"] = i
		case "Issue key":
			data.colIdx["Issue key"] = i
		case "Issue Type":
			data.colIdx["Issue Type"] = i
		case "Status":
			data.colIdx["Status"] = i
		case "Project key":
			data.colIdx["Project key"] = i
		case "Priority":
			data.colIdx["Priority"] = i
		case "Description":
			data.colIdx["Description"] = i
		case "Assignee":
			data.colIdx["Assignee"] = i
		case "Due date":
			data.colIdx["Due date"] = i
		case "Status Category":
			data.colIdx["Status Category"] = i
		case "Labels":
			data.labelIndices = append(data.labelIndices, i)
		case "Sprint":
			data.sprintIndices = append(data.sprintIndices, i)
		}
	}

	for _, required := range []string{"Summary", "Issue key"} {
		if _, ok := data.colIdx[required]; !ok {
			return nil, fmt.Errorf("missing required CSV column: %s", required)
		}
	}

	return data, nil
}

func (d *jiraCSVData) getField(row []string, idx int) string {
	if idx >= 0 && idx < len(row) {
		return strings.TrimSpace(row[idx])
	}
	return ""
}

func (d *jiraCSVData) getFieldByName(row []string, name string) string {
	if idx, ok := d.colIdx[name]; ok {
		return d.getField(row, idx)
	}
	return ""
}

// extractProjectKeys returns unique project keys and their row counts from parsed CSV data.
func (d *jiraCSVData) extractProjectKeys() map[string]int {
	projects := map[string]int{}
	for _, row := range d.dataRows {
		pk := d.getFieldByName(row, "Project key")
		if pk != "" {
			projects[pk]++
		}
	}
	return projects
}

// jiraImportResult holds the result of importing cards for a single project.
type jiraImportResult struct {
	Imported       int      `json:"imported"`
	SprintsCreated int      `json:"sprints_created"`
	LabelsCreated  int      `json:"labels_created"`
	Errors         []string `json:"errors"`
}

// Shared Jira status -> state mapping
var jiraStatusToState = map[string]string{
	"to do":                      "open",
	"backlog / not yet assigned": "open",
	"sales requests":             "open",
	"on hold":                    "open",
	"in progress":                "in_progress",
	"blocked":                    "in_progress",
	"review":                     "review",
	"done":                       "closed",
}

// Shared Jira issue type mapping
var jiraTypeMap = map[string]string{
	"epic":     "epic",
	"story":    "story",
	"task":     "task",
	"sub-task": "subtask",
	"bug":      "task",
}

// Hardcoded indices per Jira CSV spec
const storyPointsIdx = 139
const storyPointEstimateIdx = 140
const parentKeyIdx = 193

type importedCard struct {
	cardID   int64
	issueKey string
}

// importJiraCardsForProject imports cards from CSV rows matching a project key into a specific board/swimlane.
// issueKeyToCardID is shared across projects for cross-project parent resolution.
// extraLabels are applied to every imported card (e.g., project key label for Gitea filtering).
func (s *Server) importJiraCardsForProject(
	csvData *jiraCSVData,
	projectKey string,
	boardID int64,
	swimlaneID int64,
	issueKeyToCardID map[string]int64,
	extraLabels []string,
) *jiraImportResult {
	result := &jiraImportResult{}

	columns, err := s.DB.GetBoardColumns(boardID)
	if err != nil || len(columns) == 0 {
		result.Errors = append(result.Errors, "Board has no columns")
		return result
	}

	// Build state->column mapping
	stateColumnMap := map[string]int64{}
	for _, col := range columns {
		if _, exists := stateColumnMap[col.State]; !exists {
			stateColumnMap[col.State] = col.ID
		}
	}
	defaultColumnID := columns[0].ID

	// Get existing cards for duplicate detection and update-on-reimport
	existingCards, err := s.DB.ListCardsForBoard(boardID)
	if err != nil {
		result.Errors = append(result.Errors, "Failed to list existing cards: "+err.Error())
		return result
	}
	existingCardsByTitle := map[string]*models.Card{}
	for i := range existingCards {
		existingCardsByTitle[existingCards[i].Title] = &existingCards[i]
	}

	// Get existing labels
	existingLabels, err := s.DB.GetBoardLabels(boardID)
	if err != nil {
		result.Errors = append(result.Errors, "Failed to get existing labels: "+err.Error())
		return result
	}
	labelMap := map[string]int64{}
	for _, l := range existingLabels {
		labelMap[strings.ToLower(l.Name)] = l.ID
	}

	// Get existing sprints
	existingSprints, err := s.DB.ListSprintsForBoard(boardID)
	if err != nil {
		result.Errors = append(result.Errors, "Failed to get existing sprints: "+err.Error())
		return result
	}
	sprintMap := map[string]int64{}
	for _, sp := range existingSprints {
		sprintMap[sp.Name] = sp.ID
	}

	var importedCards []importedCard

	for rowNum, row := range csvData.dataRows {
		if projectKey != "" {
			pk := csvData.getFieldByName(row, "Project key")
			if pk != projectKey {
				continue
			}
		}

		title := csvData.getFieldByName(row, "Summary")
		if title == "" {
			continue
		}

		issueKey := csvData.getFieldByName(row, "Issue key")
		// Extract issue number from key (e.g., "PROJ-123" -> 123)
		var issueNumber int64
		if idx := strings.LastIndex(issueKey, "-"); idx >= 0 && idx < len(issueKey)-1 {
			if n, err := strconv.ParseInt(issueKey[idx+1:], 10, 64); err == nil {
				issueNumber = n
			}
		}

		// If card already exists, update its issue number and skip creation
		if existingCard, exists := existingCardsByTitle[title]; exists {
			if existingCard.GiteaIssueID == 0 && issueNumber > 0 {
				_, _ = s.DB.Exec(`UPDATE cards SET gitea_issue_id = ? WHERE id = ?`, issueNumber, existingCard.ID)
			}
			if issueKey != "" {
				issueKeyToCardID[issueKey] = existingCard.ID
			}
			continue
		}
		description := csvData.getFieldByName(row, "Description")
		priority := strings.ToLower(csvData.getFieldByName(row, "Priority"))

		jiraType := strings.ToLower(csvData.getFieldByName(row, "Issue Type"))
		issueType := "task"
		if mapped, ok := jiraTypeMap[jiraType]; ok {
			issueType = mapped
		}

		// Use Status Category first (reliable: "To Do", "In Progress", "Done"),
		// then fall back to Status name matching
		statusCategory := strings.ToLower(csvData.getFieldByName(row, "Status Category"))
		jiraStatus := strings.ToLower(csvData.getFieldByName(row, "Status"))
		state := "open"
		switch statusCategory {
		case "done":
			state = "closed"
		case "in progress":
			state = "in_progress"
		default:
			if mapped, ok := jiraStatusToState[jiraStatus]; ok {
				state = mapped
			}
		}

		columnID := defaultColumnID
		if cid, ok := stateColumnMap[state]; ok {
			columnID = cid
		}

		var storyPoints *int
		spStr := csvData.getField(row, storyPointsIdx)
		if spStr == "" {
			spStr = csvData.getField(row, storyPointEstimateIdx)
		}
		if spStr != "" {
			if sp, err := strconv.Atoi(spStr); err == nil {
				storyPoints = &sp
			} else if f, err := strconv.ParseFloat(spStr, 64); err == nil {
				sp := int(f)
				storyPoints = &sp
			}
		}

		var dueDate *time.Time
		dueDateStr := csvData.getFieldByName(row, "Due date")
		if dueDateStr != "" {
			if t, err := time.Parse("02/Jan/06 3:04 PM", dueDateStr); err == nil {
				dueDate = &t
			}
		}

		var sprintID *int64
		for _, si := range csvData.sprintIndices {
			sprintName := csvData.getField(row, si)
			if sprintName == "" {
				continue
			}
			if sid, ok := sprintMap[sprintName]; ok {
				sprintID = &sid
			} else {
				sprintStatus := "planning"
				if state == "closed" {
					sprintStatus = "completed"
				}
				sp, err := s.DB.CreateSprint(boardID, sprintName, "", nil, nil)
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Row %d: failed to create sprint %q: %v", rowNum+2, sprintName, err))
					break
				}
				if sprintStatus == "completed" {
					sp.Status = sprintStatus
					_ = s.DB.UpdateSprint(sp)
				}
				sprintMap[sprintName] = sp.ID
				sprintID = &sp.ID
				result.SprintsCreated++
			}
			break
		}

		card, err := s.DB.CreateCard(database.CreateCardInput{
			BoardID:      boardID,
			SwimlaneID:   swimlaneID,
			ColumnID:     columnID,
			SprintID:     sprintID,
			IssueType:    issueType,
			GiteaIssueID: issueNumber,
			Title:        title,
			Description:  description,
			State:        state,
			StoryPoints:  storyPoints,
			Priority:     priority,
			DueDate:      dueDate,
		})
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("Row %d: failed to create card %q: %v", rowNum+2, title, err))
			continue
		}

		existingCardsByTitle[title] = card
		result.Imported++
		importedCards = append(importedCards, importedCard{cardID: card.ID, issueKey: issueKey})
		if issueKey != "" {
			issueKeyToCardID[issueKey] = card.ID
		}

		// Handle CSV labels
		for _, li := range csvData.labelIndices {
			labelName := csvData.getField(row, li)
			if labelName == "" {
				continue
			}
			labelKey := strings.ToLower(labelName)
			labelID, ok := labelMap[labelKey]
			if !ok {
				label, err := s.DB.CreateLabel(boardID, labelName, "#6366f1")
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Row %d: failed to create label %q: %v", rowNum+2, labelName, err))
					continue
				}
				labelID = label.ID
				labelMap[labelKey] = labelID
				result.LabelsCreated++
			}
			_ = s.DB.AddLabelToCard(card.ID, labelID)
		}

		// Apply extra labels (e.g., project key for Gitea filtering)
		for _, el := range extraLabels {
			if el == "" {
				continue
			}
			labelKey := strings.ToLower(el)
			labelID, ok := labelMap[labelKey]
			if !ok {
				label, err := s.DB.CreateLabel(boardID, el, "#6366f1")
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Row %d: failed to create extra label %q: %v", rowNum+2, el, err))
					continue
				}
				labelID = label.ID
				labelMap[labelKey] = labelID
				result.LabelsCreated++
			}
			_ = s.DB.AddLabelToCard(card.ID, labelID)
		}
	}

	// Resolve parent keys (uses the shared issueKeyToCardID map)
	for _, ic := range importedCards {
		for _, row := range csvData.dataRows {
			ik := csvData.getFieldByName(row, "Issue key")
			if ik != ic.issueKey {
				continue
			}
			parentKey := csvData.getField(row, parentKeyIdx)
			if parentKey == "" {
				break
			}
			if parentCardID, ok := issueKeyToCardID[parentKey]; ok {
				_, err := s.DB.Exec(`UPDATE cards SET parent_id = ? WHERE id = ?`, parentCardID, ic.cardID)
				if err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("Failed to set parent for %s: %v", ic.issueKey, err))
				}
			}
			break
		}
	}

	return result
}

// handleImportJira imports cards from a Jira CSV export into a board (board-scoped).
func (s *Server) handleImportJira(w http.ResponseWriter, r *http.Request) {
	boardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}

	board, err := s.DB.GetBoardByID(boardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file upload", http.StatusBadRequest)
		return
	}
	defer file.Close()

	projectKey := r.FormValue("project_key")

	csvData, err := parseJiraCSV(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get or create swimlane
	swimlanes, err := s.DB.GetBoardSwimlanes(boardID)
	if err != nil {
		http.Error(w, "Failed to get board swimlanes: "+err.Error(), http.StatusInternalServerError)
		return
	}

	defaultSwimlaneID := int64(0)
	if len(swimlanes) == 0 {
		slName := projectKey
		slDesignator := projectKey + "-"
		if slName == "" {
			slName = "Import"
			slDesignator = "IMP-"
		}
		sl, err := s.DB.CreateSwimlane(boardID, slName, "", "", slDesignator, "")
		if err != nil {
			http.Error(w, "Failed to create swimlane: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defaultSwimlaneID = sl.ID
	} else {
		defaultSwimlaneID = swimlanes[0].ID
	}

	issueKeyToCardID := map[string]int64{}
	result := s.importJiraCardsForProject(csvData, projectKey, boardID, defaultSwimlaneID, issueKeyToCardID, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleImportJiraPreview accepts a CSV and returns the project keys found.
func (s *Server) handleImportJiraPreview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file upload", http.StatusBadRequest)
		return
	}
	defer file.Close()

	csvData, err := parseJiraCSV(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	projectCounts := csvData.extractProjectKeys()

	type projectPreview struct {
		Key   string `json:"key"`
		Count int    `json:"count"`
	}
	var projects []projectPreview
	for key, count := range projectCounts {
		projects = append(projects, projectPreview{Key: key, Count: count})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"projects": projects})
}

// handleImportJiraGlobal accepts a CSV + mappings JSON and imports cards per mapping.
func (s *Server) handleImportJiraGlobal(w http.ResponseWriter, r *http.Request) {
	user := getUserFromContext(r.Context())

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file upload", http.StatusBadRequest)
		return
	}
	defer file.Close()

	mappingsJSON := r.FormValue("mappings")
	if mappingsJSON == "" {
		http.Error(w, "Missing mappings", http.StatusBadRequest)
		return
	}

	var mappings []struct {
		ProjectKey      string `json:"project_key"`
		BoardID         int64  `json:"board_id"`
		SwimlaneID      int64  `json:"swimlane_id"`
		CreateBoard     bool   `json:"create_board"`
		NewBoardName    string `json:"new_board_name"`
		BoardTemplate   string `json:"board_template"`
		CreateSwimlane  bool   `json:"create_swimlane"`
		NewSwimlaneName string `json:"new_swimlane_name"`
		RepoOwner       string `json:"repo_owner"`
		RepoName        string `json:"repo_name"`
		Designator      string `json:"designator"`
		Label           string `json:"label"`
		Color           string `json:"color"`
	}
	if err := json.Unmarshal([]byte(mappingsJSON), &mappings); err != nil {
		http.Error(w, "Invalid mappings JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	csvData, err := parseJiraCSV(file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	type projectResult struct {
		Key            string   `json:"key"`
		Imported       int      `json:"imported"`
		SprintsCreated int      `json:"sprints_created"`
		LabelsCreated  int      `json:"labels_created"`
		Errors         []string `json:"errors"`
	}

	var results []projectResult
	totalImported := 0
	issueKeyToCardID := map[string]int64{} // shared across all projects

	for _, m := range mappings {
		pr := projectResult{Key: m.ProjectKey}

		boardID := m.BoardID
		if m.CreateBoard {
			boardName := m.NewBoardName
			if boardName == "" {
				boardName = m.ProjectKey + " Board"
			}
			board, err := s.DB.CreateBoardWithTemplate(boardName, "", user.ID, m.BoardTemplate)
			if err != nil {
				pr.Errors = append(pr.Errors, "Failed to create board: "+err.Error())
				results = append(results, pr)
				continue
			}
			boardID = board.ID
		}

		swimlaneID := m.SwimlaneID
		if m.CreateSwimlane {
			slName := m.NewSwimlaneName
			if slName == "" {
				slName = m.ProjectKey
			}
			designator := m.Designator
			if designator == "" {
				designator = m.ProjectKey + "-"
			}
			color := m.Color
			if color == "" {
				color = "#6366f1"
			}
			sl, err := s.DB.CreateSwimlaneWithSourceAndLabel(boardID, slName, "default_gitea", "", m.RepoOwner, m.RepoName, designator, color, m.Label)
			if err != nil {
				pr.Errors = append(pr.Errors, "Failed to create swimlane: "+err.Error())
				results = append(results, pr)
				continue
			}
			swimlaneID = sl.ID
		}

		if swimlaneID == 0 {
			// Use first swimlane of the board
			swimlanes, err := s.DB.GetBoardSwimlanes(boardID)
			if err != nil || len(swimlanes) == 0 {
				pr.Errors = append(pr.Errors, "Board has no swimlanes and create_swimlane is false")
				results = append(results, pr)
				continue
			}
			swimlaneID = swimlanes[0].ID
		}

		var extraLabels []string
		if m.Label != "" {
			extraLabels = append(extraLabels, m.Label)
		}
		importResult := s.importJiraCardsForProject(csvData, m.ProjectKey, boardID, swimlaneID, issueKeyToCardID, extraLabels)
		pr.Imported = importResult.Imported
		pr.SprintsCreated = importResult.SprintsCreated
		pr.LabelsCreated = importResult.LabelsCreated
		pr.Errors = importResult.Errors
		totalImported += importResult.Imported

		results = append(results, pr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"projects":       results,
		"total_imported": totalImported,
	})
}

// jiraCSVParseHelper is a no-op to prevent unused import errors.
var _ = io.Discard
