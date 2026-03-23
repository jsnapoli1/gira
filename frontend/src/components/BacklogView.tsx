import React, { useState } from 'react';
import { cards as cardsApi, sprints as sprintsApi, boards as boardsApi } from '../api/client';
import { Card, Column, Swimlane, Sprint } from '../types';
import { useToast } from '../components/Toast';
import { Plus, Calendar, Play, CheckCircle, ArrowRight, ChevronDown, ChevronRight, GripVertical, Pencil, Trash2 } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Sortable backlog card
function SortableBacklogCard({
  card,
  designator,
  priorityColor,
  onClick,
  actionButton,
}: {
  card: Card;
  designator: string;
  priorityColor: string;
  onClick: () => void;
  actionButton?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `backlog-${card.id}`,
    data: { card },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="backlog-card" onClick={onClick}>
      <div className="backlog-card-drag" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </div>
      <div className="backlog-card-priority" style={{ backgroundColor: priorityColor }} />
      <span className="card-designator">{designator}{card.gitea_issue_id}</span>
      <span className="card-title">{card.title}</span>
      {card.state && card.state !== 'open' && (
        <span className={`card-state ${card.state}`}>{card.state}</span>
      )}
      {card.story_points !== null && <span className="card-points">{card.story_points}</span>}
      {actionButton}
    </div>
  );
}

// Droppable zone for sprint
function SprintDropZone({ children, id }: { children: React.ReactNode; id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`backlog-sprint-cards ${isOver ? 'drop-target-active' : ''}`}>
      {children}
    </div>
  );
}

export interface BacklogViewProps {
  boardId: number;
  cards: Card[];
  sprints: Sprint[];
  swimlanes: Swimlane[];
  columns: Column[];
  onCardClick: (card: Card) => void;
  onRefresh: () => void;
  onCardsChange: (cards: Card[]) => void;
  onSprintsChange: (sprints: Sprint[]) => void;
  onSwimlanesChange: (swimlanes: Swimlane[]) => void;
}

// Sortable swimlane section
function SortableSwimlaneSection({
  swimlane,
  children,
}: {
  swimlane: Swimlane;
  children: (dragHandleProps: React.HTMLAttributes<HTMLDivElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `swimlane-${swimlane.id}`,
    data: { swimlane },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="backlog-section swimlane-backlog">
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

export function BacklogView({
  boardId,
  cards,
  sprints,
  swimlanes,
  columns,
  onCardClick,
  onRefresh,
  onCardsChange,
  onSprintsChange,
  onSwimlanesChange,
}: BacklogViewProps) {
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [newSprintGoal, setNewSprintGoal] = useState('');
  const [newSprintStartDate, setNewSprintStartDate] = useState('');
  const [newSprintEndDate, setNewSprintEndDate] = useState('');
  const [addingCardToSwimlane, setAddingCardToSwimlane] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Set<number>>(new Set());
  const [collapsedSprints, setCollapsedSprints] = useState<Set<number>>(new Set());

  // Edit sprint state
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [editSprintName, setEditSprintName] = useState('');
  const [editSprintGoal, setEditSprintGoal] = useState('');
  const [editSprintStartDate, setEditSprintStartDate] = useState('');
  const [editSprintEndDate, setEditSprintEndDate] = useState('');
  const [savingEditSprint, setSavingEditSprint] = useState(false);

  const { showToast } = useToast();

  // All non-completed sprints, active first then planning
  const visibleSprints = sprints
    .filter(s => s.status !== 'completed')
    .sort((a, b) => {
      if (a.status === 'active') return -1;
      if (b.status === 'active') return 1;
      return 0;
    });

  const activeSprint = sprints.find(s => s.status === 'active');

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
      showToast('Sprint created', 'success');
    } catch (err) {
      console.error('Failed to create sprint:', err);
      showToast('Failed to create sprint', 'error');
    }
  };

  const handleDeleteSprint = async (sprintId: number) => {
    if (!confirm('Delete this sprint? Cards will be moved back to the backlog.')) return;
    try {
      await sprintsApi.delete(sprintId);
      onSprintsChange(sprints.filter(s => s.id !== sprintId));
      onCardsChange(cards.map(c => c.sprint_id === sprintId ? { ...c, sprint_id: null } : c));
      showToast('Sprint deleted', 'success');
    } catch (err) {
      console.error('Failed to delete sprint:', err);
      showToast('Failed to delete sprint', 'error');
    }
  };

  const handleStartSprint = async (sprintId: number) => {
    onSprintsChange(sprints.map(s => s.id === sprintId ? { ...s, status: 'active' as const } : s));
    try {
      await sprintsApi.start(sprintId);
      showToast('Sprint started', 'success');
    } catch (err) {
      console.error('Failed to start sprint:', err);
      showToast('Failed to start sprint', 'error');
      onRefresh();
    }
  };

  const handleCompleteSprint = async (sprintId: number) => {
    if (!confirm('Complete this sprint? Done cards will be archived.')) return;
    try {
      await sprintsApi.complete(sprintId);
      onRefresh();
      showToast('Sprint completed', 'success');
    } catch (err) {
      console.error('Failed to complete sprint:', err);
      showToast('Failed to complete sprint', 'error');
    }
  };

  const openEditSprint = (sprint: Sprint) => {
    setEditingSprint(sprint);
    setEditSprintName(sprint.name);
    setEditSprintGoal(sprint.goal || '');
    setEditSprintStartDate(sprint.start_date ? sprint.start_date.slice(0, 10) : '');
    setEditSprintEndDate(sprint.end_date ? sprint.end_date.slice(0, 10) : '');
  };

  const handleEditSprintSave = async () => {
    if (!editingSprint) return;
    setSavingEditSprint(true);
    try {
      const updated = await sprintsApi.update(editingSprint.id, {
        name: editSprintName,
        goal: editSprintGoal,
        start_date: editSprintStartDate || undefined,
        end_date: editSprintEndDate || undefined,
      });
      onSprintsChange(sprints.map(s => s.id === updated.id ? updated : s));
      setEditingSprint(null);
      showToast('Sprint updated', 'success');
    } catch (err) {
      console.error('Failed to update sprint:', err);
      showToast('Failed to update sprint', 'error');
    } finally {
      setSavingEditSprint(false);
    }
  };

  const handleMoveToSprint = async (cardId: number, sprintId: number) => {
    onCardsChange(cards.map(c => c.id === cardId ? { ...c, sprint_id: sprintId } : c));
    try {
      await cardsApi.assignToSprint(cardId, sprintId);
    } catch (err) {
      console.error('Failed to assign card:', err);
      showToast('Failed to move card to sprint', 'error');
      onRefresh();
    }
  };

  const handleRemoveFromSprint = async (cardId: number) => {
    onCardsChange(cards.map(c => c.id === cardId ? { ...c, sprint_id: null } : c));
    try {
      await cardsApi.assignToSprint(cardId, null);
    } catch (err) {
      console.error('Failed to remove card from sprint:', err);
      showToast('Failed to remove card from sprint', 'error');
      onRefresh();
    }
  };

  const handleCreateCard = async (swimlaneId: number) => {
    if (!newCardTitle.trim()) return;
    const firstColumn = columns.find(c => c.position === 0) || columns[0];
    if (!firstColumn) return;

    try {
      const card = await cardsApi.create({
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
      onCardsChange([...cards, card]);
      showToast('Card created', 'success');
    } catch (err) {
      console.error('Failed to create card:', err);
      showToast('Failed to create card', 'error');
    }
  };

  const getSwimlaneName = (swimlaneId: number) => {
    return swimlanes.find((s) => s.id === swimlaneId)?.designator || '';
  };

  const toggleSwimlane = (id: number) => {
    setCollapsedSwimlanes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSprint = (id: number) => {
    setCollapsedSprints(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);
  const [draggedSwimlane, setDraggedSwimlane] = useState<Swimlane | null>(null);

  const closedColumnIds = new Set(columns.filter(c => c.state === 'closed').map(c => c.id));

  // Cards not assigned to any visible sprint
  const visibleSprintIds = new Set(visibleSprints.map(s => s.id));
  const backlogCards = cards.filter(c =>
    !closedColumnIds.has(c.column_id) &&
    (c.sprint_id === null || !visibleSprintIds.has(c.sprint_id))
  );

  const handleDragStart = (event: DragStartEvent) => {
    const card = (event.active.data.current as { card?: Card })?.card;
    const swimlane = (event.active.data.current as { swimlane?: Swimlane })?.swimlane;
    if (card) setDraggedCard(card);
    if (swimlane) setDraggedSwimlane(swimlane);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggedCard(null);
    setDraggedSwimlane(null);
    const { active, over } = event;
    if (!over) return;

    // Handle swimlane reorder
    if (String(active.id).startsWith('swimlane-') && String(over.id).startsWith('swimlane-')) {
      const swimlaneId = parseInt(String(active.id).replace('swimlane-', ''));
      const targetSwimlaneId = parseInt(String(over.id).replace('swimlane-', ''));
      if (swimlaneId === targetSwimlaneId) return;

      const oldIndex = swimlanes.findIndex(s => s.id === swimlaneId);
      const newIndex = swimlanes.findIndex(s => s.id === targetSwimlaneId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(swimlanes, oldIndex, newIndex);
      const updatedSwimlanes = reordered.map((s, idx) => ({ ...s, position: idx }));
      onSwimlanesChange(updatedSwimlanes);

      try {
        await boardsApi.reorderSwimlane(boardId, swimlaneId, newIndex);
      } catch {
        showToast('Failed to reorder swimlane', 'error');
        onRefresh();
      }
      return;
    }

    const cardId = parseInt(String(active.id).replace('backlog-', ''));
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // Dropped on a sprint drop zone
    if (String(over.id).startsWith('sprint-drop-zone-')) {
      const targetSprintId = parseInt(String(over.id).replace('sprint-drop-zone-', ''));
      if (card.sprint_id !== targetSprintId) {
        handleMoveToSprint(cardId, targetSprintId);
      }
      return;
    }

    // Dropped on a backlog card
    const targetCardId = parseInt(String(over.id).replace('backlog-', ''));
    const targetCard = cards.find(c => c.id === targetCardId);
    if (!targetCard || targetCard.id === card.id) return;

    // Cross-list move: backlog -> sprint
    if (card.sprint_id === null && targetCard.sprint_id !== null && visibleSprintIds.has(targetCard.sprint_id)) {
      handleMoveToSprint(cardId, targetCard.sprint_id);
      return;
    }
    // Cross-list move: sprint -> backlog
    if (card.sprint_id !== null && targetCard.sprint_id === null) {
      handleRemoveFromSprint(cardId);
      return;
    }
    // Cross-sprint move
    if (card.sprint_id !== null && targetCard.sprint_id !== null && card.sprint_id !== targetCard.sprint_id) {
      handleMoveToSprint(cardId, targetCard.sprint_id);
      return;
    }

    // Same-list reorder
    if (card.sprint_id === targetCard.sprint_id && card.swimlane_id === targetCard.swimlane_id) {
      const oldIndex = cards.findIndex(c => c.id === card.id);
      const newIndex = cards.findIndex(c => c.id === targetCard.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(cards, oldIndex, newIndex);
      const listIds = reordered
        .filter(c => c.sprint_id === card.sprint_id && c.swimlane_id === card.swimlane_id)
        .map(c => c.id);
      const newCards = reordered.map(c => {
        const posIdx = listIds.indexOf(c.id);
        if (posIdx === -1) return c;
        return { ...c, position: posIdx * 1000 };
      });
      onCardsChange(newCards);

      try {
        await cardsApi.reorder(cardId, targetCard.position);
      } catch {
        showToast('Failed to reorder card', 'error');
        onRefresh();
      }
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'highest': return '#dc2626';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      case 'lowest': return '#06b6d4';
      default: return '#94a3b8';
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
    <div className="backlog-view">
      {/* Sprint Panels */}
      {visibleSprints.length === 0 ? (
        <div className="backlog-sprint-panel">
          <div className="backlog-no-sprint">
            <p>No sprint yet. Create one to start organizing your work.</p>
            <button className="btn btn-primary" onClick={() => setShowCreateSprint(true)}>
              <Plus size={18} />
              Create Sprint
            </button>
          </div>
        </div>
      ) : (
        visibleSprints.map(sprint => {
          const sprintCards = cards.filter(c => c.sprint_id === sprint.id && !closedColumnIds.has(c.column_id));
          const isCollapsed = collapsedSprints.has(sprint.id);
          return (
            <div key={sprint.id} className="backlog-sprint-panel">
              <div className="backlog-sprint-header">
                <div className="backlog-sprint-info">
                  <h2>
                    <button className="backlog-sprint-collapse-btn" onClick={() => toggleSprint(sprint.id)}>
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {sprint.name}
                    <span className={`sprint-status-badge ${sprint.status}`}>
                      {sprint.status === 'active' ? 'Active' : 'Planning'}
                    </span>
                  </h2>
                  {(sprint.start_date || sprint.end_date) && (
                    <span className="sprint-dates">
                      <Calendar size={14} />
                      {sprint.start_date && new Date(sprint.start_date).toLocaleDateString()}
                      {sprint.start_date && sprint.end_date && ' – '}
                      {sprint.end_date && new Date(sprint.end_date).toLocaleDateString()}
                    </span>
                  )}
                  {sprint.goal && <p className="sprint-goal">{sprint.goal}</p>}
                </div>
                <div className="backlog-sprint-actions">
                  <span className="sprint-card-count">{sprintCards.length} cards</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEditSprint(sprint)}
                    title="Edit sprint"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleDeleteSprint(sprint.id)}
                    title="Delete sprint"
                  >
                    <Trash2 size={14} />
                  </button>
                  {sprint.status === 'planning' && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleStartSprint(sprint.id)} disabled={!!activeSprint}>
                      <Play size={14} />
                      Start Sprint
                    </button>
                  )}
                  {sprint.status === 'active' && (
                    <button className="btn btn-sm" onClick={() => handleCompleteSprint(sprint.id)}>
                      <CheckCircle size={14} />
                      Complete Sprint
                    </button>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <SprintDropZone id={`sprint-drop-zone-${sprint.id}`}>
                  <SortableContext items={sprintCards.map(c => `backlog-${c.id}`)} strategy={verticalListSortingStrategy}>
                    {sprintCards.length === 0 ? (
                      <div className="backlog-empty">
                        No cards in sprint. Drag cards here or use the arrow buttons below.
                      </div>
                    ) : (
                      sprintCards.map((card) => (
                        <SortableBacklogCard
                          key={card.id}
                          card={card}
                          designator={getSwimlaneName(card.swimlane_id)}
                          priorityColor={getPriorityColor(card.priority)}
                          onClick={() => onCardClick(card)}
                          actionButton={
                            <button
                              className="btn btn-ghost btn-xs backlog-remove-btn"
                              onClick={(e) => { e.stopPropagation(); handleRemoveFromSprint(card.id); }}
                              title="Remove from sprint"
                            >
                              ✕
                            </button>
                          }
                        />
                      ))
                    )}
                  </SortableContext>
                </SprintDropZone>
              )}
            </div>
          );
        })
      )}

      {/* Backlog Section */}
      <div className="backlog-items-panel">
        <div className="backlog-header">
          <h2>Backlog <span className="backlog-count">{backlogCards.length}</span></h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateSprint(true)}>
            <Plus size={14} />
            Create Sprint
          </button>
        </div>

        <SortableContext items={swimlanes.map(s => `swimlane-${s.id}`)} strategy={verticalListSortingStrategy}>
          {swimlanes.map((swimlane) => {
            const swimlaneBacklogCards = backlogCards.filter((c) => c.swimlane_id === swimlane.id);
            const isCollapsed = collapsedSwimlanes.has(swimlane.id);
            return (
              <SortableSwimlaneSection key={swimlane.id} swimlane={swimlane}>
                {(dragHandleProps) => (
                  <>
                    <div
                      className="backlog-section-header"
                      style={{ borderLeftColor: swimlane.color }}
                      onClick={() => toggleSwimlane(swimlane.id)}
                    >
                      <div className="backlog-section-header-left">
                        <div
                          className="swimlane-drag-handle"
                          {...dragHandleProps}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <GripVertical size={14} />
                        </div>
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        <h3>
                          <span className="swimlane-designator" style={{ color: swimlane.color }}>{swimlane.designator}</span>
                          {swimlane.name}
                          <span className="backlog-section-count">{swimlaneBacklogCards.length}</span>
                        </h3>
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={(e) => { e.stopPropagation(); setAddingCardToSwimlane(swimlane.id); }}
                      >
                        <Plus size={14} />
                        Add
                      </button>
                    </div>
                    {!isCollapsed && (
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
                        <SortableContext items={swimlaneBacklogCards.map(c => `backlog-${c.id}`)} strategy={verticalListSortingStrategy}>
                          {swimlaneBacklogCards.map((card) => (
                            <SortableBacklogCard
                              key={card.id}
                              card={card}
                              designator={getSwimlaneName(card.swimlane_id)}
                              priorityColor={getPriorityColor(card.priority)}
                              onClick={() => onCardClick(card)}
                              actionButton={visibleSprints.length === 1 ? (
                                <button
                                  className="btn btn-ghost btn-xs backlog-move-btn"
                                  onClick={(e) => { e.stopPropagation(); handleMoveToSprint(card.id, visibleSprints[0].id); }}
                                  title={`Move to ${visibleSprints[0].name}`}
                                >
                                  <ArrowRight size={14} />
                                </button>
                              ) : visibleSprints.length > 1 ? (
                                <select
                                  className="backlog-sprint-select"
                                  defaultValue=""
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    if (e.target.value) handleMoveToSprint(card.id, parseInt(e.target.value));
                                    e.target.value = '';
                                  }}
                                  title="Move to sprint"
                                >
                                  <option value="" disabled>Move to…</option>
                                  {visibleSprints.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              ) : undefined}
                            />
                          ))}
                        </SortableContext>
                        {swimlaneBacklogCards.length === 0 && addingCardToSwimlane !== swimlane.id && (
                          <div className="backlog-empty">No cards in backlog</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </SortableSwimlaneSection>
            );
          })}
        </SortableContext>
      </div>

      {/* Create Sprint Modal */}
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
                  autoFocus
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

      {/* Edit Sprint Modal */}
      {editingSprint && (
        <div className="modal-overlay" onClick={() => setEditingSprint(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Sprint</h2>
            <div className="form-group">
              <label>Sprint Name</label>
              <input
                type="text"
                value={editSprintName}
                onChange={(e) => setEditSprintName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Goal (optional)</label>
              <textarea
                value={editSprintGoal}
                onChange={(e) => setEditSprintGoal(e.target.value)}
                placeholder="What do you want to achieve?"
                rows={3}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Start Date</label>
                <input
                  type="date"
                  value={editSprintStartDate}
                  onChange={(e) => setEditSprintStartDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>End Date</label>
                <input
                  type="date"
                  value={editSprintEndDate}
                  onChange={(e) => setEditSprintEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn" onClick={() => setEditingSprint(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleEditSprintSave}
                disabled={savingEditSprint || !editSprintName.trim()}
              >
                {savingEditSprint ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DragOverlay>
        {draggedCard && (
          <div className="backlog-card backlog-card-dragging">
            <div className="backlog-card-priority" style={{ backgroundColor: getPriorityColor(draggedCard.priority) }} />
            <span className="card-designator">{getSwimlaneName(draggedCard.swimlane_id)}{draggedCard.gitea_issue_id}</span>
            <span className="card-title">{draggedCard.title}</span>
          </div>
        )}
        {draggedSwimlane && (
          <div className="backlog-section swimlane-backlog swimlane-dragging">
            <div
              className="backlog-section-header"
              style={{ borderLeftColor: draggedSwimlane.color }}
            >
              <div className="backlog-section-header-left">
                <GripVertical size={14} />
                <h3>
                  <span className="swimlane-designator" style={{ color: draggedSwimlane.color }}>{draggedSwimlane.designator}</span>
                  {draggedSwimlane.name}
                </h3>
              </div>
            </div>
          </div>
        )}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
