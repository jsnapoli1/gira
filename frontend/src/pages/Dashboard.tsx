import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { dashboard as dashboardApi } from '../api/client';
import type { Board, DashboardCardWithBoard, DashboardSprintWithProgress } from '../types';
import { Kanban, CheckSquare, Zap, Clock, AlertCircle } from 'lucide-react';

const priorityColors: Record<string, string> = {
  highest: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  lowest: '#94a3b8',
};

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

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (diffDays < 0) return { text: formatted, className: 'dashboard-due-overdue' };
    if (diffDays <= 2) return { text: formatted, className: 'dashboard-due-soon' };
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
        {/* My Cards Section */}
        <section className="dashboard-section">
          <div className="dashboard-section-header">
            <CheckSquare size={20} />
            <h2>My Cards</h2>
            <span className="dashboard-count">{myCards.length}</span>
          </div>
          {myCards.length === 0 ? (
            <p className="dashboard-empty">No cards assigned to you.</p>
          ) : (
            <div className="dashboard-card-list">
              {myCards.map((card) => {
                const due = formatDueDate(card.due_date);
                return (
                  <div
                    key={card.id}
                    className="dashboard-card-item"
                    onClick={() => navigate(`/boards/${card.board_id}?card=${card.id}`)}
                  >
                    <div className="dashboard-card-priority">
                      <span
                        className="dashboard-priority-dot"
                        style={{ background: priorityColors[card.priority] || '#94a3b8' }}
                        title={card.priority}
                      />
                    </div>
                    <div className="dashboard-card-info">
                      <div className="dashboard-card-title">{card.title}</div>
                      <div className="dashboard-card-meta">
                        <span className="dashboard-card-board">{card.board_name}</span>
                        <span className="dashboard-card-state">{card.state}</span>
                        {card.story_points !== null && (
                          <span className="dashboard-card-points">{card.story_points} pts</span>
                        )}
                      </div>
                    </div>
                    {due && (
                      <div className={`dashboard-card-due ${due.className}`}>
                        <Clock size={12} />
                        {due.text}
                      </div>
                    )}
                  </div>
                );
              })}
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
