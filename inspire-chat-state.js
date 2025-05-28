const axios = require('axios');

const INSPIRE_ENDPOINT = 'https://www.inspire-ohs.com/API/V3/WA/WAChatState';
const MAX_RETRIES = 3;

/**
 * Push message status to Inspire endpoint with retry logic
 * @param {Object} statusData - The status data to push
 * @returns {boolean} - Success status
 */
async function pushToInspireChatState(statusData) {
  const payload = {
    apiKey: process.env.INSPIRE_API_KEY,
    ClientGuid: statusData.clientGuid, // Use ClientGuid instead of messageId
    recipientNumber: statusData.recipientNumber,
    status: statusData.status,
    timestamp: statusData.timestamp,
    statusTimestamp: statusData.statusTimestamp,
    channel: statusData.channel || 'whatsapp',
    messageType: statusData.messageType,
    trackingCode: statusData.trackingCode
  };

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🚀 Pushing to Inspire (attempt ${attempt}/${MAX_RETRIES}):`, {
        ClientGuid: payload.ClientGuid,
        status: payload.status,
        recipientNumber: payload.recipientNumber
      });

      const response = await axios.post(INSPIRE_ENDPOINT, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ Inspire push successful (attempt ${attempt}):`, {
        ClientGuid: payload.ClientGuid,
        status: response.status,
        data: response.data
      });

      return true;

    } catch (error) {
      lastError = error;
      console.error(`❌ Inspire push failed (attempt ${attempt}/${MAX_RETRIES}):`, {
        ClientGuid: payload.ClientGuid,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      // Don't retry on client errors (4xx)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        console.log(`🛑 Client error detected, not retrying: ${error.response.status}`);
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`💥 All Inspire push attempts failed for message ${payload.ClientGuid}:`, lastError?.message);
  return false;
}

module.exports = {
  pushToInspireChatState
};