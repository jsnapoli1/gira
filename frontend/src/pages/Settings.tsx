import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { config, credentials } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Check, AlertCircle, Plus, Trash2, Key } from 'lucide-react';
import { AddCredentialModal } from '../components/AddCredentialModal';
import type { UserCredential } from '../types';

export function Settings() {
  const { user } = useAuth();
  const [giteaUrl, setGiteaUrl] = useState('');
  const [giteaApiKey, setGiteaApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // User credentials state
  const [userCredentials, setUserCredentials] = useState<UserCredential[]>([]);
  const [showAddCredential, setShowAddCredential] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    loadConfig();
    loadCredentials();
  }, []);

  const loadConfig = async () => {
    try {
      const status = await config.getStatus();
      setConfigured(status.configured);
      if (status.gitea_url) {
        setGiteaUrl(status.gitea_url);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  const loadCredentials = async () => {
    try {
      const creds = await credentials.list();
      setUserCredentials(creds || []);
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  };

  const handleDeleteCredential = async (id: number) => {
    if (!confirm('Are you sure you want to delete this credential?')) return;
    setDeletingId(id);
    try {
      await credentials.delete(id);
      setUserCredentials(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete credential:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      await config.save(giteaUrl, giteaApiKey);
      setConfigured(true);
      setSuccess(true);
      setGiteaApiKey(''); // Clear key from UI for security
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="settings-page">
        <div className="page-header">
          <h1>Settings</h1>
        </div>

        <div className="settings-content">
          {/* User Profile */}
          <section className="settings-section">
            <h2>Profile</h2>
            <div className="profile-card">
              <div className="profile-avatar">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={user.display_name} />
                ) : (
                  <div className="avatar-placeholder">
                    {user?.display_name?.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="profile-info">
                <h3>{user?.display_name}</h3>
                <p>{user?.email}</p>
              </div>
            </div>
          </section>

          {/* User API Credentials */}
          <section className="settings-section">
            <h2>Your API Credentials</h2>
            <p className="section-description">
              Connect your personal Gitea or GitHub accounts to access private repositories.
              These credentials are used when no swimlane-specific credentials are set.
            </p>

            {userCredentials.length > 0 ? (
              <div className="credentials-list">
                {userCredentials.map(cred => (
                  <div key={cred.id} className="credential-item">
                    <div className="credential-info">
                      <div className="credential-icon">
                        <Key size={20} />
                      </div>
                      <div className="credential-details">
                        <span className="credential-name">
                          {cred.display_name || (cred.provider === 'github' ? 'GitHub' : cred.provider_url)}
                        </span>
                        <span className="credential-provider">
                          {cred.provider === 'github' ? 'GitHub' : `Gitea - ${cred.provider_url}`}
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => handleDeleteCredential(cred.id)}
                      disabled={deletingId === cred.id}
                      title="Delete credential"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No API credentials configured yet.</p>
            )}

            <button
              className="btn btn-secondary"
              onClick={() => setShowAddCredential(true)}
            >
              <Plus size={16} />
              Add Credential
            </button>
          </section>

          {/* Gitea Configuration (Admin Only) */}
          {user?.is_admin && (
          <section className="settings-section">
            <h2>Global Gitea Connection</h2>
            <p className="section-description">
              Configure the default Gitea instance for all users. This is used as a fallback
              when users don't have their own credentials configured.
            </p>

            {configured && (
              <div className="status-badge success">
                <Check size={16} />
                <span>Connected to Gitea</span>
              </div>
            )}

            {error && (
              <div className="status-badge error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="status-badge success">
                <Check size={16} />
                <span>Configuration saved successfully</span>
              </div>
            )}

            <form onSubmit={handleSave} className="settings-form">
              <div className="form-group">
                <label htmlFor="giteaUrl">Gitea URL</label>
                <input
                  id="giteaUrl"
                  type="url"
                  value={giteaUrl}
                  onChange={(e) => setGiteaUrl(e.target.value)}
                  placeholder="https://gitea.example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="giteaApiKey">API Key</label>
                <input
                  id="giteaApiKey"
                  type="password"
                  value={giteaApiKey}
                  onChange={(e) => setGiteaApiKey(e.target.value)}
                  placeholder={configured ? '••••••••' : 'Your Gitea API key'}
                  required={!configured}
                />
                <small>
                  {configured
                    ? 'Leave blank to keep current key, or enter a new one to update'
                    : 'Generate an API key in your Gitea settings'}
                </small>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : configured ? 'Update Configuration' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </section>
          )}

          {/* About */}
          <section className="settings-section">
            <h2>About Zira</h2>
            <div className="about-info">
              <p>
                <strong>Version:</strong> 1.0.0
              </p>
              <p>
                Zira is a Jira-like project management tool that integrates with Gitea for issue
                tracking.
              </p>
            </div>
          </section>
        </div>
      </div>

      {showAddCredential && (
        <AddCredentialModal
          onClose={() => setShowAddCredential(false)}
          onSaved={loadCredentials}
        />
      )}
    </Layout>
  );
}
