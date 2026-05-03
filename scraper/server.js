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

  res.json({
    orders: currentOrders,
    cuissonSummary: Object.values(cuissonSummary),
    meta: {
      lastUpdate: lastUpdate?.toISOString() || null,
      lastError,
      scrapeCount,
      orderCount: currentOrders.length,
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

// ----- Serve frontend -----

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ----- Scraping loop -----

async function runScrapeLoop() {
  // Initialize browser & login
  await scraper.initBrowser();
  const loggedIn = await scraper.login();
  if (!loggedIn) {
    console.error('[Server] Initial login failed. Will retry in loop.');
  }

  isRunning = true;

  const loop = async () => {
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

      // If session expired, try to recover
      if (err.message.includes('Session expired') || err.message.includes('Not logged in')) {
        console.log('[Server] Attempting re-login...');
        try {
          await scraper.closeBrowser();
          await scraper.initBrowser();
          await scraper.login();
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
