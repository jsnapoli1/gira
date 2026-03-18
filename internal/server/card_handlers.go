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

	// Update issue in the appropriate provider
	user := getUserFromContext(r.Context())
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

	var req struct {
		Position float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
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

	// Create notification for the assigned user (if not self-assigning)
	currentUser := getUserFromContext(r.Context())
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
