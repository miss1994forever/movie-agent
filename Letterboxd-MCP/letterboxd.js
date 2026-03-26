const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function envInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_HTTP_TIMEOUT_MS = envInt(process.env.LETTERBOXD_HTTP_TIMEOUT_MS, 20000);
const MAX_REDIRECTS = envInt(process.env.LETTERBOXD_MAX_REDIRECTS, 5);
const LOGIN_WAIT_MS = envInt(process.env.LETTERBOXD_LOGIN_WAIT_MS, 20000);
const INTERACTIVE_LOGIN_WAIT_MS = envInt(process.env.LETTERBOXD_INTERACTIVE_LOGIN_WAIT_MS, 45000);
const BROWSER_CHANNEL = process.env.LETTERBOXD_BROWSER_CHANNEL || 'chrome';
const BROWSER_USER_DATA_DIR =
  process.env.LETTERBOXD_BROWSER_USER_DATA_DIR ||
  path.join(os.homedir(), '.movie-rec-letterboxd-profile');
const LOGIN_STRATEGY = (process.env.LETTERBOXD_LOGIN_STRATEGY || 'auto').toLowerCase();
const BLOCK_AD_REQUESTS = process.env.LETTERBOXD_BLOCK_AD_REQUESTS !== 'false';
const STEALTH_MODE = process.env.LETTERBOXD_STEALTH !== 'false';
const MANUAL_PREFILL_CREDENTIALS = process.env.LETTERBOXD_MANUAL_PREFILL_CREDENTIALS !== 'false';

const AD_HOST_PATTERNS = [
  /(^|\.)rubiconproject\.com$/i,
  /(^|\.)liadm\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)adnxs\.com$/i,
  /(^|\.)openx\.net$/i,
  /(^|\.)criteo\.com$/i,
  /(^|\.)pubmatic\.com$/i,
  /(^|\.)taboola\.com$/i,
  /(^|\.)outbrain\.com$/i,
];

function shouldBlockUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname;
    return AD_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

function isProfileLockError(err) {
  const text = String(err || '');
  return text.includes('ProcessSingleton') || text.includes('SingletonLock');
}

function tempProfileDir() {
  return path.join(os.tmpdir(), `movie-rec-letterboxd-profile-${Date.now()}`);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value) return [value];
  return [];
}

function cleanJsonLd(raw) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, '')
    .replace(/\/\*\s*\]\]>\s*\*\/\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

class LetterboxdClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://letterboxd.com';
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.httpTimeoutMs = options.httpTimeoutMs || DEFAULT_HTTP_TIMEOUT_MS;
    if (typeof options.loginForReads === 'boolean') {
      this.loginForReads = options.loginForReads;
    } else if (process.env.LETTERBOXD_LOGIN_FOR_READS !== undefined) {
      this.loginForReads = process.env.LETTERBOXD_LOGIN_FOR_READS !== 'false';
    } else {
      this.loginForReads = true;
    }

    this.cookies = {};
    this.cookieHeader = '';
    this.username = null;
    this.isLoggedIn = false;
    this.loginPromise = null;
    this.browser = null;
    this.browserContext = null;
    if (typeof options.browserHeadless === 'boolean') {
      this.browserHeadless = options.browserHeadless;
    } else if (process.env.LETTERBOXD_HEADLESS !== undefined) {
      this.browserHeadless = process.env.LETTERBOXD_HEADLESS !== 'false';
    } else {
      this.browserHeadless = true;
    }

    if (process.env.LETTERBOXD_COOKIE) {
      this._storeCookieHeaderString(process.env.LETTERBOXD_COOKIE);
      if (this.cookieHeader.includes('letterboxd.user.CURRENT') || this.cookieHeader.includes('persona')) {
        this.isLoggedIn = true;
      }
    }
  }

  _extractUserSlugFromHtml(html) {
    const $ = cheerio.load(typeof html === 'string' ? html : '');
    return (
      $('body').attr('data-user-name') ||
      $('.nav-account a').attr('href')?.split('/').filter(Boolean).pop() ||
      $('.nav-main-right .nav-account > a').attr('href')?.split('/').filter(Boolean).pop() ||
      ''
    );
  }

  async refreshLoginState() {
    const markerCookies =
      this.cookies['letterboxd.user.CURRENT'] ||
      this.cookies['persona'] ||
      this.cookies['letterboxd.session'];

    if (markerCookies) {
      this.isLoggedIn = true;
    }

    try {
      const home = await this._request('GET', this.baseUrl, { skipLogin: true });
      const html = typeof home.data === 'string' ? home.data : '';
      const slug = this._extractUserSlugFromHtml(html);
      if (slug) {
        this.isLoggedIn = true;
        this.username = slug;
      }
    } catch {}

    return this.isLoggedIn;
  }

  async init() {
    return;
  }

  _storeCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of headers) {
      const pair = header.split(';')[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) continue;
      if (value) {
        this.cookies[name] = value;
      } else {
        delete this.cookies[name];
      }
    }
    this.cookieHeader = Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  _storeCookieHeaderString(cookieHeaderString) {
    if (!cookieHeaderString) return;
    const segments = String(cookieHeaderString)
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean);

    for (const pair of segments) {
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!name) continue;
      if (value) this.cookies[name] = value;
      else delete this.cookies[name];
    }

    this.cookieHeader = Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async _request(method, url, options = {}) {
    let currentUrl = url;
    let currentMethod = method;
    let currentData = options.data;
    let redirects = 0;

    while (redirects <= MAX_REDIRECTS) {
      const headers = {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        ...(options.headers || {}),
      };
      if (this.cookieHeader) {
        headers.Cookie = this.cookieHeader;
      }

      const response = await axios({
        method: currentMethod,
        url: currentUrl,
        data: currentData,
        headers,
        timeout: this.httpTimeoutMs,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      this._storeCookies(response.headers['set-cookie']);

      const status = response.status;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        const nextUrl = new URL(location, currentUrl).toString();
        if (status === 303 || (currentMethod !== 'GET' && status !== 307 && status !== 308)) {
          currentMethod = 'GET';
          currentData = undefined;
        }
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }

      return response;
    }

    throw new Error('Too many redirects.');
  }

  async fetchHtml(url, options = {}) {
    if (this.loginForReads && !options.skipLogin && !this.isLoggedIn) {
      await this.ensureLoggedIn();
    }
    const response = await this._request('GET', url);
    if (response.status >= 400) {
      if (response.status === 403 || response.status === 429) {
        return this.fetchHtmlWithBrowser(url);
      }
      throw new Error(`Request failed with status ${response.status}`);
    }
    if (typeof response.data === 'string') return response.data;
    return JSON.stringify(response.data || '');
  }

  async fetchHtmlWithBrowser(url) {
    await this._ensureBrowser();
    const page = await this.browserContext.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const html = await page.content();

      const newCookies = await this.browserContext.cookies();
      for (const cookie of newCookies) {
        this.cookies[cookie.name] = cookie.value;
      }
      this.cookieHeader = Object.entries(this.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');

      return html;
    } finally {
      await page.close();
    }
  }

  async getPageSource(url) {
    return this.fetchHtml(url);
  }

  resolveCursor(cursor, fallbackUrl) {
    if (!cursor) return fallbackUrl;
    if (cursor.startsWith('http://') || cursor.startsWith('https://')) return cursor;
    const path = cursor.startsWith('/') ? cursor : `/${cursor}`;
    return `${this.baseUrl}${path}`.replace(/([^:]\/)\/+/g, "$1");
  }

  _extractPosterItems($, root) {
    const scope = root && root.length ? root : $.root();
    const items = [];
    const seen = new Set();
    scope
      .find('.poster-grid .griditem, .poster-container, .poster-list .posteritem, .film-poster')
      .each((i, el) => {
        const node = $(el);
        const poster = node.hasClass('film-poster') ? node : node.find('.film-poster').first();
        const dataName =
          node.attr('data-film-name') ||
          node.attr('data-item-name') ||
          poster.attr('data-film-name') ||
          poster.attr('data-item-name') ||
          node.find('[data-film-name]').attr('data-film-name') ||
          node.find('[data-item-name]').attr('data-item-name') ||
          '';
        const imgAlt =
          node.find('img').attr('alt') ||
          poster.find('img').attr('alt') ||
          node.find('img').attr('title') ||
          node.attr('aria-label') ||
          '';
        const title = (dataName || imgAlt || '').replace(/^Poster for /, '').trim();

        const slugFromData =
          node.attr('data-film-slug') ||
          node.attr('data-item-slug') ||
          poster.attr('data-film-slug') ||
          poster.attr('data-item-slug') ||
          node.find('[data-film-slug]').attr('data-film-slug') ||
          node.find('[data-item-slug]').attr('data-item-slug') ||
          '';
        const link =
          node.find('a[href*="/film/"]').first().attr('href') ||
          poster.find('a[href*="/film/"]').first().attr('href') ||
          '';
        const slugFromLink = link ? link.split('/').filter(Boolean).pop() : '';
        const slug = slugFromData || slugFromLink;

        const posterImg = node.find('img').first();
        let posterUrl = posterImg.attr('src') || '';
        // Handle lazy loading or srcset for better resolution
        const srcset = posterImg.attr('srcset');
        if (srcset) {
            const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
            if (sources.length > 0) posterUrl = sources[sources.length - 1];
        }

        const rating =
          node.find('.rating').first().text().trim() ||
          poster.find('.rating').first().text().trim() ||
          node.find('[data-rating]').attr('data-rating') ||
          poster.attr('data-rating') ||
          null;

        if (!slug || seen.has(slug)) return;
        seen.add(slug);
        items.push({ 
            title: title || slug.replace(/-/g, ' ').trim(), 
            slug,
            posterUrl: posterUrl.startsWith('http') ? posterUrl : (posterUrl ? `https:${posterUrl}` : ''),
            ...(rating ? { rating } : {})
        });
      });
    return items;
  }

  async fetchPage(url, scraperFunc, limit) {
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);
    let items = scraperFunc($);
    const nextLink =
      $('.paginate-next a, .next a, a.paginate-next, a.next, .pagination a.next').first().attr('href') ||
      $('link[rel="next"]').attr('href') ||
      null;
    const nextCursor = nextLink ? new URL(nextLink, url).toString() : null;
    return { items, nextCursor };
  }

  async _getSigninForm() {
    const response = await this._request('GET', `${this.baseUrl}/sign-in/`, { skipLogin: true });
    const html = typeof response.data === 'string' ? response.data : '';
    const $ = cheerio.load(html);
    const form = $('form[action="/user/login.do"], form.js-sign-in-form').first();
    const csrfFromForm = form.find('input[name="__csrf"]').attr('value') || '';
    const csrfFromCookie = this.cookies['com.xk72.webparts.csrf'] || '';
    const csrf = csrfFromForm || csrfFromCookie;
    const formAction = form.attr('action') || '/user/login.do';
    const action = new URL(formAction, this.baseUrl).toString();

    return {
      action,
      fields: { __csrf: csrf },
    };
  }

  async login(username, password) {
    this.username = username;
    await this.refreshLoginState();

    const tryBrowserLoginWithRetry = async () => {
      let lastError = null;
      for (let i = 0; i < 2; i += 1) {
        try {
          console.error(`[Letterboxd] Attempting browser login (attempt ${i + 1}/2)...`);
          await this.loginWithBrowser(username, password, { manualOnly: false });
          if (this.isLoggedIn) {
            console.error('[Letterboxd] Browser login successful!');
            return;
          }
        } catch (err) {
          lastError = err;
          console.error(`[Letterboxd] Browser login attempt ${i + 1} failed:`, err.message);
          const errText = String(err || '');
          if (errText.includes('Target page, context or browser has been closed')) {
            await this.close().catch(() => {});
          }
        }
        if (i === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
      if (lastError) throw lastError;
    };

    if (!this.isLoggedIn) {
      if (LOGIN_STRATEGY === 'manual') {
        console.error('[Letterboxd] Using manual login strategy (browser will open)...');
        await this.loginWithBrowser(username, password, { manualOnly: true });
      } else if (LOGIN_STRATEGY === 'auto') {
        try {
          console.error('[Letterboxd] Trying HTTP login first...');
          await this.loginWithHttp(username, password);
          if (this.isLoggedIn) {
            console.error('[Letterboxd] HTTP login successful!');
          }
        } catch (httpErr) {
          console.error('[Letterboxd] HTTP login failed:', httpErr.message);
        }
        if (!this.isLoggedIn) {
          console.error('[Letterboxd] Falling back to browser login...');
          await tryBrowserLoginWithRetry();
        }
      } else {
        // hybrid: keep fast HTTP path, then fall back to browser manual/interactive.
        try {
          console.error('[Letterboxd] Trying HTTP login first...');
          await this.loginWithHttp(username, password);
          if (this.isLoggedIn) {
            console.error('[Letterboxd] HTTP login successful!');
          }
        } catch (httpErr) {
          console.error('[Letterboxd] HTTP login failed:', httpErr.message);
        }
        if (!this.isLoggedIn) {
          console.error('[Letterboxd] Falling back to browser login...');
          await tryBrowserLoginWithRetry();
        }
      }
    }

    // Keep best-effort slug normalization after successful login.
    if (this.isLoggedIn && username && !username.includes('@')) {
      this.username = username;
    }
    if (this.isLoggedIn) {
      await this.refreshLoginState();
      console.error(`[Letterboxd] Login successful! Logged in as: ${this.username}`);
      return true;
    }
    throw new Error('Login failed: Invalid credentials or session blocked by Letterboxd.');
  }

  async loginWithHttp(username, password) {
    console.error('[Letterboxd] Starting HTTP login...');
    const { action, fields } = await this._getSigninForm();
    console.error(`[Letterboxd] Got CSRF token: ${fields['__csrf'] ? 'yes' : 'no'}`);

    const form = new URLSearchParams();
    form.append('__csrf', fields['__csrf'] || '');
    form.append('username', username);
    form.append('password', password);
    form.append('remember', 'on');

    console.error(`[Letterboxd] Posting to: ${action}`);
    const loginResponse = await this._request('POST', action, {
      data: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${this.baseUrl}/sign-in/`,
        'Origin': this.baseUrl,
      },
    });

    console.error(`[Letterboxd] Login response status: ${loginResponse.status}`);
    
    if (loginResponse.status >= 400) {
      throw new Error(`HTTP login failed with status ${loginResponse.status}`);
    }

    if (typeof loginResponse.data === 'object' && loginResponse.data !== null) {
      const result = String(loginResponse.data.result || '').toLowerCase();
      console.error(`[Letterboxd] Login result: ${result}`);
      if (result && result !== 'success') {
        throw new Error(`Login rejected by server: ${result}`);
      }
    }

    await this.refreshLoginState();
    console.error(`[Letterboxd] After HTTP login, isLoggedIn: ${this.isLoggedIn}`);
  }

  async loginWithBrowser(username, password, options = {}) {
    const manualOnly = !!options.manualOnly;
    console.error(`[Letterboxd] Browser login starting (manualOnly: ${manualOnly})...`);
    await this._ensureBrowser();
    const page = await this.browserContext.newPage();
    try {
      console.error('[Letterboxd] Navigating to sign-in page...');
      await page.goto(`${this.baseUrl}/sign-in/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      console.error(`[Letterboxd] Current URL: ${page.url()}`);

      const getLoginInputs = async (timeoutMs) => {
        const userInput = page.locator('input[name="username"], input[name="email"], input[type="email"], #username').first();
        const passInput = page.locator('input[name="password"], input[type="password"], #password').first();
        await userInput.waitFor({ state: 'visible', timeout: timeoutMs });
        await passInput.waitFor({ state: 'visible', timeout: timeoutMs });
        return { userInput, passInput };
      };

      let userInput;
      let passInput;
      try {
        console.error('[Letterboxd] Looking for login form inputs...');
        ({ userInput, passInput } = await getLoginInputs(LOGIN_WAIT_MS));
        console.error('[Letterboxd] ✓ Found username and password fields');
      } catch (inputErr) {
        console.error(`[Letterboxd] ✗ Form inputs not found: ${inputErr.message}`);
        if (this.browserHeadless || INTERACTIVE_LOGIN_WAIT_MS <= 0) {
          throw inputErr;
        }

        console.error(`[Letterboxd] Waiting up to ${INTERACTIVE_LOGIN_WAIT_MS/1000}s for form to appear...`);
        // Keep the browser open to let user clear anti-bot/challenge gates.
        const deadline = Date.now() + INTERACTIVE_LOGIN_WAIT_MS;
        let resolved = false;
        while (Date.now() < deadline) {
          try {
            ({ userInput, passInput } = await getLoginInputs(1200));
            console.error('[Letterboxd] ✓ Form appeared!');
            resolved = true;
            break;
          } catch {
            await page.waitForTimeout(1200);
          }
        }
        if (!resolved) {
          throw new Error('Login form unavailable after anti-bot wait window. Please rerun with LETTERBOXD_HEADLESS=false and complete the browser verification when prompted.');
        }
      }

      if (MANUAL_PREFILL_CREDENTIALS) {
        console.error('[Letterboxd] Pre-filling credentials (manual mode)...');
        await userInput.fill(username || '');
        await passInput.fill(password || '');
        console.error('[Letterboxd] Credentials pre-filled. Waiting for manual submission...');
      }

      if (!manualOnly) {
        if (!MANUAL_PREFILL_CREDENTIALS) {
          console.error('[Letterboxd] Filling credentials...');
          await userInput.fill(username || '');
          await passInput.fill(password || '');
          console.error('[Letterboxd] ✓ Credentials filled');
        }

        console.error('[Letterboxd] Looking for submit button...');
        const submitButton = page.locator('button[type="submit"], input[type="submit"], .sign-in-form button').first();
        
        console.error('[Letterboxd] Clicking submit button...');
        await Promise.all([
          page.waitForTimeout(1200),
          submitButton.click().catch(async (err) => {
            console.error(`[Letterboxd] Submit button click failed: ${err.message}, trying Enter key...`);
            await passInput.press('Enter');
          }),
        ]);
        console.error('[Letterboxd] Form submitted, waiting for response...');
        await page.waitForTimeout(3000);  // Increased wait time for redirect
        console.error(`[Letterboxd] Current URL after submit: ${page.url()}`);
      }

      // Don't force navigation if we're already on a different page after form submit
      if (!manualOnly && page.url().includes('/sign-in')) {
        console.error('[Letterboxd] Still on sign-in page, navigating to home...');
        await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(1000);
      } else if (!manualOnly) {
        console.error('[Letterboxd] Already navigated away from sign-in page');
        await page.waitForTimeout(1000);
      }

      const readBrowserAuthState = async () => {
        const meUrl = page.url();
        const meHtml = await page.content();
        const meSlug = this._extractUserSlugFromHtml(meHtml);
        const pathParts = (() => {
          try {
            return new URL(meUrl).pathname.split('/').filter(Boolean);
          } catch {
            return [];
          }
        })();
        const urlSlug = pathParts.length ? pathParts[0] : '';
        const blockedPaths = new Set(['sign-in', 'user']);
        const browserLoggedIn = !!(
          meSlug ||
          (urlSlug && !blockedPaths.has(urlSlug)) ||
          /sign\s*out/i.test(meHtml)
        );
        return { browserLoggedIn, meSlug, urlSlug, blockedPaths };
      };

      console.error('[Letterboxd] Checking login state...');
      let { browserLoggedIn, meSlug, urlSlug, blockedPaths } = await readBrowserAuthState();
      console.error(`[Letterboxd] Initial check - URL: ${page.url()}, Slug: ${meSlug}, LoggedIn: ${browserLoggedIn}`);
      
      if (!browserLoggedIn && !this.browserHeadless && INTERACTIVE_LOGIN_WAIT_MS > 0) {
        console.error(`[Letterboxd] Not logged in yet. Waiting up to ${INTERACTIVE_LOGIN_WAIT_MS/1000}s for manual login...`);
        // Allow user to complete anti-bot/manual auth in the opened Chrome window.
        const deadline = Date.now() + INTERACTIVE_LOGIN_WAIT_MS;
        let checkCount = 0;
        while (!browserLoggedIn && Date.now() < deadline) {
          await page.waitForTimeout(2000);
          checkCount++;

          // Sync browser cookies while user completes verification/login manually.
          const liveCookies = await this.browserContext.cookies();
          for (const cookie of liveCookies) {
            this.cookies[cookie.name] = cookie.value;
          }
          this.cookieHeader = Object.entries(this.cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');

          ({ browserLoggedIn, meSlug, urlSlug, blockedPaths } = await readBrowserAuthState());
          
          if (checkCount % 5 === 0) {
            const timeLeft = Math.max(0, (deadline - Date.now()) / 1000);
            console.error(`[Letterboxd] Still waiting... (${timeLeft.toFixed(0)}s left, URL: ${page.url()})`);
          }
          
          if (browserLoggedIn) {
            console.error(`[Letterboxd] ✓ Login detected! User: ${meSlug}`);
          }
        }
        
        if (!browserLoggedIn) {
          console.error('[Letterboxd] Timeout waiting for login');
        }
      }

      const browserCookies = await this.browserContext.cookies();
      console.error(`[Letterboxd] Collected ${browserCookies.length} cookies from browser`);
      for (const cookie of browserCookies) {
        this.cookies[cookie.name] = cookie.value;
      }
      this.cookieHeader = Object.entries(this.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
      
      const hasSessionCookie = this.cookies['letterboxd.session'] || false;
      const hasPersonaCookie = this.cookies['persona'] || false;
      const hasCurrentCookie = this.cookies['letterboxd.user.CURRENT'] || false;
      console.error(`[Letterboxd] Session cookies - session: ${!!hasSessionCookie}, persona: ${!!hasPersonaCookie}, current: ${!!hasCurrentCookie}`);
      
      if (browserLoggedIn) {
        this.isLoggedIn = true;
        if (meSlug) this.username = meSlug;
        else if (urlSlug && !blockedPaths.has(urlSlug)) this.username = urlSlug;
        console.error(`[Letterboxd] ✓ Browser login successful! Username: ${this.username}`);
      } else {
        console.error('[Letterboxd] Browser login failed, trying refreshLoginState...');
        await this.refreshLoginState();
        console.error(`[Letterboxd] After refresh: isLoggedIn=${this.isLoggedIn}, username=${this.username}`);
      }

      if (!this.isLoggedIn) {
        console.error('[Letterboxd] ✗ Browser login failed - not authenticated');
        throw new Error('Browser login did not reach an authenticated page. You may need to complete anti-bot verification manually or use LETTERBOXD_COOKIE mode.');
      }
    } finally {
      await page.close();
    }
  }

  async ensureLoggedIn() {
    if (this.isLoggedIn) {
      if (!this.username || this.username.includes('@')) {
        let envUser = process.env.LETTERBOXD_USERNAME;
        try {
          const homeHtml = await this.fetchHtml(this.baseUrl, { skipLogin: true });
          const $home = cheerio.load(homeHtml);
          const userSlug = $home('body').attr('data-user-name') || 
                           $home('.nav-account a').attr('href')?.split('/').filter(Boolean).pop() ||
                           $home('.nav-main-right .nav-account > a').attr('href')?.split('/').filter(Boolean).pop();
          if (userSlug) {
            this.username = userSlug;
          } else if (envUser && !envUser.includes('@')) {
            this.username = envUser;
          }
        } catch (e) {
          if (envUser && !envUser.includes('@')) this.username = envUser;
        }
      }
      return;
    }
    if (this.loginPromise) return this.loginPromise;
    
    // Priority 1: Check if we have cookies in environment (Cookie-based auth)
    const envCookie = process.env.LETTERBOXD_COOKIE;
    if (envCookie && envCookie.trim()) {
      console.error('[Letterboxd] Found LETTERBOXD_COOKIE in environment');
      this._storeCookieHeaderString(envCookie);
      
      if (this.cookieHeader && (this.cookieHeader.includes('letterboxd.user.CURRENT') || 
          this.cookieHeader.includes('persona') || this.cookieHeader.includes('letterboxd.session'))) {
        console.error('[Letterboxd] Cookie contains session markers, verifying...');
        this.isLoggedIn = true;
        await this.refreshLoginState();
        
        if (this.isLoggedIn) {
          console.error(`[Letterboxd] ✓ Cookie authentication successful! User: ${this.username}`);
          return;
        } else {
          console.error('[Letterboxd] ✗ Cookie appears invalid or expired');
        }
      } else {
        console.error('[Letterboxd] Cookie missing required session markers');
      }
    }
    
    // Check again if cookies were set manually after constructor (legacy check)
    if (!envCookie && this.cookieHeader && (this.cookieHeader.includes('letterboxd.user.CURRENT') || this.cookieHeader.includes('persona'))) {
      console.error('[Letterboxd] Using existing cookie header');
      this.isLoggedIn = true;
      await this.refreshLoginState();
      if (this.isLoggedIn) {
        return;
      }
    }

    // Priority 2: Try username/password login only if cookies not available
    let username = process.env.LETTERBOXD_USERNAME;
    let password = process.env.LETTERBOXD_PASSWORD;
    
    if ((!username || !password) && process.env.LETTERBOXD_CREDENTIALS) {
      const [user, ...rest] = process.env.LETTERBOXD_CREDENTIALS.split(':');
      if (user && rest.length) {
        username = user;
        password = rest.join(':');
      }
    }
    
    if (!username || !password) {
      throw new Error(
        'Missing Letterboxd credentials. Set LETTERBOXD_COOKIE (recommended), or LETTERBOXD_USERNAME/LETTERBOXD_PASSWORD, or disable with LETTERBOXD_LOGIN_FOR_READS=false.'
      );
    }
    
    console.error('[Letterboxd] No valid cookie found, attempting username/password login...');
    this.loginPromise = this.login(username, password).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async search(query, type = 'films', options = {}) {
    const url = this.resolveCursor(
      options.cursor,
      `${this.baseUrl}/search/${type}/${encodeURIComponent(query)}/`
    );
    const { items, nextCursor } = await this.fetchPage(
      url,
      ($) => {
        const results = [];
        $('.results li').each((i, el) => {
          const titleElement = $(el).find('.film-title-wrapper a, .name a').first();
          const title = titleElement.text().trim() || $(el).find('.name').text().trim();
          const link = titleElement.attr('href') || $(el).find('a').attr('href');
          if (title && link) {
            results.push({
              title,
              url: `${this.baseUrl}${link}`,
              slug: link.split('/').filter(Boolean).pop(),
            });
          }
        });
        return results;
      },
      options.limit
    );
    return { items, nextCursor };
  }

  async getFilm(slug) {
    const url = `${this.baseUrl}/film/${slug}/`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    let filmData = {};
    const jsonLdEntries = $('script[type="application/ld+json"]')
      .map((i, el) => cleanJsonLd($(el).html()))
      .get()
      .filter(Boolean);

    for (const entry of jsonLdEntries) {
      const items = Array.isArray(entry) ? entry : entry['@graph'] ? entry['@graph'] : [entry];
      for (const item of items) {
        if (!item || !item['@type']) continue;
        if (item['@type'] === 'Movie' || item['@type'] === 'Film') {
          filmData = item;
          break;
        }
      }
      if (filmData['@type']) break;
    }

    const directors = toArray(filmData.director)
      .map((director) => director.name)
      .filter(Boolean)
      .join(', ');

    const releasedEvent = toArray(filmData.releasedEvent)[0];
    const year =
      (releasedEvent && releasedEvent.startDate) ||
      filmData.datePublished ||
      $('.releaseyear a').text().trim();

    const genres = toArray(filmData.genre).filter(Boolean);
    const synopsis =
      $('.truncate p').text().trim() ||
      $('.review-body-text').first().text().trim() ||
      $('.body-text').first().text().trim();

    const rating =
      (filmData.aggregateRating && filmData.aggregateRating.ratingValue) ||
      $('.average-rating a, .average-rating').first().text().trim();

    const posterUrl = $('meta[property="og:image"]').attr('content') || '';
    
    const cast = $('.cast-list .actor').map((i, el) => $(el).text().trim()).get().join(', ');
    const runtimeText = $('.text-footer').text().match(/(\d+)\s+mins/);
    const runtime = runtimeText ? `${runtimeText[1]} min` : '';

    return {
      title: filmData.name || $('.headline-1').text().trim() || $('h1').first().text().trim(),
      year,
      director: directors || $('.director a').map((i, el) => $(el).text().trim()).get().join(', '),
      synopsis,
      cast,
      runtime,
      rating,
      genre: genres.join(', '),
      posterUrl,
      url,
    };
  }

  async getList(username, listSlug, options = {}) {
    if (!listSlug) {
      return this.getLists(username, options);
    }

    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/list/${listSlug}/`);
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);
    const list = this._extractListMeta($, url, username, listSlug);

    let items = this._extractPosterItems($);

    const nextLink =
      $('.paginate-next a, .next a, a.paginate-next, a.next').first().attr('href') ||
      $('link[rel="next"]').attr('href') ||
      null;
    const nextCursor = nextLink ? new URL(nextLink, url).toString() : null;

    return { list, items, nextCursor };
  }

  async getReview(username, filmSlug, reviewId) {
    const suffix = reviewId ? `/${reviewId}/` : '/';
    const url = `${this.baseUrl}/${username}/film/${filmSlug}${suffix}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const filmTitle =
      $('.film-viewing-info-wrapper .name a').first().text().trim() ||
      $('.headline-1 a').first().text().trim() ||
      $('h1').first().text().trim();

    const bodyContainer = $('.js-review-body').first();
    let reviewText = '';
    if (bodyContainer.length) {
      bodyContainer.find('br').replaceWith('\n');
      const paragraphs = bodyContainer.find('p');
      if (paragraphs.length) {
        reviewText = paragraphs
          .map((i, el) => $(el).text().trim())
          .get()
          .join('\n\n');
      } else {
        reviewText = bodyContainer.text().trim();
      }
    } else {
      // Fallback for older layouts or if js-review-body is missing
      reviewText =
        $('.review .body-text, .review-body, .body-text').first().text().trim();
    }

    const rating =
      $('.rating-large').text().trim() ||
      $('meta[name="twitter:data2"]').attr('content') ||
      '';

    let date = '';
    const dateMeta = $('meta[property="og:type"][content="letterboxd:review"] ~ meta[content^="20"]'); 
    // The meta content date usually appears near the top, but finding it by content regex in cheerio is hard directly.
    // Let's use the visible date.
    const dateLink = $('.view-date .date-links a').last();
    if (dateLink.length) {
      date = $('.view-date').text().replace(/\s+/g, ' ').trim();
    } else {
      date = $('.view-date').text().replace(/\s+/g, ' ').trim();
    }

    const likeCountRaw =
      $('.review-like').attr('data-count') ||
      $('.like-link-target').attr('data-count');
    const likeCount = likeCountRaw ? parseInt(likeCountRaw, 10) : 0;

    // Check for spoilers
    const spoiler = $('.contains-spoilers').length > 0;

    return {
      filmTitle,
      username,
      filmSlug,
      reviewText,
      rating,
      date,
      likeCount,
      spoiler,
      url,
    };
  }

  async getMember(username) {
    const url = `${this.baseUrl}/${username}/`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const bio = $('.bio p').text().trim();
    const stats = {};
    $('.profile-stats a').each((i, el) => {
      const label = $(el).find('.definition').text().trim();
      const value = $(el).find('.value').text().trim();
      if (label) stats[label] = value;
    });

    const displayName = $('h1').first().text().trim();
    return { username, displayName, bio, stats, url };
  }

  _extractUserLists($, root, username) {
    const scope = root && root.length ? root : $.root();
    const items = [];
    const seen = new Set();

    // Letterboxd private lists or lists viewed by owner can be in different containers
    const listNodes = scope.find(
      '.list-set, .list, li.list-set, li.list, .list-entry, .list-preview, article, section, .table-list tr'
    );

    if (listNodes.length) {
      listNodes.each((i, el) => {
        const node = $(el);
        const link =
          node.find('a[href*="/list/"]').first().attr('href') ||
          node.find('a.list-link').first().attr('href') ||
          node.attr('href') || '';
        
        if (!link || link.includes('/new/')) return;

        const parts = link.split('/').filter(Boolean);
        const listIndex = parts.indexOf('list');
        if (listIndex < 0) return;
        
        const slug = parts[listIndex + 1];
        if (!slug || seen.has(slug)) return;

        const title =
          node.find('.list-title, .title, h2 a, h3 a, h2, h3, .name').first().text().trim() ||
          node.find('a[href*="/list/"]').first().text().trim() ||
          slug.replace(/-/g, ' ');

        const description =
          node.find('.body-text, .list-description, .notes, p').first().text().trim() || '';

        const isPrivate = node.find('.icon-lock, .-private, .private').length > 0;

        const url = link.startsWith('http')
          ? link
          : `${this.baseUrl}${link.startsWith('/') ? link : `/${link}`}`;
        
        const owner = username || (listIndex > 0 ? parts[listIndex - 1] : null);

        items.push({ 
            title: isPrivate ? `[PRIVÉE] ${title}` : title, 
            slug, 
            url, 
            description, 
            isPrivate,
            username: owner 
        });
        seen.add(slug);
      });
    }

    if (!items.length) {
      $('a[href*="/list/"]').each((i, el) => {
        const link = $(el).attr('href');
        if (!link) return;
        const parts = link.split('/').filter(Boolean);
        const listIndex = parts.indexOf('list');
        if (listIndex < 0 || !parts[listIndex + 1]) return;
        const slug = parts[listIndex + 1];
        if (seen.has(slug)) return;
        const title = $(el).text().trim() || slug.replace(/-/g, ' ');
        const url = link.startsWith('http')
          ? link
          : `${this.baseUrl}${link.startsWith('/') ? link : `/${link}`}`;
        const owner = username || (listIndex > 0 ? parts[listIndex - 1] : null);
        items.push({ title, slug, url, description: '', itemCount: null, username: owner });
        seen.add(slug);
      });
    }

    return items;
  }

  _extractListMeta($, url, username, listSlug) {
    const title =
      $('meta[property="og:title"]').attr('content')?.replace(/\s*•\s*Letterboxd/i, '').trim() ||
      $('h1').first().text().trim() ||
      listSlug;

    const description =
      $('meta[name="description"]').attr('content') ||
      $('.list-description .body-text, .list-notes .body-text, .list-description, .list-notes')
        .first()
        .text()
        .trim() ||
      '';

    const metaText =
      $('.list-meta, .list-details, .metadata').first().text().trim() ||
      $('.list-meta').text().trim();
    const countMatch = metaText.match(/(\d+[\d,]*)\s*(film|films)/i);
    const itemCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : null;

    const ownerLink =
      $('.list-author a, .creator a, .list-meta a[href^="/"]').first().attr('href') || '';
    const owner =
      ownerLink.split('/').filter(Boolean)[0] ||
      username ||
      null;

    return {
      title,
      description,
      itemCount,
      url,
      username: owner,
      slug: listSlug,
    };
  }

  async getLists(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/lists/`);
    return this.fetchPage(url, ($) => this._extractUserLists($, null, username), options.limit);
  }

  _findFavoritesSection($) {
    const selectors = ['#favourites', '#favorites', '#favourite-films', '#favorite-films'];
    for (const selector of selectors) {
      const section = $(selector).first();
      if (section.length) return section;
    }

    const dataSection = $('[data-component-class*="Favor"], [data-component*="Favor"]').first();
    if (dataSection.length) return dataSection;

    const byHeading = $('section')
      .filter((i, el) => {
        const heading = $(el).find('h2, h3').first().text().trim().toLowerCase();
        return heading.includes('favorite') || heading.includes('favourite');
      })
      .first();
    if (byHeading.length) return byHeading;
    return null;
  }

  async getMemberPinned(username) {
    const url = `${this.baseUrl}/${username}/`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);
    let items = [];

    const section = this._findFavoritesSection($);
    if (section && section.length) {
      items = this._extractPosterItems($, section);
    }

    if (!items.length) {
      const heading = $('h2, h3')
        .filter((i, el) => {
          const text = $(el).text().trim().toLowerCase();
          return text.includes('favorite') || text.includes('favourite');
        })
        .first();
      if (heading.length) {
        const container = heading.closest('section, div, li, article');
        if (container.length) {
          items = this._extractPosterItems($, container);
        }
        if (!items.length) {
          const next = heading.parent().next();
          if (next.length) {
            items = this._extractPosterItems($, next);
          }
        }
      }
    }

    if (!items.length) {
      const candidates = $('[id*="fav"], [class*="fav"]').filter((i, el) => {
        const id = ($(el).attr('id') || '').toLowerCase();
        const cls = ($(el).attr('class') || '').toLowerCase();
        return id.includes('favor') || id.includes('favour') || cls.includes('favor') || cls.includes('favour');
      });

      let best = [];
      candidates.each((i, el) => {
        const found = this._extractPosterItems($, $(el));
        if (found.length > best.length) {
          best = found;
        }
      });
      items = best;
    }

    if (!items.length) {
      items = this._extractPosterItems($);
    }

    return { username, items };
  }

  async getMemberWatchlist(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/watchlist/`);
    return this.fetchPage(url, ($) => this._extractPosterItems($), options.limit);
  }

  async getMemberFilms(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/films/`);
    return this.fetchPage(url, ($) => this._extractPosterItems($), options.limit);
  }

  async getMemberRatings(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/films/ratings/`);
    return this.fetchPage(
      url,
      ($) => {
        const items = [];
        $('.poster-grid .griditem, .poster-container, .poster-list .posteritem').each((i, el) => {
          const imgAlt = $(el).find('img').attr('alt') || '';
          const title = imgAlt.replace(/^Poster for /, '').trim();
          const slug =
            $(el).find('[data-item-slug]').attr('data-item-slug') ||
            $(el).find('[data-film-slug]').attr('data-film-slug') ||
            $(el).find('.poster').attr('data-film-slug') ||
            $(el).find('a').attr('href')?.split('/').filter(Boolean).pop();
          const rating = $(el).find('.poster-viewingdata .rating').text().trim();
          if (title && slug) {
            items.push({ title, slug, rating });
          }
        });
        return items;
      },
      options.limit
    );
  }

  async getMemberReviews(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/films/reviews/`);
    return this.fetchPage(
      url,
      ($) => {
        const items = [];
        $('.listitem, li.listitem').each((i, el) => {
          const titleLink = $(el).find('.name a').first();
          const title = titleLink.text().trim();
          const link = titleLink.attr('href') || '';
          
          let reviewId = '';
          let slug = '';
          
          if (link) {
            const parts = link.split('/').filter(Boolean);
            // Expected: [username, 'film', slug, id?]
            if (parts.indexOf('film') >= 0) {
                const filmIndex = parts.indexOf('film');
                if (parts[filmIndex + 1]) slug = parts[filmIndex + 1];
                if (parts[filmIndex + 2]) reviewId = parts[filmIndex + 2];
            }
          }

          if (!slug) {
             slug = $(el).find('.react-component').attr('data-item-slug') || '';
          }

          const rating = $(el).find('.rating').text().trim();
          const summary = $(el).find('.body-text').text().trim();
          
          if (title && slug) {
            items.push({ 
                title, 
                slug, 
                reviewId, 
                rating, 
                summary, 
                url: link ? `${this.baseUrl}${link}` : '' 
            });
          }
        });
        return items;
      },
      options.limit
    );
  }

  async getMemberDiary(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/diary/`);
    return this.fetchPage(
      url,
      ($) => {
        const items = [];
        $('.diary-entry-row, tr.diary-entry-row, table#diary-table tbody tr').each((i, el) => {
          const row = $(el);
          const titleLink = row
            .find('.td-film-details h3 a, .td-film-details a, a[href*="/film/"]')
            .first();
          const title = titleLink.text().trim();
          if (!title) return;

          const slug =
            titleLink
              .attr('href')
              ?.split('/')
              .filter(Boolean)
              .pop() ||
            row.attr('data-film-slug') ||
            row.find('[data-film-slug]').attr('data-film-slug') ||
            '';

          const day = row.find('.td-calendar .day, .calendar-day, .day').first().text().trim();
          const month = row.find('.td-calendar .month, .calendar-month, .month').first().text().trim();
          let date = [day, month].filter(Boolean).join(' ');
          if (!date) {
            const dateTime = row.find('time').attr('datetime');
            if (dateTime) {
              date = dateTime.split('T')[0];
            }
          }

          const rating = row.find('.td-rating .rating, .rating').first().text().trim();
          items.push({ date, title, slug, rating });
        });
        return items;
      },
      options.limit
    );
  }

  async getCurrentUser(options = {}) {
    const tryLogin = options.tryLogin !== false;
    if (tryLogin && !this.isLoggedIn) {
      try {
        await this.ensureLoggedIn();
      } catch (err) {
        return {
          username: this.username,
          loggedIn: false,
          error: String(err || ''),
        };
      }
    }
    return { username: this.username, loggedIn: this.isLoggedIn };
  }

  async _ensureBrowser() {
    if (this.browserContext) return;
    const launchOptions = {
      headless: this.browserHeadless,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--lang=en-US,en',
      ],
      locale: 'en-US',
      timezoneId: 'Asia/Shanghai',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      },
    };

    if (STEALTH_MODE) {
      launchOptions.ignoreDefaultArgs = ['--enable-automation'];
    }
    try {
      this.browserContext = await chromium.launchPersistentContext(BROWSER_USER_DATA_DIR, {
        ...launchOptions,
        channel: BROWSER_CHANNEL,
      });
    } catch (channelErr) {
      if (isProfileLockError(channelErr)) {
        const fallbackDir = tempProfileDir();
        this.browserContext = await chromium.launchPersistentContext(fallbackDir, {
          ...launchOptions,
          channel: BROWSER_CHANNEL,
        });
      } else {
        try {
          // Fallback if the channel browser is unavailable.
          this.browserContext = await chromium.launchPersistentContext(BROWSER_USER_DATA_DIR, launchOptions);
        } catch (plainErr) {
          if (isProfileLockError(plainErr)) {
            const fallbackDir = tempProfileDir();
            this.browserContext = await chromium.launchPersistentContext(fallbackDir, launchOptions);
          } else {
            throw plainErr;
          }
        }
      }
    }
    this.browser = this.browserContext.browser() || null;

    if (STEALTH_MODE) {
      await this.browserContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      });
    }

    const cookies = Object.entries(this.cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.letterboxd.com',
      path: '/'
    }));
    await this.browserContext.addCookies(cookies);
  }

  async _performAction(url, actionFn) {
    await this._ensureBrowser();
    const page = await this.browserContext.newPage();
    try {
      console.log(`[_performAction] 导航到: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
      console.log(`[_performAction] 页面加载完成`);
      await actionFn(page);

          if (BLOCK_AD_REQUESTS) {
            await this.browserContext.route('**/*', async (route) => {
              const reqUrl = route.request().url();
              if (shouldBlockUrl(reqUrl)) {
                await route.abort();
                return;
              }
              await route.continue();
            });
          }
      
      // Sync back cookies from browser
      const newCookies = await this.browserContext.cookies();
      for (const cookie of newCookies) {
        this.cookies[cookie.name] = cookie.value;
      }
      this.cookieHeader = Object.entries(this.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
        
      return true;
    } finally {
      await page.close();
    }
  }

  async rateFilm(slug, rating) {
    await this.ensureLoggedIn();
    return this._performAction(`${this.baseUrl}/film/${slug}/`, async (page) => {
      const stars = Math.ceil(rating);
      // Letterboxd uses a specific UI for rating, we click the appropriate star
      const selector = `.rateit-range > div:nth-child(${stars})`;
      await page.waitForSelector('.rateit-range', { timeout: 5000 });
      
      // Simple range input update as fallback, then click
      await page.evaluate(({stars}) => {
          const input = document.querySelector('#frm-rating');
          if (input) {
              input.value = stars;
              input.dispatchEvent(new Event('change', { bubbles: true }));
          }
      }, {stars});
      
      // Try to click the visual star to trigger the AJAX save
      try {
          const starWidth = 13; // From your previous analysis
          await page.click('.rateit-range', { position: { x: (stars * starWidth) - 5, y: 10 } });
      } catch (e) {}
      
      await page.waitForTimeout(1000); // Wait for AJAX
    });
  }

  async addToWatched(slug, remove = false) {
    await this.ensureLoggedIn();
    console.log(`[addToWatched] 开始处理: slug=${slug}, remove=${remove}`);
    
    return this._performAction(`${this.baseUrl}/film/${slug}/`, async (page) => {
      try {
        console.log(`[addToWatched] 页面已加载: ${this.baseUrl}/film/${slug}/`);
        
        // 尝试多个可能的选择器
        const selectors = [
          '.sidebar .action.-watch',
          '.sidebar .watch-button', 
          '.sidebar .action-large.-watch',
          '.film-actions .action.-watch',
          'button[data-action="watch"]'
        ];
        
        let watchBtn = null;
        for (const selector of selectors) {
          try {
            watchBtn = page.locator(selector).first();
            await watchBtn.waitFor({ state: 'visible', timeout: 3000 });
            console.log(`[addToWatched] 找到按钮: ${selector}`);
            break;
          } catch (e) {
            console.log(`[addToWatched] 选择器 ${selector} 未找到，尝试下一个...`);
          }
        }
        
        if (!watchBtn) {
          throw new Error('未找到watch按钮');
        }
        
        const classAttr = await watchBtn.getAttribute('class') || '';
        const isCurrentlyWatched = classAttr.includes('-active') || classAttr.includes('own');
        
        console.log(`[addToWatched] 当前状态: ${isCurrentlyWatched ? '已标记watched' : '未标记watched'}`);
        console.log(`[addToWatched] 按钮类名: ${classAttr}`);
        
        if ((!remove && !isCurrentlyWatched) || (remove && isCurrentlyWatched)) {
          console.log(`[addToWatched] 执行点击操作...`);
          await watchBtn.click();
          
          // 等待操作完成
          await page.waitForTimeout(2000);
          
          // 尝试验证状态变化（但不因验证失败而报错）
          try {
            const newBtn = page.locator(selectors[0]).first();
            await newBtn.waitFor({ state: 'visible', timeout: 3000 });
            const newClassAttr = await newBtn.getAttribute('class') || '';
            const newIsWatched = newClassAttr.includes('-active') || newClassAttr.includes('own');
            
            console.log(`[addToWatched] 点击后状态: ${newIsWatched ? '已标记watched' : '未标记watched'}`);
            console.log(`[addToWatched] 新类名: ${newClassAttr}`);
            
            if (remove && newIsWatched) {
              console.log(`[addToWatched] ⚠️ 警告: 删除后电影仍显示watched，但操作可能已成功`);
            }
            if (!remove && !newIsWatched) {
              console.log(`[addToWatched] ⚠️ 警告: 添加后电影未显示watched，但操作可能已成功`);
            }
          } catch (verifyError) {
            console.log(`[addToWatched] ⚠️ 无法验证操作结果（${verifyError.message}），但点击已执行`);
          }
          
          console.log(`[addToWatched] ✅ 操作已执行`);
        } else {
          console.log(`[addToWatched] 已在目标状态，无需操作`);
        }
      } catch (error) {
        console.error(`[addToWatched] ❌ 错误: ${error.message}`);
        throw error;
      }
    });
  }

  async addToWatchlist(slug, remove = false) {
    await this.ensureLoggedIn();
    console.log(`[addToWatchlist] 开始处理: slug=${slug}, remove=${remove}`);
    
    return this._performAction(`${this.baseUrl}/film/${slug}/`, async (page) => {
      try {
        console.log(`[addToWatchlist] 页面已加载: ${this.baseUrl}/film/${slug}/`);
        
        // 尝试多个可能的选择器
        const selectors = [
          'a.add-to-watchlist',
          '.action-large.-watchlist',
          'button[data-action="watchlist"]',
          '.film-actions .watchlist-button'
        ];
        
        let watchlistBtn = null;
        for (const selector of selectors) {
          try {
            watchlistBtn = page.locator(selector).first();
            await watchlistBtn.waitFor({ state: 'visible', timeout: 3000 });
            console.log(`[addToWatchlist] 找到按钮: ${selector}`);
            break;
          } catch (e) {
            console.log(`[addToWatchlist] 选择器 ${selector} 未找到，尝试下一个...`);
          }
        }
        
        if (!watchlistBtn) {
          throw new Error('未找到watchlist按钮');
        }
        
        const classAttr = await watchlistBtn.getAttribute('class') || '';
        const isCurrentlyIn = classAttr.includes('-remove') || classAttr.includes('own') || classAttr.includes('-active');
        
        console.log(`[addToWatchlist] 当前状态: ${isCurrentlyIn ? '已在watchlist' : '不在watchlist'}`);
        console.log(`[addToWatchlist] 按钮类名: ${classAttr}`);

        if ((!remove && !isCurrentlyIn) || (remove && isCurrentlyIn)) {
          console.log(`[addToWatchlist] 执行点击操作...`);
          await watchlistBtn.click();
          
          // 等待操作完成（AJAX请求）
          await page.waitForTimeout(2000);
          
          // 尝试验证状态变化（但不因验证失败而报错）
          try {
            // 重新查找按钮（因为可能被替换了）
            const newBtn = page.locator(selectors[0]).first();
            await newBtn.waitFor({ state: 'visible', timeout: 3000 });
            const newClassAttr = await newBtn.getAttribute('class') || '';
            const newIsIn = newClassAttr.includes('-remove') || newClassAttr.includes('own') || newClassAttr.includes('-active');
            
            console.log(`[addToWatchlist] 点击后状态: ${newIsIn ? '已在watchlist' : '不在watchlist'}`);
            console.log(`[addToWatchlist] 新类名: ${newClassAttr}`);
            
            // 如果状态不对，记录警告但不抛出错误（因为操作可能已经成功）
            if (remove && newIsIn) {
              console.log(`[addToWatchlist] ⚠️ 警告: 删除后电影仍显示在watchlist，但操作可能已成功`);
            }
            if (!remove && !newIsIn) {
              console.log(`[addToWatchlist] ⚠️ 警告: 添加后电影未显示在watchlist，但操作可能已成功`);
            }
          } catch (verifyError) {
            console.log(`[addToWatchlist] ⚠️ 无法验证操作结果（${verifyError.message}），但点击已执行`);
          }
          
          console.log(`[addToWatchlist] ✅ 操作已执行`);
        } else {
          console.log(`[addToWatchlist] 已在目标状态，无需操作`);
        }
      } catch (error) {
        console.error(`[addToWatchlist] ❌ 错误: ${error.message}`);
        throw error;
      }
    });
  }

  async toggleLike(slug, reviewId = null, remove = false) {
    await this.ensureLoggedIn();
    const url = `${this.baseUrl}/film/${slug}/`;
    return this._performAction(url, async (page) => {
        if (reviewId) {
            const likeBtn = page.locator(`.review-like[data-review-id="${reviewId}"]`);
            await likeBtn.click();
        } else {
            // Target only the main film like button in the sidebar
            const likeBtn = page.locator('.sidebar .like-link-target, #featured-film-header .like-link-target').first();
            const classAttr = await likeBtn.getAttribute('class') || '';
            const isLiked = classAttr.includes('active');
            if ((!remove && !isLiked) || (remove && isLiked)) {
                await likeBtn.click();
            }
        }
        await page.waitForTimeout(1000);
    });
  }

  async writeReview(slug, options = {}) {
    await this.ensureLoggedIn();
    return this._performAction(`${this.baseUrl}/film/${slug}/`, async (page) => {
      const filmId = await page.locator('[data-film-id]').first().getAttribute('data-film-id');
      const csrf = await page.evaluate(() => document.cookie.split('; ').find(r => r.startsWith('com.xk72.webparts.csrf='))?.split('=')[1]);

      console.log(`Publication AJAX via /s/save-diary-entry pour le film ${filmId}...`);
      
      const debugInfo = await page.evaluate(async ({filmId, reviewText, rating, containsSpoilers, csrf}) => {
          const body = new URLSearchParams();
          body.append('__csrf', csrf);
          body.append('filmId', filmId);
          body.append('review', reviewText || '');
          if (rating) body.append('rating', String(rating));
          if (containsSpoilers) body.append('containsSpoilers', 'on');
          
          const today = new Date().toISOString().split('T')[0];
          body.append('viewingDateStr', today);
          body.append('addDate', 'on');

          try {
              const res = await fetch('/s/save-diary-entry', {
                  method: 'POST',
                  headers: { 
                      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 
                      'X-Requested-With': 'XMLHttpRequest' 
                  },
                  body: body.toString()
              });
              const text = await res.text();
              return { status: res.status, ok: res.ok, body: text };
          } catch (e) {
              return { error: e.message };
          }
      }, {filmId, reviewText: options.reviewText, rating: options.rating, containsSpoilers: options.containsSpoilers, csrf});

      console.log('Réponse Letterboxd :', JSON.stringify(debugInfo));
      await page.waitForTimeout(2000);
      return debugInfo.ok;
    });
  }

  async addToList(slug, listSlug) {
    await this.ensureLoggedIn();
    return this._performAction(`${this.baseUrl}/film/${slug}/`, async (page) => {
      console.log('Ouverture du menu "Add to lists..."');
      await page.click('.menu-item-add-to-list');
      await page.waitForSelector('.js-list-filter-item', { timeout: 10000 });
      
      // On nettoie le nom recherche pour etre tres souple
      const cleanSearch = listSlug.replace(/-/g, ' ').trim().toLowerCase();
      
      // On cherche parmi tous les items de liste
      const allListItems = await page.locator('.js-list-filter-item').all();
      let listOption = null;
      
      for (const item of allListItems) {
          const text = await item.innerText();
          if (text.toLowerCase().includes(cleanSearch)) {
              listOption = item;
              break;
          }
      }
      
      if (listOption) {
          const checkbox = listOption.locator('input[type="checkbox"]');
          const listId = await checkbox.getAttribute('value');
          const filmId = await page.locator('[data-film-id]').first().getAttribute('data-film-id');
          const csrf = await page.evaluate(() => document.cookie.split('; ').find(r => r.startsWith('com.xk72.webparts.csrf='))?.split('=')[1]);

          console.log(`Injection directe AJAX : Film ${filmId} -> Liste ${listId}`);
          
          await page.evaluate(async ({filmId, listId, csrf}) => {
              await fetch('/s/add-film-to-list', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
                  body: `__csrf=${csrf}&filmId=${filmId}&filmListId=${listId}`
              });
          }, {filmId, listId, csrf});

          await page.waitForTimeout(3000);
          console.log('Requête AJAX envoyée.');
      } else {
          throw new Error("Liste non trouvée.");
      }
    });
  }

  async createList(title, description, isPrivate = false, filmSlugs = []) {
    await this.ensureLoggedIn();
    return this._performAction(this.baseUrl, async (page) => {
      const csrf = await page.evaluate(() => document.cookie.split('; ').find(r => r.startsWith('com.xk72.webparts.csrf='))?.split('=')[1]);
      
      const filmIds = [];
      for (const slug of filmSlugs) {
          const html = await this.fetchHtml(`${this.baseUrl}/film/${slug}/`, { skipLogin: true });
          const $ = cheerio.load(html);
          const id = $('[data-film-id]').first().attr('data-film-id');
          if (id) filmIds.push(id);
      }

      if (filmIds.length === 0) throw new Error("At least one film is required.");

      console.log(`Création AJAX de la liste "${title}" avec film ID ${filmIds[0]}...`);
      
      await page.evaluate(async ({title, description, isPrivate, filmIds, csrf}) => {
          const body = new URLSearchParams();
          body.append('__csrf', csrf);
          body.append('filmListId', ''); 
          body.append('name', title);
          body.append('notes', description);
          body.append('tags', '');
          body.append('numberedList', 'false');
          if (isPrivate) body.append('isPrivate', 'on');
          filmIds.forEach(id => body.append('filmId', id));
          
          await fetch('/s/update-list', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
              body: body.toString()
          });
      }, {title, description, isPrivate, filmIds, csrf});

      await page.waitForTimeout(4000);
      console.log('✅ Liste créée via API interne.');
    });
  }

  async close() {
    if (this.browserContext) {
      await this.browserContext.close();
      this.browserContext = null;
      this.browser = null;
    }
  }
}

module.exports = LetterboxdClient;
