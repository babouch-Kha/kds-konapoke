// ============================================================
// KDS Konapoke — Server (Express + Scraper loop)
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const scraper = require('./scraper');

const app = express();
app.use(cors({ origin: config.server.corsOrigins }));
app.use(express.json());

// ----- State -----

let currentOrders = [];
let lastUpdate = null;
let lastError = null;
let scrapeCount = 0;
let isRunning = false;

// ----- API Endpoints -----

// Main endpoint for the KDS frontend
app.get('/api/orders', (req, res) => {
  // Compute global cuisson summary
  const cuissonSummary = {};
  for (const order of currentOrders) {
    for (const ci of order.cuissonItems || []) {
      const key = ci.label;
      if (!cuissonSummary[key]) {
        cuissonSummary[key] = { label: ci.label, color: ci.color, totalQty: 0 };
      }
      cuissonSummary[key].totalQty += ci.qty;
    }
  }

  const otpStatus = scraper.getOtpStatus();

  res.json({
    orders: currentOrders,
    cuissonSummary: Object.values(cuissonSummary),
    meta: {
      lastUpdate: lastUpdate?.toISOString() || null,
      lastError,
      scrapeCount,
      orderCount: currentOrders.length,
      otpRequired: otpStatus.waiting,
      otpEmail: otpStatus.email,
    },
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: isRunning ? 'running' : 'stopped',
    lastUpdate: lastUpdate?.toISOString() || null,
    lastError,
    scrapeCount,
  });
});

// Config endpoint (keywords only, no credentials)
app.get('/api/config', (req, res) => {
  res.json({
    cuissonKeywords: config.cuissonKeywords,
    pollInterval: config.scraping.pollInterval,
  });
});

// OTP status endpoint
app.get('/api/otp', (req, res) => {
  const otpStatus = scraper.getOtpStatus();
  res.json(otpStatus);
});

// OTP submit endpoint
app.post('/api/otp', async (req, res) => {
  const { code } = req.body;

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Code invalide. Entrez 6 chiffres.' });
  }

  try {
    await scraper.submitOtp(code);
    res.json({ success: true, message: 'OTP vérifié avec succès!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----- Serve frontend -----

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ----- Scraping loop -----

async function runScrapeLoop() {
  // Initialize browser & login
  await scraper.initBrowser();
  const loginResult = await scraper.login();

  if (loginResult === 'otp_required') {
    console.log('[Server] OTP required. Waiting for user to submit code via /api/otp...');
    lastError = 'OTP requis - vérifiez votre email';
  } else if (!loginResult) {
    console.error('[Server] Initial login failed. Will retry in loop.');
  }

  isRunning = true;

  const loop = async () => {
    // Check if waiting for OTP
    const otpStatus = scraper.getOtpStatus();
    if (otpStatus.waiting) {
      console.log('[Server] Waiting for OTP submission...');
      lastError = `OTP requis - code envoyé à ${otpStatus.email}`;
      setTimeout(loop, config.scraping.pollInterval);
      return;
    }

    try {
      console.log(`[Server] Scrape #${scrapeCount + 1} starting...`);
      const orders = await scraper.scrapeAll();
      currentOrders = orders;
      lastUpdate = new Date();
      lastError = null;
      scrapeCount++;
      console.log(`[Server] Scrape #${scrapeCount} complete. ${orders.length} open order(s).`);
    } catch (err) {
      console.error(`[Server] Scrape error:`, err.message);
      lastError = err.message;

      // If session expired, try to recover (but not if waiting for OTP)
      const currentOtpStatus = scraper.getOtpStatus();
      if (!currentOtpStatus.waiting && (err.message.includes('Session expired') || err.message.includes('Not logged in'))) {
        console.log('[Server] Attempting re-login...');
        try {
          await scraper.closeBrowser();
          await scraper.initBrowser();
          const reLoginResult = await scraper.login();
          if (reLoginResult === 'otp_required') {
            console.log('[Server] OTP required after re-login.');
            lastError = 'OTP requis - vérifiez votre email';
          }
        } catch (reErr) {
          console.error('[Server] Re-login failed:', reErr.message);
        }
      }
    }

    setTimeout(loop, config.scraping.pollInterval);
  };

  loop();
}

// ----- Start -----

const PORT = config.server.port;

app.listen(PORT, () => {
  console.log(`[Server] KDS API listening on http://localhost:${PORT}`);
  console.log(`[Server] KDS Frontend at http://localhost:${PORT}/`);
  console.log(`[Server] Poll interval: ${config.scraping.pollInterval}ms`);

  // Start scraping
  runScrapeLoop().catch((err) => {
    console.error('[Server] Fatal scraper error:', err);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  isRunning = false;
  await scraper.closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down...');
  isRunning = false;
  await scraper.closeBrowser();
  process.exit(0);
});
