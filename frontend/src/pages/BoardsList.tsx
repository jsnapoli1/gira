import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { boards as boardsApi } from '../api/client';
import { Board } from '../types';
import { Plus, Kanban, Trash2 } from 'lucide-react';

export function BoardsList() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [newBoardTemplate, setNewBoardTemplate] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadBoards();
  }, []);

  const loadBoards = async () => {
    try {
      const data = await boardsApi.list();
      setBoards(data || []);
    } catch (err) {
      console.error('Failed to load boards:', err);
    } finally {
      setLoading(false);
    }
  };

  const createBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const board = await boardsApi.create(newBoardName, newBoardDesc, newBoardTemplate || undefined);
      setBoards([...boards, board]);
      setShowCreateModal(false);
      setNewBoardName('');
      setNewBoardDesc('');
      setNewBoardTemplate('');
    } catch (err) {
      console.error('Failed to create board:', err);
    } finally {
      setCreating(false);
    }
  };

  const deleteBoard = async (id: number) => {
    if (!confirm('Are you sure you want to delete this board?')) return;
    try {
      await boardsApi.delete(id);
      setBoards(boards.filter((b) => b.id !== id));
    } catch (err) {
      console.error('Failed to delete board:', err);
    }
  };

  return (
    <Layout>
      <div className="page-header">
        <h1>Boards</h1>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          <span>Create Board</span>
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading boards...</div>
      ) : boards.length === 0 ? (
        <div className="empty-state">
          <Kanban size={48} />
          <h2>No boards yet</h2>
          <p>Create your first board to start managing your projects</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={18} />
            <span>Create Board</span>
          </button>
        </div>
      ) : (
        <div className="boards-grid">
          {boards.map((board) => (
            <div key={board.id} className="board-card">
              <Link to={`/boards/${board.id}`} className="board-card-link">
                <div className="board-card-icon">
                  <Kanban size={24} />
                </div>
                <h3>{board.name}</h3>
                {board.description && <p>{board.description}</p>}
              </Link>
              <button
                className="board-card-delete"
                onClick={() => deleteBoard(board.id)}
                title="Delete board"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Board</h2>
            <form onSubmit={createBoard}>
              <div className="form-group">
                <label htmlFor="boardName">Board Name</label>
                <input
                  id="boardName"
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="My Project"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="boardDesc">Description (optional)</label>
                <textarea
                  id="boardDesc"
                  value={newBoardDesc}
                  onChange={(e) => setNewBoardDesc(e.target.value)}
                  placeholder="Project description..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label htmlFor="boardTemplate">Board Template</label>
                <select
                  id="boardTemplate"
                  value={newBoardTemplate}
                  onChange={(e) => setNewBoardTemplate(e.target.value)}
                >
                  <option value="">Default (To Do, In Progress, In Review, Done)</option>
                  <option value="kanban">Kanban (To Do, In Progress, Done)</option>
                  <option value="scrum">Scrum (Backlog, To Do, In Progress, Review, Done)</option>
                  <option value="bug_triage">Bug Triage (New, Confirmed, In Progress, Fixed, Won't Fix)</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
