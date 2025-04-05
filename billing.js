
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const supabase = require('../utils/supabase');
const path = require('path');

// Auth middleware
const checkAuth = (req, res, next) => {
  const userId = req.headers['x-replit-user-id'];
  const allowedUsers = ['39187091']; // Add your user IDs
  
  if (!userId || !allowedUsers.includes(userId)) {
    return res.status(401).send('Unauthorized');
  }
  next();
};

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/billing.html'));
});

router.get('/exchange-rate', checkAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://open.er-api.com/v6/latest/USD');
    res.json({ rate: response.data.rates.ZAR });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});

router.get('/stats', checkAuth, async (req, res) => {
  try {
    const now = moment();
    const startOfMonth = now.clone().startOf('month');
    
    const { data: messages } = await supabase
      .from('messages_log')
      .select('*')
      .gte('timestamp', startOfMonth.toISOString());

    // Calculate costs
    const totalMessages = messages?.length || 0;
    const costPerMessage = 0.01; // $0.01 per message
    const totalCost = totalMessages * costPerMessage;

    res.json({
      totalMessages,
      costPerMessage,
      totalCost,
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
