// ============================================================
// KDS Konapoke — Zelty Scraper (Playwright)
// ============================================================

const { chromium } = require('playwright');
const config = require('./config');

let browser = null;
let context = null;
let page = null;
let isLoggedIn = false;

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
    console.log('[Scraper] Logging in to Zelty...');
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
    await page.fill('input[name="email"], input[type="email"]', config.zelty.email);
    await page.fill('input[name="password"], input[type="password"]', config.zelty.password);
    await page.click('button[type="submit"], input[type="submit"]');

    // Wait for navigation after login
    await page.waitForURL('**/board**', {
      timeout: config.scraping.navigationTimeout,
    });

    console.log('[Scraper] Login successful.');
    isLoggedIn = true;
    return true;
  } catch (err) {
    console.error('[Scraper] Login failed:', err.message);
    isLoggedIn = false;
    return false;
  }
}

// ----- Check / recover session -----

async function ensureLoggedIn() {
  if (!browser || !page) {
    await initBrowser();
  }

  // Quick check: try to detect login page
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || !isLoggedIn) {
      return await login();
    }
    return true;
  } catch {
    // Page may have crashed
    await closeBrowser();
    await initBrowser();
    return await login();
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
  if (!(await ensureLoggedIn())) {
    throw new Error('Not logged in');
  }

  const boardUrl = getTodayBoardUrl();
  console.log(`[Scraper] Navigating to board: ${boardUrl}`);

  await page.goto(boardUrl, {
    waitUntil: 'networkidle',
    timeout: config.scraping.navigationTimeout,
  });

  // Check for login redirect
  if (page.url().includes('/login')) {
    isLoggedIn = false;
    if (!(await login())) throw new Error('Session expired, re-login failed');
    await page.goto(boardUrl, {
      waitUntil: 'networkidle',
      timeout: config.scraping.navigationTimeout,
    });
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

  // Find the "Commandes ouvertes" table
  const orders = await page.evaluate(() => {
    const widgets = document.querySelectorAll('.widget.widget_table');
    for (const widget of widgets) {
      const title = widget.querySelector('h3.widget-title');
      if (!title || !title.textContent.includes('Commandes ouvertes')) continue;

      const rows = widget.querySelectorAll('tbody tr');
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

module.exports = { initBrowser, closeBrowser, login, scrapeAll, ensureLoggedIn };
