package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

func (s *Server) handleSprints(w http.ResponseWriter, r *http.Request) {
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

	// Check board membership: viewers can list sprints, members can create
	minRole := models.BoardRoleViewer
	if r.Method == "POST" {
		minRole = models.BoardRoleMember
	}
	if !s.checkBoardMembership(w, r, boardID, minRole) {
		return
	}

	switch r.Method {
	case "GET":
		sprints, err := s.DB.ListSprintsForBoard(boardID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sprints)

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSprint(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/sprints/")
	parts := strings.Split(path, "/")
	sprintID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid sprint ID", http.StatusBadRequest)
		return
	}

	sprint, err := s.DB.GetSprintByID(sprintID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sprint == nil {
		http.Error(w, "Sprint not found", http.StatusNotFound)
		return
	}

	// Handle sub-routes
	if len(parts) > 1 {
		switch parts[1] {
		case "start":
			if r.Method == "POST" {
				if err := s.DB.StartSprint(sprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "complete":
			if r.Method == "POST" {
				if err := s.DB.CompleteSprint(sprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "cards":
			if r.Method == "GET" {
				cards, err := s.DB.ListCardsForSprint(sprintID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(cards)
				return
			}
		case "metrics":
			if r.Method == "GET" {
				metrics, err := s.DB.GetSprintMetrics(sprintID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(metrics)
				return
			}
		}
	}

	switch r.Method {
	case "GET":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sprint)

	case "PUT":
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

	case "DELETE":
		if err := s.DB.DeleteSprint(sprintID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
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
