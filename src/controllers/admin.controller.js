const adminDashboardService = require('../services/admin/dashboard.service');

async function getDashboard(req, res) {
  const dashboard = await adminDashboardService.getAdminDashboard();

  res.json({
    data: dashboard
  });
}

module.exports = {
  getDashboard
};
