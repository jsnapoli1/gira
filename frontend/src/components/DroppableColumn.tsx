import React, { useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, Column, Swimlane } from '../types';
import { useToast } from '../components/Toast';
import { CardItem } from '../components/CardItem';
import { Plus } from 'lucide-react';

export interface DroppableColumnProps {
  column: Column;
  cards: Card[];
  swimlane: Swimlane;
  onCardClick: (card: Card) => void;
  onQuickAdd: (title: string) => Promise<void>;
}

export const DroppableColumn = React.memo(function DroppableColumn({
  column,
  cards,
  swimlane,
  onCardClick,
  onQuickAdd,
}: DroppableColumnProps) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const { showToast } = useToast();

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setAdding(true);
    try {
      await onQuickAdd(quickTitle);
      setQuickTitle('');
      setShowQuickAdd(false);
    } catch (err) {
      console.error('Failed to create card:', err);
      showToast('Failed to create card', 'error');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="board-column">
      <div className="column-header">
        <h3>{column.name}</h3>
        <span className="column-count">{cards.length}</span>
      </div>
      <SortableContext items={cards.map((c) => `card-${c.id}`)} strategy={verticalListSortingStrategy}>
        <div className="column-cards" data-column-id={column.id} data-state={column.state}>
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              swimlane={swimlane}
              onClick={() => onCardClick(card)}
            />
          ))}
          {showQuickAdd ? (
            <form className="quick-add-form" onSubmit={handleQuickAdd}>
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Card title..."
                autoFocus
                disabled={adding}
              />
              <div className="quick-add-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !quickTitle.trim()}>
                  {adding ? 'Adding...' : 'Add'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => { setShowQuickAdd(false); setQuickTitle(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="add-card-btn" onClick={() => setShowQuickAdd(true)}>
              <Plus size={14} />
              <span>Add card</span>
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
});
