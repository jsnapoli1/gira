package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/models"
)

func (s *Server) handleListSprints(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.URL.Query().Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	if !s.checkBoardMembership(w, r, boardID, models.BoardRoleViewer) {
		return
	}

	sprints, err := s.DB.ListSprintsForBoard(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sprints)
}

func (s *Server) handleCreateSprint(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.URL.Query().Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	if !s.checkBoardMembership(w, r, boardID, models.BoardRoleMember) {
		return
	}

	var req struct {
		Name      string `json:"name"`
		Goal      string `json:"goal"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	var startDate, endDate *time.Time
	if req.StartDate != "" {
		if t, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			startDate = &t
		}
	}
	if req.EndDate != "" {
		if t, err := time.Parse("2006-01-02", req.EndDate); err == nil {
			endDate = &t
		}
	}
	sprint, err := s.DB.CreateSprint(boardID, req.Name, req.Goal, startDate, endDate)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sprint)
}

// loadSprint parses the sprint ID from the path value and loads the sprint.
// Returns the sprint or nil if an error was written.
func (s *Server) loadSprint(w http.ResponseWriter, r *http.Request) *models.Sprint {
	sprintID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid sprint ID", http.StatusBadRequest)
		return nil
	}

	sprint, err := s.DB.GetSprintByID(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil
	}
	if sprint == nil {
		http.Error(w, "Sprint not found", http.StatusNotFound)
		return nil
	}
	return sprint
}

func (s *Server) handleGetSprint(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sprint)
}

func (s *Server) handleUpdateSprint(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}

	var req struct {
		Name      string `json:"name"`
		Goal      string `json:"goal"`
		Status    string `json:"status"`
		StartDate string `json:"start_date"`
		EndDate   string `json:"end_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	sprint.Name = req.Name
	sprint.Goal = req.Goal
	if req.Status != "" {
		sprint.Status = req.Status
	}
	// Parse start date
	if req.StartDate != "" {
		if t, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			sprint.StartDate = &t
		}
	} else {
		sprint.StartDate = nil
	}
	// Parse end date
	if req.EndDate != "" {
		if t, err := time.Parse("2006-01-02", req.EndDate); err == nil {
			sprint.EndDate = &t
		}
	} else {
		sprint.EndDate = nil
	}
	if err := s.DB.UpdateSprint(sprint); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sprint)
}

func (s *Server) handleDeleteSprint(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	if err := s.DB.DeleteSprint(sprint.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStartSprint(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	if err := s.DB.StartSprint(sprint.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleCompleteSprint(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	if err := s.DB.CompleteSprint(sprint.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleGetSprintCards(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	cards, err := s.DB.ListCardsForSprint(sprint.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cards)
}

func (s *Server) handleGetSprintMetrics(w http.ResponseWriter, r *http.Request) {
	sprint := s.loadSprint(w, r)
	if sprint == nil {
		return
	}
	metrics, err := s.DB.GetSprintMetrics(sprint.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// Metrics handlers

func (s *Server) handleBurndown(w http.ResponseWriter, r *http.Request) {
	sprintIDStr := r.URL.Query().Get("sprint_id")
	if sprintIDStr == "" {
		http.Error(w, "sprint_id required", http.StatusBadRequest)
		return
	}
	sprintID, err := strconv.ParseInt(sprintIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid sprint_id", http.StatusBadRequest)
		return
	}

	// Look up sprint to get board_id, then check board membership
	sprint, err := s.DB.GetSprintByID(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sprint == nil {
		http.Error(w, "Sprint not found", http.StatusNotFound)
		return
	}
	if !s.checkBoardMembership(w, r, sprint.BoardID, models.BoardRoleViewer) {
		return
	}

	metrics, err := s.DB.GetSprintMetrics(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If no historical data, calculate current
	if len(metrics) == 0 {
		current, err := s.DB.CalculateCurrentSprintMetrics(sprintID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		metrics = []models.SprintMetrics{*current}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

func (s *Server) handleBoardTimeSummary(w http.ResponseWriter, r *http.Request) {
	boardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}

	if !s.checkBoardMembership(w, r, boardID, models.BoardRoleViewer) {
		return
	}

	var sprintID *int64
	if sid := r.URL.Query().Get("sprint_id"); sid != "" {
		id, err := strconv.ParseInt(sid, 10, 64)
		if err != nil {
			http.Error(w, "Invalid sprint_id", http.StatusBadRequest)
			return
		}
		sprintID = &id
	}

	entries, totalLogged, totalEstimated, err := s.DB.GetBoardTimeSummary(boardID, sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if entries == nil {
		entries = []database.TimeSummaryEntry{}
	}

	resp := struct {
		ByUser         []database.TimeSummaryEntry `json:"by_user"`
		TotalLogged    int                         `json:"total_logged"`
		TotalEstimated int                         `json:"total_estimated"`
	}{
		ByUser:         entries,
		TotalLogged:    totalLogged,
		TotalEstimated: totalEstimated,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleVelocity(w http.ResponseWriter, r *http.Request) {
	boardIDStr := r.URL.Query().Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	// Check board membership: viewers can see velocity data
	if !s.checkBoardMembership(w, r, boardID, models.BoardRoleViewer) {
		return
	}

	sprints, err := s.DB.ListSprintsForBoard(boardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type VelocityPoint struct {
		SprintName      string `json:"sprint_name"`
		CompletedPoints int    `json:"completed_points"`
		TotalPoints     int    `json:"total_points"`
	}

	var velocity []VelocityPoint
	for _, sprint := range sprints {
		if sprint.Status == "completed" {
			metrics, err := s.DB.CalculateCurrentSprintMetrics(sprint.ID)
			if err != nil {
				continue
			}
			velocity = append(velocity, VelocityPoint{
				SprintName:      sprint.Name,
				CompletedPoints: metrics.CompletedPoints,
				TotalPoints:     metrics.TotalPoints,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(velocity)
}
