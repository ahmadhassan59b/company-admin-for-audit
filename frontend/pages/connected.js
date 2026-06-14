const CLIENT_KEY_STORAGE = 'hubspot_audit_client_key';
const PORTAL_ID_STORAGE = 'hubspot_audit_portal_id';

export default function Connected() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const accountKey = params.get('accountKey');
    const portalId = params.get('portalId');

    if (accountKey) {
      window.localStorage.setItem(CLIENT_KEY_STORAGE, accountKey);
    }

    if (portalId) {
      window.localStorage.setItem(PORTAL_ID_STORAGE, portalId);
    }

    window.location.replace('/admin');
  }

  return (
    <main className="shell">
      <section className="actions">
        <div>
          <p className="eyebrow">Connected</p>
          <h1>Returning to your audit workspace</h1>
        </div>
      </section>
    </main>
  );
}
