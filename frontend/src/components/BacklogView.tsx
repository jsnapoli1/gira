import { useState } from 'react';
import { cards as cardsApi, sprints as sprintsApi } from '../api/client';
import { Card, Column, Swimlane, Sprint } from '../types';
import { useToast } from '../components/Toast';
import { Plus, Calendar, Play, CheckCircle, ArrowRight, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
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
    <div ref={setNodeRef} style={style} className="backlog-card" onClick={onClick} {...attributes}>
      <div className="backlog-card-drag" {...listeners}>
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
}

export function BacklogView({
  boardId,
  cards,
  sprints,
  swimlanes,
  columns,
  onCardClick,
  onRefresh,
}: BacklogViewProps) {
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [newSprintGoal, setNewSprintGoal] = useState('');
  const [newSprintStartDate, setNewSprintStartDate] = useState('');
  const [newSprintEndDate, setNewSprintEndDate] = useState('');
  const [addingCardToSwimlane, setAddingCardToSwimlane] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Set<number>>(new Set());
  const { showToast } = useToast();

  const activeSprint = sprints.find((s) => s.status === 'active');
  const planningSprint = sprints.find((s) => s.status === 'planning');
  const currentSprint = activeSprint || planningSprint;

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

  const handleStartSprint = async (sprintId: number) => {
    try {
      await sprintsApi.start(sprintId);
      onRefresh();
      showToast('Sprint started', 'success');
    } catch (err) {
      console.error('Failed to start sprint:', err);
      showToast('Failed to start sprint', 'error');
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

  const handleMoveToSprint = async (cardId: number) => {
    if (!currentSprint) return;
    try {
      await cardsApi.assignToSprint(cardId, currentSprint.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to assign card:', err);
      showToast('Failed to move card to sprint', 'error');
    }
  };

  const handleRemoveFromSprint = async (cardId: number) => {
    try {
      await cardsApi.assignToSprint(cardId, null);
      onRefresh();
    } catch (err) {
      console.error('Failed to remove card from sprint:', err);
      showToast('Failed to remove card from sprint', 'error');
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [draggedCard, setDraggedCard] = useState<Card | null>(null);

  const backlogCards = cards.filter((c) => c.sprint_id === null);
  const sprintCards = currentSprint ? cards.filter((c) => c.sprint_id === currentSprint.id) : [];

  const handleDragStart = (event: DragStartEvent) => {
    const card = (event.active.data.current as any)?.card as Card | undefined;
    if (card) setDraggedCard(card);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggedCard(null);
    const { active, over } = event;
    if (!over || !currentSprint) return;

    const cardId = parseInt(String(active.id).replace('backlog-', ''));
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // Dropped on sprint drop zone
    if (String(over.id) === 'sprint-drop-zone') {
      if (card.sprint_id !== currentSprint.id) {
        await handleMoveToSprint(cardId);
      }
      return;
    }

    // Dropped on a backlog card — check if target is in sprint or backlog
    const targetCardId = parseInt(String(over.id).replace('backlog-', ''));
    const targetCard = cards.find(c => c.id === targetCardId);

    if (targetCard) {
      // If dragging from backlog to sprint area (target is in sprint)
      if (card.sprint_id === null && targetCard.sprint_id === currentSprint.id) {
        await handleMoveToSprint(cardId);
        return;
      }
      // If dragging from sprint to backlog area (target is in backlog)
      if (card.sprint_id === currentSprint.id && targetCard.sprint_id === null) {
        await handleRemoveFromSprint(cardId);
        return;
      }
      // Reorder within same list
      if (card.sprint_id === targetCard.sprint_id) {
        try {
          await cardsApi.reorder(cardId, targetCard.position);
          onRefresh();
        } catch {
          showToast('Failed to reorder card', 'error');
        }
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
      {/* Sprint Section */}
      <div className="backlog-sprint-panel">
        {currentSprint ? (
          <>
            <div className="backlog-sprint-header">
              <div className="backlog-sprint-info">
                <h2>
                  {currentSprint.name}
                  <span className={`sprint-status-badge ${currentSprint.status}`}>
                    {currentSprint.status === 'active' ? 'Active' : 'Planning'}
                  </span>
                </h2>
                {(currentSprint.start_date || currentSprint.end_date) && (
                  <span className="sprint-dates">
                    <Calendar size={14} />
                    {currentSprint.start_date && new Date(currentSprint.start_date).toLocaleDateString()}
                    {currentSprint.start_date && currentSprint.end_date && ' – '}
                    {currentSprint.end_date && new Date(currentSprint.end_date).toLocaleDateString()}
                  </span>
                )}
                {currentSprint.goal && <p className="sprint-goal">{currentSprint.goal}</p>}
              </div>
              <div className="backlog-sprint-actions">
                <span className="sprint-card-count">{sprintCards.length} cards</span>
                {currentSprint.status === 'planning' && (
                  <button className="btn btn-primary btn-sm" onClick={() => handleStartSprint(currentSprint.id)}>
                    <Play size={14} />
                    Start Sprint
                  </button>
                )}
                {currentSprint.status === 'active' && (
                  <button className="btn btn-sm" onClick={() => handleCompleteSprint(currentSprint.id)}>
                    <CheckCircle size={14} />
                    Complete Sprint
                  </button>
                )}
              </div>
            </div>
            <SprintDropZone id="sprint-drop-zone">
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
          </>
        ) : (
          <div className="backlog-no-sprint">
            <p>No sprint yet. Create one to start organizing your work.</p>
            <button className="btn btn-primary" onClick={() => setShowCreateSprint(true)}>
              <Plus size={18} />
              Create Sprint
            </button>
          </div>
        )}
      </div>

      {/* Backlog Section */}
      <div className="backlog-items-panel">
        <div className="backlog-header">
          <h2>Backlog <span className="backlog-count">{backlogCards.length}</span></h2>
          {!currentSprint && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreateSprint(true)}>
              <Plus size={14} />
              Create Sprint
            </button>
          )}
        </div>

        {swimlanes.map((swimlane) => {
          const swimlaneBacklogCards = backlogCards.filter((c) => c.swimlane_id === swimlane.id);
          const isCollapsed = collapsedSwimlanes.has(swimlane.id);
          return (
            <div key={swimlane.id} className="backlog-section swimlane-backlog">
              <div
                className="backlog-section-header"
                style={{ borderLeftColor: swimlane.color }}
                onClick={() => toggleSwimlane(swimlane.id)}
              >
                <div className="backlog-section-header-left">
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
                        actionButton={currentSprint ? (
                          <button
                            className="btn btn-ghost btn-xs backlog-move-btn"
                            onClick={(e) => { e.stopPropagation(); handleMoveToSprint(card.id); }}
                            title={`Move to ${currentSprint.name}`}
                          >
                            <ArrowRight size={14} />
                          </button>
                        ) : undefined}
                      />
                    ))}
                  </SortableContext>
                  {swimlaneBacklogCards.length === 0 && addingCardToSwimlane !== swimlane.id && (
                    <div className="backlog-empty">No cards in backlog</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

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

      <DragOverlay>
        {draggedCard && (
          <div className="backlog-card backlog-card-dragging">
            <div className="backlog-card-priority" style={{ backgroundColor: getPriorityColor(draggedCard.priority) }} />
            <span className="card-designator">{getSwimlaneName(draggedCard.swimlane_id)}{draggedCard.gitea_issue_id}</span>
            <span className="card-title">{draggedCard.title}</span>
          </div>
        )}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
