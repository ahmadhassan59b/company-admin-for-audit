const env = require('../../config/env');
const logger = require('../../utils/logger');

const DEFAULT_CONCURRENCY = 2;
const queue = [];
const activeJobs = new Set();
let runningJobs = 0;

function getConcurrency() {
  const configured = Number(env.aiBackgroundQueueConcurrency);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_CONCURRENCY;
}

function isQueued(jobKey) {
  return activeJobs.has(jobKey);
}

function enqueue(jobKey, task) {
  if (!jobKey || typeof task !== 'function') {
    return false;
  }

  if (activeJobs.has(jobKey)) {
    return false;
  }

  activeJobs.add(jobKey);
  queue.push({ jobKey, task });
  drain();
  return true;
}

function drain() {
  while (runningJobs < getConcurrency() && queue.length > 0) {
    const job = queue.shift();
    runningJobs += 1;

    Promise.resolve()
      .then(() => job.task())
      .catch((error) => {
        logger.error('Background queue job failed', {
          jobKey: job.jobKey,
          stack: error.stack
        });
      })
      .finally(() => {
        activeJobs.delete(job.jobKey);
        runningJobs -= 1;
        setImmediate(drain);
      });
  }
}

function getStats() {
  return {
    running: runningJobs,
    queued: queue.length,
    concurrency: getConcurrency()
  };
}

module.exports = {
  enqueue,
  isQueued,
  getStats
};
