// ============================================================
// KDS Konapoke — Zelty Scraper (Playwright)
// ============================================================

const { chromium } = require('playwright');
const config = require('./config');

let browser = null;
let context = null;
let page = null;
let isLoggedIn = false;
let waitingForOtp = false;
let otpEmail = null;

// ----- Browser lifecycle -----

async function initBrowser() {
  console.log('[Scraper] Launching browser...');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(config.scraping.selectorTimeout);
  console.log('[Scraper] Browser ready.');
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
    isLoggedIn = false;
  }
}

// ----- Login -----

async function login() {
  try {
    const email = config.zelty.email;
    const password = config.zelty.password;

    console.log('[Scraper] Logging in to Zelty...');
    console.log(`[Scraper] Email: ${email ? email.substring(0, 3) + '***' : 'MISSING'}`);
    console.log(`[Scraper] Password: ${password ? '***' + password.length + ' chars' : 'MISSING'}`);

    if (!email || !password) {
      throw new Error('Missing ZELTY_EMAIL or ZELTY_PASSWORD environment variables');
    }

    await page.goto(config.zelty.loginUrl, {
      waitUntil: 'networkidle',
      timeout: config.scraping.navigationTimeout,
    });

    // Check if already logged in (redirected to board)
    if (page.url().includes('/board') || page.url().includes('/dashboard')) {
      console.log('[Scraper] Already logged in.');
      isLoggedIn = true;
      return true;
    }

    // Fill login form
    console.log('[Scraper] Filling login form...');
    await page.fill('input#login', email);
    await page.fill('input#password', password);
    console.log('[Scraper] Submitting login form...');
    await page.click('button[type="submit"]');

    // Wait a moment for the form to submit
    await page.waitForTimeout(3000);
    console.log('[Scraper] After submit, URL:', page.url());

    // Check if OTP page is displayed
    if (page.url().includes('/login/otp') || await page.locator('input#otp').count() > 0) {
      console.log('[Scraper] OTP verification required!');
      waitingForOtp = true;

      // Try to extract the email where OTP was sent
      const otpIntro = await page.locator('.otp_intro strong').textContent().catch(() => null);
      otpEmail = otpIntro || 'votre email';
      console.log(`[Scraper] OTP sent to: ${otpEmail}`);

      // Return special status - we need to wait for OTP
      return 'otp_required';
    }

    // Check for error messages on page
    const errorMsg = await page.locator('.alert-danger, .error, .invalid-feedback').first().textContent().catch(() => null);
    if (errorMsg) {
      console.log('[Scraper] Error message on page:', errorMsg.trim());
    }

    // Check if we're still on login page
    if (page.url() === 'https://bo.zelty.fr/' || page.url().includes('login')) {
      // Maybe wrong credentials or need to wait more
      console.log('[Scraper] Still on login page, waiting more...');
      await page.waitForTimeout(3000);
      console.log('[Scraper] URL after extra wait:', page.url());
    }

    // Wait for navigation after login (redirects to /home then can go to /board)
    console.log('[Scraper] Waiting for redirect after login...');
    await page.waitForURL(/\/(home|board|dashboard)/, {
      timeout: config.scraping.navigationTimeout,
    });

    console.log('[Scraper] Login successful.');
    isLoggedIn = true;
    return true;
  } catch (err) {
    console.error('[Scraper] Login failed:', err.message);
    console.error('[Scraper] Current URL:', page?.url?.() || 'unknown');
    isLoggedIn = false;
    return false;
  }
}

// ----- OTP handling -----

function getOtpStatus() {
  return {
    waiting: waitingForOtp,
    email: otpEmail,
  };
}

async function resetAndResendOtp() {
  console.log('[Scraper] Resetting session to resend OTP...');
  waitingForOtp = false;
  otpEmail = null;
  isLoggedIn = false;

  // Close browser and reinitialize
  await closeBrowser();
  await initBrowser();

  // Attempt login again - this will trigger a new OTP
  const result = await login();

  // If OTP required, wait for the page to be ready
  if (result === 'otp_required') {
    await page.waitForSelector('input#otp', { timeout: 10000 }).catch(() => {});
  }

  return result;
}

async function submitOtp(code) {
  if (!waitingForOtp) {
    throw new Error('Not waiting for OTP');
  }

  try {
    console.log('[Scraper] Submitting OTP code...');

    // Make sure we're on the OTP page
    const currentUrl = page.url();
    console.log('[Scraper] Current URL before OTP submit:', currentUrl);

    if (!currentUrl.includes('/login') && !currentUrl.includes('otp')) {
      // Maybe already logged in?
      if (currentUrl.includes('/home') || currentUrl.includes('/board')) {
        console.log('[Scraper] Already logged in!');
        waitingForOtp = false;
        otpEmail = null;
        isLoggedIn = true;
        return true;
      }
    }

    // Wait for OTP input to be visible
    await page.waitForSelector('input#otp', { timeout: 15000 });

    // Fill OTP input
    await page.fill('input#otp', code, { timeout: 10000 });

    // The form auto-submits when 6 digits are entered, but let's also click submit
    await page.click('button[type="submit"]');

    // Wait for redirect
    await page.waitForTimeout(5000);
    console.log('[Scraper] After OTP submit, URL:', page.url());

    // Check if we're now logged in
    if (page.url().includes('/home') || page.url().includes('/board') || page.url().includes('/dashboard')) {
      console.log('[Scraper] OTP verified, login successful!');
      waitingForOtp = false;
      otpEmail = null;
      isLoggedIn = true;
      return true;
    }

    // Check for error on page
    const errorMsg = await page.locator('.alert-danger, .error').first().textContent().catch(() => null);
    if (errorMsg) {
      console.log('[Scraper] OTP error:', errorMsg.trim());
      // Don't set waitingForOtp to false - we still need a valid OTP
      throw new Error(errorMsg.trim());
    }

    // Still on login page - OTP might be wrong or expired
    // Keep waitingForOtp = true so user can try again
    throw new Error('Code invalide ou expiré - réessayez ou renvoyez le code');
  } catch (err) {
    console.error('[Scraper] OTP submission failed:', err.message);
    // Important: don't reset waitingForOtp here - let the user retry
    throw err;
  }
}

// ----- Check / recover session -----

async function ensureLoggedIn() {
  // If waiting for OTP, don't try to login again
  if (waitingForOtp) {
    console.log('[Scraper] ensureLoggedIn: waiting for OTP, skipping');
    return false;
  }

  if (!browser || !page) {
    await initBrowser();
  }

  // Quick check: try to detect login page or verify we're logged in
  try {
    const currentUrl = page.url();
    console.log('[Scraper] ensureLoggedIn: current URL is', currentUrl);

    // If we're on a logged-in page, we're good
    if (isLoggedIn && (currentUrl.includes('/home') || currentUrl.includes('/board') || currentUrl.includes('/dashboard'))) {
      return true;
    }

    // If on login page or OTP page, need to login
    if (currentUrl.includes('/login') || currentUrl.includes('otp') || !isLoggedIn) {
      const result = await login();
      // If OTP required, return false but don't retry
      if (result === 'otp_required') {
        return false;
      }
      return result;
    }
    return true;
  } catch (err) {
    console.error('[Scraper] ensureLoggedIn error:', err.message);
    // Page may have crashed
    await closeBrowser();
    await initBrowser();
    const result = await login();
    if (result === 'otp_required') {
      return false;
    }
    return result;
  }
}

// ----- Navigate to today's tickets (open) -----

function getTodayBoardUrl() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `https://bo.zelty.fr/board#tickets?pstart=${dateStr}&pend=${dateStr}&opened=1&tstart=0%3A00&tend=0%3A00&allday=1`;
}

// ----- Scrape open orders list -----

async function scrapeOpenOrders() {
  // Check OTP status first
  if (waitingForOtp) {
    throw new Error('En attente du code OTP');
  }

  if (!(await ensureLoggedIn())) {
    throw new Error('Not logged in');
  }

  // Double-check we're actually on a logged-in page
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('otp')) {
    throw new Error('Not logged in - still on login page');
  }

  const boardUrl = getTodayBoardUrl();
  console.log(`[Scraper] Navigating to board: ${boardUrl}`);

  await page.goto(boardUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.scraping.navigationTimeout,
  });

  // Wait a bit for dynamic content
  await page.waitForTimeout(2000);

  // Check for login redirect
  if (page.url().includes('/login')) {
    isLoggedIn = false;
    const loginResult = await login();
    if (loginResult === 'otp_required') {
      throw new Error('OTP requis');
    }
    if (!loginResult) {
      throw new Error('Session expired, re-login failed');
    }
    await page.goto(boardUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.scraping.navigationTimeout,
    });
    await page.waitForTimeout(2000);
  }

  // Click on the "tickets" tab if not already active
  await page.waitForSelector('#board_tabs', { timeout: config.scraping.selectorTimeout });

  // Make sure the tickets tab is loaded
  const ticketsTab = page.locator('#board_tabs .tabc.tickets');
  if (!(await ticketsTab.getAttribute('class')).includes('active')) {
    // Click on the tickets tab link/nav item
    const tabLink = page.locator('a[href="#tickets"], [data-target="tickets"]');
    if (await tabLink.count() > 0) {
      await tabLink.first().click();
      await page.waitForTimeout(2000);
    }
  }

  // Wait for the widget tables to load
  await page.waitForSelector('.widget.widget_table', { timeout: config.scraping.selectorTimeout });

  // Wait for the Google Visualization Table to render (it loads asynchronously)
  console.log('[Scraper] Waiting for Google Visualization Table to render...');
  await page.waitForSelector('.google-visualization-table-table', { timeout: config.scraping.selectorTimeout }).catch(() => {
    console.log('[Scraper] Google Visualization Table not found, may be empty');
  });

  // Extra wait for table content to fully render
  await page.waitForTimeout(1500);

  // Find the "Commandes ouvertes" table
  const orders = await page.evaluate(() => {
    const widgets = document.querySelectorAll('.widget.widget_table');
    console.log('[Scraper-Eval] Found', widgets.length, 'widget_table elements');

    for (const widget of widgets) {
      const title = widget.querySelector('h3.widget-title');
      console.log('[Scraper-Eval] Widget title:', title?.textContent?.substring(0, 50));
      if (!title || !title.textContent.includes('Commandes ouvertes')) continue;

      const rows = widget.querySelectorAll('tbody tr');
      console.log('[Scraper-Eval] Found', rows.length, 'rows in Commandes ouvertes');
      const results = [];

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 12) continue;

        // Extract ticket ID from openTicket(ID) link
        const link = cells[0]?.querySelector('a');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        const ticketIdMatch = href.match(/openTicket\((\d+)\)/);
        if (!ticketIdMatch) continue;

        const ticketId = ticketIdMatch[1];
        const orderNumber = link.textContent.trim();
        const date = cells[1]?.textContent?.trim() || '';
        const duration = cells[2]?.textContent?.trim() || '';
        const mode = cells[4]?.textContent?.trim() || '';
        const client = cells[5]?.textContent?.trim() || '';
        const ttc = cells[11]?.textContent?.trim() || '';

        results.push({ ticketId, orderNumber, date, duration, mode, client, ttc });
      }
      return results;
    }
    return [];
  });

  console.log(`[Scraper] Found ${orders.length} open order(s).`);
  if (orders.length === 0) {
    // Debug: log page state when no orders found
    const debugInfo = await page.evaluate(() => {
      const widgets = document.querySelectorAll('.widget.widget_table');
      const widgetTitles = Array.from(widgets).map(w => w.querySelector('h3.widget-title')?.textContent?.substring(0, 50));
      const hasGoogleTable = !!document.querySelector('.google-visualization-table-table');
      const tableRows = document.querySelectorAll('.widget.widget_table tbody tr').length;
      return { widgetCount: widgets.length, widgetTitles, hasGoogleTable, tableRows };
    });
    console.log('[Scraper] Debug - no orders found. Page state:', JSON.stringify(debugInfo));
  }
  return orders;
}

// ----- Scrape a single ticket detail -----

async function scrapeTicketDetail(ticketId) {
  const url = `${config.zelty.ticketBaseUrl}/${ticketId}`;

  // Open ticket page in a new tab to avoid losing the board page
  const detailPage = await context.newPage();
  detailPage.setDefaultTimeout(config.scraping.selectorTimeout);

  try {
    await detailPage.goto(url, {
      waitUntil: 'networkidle',
      timeout: config.scraping.navigationTimeout,
    });

    // Check for login redirect
    if (detailPage.url().includes('/login')) {
      await detailPage.close();
      throw new Error('Session expired while fetching ticket');
    }

    const detail = await detailPage.evaluate(() => {
      // --- Items ---
      const items = [];
      const rows = document.querySelectorAll('table.ticket_contents tbody tr:not(.discount)');
      for (const row of rows) {
        const nameCell = row.querySelector('td[colspan="2"]');
        if (!nameCell) continue;

        // Get raw text, extract quantity and name
        const rawText = nameCell.childNodes[0]?.textContent?.trim() || '';
        const qtyMatch = rawText.match(/^(\d+)\s*x\s*(.+)/);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        const name = qtyMatch ? qtyMatch[2].trim() : rawText;

        // Options
        const optionEls = nameCell.querySelectorAll('ul.item_options li');
        const options = Array.from(optionEls).map((li) => li.textContent.trim());

        const priceCell = row.querySelector('td[style*="text-align:right"]');
        const price = priceCell?.textContent?.trim() || '';

        items.push({ qty, name, options, price });
      }

      // --- Order metadata ---
      const metasDiv = document.querySelector('.order-metas');
      const metasHtml = metasDiv?.innerHTML || '';

      let customerName = '';
      let phone = '';
      let note = '';
      let scheduledFor = '';

      const strongEls = metasDiv?.querySelectorAll('strong') || [];
      for (const strong of strongEls) {
        const label = strong.textContent.trim().toLowerCase();
        // Get the text node right after the strong
        let valueNode = strong.nextSibling;
        let value = '';
        while (valueNode && valueNode.nodeName !== 'STRONG' && valueNode.nodeName !== 'BR') {
          value += valueNode.textContent || '';
          valueNode = valueNode.nextSibling;
        }
        value = value.replace(/^[\s:]+/, '').trim();

        if (label.includes('prénom') || label.includes('nom') || label.includes('client')) {
          customerName = value;
        } else if (label.includes('téléphone') || label.includes('tel')) {
          phone = value;
        } else if (label.includes('note')) {
          note = value;
        } else if (label.includes('prévue') || label.includes('prévu')) {
          scheduledFor = value;
        }
      }

      // --- Source / mode from ticket_infos ---
      const infosTable = document.querySelector('.ticket_infos table.table');
      let source = '';
      let deliveryMode = '';
      let openedAt = '';

      if (infosTable) {
        const infoRows = infosTable.querySelectorAll('tbody tr');
        for (const row of infoRows) {
          const icon = row.querySelector('span.fa');
          const td = row.querySelectorAll('td')[1];
          if (!icon || !td) continue;

          if (icon.classList.contains('fa-paper-plane')) {
            source = td.textContent.trim();
          } else if (icon.classList.contains('fa-map-marker')) {
            deliveryMode = td.textContent.trim();
          } else if (icon.classList.contains('fa-clock')) {
            openedAt = td.textContent.trim();
          }
        }
      }

      // --- Total ---
      const totalEl = document.querySelector('.ticket h3.noprint');
      const total = totalEl?.textContent?.trim()?.replace('Total TTC : ', '') || '';

      return {
        items,
        customerName,
        phone,
        note,
        scheduledFor,
        source,
        deliveryMode,
        openedAt,
        total,
      };
    });

    return detail;
  } finally {
    await detailPage.close();
  }
}

// ----- Main scrape cycle -----

async function scrapeAll() {
  const openOrders = await scrapeOpenOrders();
  const fullOrders = [];

  for (const order of openOrders) {
    try {
      const detail = await scrapeTicketDetail(order.ticketId);
      fullOrders.push({ ...order, ...detail });
    } catch (err) {
      console.error(`[Scraper] Failed to fetch ticket ${order.ticketId}:`, err.message);
      fullOrders.push({ ...order, items: [], error: err.message });
    }
  }

  // Tag cuisson items
  const cuissonKeywords = config.cuissonKeywords;

  for (const order of fullOrders) {
    order.cuissonItems = [];

    for (const item of order.items || []) {
      const itemNameLower = item.name.toLowerCase();

      // Check product name matches
      for (const kw of cuissonKeywords) {
        if (kw.type === 'option') continue; // skip option-only keywords here
        if (itemNameLower.includes(kw.keyword.toLowerCase())) {
          order.cuissonItems.push({
            label: kw.label,
            color: kw.color,
            qty: item.qty,
            source: 'product',
            productName: item.name,
          });
        }
      }

      // Check options
      for (const opt of item.options || []) {
        const optLower = opt.toLowerCase();
        for (const kw of cuissonKeywords) {
          if (kw.type === 'product') continue; // skip product-only keywords here
          if (optLower.includes(kw.keyword.toLowerCase())) {
            order.cuissonItems.push({
              label: kw.label,
              color: kw.color,
              qty: item.qty,
              source: 'option',
              productName: item.name,
              optionName: opt,
            });
          }
        }
      }
    }

    order.hasCuisson = order.cuissonItems.length > 0;
  }

  return fullOrders;
}

module.exports = { initBrowser, closeBrowser, login, scrapeAll, ensureLoggedIn, getOtpStatus, submitOtp, resetAndResendOtp };
