import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = window.localStorage.getItem('hubspot_audit_auth_token');
    router.replace(token ? '/admin' : '/login');
  }, [router]);

  return (
    <main className="shell">
      <section className="actions">
        <div>
          <p className="eyebrow">HubSpot Portal Audit</p>
          <h1>Loading workspace</h1>
        </div>
      </section>
    </main>
  );
}
