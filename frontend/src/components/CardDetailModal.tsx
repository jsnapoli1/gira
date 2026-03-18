import { useState, useEffect, useMemo } from 'react';
import { cards as cardsApi } from '../api/client';
import { Card, Swimlane, Sprint, User, Label, CardLink, LinkType, ActivityLog } from '../types';
import { useToast } from '../components/Toast';
import { Clock, Calendar, User as UserIcon, X, Check, Link as LinkIcon } from 'lucide-react';

// Render comment body with highlighted @mentions
function renderCommentBody(body: string): React.ReactNode {
  // Match @"Name With Spaces" or @SingleName patterns
  const mentionRegex = /(@"[^"]+"|@\S+)/g;
  const parts = body.split(mentionRegex);

  return parts.map((part, index) => {
    if (part.match(/^@"[^"]+"$/) || part.match(/^@\S+$/)) {
      return (
        <span key={index} className="mention-highlight">
          {part}
        </span>
      );
    }
    return part;
  });
}

function isOverdue(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getTime() < now.getTime();
}

function formatActivityDescription(activity: ActivityLog): string {
  const { action, field_changed, old_value, new_value } = activity;
  switch (action) {
    case 'created':
      return `created card "${new_value}"`;
    case 'deleted':
      return `deleted card "${old_value}"`;
    case 'commented':
      return 'added a comment';
    case 'assigned':
      return 'added an assignee';
    case 'unassigned':
      return 'removed an assignee';
    case 'moved':
      if (old_value && new_value) {
        return `moved card from ${old_value} to ${new_value}`;
      }
      return 'moved card';
    case 'updated':
      if (field_changed === 'title') return `changed title from "${old_value}" to "${new_value}"`;
      if (field_changed === 'priority') return `changed priority from ${old_value} to ${new_value}`;
      if (field_changed === 'description') return 'updated the description';
      if (field_changed === 'story_points') return `changed story points from ${old_value || 'none'} to ${new_value || 'none'}`;
      if (field_changed === 'due_date') return `changed due date from ${old_value || 'none'} to ${new_value || 'none'}`;
      if (field_changed === 'issue_type') return `changed type from ${old_value} to ${new_value}`;
      if (field_changed === 'sprint_id') return `changed sprint from ${old_value || 'Backlog'} to ${new_value || 'Backlog'}`;
      if (field_changed) return `updated ${field_changed.replace(/_/g, ' ')}`;
      return 'updated card';
    default:
      return action;
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export interface CardDetailModalProps {
  card: Card;
  swimlane: Swimlane;
  sprints: Sprint[];
  users: User[];
  boardLabels: Label[];
  customFields: any[];
  boardCards?: Card[];
  onClose: () => void;
  onUpdate: (card: Card) => void;
  onDelete: (cardId: number) => void;
}

export function CardDetailModal({
  card,
  swimlane,
  sprints,
  users,
  boardLabels,
  customFields,
  boardCards = [],
  onClose,
  onUpdate,
  onDelete,
}: CardDetailModalProps) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [storyPoints, setStoryPoints] = useState(card.story_points?.toString() || '');
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.split('T')[0] : '');
  const [timeEstimate, setTimeEstimate] = useState(card.time_estimate?.toString() || '');
  const [issueType, setIssueType] = useState(card.issue_type || 'task');
  const [saving, setSaving] = useState(false);
  const [assignees, setAssignees] = useState<User[]>(card.assignees || []);
  const [labels, setLabels] = useState<Label[]>(card.labels || []);

  // Comments state
  const [comments, setComments] = useState<any[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Mention autocomplete state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  // Pending images for comment (pasted)
  const [pendingImages, setPendingImages] = useState<File[]>([]);

  // Image viewer state
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Attachments state
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(true);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Custom field values state
  const [customFieldValues, setCustomFieldValues] = useState<Record<number, string>>({});

  // Work logs (time tracking) state
  const [totalTimeLogged, setTotalTimeLogged] = useState(0);
  const [newWorkLogMinutes, setNewWorkLogMinutes] = useState('');
  const [newWorkLogDate, setNewWorkLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [newWorkLogNotes, setNewWorkLogNotes] = useState('');
  const [addingWorkLog, setAddingWorkLog] = useState(false);

  // Card links state
  const [cardLinks, setCardLinks] = useState<CardLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkType, setNewLinkType] = useState<LinkType>('relates_to');
  const [linkSearchQuery, setLinkSearchQuery] = useState('');

  // Activity log state
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [activityOffset, setActivityOffset] = useState(0);
  const [hasMoreActivities, setHasMoreActivities] = useState(false);
  const ACTIVITY_PAGE_SIZE = 20;

  // Load all data on mount
  useEffect(() => {
    loadComments();
    loadAttachments();
    loadWorkLogs();
    loadLinks();
    loadActivities();
    if (customFields.length > 0) {
      loadCustomFieldValues();
    }
  }, [card.id]);

  const loadAttachments = async () => {
    setLoadingAttachments(true);
    try {
      const data = await cardsApi.getAttachments(card.id);
      setAttachments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load attachments:', err);
      setAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAttachment(true);
    try {
      const attachment = await cardsApi.uploadAttachment(card.id, file);
      if (attachment) {
        setAttachments([...attachments, attachment]);
      }
    } catch (err) {
      console.error('Failed to upload attachment:', err);
      showToast('Failed to upload attachment', 'error');
    } finally {
      setUploadingAttachment(false);
      e.target.value = ''; // Reset file input
    }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return;
    try {
      await cardsApi.deleteAttachment(card.id, attachmentId);
      setAttachments(attachments.filter((a) => a.id !== attachmentId));
    } catch (err) {
      console.error('Failed to delete attachment:', err);
      showToast('Failed to delete attachment', 'error');
    }
  };

  const loadCustomFieldValues = async () => {
    try {
      const data = await cardsApi.getCustomFieldValues(card.id);
      const values: Record<number, string> = {};
      if (Array.isArray(data)) {
        data.forEach((v: any) => {
          values[v.field_id] = v.value;
        });
      }
      setCustomFieldValues(values);
    } catch (err) {
      console.error('Failed to load custom field values:', err);
      setCustomFieldValues({});
    }
  };

  const handleCustomFieldChange = async (fieldId: number, value: string) => {
    // Update local state immediately for responsiveness
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleCustomFieldSave = async (fieldId: number, value?: string) => {
    const valueToSave = value !== undefined ? value : customFieldValues[fieldId] || '';
    try {
      await cardsApi.setCustomFieldValue(card.id, fieldId, valueToSave);
    } catch (err) {
      console.error('Failed to save custom field:', err);
      showToast('Failed to save custom field', 'error');
    }
  };

  const loadWorkLogs = async () => {
    try {
      const data = await cardsApi.getWorkLogs(card.id);
      setTotalTimeLogged(data.total_logged || 0);
    } catch (err) {
      console.error('Failed to load work logs:', err);
      setTotalTimeLogged(0);
    }
  };

  const handleAddWorkLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkLogMinutes || parseInt(newWorkLogMinutes) <= 0) return;

    setAddingWorkLog(true);
    try {
      const data = await cardsApi.addWorkLog(card.id, {
        time_spent: parseInt(newWorkLogMinutes),
        date: newWorkLogDate,
        notes: newWorkLogNotes,
      });
      setTotalTimeLogged(data.total_logged || 0);
      setNewWorkLogMinutes('');
      setNewWorkLogNotes('');
      setNewWorkLogDate(new Date().toISOString().split('T')[0]);
      showToast('Work log added', 'success');
    } catch (err) {
      console.error('Failed to add work log:', err);
      showToast('Failed to add work log', 'error');
    } finally {
      setAddingWorkLog(false);
    }
  };

  const formatTimeSpent = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const loadLinks = async () => {
    setLoadingLinks(true);
    try {
      const data = await cardsApi.getLinks(card.id);
      setCardLinks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load links:', err);
      setCardLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleCreateLink = async (targetCardId: number) => {
    try {
      const link = await cardsApi.createLink(card.id, targetCardId, newLinkType);
      if (link) {
        // Reload links to get populated card info
        await loadLinks();
      }
      setShowAddLink(false);
      setLinkSearchQuery('');
      showToast('Link created', 'success');
    } catch (err) {
      console.error('Failed to create link:', err);
      showToast('Failed to create link', 'error');
    }
  };

  const handleDeleteLink = async (linkId: number) => {
    try {
      await cardsApi.deleteLink(card.id, linkId);
      setCardLinks(cardLinks.filter((l) => l.id !== linkId));
      showToast('Link removed', 'success');
    } catch (err) {
      console.error('Failed to delete link:', err);
      showToast('Failed to remove link', 'error');
    }
  };

  const linkTypeLabels: Record<LinkType, string> = {
    blocks: 'Blocks',
    is_blocked_by: 'Blocked By',
    relates_to: 'Related',
    duplicates: 'Duplicates',
  };

  // Group links by type, normalizing for the current card's perspective
  const groupedLinks = useMemo(() => {
    const groups: Record<string, { link: CardLink; relatedCard: Card }[]> = {};
    for (const link of cardLinks) {
      const label = linkTypeLabels[link.link_type as LinkType] || link.link_type;
      if (!groups[label]) groups[label] = [];
      // Show the "other" card (not the current one)
      const relatedCard = link.source_card_id === card.id ? link.target_card : link.source_card;
      if (relatedCard) {
        groups[label].push({ link, relatedCard });
      }
    }
    return groups;
  }, [cardLinks, card.id]);

  // Filter board cards for link search
  const linkSearchResults = useMemo(() => {
    if (!linkSearchQuery.trim()) return [];
    const query = linkSearchQuery.toLowerCase();
    return boardCards
      .filter(
        (c) =>
          c.id !== card.id &&
          c.title.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [boardCards, linkSearchQuery, card.id]);

  const loadActivities = async (offset = 0) => {
    if (offset === 0) setLoadingActivities(true);
    try {
      const data = await cardsApi.getActivity(card.id, ACTIVITY_PAGE_SIZE, offset);
      const items = Array.isArray(data) ? data : [];
      if (offset === 0) {
        setActivities(items);
      } else {
        setActivities((prev) => [...prev, ...items]);
      }
      setActivityOffset(offset + items.length);
      setHasMoreActivities(items.length === ACTIVITY_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load activities:', err);
      if (offset === 0) setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  };

  const loadComments = async () => {
    setLoadingComments(true);
    try {
      const data = await cardsApi.getComments(card.id);
      setComments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load comments:', err);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() && pendingImages.length === 0) return;

    setPostingComment(true);
    try {
      // First upload any pending images as attachments
      const uploadedAttachments: number[] = [];
      for (const img of pendingImages) {
        const attachment = await cardsApi.uploadAttachment(card.id, img);
        if (attachment) {
          uploadedAttachments.push(attachment.id);
          setAttachments((prev) => [...prev, attachment]);
        }
      }

      // Post the comment with attachment IDs
      const comment = await cardsApi.addCommentWithAttachments(card.id, newComment, uploadedAttachments);
      if (comment) {
        setComments([...comments, comment]);
      }
      setNewComment('');
      setPendingImages([]);
    } catch (err) {
      console.error('Failed to post comment:', err);
      showToast('Failed to post comment', 'error');
    } finally {
      setPostingComment(false);
    }
  };

  // Handle paste for images in comment textarea
  const handleCommentPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          // Generate a filename based on timestamp
          const ext = item.type.split('/')[1] || 'png';
          const newFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: item.type });
          setPendingImages((prev) => [...prev, newFile]);
        }
        break;
      }
    }
  };

  // Filter users for mention dropdown
  const filteredMentionUsers = useMemo(() => {
    if (!mentionFilter) return users;
    const filter = mentionFilter.toLowerCase();
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(filter) ||
        u.email.toLowerCase().includes(filter)
    );
  }, [users, mentionFilter]);

  // Handle comment textarea input for @ mentions
  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNewComment(value);

    // Check if we're typing a mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      // Check if @ is at start or preceded by whitespace
      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        // Only show dropdown if no space in query (single word being typed)
        if (!query.includes(' ')) {
          setMentionFilter(query);
          setMentionStartPos(atIndex);
          setShowMentionDropdown(true);
          setMentionIndex(0);
          return;
        }
      }
    }
    setShowMentionDropdown(false);
  };

  // Handle mention selection
  const handleSelectMention = (user: User) => {
    // Replace @query with @displayName (use quotes if name has spaces)
    const beforeMention = newComment.slice(0, mentionStartPos);
    const afterMention = newComment.slice(mentionStartPos + mentionFilter.length + 1);
    const mentionText = user.display_name.includes(' ')
      ? `@"${user.display_name}" `
      : `@${user.display_name} `;
    setNewComment(beforeMention + mentionText + afterMention);
    setShowMentionDropdown(false);
  };

  // Handle keyboard navigation in mention dropdown
  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionDropdown || filteredMentionUsers.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % filteredMentionUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + filteredMentionUsers.length) % filteredMentionUsers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleSelectMention(filteredMentionUsers[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentionDropdown(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await cardsApi.update(card.id, {
        title,
        description,
        story_points: storyPoints ? parseInt(storyPoints) : null,
        priority,
        due_date: dueDate || null,
        time_estimate: timeEstimate ? parseInt(timeEstimate) : null,
        issue_type: issueType,
      });
      onUpdate({ ...updated, assignees, labels });
      setEditing(false);
      showToast('Card updated', 'success');
    } catch (err) {
      console.error('Failed to update card:', err);
      showToast('Failed to update card', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this card?')) return;
    try {
      await cardsApi.delete(card.id);
      onDelete(card.id);
      showToast('Card deleted', 'success');
    } catch (err) {
      console.error('Failed to delete card:', err);
      showToast('Failed to delete card', 'error');
    }
  };

  const handleSprintChange = async (sprintId: number | null) => {
    try {
      await cardsApi.assignToSprint(card.id, sprintId);
      onUpdate({ ...card, sprint_id: sprintId, assignees });
    } catch (err) {
      console.error('Failed to update sprint:', err);
      showToast('Failed to update sprint assignment', 'error');
    }
  };

  const handleAddAssignee = async (userId: number) => {
    try {
      await cardsApi.addAssignee(card.id, userId);
      const user = users.find((u) => u.id === userId);
      if (user) {
        const newAssignees = [...assignees, user];
        setAssignees(newAssignees);
        onUpdate({ ...card, assignees: newAssignees });
      }
    } catch (err) {
      console.error('Failed to add assignee:', err);
      showToast('Failed to add assignee', 'error');
    }
  };

  const handleRemoveAssignee = async (userId: number) => {
    try {
      await cardsApi.removeAssignee(card.id, userId);
      const newAssignees = assignees.filter((a) => a.id !== userId);
      setAssignees(newAssignees);
      onUpdate({ ...card, assignees: newAssignees });
    } catch (err) {
      console.error('Failed to remove assignee:', err);
      showToast('Failed to remove assignee', 'error');
    }
  };

  const unassignedUsers = users.filter((u) => !assignees.some((a) => a.id === u.id));

  const handleToggleLabel = async (label: Label) => {
    const isAssigned = labels.some((l) => l.id === label.id);
    try {
      if (isAssigned) {
        await cardsApi.removeLabel(card.id, label.id);
        const newLabels = labels.filter((l) => l.id !== label.id);
        setLabels(newLabels);
        onUpdate({ ...card, labels: newLabels, assignees });
      } else {
        await cardsApi.addLabel(card.id, label.id);
        const newLabels = [...labels, label];
        setLabels(newLabels);
        onUpdate({ ...card, labels: newLabels, assignees });
      }
    } catch (err) {
      console.error('Failed to toggle label:', err);
      showToast('Failed to update label', 'error');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSaveDescription = async () => {
    setSaving(true);
    try {
      const updated = await cardsApi.update(card.id, {
        title: card.title,
        description,
        story_points: card.story_points,
        priority: card.priority,
        due_date: card.due_date || null,
        time_estimate: card.time_estimate,
        issue_type: card.issue_type,
      });
      onUpdate({ ...updated, assignees, labels });
      setEditingDescription(false);
      showToast('Description updated', 'success');
    } catch (err) {
      console.error('Failed to update description:', err);
      showToast('Failed to update description', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card-detail-modal-unified" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="card-detail-header">
          <div className="card-detail-header-left">
            <span className="card-designator" style={{ color: swimlane.color }}>
              {swimlane.designator}{card.gitea_issue_id}
            </span>
            <span className={`card-issue-type issue-type-${card.issue_type || 'task'}`}>{card.issue_type || 'task'}</span>
            <span className={`card-state ${card.state}`}>{card.state}</span>
          </div>
          <div className="card-detail-actions">
            {editing ? (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={handleDelete}>Delete</button>
              </>
            )}
            <button className="btn btn-sm modal-close-btn" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="card-detail-unified-layout">
          {/* Main Content Area */}
          <div className="card-detail-main">
            {/* Title and Meta */}
            {editing ? (
              <div className="card-detail-edit">
                <div className="form-group">
                  <label>Title</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Issue Type</label>
                    <select value={issueType} onChange={(e) => setIssueType(e.target.value as any)}>
                      <option value="epic">Epic</option>
                      <option value="story">Story</option>
                      <option value="task">Task</option>
                      <option value="subtask">Subtask</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Priority</label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                      <option value="highest">Highest</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                      <option value="lowest">Lowest</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Story Points</label>
                    <input type="number" value={storyPoints} onChange={(e) => setStoryPoints(e.target.value)} min="0" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Due Date</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Time Estimate (minutes)</label>
                    <input type="number" value={timeEstimate} onChange={(e) => setTimeEstimate(e.target.value)} min="0" placeholder="e.g., 120" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <h2 className="card-detail-title">{card.title}</h2>
                <div className="card-detail-meta">
                  <span className={`card-priority priority-${card.priority}`}>{card.priority}</span>
                  {card.story_points !== null && <span className="card-points">{card.story_points} pts</span>}
                  {card.due_date && (
                    <span className={`card-due ${isOverdue(card.due_date) ? 'overdue' : ''}`}>
                      <Calendar size={14} /> {new Date(card.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Time Tracking Summary - Compact */}
            {!editing && (
              <div className="time-tracking-compact">
                <div className="time-tracking-header">
                  <Clock size={14} />
                  <span>Time Tracking</span>
                </div>
                <div className="time-tracking-stats">
                  <span className="time-logged">{formatTimeSpent(totalTimeLogged)} logged</span>
                  {card.time_estimate && (
                    <span className="time-estimate">/ {formatTimeSpent(card.time_estimate)} estimated</span>
                  )}
                </div>
                {card.time_estimate && card.time_estimate > 0 && (
                  <div className="time-progress-mini">
                    <div
                      className={`time-progress-bar ${totalTimeLogged > card.time_estimate ? 'over' : ''}`}
                      style={{ width: `${Math.min((totalTimeLogged / card.time_estimate) * 100, 100)}%` }}
                    />
                  </div>
                )}
                <div className="time-tracking-actions">
                  <input
                    type="number"
                    className="time-input-mini"
                    value={newWorkLogMinutes}
                    onChange={(e) => setNewWorkLogMinutes(e.target.value)}
                    placeholder="mins"
                    min="1"
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={(e) => { e.preventDefault(); handleAddWorkLog(e as any); }}
                    disabled={addingWorkLog || !newWorkLogMinutes}
                  >
                    {addingWorkLog ? '...' : 'Log'}
                  </button>
                </div>
              </div>
            )}

            {/* Description Section */}
            {!editing && (
              <div className="card-description-section">
                <div className="section-header">
                  <h3>Description</h3>
                  {!editingDescription && (
                    <button className="btn btn-sm" onClick={() => setEditingDescription(true)}>
                      {description ? 'Edit' : 'Add'}
                    </button>
                  )}
                </div>
                {editingDescription ? (
                  <div className="description-edit">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="Add a description..."
                      autoFocus
                    />
                    <div className="description-actions">
                      <button className="btn btn-primary btn-sm" onClick={handleSaveDescription} disabled={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button className="btn btn-sm" onClick={() => { setEditingDescription(false); setDescription(card.description); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={`description-text ${!description ? 'empty' : ''}`}>
                    {description || 'No description provided. Click Add to write one.'}
                  </p>
                )}
              </div>
            )}

            {/* Custom Fields */}
            {!editing && customFields.length > 0 && (
              <div className="custom-fields-compact">
                <h3>Custom Fields</h3>
                <div className="custom-fields-grid">
                  {customFields.map((field: any) => (
                    <div key={field.id} className="custom-field-inline">
                      <label>{field.name}</label>
                      {field.field_type === 'text' && (
                        <input
                          type="text"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                          onBlur={(e) => handleCustomFieldSave(field.id, e.target.value)}
                          placeholder={`Enter ${field.name}`}
                        />
                      )}
                      {field.field_type === 'number' && (
                        <input
                          type="number"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                          onBlur={(e) => handleCustomFieldSave(field.id, e.target.value)}
                        />
                      )}
                      {field.field_type === 'date' && (
                        <input
                          type="date"
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => { handleCustomFieldChange(field.id, e.target.value); handleCustomFieldSave(field.id, e.target.value); }}
                        />
                      )}
                      {field.field_type === 'select' && (
                        <select
                          value={customFieldValues[field.id] || ''}
                          onChange={(e) => { handleCustomFieldChange(field.id, e.target.value); handleCustomFieldSave(field.id, e.target.value); }}
                        >
                          <option value="">Select...</option>
                          {field.options && JSON.parse(field.options).map((opt: string) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                      {field.field_type === 'checkbox' && (
                        <input
                          type="checkbox"
                          checked={customFieldValues[field.id] === 'true'}
                          onChange={(e) => { const v = e.target.checked ? 'true' : 'false'; handleCustomFieldChange(field.id, v); handleCustomFieldSave(field.id, v); }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conversations Section - Main Area for more vertical room */}
            {!editing && (
              <div className="conversations-section conversations-main">
                <h3>Conversations</h3>
                <div className="comments-container">
                  {loadingComments ? (
                    <div className="loading-inline">Loading...</div>
                  ) : comments.length === 0 ? (
                    <p className="empty-text">No comments yet</p>
                  ) : (
                    <div className="comments-list-compact">
                      {comments.map((comment) => (
                        <div key={comment.id} className="comment-item-compact">
                          <div className="comment-header-compact">
                            {comment.user?.avatar_url ? (
                              <img src={comment.user.avatar_url} alt={comment.user.display_name} className="comment-avatar-small" />
                            ) : (
                              <div className="comment-avatar-small placeholder"><UserIcon size={12} /></div>
                            )}
                            <span className="comment-author">{comment.user?.display_name || 'Unknown'}</span>
                            <span className="comment-time">{formatDate(comment.created_at)}</span>
                          </div>
                          <p className="comment-body-compact">{renderCommentBody(comment.body)}</p>
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div className="comment-attachments">
                              {comment.attachments.map((att: any) => (
                                att.mime_type.startsWith('image/') ? (
                                  <img key={att.id} src={`/api/attachments/${att.id}`} alt={att.filename} className="comment-attachment-thumb" onClick={() => setViewingImage(`/api/attachments/${att.id}`)} style={{ cursor: 'pointer' }} />
                                ) : (
                                  <a key={att.id} href={`/api/attachments/${att.id}`} download={att.filename}>
                                    <span className="comment-attachment-file">📎 {att.filename}</span>
                                  </a>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <form className="comment-form-compact" onSubmit={handlePostComment}>
                  <div className="comment-input-wrapper">
                    <textarea
                      value={newComment}
                      onChange={handleCommentChange}
                      onKeyDown={handleCommentKeyDown}
                      onPaste={handleCommentPaste}
                      placeholder="Write a comment... (use @ to mention, paste images)"
                      rows={3}
                    />
                    {pendingImages.length > 0 && (
                      <div className="pending-images">
                        {pendingImages.map((img, index) => (
                          <div key={index} className="pending-image-item">
                            <img src={URL.createObjectURL(img)} alt={`Pending ${index + 1}`} onClick={() => setViewingImage(URL.createObjectURL(img))} style={{ cursor: 'pointer' }} />
                            <button type="button" className="remove-pending-image" onClick={() => setPendingImages(pendingImages.filter((_, i) => i !== index))}><X size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showMentionDropdown && filteredMentionUsers.length > 0 && (
                      <div className="mention-dropdown">
                        {filteredMentionUsers.slice(0, 5).map((user, index) => (
                          <div
                            key={user.id}
                            className={`mention-item ${index === mentionIndex ? 'selected' : ''}`}
                            onClick={() => handleSelectMention(user)}
                            onMouseEnter={() => setMentionIndex(index)}
                          >
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt={user.display_name} className="mention-avatar" />
                            ) : (
                              <div className="mention-avatar placeholder"><UserIcon size={12} /></div>
                            )}
                            <span className="mention-name">{user.display_name}</span>
                            <span className="mention-email">{user.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={postingComment || (!newComment.trim() && pendingImages.length === 0)}>
                    {postingComment ? '...' : 'Post'}
                  </button>
                </form>
              </div>
            )}

            {/* Activity Log */}
            <div className="activity-log-section">
              <h4>Activity</h4>
              {loadingActivities ? (
                <div className="loading-inline">Loading...</div>
              ) : activities.length === 0 ? (
                <p className="empty-text">No activity yet</p>
              ) : (
                <>
                  <div className="activity-timeline">
                    {activities.map((activity) => (
                      <div key={activity.id} className="activity-item">
                        <div className="activity-avatar">
                          {activity.user?.avatar_url ? (
                            <img src={activity.user.avatar_url} alt={activity.user.display_name} />
                          ) : (
                            <UserIcon size={14} />
                          )}
                        </div>
                        <div className="activity-content">
                          <span className="activity-user">{activity.user?.display_name || 'Unknown'}</span>
                          {' '}
                          <span className="activity-description">{formatActivityDescription(activity)}</span>
                          <span className="activity-time">{formatRelativeTime(activity.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {hasMoreActivities && (
                    <button className="btn btn-sm activity-show-more" onClick={() => loadActivities(activityOffset)}>
                      Show more
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Sidebar - Conversations + Metadata */}
          <div className="card-detail-right">
            {/* Metadata */}
            <div className="metadata-section">
              <div className="sidebar-section">
                <label>Labels</label>
                <div className="labels-list">
                  {boardLabels.length > 0 ? (
                    boardLabels.map((label) => {
                      const isAssigned = labels.some((l) => l.id === label.id);
                      return (
                        <button
                          key={label.id}
                          className={`label-toggle ${isAssigned ? 'assigned' : ''}`}
                          onClick={() => handleToggleLabel(label)}
                        >
                          <span className="label-color" style={{ backgroundColor: label.color }} />
                          <span className="label-name">{label.name}</span>
                          {isAssigned && <Check size={12} />}
                        </button>
                      );
                    })
                  ) : (
                    <p className="empty-text">No labels</p>
                  )}
                </div>
              </div>
              <div className="sidebar-section">
                <label>Assignees</label>
                <div className="assignees-list">
                  {assignees.map((assignee) => (
                    <div key={assignee.id} className="assignee-item">
                      <div className="assignee-avatar">
                        {assignee.avatar_url ? <img src={assignee.avatar_url} alt={assignee.display_name} /> : <UserIcon size={14} />}
                      </div>
                      <span className="assignee-name">{assignee.display_name}</span>
                      <button className="remove-assignee" onClick={() => handleRemoveAssignee(assignee.id)}><X size={12} /></button>
                    </div>
                  ))}
                  {unassignedUsers.length > 0 && (
                    <select className="add-assignee-select" value="" onChange={(e) => { if (e.target.value) handleAddAssignee(parseInt(e.target.value)); }}>
                      <option value="">Add assignee...</option>
                      {unassignedUsers.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="sidebar-section">
                <label>Sprint</label>
                <select value={card.sprint_id || ''} onChange={(e) => handleSprintChange(e.target.value ? parseInt(e.target.value) : null)}>
                  <option value="">Backlog</option>
                  {sprints.map((s) => <option key={s.id} value={s.id}>{s.name} {s.status === 'active' ? '(active)' : ''}</option>)}
                </select>
              </div>
            </div>

            {/* Attachments - Sidebar */}
            <div className="sidebar-section attachments-sidebar">
              <div className="section-header">
                <label>Attachments ({attachments.length})</label>
                <label className="btn btn-xs">
                  {uploadingAttachment ? '...' : '+'}
                  <input type="file" onChange={handleUploadAttachment} disabled={uploadingAttachment} style={{ display: 'none' }} />
                </label>
              </div>
              {loadingAttachments ? (
                <div className="loading-inline">Loading...</div>
              ) : attachments.length === 0 ? (
                <p className="empty-text">No attachments</p>
              ) : (
                <div className="attachments-list-sidebar">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attachment-item-sidebar">
                      {attachment.mime_type.startsWith('image/') ? (
                        <img src={`/api/attachments/${attachment.id}`} alt={attachment.filename} className="attachment-thumb-small" onClick={() => setViewingImage(`/api/attachments/${attachment.id}`)} style={{ cursor: 'pointer' }} />
                      ) : (
                        <span className="attachment-icon-tiny">📎</span>
                      )}
                      <a href={`/api/attachments/${attachment.id}`} download={attachment.filename} className="attachment-name-small">{attachment.filename}</a>
                      <button className="attachment-delete-tiny" onClick={() => handleDeleteAttachment(attachment.id)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Links - Sidebar */}
            <div className="sidebar-section links-sidebar">
              <div className="section-header">
                <label><LinkIcon size={14} /> Links ({cardLinks.length})</label>
                <button className="btn btn-xs" onClick={() => setShowAddLink(!showAddLink)}>
                  {showAddLink ? '-' : '+'}
                </button>
              </div>
              {showAddLink && (
                <div className="add-link-form">
                  <select
                    value={newLinkType}
                    onChange={(e) => setNewLinkType(e.target.value as LinkType)}
                    className="link-type-select"
                  >
                    <option value="blocks">Blocks</option>
                    <option value="is_blocked_by">Blocked By</option>
                    <option value="relates_to">Relates To</option>
                    <option value="duplicates">Duplicates</option>
                  </select>
                  <input
                    type="text"
                    value={linkSearchQuery}
                    onChange={(e) => setLinkSearchQuery(e.target.value)}
                    placeholder="Search cards..."
                    className="link-search-input"
                  />
                  {linkSearchResults.length > 0 && (
                    <div className="link-search-results">
                      {linkSearchResults.map((c) => (
                        <button
                          key={c.id}
                          className="link-search-result-item"
                          onClick={() => handleCreateLink(c.id)}
                        >
                          <span className="link-result-title">{c.title}</span>
                          <span className={`link-result-state ${c.state}`}>{c.state}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {loadingLinks ? (
                <div className="loading-inline">Loading...</div>
              ) : cardLinks.length === 0 && !showAddLink ? (
                <p className="empty-text">No links</p>
              ) : (
                <div className="links-list">
                  {Object.entries(groupedLinks).map(([label, items]) => (
                    <div key={label} className="link-group">
                      <div className="link-group-label">{label}</div>
                      {items.map(({ link, relatedCard }) => (
                        <div key={link.id} className="link-item">
                          <span className={`link-card-state ${relatedCard.state}`} />
                          <span className="link-card-title" title={relatedCard.title}>
                            {relatedCard.title}
                          </span>
                          <button
                            className="link-delete-btn"
                            onClick={() => handleDeleteLink(link.id)}
                            title="Remove link"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div className="image-viewer-overlay" onClick={() => setViewingImage(null)}>
          <button className="image-viewer-close" onClick={() => setViewingImage(null)}><X size={24} /></button>
          <img src={viewingImage} alt="Full size" className="image-viewer-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
