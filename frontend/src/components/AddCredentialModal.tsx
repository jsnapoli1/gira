import { useState } from 'react';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { credentials } from '../api/client';

interface AddCredentialModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function AddCredentialModal({ onClose, onSaved }: AddCredentialModalProps) {
  const [provider, setProvider] = useState<'gitea' | 'github'>('gitea');
  const [providerUrl, setProviderUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState('');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');

    try {
      const result = await credentials.test({
        provider,
        provider_url: provider === 'gitea' ? providerUrl : undefined,
        api_token: apiToken,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      await credentials.create({
        provider,
        provider_url: provider === 'gitea' ? providerUrl : undefined,
        api_token: apiToken,
        display_name: displayName || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setSaving(false);
    }
  };

  const isValid = apiToken && (provider === 'github' || providerUrl);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content credential-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add API Credential</h2>
          <button className="btn btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="provider-tabs">
            <button
              className={`provider-tab ${provider === 'gitea' ? 'active' : ''}`}
              onClick={() => {
                setProvider('gitea');
                setTestResult(null);
              }}
            >
              Gitea
            </button>
            <button
              className={`provider-tab ${provider === 'github' ? 'active' : ''}`}
              onClick={() => {
                setProvider('github');
                setTestResult(null);
              }}
            >
              GitHub
            </button>
          </div>

          <form onSubmit={e => { e.preventDefault(); handleSave(); }} className="credential-form">
            {provider === 'gitea' && (
              <div className="form-group">
                <label htmlFor="providerUrl">Gitea URL</label>
                <input
                  id="providerUrl"
                  type="url"
                  value={providerUrl}
                  onChange={e => setProviderUrl(e.target.value)}
                  placeholder="https://gitea.example.com"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="apiToken">API Token</label>
              <input
                id="apiToken"
                type="password"
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder={provider === 'github' ? 'ghp_xxxx...' : 'Your API token'}
                required
              />
              <small>
                {provider === 'github'
                  ? 'Generate a Personal Access Token in GitHub Settings > Developer settings'
                  : 'Generate an API token in your Gitea Settings > Applications'}
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="displayName">Display Name (optional)</label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={provider === 'github' ? 'My GitHub' : 'Work Gitea'}
              />
            </div>

            {testResult && (
              <div className={`status-badge ${testResult.success ? 'success' : 'error'}`}>
                {testResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                <span>{testResult.message}</span>
              </div>
            )}

            {error && (
              <div className="status-badge error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTest}
                disabled={!isValid || testing}
              >
                {testing ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!isValid || saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
