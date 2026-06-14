const TOKEN_STORAGE = 'hubspot_audit_auth_token';
const charts = {};
const state = { customers: [] };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function authHeaders() {
  const token = window.localStorage.getItem(TOKEN_STORAGE);
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      cache: options.cache || 'no-store',
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    const error = new Error('Network error: admin UI cannot reach the API. Make sure backend and UI servers are running.');
    error.cause = networkError;
    throw error;
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && body.error && body.error.message ? body.error.message : 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body.data;
}

function setAppReady() {
  document.documentElement.classList.remove('app-loading');
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function statusClass(status) {
  const safe = String(status || '').toLowerCase();
  if (safe === 'active' || safe === 'paid') return 'tone-success';
  if (safe === 'pending' || safe === 'trial') return 'tone-warning';
  if (safe === 'failed' || safe === 'suspended' || safe === 'overdue') return 'tone-error';
  return 'tone-neutral';
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function renderSource(source) {
  const database = source && source.database ? source.database : 'hubspot_audit_tool';
  setText('adminSourceBadge', `Database: ${database}`);
}

function chartData(items) {
  const rows = Array.isArray(items) && items.length ? items : [{ label: 'No data', value: 0 }];
  return {
    labels: rows.map((item) => item.label),
    values: rows.map((item) => Number(item.value || 0))
  };
}

function renderChart(id, type, items, options = {}) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  const data = chartData(items);
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels: data.labels,
      datasets: [
        {
          label: options.label || '',
          data: data.values,
          borderColor: '#2563eb',
          backgroundColor:
            type === 'doughnut'
              ? ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#64748b']
              : 'rgba(37, 99, 235, 0.16)',
          tension: 0.35,
          fill: type !== 'doughnut'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: type === 'doughnut' } },
      scales: type === 'doughnut' ? {} : { y: { beginAtZero: true } }
    }
  });
}

function renderSummary(summary) {
  setText('metricTotalCustomers', summary.totalCustomers || 0);
  setText('metricActiveCustomers', summary.activeCustomers || 0);
  setText('metricExpiringThisMonth', summary.expiringThisMonth || 0);
  setText('metricRevenueThisMonth', formatMoney(summary.revenueThisMonth));
  setText('metricPendingPayments', summary.pendingPayments || 0);
  setText('metricTotalAudits', summary.totalAuditsCompleted || 0);
  setText('metricAverageScore', summary.averageAuditScore || 0);
  setText('metricNewCustomers', summary.newCustomersThisMonth || 0);
  setText('mrrLabel', `${formatMoney(summary.mrr)} MRR`);
  setText('outstandingLabel', `${formatMoney(summary.outstandingBalance)} outstanding`);
}

function customerDisplayName(customer) {
  return customer.name || customer.primaryEmail || 'Untitled customer';
}

function getPlanGroups(customers) {
  return customers.reduce((groups, customer) => {
    const plan = customer.packageName || 'Unassigned';
    if (!groups[plan]) {
      groups[plan] = {
        name: plan,
        customers: [],
        revenue: 0
      };
    }
    groups[plan].customers.push(customer);
    groups[plan].revenue += Number(customer.monthlyPrice || 0);
    return groups;
  }, {});
}

function renderSelectedPlans(customers) {
  const selectedPlanList = document.getElementById('adminSelectedPlanList');
  const planCustomerList = document.getElementById('adminPlanCustomerList');
  const groups = Object.values(getPlanGroups(customers)).sort((a, b) => {
    if (b.customers.length !== a.customers.length) return b.customers.length - a.customers.length;
    return a.name.localeCompare(b.name);
  });

  selectedPlanList.innerHTML = groups.length
    ? groups
        .map(
          (group) => `
            <div class="adminSelectedPlanItem">
              <div>
                <strong>${escapeHtml(group.name)}</strong>
                <span>${group.customers.length} customer${group.customers.length === 1 ? '' : 's'} selected</span>
              </div>
              <b>${formatMoney(group.revenue)}/mo</b>
            </div>
          `
        )
        .join('')
    : '<div class="muted cardPad">No selected plans found in customer_subscriptions.</div>';

  planCustomerList.innerHTML = groups.length
    ? groups
        .map(
          (group) => `
            <div class="adminPlanCustomerGroup">
              <div class="adminPlanCustomerTitle">
                <strong>${escapeHtml(group.name)}</strong>
                <span>${group.customers.length}</span>
              </div>
              <div class="adminPlanCustomerNames">
                ${group.customers
                  .map(
                    (customer) => `
                      <span>
                        ${escapeHtml(customerDisplayName(customer))}
                        <small>${escapeHtml(customer.status || 'trial')}</small>
                      </span>
                    `
                  )
                  .join('')}
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="muted cardPad">No customers have selected plans yet.</div>';
}

function renderCustomers() {
  const search = String(document.getElementById('adminCustomerSearch').value || '').toLowerCase();
  const status = String(document.getElementById('adminStatusFilter').value || '').toLowerCase();
  const rows = state.customers.filter((customer) => {
    const haystack = `${customer.name} ${customer.primaryEmail} ${customer.packageName}`.toLowerCase();
    return (!search || haystack.includes(search)) && (!status || String(customer.status).toLowerCase() === status);
  });
  const body = document.getElementById('adminCustomersBody');
  body.innerHTML = rows.length
    ? rows
        .map(
          (customer) => `
            <tr>
              <td>
                <div class="dashboardAccountName">${escapeHtml(customer.name || 'Untitled customer')}</div>
                <div class="muted">${escapeHtml(customer.primaryEmail || 'No contact email')}</div>
              </td>
              <td>${escapeHtml(customer.packageName || 'Unassigned')}</td>
              <td><span class="adminStatusPill ${statusClass(customer.status)}">${escapeHtml(customer.status || 'trial')}</span></td>
              <td>${formatDate(customer.renewalDate || customer.trialEndsAt)}</td>
              <td>${customer.auditCount || 0}</td>
              <td>${customer.averageScore || 0}</td>
              <td>${formatMoney(customer.outstandingBalance)}</td>
              <td>${escapeHtml(customer.assignedAccountManager || 'Unassigned')}</td>
            </tr>
          `
        )
        .join('')
    : '<tr><td colspan="8" class="muted">No customers match the current filters.</td></tr>';
}

function renderPackages(packages) {
  const list = document.getElementById('adminPackageList');
  list.innerHTML = packages.length
    ? packages
        .map(
          (plan) => `
            <div class="adminPackageItem">
              <div>
                <div class="adminPackageTitle">${escapeHtml(plan.name)}</div>
                <div class="muted">${escapeHtml(plan.description || '')}</div>
              </div>
              <div class="adminPackageMeta">
                <strong>${formatMoney(plan.monthlyPrice)}</strong>
                <span>${plan.auditLimit ? `${plan.auditLimit} audits/mo` : 'Unlimited audits'}</span>
                <span>${plan.customerCount || 0} customers</span>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="muted cardPad">No packages configured yet.</div>';
}

function renderPayments(payments) {
  const body = document.getElementById('adminPaymentsBody');
  body.innerHTML = payments.length
    ? payments
        .map(
          (payment) => `
            <tr>
              <td>${escapeHtml(payment.customerName || 'Unknown')}</td>
              <td>${formatMoney(payment.amount)}</td>
              <td><span class="adminStatusPill ${statusClass(payment.status)}">${escapeHtml(payment.status || 'pending')}</span></td>
              <td>${formatDate(payment.paidAt || payment.dueDate || payment.createdAt)}</td>
            </tr>
          `
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No billing records found in billing_payments yet.</td></tr>';
}

function renderSettings(settings) {
  document.getElementById('adminRolesList').innerHTML = (settings.roles || [])
    .map((role) => `<span class="adminPill">${escapeHtml(role)}</span>`)
    .join('');
  document.getElementById('adminFeatureList').innerHTML = (settings.featureToggles || [])
    .map(
      (item) => `
        <div class="adminToggleRow">
          <span>${escapeHtml(item.label)}</span>
          <span class="adminStatusPill ${item.enabled ? 'tone-success' : 'tone-neutral'}">${item.enabled ? 'On' : 'Off'}</span>
        </div>
      `
    )
    .join('');
  document.getElementById('adminSettingsList').innerHTML = (settings.configurableAreas || [])
    .map((item) => `<span class="adminPill">${escapeHtml(item)}</span>`)
    .join('');
}

async function loadAdminDashboard() {
  const errorBox = document.getElementById('adminErrorBox');
  errorBox.style.display = 'none';
  try {
    const data = await apiFetch('/api/admin/dashboard');
    renderSource(data.source || {});
    renderSummary(data.summary || {});
    state.customers = data.customers || [];
    renderSelectedPlans(state.customers);
    renderCustomers();
    renderPackages(data.packages || []);
    renderPayments(data.payments || []);
    renderSettings(data.settings || {});
    renderChart('monthlyRevenueChart', 'line', data.charts && data.charts.monthlyRevenue, { label: 'Revenue' });
    renderChart('customerGrowthChart', 'bar', data.charts && data.charts.customerGrowth, { label: 'Customers' });
    renderChart('auditTrendChart', 'line', data.charts && data.charts.auditCompletionTrends, { label: 'Audits' });
    renderChart('packageDistributionChart', 'doughnut', data.charts && data.charts.packageDistribution, { label: 'Packages' });
  } catch (error) {
    errorBox.textContent =
      error.status === 403
        ? 'Admin access is required to view this dashboard.'
        : error.message || 'Could not load admin dashboard.';
    errorBox.style.display = 'block';
  } finally {
    setAppReady();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminCustomerSearch').addEventListener('input', renderCustomers);
  document.getElementById('adminStatusFilter').addEventListener('change', renderCustomers);
  document.getElementById('refreshAdminBtn').addEventListener('click', loadAdminDashboard);
  loadAdminDashboard();
});
