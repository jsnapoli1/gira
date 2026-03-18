import { useEffect, useRef, useCallback } from 'react';
import { Card } from '../types';
import { getToken } from '../api/client';

interface CardMovedPayload {
  card_id: number;
  column_id: number;
  state: string;
}

interface CardDeletedPayload {
  card_id: number;
}

interface BoardEvent {
  type: string;
  board_id: number;
  payload: Card | CardMovedPayload | CardDeletedPayload;
  timestamp: string;
  user_id: number;
}

export interface NotificationPayload {
  user_id: number;
  type: string;
  title: string;
}

export interface UseBoardSSEOptions {
  boardId: number;
  onCardCreated?: (card: Card) => void;
  onCardUpdated?: (card: Card) => void;
  onCardMoved?: (cardId: number, columnId: number, state: string) => void;
  onCardDeleted?: (cardId: number) => void;
  onNotification?: (payload: NotificationPayload) => void;
  enabled?: boolean;
}

export function useBoardSSE({
  boardId,
  onCardCreated,
  onCardUpdated,
  onCardMoved,
  onCardDeleted,
  onNotification,
  enabled = true,
}: UseBoardSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const connect = useCallback(() => {
    if (!enabled || !boardId) return;

    const token = getToken();
    if (!token) {
      console.warn('SSE: No auth token available');
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/boards/${boardId}/events?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE: Connected to board', boardId);
      reconnectAttemptRef.current = 0;
    };

    eventSource.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      console.log('SSE: Connection established, client ID:', data.client_id);
    });

    eventSource.addEventListener('card_created', (e) => {
      const event: BoardEvent = JSON.parse(e.data);
      if (onCardCreated) {
        onCardCreated(event.payload as Card);
      }
    });

    eventSource.addEventListener('card_updated', (e) => {
      const event: BoardEvent = JSON.parse(e.data);
      if (onCardUpdated) {
        onCardUpdated(event.payload as Card);
      }
    });

    eventSource.addEventListener('card_moved', (e) => {
      const event: BoardEvent = JSON.parse(e.data);
      const payload = event.payload as CardMovedPayload;
      if (onCardMoved) {
        onCardMoved(payload.card_id, payload.column_id, payload.state);
      }
    });

    eventSource.addEventListener('card_deleted', (e) => {
      const event: BoardEvent = JSON.parse(e.data);
      const payload = event.payload as CardDeletedPayload;
      if (onCardDeleted) {
        onCardDeleted(payload.card_id);
      }
    });

    eventSource.addEventListener('notification', (e) => {
      const event: BoardEvent = JSON.parse(e.data);
      if (onNotification) {
        onNotification(event.payload as unknown as NotificationPayload);
      }
    });

    eventSource.onerror = () => {
      console.log('SSE: Connection error, will reconnect...');
      eventSource.close();
      eventSourceRef.current = null;

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current++;

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };
  }, [boardId, enabled, onCardCreated, onCardUpdated, onCardMoved, onCardDeleted, onNotification]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected: eventSourceRef.current?.readyState === EventSource.OPEN,
  };
}
