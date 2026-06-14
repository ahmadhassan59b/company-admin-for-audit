const hubspotClient = require('./client');

async function fetchDealPipelines(accountKey) {
  const data = await hubspotClient.request(accountKey, {
    method: 'GET',
    url: '/crm/v3/pipelines/deals'
  });

  return data.results || [];
}

module.exports = {
  fetchDealPipelines
};
