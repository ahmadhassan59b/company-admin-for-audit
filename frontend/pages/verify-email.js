import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export default function VerifyEmail() {
  const router = useRouter();
  const [status, setStatus] = useState('Checking link...');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;

    const token = String(router.query.token || '').trim();
    if (!token) {
      setStatus('');
      setError('The verification link is missing its token.');
      return;
    }

    async function verify() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error?.message || 'Verification link is invalid or expired');
        }

        setStatus('Your email has been verified. Redirecting to login...');
        window.setTimeout(() => {
          router.replace('/login?verified=1');
        }, 1200);
      } catch (verifyError) {
        setStatus('');
        setError(verifyError.message);
      }
    }

    verify();
  }, [router.isReady, router.query.token, router]);

  return (
    <main className="authHero">
      <div className="authImage" />
      <section className="authPanel">
        <p className="eyebrow">HubSpot Portal Audit</p>
        <h1>Verify email</h1>
        {status ? <p style={{ marginTop: 16, lineHeight: 1.6 }}>{status}</p> : null}
        {error ? (
          <div className="error" style={{ marginTop: 16, marginBottom: 0 }}>
            {error}
          </div>
        ) : null}
        <div className="buttonRow" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <a className="secondaryButton" href="/login" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Go to login
          </a>
        </div>
      </section>
    </main>
  );
}
