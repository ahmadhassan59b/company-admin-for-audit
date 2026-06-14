import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
const TOKEN_STORAGE = 'hubspot_audit_auth_token';
const CLIENT_KEY_STORAGE = 'hubspot_audit_client_key';

export default function Login() {
  const router = useRouter();
  const googleButtonRef = useRef(null);
  const googleScriptLoadedRef = useRef(false);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState('info');
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const token = router.query.token;
    if (typeof token === 'string' && token) {
      window.localStorage.setItem(TOKEN_STORAGE, token);
      router.replace('/admin');
      return;
    }
    if (router.query.verified === '1') {
      showNotice('Email verified. You can log in now.', 'success');
    }
  }, [router.isReady, router.query.token, router.query.verified, router]);

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;

    async function loadGoogleConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/google-config`);
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          return;
        }

        const clientId = String(body?.data?.clientId || '').trim();
        if (!cancelled && clientId) {
          setGoogleClientId(clientId);
        }
      } catch (_error) {
        // Google sign-in is optional. Ignore config fetch failures.
      }
    }

    loadGoogleConfig();

    return () => {
      cancelled = true;
    };
  }, [router.isReady]);

  useEffect(() => {
    if (!googleClientId || typeof window === 'undefined') return undefined;

    let cancelled = false;

    async function loadScript() {
      if (window.google?.accounts?.id) {
        return;
      }

      if (googleScriptLoadedRef.current) {
        return new Promise((resolve, reject) => {
          const interval = window.setInterval(() => {
            if (window.google?.accounts?.id) {
              window.clearInterval(interval);
              resolve();
            }
          }, 50);

          window.setTimeout(() => {
            window.clearInterval(interval);
            reject(new Error('Google sign-in script failed to load'));
          }, 10000);
        });
      }

      googleScriptLoadedRef.current = true;

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Google sign-in script failed to load'));
        document.head.appendChild(script);
      });
    }

    async function initializeButton() {
      try {
        await loadScript();
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            try {
              setError('');
              setLoading(true);
              const credential = String(response?.credential || '').trim();
              if (!credential) {
                throw new Error('Google sign-in did not return a credential.');
              }

              const authResponse = await fetch(`${API_BASE_URL}/api/auth/google`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ credential })
              });
              const body = await authResponse.json().catch(() => ({}));

              if (!authResponse.ok) {
                throw new Error(body.error?.message || 'Google sign-in failed');
              }

              if (body.data?.token) {
                window.localStorage.setItem(TOKEN_STORAGE, body.data.token);
                router.push('/admin');
                return;
              }

              throw new Error('Google sign-in did not return a session token.');
            } catch (googleError) {
              setError(googleError.message || 'Google sign-in failed');
            } finally {
              setLoading(false);
            }
          }
        });

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          width: 320,
          logo_alignment: 'left'
        });
      } catch (googleInitError) {
        if (!cancelled) {
          setError(googleInitError.message || 'Google sign-in is unavailable right now.');
        }
      }
    }

    initializeButton();

    return () => {
      cancelled = true;
    };
  }, [googleClientId, router]);

  function showNotice(message, kind = 'info') {
    setNotice(message);
    setNoticeKind(kind);
  }

  async function resendVerification(nextEmail = pendingVerificationEmail || email) {
    const targetEmail = String(nextEmail || '').trim();
    if (!targetEmail) {
      setError('Enter your email address first.');
      return;
    }

    setError('');
    setResending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: targetEmail })
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error?.message || 'Unable to resend verification email');
      }

      if (body.data?.verificationRequired === false) {
        setPendingVerificationEmail('');
        showNotice('That account is already verified. You can log in now.', 'success');
      } else {
        setPendingVerificationEmail(targetEmail);
        showNotice('If that account is still pending verification, a new link was sent.', 'success');
      }
    } catch (resendError) {
      setError(resendError.message);
    } finally {
      setResending(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          tenantName,
          clientKey: window.localStorage.getItem(CLIENT_KEY_STORAGE)
        })
      });
      const body = await response.json();

      if (!response.ok) {
        const error = new Error(body.error?.message || 'Authentication failed');
        error.body = body;
        throw error;
      }

      if (body.data.token) {
        window.localStorage.setItem(TOKEN_STORAGE, body.data.token);
        router.push('/admin');
        return;
      }

      setPendingVerificationEmail(email);
      setMode('login');
      setPassword('');
      setTenantName('');
      showNotice(
        'Your account is created but not active yet. Check your inbox and click the verification link before logging in.',
        'success'
      );
    } catch (authError) {
      const errorCode = authError?.body?.error?.code || '';
      if (errorCode === 'email_not_verified') {
        setPendingVerificationEmail(email);
        showNotice('Your email address is not verified yet. Check your inbox or resend the link.', 'warning');
        setError('');
        return;
      }

      setError(authError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleModeChange() {
    setError('');
    setNotice('');
    setPendingVerificationEmail('');
    setMode(mode === 'login' ? 'register' : 'login');
  }

  return (
    <main className="authHero">
      <div className="authImage" />
      <section className="authPanel">
        <p className="eyebrow">HubSpot Portal Audit</p>
        <h1>{mode === 'login' ? 'Log in' : 'Create workspace'}</h1>
        <form className="authForm" onSubmit={submit}>
          {mode === 'register' ? (
            <input
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
              placeholder="Company name"
            />
          ) : null}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            required
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            minLength={8}
            required
          />
          <button className="primaryButton" type="submit" disabled={loading}>
            {loading ? 'Please wait' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        {googleClientId ? (
          <div style={{ marginTop: '14px', display: 'grid', gap: '10px', justifyItems: 'center' }}>
            <div style={{ width: '100%', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
              Or continue with Google
            </div>
            <div ref={googleButtonRef} style={{ minHeight: '44px', display: 'flex', justifyContent: 'center' }} />
          </div>
        ) : null}
        <button className="linkButton" type="button" onClick={handleModeChange}>
          {mode === 'login' ? 'Create a new workspace' : 'I already have an account'}
        </button>
        {notice ? (
          <div
            style={{
              marginTop: '14px',
              padding: '14px',
              borderRadius: '8px',
              border: `1px solid ${
                noticeKind === 'success'
                  ? 'rgba(21, 128, 61, 0.22)'
                  : 'rgba(202, 138, 4, 0.26)'
              }`,
              background:
                noticeKind === 'success'
                  ? 'rgba(21, 128, 61, 0.08)'
                  : 'rgba(202, 138, 4, 0.08)',
              color: 'var(--navy)',
              lineHeight: 1.5
            }}
          >
            <p>{notice}</p>
            {pendingVerificationEmail ? (
              <div className="buttonRow" style={{ justifyContent: 'flex-start', marginTop: '10px' }}>
                <button className="secondaryButton" type="button" onClick={() => resendVerification()}>
                  {resending ? 'Sending...' : 'Resend verification email'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
