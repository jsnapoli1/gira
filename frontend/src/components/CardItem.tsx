import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, Swimlane } from '../types';
import { GripVertical, Tag, AlertCircle, Calendar } from 'lucide-react';

// Date helpers
function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 7) return `${days}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isDueSoon(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= 7;
}

function isNotUrgent(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return days > 7;
}

function isOverdue(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getTime() < now.getTime();
}

export interface CardItemProps {
  card: Card;
  swimlane: Swimlane;
  onClick: () => void;
}

export const CardItem = React.memo(function CardItem({ card, swimlane, onClick }: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    data: { card, swimlane },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityColors: Record<string, string> = {
    highest: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    low: '#16a34a',
    lowest: '#6b7280',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card-item"
      onClick={onClick}
      {...attributes}
    >
      <div className="card-drag-handle" {...listeners}>
        <GripVertical size={14} />
      </div>
      <div className="card-content">
        <div className="card-header">
          <span className={`card-type-badge type-${card.issue_type || 'task'}`} title={card.issue_type || 'task'}>
            {(card.issue_type || 'task').charAt(0).toUpperCase()}
          </span>
          <span className="card-designator" style={{ color: swimlane.color }}>
            {swimlane.designator}{card.gitea_issue_id}
          </span>
          {card.priority && card.priority !== 'medium' && (
            <span
              className="card-priority"
              style={{ color: priorityColors[card.priority] }}
              title={`Priority: ${card.priority}`}
            >
              <AlertCircle size={12} />
            </span>
          )}
        </div>
        <h4 className="card-title">{card.title}</h4>
        {card.labels && card.labels.length > 0 && (
          <div className="card-labels">
            {card.labels.slice(0, 3).map((label) => (
              <span key={label.id} className="card-label" style={{ backgroundColor: label.color }} title={label.name}>
                {label.name}
              </span>
            ))}
            {card.labels.length > 3 && (
              <span className="card-label more">+{card.labels.length - 3}</span>
            )}
          </div>
        )}
        <div className="card-meta">
          {card.issue_type && card.issue_type !== 'task' && (
            <span className={`issue-type-badge issue-type-${card.issue_type}`}>
              {card.issue_type === 'epic' ? 'Epic' : card.issue_type === 'story' ? 'Story' : card.issue_type === 'subtask' ? 'Subtask' : card.issue_type}
            </span>
          )}
          {card.story_points !== null && (
            <span className="card-points" title="Story points">
              <Tag size={12} />
              {card.story_points}
            </span>
          )}
          {card.due_date && (
            <span className={`card-due-date ${isOverdue(card.due_date) ? 'overdue' : isDueSoon(card.due_date) ? 'due-soon' : isNotUrgent(card.due_date) ? 'not-urgent' : ''}`} title={`Due: ${formatDueDate(card.due_date)}`}>
              <Calendar size={12} />
              {formatDueDate(card.due_date)}
            </span>
          )}
          {card.assignees && card.assignees.length > 0 && (
            <div className="card-assignees">
              {card.assignees.slice(0, 3).map((assignee) => (
                <div key={assignee.id} className="card-assignee" title={assignee.display_name}>
                  {assignee.avatar_url ? (
                    <img src={assignee.avatar_url} alt={assignee.display_name} />
                  ) : (
                    <span>{assignee.display_name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
              ))}
              {card.assignees.length > 3 && (
                <div className="card-assignee more">+{card.assignees.length - 3}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
