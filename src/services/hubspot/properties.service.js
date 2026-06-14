const hubspotClient = require('./client');

async function fetchProperties(accountKey, objectType) {
  const data = await hubspotClient.request(accountKey, {
    method: 'GET',
    url: `/crm/v3/properties/${objectType}`,
    params: {
      archived: false
    }
  });

  return data.results || [];
}

async function fetchContactProperties(accountKey) {
  return fetchProperties(accountKey, 'contacts');
}

async function fetchDealProperties(accountKey) {
  return fetchProperties(accountKey, 'deals');
}

module.exports = {
  fetchContactProperties,
  fetchDealProperties
};
