package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/jsnapoli/gira/internal/auth"
)

// BoardEvent represents an event sent to clients via SSE
type BoardEvent struct {
	Type      string      `json:"type"` // card_created, card_updated, card_moved, card_deleted
	BoardID   int64       `json:"board_id"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
	UserID    int64       `json:"user_id"`
}

// SSEClient represents a connected SSE client
type SSEClient struct {
	ID      string
	UserID  int64
	BoardID int64
	Events  chan BoardEvent
}

// SSEHub manages all SSE connections per board
type SSEHub struct {
	mu      sync.RWMutex
	clients map[int64]map[string]*SSEClient // boardID -> clientID -> client
}

// NewSSEHub creates a new SSE hub
func NewSSEHub() *SSEHub {
	return &SSEHub{
		clients: make(map[int64]map[string]*SSEClient),
	}
}

// Register adds a new client to the hub
func (h *SSEHub) Register(client *SSEClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.clients[client.BoardID] == nil {
		h.clients[client.BoardID] = make(map[string]*SSEClient)
	}
	h.clients[client.BoardID][client.ID] = client
	log.Printf("SSE: Client %s registered for board %d (user %d)", client.ID, client.BoardID, client.UserID)
}

// Unregister removes a client from the hub
func (h *SSEHub) Unregister(client *SSEClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if boardClients, ok := h.clients[client.BoardID]; ok {
		if _, exists := boardClients[client.ID]; exists {
			close(client.Events)
			delete(boardClients, client.ID)
			log.Printf("SSE: Client %s unregistered from board %d", client.ID, client.BoardID)
		}
		// Clean up empty board maps
		if len(boardClients) == 0 {
			delete(h.clients, client.BoardID)
		}
	}
}

// Broadcast sends an event to all clients viewing a specific board
func (h *SSEHub) Broadcast(event BoardEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	boardClients, ok := h.clients[event.BoardID]
	if !ok || len(boardClients) == 0 {
		return
	}

	log.Printf("SSE: Broadcasting %s event to %d clients on board %d", event.Type, len(boardClients), event.BoardID)

	for _, client := range boardClients {
		select {
		case client.Events <- event:
		default:
			// Client buffer full, skip this event
			log.Printf("SSE: Client %s buffer full, skipping event", client.ID)
		}
	}
}

// handleBoardSSE handles SSE connections for a specific board
func (s *Server) handleBoardSSE(w http.ResponseWriter, r *http.Request) {
	boardID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid board ID", http.StatusBadRequest)
		return
	}

	// Authenticate via query parameter (EventSource API limitation)
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

	// Verify board access
	board, err := s.DB.GetBoardByID(boardID)
	if err != nil || board == nil {
		http.Error(w, "Board not found", http.StatusNotFound)
		return
	}

	// Check if user has access (owner, member, or admin)
	if board.OwnerID != user.ID && !user.IsAdmin {
		members, err := s.DB.GetBoardMembers(boardID)
		if err != nil {
			http.Error(w, "Failed to check access", http.StatusInternalServerError)
			return
		}
		hasAccess := false
		for _, member := range members {
			if member.UserID == user.ID {
				hasAccess = true
				break
			}
		}
		if !hasAccess {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Create client
	clientID := fmt.Sprintf("%d-%d", user.ID, time.Now().UnixNano())
	client := &SSEClient{
		ID:      clientID,
		UserID:  user.ID,
		BoardID: boardID,
		Events:  make(chan BoardEvent, 10),
	}

	// Register client
	s.SSEHub.Register(client)
	defer s.SSEHub.Unregister(client)

	// Flush headers
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {\"client_id\":\"%s\"}\n\n", clientID)
	flusher.Flush()

	// Create keepalive ticker (30 seconds)
	keepalive := time.NewTicker(30 * time.Second)
	defer keepalive.Stop()

	// Listen for events
	for {
		select {
		case event, ok := <-client.Events:
			if !ok {
				return
			}
			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("SSE: Failed to marshal event: %v", err)
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
			flusher.Flush()

		case <-keepalive.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()

		case <-r.Context().Done():
			return
		}
	}
}
