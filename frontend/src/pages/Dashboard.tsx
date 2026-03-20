import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { dashboard as dashboardApi } from '../api/client';
import type { Board, DashboardCardWithBoard, DashboardSprintWithProgress } from '../types';
import { Kanban, CheckSquare, Zap, AlertCircle, Tag, Calendar } from 'lucide-react';

const priorityColors: Record<string, string> = {
  highest: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  lowest: '#94a3b8',
};

const stateColumns = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'In Review' },
  { key: 'closed', label: 'Done' },
];

export function Dashboard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [myCards, setMyCards] = useState<DashboardCardWithBoard[]>([]);
  const [activeSprints, setActiveSprints] = useState<DashboardSprintWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const data = await dashboardApi.get();
      setBoards(data.boards || []);
      setMyCards(data.my_cards || []);
      setActiveSprints(data.active_sprints || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const cardsByState = useMemo(() => {
    const grouped: Record<string, DashboardCardWithBoard[]> = {};
    for (const col of stateColumns) {
      grouped[col.key] = [];
    }
    for (const card of myCards) {
      const state = card.state || 'open';
      if (grouped[state]) {
        grouped[state].push(card);
      } else {
        // Unknown state goes to open
        grouped['open'].push(card);
      }
    }
    return grouped;
  }, [myCards]);

  // Only show columns that have cards
  const activeColumns = useMemo(() => {
    return stateColumns.filter(col => cardsByState[col.key]?.length > 0);
  }, [cardsByState]);

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: 'Overdue', className: 'dashboard-due-overdue' };
    if (diffDays === 0) return { text: 'Today', className: 'dashboard-due-soon' };
    if (diffDays === 1) return { text: 'Tomorrow', className: 'dashboard-due-soon' };
    if (diffDays <= 7) return { text: `${diffDays}d`, className: 'dashboard-due-soon' };
    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { text: formatted, className: 'dashboard-due-normal' };
  };

  if (loading) {
    return <Layout><div className="loading">Loading dashboard...</div></Layout>;
  }

  if (error) {
    return (
      <Layout>
        <div className="dashboard-error">
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <div className="dashboard-content">
        {/* My Cards Section - Mini Kanban Board */}
        <section className="dashboard-section dashboard-section-wide">
          <div className="dashboard-section-header">
            <CheckSquare size={20} />
            <h2>My Cards</h2>
            <span className="dashboard-count">{myCards.length}</span>
          </div>
          {myCards.length === 0 ? (
            <p className="dashboard-empty">No cards assigned to you.</p>
          ) : (
            <div className="dashboard-kanban">
              {activeColumns.map((col) => (
                <div key={col.key} className="dashboard-kanban-column">
                  <div className="dashboard-kanban-column-header">
                    <span className="dashboard-kanban-column-title">{col.label}</span>
                    <span className="dashboard-kanban-column-count">{cardsByState[col.key].length}</span>
                  </div>
                  <div className="dashboard-kanban-cards">
                    {cardsByState[col.key].map((card) => {
                      const due = formatDueDate(card.due_date);
                      return (
                        <div
                          key={card.id}
                          className="dashboard-kanban-card"
                          onClick={() => navigate(`/boards/${card.board_id}?card=${card.id}`)}
                        >
                          <div className="dashboard-kanban-card-header">
                            <span
                              className="dashboard-priority-dot"
                              style={{ background: priorityColors[card.priority] || '#94a3b8' }}
                              title={card.priority}
                            />
                            <span className="dashboard-kanban-card-board">{card.board_name}</span>
                          </div>
                          <div className="dashboard-kanban-card-title">{card.title}</div>
                          <div className="dashboard-kanban-card-meta">
                            {card.story_points !== null && (
                              <span className="dashboard-kanban-card-points">
                                <Tag size={10} />
                                {card.story_points}
                              </span>
                            )}
                            {due && (
                              <span className={`dashboard-kanban-card-due ${due.className}`}>
                                <Calendar size={10} />
                                {due.text}
                              </span>
                            )}
                            {card.labels && card.labels.length > 0 && (
                              <div className="dashboard-kanban-card-labels">
                                {card.labels.slice(0, 2).map((label) => (
                                  <span
                                    key={label.id}
                                    className="dashboard-kanban-label"
                                    style={{ backgroundColor: label.color }}
                                    title={label.name}
                                  >
                                    {label.name}
                                  </span>
                                ))}
                                {card.labels.length > 2 && (
                                  <span className="dashboard-kanban-label more">+{card.labels.length - 2}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Boards Section */}
        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <Kanban size={20} />
            <h2>Recent Boards</h2>
            <span className="dashboard-count">{boards.length}</span>
          </div>
          {boards.length === 0 ? (
            <p className="dashboard-empty">
              No boards yet. <Link to="/boards" className="btn btn-primary">Create your first board</Link>
            </p>
          ) : (
            <div className="dashboard-boards-grid">
              {boards.slice(0, 6).map((board) => (
                <Link
                  key={board.id}
                  to={`/boards/${board.id}`}
                  className="dashboard-board-card"
                >
                  <div className="dashboard-board-icon">
                    <Kanban size={24} />
                  </div>
                  <div className="dashboard-board-info">
                    <h3>{board.name}</h3>
                    {board.description && (
                      <p>{board.description}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
          {boards.length > 6 && (
            <Link to="/boards" className="dashboard-view-all">
              View all {boards.length} boards
            </Link>
          )}
        </section>

        {/* Active Sprints Section */}
        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <Zap size={20} />
            <h2>Active Sprints</h2>
            <span className="dashboard-count">{activeSprints.length}</span>
          </div>
          {activeSprints.length === 0 ? (
            <p className="dashboard-empty">No active sprints.</p>
          ) : (
            <div className="dashboard-sprint-list">
              {activeSprints.map((sprint) => {
                const progress = sprint.total_cards > 0
                  ? Math.round((sprint.completed_cards / sprint.total_cards) * 100)
                  : 0;
                return (
                  <Link
                    key={sprint.id}
                    to={`/boards/${sprint.board_id}`}
                    className="dashboard-sprint-item"
                  >
                    <div className="dashboard-sprint-info">
                      <div className="dashboard-sprint-name">{sprint.name}</div>
                      <div className="dashboard-sprint-meta">
                        <span>{sprint.board_name}</span>
                        <span>{sprint.completed_cards}/{sprint.total_cards} cards</span>
                        {sprint.total_points > 0 && (
                          <span>{sprint.completed_points}/{sprint.total_points} pts</span>
                        )}
                      </div>
                    </div>
                    <div className="dashboard-sprint-progress">
                      <div className="dashboard-progress-bar">
                        <div
                          className="dashboard-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="dashboard-progress-label">{progress}%</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
