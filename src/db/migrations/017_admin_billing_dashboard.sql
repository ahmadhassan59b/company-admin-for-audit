CREATE TABLE IF NOT EXISTS audit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  audit_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO audit_packages (name, description, monthly_price_cents, audit_limit, features)
VALUES
  ('Starter', 'Entry audit package for small HubSpot portals.', 9900, 2, '["Core CRM audit", "PDF report", "Email support"]'::jsonb),
  ('Growth', 'Recurring audits and trend tracking for growing teams.', 24900, 10, '["All Starter features", "Audit history", "Priority support"]'::jsonb),
  ('Enterprise', 'High-volume audit program with customer success support.', 79900, NULL, '["Unlimited audits", "Dedicated manager", "Custom rules"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_id UUID REFERENCES audit_packages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'trial',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  renewal_date DATE,
  trial_ends_at DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_account_manager TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_subscriptions_status_check
    CHECK (status IN ('active', 'trial', 'suspended', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_tenant
  ON customer_subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_status
  ON customer_subscriptions (status);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES customer_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  download_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_invoices_status_check
    CHECK (status IN ('paid', 'pending', 'failed', 'void', 'overdue'))
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant
  ON billing_invoices (tenant_id);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_status_due
  ON billing_invoices (status, due_date);

CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES customer_subscriptions(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES billing_invoices(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  reference TEXT,
  paid_at TIMESTAMPTZ,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_payments_status_check
    CHECK (status IN ('paid', 'pending', 'failed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_tenant
  ON billing_payments (tenant_id);

CREATE INDEX IF NOT EXISTS idx_billing_payments_status_paid
  ON billing_payments (status, paid_at);

CREATE TABLE IF NOT EXISTS customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'note',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_tenant_created
  ON customer_notes (tenant_id, created_at DESC);
