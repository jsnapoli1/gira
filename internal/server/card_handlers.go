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

func (s *Server) handleCards(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleCard(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/cards/")
	parts := strings.Split(path, "/")
	cardID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		http.Error(w, "Invalid card ID", http.StatusBadRequest)
		return
	}

	card, err := s.DB.GetCardByID(cardID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if card == nil {
		http.Error(w, "Card not found", http.StatusNotFound)
		return
	}

	// Handle sub-routes
	if len(parts) > 1 {
		switch parts[1] {
		case "move":
			if r.Method == "POST" {
				var req struct {
					ColumnID int64  `json:"column_id"`
					State    string `json:"state"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid request", http.StatusBadRequest)
					return
				}
				if err := s.DB.MoveCard(cardID, req.ColumnID, req.State); err != nil {
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
					Payload:   map[string]interface{}{"card_id": cardID, "column_id": req.ColumnID, "state": req.State},
					Timestamp: time.Now(),
					UserID:    user.ID,
				})

				w.WriteHeader(http.StatusOK)
				return
			}
		case "assign-sprint":
			if r.Method == "POST" {
				var req struct {
					SprintID *int64 `json:"sprint_id"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid request", http.StatusBadRequest)
					return
				}
				if err := s.DB.AssignCardToSprint(cardID, req.SprintID); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusOK)
				return
			}
		case "assignees":
			s.handleCardAssignees(w, r, card, parts[2:])
			return
		case "comments":
			s.handleCardComments(w, r, card)
			return
		case "labels":
			s.handleCardLabels(w, r, card, parts[2:])
			return
		case "attachments":
			s.handleCardAttachments(w, r, card, parts[2:])
			return
		case "custom-fields":
			s.handleCardCustomFields(w, r, card, parts[2:])
			return
		case "worklogs":
			s.handleCardWorkLogs(w, r, card, parts[2:])
			return
		case "children":
			if r.Method == "GET" {
				children, err := s.DB.ListChildCards(cardID)
				if err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(children)
				return
			}
		}
	}

	switch r.Method {
	case "GET":
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card)

	case "PUT":
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

	case "DELETE":
		user := getUserFromContext(r.Context())
		boardID := card.BoardID
		if err := s.DB.DeleteCard(cardID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Broadcast card_deleted event
		s.SSEHub.Broadcast(BoardEvent{
			Type:      "card_deleted",
			BoardID:   boardID,
			Payload:   map[string]interface{}{"card_id": cardID},
			Timestamp: time.Now(),
			UserID:    user.ID,
		})

		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card comments handler (local comments)

func (s *Server) handleCardComments(w http.ResponseWriter, r *http.Request, card *models.Card) {
	switch r.Method {
	case "GET":
		comments, err := s.DB.GetCommentsForCard(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(comments)

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card work logs handler

func (s *Server) handleCardWorkLogs(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle DELETE /cards/:id/worklogs/:worklogId
	if len(subParts) > 0 && subParts[0] != "" {
		worklogID, err := strconv.ParseInt(subParts[0], 10, 64)
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

		switch r.Method {
		case "DELETE":
			if err := s.DB.DeleteWorkLog(worklogID); err != nil {
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

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card assignees handler

func (s *Server) handleCardAssignees(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/assignees/:userId
	if len(subParts) > 0 {
		userID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.RemoveCardAssignee(card.ID, userID); err != nil {
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
		assignees, err := s.DB.GetCardAssignees(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(assignees)

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card labels handler

func (s *Server) handleCardLabels(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/labels/:labelId
	if len(subParts) > 0 {
		labelID, err := strconv.ParseInt(subParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid label ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "DELETE":
			if err := s.DB.RemoveLabelFromCard(card.ID, labelID); err != nil {
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
		labels, err := s.DB.GetCardLabels(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(labels)

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Card attachments handler

func (s *Server) handleCardAttachments(w http.ResponseWriter, r *http.Request, card *models.Card, subParts []string) {
	// Handle /cards/:id/attachments/:attachmentId
	if len(subParts) > 0 {
		attachmentID, err := strconv.ParseInt(subParts[0], 10, 64)
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

		switch r.Method {
		case "DELETE":
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
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case "GET":
		attachments, err := s.DB.GetAttachmentsForCard(card.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(attachments)

	case "POST":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Attachment download handler

func (s *Server) handleAttachmentDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/attachments/")
	attachmentID, err := strconv.ParseInt(path, 10, 64)
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

// Card custom fields handler

func (s *Server) handleCardCustomFields(w http.ResponseWriter, r *http.Request, card *models.Card, pathParts []string) {
	// Handle specific field value by field ID
	if len(pathParts) > 0 && pathParts[0] != "" {
		fieldID, err := strconv.ParseInt(pathParts[0], 10, 64)
		if err != nil {
			http.Error(w, "Invalid field ID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case "GET":
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

		case "PUT":
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

		case "DELETE":
			if err := s.DB.DeleteCustomFieldValue(card.ID, fieldID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// Handle collection - get all custom field values for a card
	switch r.Method {
	case "GET":
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

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
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
