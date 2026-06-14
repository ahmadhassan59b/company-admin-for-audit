const express = require('express');
const { getBuildInfo } = require('../utils/buildInfo');
const db = require('../config/db');
const monitoring = require('../services/monitoring/monitoring.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hubspot-audit-tool',
    timestamp: new Date().toISOString()
  });
});

router.get('/version', (req, res) => {
  res.json({
    status: 'ok',
    ...getBuildInfo(),
    timestamp: new Date().toISOString()
  });
});

router.get('/details', async (req, res, next) => {
  try {
    const dbCheck = await db.query('SELECT 1 AS ok');
    res.json({
      status: 'ok',
      ...getBuildInfo(),
      database: dbCheck.rowCount > 0 ? 'up' : 'unknown',
      monitoring: monitoring.getStatus(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/metrics', (req, res) => {
  res.json({
    status: 'ok',
    monitoring: monitoring.getStatus(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
