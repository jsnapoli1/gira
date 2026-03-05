import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { boards as boardsApi, users as usersApi } from '../api/client';
import { Board, Label, User } from '../types';
import { ChevronLeft, Trash2, Plus, ChevronUp, ChevronDown, Edit2, User as UserIcon } from 'lucide-react';

export function BoardSettings() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Column management
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnState, setNewColumnState] = useState('open');

  // Label management
  const [labels, setLabels] = useState<Label[]>([]);
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#6366f1');

  // Member management
  const [members, setMembers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');

  useEffect(() => {
    loadBoard();
    loadLabels();
    loadMembers();
    loadAllUsers();
  }, [boardId]);

  const loadBoard = async (showLoading = true) => {
    if (!boardId) return;
    if (showLoading) setLoading(true);
    try {
      const data = await boardsApi.get(parseInt(boardId));
      setBoard(data);
      setName(data.name);
      setDescription(data.description || '');
    } catch (err) {
      console.error('Failed to load board:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadLabels = async () => {
    if (!boardId) return;
    try {
      const data = await boardsApi.getLabels(parseInt(boardId));
      setLabels(data || []);
    } catch (err) {
      console.error('Failed to load labels:', err);
    }
  };

  const loadMembers = async () => {
    if (!boardId) return;
    try {
      const data = await boardsApi.getMembers(parseInt(boardId));
      setMembers(data || []);
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  };

  const loadAllUsers = async () => {
    try {
      const data = await usersApi.list();
      setAllUsers(data || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleSave = async () => {
    if (!board) return;
    setSaving(true);
    try {
      await boardsApi.update(board.id, name, description);
      setBoard({ ...board, name, description });
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!board) return;
    if (!confirm('Are you sure you want to delete this board? This cannot be undone.')) return;

    try {
      await boardsApi.delete(board.id);
      navigate('/boards');
    } catch (err) {
      console.error('Failed to delete board:', err);
    }
  };

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board) return;

    try {
      await boardsApi.addColumn(board.id, newColumnName, newColumnState);
      loadBoard();
      setShowAddColumn(false);
      setNewColumnName('');
      setNewColumnState('open');
    } catch (err) {
      console.error('Failed to add column:', err);
    }
  };

  const handleDeleteColumn = async (columnId: number) => {
    if (!confirm('Are you sure you want to delete this column? Cards in this column will need to be moved first.')) return;
    try {
      await boardsApi.deleteColumn(board!.id, columnId);
      loadBoard();
    } catch (err) {
      console.error('Failed to delete column:', err);
    }
  };

  const handleMoveColumn = async (columnId: number, direction: 'up' | 'down') => {
    if (!board) return;
    const columns = [...(board.columns || [])];
    const index = columns.findIndex(c => c.id === columnId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= columns.length) return;

    // Optimistically update UI
    const [movedColumn] = columns.splice(index, 1);
    columns.splice(newIndex, 0, movedColumn);

    // Update positions
    const updatedColumns = columns.map((col, i) => ({ ...col, position: i }));
    setBoard({ ...board, columns: updatedColumns });

    try {
      await boardsApi.reorderColumn(board.id, columnId, newIndex);
    } catch (err) {
      console.error('Failed to reorder column:', err);
      // Revert on error
      await loadBoard(false);
    }
  };

  const handleDeleteSwimlane = async (swimlaneId: number) => {
    if (!confirm('Are you sure you want to delete this swimlane? Cards in this swimlane will be deleted.')) return;
    try {
      await boardsApi.deleteSwimlane(board!.id, swimlaneId);
      loadBoard();
    } catch (err) {
      console.error('Failed to delete swimlane:', err);
    }
  };

  const handleAddLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board) return;

    try {
      await boardsApi.createLabel(board.id, newLabelName, newLabelColor);
      loadLabels();
      setShowAddLabel(false);
      setNewLabelName('');
      setNewLabelColor('#6366f1');
    } catch (err) {
      console.error('Failed to add label:', err);
    }
  };

  const handleUpdateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board || !editingLabel) return;

    try {
      await boardsApi.updateLabel(board.id, editingLabel.id, newLabelName, newLabelColor);
      loadLabels();
      setEditingLabel(null);
      setNewLabelName('');
      setNewLabelColor('#6366f1');
    } catch (err) {
      console.error('Failed to update label:', err);
    }
  };

  const handleDeleteLabel = async (labelId: number) => {
    if (!confirm('Are you sure you want to delete this label? It will be removed from all cards.')) return;
    try {
      await boardsApi.deleteLabel(board!.id, labelId);
      loadLabels();
    } catch (err) {
      console.error('Failed to delete label:', err);
    }
  };

  const openEditLabel = (label: Label) => {
    setEditingLabel(label);
    setNewLabelName(label.name);
    setNewLabelColor(label.color);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board || !selectedUserId) return;

    try {
      await boardsApi.addMember(board.id, parseInt(selectedUserId), selectedRole);
      loadMembers();
      setShowAddMember(false);
      setSelectedUserId('');
      setSelectedRole('member');
    } catch (err) {
      console.error('Failed to add member:', err);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await boardsApi.removeMember(board!.id, userId);
      loadMembers();
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  };

  const availableUsers = allUsers.filter((u) => !members.some((m) => m.user_id === u.id));

  if (loading) {
    return (
      <Layout>
        <div className="loading">Loading settings...</div>
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

  const columns = board.columns || [];
  const swimlanes = board.swimlanes || [];

  return (
    <Layout>
      <div className="settings-page">
        <div className="page-header">
          <div className="page-header-left">
            <Link to={`/boards/${board.id}`} className="back-link">
              <ChevronLeft size={20} />
            </Link>
            <h1>Board Settings</h1>
          </div>
        </div>

        <div className="settings-content">
          {/* General Settings */}
          <section className="settings-section">
            <h2>General</h2>
            <div className="settings-form">
              <div className="form-group">
                <label htmlFor="boardName">Board Name</label>
                <input
                  id="boardName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="boardDesc">Description</label>
                <textarea
                  id="boardDesc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </section>

          {/* Columns */}
          <section className="settings-section">
            <div className="section-header">
              <h2>Columns</h2>
              <button className="btn btn-sm" onClick={() => setShowAddColumn(true)}>
                <Plus size={16} />
                Add Column
              </button>
            </div>
            <p className="section-description">
              Columns represent the workflow states for your cards.
            </p>
            <div className="settings-list">
              {columns.map((column, index) => (
                <div key={column.id} className="settings-list-item">
                  <div className="item-reorder">
                    <button
                      type="button"
                      className="reorder-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMoveColumn(column.id, 'up');
                      }}
                      disabled={index === 0}
                      title="Move up"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="reorder-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMoveColumn(column.id, 'down');
                      }}
                      disabled={index === columns.length - 1}
                      title="Move down"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                  <div className="item-content">
                    <span className="item-name">{column.name}</span>
                    <span className="item-meta">State: {column.state}</span>
                  </div>
                  <button
                    className="item-delete"
                    onClick={() => handleDeleteColumn(column.id)}
                    title="Delete column"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {columns.length === 0 && (
                <p className="empty-list">No columns configured</p>
              )}
            </div>
          </section>

          {/* Labels */}
          <section className="settings-section">
            <div className="section-header">
              <h2>Labels</h2>
              <button className="btn btn-sm" onClick={() => setShowAddLabel(true)}>
                <Plus size={16} />
                Add Label
              </button>
            </div>
            <p className="section-description">
              Labels help categorize and filter cards on your board.
            </p>
            <div className="settings-list">
              {labels.map((label) => (
                <div key={label.id} className="settings-list-item">
                  <div
                    className="item-color"
                    style={{ backgroundColor: label.color }}
                  />
                  <div className="item-content">
                    <span className="item-name">{label.name}</span>
                  </div>
                  <button
                    className="item-edit"
                    onClick={() => openEditLabel(label)}
                    title="Edit label"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    className="item-delete"
                    onClick={() => handleDeleteLabel(label.id)}
                    title="Delete label"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {labels.length === 0 && (
                <p className="empty-list">No labels configured</p>
              )}
            </div>
          </section>

          {/* Swimlanes */}
          <section className="settings-section">
            <div className="section-header">
              <h2>Swimlanes</h2>
              <Link to={`/boards/${board.id}`} className="btn btn-sm">
                <Plus size={16} />
                Add Swimlane
              </Link>
            </div>
            <p className="section-description">
              Swimlanes group cards by repository. Each swimlane has a unique designator prefix.
            </p>
            <div className="settings-list">
              {swimlanes.map((swimlane) => (
                <div key={swimlane.id} className="settings-list-item">
                  <div
                    className="item-color"
                    style={{ backgroundColor: swimlane.color }}
                  />
                  <div className="item-content">
                    <span className="item-name">{swimlane.name}</span>
                    <span className="item-meta">
                      {swimlane.repo_owner}/{swimlane.repo_name} ({swimlane.designator})
                    </span>
                  </div>
                  <button
                    className="item-delete"
                    onClick={() => handleDeleteSwimlane(swimlane.id)}
                    title="Delete swimlane"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {swimlanes.length === 0 && (
                <p className="empty-list">No swimlanes configured</p>
              )}
            </div>
          </section>

          {/* Members */}
          <section className="settings-section">
            <div className="section-header">
              <h2>Members</h2>
              <button className="btn btn-sm" onClick={() => setShowAddMember(true)}>
                <Plus size={16} />
                Add Member
              </button>
            </div>
            <p className="section-description">
              Manage who has access to this board and their permissions.
            </p>
            <div className="settings-list">
              {members.map((member) => {
                const user = allUsers.find((u) => u.id === member.user_id);
                return (
                  <div key={member.user_id} className="settings-list-item">
                    <div className="member-avatar">
                      {user?.avatar_url ? (
                        <img src={user.avatar_url} alt={user.display_name} />
                      ) : (
                        <UserIcon size={16} />
                      )}
                    </div>
                    <div className="item-content">
                      <span className="item-name">{user?.display_name || `User #${member.user_id}`}</span>
                      <span className="item-meta">{member.role}</span>
                    </div>
                    {member.role !== 'owner' && (
                      <button
                        className="item-delete"
                        onClick={() => handleRemoveMember(member.user_id)}
                        title="Remove member"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
              {members.length === 0 && (
                <p className="empty-list">No members configured</p>
              )}
            </div>
          </section>

          {/* Danger Zone */}
          <section className="settings-section danger">
            <h2>Danger Zone</h2>
            <p className="section-description">
              Permanently delete this board and all its data.
            </p>
            <button className="btn btn-danger" onClick={handleDelete}>
              <Trash2 size={16} />
              Delete Board
            </button>
          </section>
        </div>

        {/* Add Column Modal */}
        {showAddColumn && (
          <div className="modal-overlay" onClick={() => setShowAddColumn(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Add Column</h2>
              <form onSubmit={handleAddColumn}>
                <div className="form-group">
                  <label>Column Name</label>
                  <input
                    type="text"
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder="e.g., In Review"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <select
                    value={newColumnState}
                    onChange={(e) => setNewColumnState(e.target.value)}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="closed">Closed</option>
                  </select>
                  <small>This maps to the Gitea issue state</small>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => setShowAddColumn(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Column
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add/Edit Label Modal */}
        {(showAddLabel || editingLabel) && (
          <div className="modal-overlay" onClick={() => { setShowAddLabel(false); setEditingLabel(null); }}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>{editingLabel ? 'Edit Label' : 'Add Label'}</h2>
              <form onSubmit={editingLabel ? handleUpdateLabel : handleAddLabel}>
                <div className="form-group">
                  <label>Label Name</label>
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    placeholder="e.g., Bug, Feature, Enhancement"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Color</label>
                  <div className="color-picker">
                    {['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`color-option ${newLabelColor === c ? 'selected' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setNewLabelColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => { setShowAddLabel(false); setEditingLabel(null); setNewLabelName(''); setNewLabelColor('#6366f1'); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingLabel ? 'Save Changes' : 'Add Label'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Member Modal */}
        {showAddMember && (
          <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Add Member</h2>
              <form onSubmit={handleAddMember}>
                <div className="form-group">
                  <label>User</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    required
                  >
                    <option value="">Select a user...</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.display_name} ({user.email})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                  >
                    <option value="viewer">Viewer - Can view board</option>
                    <option value="member">Member - Can edit cards</option>
                    <option value="admin">Admin - Full access</option>
                  </select>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn" onClick={() => setShowAddMember(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Add Member
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
