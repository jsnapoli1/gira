import { useState } from 'react';
import { Repository } from '../types';

export interface AddSwimlaneModalProps {
  repos: Repository[];
  onClose: () => void;
  onAdd: (data: { name: string; repoOwner: string; repoName: string; designator: string; color: string }) => void;
}

export function AddSwimlaneModal({
  repos,
  onClose,
  onAdd,
}: AddSwimlaneModalProps) {
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
