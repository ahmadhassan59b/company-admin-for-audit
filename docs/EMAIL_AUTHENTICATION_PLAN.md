# Email Authentication Plan

This project currently has a working login/signup flow, but it does **not** prove that a user owns the email address they typed.

If someone signs up with `test@gmail.com`, the app will create the account as long as:

- the email is syntactically valid
- the password is at least 8 characters
- the email does not already exist in the database

That means the current system is **email/password authentication**, not **email verification**.

## What Happens Today

### Signup

Current backend behavior lives in:

- [`src/services/auth/auth.service.js`](../src/services/auth/auth.service.js)
- [`src/controllers/auth-api.controller.js`](../src/controllers/auth-api.controller.js)
- [`src/routes/auth-api.routes.js`](../src/routes/auth-api.routes.js)

The signup flow:

1. Normalizes the email with `trim().toLowerCase()`.
2. Checks only that the email is present and the password is 8+ characters.
3. Rejects duplicate emails.
4. Inserts a new tenant.
5. Inserts the new user with a hashed password.
6. Issues a JWT immediately.

There is no step that sends a verification email, checks a one-time code, or confirms Gmail ownership.

### Login

The login flow:

1. Looks up the user by email.
2. Verifies the password hash.
3. If 2FA is enabled, asks for a TOTP code.
4. Issues a JWT.

Again, this proves the user knows the password, not that they own the email inbox.

### Frontend

The login screen in [`ui-static/login.html`](../ui-static/login.html) only collects:

- email
- password
- optional 2FA code

It does not ask for or confirm email verification.

## Why `test@gmail.com` Works

Because Gmail ownership is not checked at all.

The system treats `test@gmail.com` as just another identifier. If the password is correct, login succeeds. If the email is new, signup succeeds.

This is normal for a basic auth system, but it is not enough if you want to be sure the user controls that inbox.

## What “Proper Authentication” Should Mean

For this app, a proper system should separate these concerns:

### 1. Identity

The user logs in with email and password, or with a third-party provider like Google.

### 2. Email ownership

The app verifies that the email address belongs to the person signing up.

### 3. Session security

The app uses secure sessions or secure tokens so login state is not easy to steal.

### 4. Account recovery

The user can reset their password safely.

### 5. Extra protection

Optional 2FA, rate limiting, and audit logs for sensitive events.

## Recommended Fix

If you want users to sign up with email/password, add **email verification**.

If you want stronger identity and less password handling, add **Google OAuth / Sign in with Google**.

For this app, the best practical setup is:

1. Email/password signup.
2. Verification email before the account becomes active.
3. Optional Google login later.
4. 2FA for higher-security workspaces.

## Minimum Secure Architecture

### Tables

Your current `users` table comes from:

- [`src/db/migrations/003_auth_multi_tenant.sql`](../src/db/migrations/003_auth_multi_tenant.sql)

It currently contains:

- `id`
- `email`
- `password_hash`
- `tenant_id`
- `created_at`

It does **not** contain email verification or password reset fields.

Add columns or new tables for:

- `email_verified_at`
- `email_verification_token_hash`
- `email_verification_token_expires_at`
- `password_reset_token_hash`
- `password_reset_token_expires_at`
- `password_reset_requested_at`
- optional `last_login_at`
- optional `failed_login_count`
- optional `locked_until`

### Signup Flow

Recommended signup flow:

1. User submits email, password, and workspace name.
2. Create the tenant and user with `email_verified_at = NULL`.
3. Generate a random verification token.
4. Store only a hash of that token in the database.
5. Send a verification email with a link.
6. Mark the account verified only after the link is opened.
7. Do not issue a normal login session until verification is complete, or issue a limited session that only allows email verification.

### Verification Flow

Create endpoints like:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/resend-verification`
- `GET /api/auth/verify-email?token=...`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`

Recommended behavior:

- If the user exists but `email_verified_at` is null, login should return a clear `email_not_verified` error.
- The frontend should show a “check your inbox” message.
- Verification tokens should expire quickly, such as 30 to 60 minutes.
- Resend should be rate-limited.

### Session Security

The current app stores JWTs in `localStorage` on the frontend. That is simple, but it is weaker than cookie-based sessions because XSS can steal the token.

Safer options:

- `httpOnly` secure cookies for session tokens
- short-lived access tokens with refresh tokens in `httpOnly` cookies
- server-side session storage

For a SaaS app, `httpOnly` cookies are usually the better default.

## Suggested Implementation Order

### Phase 1: Email verification

Goal: stop unverified email addresses from becoming active accounts.

Work:

1. Add verification fields to `users` or a separate `user_verifications` table.
2. Add token generation and hashing helpers.
3. Add mail sending support.
4. Block login until `email_verified_at` is set.
5. Add resend verification endpoint.
6. Add a verification page in the frontend.

### Phase 2: Password reset

Goal: support account recovery.

Work:

1. Add reset token storage.
2. Add reset request endpoint.
3. Add reset confirmation endpoint.
4. Build a reset password UI.

### Phase 3: Harden sessions

Goal: reduce token theft risk.

Work:

1. Move auth tokens out of `localStorage`.
2. Use secure `httpOnly` cookies.
3. Add logout that clears the cookie.
4. Add refresh-token rotation if needed.

### Phase 4: Add Google login

Goal: let users authenticate with their real Google account.

Work:

1. Add Google OAuth.
2. Link Google identity to local user accounts.
3. Decide whether Google login replaces password login or sits beside it.

## Backend Changes Needed

Update these files first:

- [`src/services/auth/auth.service.js`](../src/services/auth/auth.service.js)
- [`src/services/auth/token.service.js`](../src/services/auth/token.service.js)
- [`src/controllers/auth-api.controller.js`](../src/controllers/auth-api.controller.js)
- [`src/routes/auth-api.routes.js`](../src/routes/auth-api.routes.js)
- [`ui-static/login.html`](../ui-static/login.html)
- [`ui-static/app.js`](../ui-static/app.js)
- database migration files under [`src/db/migrations`](../src/db/migrations)

### Auth service changes

In `register`:

- hash a verification token
- save it with an expiry
- do not treat the account as verified yet
- send a verification email

In `login`:

- reject unverified accounts
- return a specific error code, such as `email_not_verified`
- optionally support resend verification from the frontend

### Token changes

Current tokens are signed JWT-like tokens. If you keep this approach, at minimum:

- shorten access token lifetime
- rotate tokens if you add refresh tokens
- do not trust token contents alone for user state that can change, such as verification or role

## Frontend Changes Needed

The login page should handle three states:

1. Login
2. Register
3. Email verification pending

Recommended UX:

- after signup, show: “Check your inbox to verify your email”
- include a resend button
- after clicking the verification link, redirect to login or auto-login

## Security Notes

### Do not rely on email format alone

`test@gmail.com` is valid text, but that does not prove ownership.

### Do not store verification tokens in plain text

Store a hash of the token in the database, just like a password reset token.

### Make verification tokens short-lived

If a token leaks, it should expire quickly.

### Rate-limit auth endpoints

At minimum rate-limit:

- signup
- login
- resend verification
- forgot password

### Keep 2FA

Your app already has 2FA support in:

- [`src/services/security/security.service.js`](../src/services/security/security.service.js)

That is useful, but it is separate from email verification. Keep both.

## What You Should Expect After This Change

After proper email verification is added:

- signing up with `test@gmail.com` still creates a pending account
- the account will not be able to log in until the inbox is verified
- the user must click a link from the real Gmail inbox
- 2FA can still be enabled after login

That is the correct behavior for a normal SaaS auth system.

## Practical Recommendation

If you want the fastest path to a solid system, implement:

1. Email verification
2. Password reset
3. `httpOnly` cookie sessions
4. Optional Google login
5. Keep 2FA for extra security

If you want, the next step should be a concrete implementation task list or the actual code changes for phase 1.
