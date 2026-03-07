import { useState } from 'react';

export interface AddCardModalProps {
  onClose: () => void;
  onAdd: (data: { title: string; description: string; storyPoints: number | null }) => Promise<void>;
}

export function AddCardModal({
  onClose,
  onAdd,
}: AddCardModalProps) {
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
