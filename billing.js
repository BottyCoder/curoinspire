const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const XLSX = require('xlsx');
const cron = require('node-cron');
const fs = require('fs');

// Initialize Supabase with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false }
  }
);

// Create reports directory if it doesn't exist
const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Automated monthly export function
async function generateAndStoreMonthlyReport() {
  try {
    console.log('🔄 Starting automated monthly billing export...');

    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');
    const monthYear = startOfMonth.format('YYYY-MM');

    // Get all billing records for current month (same logic as export endpoint)
    let allBillingRecords = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: pageRecords, error: pageError } = await supabase
        .from('billing_records')
        .select('*')
        .gte('message_timestamp', startOfMonth.format())
        .order('message_timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) throw pageError;
      if (!pageRecords || pageRecords.length === 0) break;

      allBillingRecords = [...allBillingRecords, ...pageRecords];
      if (pageRecords.length < pageSize) break;
      page++;
    }

    const billingRecords = allBillingRecords;

    if (!billingRecords || billingRecords.length === 0) {
      console.log('📧 No billing data for this month - creating empty report');
    }

    // Generate Excel file (same logic as export endpoint)
    const sessions = billingRecords.reduce((acc, record) => {
      const mobileNumber = record.mobile_number || record.recipient_number;
      if (!acc[mobileNumber]) {
        acc[mobileNumber] = [];
      }
      acc[mobileNumber].push({
        timestamp: moment(record.message_timestamp),
        sessionStart: moment(record.session_start_time),
        costs: {
          utility: parseFloat(record.cost_utility) || 0,
          carrier: parseFloat(record.cost_carrier) || 0,
          mau: parseFloat(record.cost_mau) || 0,
          total: parseFloat(record.total_cost) || 0
        },
        is_mau_charged: record.is_mau_charged
      });
      return acc;
    }, {});

    let sessionCount = 0;
    let carrierTotal = 0;
    let utilityTotal = 0;

    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      messages.sort((a, b) => a.timestamp - b.timestamp);
      let activeSessions = [];
      let currentSession = [messages[0]];

      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) {
          currentSession.push(messages[i]);
        } else {
          activeSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        activeSessions.push(currentSession);
      }

      sessionCount += activeSessions.length;
      carrierTotal += activeSessions.length * 0.01;
      utilityTotal += activeSessions.length * 0.0076;
    }

    const sessionCost = carrierTotal + utilityTotal;
    const mauCost = billingRecords
      .filter(record => record.is_mau_charged === true)
      .reduce((sum, record) => sum + (parseFloat(record.cost_mau) || 0), 0);
    const totalCost = sessionCost + mauCost;
    const monthlyActiveUsers = Object.keys(sessions).length;

    // Create line items data
    const lineItemsData = billingRecords.map(record => ({
      'Timestamp': moment(record.message_timestamp).tz('Africa/Johannesburg').format('DD/MM/YYYY, HH:mm:ss'),
      'Mobile Number': record.mobile_number,
      'WhatsApp ID': record.whatsapp_message_id,
      'Utility Cost': `$${(parseFloat(record.cost_utility) || 0).toFixed(4)}`,
      'Carrier Cost': `$${(parseFloat(record.cost_carrier) || 0).toFixed(4)}`,
      'MAU Cost': `$${(parseFloat(record.cost_mau) || 0).toFixed(4)}`,
      'Total Cost': `$${(parseFloat(record.total_cost) || 0).toFixed(4)}`,
      'Session Start': moment(record.session_start_time).tz('Africa/Johannesburg').format('DD/MM/YYYY, HH:mm:ss'),
      'Is MAU Charged': record.is_mau_charged ? 'Yes' : 'No'
    }));

    // Create summary data
    const summaryStatsData = [
      {
        'Metric': 'Billing Period',
        'Value': now.format('MMMM YYYY'),
        'Cost (USD)': '',
        'Details': `${startOfMonth.format('YYYY-MM-DD')} to ${now.format('YYYY-MM-DD')}`
      },
      {
        'Metric': 'Export Date',
        'Value': now.format('YYYY-MM-DD HH:mm:ss'),
        'Cost (USD)': '',
        'Details': 'Africa/Johannesburg timezone'
      },
      {
        'Metric': '',
        'Value': '',
        'Cost (USD)': '',
        'Details': ''
      },
      {
        'Metric': 'Total Messages',
        'Value': billingRecords.length,
        'Cost (USD)': '',
        'Details': 'All messages processed this month'
      },
      {
        'Metric': 'Billable Sessions',
        'Value': sessionCount,
        'Cost (USD)': sessionCost.toFixed(4),
        'Details': 'Sessions with 23h50m gap threshold'
      },
      {
        'Metric': 'Monthly Active Users',
        'Value': monthlyActiveUsers,
        'Cost (USD)': mauCost.toFixed(4),
        'Details': 'Unique mobile numbers'
      },
      {
        'Metric': 'TOTAL COST',
        'Value': '',
        'Cost (USD)': totalCost.toFixed(4),
        'Details': 'Session costs + MAU costs'
      }
    ];

    // Create Excel workbook
    const workbook = XLSX.utils.book_new();

    // Line Items sheet
    const lineItemsWorksheet = XLSX.utils.json_to_sheet(lineItemsData);
    lineItemsWorksheet['!cols'] = [
      { width: 18 }, { width: 15 }, { width: 35 }, { width: 12 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 18 }, { width: 12 }
    ];
    XLSX.utils.book_append_sheet(workbook, lineItemsWorksheet, 'Line Items');

    // Summary sheet
    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryStatsData);
    summaryWorksheet['!cols'] = [
      { width: 20 }, { width: 15 }, { width: 15 }, { width: 35 }
    ];
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Define the file path
    const filePath = path.join(reportsDir, `billing-report-${monthYear}.xlsx`);

    // Write the buffer to the file
    fs.writeFileSync(filePath, buffer);

    console.log(`✅ Monthly billing report stored successfully for ${monthYear} at ${filePath}`);

  } catch (error) {
    console.error('❌ Error generating/storing monthly report:', error);
  }
}

// Schedule automated export for last day of month at 23:50
// Cron: minute hour day month day-of-week
// This runs at 23:50 on the last day of every month
cron.schedule('50 23 28-31 * *', () => {
  const now = moment().tz('Africa/Johannesburg');
  const tomorrow = now.clone().add(1, 'day');

  // Only run if tomorrow is the first day of next month (i.e., today is last day of month)
  if (tomorrow.date() === 1) {
    console.log('🔄 Running scheduled monthly billing export...');
    generateAndStoreMonthlyReport();
  }
}, {
  scheduled: true,
  timezone: "Africa/Johannesburg"
});

console.log('📅 Monthly billing export scheduled for last day of month at 23:50 (Africa/Johannesburg)');

// Auth middleware
const checkAuth = (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  return next();
};

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/billing.html'));
});

router.get('/exchange-rate', checkAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://open.er-api.com/v6/latest/USD');
    if (!response.data?.rates?.ZAR) {
      throw new Error('Invalid exchange rate response');
    }
    console.log('Exchange rate fetched:', response.data.rates.ZAR);
    res.json({ rate: response.data.rates.ZAR });
  } catch (error) {
    console.error('Exchange rate error:', error);
    res.json({ rate: 20.00 }); // Fallback rate if API fails
  }
});

router.get('/recent-sessions', checkAuth, async (req, res) => {
  try {
    const { data: recentSessions, error } = await supabase
      .from('billing_records')
      .select('message_timestamp, mobile_number, whatsapp_message_id, cost_utility, cost_carrier, cost_mau, total_cost, session_start_time')
      .order('message_timestamp', { ascending: false })
      .limit(10);

    if (error) throw error;
    res.json({ sessions: recentSessions });
  } catch (error) {
    console.error('Error fetching recent sessions:', error);
    res.status(500).json({ error: 'Failed to fetch recent sessions' });
  }
});

router.get('/stats', checkAuth, async (req, res) => {
  try {
    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');

    // Get total count first
    const { count: totalCount, error: countError } = await supabase
      .from('billing_records')
      .select('*', { count: 'exact', head: true })
      .gte('message_timestamp', startOfMonth.format());

    if (countError) throw countError;

    // Get all billing records for current month using pagination
    let allBillingRecords = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: pageRecords, error: pageError } = await supabase
        .from('billing_records')
        .select('*')
        .gte('message_timestamp', startOfMonth.format())
        .order('message_timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) throw pageError;
      if (!pageRecords || pageRecords.length === 0) break;

      allBillingRecords = [...allBillingRecords, ...pageRecords];
      if (pageRecords.length < pageSize) break;
      page++;
    }

    console.log('Billing query params:', {
      startTime: startOfMonth.format(),
      totalCount,
      recordsFetched: allBillingRecords.length
    });

    const billingRecords = allBillingRecords;

    if (!billingRecords || billingRecords.length === 0) {
      console.error('Supabase query error:', queryError);
      console.error('Query params:', {
        startOfMonth: startOfMonth.format(),
        timezone: now.tz()
      });
      throw queryError;
    }

    // console.log('Billing records fetched:', billingRecords?.length || 0);

    if (!billingRecords || billingRecords.length === 0) {
      return res.json({
        totalMessages: 0,
        billableSessions: 0,
        monthlyActiveUsers: 0,
        sessionCost: 0,
        mauCost: 0,
        totalCost: 0,
        startDate: startOfMonth.format(),
        endDate: now.format()
      });
    }

    // Initialize metrics
    const totalMessages = billingRecords.length;
    let billableSessions = 0;
    let monthlyActiveUsers = 0;
    let sessionCost = 0;
    let mauCost = 0;
    let totalCost = 0;

    // Group messages by user and session
    console.log('Processing records for unique users...');
    const sessions = billingRecords.reduce((acc, record) => {
      const mobileNumber = record.mobile_number || record.recipient_number;
      if (!acc[mobileNumber]) {
        acc[mobileNumber] = [];
      }
      acc[mobileNumber].push({
        timestamp: moment(record.message_timestamp),
        sessionStart: moment(record.session_start_time),
        costs: {
          utility: parseFloat(record.cost_utility) || 0,
          carrier: parseFloat(record.cost_carrier) || 0,
          mau: parseFloat(record.cost_mau) || 0,
          total: parseFloat(record.total_cost) || 0
        },
        is_mau_charged: record.is_mau_charged
      });
      // console.log(`Added record for ${mobileNumber}, session start: ${record.session_start_time}`);
      return acc;
    }, {});

    // Initialize metrics
    let carrierCount = 0;
    let carrierTotal = 0;
    let utilityCount = 0;
    let utilityTotal = 0;
    let sessionCount = 0;

    // Calculate metrics from actual database records
    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      // Sort messages by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);

      // Group into sessions with 23h50m window
      let activeSessions = [];
      let currentSession = [messages[0]];

      // Group messages into sessions
      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) { // 23 hours and 50 minutes
          currentSession.push(messages[i]);
        } else {
          activeSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        activeSessions.push(currentSession);
      }

      // Only charge once per actual session
      sessionCount += activeSessions.length;
      carrierCount += activeSessions.length;
      utilityCount += activeSessions.length;

      // Calculate costs per unique session
      carrierTotal += activeSessions.length * 0.01; // $0.01 once per session
      utilityTotal += activeSessions.length * 0.0076; // $0.0076 once per session

      billableSessions += activeSessions.length;
    }

    // Calculate session cost as sum of carrier and utility fees per session
    sessionCost = carrierTotal + utilityTotal;

    // Calculate MAU cost from actual database records (not recalculated)
    mauCost = billingRecords
      .filter(record => record.is_mau_charged === true)
      .reduce((sum, record) => sum + (parseFloat(record.cost_mau) || 0), 0);

    // Count unique mobile numbers for MAU
    monthlyActiveUsers = Object.keys(sessions).length;

    // Calculate total cost
    totalCost = sessionCost + mauCost;

    res.json({
      totalMessages,
      billableSessions,
      monthlyActiveUsers,
      sessionCost,
      mauCost,
      totalCost,
      carrierCount,
      carrierTotal,
      utilityCount,
      utilityTotal,
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    console.error('Error in /stats route:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Database validation utility - compares actual DB records against stats calculations
router.get('/validate-billing', checkAuth, async (req, res) => {
  try {
    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');

    console.log('Starting billing validation...');

    // Get ALL billing records for current month
    let allBillingRecords = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: pageRecords, error: pageError } = await supabase
        .from('billing_records')
        .select('*')
        .gte('message_timestamp', startOfMonth.format())
        .order('message_timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) throw pageError;
      if (!pageRecords || pageRecords.length === 0) break;

      allBillingRecords = [...allBillingRecords, ...pageRecords];
      if (pageRecords.length < pageSize) break;
      page++;
    }

    const dbRecords = allBillingRecords;
    console.log(`Fetched ${dbRecords.length} database records`);

    // === DATABASE FACTS ===
    const dbFacts = {
      totalRecords: dbRecords.length,
      uniqueNumbers: [...new Set(dbRecords.map(r => r.mobile_number))].length,
      totalMauCost: dbRecords.reduce((sum, r) => sum + (parseFloat(r.cost_mau) || 0), 0),
      totalUtilityCost: dbRecords.reduce((sum, r) => sum + (parseFloat(r.cost_utility) || 0), 0),
      totalCarrierCost: dbRecords.reduce((sum, r) => sum + (parseFloat(r.cost_carrier) || 0), 0),
      totalCost: dbRecords.reduce((sum, r) => sum + (parseFloat(r.total_cost) || 0), 0),
      mauChargedRecords: dbRecords.filter(r => r.is_mau_charged === true).length,
      numbersWithMAU: [...new Set(dbRecords.filter(r => r.is_mau_charged === true).map(r => r.mobile_number))].length
    };

    // === RECALCULATED STATS (same logic as /stats endpoint) ===
    const sessions = dbRecords.reduce((acc, record) => {
      const mobileNumber = record.mobile_number || record.recipient_number;
      if (!acc[mobileNumber]) {
        acc[mobileNumber] = [];
      }
      acc[mobileNumber].push({
        timestamp: moment(record.message_timestamp),
        sessionStart: moment(record.session_start_time),
        costs: {
          utility: parseFloat(record.cost_utility) || 0,
          carrier: parseFloat(record.cost_carrier) || 0,
          mau: parseFloat(record.cost_mau) || 0,
          total: parseFloat(record.total_cost) || 0
        },
        is_mau_charged: record.is_mau_charged
      });
      return acc;
    }, {});

    let calculatedSessions = 0;
    let calculatedCarrierCost = 0;
    let calculatedUtilityCost = 0;

    // Calculate sessions using same logic as stats endpoint
    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      messages.sort((a, b) => a.timestamp - b.timestamp);

      let activeSessions = [];
      let currentSession = [messages[0]];

      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) {
          currentSession.push(messages[i]);
        } else {
          activeSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        activeSessions.push(currentSession);
      }

      calculatedSessions += activeSessions.length;
      calculatedCarrierCost += activeSessions.length * 0.01;
      calculatedUtilityCost += activeSessions.length * 0.0076;
    }

    const calculatedStats = {
      totalMessages: dbRecords.length,
      billableSessions: calculatedSessions,
      monthlyActiveUsers: Object.keys(sessions).length,
      sessionCost: calculatedCarrierCost + calculatedUtilityCost,
      mauCost: dbFacts.totalMauCost, // Use actual DB MAU cost
      totalCost: (calculatedCarrierCost + calculatedUtilityCost) + dbFacts.totalMauCost,
      carrierCost: calculatedCarrierCost,
      utilityCost: calculatedUtilityCost
    };

    // === VALIDATION RESULTS ===
    const validationResults = {
      messagesMatch: dbFacts.totalRecords === calculatedStats.totalMessages,
      mauUsersMatch: dbFacts.uniqueNumbers === calculatedStats.monthlyActiveUsers,

      // Cost validations
      mauCostValid: Math.abs(dbFacts.totalMauCost - calculatedStats.mauCost) < 0.001,
      utilityCostValid: Math.abs(dbFacts.totalUtilityCost - calculatedStats.utilityCost) < 0.001,
      carrierCostValid: Math.abs(dbFacts.totalCarrierCost - calculatedStats.carrierCost) < 0.001,
      totalCostValid: Math.abs(dbFacts.totalCost - calculatedStats.totalCost) < 0.001,

      // MAU logic validation
      mauChargesExpected: dbFacts.uniqueNumbers, // Should have 1 MAU charge per unique number
      mauChargesActual: dbFacts.mauChargedRecords,
      mauLogicValid: dbFacts.mauChargedRecords === dbFacts.numbersWithMAU, // Each number should have exactly 1 MAU charge

      // Expected vs actual MAU cost
      expectedMauCost: dbFacts.uniqueNumbers * 0.06,
      actualMauCost: dbFacts.totalMauCost,
      mauCostExpectedValid: Math.abs((dbFacts.uniqueNumbers * 0.06) - dbFacts.totalMauCost) < 0.001
    };

    // === ISSUE DETECTION ===
    const issues = [];

    if (!validationResults.messagesMatch) {
      issues.push(`Message count mismatch: DB has ${dbFacts.totalRecords}, calculated ${calculatedStats.totalMessages}`);
    }

    if (!validationResults.mauUsersMatch) {
      issues.push(`MAU count mismatch: DB has ${dbFacts.uniqueNumbers} unique numbers, calculated ${calculatedStats.monthlyActiveUsers}`);
    }

    if (!validationResults.mauLogicValid) {
      issues.push(`MAU logic broken: ${dbFacts.mauChargedRecords} MAU charges but ${dbFacts.numbersWithMAU} numbers with MAU`);
    }

    if (!validationResults.mauCostExpectedValid) {
      issues.push(`MAU cost wrong: Expected $${(dbFacts.uniqueNumbers * 0.06).toFixed(4)}, got $${dbFacts.totalMauCost.toFixed(4)}`);
    }

    if (!validationResults.utilityCostValid) {
      issues.push(`Utility cost mismatch: DB $${dbFacts.totalUtilityCost.toFixed(4)}, calculated $${calculatedStats.utilityCost.toFixed(4)}`);
    }

    if (!validationResults.carrierCostValid) {
      issues.push(`Carrier cost mismatch: DB $${dbFacts.totalCarrierCost.toFixed(4)}, calculated $${calculatedStats.carrierCost.toFixed(4)}`);
    }

    // === SAMPLE ISSUES ===
    const sampleIssues = [];

    // Check for numbers with multiple MAU charges
    const numberMauCounts = {};
    dbRecords.filter(r => r.is_mau_charged).forEach(r => {
      const num = r.mobile_number;
      numberMauCounts[num] = (numberMauCounts[num] || 0) + 1;
    });

    Object.entries(numberMauCounts).forEach(([number, count]) => {
      if (count > 1) {
        sampleIssues.push({
          type: 'Multiple MAU charges',
          number,
          issue: `${count} MAU charges for same number in same month`
        });
      }
    });

    // Check for numbers with no MAU charges
    const numbersWithMessages = [...new Set(dbRecords.map(r => r.mobile_number))];
    const numbersWithMAUCharges = [...new Set(dbRecords.filter(r => r.is_mau_charged).map(r => r.mobile_number))];

    numbersWithMessages.forEach(number => {
      if (!numbersWithMAUCharges.includes(number)) {
        sampleIssues.push({
          type: 'Missing MAU charge',
          number,
          issue: 'Has messages but no MAU charge'
        });
      }
    });

    res.json({
      timestamp: now.format(),
      month: startOfMonth.format('YYYY-MM'),
      isValid: issues.length === 0,
      summary: `${issues.length} validation issues found`,

      databaseFacts: dbFacts,
      calculatedStats: calculatedStats,
      validationResults: validationResults,

      issues: issues,
      sampleIssues: sampleIssues.slice(0, 10), // Show first 10 sample issues

      recommendations: issues.length > 0 ? [
        'Check webhook logic for MAU charging',
        'Verify session grouping is working correctly',
        'Run database cleanup if needed'
      ] : ['Billing system is working correctly']
    });

  } catch (error) {
    console.error('Error in billing validation:', error);
    res.status(500).json({ error: 'Failed to validate billing data' });
  }
});

// Removed test email endpoint

// Excel export endpoint
router.get('/export-excel', checkAuth, async (req, res) => {
  try {
    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');
    const monthYear = startOfMonth.format('YYYY-MM');

    // Get all billing records for current month
    let allBillingRecords = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: pageRecords, error: pageError } = await supabase
        .from('billing_records')
        .select('*')
        .gte('message_timestamp', startOfMonth.format())
        .order('message_timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) throw pageError;
      if (!pageRecords || pageRecords.length === 0) break;

      allBillingRecords = [...allBillingRecords, ...pageRecords];
      if (pageRecords.length < pageSize) break;
      page++;
    }

    const billingRecords = allBillingRecords;

    // Calculate the same stats as the dashboard
    if (!billingRecords || billingRecords.length === 0) {
      const emptyData = [{
        'Metric': 'No data available for this month',
        'Value': '',
        'Cost (USD)': '',
        'Details': ''
      }];

      const worksheet = XLSX.utils.json_to_sheet(emptyData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Billing Stats');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="billing-stats-${monthYear}.xlsx"`);
      return res.send(buffer);
    }

    // Group messages by user and session (same logic as stats endpoint)
    const sessions = billingRecords.reduce((acc, record) => {
      const mobileNumber = record.mobile_number || record.recipient_number;
      if (!acc[mobileNumber]) {
        acc[mobileNumber] = [];
      }
      acc[mobileNumber].push({
        timestamp: moment(record.message_timestamp),
        sessionStart: moment(record.session_start_time),
        costs: {
          utility: parseFloat(record.cost_utility) || 0,
          carrier: parseFloat(record.cost_carrier) || 0,
          mau: parseFloat(record.cost_mau) || 0,
          total: parseFloat(record.total_cost) || 0
        },
        is_mau_charged: record.is_mau_charged
      });
      return acc;
    }, {});

    let carrierCount = 0;
    let carrierTotal = 0;
    let utilityCount = 0;
    let utilityTotal = 0;
    let sessionCount = 0;

    // Calculate metrics
    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      messages.sort((a, b) => a.timestamp - b.timestamp);

      let activeSessions = [];
      let currentSession = [messages[0]];

      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) {
          currentSession.push(messages[i]);
        } else {
          activeSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        activeSessions.push(currentSession);
      }

      sessionCount += activeSessions.length;
      carrierCount += activeSessions.length;
      utilityCount += activeSessions.length;
      carrierTotal += activeSessions.length * 0.01;
      utilityTotal += activeSessions.length * 0.0076;
    }

    const sessionCost = carrierTotal + utilityTotal;
    const mauCost = billingRecords
      .filter(record => record.is_mau_charged === true)
      .reduce((sum, record) => sum + (parseFloat(record.cost_mau) || 0), 0);
    const totalCost = sessionCost + mauCost;
    const monthlyActiveUsers = Object.keys(sessions).length;

    // Create detailed line items data
    const lineItemsData = billingRecords.map(record => ({
      'Timestamp': moment(record.message_timestamp).tz('Africa/Johannesburg').format('DD/MM/YYYY, HH:mm:ss'),
      'Mobile Number': record.mobile_number,
      'WhatsApp ID': record.whatsapp_message_id,
      'Utility Cost': `$${(parseFloat(record.cost_utility) || 0).toFixed(4)}`,
      'Carrier Cost': `$${(parseFloat(record.cost_carrier) || 0).toFixed(4)}`,
      'MAU Cost': `$${(parseFloat(record.cost_mau) || 0).toFixed(4)}`,
      'Total Cost': `$${(parseFloat(record.total_cost) || 0).toFixed(4)}`,
      'Session Start': moment(record.session_start_time).tz('Africa/Johannesburg').format('DD/MM/YYYY, HH:mm:ss'),
      'Is MAU Charged': record.is_mau_charged ? 'Yes' : 'No'
    }));

    // Create summary stats data (for optional summary sheet)
    const summaryStatsData = [
      {
        'Metric': 'Billing Period',
        'Value': now.format('MMMM YYYY'),
        'Cost (USD)': '',
        'Details': `${startOfMonth.format('YYYY-MM-DD')} to ${now.format('YYYY-MM-DD')}`
      },
      {
        'Metric': 'Export Date',
        'Value': now.format('YYYY-MM-DD HH:mm:ss'),
        'Cost (USD)': '',
        'Details': 'Africa/Johannesburg timezone'
      },
      {
        'Metric': '',
        'Value': '',
        'Cost (USD)': '',
        'Details': ''
      },
      {
        'Metric': 'Total Messages',
        'Value': billingRecords.length,
        'Cost (USD)': '',
        'Details': 'All messages processed this month'
      },
      {
        'Metric': 'Billable Sessions',
        'Value': sessionCount,
        'Cost (USD)': sessionCost.toFixed(4),
        'Details': 'Sessions with 23hh50mm gap threshold'
      },
      {
        'Metric': 'Monthly Active Users',
        'Value': monthlyActiveUsers,
        'Cost (USD)': mauCost.toFixed(4),
        'Details': 'Unique mobile numbers'
      },
      {
        'Metric': 'TOTAL COST',
        'Value': '',
        'Cost (USD)': totalCost.toFixed(4),
        'Details': 'Session costs + MAU costs'
      }
    ];

    // Create Excel workbook with line items as primary sheet
    const workbook = XLSX.utils.book_new();

    // Line Items sheet (main sheet)
    const lineItemsWorksheet = XLSX.utils.json_to_sheet(lineItemsData);
    lineItemsWorksheet['!cols'] = [
      { width: 18 }, // Timestamp
      { width: 15 }, // Mobile Number
      { width: 35 }, // WhatsApp ID
      { width: 12 }, // Utility Cost
      { width: 12 }, // Carrier Cost
      { width: 12 }, // MAU Cost
      { width: 12 }, // Total Cost
      { width: 18 }, // Session Start
      { width: 12 }  // Is MAU Charged
    ];
    XLSX.utils.book_append_sheet(workbook, lineItemsWorksheet, 'Line Items');

    // Summary sheet (optional)
    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryStatsData);
    summaryWorksheet['!cols'] = [
      { width: 20 }, // Metric
      { width: 15 }, // Value
      { width: 15 }, // Cost
      { width: 35 }  // Details
    ];
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const filename = `billing-stats-${monthYear}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Define the file path
    const filePath = path.join(reportsDir, filename);

    // Write the buffer to the file
    fs.writeFileSync(filePath, buffer);
    res.send(buffer);

  } catch (error) {
    console.error('Error generating Excel export:', error);
    res.status(500).json({ error: 'Failed to generate Excel export' });
  }
});

// Route to download the report for a specific month
router.get('/download-report', checkAuth, (req, res) => {
  const { month } = req.query;

  if (!month) {
    return res.status(400).send('Month parameter is required');
  }

  // Correct filename
  const filename = `billing-stats-${month}.xlsx`;
  const filePath = path.join(reportsDir, filename);

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return res.status(404).send('Report not found for the specified month');
  }

  // Set appropriate headers for file download
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Stream the file to the response
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('error', (err) => {
    console.error('File stream error:', err);
    res.status(500).send('Error streaming the report');
  });
});

// Serve static files from the "reports" directory
router.use('/reports', express.static(path.join(__dirname, 'reports')));

// Route to list available reports
router.get('/list-reports', checkAuth, (req, res) => {
  fs.readdir(reportsDir, (err, files) => {
    if (err) {
      console.error("Could not list the directory.", err);
      return res.status(500).send("Unable to list reports");
    }

    const reports = files.filter(file => file.endsWith('.xlsx'));
    return res.json(reports);
  });
});

module.exports = router;