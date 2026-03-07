import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { boards as boardsApi, cards as cardsApi, sprints as sprintsApi, gitea, users as usersApi } from '../api/client';
import { Board, Card, Column, Swimlane, Sprint, Repository, User, Label } from '../types';
import { useBoardSSE } from '../hooks/useBoardSSE';
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
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Settings, ChevronLeft, GripVertical, Tag, Clock, AlertCircle, User as UserIcon, Filter, X, Check, Calendar, Search } from 'lucide-react';

// Render comment body with highlighted @mentions
function renderCommentBody(body: string): React.ReactNode {
  // Match @"Name With Spaces" or @SingleName patterns
  const mentionRegex = /(@"[^"]+"|@\S+)/g;
  const parts = body.split(mentionRegex);

  return parts.map((part, index) => {
    if (part.match(/^@"[^"]+"$/) || part.match(/^@\S+$/)) {
      return (
        <span key={index} className="mention-highlight">
          {part}
        </span>
      );
    }
    return part;
  });
}

// Date helpers
function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 7) return `${days}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isDueSoon(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= 3;
}

function isOverdue(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getTime() < now.getTime();
}

interface CardItemProps {
  card: Card;
  swimlane: Swimlane;
  onClick: () => void;
}

function CardItem({ card, swimlane, onClick }: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    data: { card, swimlane },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityColors: Record<string, string> = {
    highest: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    low: '#16a34a',
    lowest: '#6b7280',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card-item"
      onClick={onClick}
      {...attributes}
    >
      <div className="card-drag-handle" {...listeners}>
        <GripVertical size={14} />
      </div>
      <div className="card-content">
        <div className="card-header">
          <span className={`card-type-badge type-${card.issue_type || 'task'}`} title={card.issue_type || 'task'}>
            {(card.issue_type || 'task').charAt(0).toUpperCase()}
          </span>
          <span className="card-designator" style={{ color: swimlane.color }}>
            {swimlane.designator}{card.gitea_issue_id}
          </span>
          {card.priority && card.priority !== 'medium' && (
            <span
              className="card-priority"
              style={{ color: priorityColors[card.priority] }}
              title={`Priority: ${card.priority}`}
            >
              <AlertCircle size={12} />
            </span>
          )}
        </div>
        <h4 className="card-title">{card.title}</h4>
        {card.labels && card.labels.length > 0 && (
          <div className="card-labels">
            {card.labels.slice(0, 3).map((label) => (
              <span key={label.id} className="card-label" style={{ backgroundColor: label.color }} title={label.name}>
                {label.name}
              </span>
            ))}
            {card.labels.length > 3 && (
              <span className="card-label more">+{card.labels.length - 3}</span>
            )}
          </div>
        )}
        <div className="card-meta">
          {card.story_points !== null && (
            <span className="card-points" title="Story points">
              <Tag size={12} />
              {card.story_points}
            </span>
          )}
          {card.due_date && (
            <span className={`card-due-date ${isDueSoon(card.due_date) ? 'due-soon' : ''} ${isOverdue(card.due_date) ? 'overdue' : ''}`} title={`Due: ${formatDueDate(card.due_date)}`}>
              <Calendar size={12} />
              {formatDueDate(card.due_date)}
            </span>
          )}
          {card.assignees && card.assignees.length > 0 && (
            <div className="card-assignees">
              {card.assignees.slice(0, 3).map((assignee) => (
                <div key={assignee.id} className="card-assignee" title={assignee.display_name}>
                  {assignee.avatar_url ? (
                    <img src={assignee.avatar_url} alt={assignee.display_name} />
                  ) : (
                    <span>{assignee.display_name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
              ))}
              {card.assignees.length > 3 && (
                <div className="card-assignee more">+{card.assignees.length - 3}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DroppableColumn({
  column,
  cards,
  swimlane,
  onCardClick,
  onQuickAdd,
}: {
  column: Column;
  cards: Card[];
  swimlane: Swimlane;
  onCardClick: (card: Card) => void;
  onQuickAdd: (title: string) => Promise<void>;
}) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setAdding(true);
    try {
      await onQuickAdd(quickTitle);
      setQuickTitle('');
      setShowQuickAdd(false);
    } catch (err) {
      console.error('Failed to create card:', err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="board-column">
      <div className="column-header">
        <h3>{column.name}</h3>
        <span className="column-count">{cards.length}</span>
      </div>
      <SortableContext items={cards.map((c) => `card-${c.id}`)} strategy={verticalListSortingStrategy}>
        <div className="column-cards" data-column-id={column.id} data-state={column.state}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              swimlane={swimlane}
              onClick={() => onCardClick(card)}
            />
          ))}
          {showQuickAdd ? (
            <form className="quick-add-form" onSubmit={handleQuickAdd}>
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Card title..."
                autoFocus
                disabled={adding}
              />
              <div className="quick-add-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !quickTitle.trim()}>
                  {adding ? 'Adding...' : 'Add'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => { setShowQuickAdd(false); setQuickTitle(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="add-card-btn" onClick={() => setShowQuickAdd(true)}>
              <Plus size={14} />
              <span>Add card</span>
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function BoardView() {
  const { boardId } = useParams<{ boardId: string }>();
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
    } catch (err) {
      console.error('Failed to create card:', err);
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
    } catch (err) {
      console.error('Failed to add swimlane:', err);
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

// Backlog View Component
function BacklogView({
  boardId,
  cards,
  sprints,
  swimlanes,
  columns,
  onCardClick,
  onRefresh,
}: {
  boardId: number;
  cards: Card[];
  sprints: Sprint[];
  swimlanes: Swimlane[];
  columns: Column[];
  onCardClick: (card: Card) => void;
  onRefresh: () => void;
}) {
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [newSprintGoal, setNewSprintGoal] = useState('');
  const [newSprintStartDate, setNewSprintStartDate] = useState('');
  const [newSprintEndDate, setNewSprintEndDate] = useState('');
  const [addingCardToSwimlane, setAddingCardToSwimlane] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');

  const activeSprint = sprints.find((s) => s.status === 'active');
  const planningSprints = sprints.filter((s) => s.status === 'planning');

  const handleCreateSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sprintsApi.create(boardId, newSprintName, newSprintGoal, newSprintStartDate || undefined, newSprintEndDate || undefined);
      setShowCreateSprint(false);
      setNewSprintName('');
      setNewSprintGoal('');
      setNewSprintStartDate('');
      setNewSprintEndDate('');
      onRefresh();
    } catch (err) {
      console.error('Failed to create sprint:', err);
    }
  };

  const handleStartSprint = async (sprintId: number) => {
    try {
      await sprintsApi.start(sprintId);
      onRefresh();
    } catch (err) {
      console.error('Failed to start sprint:', err);
    }
  };

  const handleCompleteSprint = async (sprintId: number) => {
    try {
      await sprintsApi.complete(sprintId);
      onRefresh();
    } catch (err) {
      console.error('Failed to complete sprint:', err);
    }
  };

  const handleAssignToSprint = async (cardId: number, sprintId: number | null) => {
    try {
      await cardsApi.assignToSprint(cardId, sprintId);
      onRefresh();
    } catch (err) {
      console.error('Failed to assign card:', err);
    }
  };

  const handleCreateCard = async (swimlaneId: number) => {
    if (!newCardTitle.trim()) return;
    const firstColumn = columns.find(c => c.position === 0) || columns[0];
    if (!firstColumn) return;

    try {
      await cardsApi.create({
        board_id: boardId,
        swimlane_id: swimlaneId,
        column_id: firstColumn.id,
        sprint_id: null,
        title: newCardTitle.trim(),
        description: '',
        priority: 'medium',
      });
      setNewCardTitle('');
      setAddingCardToSwimlane(null);
      onRefresh();
    } catch (err) {
      console.error('Failed to create card:', err);
    }
  };

  const getSwimlaneName = (swimlaneId: number) => {
    return swimlanes.find((s) => s.id === swimlaneId)?.designator || '';
  };

  // Get backlog cards grouped by swimlane
  const getBacklogCardsForSwimlane = (swimlaneId: number) => {
    return cards.filter((c) => c.sprint_id === null && c.swimlane_id === swimlaneId);
  };

  return (
    <div className="backlog-view">
      <div className="backlog-header">
        <h2>Backlog</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateSprint(true)}>
          <Plus size={18} />
          <span>Create Sprint</span>
        </button>
      </div>

      {swimlanes.map((swimlane) => {
        const swimlaneBacklogCards = getBacklogCardsForSwimlane(swimlane.id);
        return (
          <div key={swimlane.id} className="backlog-section swimlane-backlog">
            <div className="backlog-section-header" style={{ borderLeftColor: swimlane.color }}>
              <h2>
                <span className="swimlane-designator" style={{ color: swimlane.color }}>{swimlane.designator}</span>
                {swimlane.name} ({swimlaneBacklogCards.length})
              </h2>
              <button
                className="btn btn-sm"
                onClick={() => setAddingCardToSwimlane(swimlane.id)}
              >
                <Plus size={14} />
                Add Card
              </button>
            </div>
            <div className="backlog-cards">
              {addingCardToSwimlane === swimlane.id && (
                <div className="backlog-add-card-form">
                  <input
                    type="text"
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    placeholder="Enter card title..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateCard(swimlane.id);
                      if (e.key === 'Escape') {
                        setAddingCardToSwimlane(null);
                        setNewCardTitle('');
                      }
                    }}
                  />
                  <div className="backlog-add-card-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => handleCreateCard(swimlane.id)}>
                      Add
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setAddingCardToSwimlane(null);
                        setNewCardTitle('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {swimlaneBacklogCards.map((card) => (
                <div key={card.id} className="backlog-card" onClick={() => onCardClick(card)}>
                  <span className="card-designator">{getSwimlaneName(card.swimlane_id)}{card.gitea_issue_id}</span>
                  <span className="card-title">{card.title}</span>
                  {card.story_points !== null && <span className="card-points">{card.story_points}</span>}
                  <select
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleAssignToSprint(card.id, e.target.value ? parseInt(e.target.value) : null)}
                    value=""
                  >
                    <option value="">Move to sprint...</option>
                    {planningSprints.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    {activeSprint && <option value={activeSprint.id}>{activeSprint.name} (active)</option>}
                  </select>
                </div>
              ))}
              {swimlaneBacklogCards.length === 0 && addingCardToSwimlane !== swimlane.id && (
                <div className="backlog-empty">No cards in backlog</div>
              )}
            </div>
          </div>
        );
      })}

      {activeSprint && (
        <div className="backlog-section sprint-section active">
          <div className="backlog-section-header">
            <div className="sprint-header-info">
              <h2>{activeSprint.name} (Active)</h2>
              {(activeSprint.start_date || activeSprint.end_date) && (
                <span className="sprint-dates">
                  <Calendar size={14} />
                  {activeSprint.start_date && new Date(activeSprint.start_date).toLocaleDateString()}
                  {activeSprint.start_date && activeSprint.end_date && ' - '}
                  {activeSprint.end_date && new Date(activeSprint.end_date).toLocaleDateString()}
                </span>
              )}
            </div>
            <button className="btn btn-sm" onClick={() => handleCompleteSprint(activeSprint.id)}>
              Complete Sprint
            </button>
          </div>
          {activeSprint.goal && <p className="sprint-goal">{activeSprint.goal}</p>}
          <div className="backlog-cards">
            {cards.filter((c) => c.sprint_id === activeSprint.id).map((card) => (
              <div key={card.id} className="backlog-card" onClick={() => onCardClick(card)}>
                <span className="card-designator">{getSwimlaneName(card.swimlane_id)}{card.gitea_issue_id}</span>
                <span className="card-title">{card.title}</span>
                <span className={`card-state ${card.state}`}>{card.state}</span>
                {card.story_points !== null && <span className="card-points">{card.story_points}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {planningSprints.map((sprint) => (
        <div key={sprint.id} className="backlog-section sprint-section">
          <div className="backlog-section-header">
            <div className="sprint-header-info">
              <h2>{sprint.name}</h2>
              {(sprint.start_date || sprint.end_date) && (
                <span className="sprint-dates">
                  <Calendar size={14} />
                  {sprint.start_date && new Date(sprint.start_date).toLocaleDateString()}
                  {sprint.start_date && sprint.end_date && ' - '}
                  {sprint.end_date && new Date(sprint.end_date).toLocaleDateString()}
                </span>
              )}
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => handleStartSprint(sprint.id)}>
              Start Sprint
            </button>
          </div>
          {sprint.goal && <p className="sprint-goal">{sprint.goal}</p>}
          <div className="backlog-cards">
            {cards.filter((c) => c.sprint_id === sprint.id).map((card) => (
              <div key={card.id} className="backlog-card" onClick={() => onCardClick(card)}>
                <span className="card-designator">{getSwimlaneName(card.swimlane_id)}{card.gitea_issue_id}</span>
                <span className="card-title">{card.title}</span>
                {card.story_points !== null && <span className="card-points">{card.story_points}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {showCreateSprint && (
        <div className="modal-overlay" onClick={() => setShowCreateSprint(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Sprint</h2>
            <form onSubmit={handleCreateSprint}>
              <div className="form-group">
                <label>Sprint Name</label>
                <input
                  type="text"
                  value={newSprintName}
                  onChange={(e) => setNewSprintName(e.target.value)}
                  placeholder="Sprint 1"
                  required
                />
              </div>
              <div className="form-group">
                <label>Goal (optional)</label>
                <textarea
                  value={newSprintGoal}
                  onChange={(e) => setNewSprintGoal(e.target.value)}
                  placeholder="What do you want to achieve?"
                  rows={3}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Start Date (optional)</label>
                  <input
                    type="date"
                    value={newSprintStartDate}
                    onChange={(e) => setNewSprintStartDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>End Date (optional)</label>
                  <input
                    type="date"
                    value={newSprintEndDate}
                    onChange={(e) => setNewSprintEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowCreateSprint(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Add Swimlane Modal
function AddSwimlaneModal({
  repos,
  onClose,
  onAdd,
}: {
  repos: Repository[];
  onClose: () => void;
  onAdd: (data: { name: string; repoOwner: string; repoName: string; designator: string; color: string }) => void;
}) {
  const [name, setName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [designator, setDesignator] = useState('');
  const [color, setColor] = useState('#6366f1');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const [repoOwner, repoName] = selectedRepo.split('/');
    onAdd({ name, repoOwner, repoName, designator, color });
  };

  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Swimlane</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Frontend"
              required
            />
          </div>
          <div className="form-group">
            <label>Repository</label>
            {repos.length > 0 ? (
              <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} required>
                <option value="">Select a repository...</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.full_name}>
                    {repo.full_name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={selectedRepo}
                onChange={(e) => setSelectedRepo(e.target.value)}
                placeholder="owner/repo"
                required
              />
            )}
          </div>
          <div className="form-group">
            <label>Designator (card prefix)</label>
            <input
              type="text"
              value={designator}
              onChange={(e) => setDesignator(e.target.value)}
              placeholder="FE-"
              required
            />
          </div>
          <div className="form-group">
            <label>Color</label>
            <div className="color-picker">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-option ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Swimlane</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Add Card Modal
function AddCardModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (data: { title: string; description: string; storyPoints: number | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storyPoints, setStoryPoints] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onAdd({
        title,
        description,
        storyPoints: storyPoints ? parseInt(storyPoints) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create Card</h2>
        {error && <div className="modal-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Card title"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={4}
            />
          </div>
          <div className="form-group">
            <label>Story Points (optional)</label>
            <input
              type="number"
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              placeholder="0"
              min="0"
              max="100"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Card Detail Modal
function CardDetailModal({
  card,
  swimlane,
  sprints,
  users,
  boardLabels,
  customFields,
  onClose,
  onUpdate,
  onDelete,
}: {
  card: Card;
  swimlane: Swimlane;
  sprints: Sprint[];
  users: User[];
  boardLabels: Label[];
  customFields: any[];
  onClose: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [storyPoints, setStoryPoints] = useState(card.story_points?.toString() || '');
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.split('T')[0] : '');
  const [timeEstimate, setTimeEstimate] = useState(card.time_estimate?.toString() || '');
  const [issueType, setIssueType] = useState(card.issue_type || 'task');
  const [saving, setSaving] = useState(false);
  const [assignees, setAssignees] = useState<User[]>(card.assignees || []);
  const [labels, setLabels] = useState<Label[]>(card.labels || []);

  // Comments state
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Mention autocomplete state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  // Pending images for comment (pasted)
  const [pendingImages, setPendingImages] = useState<File[]>([]);

  // Image viewer state
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Attachments state
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(true);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Custom field values state
  const [customFieldValues, setCustomFieldValues] = useState<Record<number, string>>({});

  // Work logs (time tracking) state
  const [totalTimeLogged, setTotalTimeLogged] = useState(0);
  const [newWorkLogMinutes, setNewWorkLogMinutes] = useState('');
  const [newWorkLogDate, setNewWorkLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [newWorkLogNotes, setNewWorkLogNotes] = useState('');
  const [addingWorkLog, setAddingWorkLog] = useState(false);

  // Load all data on mount
  useEffect(() => {
    loadComments();
    loadAttachments();
    loadWorkLogs();
    if (customFields.length > 0) {
      loadCustomFieldValues();
    }
  }, [card.id]);

  const loadAttachments = async () => {
    setLoadingAttachments(true);
    try {
      const data = await cardsApi.getAttachments(card.id);
      setAttachments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load attachments:', err);
      setAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAttachment(true);
    try {
      const attachment = await cardsApi.uploadAttachment(card.id, file);
      if (attachment) {
        setAttachments([...attachments, attachment]);
      }
    } catch (err) {
      console.error('Failed to upload attachment:', err);
    } finally {
      setUploadingAttachment(false);
      e.target.value = ''; // Reset file input
    }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return;
    try {
      await cardsApi.deleteAttachment(card.id, attachmentId);
      setAttachments(attachments.filter((a) => a.id !== attachmentId));
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  const loadCustomFieldValues = async () => {
    try {
      const data = await cardsApi.getCustomFieldValues(card.id);
      const values: Record<number, string> = {};
      if (Array.isArray(data)) {
        data.forEach((v: any) => {
          values[v.field_id] = v.value;
        });
      }
      setCustomFieldValues(values);
    } catch (err) {
      console.error('Failed to load custom field values:', err);
      setCustomFieldValues({});
    }
  };

  const handleCustomFieldChange = async (fieldId: number, value: string) => {
    // Update local state immediately for responsiveness
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleCustomFieldSave = async (fieldId: number, value?: string) => {
    const valueToSave = value !== undefined ? value : customFieldValues[fieldId] || '';
    try {
      await cardsApi.setCustomFieldValue(card.id, fieldId, valueToSave);
    } catch (err) {
      console.error('Failed to save custom field:', err);
    }
  };

  const loadWorkLogs = async () => {
    try {
      const data = await cardsApi.getWorkLogs(card.id);
      setTotalTimeLogged(data.total_logged || 0);
    } catch (err) {
      console.error('Failed to load work logs:', err);
      setTotalTimeLogged(0);
    }
  };

  const handleAddWorkLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkLogMinutes || parseInt(newWorkLogMinutes) <= 0) return;

    setAddingWorkLog(true);
    try {
      const data = await cardsApi.addWorkLog(card.id, {
        time_spent: parseInt(newWorkLogMinutes),
        date: newWorkLogDate,
        notes: newWorkLogNotes,
      });
      setTotalTimeLogged(data.total_logged || 0);
      setNewWorkLogMinutes('');
      setNewWorkLogNotes('');
      setNewWorkLogDate(new Date().toISOString().split('T')[0]);
    } catch (err) {
      console.error('Failed to add work log:', err);
    } finally {
      setAddingWorkLog(false);
    }
  };

  const formatTimeSpent = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const data = await cardsApi.getComments(card.id);
      setComments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load comments:', err);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() && pendingImages.length === 0) return;

    setPostingComment(true);
    try {
      // First upload any pending images as attachments
      const uploadedAttachments: number[] = [];
      for (const img of pendingImages) {
        const attachment = await cardsApi.uploadAttachment(card.id, img);
        if (attachment) {
          uploadedAttachments.push(attachment.id);
          setAttachments((prev) => [...prev, attachment]);
        }
      }

      // Post the comment with attachment IDs
      const comment = await cardsApi.addCommentWithAttachments(card.id, newComment, uploadedAttachments);
      if (comment) {
        setComments([...comments, comment]);
      }
      setNewComment('');
      setPendingImages([]);
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPostingComment(false);
    }
  };

  // Handle paste for images in comment textarea
  const handleCommentPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          // Generate a filename based on timestamp
          const ext = item.type.split('/')[1] || 'png';
          const newFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: item.type });
          setPendingImages((prev) => [...prev, newFile]);
        }
        break;
      }
    }
  };

  // Filter users for mention dropdown
  const filteredMentionUsers = useMemo(() => {
    if (!mentionFilter) return users;
    const filter = mentionFilter.toLowerCase();
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(filter) ||
        u.email.toLowerCase().includes(filter)
    );
  }, [users, mentionFilter]);

  // Handle comment textarea input for @ mentions
  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNewComment(value);

    // Check if we're typing a mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      // Check if @ is at start or preceded by whitespace
      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        // Only show dropdown if no space in query (single word being typed)
        if (!query.includes(' ')) {
          setMentionFilter(query);
          setMentionStartPos(atIndex);
          setShowMentionDropdown(true);
          setMentionIndex(0);
          return;
        }
      }
    }
    setShowMentionDropdown(false);
  };

  // Handle mention selection
  const handleSelectMention = (user: User) => {
    // Replace @query with @displayName (use quotes if name has spaces)
    const beforeMention = newComment.slice(0, mentionStartPos);
    const afterMention = newComment.slice(mentionStartPos + mentionFilter.length + 1);
    const mentionText = user.display_name.includes(' ')
      ? `@"${user.display_name}" `
      : `@${user.display_name} `;
    setNewComment(beforeMention + mentionText + afterMention);
    setShowMentionDropdown(false);
  };

  // Handle keyboard navigation in mention dropdown
  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionDropdown || filteredMentionUsers.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % filteredMentionUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + filteredMentionUsers.length) % filteredMentionUsers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleSelectMention(filteredMentionUsers[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentionDropdown(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await cardsApi.update(card.id, {
        title,
        description,
        story_points: storyPoints ? parseInt(storyPoints) : null,
        priority,
        due_date: dueDate || null,
        time_estimate: timeEstimate ? parseInt(timeEstimate) : null,
        issue_type: issueType,
      });
      onUpdate({ ...updated, assignees, labels });
      setEditing(false);
    } catch (err) {
      console.error('Failed to update card:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this card?')) return;
    try {
      await cardsApi.delete(card.id);
      onDelete(card.id);
    } catch (err) {
      console.error('Failed to delete card:', err);
    }
  };

  const handleSprintChange = async (sprintId: number | null) => {
    try {
      await cardsApi.assignToSprint(card.id, sprintId);
      onUpdate({ ...card, sprint_id: sprintId, assignees });
    } catch (err) {
      console.error('Failed to update sprint:', err);
    }
  };

  const handleAddAssignee = async (userId: number) => {
    try {
      await cardsApi.addAssignee(card.id, userId);
      const user = users.find((u) => u.id === userId);
      if (user) {
        const newAssignees = [...assignees, user];
        setAssignees(newAssignees);
        onUpdate({ ...card, assignees: newAssignees });
      }
    } catch (err) {
      console.error('Failed to add assignee:', err);
    }
  };

  const handleRemoveAssignee = async (userId: number) => {
    try {
      await cardsApi.removeAssignee(card.id, userId);
      const newAssignees = assignees.filter((a) => a.id !== userId);
      setAssignees(newAssignees);
      onUpdate({ ...card, assignees: newAssignees });
    } catch (err) {
      console.error('Failed to remove assignee:', err);
    }
  };

  const unassignedUsers = users.filter((u) => !assignees.some((a) => a.id === u.id));

  const handleToggleLabel = async (label: Label) => {
    const isAssigned = labels.some((l) => l.id === label.id);
    try {
      if (isAssigned) {
        await cardsApi.removeLabel(card.id, label.id);
        const newLabels = labels.filter((l) => l.id !== label.id);
        setLabels(newLabels);
        onUpdate({ ...card, labels: newLabels, assignees });
      } else {
        await cardsApi.addLabel(card.id, label.id);
        const newLabels = [...labels, label];
        setLabels(newLabels);
        onUpdate({ ...card, labels: newLabels, assignees });
      }
    } catch (err) {
      console.error('Failed to toggle label:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSaveDescription = async () => {
    setSaving(true);
    try {
      const updated = await cardsApi.update(card.id, {
        title: card.title,
        description,
        story_points: card.story_points,
        priority: card.priority,
        due_date: card.due_date || null,
        time_estimate: card.time_estimate,
        issue_type: card.issue_type,
      });
      onUpdate({ ...updated, assignees, labels });
      setEditingDescription(false);
    } catch (err) {
      console.error('Failed to update description:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card-detail-modal-unified" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="card-detail-header">
          <div className="card-detail-header-left">
            <span className="card-designator" style={{ color: swimlane.color }}>
              {swimlane.designator}{card.gitea_issue_id}
            </span>
            <span className={`card-issue-type issue-type-${card.issue_type || 'task'}`}>{card.issue_type || 'task'}</span>
            <span className={`card-state ${card.state}`}>{card.state}</span>
          </div>
          <div className="card-detail-actions">
            {editing ? (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={handleDelete}>Delete</button>
              </>
            )}
            <button className="btn btn-sm modal-close-btn" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="card-detail-unified-layout">
          {/* Main Content Area */}
          <div className="card-detail-main">
            {/* Title and Meta */}
            {editing ? (
              <div className="card-detail-edit">
                <div className="form-group">
                  <label>Title</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Issue Type</label>
                    <select value={issueType} onChange={(e) => setIssueType(e.target.value as any)}>
                      <option value="epic">Epic</option>
                      <option value="story">Story</option>
                      <option value="task">Task</option>
                      <option value="subtask">Subtask</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Priority</label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                      <option value="highest">Highest</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                      <option value="lowest">Lowest</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Story Points</label>
                    <input type="number" value={storyPoints} onChange={(e) => setStoryPoints(e.target.value)} min="0" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Due Date</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Time Estimate (minutes)</label>
                    <input type="number" value={timeEstimate} onChange={(e) => setTimeEstimate(e.target.value)} min="0" placeholder="e.g., 120" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <h2 className="card-detail-title">{card.title}</h2>
                <div className="card-detail-meta">
                  <span className={`card-priority priority-${card.priority}`}>{card.priority}</span>
                  {card.story_points !== null && <span className="card-points">{card.story_points} pts</span>}
                  {card.due_date && (
                    <span className={`card-due ${isOverdue(card.due_date) ? 'overdue' : ''}`}>
                      <Calendar size={14} /> {new Date(card.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Time Tracking Summary - Compact */}
            {!editing && (
              <div className="time-tracking-compact">
                <div className="time-tracking-header">
                  <Clock size={14} />
                  <span>Time Tracking</span>
                </div>
                <div className="time-tracking-stats">
                  <span className="time-logged">{formatTimeSpent(totalTimeLogged)} logged</span>
                  {card.time_estimate && (
                    <span className="time-estimate">/ {formatTimeSpent(card.time_estimate)} estimated</span>
                  )}
                </div>
                {card.time_estimate && card.time_estimate > 0 && (
                  <div className="time-progress-mini">
                    <div
                      className={`time-progress-bar ${totalTimeLogged > card.time_estimate ? 'over' : ''}`}
                      style={{ width: `${Math.min((totalTimeLogged / card.time_estimate) * 100, 100)}%` }}
                    />
                  </div>
                )}
                <div className="time-tracking-actions">
                  <input
                    type="number"
                    className="time-input-mini"
                    value={newWorkLogMinutes}
                    onChange={(e) => setNewWorkLogMinutes(e.target.value)}
                    placeholder="mins"
                    min="1"
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={(e) => { e.preventDefault(); handleAddWorkLog(e as any); }}
                    disabled={addingWorkLog || !newWorkLogMinutes}
                  >
                    {addingWorkLog ? '...' : 'Log'}
                  </button>
                </div>
              </div>
            )}

            {/* Description Section */}
            {!editing && (
              <div className="card-description-section">
                <div className="section-header">
                  <h3>Description</h3>
                  {!editingDescription && (
                    <button className="btn btn-sm" onClick={() => setEditingDescription(true)}>
                      {description ? 'Edit' : 'Add'}
                    </button>
                  )}
                </div>
                {editingDescription ? (
                  <div className="description-edit">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="Add a description..."
                      autoFocus
                    />
                    <div className="description-actions">
                      <button className="btn btn-primary btn-sm" onClick={handleSaveDescription} disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button className="btn btn-sm" onClick={() => { setEditingDescription(false); setDescription(card.description); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={`description-text ${!description ? 'empty' : ''}`}>
                    {description || 'No description provided. Click Add to write one.'}
                  </p>
                )}
              </div>
            )}

            {/* Custom Fields */}
            {!editing && customFields.length > 0 && (
              <div className="custom-fields-compact">
                <h3>Custom Fields</h3>
                <div className="custom-fields-grid">
                  {customFields.map((field: any) => (
                    <div key={field.id} className="custom-field-inline">
                      <label>{field.name}</label>
                      {field.field_type === 'text' && (
                        <input
                          type="text"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                          onBlur={(e) => handleCustomFieldSave(field.id, e.target.value)}
                          placeholder={`Enter ${field.name}`}
                        />
                      )}
                      {field.field_type === 'number' && (
                        <input
                          type="number"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                          onBlur={(e) => handleCustomFieldSave(field.id, e.target.value)}
                        />
                      )}
                      {field.field_type === 'date' && (
                        <input
                          type="date"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => { handleCustomFieldChange(field.id, e.target.value); handleCustomFieldSave(field.id, e.target.value); }}
                        />
                      )}
                      {field.field_type === 'select' && (
                        <select
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => { handleCustomFieldChange(field.id, e.target.value); handleCustomFieldSave(field.id, e.target.value); }}
                        >
                          <option value="">Select...</option>
                          {field.options && JSON.parse(field.options).map((opt: string) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                      {field.field_type === 'checkbox' && (
                        <input
                          type="checkbox"
                          checked={customFieldValues[field.id] === 'true'}
                          onChange={(e) => { const v = e.target.checked ? 'true' : 'false'; handleCustomFieldChange(field.id, v); handleCustomFieldSave(field.id, v); }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conversations Section - Main Area for more vertical room */}
            {!editing && (
              <div className="conversations-section conversations-main">
                <h3>Conversations</h3>
                <div className="comments-container">
                  {loadingComments ? (
                    <div className="loading-inline">Loading...</div>
                  ) : comments.length === 0 ? (
                    <p className="empty-text">No comments yet</p>
                  ) : (
                    <div className="comments-list-compact">
                      {comments.map((comment) => (
                        <div key={comment.id} className="comment-item-compact">
                          <div className="comment-header-compact">
                            {comment.user?.avatar_url ? (
                              <img src={comment.user.avatar_url} alt={comment.user.display_name} className="comment-avatar-small" />
                            ) : (
                              <div className="comment-avatar-small placeholder"><UserIcon size={12} /></div>
                            )}
                            <span className="comment-author">{comment.user?.display_name || 'Unknown'}</span>
                            <span className="comment-time">{formatDate(comment.created_at)}</span>
                          </div>
                          <p className="comment-body-compact">{renderCommentBody(comment.body)}</p>
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div className="comment-attachments">
                              {comment.attachments.map((att: any) => (
                                att.mime_type.startsWith('image/') ? (
                                  <img key={att.id} src={`/api/attachments/${att.id}`} alt={att.filename} className="comment-attachment-thumb" onClick={() => setViewingImage(`/api/attachments/${att.id}`)} style={{ cursor: 'pointer' }} />
                                ) : (
                                  <a key={att.id} href={`/api/attachments/${att.id}`} download={att.filename}>
                                    <span className="comment-attachment-file">📎 {att.filename}</span>
                                  </a>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <form className="comment-form-compact" onSubmit={handlePostComment}>
                  <div className="comment-input-wrapper">
                    <textarea
                      value={newComment}
                      onChange={handleCommentChange}
                      onKeyDown={handleCommentKeyDown}
                      onPaste={handleCommentPaste}
                      placeholder="Write a comment... (use @ to mention, paste images)"
                      rows={3}
                    />
                    {pendingImages.length > 0 && (
                      <div className="pending-images">
                        {pendingImages.map((img, index) => (
                          <div key={index} className="pending-image-item">
                            <img src={URL.createObjectURL(img)} alt={`Pending ${index + 1}`} onClick={() => setViewingImage(URL.createObjectURL(img))} style={{ cursor: 'pointer' }} />
                            <button type="button" className="remove-pending-image" onClick={() => setPendingImages(pendingImages.filter((_, i) => i !== index))}><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showMentionDropdown && filteredMentionUsers.length > 0 && (
                      <div className="mention-dropdown">
                        {filteredMentionUsers.slice(0, 5).map((user, index) => (
                          <div
                            key={user.id}
                            className={`mention-item ${index === mentionIndex ? 'selected' : ''}`}
                            onClick={() => handleSelectMention(user)}
                            onMouseEnter={() => setMentionIndex(index)}
                          >
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt={user.display_name} className="mention-avatar" />
                            ) : (
                              <div className="mention-avatar placeholder"><UserIcon size={12} /></div>
                            )}
                            <span className="mention-name">{user.display_name}</span>
                            <span className="mention-email">{user.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={postingComment || (!newComment.trim() && pendingImages.length === 0)}>
                    {postingComment ? '...' : 'Post'}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Right Sidebar - Conversations + Metadata */}
          <div className="card-detail-right">
            {/* Metadata */}
            <div className="metadata-section">
              <div className="sidebar-section">
                <label>Labels</label>
                <div className="labels-list">
                  {boardLabels.length > 0 ? (
                    boardLabels.map((label) => {
                      const isAssigned = labels.some((l) => l.id === label.id);
                      return (
                        <button
                          key={label.id}
                          className={`label-toggle ${isAssigned ? 'assigned' : ''}`}
                          onClick={() => handleToggleLabel(label)}
                        >
                          <span className="label-color" style={{ backgroundColor: label.color }} />
                          <span className="label-name">{label.name}</span>
                          {isAssigned && <Check size={12} />}
                        </button>
                      );
                    })
                  ) : (
                    <p className="empty-text">No labels</p>
                  )}
                </div>
              </div>
              <div className="sidebar-section">
                <label>Assignees</label>
                <div className="assignees-list">
                  {assignees.map((assignee) => (
                    <div key={assignee.id} className="assignee-item">
                      <div className="assignee-avatar">
                        {assignee.avatar_url ? <img src={assignee.avatar_url} alt={assignee.display_name} /> : <UserIcon size={14} />}
                      </div>
                      <span className="assignee-name">{assignee.display_name}</span>
                      <button className="remove-assignee" onClick={() => handleRemoveAssignee(assignee.id)}><X size={12} /></button>
                    </div>
                  ))}
                  {unassignedUsers.length > 0 && (
                    <select className="add-assignee-select" value="" onChange={(e) => { if (e.target.value) handleAddAssignee(parseInt(e.target.value)); }}>
                      <option value="">Add assignee...</option>
                      {unassignedUsers.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="sidebar-section">
                <label>Sprint</label>
                <select value={card.sprint_id || ''} onChange={(e) => handleSprintChange(e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">Backlog</option>
                  {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} {s.status === 'active' ? '(active)' : ''}</option>)}
                </select>
              </div>
            </div>

            {/* Attachments - Sidebar */}
            <div className="sidebar-section attachments-sidebar">
              <div className="section-header">
                <label>Attachments ({attachments.length})</label>
                <label className="btn btn-xs">
                  {uploadingAttachment ? '...' : '+'}
                  <input type="file" onChange={handleUploadAttachment} disabled={uploadingAttachment} style={{ display: 'none' }} />
                </label>
              </div>
              {loadingAttachments ? (
                <div className="loading-inline">Loading...</div>
              ) : attachments.length === 0 ? (
                <p className="empty-text">No attachments</p>
              ) : (
                <div className="attachments-list-sidebar">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attachment-item-sidebar">
                      {attachment.mime_type.startsWith('image/') ? (
                        <img src={`/api/attachments/${attachment.id}`} alt={attachment.filename} className="attachment-thumb-small" onClick={() => setViewingImage(`/api/attachments/${attachment.id}`)} style={{ cursor: 'pointer' }} />
                      ) : (
                        <span className="attachment-icon-tiny">📎</span>
                      )}
                      <a href={`/api/attachments/${attachment.id}`} download={attachment.filename} className="attachment-name-small">{attachment.filename}</a>
                      <button className="attachment-delete-tiny" onClick={() => handleDeleteAttachment(attachment.id)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div className="image-viewer-overlay" onClick={() => setViewingImage(null)}>
          <button className="image-viewer-close" onClick={() => setViewingImage(null)}><X size={24} /></button>
          <img src={viewingImage} alt="Full size" className="image-viewer-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
