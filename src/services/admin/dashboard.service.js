const db = require('../../config/db');

const ADMIN_ROLES = [
  'Super Admin',
  'Company Admin',
  'Billing Manager',
  'Auditor',
  'Customer Success Manager'
];

async function ensureAdminDashboardSchema() {
  await db.query(`
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
    )
  `);

  await db.query(`
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    INSERT INTO audit_packages (name, description, monthly_price_cents, audit_limit, features)
    VALUES
      ('Starter', 'Entry audit package for small HubSpot portals.', 9900, 2, '["Core CRM audit", "PDF report", "Email support"]'::jsonb),
      ('Growth', 'Recurring audits and trend tracking for growing teams.', 24900, 10, '["All Starter features", "Audit history", "Priority support"]'::jsonb),
      ('Enterprise', 'High-volume audit program with customer success support.', 79900, NULL, '["Unlimited audits", "Dedicated manager", "Custom rules"]'::jsonb)
    ON CONFLICT (name) DO NOTHING
  `);
}

function moneyFromCents(cents) {
  return Number(cents || 0) / 100;
}

function monthLabel(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

async function getSummary() {
  const result = await db.query(`
    WITH customer_stats AS (
      SELECT
        COUNT(*)::int AS total_customers,
        COUNT(*) FILTER (WHERE t.created_at >= date_trunc('month', NOW()))::int AS new_customers_this_month
      FROM tenants t
    ),
    subscription_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE cs.status = 'active')::int AS active_customers,
        COUNT(*) FILTER (
          WHERE cs.renewal_date >= CURRENT_DATE
            AND cs.renewal_date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
        )::int AS expiring_this_month,
        COALESCE(SUM(ap.monthly_price_cents) FILTER (WHERE cs.status IN ('active', 'trial')), 0)::int AS mrr_cents
      FROM customer_subscriptions cs
      LEFT JOIN audit_packages ap ON ap.id = cs.package_id
    ),
    payment_stats AS (
      SELECT
        COALESCE(SUM(amount_cents) FILTER (
          WHERE status = 'paid'
            AND paid_at >= date_trunc('month', NOW())
        ), 0)::int AS revenue_this_month_cents,
        COUNT(*) FILTER (WHERE status IN ('pending', 'failed'))::int AS pending_payments
      FROM billing_payments
    ),
    invoice_stats AS (
      SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending', 'failed', 'overdue')), 0)::int AS outstanding_balance_cents
      FROM billing_invoices
    ),
    audit_stats AS (
      SELECT
        COUNT(*)::int AS total_audits_completed,
        ROUND(COALESCE(AVG(score), 0))::int AS average_audit_score
      FROM audits
    )
    SELECT *
    FROM customer_stats, subscription_stats, payment_stats, invoice_stats, audit_stats
  `);

  const row = result.rows[0] || {};
  return {
    totalCustomers: Number(row.total_customers || 0),
    activeCustomers: Number(row.active_customers || 0),
    expiringThisMonth: Number(row.expiring_this_month || 0),
    revenueThisMonth: moneyFromCents(row.revenue_this_month_cents),
    pendingPayments: Number(row.pending_payments || 0),
    totalAuditsCompleted: Number(row.total_audits_completed || 0),
    averageAuditScore: Number(row.average_audit_score || 0),
    newCustomersThisMonth: Number(row.new_customers_this_month || 0),
    mrr: moneyFromCents(row.mrr_cents),
    outstandingBalance: moneyFromCents(row.outstanding_balance_cents)
  };
}

async function getCustomers() {
  const result = await db.query(`
    WITH audit_rollup AS (
      SELECT
        tenant_id,
        COUNT(*)::int AS audit_count,
        ROUND(COALESCE(AVG(score), 0))::int AS average_score,
        MAX(created_at) AS last_audit_at
      FROM audits
      WHERE tenant_id IS NOT NULL
      GROUP BY tenant_id
    ),
    user_rollup AS (
      SELECT
        tenant_id,
        MIN(email) AS primary_email,
        COUNT(*)::int AS user_count
      FROM users
      GROUP BY tenant_id
    ),
    invoice_rollup AS (
      SELECT
        tenant_id,
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending', 'failed', 'overdue')), 0)::int AS outstanding_cents
      FROM billing_invoices
      GROUP BY tenant_id
    )
    SELECT
      t.id,
      t.name,
      t.created_at,
      COALESCE(ur.primary_email, '') AS primary_email,
      COALESCE(ur.user_count, 0)::int AS user_count,
      COALESCE(cs.status, 'trial') AS status,
      cs.start_date,
      cs.renewal_date,
      cs.trial_ends_at,
      cs.auto_renew,
      cs.assigned_account_manager,
      COALESCE(ap.name, 'Unassigned') AS package_name,
      COALESCE(ap.monthly_price_cents, 0)::int AS monthly_price_cents,
      ap.audit_limit,
      COALESCE(ar.audit_count, 0)::int AS audit_count,
      COALESCE(ar.average_score, 0)::int AS average_score,
      ar.last_audit_at,
      COALESCE(ir.outstanding_cents, 0)::int AS outstanding_cents
    FROM tenants t
    LEFT JOIN user_rollup ur ON ur.tenant_id = t.id
    LEFT JOIN customer_subscriptions cs ON cs.tenant_id = t.id
    LEFT JOIN audit_packages ap ON ap.id = cs.package_id
    LEFT JOIN audit_rollup ar ON ar.tenant_id = t.id
    LEFT JOIN invoice_rollup ir ON ir.tenant_id = t.id
    ORDER BY t.created_at DESC
    LIMIT 200
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    primaryEmail: row.primary_email,
    userCount: Number(row.user_count || 0),
    status: row.status,
    packageName: row.package_name,
    monthlyPrice: moneyFromCents(row.monthly_price_cents),
    auditLimit: row.audit_limit,
    startDate: row.start_date,
    renewalDate: row.renewal_date,
    trialEndsAt: row.trial_ends_at,
    autoRenew: Boolean(row.auto_renew),
    assignedAccountManager: row.assigned_account_manager || '',
    auditCount: Number(row.audit_count || 0),
    averageScore: Number(row.average_score || 0),
    lastAuditAt: row.last_audit_at,
    outstandingBalance: moneyFromCents(row.outstanding_cents),
    createdAt: row.created_at
  }));
}

async function getPackages() {
  const result = await db.query(`
    SELECT
      ap.*,
      COUNT(cs.id)::int AS customer_count
    FROM audit_packages ap
    LEFT JOIN customer_subscriptions cs ON cs.package_id = ap.id
    GROUP BY ap.id
    ORDER BY ap.monthly_price_cents ASC, ap.name ASC
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    monthlyPrice: moneyFromCents(row.monthly_price_cents),
    auditLimit: row.audit_limit,
    features: Array.isArray(row.features) ? row.features : [],
    isActive: Boolean(row.is_active),
    customerCount: Number(row.customer_count || 0)
  }));
}

async function getPayments() {
  const result = await db.query(`
    SELECT
      bp.id,
      bp.amount_cents,
      bp.status,
      bp.payment_method,
      bp.reference,
      bp.paid_at,
      bp.due_date,
      bp.created_at,
      t.name AS customer_name,
      ap.name AS package_name
    FROM billing_payments bp
    JOIN tenants t ON t.id = bp.tenant_id
    LEFT JOIN customer_subscriptions cs ON cs.id = bp.subscription_id
    LEFT JOIN audit_packages ap ON ap.id = cs.package_id
    ORDER BY COALESCE(bp.paid_at, bp.created_at) DESC
    LIMIT 50
  `);

  return result.rows.map((row) => ({
    id: row.id,
    customerName: row.customer_name,
    packageName: row.package_name || 'Unassigned',
    amount: moneyFromCents(row.amount_cents),
    status: row.status,
    paymentMethod: row.payment_method || '',
    reference: row.reference || '',
    paidAt: row.paid_at,
    dueDate: row.due_date,
    createdAt: row.created_at
  }));
}

async function getCharts() {
  const [revenue, growth, audits, packages] = await Promise.all([
    db.query(`
      SELECT
        date_trunc('month', paid_at)::date AS month,
        COALESCE(SUM(amount_cents), 0)::int AS value
      FROM billing_payments
      WHERE status = 'paid'
        AND paid_at >= date_trunc('month', NOW()) - INTERVAL '5 months'
      GROUP BY 1
      ORDER BY 1
    `),
    db.query(`
      SELECT
        date_trunc('month', created_at)::date AS month,
        COUNT(*)::int AS value
      FROM tenants
      WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '5 months'
      GROUP BY 1
      ORDER BY 1
    `),
    db.query(`
      SELECT
        date_trunc('month', created_at)::date AS month,
        COUNT(*)::int AS value
      FROM audits
      WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '5 months'
      GROUP BY 1
      ORDER BY 1
    `),
    db.query(`
      SELECT COALESCE(ap.name, 'Unassigned') AS label, COUNT(cs.id)::int AS value
      FROM customer_subscriptions cs
      LEFT JOIN audit_packages ap ON ap.id = cs.package_id
      GROUP BY 1
      ORDER BY value DESC, label ASC
    `)
  ]);

  return {
    monthlyRevenue: revenue.rows.map((row) => ({ label: monthLabel(row.month), value: moneyFromCents(row.value) })),
    customerGrowth: growth.rows.map((row) => ({ label: monthLabel(row.month), value: Number(row.value || 0) })),
    auditCompletionTrends: audits.rows.map((row) => ({ label: monthLabel(row.month), value: Number(row.value || 0) })),
    packageDistribution: packages.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) }))
  };
}

async function getSettingsSummary() {
  return {
    roles: ADMIN_ROLES,
    featureToggles: [
      { key: 'billing_reminders', label: 'Billing reminders', enabled: true },
      { key: 'audit_trend_alerts', label: 'Audit trend alerts', enabled: true },
      { key: 'customer_success_notes', label: 'Customer success notes', enabled: true }
    ],
    configurableAreas: [
      'Package management',
      'Billing configuration',
      'Email templates',
      'Audit rules configuration'
    ]
  };
}

async function getDataSource() {
  const result = await db.query(`
    SELECT current_database() AS database_name
  `);

  return {
    database: result.rows[0] && result.rows[0].database_name ? result.rows[0].database_name : 'unknown',
    customerTable: 'tenants',
    auditTable: 'audits',
    packageTable: 'audit_packages',
    subscriptionTable: 'customer_subscriptions',
    invoiceTable: 'billing_invoices',
    paymentTable: 'billing_payments'
  };
}

async function getAdminDashboard() {
  await ensureAdminDashboardSchema();
  const [summary, customers, packages, payments, charts, settings, source] = await Promise.all([
    getSummary(),
    getCustomers(),
    getPackages(),
    getPayments(),
    getCharts(),
    getSettingsSummary(),
    getDataSource()
  ]);

  return {
    source,
    summary,
    customers,
    packages,
    payments,
    charts,
    settings
  };
}

module.exports = {
  getAdminDashboard
};
