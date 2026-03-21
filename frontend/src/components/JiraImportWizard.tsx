import { useState, useEffect } from 'react';
import { imports, boards as boardsApi, repos as reposApi } from '../api/client';
import type { Board, Repository, Swimlane, JiraProjectPreview, JiraProjectMapping, GlobalImportResult } from '../types';
import { Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';

interface JiraImportWizardProps {
  boards: Board[];
  onClose: () => void;
  onComplete: () => void;
}

type Step = 'upload' | 'mapping' | 'results';

interface MappingRow {
  projectKey: string;
  count: number;
  boardId: number | 'new';
  newBoardName: string;
  boardTemplate: string;
  swimlaneId: number | 'new';
  newSwimlaneName: string;
  repoFullName: string;
  designator: string;
  label: string;
  color: string;
}

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

export function JiraImportWizard({ boards, onClose, onComplete }: JiraImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [, setProjects] = useState<JiraProjectPreview[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [boardSwimlanes, setBoardSwimlanes] = useState<Record<number, Swimlane[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GlobalImportResult | null>(null);

  useEffect(() => {
    reposApi.getRepos().then(setRepos).catch(() => {});
  }, []);

  const handleFileUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const data = await imports.previewJira(file);
      setProjects(data.projects || []);
      const initialMappings: MappingRow[] = (data.projects || []).map((p, i) => ({
        projectKey: p.key,
        count: p.count,
        boardId: 'new' as const,
        newBoardName: p.key + ' Board',
        boardTemplate: '',
        swimlaneId: 'new' as const,
        newSwimlaneName: p.key,
        repoFullName: '',
        designator: p.key + '-',
        label: p.key,
        color: COLORS[i % COLORS.length],
      }));
      setMappings(initialMappings);
      setStep('mapping');
    } catch (err: any) {
      setError(err.message || 'Failed to preview CSV');
    } finally {
      setLoading(false);
    }
  };

  const loadSwimlanesForBoard = async (boardId: number) => {
    if (boardSwimlanes[boardId]) return;
    try {
      const sls = await boardsApi.getSwimlanes(boardId);
      setBoardSwimlanes(prev => ({ ...prev, [boardId]: sls }));
    } catch {
      // ignore
    }
  };

  const updateMapping = (index: number, updates: Partial<MappingRow>) => {
    setMappings(prev => prev.map((m, i) => i === index ? { ...m, ...updates } : m));
  };

  const handleBoardChange = async (index: number, value: string) => {
    if (value === 'new') {
      updateMapping(index, { boardId: 'new', swimlaneId: 'new' });
    } else {
      const boardId = Number(value);
      updateMapping(index, { boardId, swimlaneId: 'new' });
      await loadSwimlanesForBoard(boardId);
    }
  };

  const handleExecuteImport = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const apiMappings: JiraProjectMapping[] = mappings.map(m => ({
        project_key: m.projectKey,
        board_id: m.boardId === 'new' ? 0 : m.boardId,
        swimlane_id: m.swimlaneId === 'new' ? 0 : m.swimlaneId,
        create_board: m.boardId === 'new',
        new_board_name: m.newBoardName,
        board_template: m.boardTemplate,
        create_swimlane: m.swimlaneId === 'new',
        new_swimlane_name: m.newSwimlaneName,
        repo_owner: m.repoFullName.split('/')[0] || '',
        repo_name: m.repoFullName.split('/')[1] || '',
        designator: m.designator,
        label: m.label,
        color: m.color,
      }));
      const importResult = await imports.executeJira(file, apiMappings);
      setResult(importResult);
      setStep('results');
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal jira-import-wizard-modal" onClick={e => e.stopPropagation()}>
        <h2>Import from Jira</h2>

        {error && <div className="error-message">{error}</div>}

        {step === 'upload' && (
          <div className="jira-import-step">
            <p>Upload a Jira CSV export file. The wizard will detect all project keys and let you map them to boards.</p>
            <div className="form-group">
              <label>CSV File</label>
              <input
                type="file"
                accept=".csv"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!file || loading}
                onClick={handleFileUpload}
              >
                {loading ? <><Loader size={16} className="spin" /> Analyzing...</> : <><Upload size={16} /> Analyze CSV</>}
              </button>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="jira-import-step">
            <p>Map each Jira project to a board and swimlane.</p>
            <div className="jira-import-mapping-table-wrapper">
              <table className="jira-import-mapping-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Issues</th>
                    <th>Board</th>
                    <th>Swimlane</th>
                    <th>Repository</th>
                    <th>Color</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m, i) => (
                    <tr key={m.projectKey}>
                      <td><strong>{m.projectKey}</strong></td>
                      <td>{m.count}</td>
                      <td>
                        <select
                          value={m.boardId}
                          onChange={e => handleBoardChange(i, e.target.value)}
                        >
                          <option value="new">+ Create new board</option>
                          {boards.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        {m.boardId === 'new' && (
                          <input
                            type="text"
                            value={m.newBoardName}
                            onChange={e => updateMapping(i, { newBoardName: e.target.value })}
                            placeholder="Board name"
                            className="jira-import-inline-input"
                          />
                        )}
                      </td>
                      <td>
                        <select
                          value={m.swimlaneId}
                          onChange={e => updateMapping(i, { swimlaneId: e.target.value === 'new' ? 'new' : Number(e.target.value) })}
                        >
                          <option value="new">+ Create new swimlane</option>
                          {m.boardId !== 'new' && (boardSwimlanes[m.boardId] || []).map(sl => (
                            <option key={sl.id} value={sl.id}>{sl.name}</option>
                          ))}
                        </select>
                        {m.swimlaneId === 'new' && (
                          <>
                            <input
                              type="text"
                              value={m.newSwimlaneName}
                              onChange={e => updateMapping(i, { newSwimlaneName: e.target.value })}
                              placeholder="Swimlane name"
                              className="jira-import-inline-input"
                            />
                            <input
                              type="text"
                              value={m.designator}
                              onChange={e => updateMapping(i, { designator: e.target.value })}
                              placeholder="Designator (e.g. PROJ-)"
                              className="jira-import-inline-input"
                            />
                          </>
                        )}
                      </td>
                      <td>
                        {m.swimlaneId === 'new' && (
                          repos.length > 0 ? (
                            <select
                              value={m.repoFullName}
                              onChange={e => updateMapping(i, { repoFullName: e.target.value })}
                            >
                              <option value="">No repo</option>
                              {repos.map(r => (
                                <option key={r.id} value={r.full_name}>{r.full_name}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={m.repoFullName}
                              onChange={e => updateMapping(i, { repoFullName: e.target.value })}
                              placeholder="owner/repo"
                              className="jira-import-inline-input"
                            />
                          )
                        )}
                      </td>
                      <td>
                        <div className="color-picker">
                          {COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              className={`color-option ${m.color === c ? 'selected' : ''}`}
                              style={{ backgroundColor: c }}
                              onClick={() => updateMapping(i, { color: c })}
                            />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setStep('upload')}>Back</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || mappings.length === 0}
                onClick={handleExecuteImport}
              >
                {loading ? <><Loader size={16} className="spin" /> Importing...</> : <>Import {mappings.reduce((s, m) => s + m.count, 0)} issues</>}
              </button>
            </div>
          </div>
        )}

        {step === 'results' && result && (
          <div className="jira-import-step">
            <div className="jira-import-results-summary">
              <CheckCircle size={24} className="text-success" />
              <span>Imported {result.total_imported} cards total</span>
            </div>
            <table className="jira-import-mapping-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Imported</th>
                  <th>Sprints</th>
                  <th>Labels</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {result.projects.map(p => (
                  <tr key={p.key}>
                    <td><strong>{p.key}</strong></td>
                    <td>{p.imported}</td>
                    <td>{p.sprints_created}</td>
                    <td>{p.labels_created}</td>
                    <td>
                      {p.errors && p.errors.length > 0 ? (
                        <span className="text-error" title={p.errors.join('\n')}>
                          <AlertCircle size={14} /> {p.errors.length}
                        </span>
                      ) : (
                        <span className="text-success">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => { onComplete(); onClose(); }}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
