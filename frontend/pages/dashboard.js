import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
const TOKEN_STORAGE = 'hubspot_audit_auth_token';
const PORTAL_ID_STORAGE = 'hubspot_audit_portal_id';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [audits, setAudits] = useState([]);
  const [portalId, setPortalId] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_STORAGE);
    if (!storedToken) {
      router.replace('/login');
      return;
    }

    setToken(storedToken);
    setPortalId(window.localStorage.getItem(PORTAL_ID_STORAGE) || '');
    loadDashboard(storedToken);
  }, [router]);

  async function loadDashboard(authToken) {
    setStatus('loading');
    setError('');

    try {
      const [meResponse, auditsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: authHeaders(authToken)
        }),
        fetch(`${API_BASE_URL}/api/audit?summary=1`, {
          headers: authHeaders(authToken)
        })
      ]);

      const meBody = await meResponse.json();
      const auditsBody = await auditsResponse.json();

      if (!meResponse.ok) throw new Error(meBody.error?.message || 'Session expired');
      if (!auditsResponse.ok) throw new Error(auditsBody.error?.message || 'Could not load audits');

      setUser(meBody.data.user);
      setAudits(auditsBody.data.audits);
      setStatus('ready');
    } catch (loadError) {
      setError(loadError.message);
      setStatus('ready');
    }
  }

  async function connectHubSpot() {
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/hubspot/connect-url`, {
        headers: authHeaders(token)
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error?.message || 'Could not create HubSpot connect URL');
      }

      window.location.href = body.data.url;
    } catch (connectError) {
      setError(connectError.message);
    }
  }

  async function runAudit() {
    setStatus('running');
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/audit/run`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({})
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error?.message || 'Audit failed');
      }

      router.push(`/audit/${body.data.id}`);
    } catch (runError) {
      setError(runError.message);
      setStatus('ready');
    }
  }

  function logout() {
    window.localStorage.removeItem(TOKEN_STORAGE);
    router.replace('/login');
  }

  return (
    <>
      <header className="heroBand">
        <div className="heroInner">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{user ? user.email : 'Audit workspace'}</h1>
            <div className="heroMeta">
              <span className="heroPill">{portalId ? `Portal ${portalId}` : 'No portal connected'}</span>
              <span className="heroPill">{audits.length} reports</span>
            </div>
          </div>
          <button className="secondaryButton" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main className="shell">
        <section className="actions">
          <div>
            <h2>HubSpot connection</h2>
            <p>{portalId ? `Connected portal ${portalId}` : 'Connect HubSpot before running an audit.'}</p>
          </div>
          <div className="buttonRow">
            <button className="secondaryButton" type="button" onClick={connectHubSpot}>
              Connect HubSpot
            </button>
            <button
              className="primaryButton"
              type="button"
              onClick={runAudit}
              disabled={status === 'running'}
            >
              {status === 'running' ? 'Running audit' : 'Run Audit'}
            </button>
          </div>
        </section>

        {error ? <p className="error">{error}</p> : null}

        <section className="panel">
          <div className="panelHeader">
            <h2>Audit history</h2>
            <span>{audits.length} reports</span>
          </div>
          <div className="issueList">
            {audits.map((audit) => (
              <article className="issue" key={audit.id}>
                <span className={`severity ${audit.score >= 60 ? 'low' : 'high'}`}>{audit.score}</span>
                <p>
                  Audit #{audit.id} | {audit.issue_count} issues | ${audit.waste_estimate}
                </p>
                <small>
                  <a href={`/audit/${audit.id}`}>Open</a>
                </small>
              </article>
            ))}
            {audits.length === 0 ? (
              <article className="issue">
                <span className="severity low">new</span>
                <p>No audits yet.</p>
                <small>Run one</small>
              </article>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
