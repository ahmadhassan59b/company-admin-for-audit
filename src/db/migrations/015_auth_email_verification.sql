ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ;

UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE email_verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verification_token_hash
  ON users (email_verification_token_hash);

CREATE INDEX IF NOT EXISTS idx_users_email_verified_at
  ON users (email_verified_at);
