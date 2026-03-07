import { useState } from 'react';
import { cards as cardsApi, sprints as sprintsApi } from '../api/client';
import { Card, Column, Swimlane, Sprint } from '../types';
import { useToast } from '../components/Toast';
import { Plus, Calendar } from 'lucide-react';

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
  const { showToast } = useToast();

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
    try {
      await sprintsApi.complete(sprintId);
      onRefresh();
      showToast('Sprint completed', 'success');
    } catch (err) {
      console.error('Failed to complete sprint:', err);
      showToast('Failed to complete sprint', 'error');
    }
  };

  const handleAssignToSprint = async (cardId: number, sprintId: number | null) => {
    try {
      await cardsApi.assignToSprint(cardId, sprintId);
      onRefresh();
    } catch (err) {
      console.error('Failed to assign card:', err);
      showToast('Failed to assign card to sprint', 'error');
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
