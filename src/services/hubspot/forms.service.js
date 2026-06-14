const hubspotClient = require('./client');
const env = require('../../config/env');

async function fetchForms(accountKey) {
  return hubspotClient.getPagedResults(accountKey, '/marketing/v3/forms', {
    limit: 100,
    maxResults: Math.max(1, Number(env.hubspotAuditRecordLimit) || 300)
  });
}

async function fetchFormSubmissions(accountKey, formId) {
  const submissions = [];
  let after = null;
  const maxResults = Math.max(1, Number(env.hubspotAuditRecordLimit) || 300);

  do {
    const data = await hubspotClient.request(accountKey, {
      method: 'GET',
      url: `/form-integrations/v1/submissions/forms/${formId}`,
      params: {
        limit: 50,
        after
      }
    });

    if (Array.isArray(data.results)) {
      submissions.push(...data.results);
    }

    if (submissions.length >= maxResults) {
      submissions.length = maxResults;
      break;
    }

    after = data.paging && data.paging.next ? data.paging.next.after : null;
  } while (after);

  return submissions;
}

async function fetchSubmissionCountLast30Days(accountKey, formId) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const submissions = await fetchFormSubmissions(accountKey, formId);

  return submissions.filter((submission) => {
    const submittedAt = Number(submission.submittedAt);
    return Number.isFinite(submittedAt) && submittedAt >= cutoff;
  }).length;
}

module.exports = {
  fetchForms,
  fetchSubmissionCountLast30Days
};
