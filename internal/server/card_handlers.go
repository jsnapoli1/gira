package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/models"
)

func (s *Server) handleSearchCards(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	boardIDStr := q.Get("board_id")
	if boardIDStr == "" {
		http.Error(w, "board_id is required", http.StatusBadRequest)
		return
	}
	boardID, err := strconv.ParseInt(boardIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid board_id", http.StatusBadRequest)
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, boardID, models.BoardRoleViewer) {
		return
	}

	params := database.CardSearchParams{
		BoardID: boardID,
		Query:   q.Get("q"),
	}

	if v := q.Get("assignee"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			params.Assignee = &id
		}
	}

	if v := q.Get("label"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if id, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
				params.LabelIDs = append(params.LabelIDs, id)
			}
		}
	}

	params.Priority = q.Get("priority")
	params.State = q.Get("state")
	params.IssueType = q.Get("issue_type")

	if v := q.Get("sprint_id"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			params.SprintID = &id
		}
	}

	if q.Get("overdue") == "true" {
		params.Overdue = true
	}

	if v := q.Get("due_before"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			params.DueBefore = &t
		}
	}

	if v := q.Get("due_after"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			params.DueAfter = &t
		}
	}

	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params.Limit = n
		}
	}
	if params.Limit > 500 {
		params.Limit = 500
	}

	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params.Offset = n
		}
	}

	cards, total, err := s.DB.SearchCards(params)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if cards == nil {
		cards = []models.Card{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cards": cards,
		"total": total,
	})
}

// loadCard parses the card ID from the path value and loads the card.
// Returns the card or nil if an error was written.
func (s *Server) loadCard(w http.ResponseWriter, r *http.Request) *models.Card {
	cardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid card ID", http.StatusBadRequest)
		return nil
	}

	card, err := s.DB.GetCardByID(cardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil
	}
	if card == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return nil
	}
	return card
}

func (s *Server) handleCreateCard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BoardID     int64  `json:"board_id"`
		SwimlaneID  int64  `json:"swimlane_id"`
		ColumnID    int64  `json:"column_id"`
		SprintID    *int64 `json:"sprint_id"`
		ParentID    *int64 `json:"parent_id"`
		IssueType   string `json:"issue_type"`
		Title       string `json:"title"`
		Description string `json:"description"`
		StoryPoints *int   `json:"story_points"`
		Priority    string `json:"priority"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Check board membership: members can create cards
	if !s.checkBoardMembership(w, r, req.BoardID, models.BoardRoleMember) {
		return
	}

	// Get swimlane to find repo info
	swimlanes, err := s.DB.GetBoardSwimlanes(req.BoardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var swimlane *models.Swimlane
	for _, sl := range swimlanes {
		if sl.ID == req.SwimlaneID {
			swimlane = &sl
			break
		}
	}
	if swimlane == nil {
		http.Error(w, "Swimlane not found", http.StatusBadRequest)
		return
	}

	// Create issue in the appropriate provider
	var giteaIssueID int64 = 0
	user := getUserFromContext(r.Context())

	switch swimlane.RepoSource {
	case "github":
		client, err := s.getGitHubClientForSwimlane(swimlane, user.ID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get GitHub client: %v", err), http.StatusInternalServerError)
			return
		}
		issue, err := client.CreateIssue(swimlane.RepoOwner, swimlane.RepoName, req.Title, req.Description)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to create GitHub issue: %v", err), http.StatusInternalServerError)
			return
		}
		giteaIssueID = issue.Number

	case "default_gitea", "custom_gitea", "":
		client, err := s.getGiteaClientForSwimlane(swimlane, user.ID)
		if err != nil {
			// If no client available, generate local ID
			cards, _ := s.DB.ListCardsForBoard(req.BoardID)
			giteaIssueID = int64(len(cards) + 1)
		} else if client != nil {
			giteaIssue, err := client.CreateIssue(swimlane.RepoOwner, swimlane.RepoName, req.Title, req.Description)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to create Gitea issue: %v", err), http.StatusInternalServerError)
				return
			}
			giteaIssueID = giteaIssue.Number
		} else {
			// Generate a local issue ID based on existing cards count
			cards, _ := s.DB.ListCardsForBoard(req.BoardID)
			giteaIssueID = int64(len(cards) + 1)
		}

	default:
		// Generate a local issue ID
		cards, _ := s.DB.ListCardsForBoard(req.BoardID)
		giteaIssueID = int64(len(cards) + 1)
	}

	// Get column to determine initial state
	columns, err := s.DB.GetBoardColumns(req.BoardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	state := "open"
	for _, col := range columns {
		if col.ID == req.ColumnID {
			state = col.State
			break
		}
	}

	// Create card in database
	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}

	issueType := req.IssueType
	if issueType == "" {
		issueType = "task"
	}

	card, err := s.DB.CreateCard(database.CreateCardInput{
		BoardID:      req.BoardID,
		SwimlaneID:   req.SwimlaneID,
		ColumnID:     req.ColumnID,
		SprintID:     req.SprintID,
		ParentID:     req.ParentID,
		IssueType:    issueType,
		GiteaIssueID: giteaIssueID,
		Title:        req.Title,
		Description:  req.Description,
		State:        state,
		StoryPoints:  req.StoryPoints,
		Priority:     priority,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity (never fail the parent operation)
	if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "created", "card", "", "", card.Title); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	// Broadcast card_created event
	s.SSEHub.Broadcast(BoardEvent{
		Type:      "card_created",
		BoardID:   card.BoardID,
		Payload:   card,
		Timestamp: time.Now(),
		UserID:    user.ID,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(card)
}

func (s *Server) handleGetCard(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(card)
}

func (s *Server) handleUpdateCard(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	var req struct {
		Title        string  `json:"title"`
		Description  string  `json:"description"`
		StoryPoints  *int    `json:"story_points"`
		Priority     string  `json:"priority"`
		DueDate      *string `json:"due_date"`
		TimeEstimate *int    `json:"time_estimate"`
		ParentID     *int64  `json:"parent_id"`
		IssueType    string  `json:"issue_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Capture old values for activity logging
	oldTitle := card.Title
	oldDescription := card.Description
	oldPriority := card.Priority
	oldIssueType := card.IssueType
	oldStoryPoints := ""
	if card.StoryPoints != nil {
		oldStoryPoints = strconv.Itoa(*card.StoryPoints)
	}
	oldDueDate := ""
	if card.DueDate != nil {
		oldDueDate = card.DueDate.Format("2006-01-02")
	}

	// Validate parent_id to prevent circular references
	if req.ParentID != nil {
		if *req.ParentID == card.ID {
			http.Error(w, "A card cannot be its own parent", http.StatusBadRequest)
			return
		}
		// Walk up the parent chain to detect cycles
		visited := map[int64]bool{card.ID: true}
		currentID := *req.ParentID
		for {
			if visited[currentID] {
				http.Error(w, "Circular parent reference detected", http.StatusBadRequest)
				return
			}
			visited[currentID] = true
			parent, err := s.DB.GetCardByID(currentID)
			if err != nil || parent == nil {
				break
			}
			if parent.ParentID == nil {
				break
			}
			currentID = *parent.ParentID
		}
	}

	card.Title = req.Title
	card.Description = req.Description
	card.StoryPoints = req.StoryPoints
	card.Priority = req.Priority
	card.TimeEstimate = req.TimeEstimate
	card.ParentID = req.ParentID
	if req.IssueType != "" {
		card.IssueType = req.IssueType
	}
	// Parse due date
	if req.DueDate != nil && *req.DueDate != "" {
		parsedDate, err := time.Parse("2006-01-02", *req.DueDate)
		if err == nil {
			card.DueDate = &parsedDate
		}
	} else {
		card.DueDate = nil
	}
	if err := s.DB.UpdateCard(card); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log field changes (never fail the parent operation)
	user := getUserFromContext(r.Context())
	if oldTitle != req.Title {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "title", oldTitle, req.Title); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}
	if oldDescription != req.Description {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "description", oldDescription, req.Description); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}
	if oldPriority != req.Priority {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "priority", oldPriority, req.Priority); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}
	newStoryPoints := ""
	if req.StoryPoints != nil {
		newStoryPoints = strconv.Itoa(*req.StoryPoints)
	}
	if oldStoryPoints != newStoryPoints {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "story_points", oldStoryPoints, newStoryPoints); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}
	newDueDate := ""
	if req.DueDate != nil && *req.DueDate != "" {
		newDueDate = *req.DueDate
	}
	if oldDueDate != newDueDate {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "due_date", oldDueDate, newDueDate); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}
	if req.IssueType != "" && oldIssueType != req.IssueType {
		if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "issue_type", oldIssueType, req.IssueType); err != nil {
			log.Printf("Failed to log activity: %v", err)
		}
	}

	// Update issue in the appropriate provider
	swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
	for _, sl := range swimlanes {
		if sl.ID == card.SwimlaneID {
			switch sl.RepoSource {
			case "github":
				if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
					client.UpdateIssue(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.Title, req.Description)
				}
			default:
				if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
					client.UpdateIssue(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.Title, req.Description)
				}
			}
			break
		}
	}

	// Broadcast card_updated event
	s.SSEHub.Broadcast(BoardEvent{
		Type:      "card_updated",
		BoardID:   card.BoardID,
		Payload:   card,
		Timestamp: time.Now(),
		UserID:    user.ID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(card)
}

func (s *Server) handleDeleteCard(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	user := getUserFromContext(r.Context())
	boardID := card.BoardID

	// Log activity before deletion
	cardID := card.ID
	if err := s.DB.LogActivity(card.BoardID, &cardID, user.ID, "deleted", "card", "", card.Title, ""); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	if err := s.DB.DeleteCard(card.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast card_deleted event
	s.SSEHub.Broadcast(BoardEvent{
		Type:      "card_deleted",
		BoardID:   boardID,
		Payload:   map[string]interface{}{"card_id": card.ID},
		Timestamp: time.Now(),
		UserID:    user.ID,
	})

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMoveCard(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	var req struct {
		ColumnID int64    `json:"column_id"`
		State    string   `json:"state"`
		Position *float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	oldState := card.State
	position := float64(0)
	if req.Position != nil {
		position = *req.Position
	} else {
		maxPos, _ := s.DB.GetMaxPosition(card.BoardID, req.ColumnID)
		position = maxPos + 1000
	}
	if err := s.DB.MoveCard(card.ID, req.ColumnID, req.State, position); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Also update issue state in the appropriate provider
	user := getUserFromContext(r.Context())

	// Log activity
	if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "moved", "card", "state", oldState, req.State); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}
	swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
	for _, sl := range swimlanes {
		if sl.ID == card.SwimlaneID {
			switch sl.RepoSource {
			case "github":
				if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
					client.UpdateIssueState(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.State)
				}
			default:
				if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
					client.UpdateIssueState(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, req.State)
				}
			}
			break
		}
	}

	// Broadcast card_moved event
	s.SSEHub.Broadcast(BoardEvent{
		Type:      "card_moved",
		BoardID:   card.BoardID,
		Payload:   map[string]interface{}{"card_id": card.ID, "column_id": req.ColumnID, "state": req.State, "position": position},
		Timestamp: time.Now(),
		UserID:    user.ID,
	})

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleReorderCard(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, card.BoardID, models.BoardRoleMember) {
		return
	}

	var req struct {
		Position float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Position <= 0 || req.Position >= 1e10 {
		http.Error(w, "Position must be > 0 and < 10000000000", http.StatusBadRequest)
		return
	}
	if err := s.DB.ReorderCard(card.ID, req.Position); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user := getUserFromContext(r.Context())
	s.SSEHub.Broadcast(BoardEvent{
		Type:      "card_reordered",
		BoardID:   card.BoardID,
		Payload:   map[string]interface{}{"card_id": card.ID, "position": req.Position},
		Timestamp: time.Now(),
		UserID:    user.ID,
	})

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleAssignCardSprint(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	var req struct {
		SprintID *int64 `json:"sprint_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := s.DB.AssignCardToSprint(card.ID, req.SprintID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	user := getUserFromContext(r.Context())
	oldSprint := ""
	if card.SprintID != nil {
		oldSprint = strconv.FormatInt(*card.SprintID, 10)
	}
	newSprint := ""
	if req.SprintID != nil {
		newSprint = strconv.FormatInt(*req.SprintID, 10)
	}
	if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "updated", "card", "sprint_id", oldSprint, newSprint); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleGetCardChildren(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	children, err := s.DB.ListChildCards(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(children)
}

// Card assignees handlers

func (s *Server) handleGetCardAssignees(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	assignees, err := s.DB.GetCardAssignees(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(assignees)
}

func (s *Server) handleAddCardAssignee(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	var req struct {
		UserID int64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := s.DB.AddCardAssignee(card.ID, req.UserID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	currentUser := getUserFromContext(r.Context())
	if err := s.DB.LogActivity(card.BoardID, &card.ID, currentUser.ID, "assigned", "card", "assignee", "", strconv.FormatInt(req.UserID, 10)); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	// Create notification for the assigned user (if not self-assigning)
	if req.UserID != currentUser.ID {
		link := fmt.Sprintf("/boards/%d?card=%d", card.BoardID, card.ID)
		s.createNotification(req.UserID, "assignment", "You've been assigned", fmt.Sprintf("%s assigned you to: %s", currentUser.DisplayName, card.Title), link)
	}

	w.WriteHeader(http.StatusCreated)
}

func (s *Server) handleRemoveCardAssignee(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	userID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.RemoveCardAssignee(card.ID, userID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	currentUser := getUserFromContext(r.Context())
	if err := s.DB.LogActivity(card.BoardID, &card.ID, currentUser.ID, "unassigned", "card", "assignee", strconv.FormatInt(userID, 10), ""); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	w.WriteHeader(http.StatusNoContent)
}

// Card comments handlers

func (s *Server) handleGetCardComments(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	comments, err := s.DB.GetCommentsForCard(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(comments)
}

func (s *Server) handleCreateCardComment(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Body          string  `json:"body"`
		AttachmentIDs []int64 `json:"attachment_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.Body == "" && len(req.AttachmentIDs) == 0 {
		http.Error(w, "Comment body or attachments required", http.StatusBadRequest)
		return
	}

	comment, err := s.DB.CreateComment(card.ID, user.ID, req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Sync comment to Gitea/GitHub if card has a linked issue
	if card.GiteaIssueID > 0 && req.Body != "" {
		swimlanes, _ := s.DB.GetBoardSwimlanes(card.BoardID)
		for _, sl := range swimlanes {
			if sl.ID == card.SwimlaneID {
				// Format comment with user attribution
				giteaBody := fmt.Sprintf("**%s** commented:\n\n%s", user.DisplayName, req.Body)
				switch sl.RepoSource {
				case "github":
					if client, err := s.getGitHubClientForSwimlane(&sl, user.ID); err == nil {
						client.CreateIssueComment(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, giteaBody)
					}
				default:
					if client, err := s.getGiteaClientForSwimlane(&sl, user.ID); err == nil && client != nil {
						client.CreateIssueComment(sl.RepoOwner, sl.RepoName, card.GiteaIssueID, giteaBody)
					}
				}
				break
			}
		}
	}

	// Link attachments to the comment
	if len(req.AttachmentIDs) > 0 {
		if err := s.DB.LinkAttachmentsToComment(comment.ID, req.AttachmentIDs); err != nil {
			log.Printf("Failed to link attachments to comment: %v", err)
		}
		// Reload comment to get attachments
		comment.Attachments, _ = s.DB.GetAttachmentsForComment(comment.ID)
	}

	// Log activity
	if err := s.DB.LogActivity(card.BoardID, &card.ID, user.ID, "commented", "comment", "", "", ""); err != nil {
		log.Printf("Failed to log activity: %v", err)
	}

	// Parse @mentions from comment body and notify mentioned users
	link := fmt.Sprintf("/boards/%d?card=%d", card.BoardID, card.ID)
	mentionedUserIDs := s.parseMentions(req.Body)
	notifiedUsers := make(map[int64]bool)

	for _, mentionedID := range mentionedUserIDs {
		if mentionedID != user.ID {
			s.createNotification(mentionedID, "mention", "You were mentioned", fmt.Sprintf("%s mentioned you in: %s", user.DisplayName, card.Title), link)
			notifiedUsers[mentionedID] = true
		}
	}

	// Notify card assignees about the new comment (except the commenter and already notified users)
	assignees, _ := s.DB.GetCardAssignees(card.ID)
	for _, assignee := range assignees {
		if assignee.ID != user.ID && !notifiedUsers[assignee.ID] {
			s.createNotification(assignee.ID, "comment", "New comment", fmt.Sprintf("%s commented on: %s", user.DisplayName, card.Title), link)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(comment)
}

// Card labels handlers

func (s *Server) handleGetCardLabels(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	labels, err := s.DB.GetCardLabels(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(labels)
}

func (s *Server) handleAddCardLabel(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	var req struct {
		LabelID int64 `json:"label_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := s.DB.AddLabelToCard(card.ID, req.LabelID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) handleRemoveCardLabel(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	labelID, err := strconv.ParseInt(r.PathValue("labelId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid label ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.RemoveLabelFromCard(card.ID, labelID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Card attachments handlers

func (s *Server) handleGetCardAttachments(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	attachments, err := s.DB.GetAttachmentsForCard(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(attachments)
}

func (s *Server) handleUploadCardAttachment(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse multipart form (max 10MB)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "File too large or invalid form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Create attachments directory
	attachDir := getAttachmentsDir()
	if err := os.MkdirAll(attachDir, 0755); err != nil {
		http.Error(w, "Failed to create storage directory", http.StatusInternalServerError)
		return
	}

	// Generate unique filename (stored in DB, not full path)
	ext := filepath.Ext(header.Filename)
	uniqueName := fmt.Sprintf("%d_%d_%d%s", card.ID, user.ID, time.Now().UnixNano(), ext)
	fullPath := filepath.Join(attachDir, uniqueName)

	// Save file
	dst, err := os.Create(fullPath)
	if err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		os.Remove(fullPath)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Detect MIME type
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Create database record - store only the unique filename, not full path
	attachment, err := s.DB.CreateAttachment(card.ID, user.ID, header.Filename, header.Size, mimeType, uniqueName)
	if err != nil {
		os.Remove(fullPath)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(attachment)
}

func (s *Server) handleDeleteCardAttachment(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	attachmentID, err := strconv.ParseInt(r.PathValue("attachmentId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid attachment ID", http.StatusBadRequest)
		return
	}

	attachment, err := s.DB.GetAttachmentByID(attachmentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if attachment == nil || attachment.CardID != card.ID {
		http.Error(w, "Attachment not found", http.StatusNotFound)
		return
	}

	// Delete record from database first to avoid orphaned rows
	if err := s.DB.DeleteAttachment(attachmentID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Remove file from disk; if this fails, log it but don't error
	// (an orphaned file on disk is less harmful than an orphaned DB row)
	filePath := attachment.StorePath
	if !filepath.IsAbs(filePath) {
		filePath = filepath.Join(getAttachmentsDir(), filePath)
	}
	if err := os.Remove(filePath); err != nil {
		log.Printf("warning: failed to remove attachment file %s: %v", filePath, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// Attachment download handler

func (s *Server) handleAttachmentDownload(w http.ResponseWriter, r *http.Request) {
	attachmentID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid attachment ID", http.StatusBadRequest)
		return
	}

	attachment, err := s.DB.GetAttachmentByID(attachmentID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if attachment == nil {
		http.Error(w, "Attachment not found", http.StatusNotFound)
		return
	}

	// Resolve the full path - StorePath may be just a filename (new) or full path (legacy)
	filePath := attachment.StorePath
	if !filepath.IsAbs(filePath) {
		filePath = filepath.Join(getAttachmentsDir(), filePath)
	}

	// Read file and serve with proper headers
	data, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "Failed to read attachment", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", attachment.MimeType)
	// Use inline for images so they display in browser, attachment for other files
	disposition := "attachment"
	if strings.HasPrefix(attachment.MimeType, "image/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, attachment.Filename))
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(data)), 10))
	w.Write(data)
}

func getAttachmentsDir() string {
	// Check for DATA_DIR environment variable first (for Docker)
	if dataDir := os.Getenv("DATA_DIR"); dataDir != "" {
		return filepath.Join(dataDir, "attachments")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "zira", "attachments")
}

// Card custom fields handlers

func (s *Server) handleGetCardCustomFields(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	values, err := s.DB.GetCustomFieldValuesForCard(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if values == nil {
		values = []models.CustomFieldValue{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(values)
}

func (s *Server) handleGetCardCustomField(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid field ID", http.StatusBadRequest)
		return
	}
	value, err := s.DB.GetCustomFieldValue(card.ID, fieldID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if value == nil {
		value = &models.CustomFieldValue{CardID: card.ID, FieldID: fieldID}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func (s *Server) handleSetCardCustomField(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid field ID", http.StatusBadRequest)
		return
	}
	var req struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if err := s.DB.SetCustomFieldValue(card.ID, fieldID, req.Value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	value, _ := s.DB.GetCustomFieldValue(card.ID, fieldID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func (s *Server) handleDeleteCardCustomField(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	fieldID, err := strconv.ParseInt(r.PathValue("fieldId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid field ID", http.StatusBadRequest)
		return
	}
	if err := s.DB.DeleteCustomFieldValue(card.ID, fieldID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Card work logs handlers

func (s *Server) handleGetCardWorkLogs(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}
	workLogs, err := s.DB.GetWorkItems(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Get total time logged
	totalTime, err := s.DB.GetTotalTimeLogged(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Return both work logs and summary
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"work_logs":     workLogs,
		"total_logged":  totalTime,
		"time_estimate": card.TimeEstimate,
	})
}

func (s *Server) handleCreateCardWorkLog(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		TimeSpent int    `json:"time_spent"` // in minutes
		Date      string `json:"date"`       // YYYY-MM-DD
		Notes     string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if req.TimeSpent <= 0 {
		http.Error(w, "Time spent must be greater than 0", http.StatusBadRequest)
		return
	}

	// Parse date
	var logDate time.Time
	if req.Date != "" {
		parsedDate, err := time.Parse("2006-01-02", req.Date)
		if err != nil {
			http.Error(w, "Invalid date format (use YYYY-MM-DD)", http.StatusBadRequest)
			return
		}
		logDate = parsedDate
	} else {
		logDate = time.Now()
	}

	if err := s.DB.LogWork(card.ID, user.ID, req.TimeSpent, logDate, req.Notes); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return updated work logs list
	workLogs, _ := s.DB.GetWorkItems(card.ID)
	totalTime, _ := s.DB.GetTotalTimeLogged(card.ID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"work_logs":     workLogs,
		"total_logged":  totalTime,
		"time_estimate": card.TimeEstimate,
	})
}

func (s *Server) handleDeleteCardWorkLog(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	worklogID, err := strconv.ParseInt(r.PathValue("worklogId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid work log ID", http.StatusBadRequest)
		return
	}

	worklog, err := s.DB.GetWorkLogByID(worklogID)
	if err != nil {
		http.Error(w, "Work log not found", http.StatusNotFound)
		return
	}
	if worklog.CardID != card.ID {
		http.Error(w, "Work log not found", http.StatusNotFound)
		return
	}

	if err := s.DB.DeleteWorkLog(worklogID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Helper function to create notifications
func (s *Server) createNotification(userID int64, notificationType, title, message, link string) {
	s.DB.CreateNotification(userID, notificationType, title, message, link)
}

// Card activity handler

func (s *Server) handleGetCardActivity(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, card.BoardID, models.BoardRoleViewer) {
		return
	}

	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 500 {
		limit = 500
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	activities, err := s.DB.GetCardActivity(card.ID, limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if activities == nil {
		activities = []models.ActivityLog{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(activities)
}

// Card links handlers

func (s *Server) handleGetCardLinks(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, card.BoardID, models.BoardRoleViewer) {
		return
	}

	links, err := s.DB.GetCardLinks(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(links)
}

func (s *Server) handleCreateCardLink(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, card.BoardID, models.BoardRoleMember) {
		return
	}

	user := getUserFromContext(r.Context())
	if user == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		TargetCardID int64  `json:"target_card_id"`
		LinkType     string `json:"link_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Validate link type
	validTypes := map[string]bool{
		"blocks":        true,
		"is_blocked_by": true,
		"relates_to":    true,
		"duplicates":    true,
	}
	if !validTypes[req.LinkType] {
		http.Error(w, "Invalid link type", http.StatusBadRequest)
		return
	}

	if req.TargetCardID == card.ID {
		http.Error(w, "Cannot link a card to itself", http.StatusBadRequest)
		return
	}

	// Verify target card exists
	targetCard, err := s.DB.GetCardByID(req.TargetCardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if targetCard == nil {
		http.Error(w, "Target card not found", http.StatusNotFound)
		return
	}

	// Verify target card belongs to the same board
	if targetCard.BoardID != card.BoardID {
		http.Error(w, "Target card must belong to the same board", http.StatusBadRequest)
		return
	}

	link, err := s.DB.CreateCardLink(card.ID, req.TargetCardID, req.LinkType, user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(link)
}

func (s *Server) handleDeleteCardLink(w http.ResponseWriter, r *http.Request) {
	card := s.loadCard(w, r)
	if card == nil {
		return
	}

	// Check board membership
	if !s.checkBoardMembership(w, r, card.BoardID, models.BoardRoleMember) {
		return
	}

	linkID, err := strconv.ParseInt(r.PathValue("linkId"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid link ID", http.StatusBadRequest)
		return
	}

	// Verify the link belongs to this card (as source or target)
	links, err := s.DB.GetCardLinks(card.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	linkFound := false
	for _, l := range links {
		if l.ID == linkID {
			linkFound = true
			break
		}
	}
	if !linkFound {
		http.Error(w, "Link not found for this card", http.StatusNotFound)
		return
	}

	if err := s.DB.DeleteCardLink(linkID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Bulk card operations

func (s *Server) handleBulkMoveCards(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CardIDs  []int64 `json:"card_ids"`
		ColumnID int64   `json:"column_id"`
		State    string  `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) == 0 {
		http.Error(w, "card_ids must not be empty", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) > 100 {
		http.Error(w, "max 100 cards per bulk operation", http.StatusBadRequest)
		return
	}

	// Load first card to get board ID and check membership
	firstCard, err := s.DB.GetCardByID(req.CardIDs[0])
	if err != nil || firstCard == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}
	if !s.checkBoardMembership(w, r, firstCard.BoardID, models.BoardRoleMember) {
		return
	}

	// Verify all cards belong to the same board
	for _, cardID := range req.CardIDs[1:] {
		c, err := s.DB.GetCardByID(cardID)
		if err != nil || c == nil {
			http.Error(w, fmt.Sprintf("Card %d not found", cardID), http.StatusNotFound)
			return
		}
		if c.BoardID != firstCard.BoardID {
			http.Error(w, "All cards must belong to the same board", http.StatusBadRequest)
			return
		}
	}

	if err := s.DB.BulkMoveCards(req.CardIDs, req.ColumnID, req.State); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user := getUserFromContext(r.Context())
	for _, cardID := range req.CardIDs {
		if err := s.DB.LogActivity(firstCard.BoardID, &cardID, user.ID, "moved", "card", "state", "", req.State); err != nil {
			log.Printf("Failed to log bulk move activity: %v", err)
		}
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_moved",
			BoardID:   firstCard.BoardID,
			Payload:   map[string]interface{}{"card_id": cardID, "column_id": req.ColumnID, "state": req.State},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"updated": len(req.CardIDs)})
}

func (s *Server) handleBulkAssignSprint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CardIDs  []int64 `json:"card_ids"`
		SprintID *int64  `json:"sprint_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) == 0 {
		http.Error(w, "card_ids must not be empty", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) > 100 {
		http.Error(w, "max 100 cards per bulk operation", http.StatusBadRequest)
		return
	}

	// Load first card to get board ID and check membership
	firstCard, err := s.DB.GetCardByID(req.CardIDs[0])
	if err != nil || firstCard == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}
	if !s.checkBoardMembership(w, r, firstCard.BoardID, models.BoardRoleMember) {
		return
	}

	// Verify all cards belong to the same board
	for _, cardID := range req.CardIDs[1:] {
		c, err := s.DB.GetCardByID(cardID)
		if err != nil || c == nil {
			http.Error(w, fmt.Sprintf("Card %d not found", cardID), http.StatusNotFound)
			return
		}
		if c.BoardID != firstCard.BoardID {
			http.Error(w, "All cards must belong to the same board", http.StatusBadRequest)
			return
		}
	}

	if err := s.DB.BulkAssignSprint(req.CardIDs, req.SprintID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	user := getUserFromContext(r.Context())
	newSprint := ""
	if req.SprintID != nil {
		newSprint = strconv.FormatInt(*req.SprintID, 10)
	}
	for _, cardID := range req.CardIDs {
		if err := s.DB.LogActivity(firstCard.BoardID, &cardID, user.ID, "updated", "card", "sprint_id", "", newSprint); err != nil {
			log.Printf("Failed to log bulk sprint assign activity: %v", err)
		}
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_updated",
			BoardID:   firstCard.BoardID,
			Payload:   map[string]interface{}{"card_id": cardID, "sprint_id": req.SprintID},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"updated": len(req.CardIDs)})
}

func (s *Server) handleBulkUpdateCards(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CardIDs       []int64 `json:"card_ids"`
		Priority      string  `json:"priority"`
		AddLabelID    *int64  `json:"add_label_id"`
		RemoveLabelID *int64  `json:"remove_label_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) == 0 {
		http.Error(w, "card_ids must not be empty", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) > 100 {
		http.Error(w, "max 100 cards per bulk operation", http.StatusBadRequest)
		return
	}

	// Load first card to get board ID and check membership
	firstCard, err := s.DB.GetCardByID(req.CardIDs[0])
	if err != nil || firstCard == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}
	if !s.checkBoardMembership(w, r, firstCard.BoardID, models.BoardRoleMember) {
		return
	}

	// Verify all cards belong to the same board
	for _, cardID := range req.CardIDs[1:] {
		c, err := s.DB.GetCardByID(cardID)
		if err != nil || c == nil {
			http.Error(w, fmt.Sprintf("Card %d not found", cardID), http.StatusNotFound)
			return
		}
		if c.BoardID != firstCard.BoardID {
			http.Error(w, "All cards must belong to the same board", http.StatusBadRequest)
			return
		}
	}

	user := getUserFromContext(r.Context())

	if req.Priority != "" {
		if err := s.DB.BulkUpdatePriority(req.CardIDs, req.Priority); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, cardID := range req.CardIDs {
			if err := s.DB.LogActivity(firstCard.BoardID, &cardID, user.ID, "updated", "card", "priority", "", req.Priority); err != nil {
				log.Printf("Failed to log bulk update activity: %v", err)
			}
		}
	}

	if req.AddLabelID != nil {
		for _, cardID := range req.CardIDs {
			if err := s.DB.AddLabelToCard(cardID, *req.AddLabelID); err != nil {
				log.Printf("Failed to add label %d to card %d: %v", *req.AddLabelID, cardID, err)
			}
		}
	}

	if req.RemoveLabelID != nil {
		for _, cardID := range req.CardIDs {
			if err := s.DB.RemoveLabelFromCard(cardID, *req.RemoveLabelID); err != nil {
				log.Printf("Failed to remove label %d from card %d: %v", *req.RemoveLabelID, cardID, err)
			}
		}
	}

	for _, cardID := range req.CardIDs {
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_updated",
			BoardID:   firstCard.BoardID,
			Payload:   map[string]interface{}{"card_id": cardID},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"updated": len(req.CardIDs)})
}

func (s *Server) handleBulkDeleteCards(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CardIDs []int64 `json:"card_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) == 0 {
		http.Error(w, "card_ids must not be empty", http.StatusBadRequest)
		return
	}
	if len(req.CardIDs) > 100 {
		http.Error(w, "max 100 cards per bulk operation", http.StatusBadRequest)
		return
	}

	// Load first card to get board ID and check membership
	firstCard, err := s.DB.GetCardByID(req.CardIDs[0])
	if err != nil || firstCard == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}
	if !s.checkBoardMembership(w, r, firstCard.BoardID, models.BoardRoleMember) {
		return
	}

	// Verify all cards belong to the same board
	for _, cardID := range req.CardIDs[1:] {
		c, err := s.DB.GetCardByID(cardID)
		if err != nil || c == nil {
			http.Error(w, fmt.Sprintf("Card %d not found", cardID), http.StatusNotFound)
			return
		}
		if c.BoardID != firstCard.BoardID {
			http.Error(w, "All cards must belong to the same board", http.StatusBadRequest)
			return
		}
	}

	// Log activity before deletion
	user := getUserFromContext(r.Context())
	for _, cardID := range req.CardIDs {
		if err := s.DB.LogActivity(firstCard.BoardID, &cardID, user.ID, "deleted", "card", "", "", ""); err != nil {
			log.Printf("Failed to log bulk delete activity: %v", err)
		}
	}

	if err := s.DB.BulkDeleteCards(req.CardIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	for _, cardID := range req.CardIDs {
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_deleted",
			BoardID:   firstCard.BoardID,
			Payload:   map[string]interface{}{"card_id": cardID},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"deleted": len(req.CardIDs)})
}

// parseMentions extracts @mentions from text and returns user IDs
// Supports @display_name format (display names are matched case-insensitively)
func (s *Server) parseMentions(body string) []int64 {
	// Match @username patterns - supports spaces in names when quoted: @"John Doe" or @John
	mentionRegex := regexp.MustCompile(`@"([^"]+)"|@(\S+)`)
	matches := mentionRegex.FindAllStringSubmatch(body, -1)

	if len(matches) == 0 {
		return nil
	}

	// Get all users to match against
	users, err := s.DB.ListUsers()
	if err != nil {
		return nil
	}

	// Build a map of lowercase display names to user IDs
	nameToID := make(map[string]int64)
	for _, u := range users {
		nameToID[strings.ToLower(u.DisplayName)] = u.ID
	}

	var mentionedIDs []int64
	seen := make(map[int64]bool)

	for _, match := range matches {
		// match[1] is the quoted name, match[2] is the unquoted name
		name := match[1]
		if name == "" {
			name = match[2]
		}
		name = strings.ToLower(name)

		if userID, ok := nameToID[name]; ok && !seen[userID] {
			mentionedIDs = append(mentionedIDs, userID)
			seen[userID] = true
		}
	}

	return mentionedIDs
}
