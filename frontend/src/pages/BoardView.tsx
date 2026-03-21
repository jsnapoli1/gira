import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { CardDetailModal } from '../components/CardDetailModal';
import { DroppableColumn } from '../components/DroppableColumn';
import { BacklogView } from '../components/BacklogView';
import { AddSwimlaneModal } from '../components/AddSwimlaneModal';
import { AddCardModal } from '../components/AddCardModal';
import { boards as boardsApi, cards as cardsApi, sprints as sprintsApi, gitea, users as usersApi, imports } from '../api/client';
import { Board, Card, Sprint, Repository, User, Label, SavedFilter } from '../types';
import { useBoardSSE } from '../hooks/useBoardSSE';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
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
import { Plus, Settings, ChevronLeft, ChevronRight, ChevronDown, Clock, Filter, X, Search, AlertTriangle, Save, BookmarkCheck, Trash2, Share2, CheckSquare, Download, HelpCircle, Upload } from 'lucide-react';

export function BoardView() {
  const { boardId } = useParams<{ boardId: string }>();
  const { showToast } = useToast();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [viewMode, setViewMode] = useState<'board' | 'backlog' | 'all'>('board');
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set());
  const [bulkActionDropdown, setBulkActionDropdown] = useState<string | null>(null);

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSavedFilters, setShowSavedFilters] = useState(false);
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [saveFilterShared, setSaveFilterShared] = useState(false);
  const savedFiltersRef = useRef<HTMLDivElement>(null);

  // Collapsed swimlanes
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Set<number>>(new Set());
  const toggleSwimlane = (id: number) => {
    setCollapsedSwimlanes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Jira import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProjectKeys, setImportProjectKeys] = useState<string[]>([]);
  const [importSelectedProject, setImportSelectedProject] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Initialize filter state from URL search params
  const initializedRef = useRef(false);
  const [filterAssignee, setFilterAssignee] = useState<number | null>(() => {
    const v = searchParams.get('assignee');
    return v ? parseInt(v) : null;
  });
  const [filterLabel, setFilterLabel] = useState<number | null>(() => {
    const v = searchParams.get('label');
    return v ? parseInt(v) : null;
  });
  const [filterSwimlane, setFilterSwimlane] = useState<number | null>(() => {
    const v = searchParams.get('swimlane');
    return v ? parseInt(v) : null;
  });
  const [filterPriority, setFilterPriority] = useState<string | null>(() => {
    return searchParams.get('priority') || null;
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    return searchParams.get('q') || '';
  });
  const [filterOverdue, setFilterOverdue] = useState(() => {
    return searchParams.get('overdue') === '1';
  });

  // Sync filter state to URL search params
  useEffect(() => {
    // Skip the initial render to avoid replacing URL params we just read
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const params = new URLSearchParams();
    if (filterAssignee) params.set('assignee', String(filterAssignee));
    if (filterLabel) params.set('label', String(filterLabel));
    if (filterSwimlane) params.set('swimlane', String(filterSwimlane));
    if (filterPriority) params.set('priority', filterPriority);
    if (filterOverdue) params.set('overdue', '1');
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    setSearchParams(params, { replace: true });
  }, [filterAssignee, filterLabel, filterSwimlane, filterPriority, filterOverdue, searchQuery]);

  // Close saved filters dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (savedFiltersRef.current && !savedFiltersRef.current.contains(e.target as Node)) {
        setShowSavedFilters(false);
      }
    }
    if (showSavedFilters) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSavedFilters]);

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
    // Update selectedCard if the moved card is currently open in the modal
    setSelectedCard((prev) =>
      prev?.id === cardId ? { ...prev, column_id: columnId, state } : prev
    );
  }, []);

  const handleCardDeleted = useCallback((cardId: number) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    // Close modal if the deleted card was selected
    setSelectedCard((prev) => (prev?.id === cardId ? null : prev));
  }, []);

  // When an SSE notification event arrives, dispatch a custom DOM event so Layout can refresh
  const handleNotification = useCallback(() => {
    window.dispatchEvent(new CustomEvent('zira:notification'));
  }, []);

  // Connect to SSE for real-time board updates
  useBoardSSE({
    boardId: boardId ? parseInt(boardId) : 0,
    onCardCreated: handleCardCreated,
    onCardUpdated: handleCardUpdated,
    onCardMoved: handleCardMoved,
    onCardDeleted: handleCardDeleted,
    onNotification: handleNotification,
    enabled: !!boardId && !loading,
  });

  useEffect(() => {
    loadBoard();
  }, [boardId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case '?':
          setShowShortcutsHelp(prev => !prev);
          break;
        case 'n':
          if (board?.swimlanes?.[0] && board?.columns?.[0]) {
            setShowAddCard({ swimlaneId: board.swimlanes[0].id, columnId: board.columns[0].id });
          }
          break;
        case 'b':
          setViewMode(prev => prev === 'board' ? 'backlog' : prev === 'backlog' ? 'all' : 'board');
          break;
        case '/':
          e.preventDefault();
          document.querySelector<HTMLInputElement>('.search-input input')?.focus();
          break;
        case 'Escape':
          if (showShortcutsHelp) setShowShortcutsHelp(false);
          else if (selectedCard) setSelectedCard(null);
          else if (selectionMode) { setSelectionMode(false); setSelectedCards(new Set()); }
          break;
        case 's':
          if (!selectedCard) {
            setSelectionMode(prev => !prev);
            if (selectionMode) setSelectedCards(new Set());
          }
          break;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [board, selectedCard, selectionMode, showShortcutsHelp]);

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

      // Load saved filters
      boardsApi.getSavedFilters(parseInt(boardId)).then(setSavedFilters).catch(() => setSavedFilters([]));

      // Find current sprint (active takes priority, then most recent planning)
      const active = sprintsData?.find((s: Sprint) => s.status === 'active');
      const planning = sprintsData?.find((s: Sprint) => s.status === 'planning');
      setActiveSprint(active || planning || null);
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

  // Serialize current filters to JSON
  const serializeFilters = useCallback(() => {
    const obj: Record<string, string | number | boolean> = {};
    if (filterAssignee) obj.assignee = filterAssignee;
    if (filterLabel) obj.label = filterLabel;
    if (filterSwimlane) obj.swimlane = filterSwimlane;
    if (filterPriority) obj.priority = filterPriority;
    if (filterOverdue) obj.overdue = true;
    if (searchQuery.trim()) obj.q = searchQuery.trim();
    return JSON.stringify(obj);
  }, [filterAssignee, filterLabel, filterSwimlane, filterPriority, filterOverdue, searchQuery]);

  // Apply a saved filter
  const applySavedFilter = useCallback((filter: SavedFilter) => {
    try {
      const parsed = JSON.parse(filter.filter_json);
      setFilterAssignee(parsed.assignee ? Number(parsed.assignee) : null);
      setFilterLabel(parsed.label ? Number(parsed.label) : null);
      setFilterSwimlane(parsed.swimlane ? Number(parsed.swimlane) : null);
      setFilterPriority(parsed.priority || null);
      setFilterOverdue(!!parsed.overdue);
      setSearchQuery(parsed.q || '');
      setShowSavedFilters(false);
    } catch {
      showToast('Failed to apply filter', 'error');
    }
  }, [showToast]);

  // Save current filter
  const handleSaveFilter = useCallback(async () => {
    if (!boardId || !saveFilterName.trim()) return;
    try {
      const filterJson = serializeFilters();
      const created = await boardsApi.createSavedFilter(parseInt(boardId), saveFilterName.trim(), filterJson, saveFilterShared);
      setSavedFilters((prev) => [...prev, created]);
      setShowSaveFilterModal(false);
      setSaveFilterName('');
      setSaveFilterShared(false);
      showToast('Filter saved', 'success');
    } catch {
      showToast('Failed to save filter', 'error');
    }
  }, [boardId, saveFilterName, saveFilterShared, serializeFilters, showToast]);

  // Delete a saved filter
  const handleDeleteFilter = useCallback(async (filterId: number) => {
    if (!boardId) return;
    try {
      await boardsApi.deleteSavedFilter(parseInt(boardId), filterId);
      setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
      showToast('Filter deleted', 'success');
    } catch {
      showToast('Failed to delete filter', 'error');
    }
  }, [boardId, showToast]);

  // Bulk selection handlers
  const handleSelectCard = useCallback((cardId: number) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedCards(new Set());
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        // Turning off - clear selection
        setSelectedCards(new Set());
        setBulkActionDropdown(null);
      }
      return !prev;
    });
  }, []);

  const handleBulkMove = useCallback(async (columnId: number, state: string) => {
    const cardIds = Array.from(selectedCards);
    try {
      await cardsApi.bulkMove(cardIds, columnId, state);
      setCards((prev) => prev.map((c) => cardIds.includes(c.id) ? { ...c, column_id: columnId, state } : c));
      showToast(`Moved ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}`, 'success');
      setSelectedCards(new Set());
      setBulkActionDropdown(null);
    } catch {
      showToast('Failed to move cards', 'error');
    }
  }, [selectedCards, showToast]);

  const handleBulkAssignSprint = useCallback(async (sprintId: number | null) => {
    const cardIds = Array.from(selectedCards);
    try {
      await cardsApi.bulkAssignSprint(cardIds, sprintId);
      setCards((prev) => prev.map((c) => cardIds.includes(c.id) ? { ...c, sprint_id: sprintId } : c));
      showToast(`Updated sprint for ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}`, 'success');
      setSelectedCards(new Set());
      setBulkActionDropdown(null);
    } catch {
      showToast('Failed to assign sprint', 'error');
    }
  }, [selectedCards, showToast]);

  const handleBulkSetPriority = useCallback(async (priority: string) => {
    const cardIds = Array.from(selectedCards);
    try {
      await cardsApi.bulkUpdate(cardIds, { priority });
      setCards((prev) => prev.map((c) => cardIds.includes(c.id) ? { ...c, priority: priority as Card['priority'] } : c));
      showToast(`Updated priority for ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}`, 'success');
      setSelectedCards(new Set());
      setBulkActionDropdown(null);
    } catch {
      showToast('Failed to update priority', 'error');
    }
  }, [selectedCards, showToast]);

  const handleBulkDelete = useCallback(async () => {
    const cardIds = Array.from(selectedCards);
    if (!window.confirm(`Delete ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await cardsApi.bulkDelete(cardIds);
      setCards((prev) => prev.filter((c) => !cardIds.includes(c.id)));
      showToast(`Deleted ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}`, 'success');
      setSelectedCards(new Set());
      setBulkActionDropdown(null);
    } catch {
      showToast('Failed to delete cards', 'error');
    }
  }, [selectedCards, showToast]);

  const hasActiveFilters = !!(filterAssignee || filterLabel || filterSwimlane || filterPriority || filterOverdue || searchQuery);

  // Count overdue cards
  const overdueCount = useMemo(() => {
    const now = new Date();
    return cards.filter((c) => c.due_date && new Date(c.due_date) < now).length;
  }, [cards]);

  // Closed column IDs (state === 'closed')
  const closedColumnIds = useMemo(() => {
    if (!board) return new Set<number>();
    return new Set((board.columns || []).filter((c) => c.state === 'closed').map((c) => c.id));
  }, [board]);

  // Filter cards by assignee, label, swimlane, priority, overdue, and search query
  const filteredCards = useMemo(() => {
    let filtered = cards;

    // Sprint-based filtering for board view (not applied in "all" mode)
    if (viewMode === 'board') {
      if (activeSprint) {
        // Active sprint: only show cards assigned to this sprint
        filtered = filtered.filter((c) => c.sprint_id === activeSprint.id);
      } else {
        // No active sprint: board is empty — unsprinted cards live in backlog,
        // done cards are archived. Nothing on the board until a sprint starts.
        filtered = [];
      }
    }

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
    if (filterOverdue) {
      const now = new Date();
      filtered = filtered.filter((c) => c.due_date && new Date(c.due_date) < now);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((c) =>
        c.title.toLowerCase().includes(query) ||
        c.description?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [cards, filterAssignee, filterLabel, filterSwimlane, filterPriority, filterOverdue, searchQuery, activeSprint, closedColumnIds, viewMode]);

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
          <div className="board-header-top">
            <div className="board-header-left">
              <Link to="/boards" className="back-link">
                <ChevronLeft size={20} />
              </Link>
              <h1>{board.name}</h1>
              {activeSprint && (
                <span className={`active-sprint-badge ${activeSprint.status === 'active' ? 'sprint-active' : 'sprint-planning'}`}>
                  <Clock size={14} />
                  {activeSprint.name}
                  <span className="sprint-status-label">
                    {activeSprint.status === 'active' ? 'Active' : 'Planning'}
                  </span>
                </span>
              )}
              {overdueCount > 0 && (
                <span className="overdue-badge" title={`${overdueCount} overdue card${overdueCount === 1 ? '' : 's'}`}>
                  <AlertTriangle size={14} />
                  {overdueCount} overdue
                </span>
              )}
            </div>
            <div className="board-header-actions">
              <button
                className={`selection-mode-toggle ${selectionMode ? 'active' : ''}`}
                onClick={handleToggleSelectionMode}
                title={selectionMode ? 'Exit selection mode' : 'Select cards'}
              >
                <CheckSquare size={16} />
                <span>{selectionMode ? 'Cancel' : 'Select'}</span>
              </button>
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
                <button
                  className={`view-btn ${viewMode === 'all' ? 'active' : ''}`}
                  onClick={() => setViewMode('all')}
                >
                  All Cards
                </button>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => boardsApi.exportCards(parseInt(boardId!))} title="Export to CSV">
                <Download size={14} />
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setShowImportModal(true); setImportFile(null); setImportProjectKeys([]); setImportSelectedProject(''); setImportResult(null); }} title="Import from Jira CSV">
                <Upload size={14} />
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowShortcutsHelp(true)} title="Keyboard shortcuts (?)">
                <HelpCircle size={14} />
              </button>
              <button className="btn" onClick={() => setShowAddSwimlane(true)}>
                <Plus size={18} />
                <span>Add Swimlane</span>
              </button>
              <Link to={`/boards/${board.id}/settings`} className="btn">
                <Settings size={18} />
              </Link>
            </div>
          </div>
          <div className="board-header-filters" aria-label="Filter controls">
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
            <button
              className={`filter-overdue ${filterOverdue ? 'active' : ''}`}
              onClick={() => setFilterOverdue(!filterOverdue)}
              title="Show only overdue cards"
            >
              <AlertTriangle size={14} />
              Overdue
            </button>
            {hasActiveFilters && (
              <button className="clear-filter" onClick={() => { setFilterAssignee(null); setFilterLabel(null); setFilterSwimlane(null); setFilterPriority(null); setFilterOverdue(false); setSearchQuery(''); }} title="Clear filters">
                <X size={14} />
              </button>
            )}
            {hasActiveFilters && (
              <button className="save-filter-btn" onClick={() => setShowSaveFilterModal(true)} title="Save current filters">
                <Save size={14} />
              </button>
            )}
            <div className="saved-filters-container" ref={savedFiltersRef}>
              <button
                className={`saved-filters-btn ${showSavedFilters ? 'active' : ''}`}
                onClick={() => setShowSavedFilters(!showSavedFilters)}
                title="Saved filters"
              >
                <BookmarkCheck size={14} />
                <span>Saved</span>
                {savedFilters.length > 0 && (
                  <span className="saved-filters-count">{savedFilters.length}</span>
                )}
              </button>
              {showSavedFilters && (
                <div className="saved-filters-dropdown">
                  {savedFilters.length === 0 ? (
                    <div className="saved-filters-empty">No saved filters</div>
                  ) : (
                    savedFilters.map((sf) => (
                      <div key={sf.id} className="saved-filter-item">
                        <button className="saved-filter-apply" onClick={() => applySavedFilter(sf)}>
                          <span className="saved-filter-name">{sf.name}</span>
                          {sf.is_shared && (
                            <span className="saved-filter-shared" title="Shared filter">
                              <Share2 size={11} />
                            </span>
                          )}
                        </button>
                        {currentUser && sf.owner_id === currentUser.id && (
                          <button
                            className="saved-filter-delete"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFilter(sf.id); }}
                            title="Delete filter"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Save Filter Modal */}
        {showSaveFilterModal && (
          <div className="save-filter-modal-overlay" onClick={() => setShowSaveFilterModal(false)}>
            <div className="save-filter-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Save Filter</h3>
              <input
                type="text"
                className="save-filter-input"
                placeholder="Filter name"
                value={saveFilterName}
                onChange={(e) => setSaveFilterName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveFilter(); }}
              />
              <label className="save-filter-shared-label">
                <input
                  type="checkbox"
                  checked={saveFilterShared}
                  onChange={(e) => setSaveFilterShared(e.target.checked)}
                />
                Share with team
              </label>
              <div className="save-filter-actions">
                <button className="btn btn-secondary" onClick={() => setShowSaveFilterModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveFilter} disabled={!saveFilterName.trim()}>Save</button>
              </div>
            </div>
          </div>
        )}

        {(viewMode === 'board' || viewMode === 'all') ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="board-content" role="main">
              {viewMode === 'board' && !activeSprint && (board.swimlanes || []).length > 0 ? (
                <div className="empty-swimlanes">
                  <p>No sprint found. Create a sprint in the <strong>Backlog</strong> view and assign cards to it.</p>
                  <button className="btn btn-primary" onClick={() => setViewMode('backlog')}>
                    Go to Backlog
                  </button>
                </div>
              ) : (board.swimlanes || []).length === 0 ? (
                <div className="empty-swimlanes">
                  <p>Add a swimlane to start tracking issues from a repository</p>
                  <button className="btn btn-primary" onClick={() => setShowAddSwimlane(true)}>
                    <Plus size={18} />
                    <span>Add Swimlane</span>
                  </button>
                </div>
              ) : (
                (board.swimlanes || []).map((swimlane) => {
                  const isCollapsed = collapsedSwimlanes.has(swimlane.id);
                  const swimlaneCardCount = Object.values(cardsBySwimlanAndColumn[swimlane.id] || {}).reduce((sum, arr) => sum + arr.length, 0);
                  return (
                  <div key={swimlane.id} className={`swimlane ${isCollapsed ? 'swimlane-collapsed' : ''}`}>
                    <div className="swimlane-header" style={{ borderLeftColor: swimlane.color }} onClick={() => toggleSwimlane(swimlane.id)}>
                      <button className="swimlane-toggle" type="button">
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <h2>{swimlane.name}</h2>
                      <span className="swimlane-repo">
                        {swimlane.repo_owner}/{swimlane.repo_name}
                      </span>
                      {isCollapsed && <span className="swimlane-card-count">{swimlaneCardCount} cards</span>}
                    </div>
                    {!isCollapsed && (
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
                          selectionMode={selectionMode}
                          selectedCards={selectedCards}
                          onSelectCard={handleSelectCard}
                        />
                      ))}
                    </div>
                    )}
                  </div>
                  );
                })
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

        {/* Bulk Action Bar */}
        {selectionMode && selectedCards.size > 0 && (
          <div className="bulk-action-bar">
            <span className="bulk-action-count">{selectedCards.size} card{selectedCards.size === 1 ? '' : 's'} selected</span>
            <div className="bulk-action-buttons">
              <div className="bulk-action-dropdown-wrapper">
                <button className="btn btn-sm" onClick={() => setBulkActionDropdown(bulkActionDropdown === 'move' ? null : 'move')}>
                  Move to...
                </button>
                {bulkActionDropdown === 'move' && (
                  <div className="bulk-action-dropdown">
                    {(board.columns || []).map((col) => (
                      <button key={col.id} className="bulk-action-dropdown-item" onClick={() => handleBulkMove(col.id, col.state)}>
                        {col.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="bulk-action-dropdown-wrapper">
                <button className="btn btn-sm" onClick={() => setBulkActionDropdown(bulkActionDropdown === 'sprint' ? null : 'sprint')}>
                  Assign Sprint...
                </button>
                {bulkActionDropdown === 'sprint' && (
                  <div className="bulk-action-dropdown">
                    <button className="bulk-action-dropdown-item" onClick={() => handleBulkAssignSprint(null)}>
                      Backlog (no sprint)
                    </button>
                    {sprints.map((sp) => (
                      <button key={sp.id} className="bulk-action-dropdown-item" onClick={() => handleBulkAssignSprint(sp.id)}>
                        {sp.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="bulk-action-dropdown-wrapper">
                <button className="btn btn-sm" onClick={() => setBulkActionDropdown(bulkActionDropdown === 'priority' ? null : 'priority')}>
                  Set Priority...
                </button>
                {bulkActionDropdown === 'priority' && (
                  <div className="bulk-action-dropdown">
                    {['highest', 'high', 'medium', 'low', 'lowest'].map((p) => (
                      <button key={p} className="bulk-action-dropdown-item" onClick={() => handleBulkSetPriority(p)}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>
                <Trash2 size={14} />
                Delete
              </button>
            </div>
            <button className="btn btn-sm" onClick={handleDeselectAll}>
              Deselect All
            </button>
          </div>
        )}

        {/* Card Detail Modal */}
        {selectedCard && (
          <CardDetailModal
            card={selectedCard}
            swimlane={board.swimlanes.find((s) => s.id === selectedCard.swimlane_id)!}
            columns={board.columns}
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
      {showImportModal && (
        <div className="import-modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="import-modal-header">
              <h3>Import from Jira CSV</h3>
              <button onClick={() => setShowImportModal(false)}><X size={16} /></button>
            </div>
            <div className="import-modal-body">
              <label className="import-file-label">
                CSV File
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setImportFile(f);
                    setImportResult(null);
                    if (f) {
                      // Use server-side preview to correctly parse CSV (handles quoted multi-line fields)
                      imports.previewJira(f).then((data) => {
                        const keys = (data.projects || []).map((p: { key: string }) => p.key).sort();
                        setImportProjectKeys(keys);
                      }).catch(() => {
                        setImportProjectKeys([]);
                      });
                    } else {
                      setImportProjectKeys([]);
                    }
                  }}
                />
              </label>
              {importProjectKeys.length > 0 && (
                <label className="import-file-label">
                  Project
                  <select
                    value={importSelectedProject}
                    onChange={(e) => setImportSelectedProject(e.target.value)}
                    className="import-select"
                  >
                    <option value="">All Projects</option>
                    {importProjectKeys.map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
              )}
              {importResult && (
                <div className="import-result">
                  <p><strong>{importResult.imported}</strong> cards imported</p>
                  {importResult.sprints_created > 0 && <p>{importResult.sprints_created} sprints created</p>}
                  {importResult.labels_created > 0 && <p>{importResult.labels_created} labels created</p>}
                  {importResult.errors?.length > 0 && (
                    <details>
                      <summary>{importResult.errors.length} error(s)</summary>
                      <ul className="import-errors">
                        {importResult.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
            <div className="import-modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>
                {importResult ? 'Close' : 'Cancel'}
              </button>
              {!importResult && (
                <button
                  className="btn btn-primary"
                  disabled={!importFile || importLoading}
                  onClick={async () => {
                    if (!importFile) return;
                    setImportLoading(true);
                    try {
                      const result = await boardsApi.importJira(parseInt(boardId!), importFile, importSelectedProject);
                      setImportResult(result);
                      if (result.imported > 0) {
                        loadBoard();
                      }
                    } catch (err: any) {
                      showToast(err.message || 'Import failed', 'error');
                    } finally {
                      setImportLoading(false);
                    }
                  }}
                >
                  {importLoading ? 'Importing...' : 'Import'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showShortcutsHelp && (
        <div className="shortcuts-modal-overlay" onClick={() => setShowShortcutsHelp(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-header">
              <h3>Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcutsHelp(false)}><X size={16} /></button>
            </div>
            <table className="shortcuts-table">
              <tbody>
                <tr><td><kbd>?</kbd></td><td>Show/hide shortcuts</td></tr>
                <tr><td><kbd>n</kbd></td><td>New card</td></tr>
                <tr><td><kbd>b</kbd></td><td>Toggle board/backlog</td></tr>
                <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
                <tr><td><kbd>s</kbd></td><td>Toggle selection mode</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close modal / deselect</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}


