import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { CardDetailModal } from '../components/CardDetailModal';
import { DroppableColumn } from '../components/DroppableColumn';
import { BacklogView } from '../components/BacklogView';
import { AddSwimlaneModal } from '../components/AddSwimlaneModal';
import { AddCardModal } from '../components/AddCardModal';
import { boards as boardsApi, cards as cardsApi, sprints as sprintsApi, gitea, users as usersApi } from '../api/client';
import { Board, Card, Sprint, Repository, User, Label } from '../types';
import { useBoardSSE } from '../hooks/useBoardSSE';
import { useToast } from '../components/Toast';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { Plus, Settings, ChevronLeft, Clock, Filter, X, Search } from 'lucide-react';

export function BoardView() {
  const { boardId } = useParams<{ boardId: string }>();
  const { showToast } = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [boardLabels, setBoardLabels] = useState<Label[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [showAddSwimlane, setShowAddSwimlane] = useState(false);
  const [showAddCard, setShowAddCard] = useState<{ swimlaneId: number; columnId: number } | null>(null);
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'backlog'>('board');
  const [filterAssignee, setFilterAssignee] = useState<number | null>(null);
  const [filterLabel, setFilterLabel] = useState<number | null>(null);
  const [filterSwimlane, setFilterSwimlane] = useState<number | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // SSE event handlers for real-time updates
  const handleCardCreated = useCallback((card: Card) => {
    setCards((prev) => {
      // Avoid duplicates (in case we created the card ourselves)
      if (prev.some((c) => c.id === card.id)) {
        return prev;
      }
      return [...prev, card];
    });
  }, []);

  const handleCardUpdated = useCallback((card: Card) => {
    setCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
    // Also update selectedCard if it's the one being viewed
    setSelectedCard((prev) => (prev?.id === card.id ? card : prev));
  }, []);

  const handleCardMoved = useCallback((cardId: number, columnId: number, state: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, column_id: columnId, state } : c))
    );
  }, []);

  const handleCardDeleted = useCallback((cardId: number) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    // Close modal if the deleted card was selected
    setSelectedCard((prev) => (prev?.id === cardId ? null : prev));
  }, []);

  // Connect to SSE for real-time board updates
  useBoardSSE({
    boardId: boardId ? parseInt(boardId) : 0,
    onCardCreated: handleCardCreated,
    onCardUpdated: handleCardUpdated,
    onCardMoved: handleCardMoved,
    onCardDeleted: handleCardDeleted,
    enabled: !!boardId && !loading,
  });

  useEffect(() => {
    loadBoard();
  }, [boardId]);

  const loadBoard = async () => {
    if (!boardId) return;
    setLoading(true);
    try {
      const [boardData, cardsData, sprintsData, reposData, usersData, labelsData, customFieldsData] = await Promise.all([
        boardsApi.get(parseInt(boardId)),
        boardsApi.getCards(parseInt(boardId)),
        sprintsApi.list(parseInt(boardId)),
        gitea.getRepos().catch(() => []),
        usersApi.list().catch(() => []),
        boardsApi.getLabels(parseInt(boardId)).catch(() => []),
        boardsApi.getCustomFields(parseInt(boardId)).catch(() => []),
      ]);
      setBoard(boardData);
      setCards(cardsData || []);
      setSprints(sprintsData || []);
      setRepos(reposData || []);
      setUsers(usersData || []);
      setBoardLabels(labelsData || []);
      setCustomFields(customFieldsData || []);

      // Find active sprint
      const active = sprintsData?.find((s: Sprint) => s.status === 'active');
      setActiveSprint(active || null);
    } catch (err) {
      console.error('Failed to load board:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const card = cards.find((c) => `card-${c.id}` === active.id);
    if (card) {
      setActiveCard(card);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const cardId = parseInt(String(active.id).replace('card-', ''));
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    // Find target column from the over element
    let targetColumnId: number | null = null;
    let targetState: string | null = null;

    // Check if dropped on another card
    if (String(over.id).startsWith('card-')) {
      const overCard = cards.find((c) => `card-${c.id}` === over.id);
      if (overCard) {
        targetColumnId = overCard.column_id;
        const targetColumn = board?.columns.find((c) => c.id === targetColumnId);
        targetState = targetColumn?.state || null;
      }
    }

    if (targetColumnId && targetState && targetColumnId !== card.column_id) {
      try {
        await cardsApi.move(cardId, targetColumnId, targetState);
        setCards(
          cards.map((c) =>
            c.id === cardId ? { ...c, column_id: targetColumnId!, state: targetState! } : c
          )
        );
      } catch (err) {
        console.error('Failed to move card:', err);
        showToast('Failed to move card', 'error');
      }
    }
  };

  const handleAddCard = async (data: { title: string; description: string; storyPoints: number | null }) => {
    if (!showAddCard || !board) return;

    try {
      const card = await cardsApi.create({
        board_id: board.id,
        swimlane_id: showAddCard.swimlaneId,
        column_id: showAddCard.columnId,
        sprint_id: activeSprint?.id || null,
        title: data.title,
        description: data.description,
        story_points: data.storyPoints,
        priority: 'medium',
      });
      setCards([...cards, card]);
      setShowAddCard(null);
      showToast('Card created', 'success');
    } catch (err) {
      console.error('Failed to create card:', err);
      showToast('Failed to create card', 'error');
      throw err;
    }
  };

  const handleAddSwimlane = async (data: {
    name: string;
    repoOwner: string;
    repoName: string;
    designator: string;
    color: string;
  }) => {
    if (!board) return;
    try {
      await boardsApi.addSwimlane(board.id, {
        name: data.name,
        repo_owner: data.repoOwner,
        repo_name: data.repoName,
        designator: data.designator,
        color: data.color,
      });
      loadBoard();
      setShowAddSwimlane(false);
      showToast('Swimlane added', 'success');
    } catch (err) {
      console.error('Failed to add swimlane:', err);
      showToast('Failed to add swimlane', 'error');
    }
  };

  // Filter cards by assignee, label, swimlane, priority, and search query
  const filteredCards = useMemo(() => {
    let filtered = cards;
    if (filterAssignee) {
      filtered = filtered.filter((c) => c.assignees?.some((a) => a.id === filterAssignee));
    }
    if (filterLabel) {
      filtered = filtered.filter((c) => c.labels?.some((l) => l.id === filterLabel));
    }
    if (filterSwimlane) {
      filtered = filtered.filter((c) => c.swimlane_id === filterSwimlane);
    }
    if (filterPriority) {
      filtered = filtered.filter((c) => c.priority === filterPriority);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((c) =>
        c.title.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [cards, filterAssignee, filterLabel, filterSwimlane, filterPriority, searchQuery]);

  // Group cards by swimlane and column
  const cardsBySwimlanAndColumn = useMemo(() => {
    const result: Record<number, Record<number, Card[]>> = {};
    if (!board) return result;

    const swimlanes = board.swimlanes || [];
    const columns = board.columns || [];

    for (const swimlane of swimlanes) {
      result[swimlane.id] = {};
      for (const column of columns) {
        result[swimlane.id][column.id] = filteredCards.filter(
          (c) => c.swimlane_id === swimlane.id && c.column_id === column.id
        );
      }
    }
    return result;
  }, [board, filteredCards]);

  if (loading) {
    return (
      <Layout>
        <div className="loading">Loading board...</div>
      </Layout>
    );
  }

  if (!board) {
    return (
      <Layout>
        <div className="error">Board not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="board-page">
        <div className="board-header">
          <div className="board-header-left">
            <Link to="/boards" className="back-link">
              <ChevronLeft size={20} />
            </Link>
            <h1>{board.name}</h1>
            {activeSprint && (
              <span className="active-sprint-badge">
                <Clock size={14} />
                {activeSprint.name}
              </span>
            )}
          </div>
          <div className="board-header-right">
            <div className="board-filters">
              <div className="search-input">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search cards..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Filter size={16} />
              <select
                value={filterSwimlane || ''}
                onChange={(e) => setFilterSwimlane(e.target.value ? parseInt(e.target.value) : null)}
                className="filter-select"
              >
                <option value="">All swimlanes</option>
                {(board?.swimlanes || []).map((sl) => (
                  <option key={sl.id} value={sl.id}>{sl.name}</option>
                ))}
              </select>
              <select
                value={filterAssignee || ''}
                onChange={(e) => setFilterAssignee(e.target.value ? parseInt(e.target.value) : null)}
                className="filter-select"
              >
                <option value="">All assignees</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.display_name}</option>
                ))}
              </select>
              <select
                value={filterLabel || ''}
                onChange={(e) => setFilterLabel(e.target.value ? parseInt(e.target.value) : null)}
                className="filter-select"
              >
                <option value="">All labels</option>
                {boardLabels.map((label) => (
                  <option key={label.id} value={label.id}>{label.name}</option>
                ))}
              </select>
              <select
                value={filterPriority || ''}
                onChange={(e) => setFilterPriority(e.target.value || null)}
                className="filter-select"
              >
                <option value="">All priorities</option>
                <option value="highest">Highest</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="lowest">Lowest</option>
              </select>
              {(filterAssignee || filterLabel || filterSwimlane || filterPriority || searchQuery) && (
                <button className="clear-filter" onClick={() => { setFilterAssignee(null); setFilterLabel(null); setFilterSwimlane(null); setFilterPriority(null); setSearchQuery(''); }} title="Clear filters">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="view-toggle">
              <button
                className={`view-btn ${viewMode === 'board' ? 'active' : ''}`}
                onClick={() => setViewMode('board')}
              >
                Board
              </button>
              <button
                className={`view-btn ${viewMode === 'backlog' ? 'active' : ''}`}
                onClick={() => setViewMode('backlog')}
              >
                Backlog
              </button>
            </div>
            <button className="btn" onClick={() => setShowAddSwimlane(true)}>
              <Plus size={18} />
              <span>Add Swimlane</span>
            </button>
            <Link to={`/boards/${board.id}/settings`} className="btn">
              <Settings size={18} />
            </Link>
          </div>
        </div>

        {viewMode === 'board' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="board-content">
              {(board.swimlanes || []).length === 0 ? (
                <div className="empty-swimlanes">
                  <p>Add a swimlane to start tracking issues from a repository</p>
                  <button className="btn btn-primary" onClick={() => setShowAddSwimlane(true)}>
                    <Plus size={18} />
                    <span>Add Swimlane</span>
                  </button>
                </div>
              ) : (
                (board.swimlanes || []).map((swimlane) => (
                  <div key={swimlane.id} className="swimlane">
                    <div className="swimlane-header" style={{ borderLeftColor: swimlane.color }}>
                      <h2>{swimlane.name}</h2>
                      <span className="swimlane-repo">
                        {swimlane.repo_owner}/{swimlane.repo_name}
                      </span>
                    </div>
                    <div className="swimlane-columns">
                      {(board.columns || []).map((column) => (
                        <DroppableColumn
                          key={column.id}
                          column={column}
                          cards={cardsBySwimlanAndColumn[swimlane.id]?.[column.id] || []}
                          swimlane={swimlane}
                          onCardClick={(card) => setSelectedCard(card)}
                          onQuickAdd={async (title) => {
                            const card = await cardsApi.create({
                              board_id: board.id,
                              swimlane_id: swimlane.id,
                              column_id: column.id,
                              sprint_id: activeSprint?.id || null,
                              title,
                              description: '',
                              priority: 'medium',
                            });
                            setCards([...cards, card]);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <DragOverlay>
              {activeCard && (
                <div className="card-item dragging">
                  <div className="card-content">
                    <h4 className="card-title">{activeCard.title}</h4>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          <BacklogView
            boardId={board.id}
            cards={cards}
            sprints={sprints}
            swimlanes={board.swimlanes}
            columns={board.columns}
            onCardClick={(card) => setSelectedCard(card)}
            onRefresh={loadBoard}
          />
        )}

        {/* Add Swimlane Modal */}
        {showAddSwimlane && (
          <AddSwimlaneModal
            repos={repos}
            onClose={() => setShowAddSwimlane(false)}
            onAdd={handleAddSwimlane}
          />
        )}

        {/* Add Card Modal */}
        {showAddCard && (
          <AddCardModal
            onClose={() => setShowAddCard(null)}
            onAdd={handleAddCard}
          />
        )}

        {/* Card Detail Modal */}
        {selectedCard && (
          <CardDetailModal
            card={selectedCard}
            swimlane={board.swimlanes.find((s) => s.id === selectedCard.swimlane_id)!}
            sprints={sprints}
            users={users}
            boardLabels={boardLabels}
            customFields={customFields}
            boardCards={cards}
            onClose={() => setSelectedCard(null)}
            onUpdate={(updatedCard) => {
              setCards(cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)));
              setSelectedCard(updatedCard);
            }}
            onDelete={(cardId) => {
              setCards(cards.filter((c) => c.id !== cardId));
              setSelectedCard(null);
            }}
          />
        )}
      </div>
    </Layout>
  );
}


