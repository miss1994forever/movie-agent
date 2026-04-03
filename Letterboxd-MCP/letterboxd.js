const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const fs = require('fs');
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
const READ_THROTTLE_MS = envInt(process.env.LETTERBOXD_READ_THROTTLE_MS, 900);
const BROWSER_PREFERENCE_MS = envInt(process.env.LETTERBOXD_BROWSER_PREFERENCE_MS, 120000);
const PROFILE_SNAPSHOT_TTL_MS = envInt(process.env.LETTERBOXD_PROFILE_SNAPSHOT_TTL_MS, 90000);
const PROFILE_SNAPSHOT_CACHE_FILE =
  process.env.LETTERBOXD_PROFILE_SNAPSHOT_CACHE_FILE ||
  path.join(os.homedir(), '.movie-rec-letterboxd', 'profile-snapshots.json');
const PROFILE_HTML_FALLBACK_DIR =
  process.env.LETTERBOXD_PROFILE_HTML_FALLBACK_DIR ||
  os.tmpdir();
const BROWSER_CHANNEL = process.env.LETTERBOXD_BROWSER_CHANNEL || 'chrome';
const BROWSER_USER_DATA_DIR =
  process.env.LETTERBOXD_BROWSER_USER_DATA_DIR ||
  path.join(os.homedir(), '.movie-rec-letterboxd-profile');
const LOGIN_STRATEGY = (process.env.LETTERBOXD_LOGIN_STRATEGY || 'auto').toLowerCase();
const BLOCK_AD_REQUESTS = process.env.LETTERBOXD_BLOCK_AD_REQUESTS !== 'false';
const STEALTH_MODE = process.env.LETTERBOXD_STEALTH !== 'false';
const MANUAL_PREFILL_CREDENTIALS = process.env.LETTERBOXD_MANUAL_PREFILL_CREDENTIALS !== 'false';
const IS_LINUX = process.platform === 'linux';

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

function normalizeLetterboxdSlug(value) {
  if (value === undefined || value === null) return '';
  let raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('@')) raw = raw.slice(1);

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (parsed.hostname && /(^|\.)letterboxd\.com$/i.test(parsed.hostname)) {
      raw = parsed.pathname;
    }
  } catch {}

  raw = raw.split('?')[0].split('#')[0];
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  const blocked = new Set(['sign-in', 'signin', 'user', 'film', 'films', 'watchlist', 'diary', 'lists', 'member']);
  const candidate = parts.length ? parts[0].replace(/^@+/, '') : raw.replace(/^@+/, '');
  return /^[a-z0-9][a-z0-9_-]{1,40}$/i.test(candidate) && !blocked.has(candidate.toLowerCase())
    ? candidate
    : '';
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
    this.routeConfigured = false;
    this.lastReadAt = 0;
    this.preferBrowserUntil = 0;
    this.profileSnapshotCache = new Map();
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

  _extractUserSlugFromCookies() {
    // letterboxd.signed.in.as contains the plain slug directly
    const signedInAs = this.cookies['letterboxd.signed.in.as'];
    if (signedInAs && /^[a-z0-9][a-z0-9_-]{1,40}$/i.test(signedInAs)) {
      return signedInAs;
    }

    const candidates = [
      this.cookies['letterboxd.user.CURRENT'],
      this.cookies['persona'],
      this.cookies['letterboxd.session'],
    ].filter(Boolean);

    const looksLikeSlug = (value) => /^[a-z0-9][a-z0-9_-]{1,40}$/i.test(value || '');

    for (const raw of candidates) {
      const decoded = (() => {
        try {
          return decodeURIComponent(raw);
        } catch {
          return String(raw || '');
        }
      })();

      if (!decoded) continue;

      if (decoded.startsWith('{') && decoded.endsWith('}')) {
        try {
          const obj = JSON.parse(decoded);
          const maybe = obj?.username || obj?.user || obj?.slug || obj?.member;
          if (looksLikeSlug(maybe)) return maybe;
        } catch {}
      }

      const patterns = [
        /"username"\s*:\s*"([a-z0-9_-]{2,40})"/i,
        /"slug"\s*:\s*"([a-z0-9_-]{2,40})"/i,
        /(?:^|[&;|,:\s])username=([a-z0-9_-]{2,40})(?:$|[&;|,:\s])/i,
        /(?:^|[&;|,:\s])user=([a-z0-9_-]{2,40})(?:$|[&;|,:\s])/i,
        /(?:^|[&;|,:\s])slug=([a-z0-9_-]{2,40})(?:$|[&;|,:\s])/i,
      ];
      for (const re of patterns) {
        const m = decoded.match(re);
        if (m && looksLikeSlug(m[1])) return m[1];
      }

      if (looksLikeSlug(decoded)) return decoded;
    }

    return '';
  }

  async _resolveMemberUsername(username) {
    const raw = String(username || '').trim();
    if (raw && raw.toLowerCase() !== 'me' && raw.toLowerCase() !== 'self') {
      return normalizeLetterboxdSlug(raw);
    }

    const currentSlug = normalizeLetterboxdSlug(this.username);
    if (currentSlug) {
      this.username = currentSlug;
      return currentSlug;
    }

    const cookieSlug = this._extractUserSlugFromCookies();
    if (cookieSlug) {
      this.username = normalizeLetterboxdSlug(cookieSlug) || cookieSlug;
      return cookieSlug;
    }

    await this.refreshLoginState().catch(() => {});
    const refreshedSlug = normalizeLetterboxdSlug(this.username);
    if (refreshedSlug) {
      this.username = refreshedSlug;
      return refreshedSlug;
    }

    return normalizeLetterboxdSlug(process.env.LETTERBOXD_USERNAME || '');
  }

  _extractFilmIdFromHtml(html, slug = '') {
    const text = String(html || '');
    const patterns = [
      /data-film-id=["'](\d+)["']/i,
      /"uid"\s*:\s*"film:(\d+)"/i,
      /data-viewingable\.uid\s*=\s*'film:(\d+)'/i,
      /data-viewingable\.uid\s*=\s*"film:(\d+)"/i,
      /\/film\/[a-z0-9\-]+\/json\/["']?\s*[^\n]*?film:(\d+)/i,
    ];

    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1]) return String(m[1]);
    }

    // Slug-aware fallback for chunks containing item metadata.
    if (slug) {
      const slugSafe = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const slugRe = new RegExp(`data-item-slug=["']${slugSafe}["'][^>]*data-film-id=["'](\\d+)["']`, 'i');
      const m = text.match(slugRe);
      if (m && m[1]) return String(m[1]);
    }

    return '';
  }

  _getCsrfToken(html = '') {
    const fromCookie = decodeURIComponent((this.cookies['com.xk72.webparts.csrf'] || '').trim());
    if (fromCookie && fromCookie !== 'placeholder') return fromCookie;

    const text = String(html || '');
    const m = text.match(/name=["']__csrf["'][^>]*value=["']([^"']+)["']/i);
    if (m && m[1] && m[1] !== 'placeholder') return m[1];
    return '';
  }

  async _resolveFilmMeta(slug) {
    const filmUrl = `${this.baseUrl}/film/${slug}/`;
    const html = await this.fetchHtml(filmUrl, { skipLogin: true });
    const filmId = this._extractFilmIdFromHtml(html, slug);
    const csrf = this._getCsrfToken(html);
    return { filmUrl, filmId, csrf };
  }

  async refreshLoginState() {
    const markerCookies =
      this.cookies['letterboxd.user.CURRENT'] ||
      this.cookies['persona'] ||
      this.cookies['letterboxd.session'];

    if (markerCookies) {
      this.isLoggedIn = true;
      if (!this.username || this.username.includes('@')) {
        const cookieSlug = this._extractUserSlugFromCookies();
        if (cookieSlug) this.username = cookieSlug;
      }
    }

    try {
      const home = await this._request('GET', this.baseUrl, { skipLogin: true });
      const homeHtml = typeof home.data === 'string' ? home.data : '';
      let slug = this._extractUserSlugFromHtml(homeHtml);

      // Fallback: /me/ usually resolves to the authenticated profile page,
      // which is often easier to parse than the home feed shell.
      if (!slug || slug.includes('@')) {
        try {
          const mePage = await this._request('GET', `${this.baseUrl}/me/`, { skipLogin: true });
          const meHtml = typeof mePage.data === 'string' ? mePage.data : '';
          slug = this._extractUserSlugFromHtml(meHtml) || slug;

          if (!slug || slug.includes('@')) {
            const finalUrl = mePage?.finalUrl || '';
            try {
              const parsed = new URL(finalUrl);
              const parts = parsed.pathname.split('/').filter(Boolean);
              if (parts.length && parts[0] !== 'me' && parts[0] !== 'sign-in') {
                slug = parts[0];
              }
            } catch {}
          }
        } catch {}
      }

      if (slug && !slug.includes('@')) {
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
    this._rebuildCookieHeader();
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

    this._rebuildCookieHeader();
  }

  _rebuildCookieHeader() {
    this.cookieHeader = Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async _syncCookiesFromBrowserContext() {
    if (!this.browserContext) return;
    const browserCookies = await this.browserContext.cookies();
    for (const cookie of browserCookies) {
      this.cookies[cookie.name] = cookie.value;
    }
    this._rebuildCookieHeader();
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

        response.finalUrl = currentUrl;
        return response;
    }

    throw new Error('Too many redirects.');
  }

  _isCloudflareChallenge(html) {
    if (typeof html !== 'string') return false;
    return (
      html.includes('challenge-platform') ||
      html.includes('cf_chl_opt') ||
      html.includes('Just a moment') ||
      html.includes('Enable JavaScript and cookies to continue') ||
      // Cloudflare error pages (520, 521, 522, 524) — report as challenge so caller falls back to browser
      (html.includes('id="cf-error-details"') && html.includes('error-details')) ||
      (html.includes('Web server is returning an unknown error') && html.includes('cf-wrapper'))
    );
  }

  async _throttleReadRequests(options = {}) {
    if (options.skipThrottle || READ_THROTTLE_MS <= 0) return;
    const now = Date.now();
    const waitMs = this.lastReadAt + READ_THROTTLE_MS - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastReadAt = Date.now();
  }

  _preferBrowser(reason = '') {
    this.preferBrowserUntil = Date.now() + BROWSER_PREFERENCE_MS;
    if (reason) {
      console.error(`[Letterboxd] Prefer browser reads for ${Math.round(BROWSER_PREFERENCE_MS / 1000)}s: ${reason}`);
    }
  }

  _shouldPreferBrowser(options = {}) {
    if (options.forceHttp) return false;
    if (options.forceBrowser) return true;
    return Date.now() < this.preferBrowserUntil;
  }

  _getProfileSnapshotCache(username) {
    const cached = this.profileSnapshotCache.get(username);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.profileSnapshotCache.delete(username);
      return null;
    }
    return cached.data;
  }

  _setProfileSnapshotCache(username, data) {
    this.profileSnapshotCache.set(username, {
      data,
      expiresAt: Date.now() + PROFILE_SNAPSHOT_TTL_MS,
    });
  }

  _readProfileSnapshotDiskCache(username) {
    try {
      if (!fs.existsSync(PROFILE_SNAPSHOT_CACHE_FILE)) return null;
      const raw = fs.readFileSync(PROFILE_SNAPSHOT_CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const entry = parsed[username];
      if (!entry || !entry.data) return null;
      return entry;
    } catch {
      return null;
    }
  }

  _writeProfileSnapshotDiskCache(username, data, source = 'live') {
    try {
      fs.mkdirSync(path.dirname(PROFILE_SNAPSHOT_CACHE_FILE), { recursive: true });
      let parsed = {};
      if (fs.existsSync(PROFILE_SNAPSHOT_CACHE_FILE)) {
        try {
          parsed = JSON.parse(fs.readFileSync(PROFILE_SNAPSHOT_CACHE_FILE, 'utf8') || '{}');
        } catch {
          parsed = {};
        }
      }
      parsed[username] = {
        savedAt: new Date().toISOString(),
        source,
        data,
      };
      fs.writeFileSync(PROFILE_SNAPSHOT_CACHE_FILE, JSON.stringify(parsed, null, 2), 'utf8');
    } catch {}
  }

  _readLocalProfileHtml(username) {
    const candidates = [];
    const envPath = process.env.LETTERBOXD_PROFILE_HTML_FALLBACK || '';
    if (envPath) candidates.push(envPath);
    candidates.push(path.join(PROFILE_HTML_FALLBACK_DIR, `${username}_public.html`));

    for (const filePath of candidates) {
      try {
        if (filePath && fs.existsSync(filePath)) {
          const html = fs.readFileSync(filePath, 'utf8');
          if (html && !this._isCloudflareChallenge(html)) {
            return { html, filePath };
          }
        }
      } catch {}
    }
    return null;
  }

  _buildSnapshotFromProfileHtml(html, username, source = 'saved-html') {
    const $ = cheerio.load(html);
    const favourites = this._extractPosterItems($, $('#favourites').first()).slice(0, 8);
    const watchlistSection = $('section.watchlist-aside, .watchlist-aside, section').filter((i, el) => {
      const heading = $(el).find('h2 a, .section-heading a').first().attr('href') || '';
      return heading.includes(`/${username}/watchlist/`);
    }).first();
    const watchlist = this._extractPosterItems($, watchlistSection.length ? watchlistSection : $.root()).slice(0, 12);
    const recent = this._extractHomeActivity($).slice(0, 12);
    const ratings = recent.filter((item) => item.rating).slice(0, 12);
    const diary = recent.slice(0, 8);

    return {
      username,
      favourites,
      watchlist,
      recent,
      ratings,
      diary,
      warnings: [],
      source,
    };
  }

  async fetchHtml(url, options = {}) {
    if (this.loginForReads && !options.skipLogin && !this.isLoggedIn) {
      await this.ensureLoggedIn();
    }

    await this._throttleReadRequests(options);

    if (this._shouldPreferBrowser(options)) {
      return this.fetchHtmlWithBrowser(url, options);
    }

    const response = await this._request('GET', url);
    if (response.status >= 400) {
      // 403 = auth block, 429 = rate-limit, 5xx = Cloudflare/server errors — all fall back to browser
      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        this._preferBrowser(`HTTP ${response.status} for ${url}`);
        return this.fetchHtmlWithBrowser(url, options);
      }
      throw new Error(`Request failed with status ${response.status}`);
    }
    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '');
    // Cloudflare returns HTTP 200 for its JS challenge page — detect and fall back to browser
    if (this._isCloudflareChallenge(html)) {
      this._preferBrowser(`challenge page for ${url}`);
      return this.fetchHtmlWithBrowser(url, options);
    }
    return html;
  }

  async fetchPublicHtml(url) {
    const response = await axios({
      method: 'GET',
      url,
      timeout: this.httpTimeoutMs,
      maxRedirects: MAX_REDIRECTS,
      validateStatus: () => true,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (response.status >= 400) {
      throw new Error(`Public request failed with status ${response.status}`);
    }

    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '');
    if (this._isCloudflareChallenge(html)) {
      throw new Error(`Public fetch hit Cloudflare challenge for ${url}`);
    }
    return html;
  }

  async fetchHtmlWithBrowser(url, options = {}) {
    await this._ensureBrowser();
    const page = await this.browserContext.newPage();
    try {
      await this._throttleReadRequests({ ...options, skipThrottle: options.skipBrowserThrottle });
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      let html = '';
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline) {
        await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(1200);
        html = await page.content();
        if (!this._isCloudflareChallenge(html)) {
          break;
        }
      }

      if (this._isCloudflareChallenge(html) && !this.browserHeadless && INTERACTIVE_LOGIN_WAIT_MS > 0) {
        console.error(`[Letterboxd] Waiting up to ${Math.round(INTERACTIVE_LOGIN_WAIT_MS / 1000)}s for manual security verification on ${url}`);
        const interactiveDeadline = Date.now() + INTERACTIVE_LOGIN_WAIT_MS;
        while (Date.now() < interactiveDeadline) {
          await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(1500);
          html = await page.content();
          if (!this._isCloudflareChallenge(html)) {
            break;
          }
        }
      }

      if (this._isCloudflareChallenge(html)) {
        this._preferBrowser(`challenge persisted for ${url}`);
        throw new Error(`Cloudflare challenge not cleared for ${url}`);
      }

      this._preferBrowser(`browser-cleared session for ${url}`);
      await this._syncCookiesFromBrowserContext();

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
      .find('.poster-grid .griditem, .poster-container, .poster-list .posteritem, .film-poster, .favourite-production-poster-container, .viewing-poster-container, .js-production-viewing, .production-poster-container, .react-component.figure, [data-component-class="LazyPoster"]')
      .each((i, el) => {
        const node = $(el);
        const poster = node.hasClass('film-poster') ? node : node.find('.film-poster').first();
        const figure = node.find('[data-item-slug], [data-film-slug], [data-item-link], [data-target-link]').first();
        const dataName =
          figure.attr('data-item-name') ||
          figure.attr('data-film-name') ||
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
          figure.attr('data-item-slug') ||
          figure.attr('data-film-slug') ||
          node.attr('data-film-slug') ||
          node.attr('data-item-slug') ||
          poster.attr('data-film-slug') ||
          poster.attr('data-item-slug') ||
          node.find('[data-film-slug]').attr('data-film-slug') ||
          node.find('[data-item-slug]').attr('data-item-slug') ||
          '';
        const link =
          figure.attr('data-item-link') ||
          figure.attr('data-target-link') ||
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

  _extractHomeActivity($) {
    const items = [];
    const seen = new Set();

    $('.viewing-poster-container, .js-production-viewing').each((i, el) => {
      const node = $(el);
      const figure = node.find('[data-item-slug], [data-film-slug], [data-item-link], [data-target-link]').first();
      const slug =
        figure.attr('data-item-slug') ||
        figure.attr('data-film-slug') ||
        figure.attr('data-item-link')?.split('/').filter(Boolean).slice(-1)[0] ||
        figure.attr('data-target-link')?.split('/').filter(Boolean).slice(-1)[0] ||
        node.find('a[href*="/film/"]').first().attr('href')?.split('/').filter(Boolean).slice(-1)[0] ||
        '';
      if (!slug || seen.has(slug)) return;

      const title =
        (figure.attr('data-item-name') || '').replace(/\s*\(\d{4}\)\s*$/, '') ||
        node.find('.primaryname a').first().text().trim() ||
        node.find('img').attr('alt') ||
        slug.replace(/-/g, ' ');
      const rating =
        node.find('svg[aria-label]').first().attr('aria-label') ||
        node.find('.rating').first().text().trim() ||
        '';
      const date =
        node.find('time[datetime], time.timestamp').first().attr('datetime') ||
        node.find('time[datetime], time.timestamp').first().text().trim() ||
        '';

      seen.add(slug);
      items.push({ title, slug, rating, date });
    });

    return items;
  }

  async _getProfileHomeData(username) {
    const resolvedUsername = await this._resolveMemberUsername(username);
    const cached = this._getProfileSnapshotCache(resolvedUsername);
    if (cached) return cached;

    const url = `${this.baseUrl}/${resolvedUsername}/`;
    // Use authenticated fetchHtml (with cookie + browser fallback) instead of fetchPublicHtml
    // so Cloudflare challenges are handled via the logged-in browser session.
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);
    const favourites = this._extractPosterItems($, $('#favourites').first());
    const watchlistSection = $('section.watchlist-aside, .watchlist-aside, section').filter((i, el) => {
      const heading = $(el).find('h2 a, .section-heading a').first().attr('href') || '';
      return heading.includes(`/${resolvedUsername}/watchlist/`);
    }).first();
    const watchlist = this._extractPosterItems($, watchlistSection.length ? watchlistSection : $.root());
    const recent = this._extractHomeActivity($);

    const data = { favourites, watchlist, recent };
    this._setProfileSnapshotCache(resolvedUsername, data);
    return data;
  }

  async getMemberSnapshot(username) {
    const warnings = [];
    const resolvedUsername = await this._resolveMemberUsername(username);
    let favourites = [];
    let watchlist = [];
    let recent = [];
    let ratings = [];
    let diary = [];

    try {
      const home = await this._getProfileHomeData(resolvedUsername);
      favourites = home.favourites.slice(0, 8);
      watchlist = home.watchlist.slice(0, 12);
      recent = home.recent.slice(0, 12);
      ratings = home.recent.filter((item) => item.rating).slice(0, 12);
      diary = home.recent.slice(0, 8);
      if (!favourites.length && !watchlist.length && !recent.length) {
        warnings.push('Profile home page returned no parsable activity; Cloudflare may still be limiting some sections.');
      }
    } catch (err) {
      warnings.push(`Profile home snapshot unavailable: ${String(err || '')}`);
    }

    if (!watchlist.length) {
      try {
        const page = await this.getMemberWatchlist(resolvedUsername, { limit: 12, allowHomeFallback: false, forceHttp: true });
        watchlist = (page.items || []).slice(0, 12);
      } catch (err) {
        warnings.push(`Could not read watchlist page: ${String(err || '')}`);
      }
    }

    if (!recent.length) {
      try {
        const page = await this.getMemberFilms(resolvedUsername, { limit: 12, allowHomeFallback: false, forceHttp: true });
        recent = (page.items || []).slice(0, 12);
      } catch (err) {
        warnings.push(`Could not read films page: ${String(err || '')}`);
      }
    }

    if (!ratings.length) {
      try {
        const page = await this.getMemberRatings(resolvedUsername, { limit: 12, allowHomeFallback: false, forceHttp: true });
        ratings = (page.items || []).slice(0, 12);
      } catch (err) {
        warnings.push(`Could not expand ratings page: ${String(err || '')}`);
      }
    }

    if (!diary.length) {
      try {
        const page = await this.getMemberDiary(resolvedUsername, { limit: 8, allowHomeFallback: false, forceHttp: true });
        diary = (page.items || []).slice(0, 8);
      } catch (err) {
        warnings.push(`Could not read diary page: ${String(err || '')}`);
      }
    }

    const snapshot = {
      username: resolvedUsername,
      favourites,
      watchlist,
      recent,
      ratings,
      diary,
      warnings,
      source: 'profile-home-snapshot',
    };

    const hasData = !!(favourites.length || watchlist.length || recent.length || ratings.length || diary.length);
    if (hasData) {
      this._setProfileSnapshotCache(resolvedUsername, snapshot);
      this._writeProfileSnapshotDiskCache(resolvedUsername, snapshot, 'live');
      return snapshot;
    }

    const localHtml = this._readLocalProfileHtml(resolvedUsername);
    if (localHtml) {
      const htmlSnapshot = this._buildSnapshotFromProfileHtml(localHtml.html, resolvedUsername, `saved-html:${localHtml.filePath}`);
      htmlSnapshot.warnings.push(...warnings, `Using saved profile HTML fallback from ${localHtml.filePath} because live profile routes failed.`);
      this._setProfileSnapshotCache(resolvedUsername, htmlSnapshot);
      this._writeProfileSnapshotDiskCache(resolvedUsername, htmlSnapshot, 'saved-html');
      return htmlSnapshot;
    }

    const diskEntry = this._readProfileSnapshotDiskCache(resolvedUsername);
    if (diskEntry && diskEntry.data) {
      const cachedSnapshot = {
        ...diskEntry.data,
        warnings: [
          ...warnings,
          `Using cached snapshot saved at ${diskEntry.savedAt} (${diskEntry.source || 'unknown source'}) because live profile routes failed.`,
        ],
        source: 'cached-profile-snapshot',
      };
      this._setProfileSnapshotCache(resolvedUsername, cachedSnapshot);
      return cachedSnapshot;
    }

    return snapshot;
  }

  async fetchPage(url, scraperFunc, options = {}) {
    const fetchOptions = typeof options === 'number' ? {} : (options || {});
    const html = await this.fetchHtml(url, fetchOptions);
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
    this.username = normalizeLetterboxdSlug(username) || username;
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
    const inputSlug = normalizeLetterboxdSlug(username);
    if (this.isLoggedIn && inputSlug) {
      this.username = inputSlug;
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
          this._rebuildCookieHeader();

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

      await this._syncCookiesFromBrowserContext();
      console.error(`[Letterboxd] Collected ${Object.keys(this.cookies).length} cookies from browser`);
      
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
        const envUser = normalizeLetterboxdSlug(process.env.LETTERBOXD_USERNAME);
        try {
          const response = await this._request('GET', this.baseUrl, { skipLogin: true });
          const homeHtml = typeof response.data === 'string' ? response.data : '';
          if (!this._isCloudflareChallenge(homeHtml)) {
            const $home = cheerio.load(homeHtml);
            const userSlug = $home('body').attr('data-user-name') || 
                             $home('.nav-account a').attr('href')?.split('/').filter(Boolean).pop() ||
                             $home('.nav-main-right .nav-account > a').attr('href')?.split('/').filter(Boolean).pop();
            const normalizedUserSlug = normalizeLetterboxdSlug(userSlug);
            if (normalizedUserSlug) {
              this.username = normalizedUserSlug;
            } else if (envUser) {
              this.username = envUser;
            }
          } else if (envUser) {
            this.username = envUser;
          }
        } catch (e) {
          if (envUser) this.username = envUser;
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
    let username = normalizeLetterboxdSlug(process.env.LETTERBOXD_USERNAME);
    let password = process.env.LETTERBOXD_PASSWORD;
    
    if ((!username || !password) && process.env.LETTERBOXD_CREDENTIALS) {
      const [user, ...rest] = process.env.LETTERBOXD_CREDENTIALS.split(':');
      if (user && rest.length) {
        username = normalizeLetterboxdSlug(user);
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

  async _searchViaSlugEstimation(query) {
    // Build candidate slugs from the query title without touching any CF-protected endpoint.
    // Works well for the vast majority of English-title films (the common recommendation case).
    const normalize = (t) =>
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
        .replace(/[^a-z0-9\s]/g, ' ')      // non-alphanumeric → space
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '');

    // Strip a trailing year "(2019)" from the query to get the base title
    const yearMatch = query.match(/\((\d{4})\)\s*$/);
    const yearStr = yearMatch ? yearMatch[1] : '';
    const baseTitle = yearStr ? query.replace(/\s*\(\d{4}\)\s*$/, '').trim() : query;

    const candidates = [normalize(baseTitle)];
    if (yearStr) candidates.push(`${normalize(baseTitle)}-${yearStr}`);

    for (const slug of candidates) {
      if (!slug) continue;
      try {
        const film = await this.getFilm(slug);
        // Validate we got a real film, not a CF error page or empty skeleton
        if (film && film.title && (film.year || film.director || film.rating)) {
          return [{ title: film.title, slug, url: `${this.baseUrl}/film/${slug}/`, year: film.year || '' }];
        }
      } catch {
        // Slug didn't resolve — try next candidate
      }
    }
    return [];
  }

  async search(query, type = 'films', options = {}) {
    // ── Strategy 1: Slug estimation (no scraping, CF-immune) ──────────────────
    // Skip for paginated queries or non-film searches where a slug isn't meaningful.
    if (type === 'films' && !options.cursor) {
      try {
        const estimated = await this._searchViaSlugEstimation(query);
        if (estimated.length) {
          return { items: estimated, nextCursor: null };
        }
      } catch {
        // estimation failed — continue to scraping strategies
      }
    }

    // ── Strategy 2: Letterboxd search page (HTML scraping) ───────────────────
    const url = this.resolveCursor(
      options.cursor,
      `${this.baseUrl}/search/${type}/${encodeURIComponent(query)}/`
    );
    try {
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
      if (items.length) {
        return { items, nextCursor };
      }
    } catch (err) {
      if (!String(err || '').includes('Cloudflare challenge')) {
        throw err;
      }
    }

    const items = await this._searchViaDuckDuckGo(query, type);
    return { items, nextCursor: null };
  }

  async _searchViaDuckDuckGo(query, type = 'films') {
    if (type !== 'films') return [];

    const response = await axios({
      method: 'GET',
      url: 'https://duckduckgo.com/html/',
      params: { q: `site:letterboxd.com/film/ ${query}` },
      timeout: this.httpTimeoutMs,
      validateStatus: () => true,
      headers: {
        'User-Agent': this.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (response.status >= 400) {
      return [];
    }

    const $ = cheerio.load(typeof response.data === 'string' ? response.data : '');
    const items = [];
    const seen = new Set();
    $('a.result__a, a[data-testid="result-title-a"], a[href*="letterboxd.com/film/"]').each((i, el) => {
      const href = $(el).attr('href') || '';
      const resolvedHref = (() => {
        try {
          if (href.includes('uddg=')) {
            return decodeURIComponent(href.split('uddg=').pop().split('&')[0]);
          }
        } catch {}
        return href;
      })();

      const match = resolvedHref.match(/https?:\/\/letterboxd\.com\/film\/([^/?#]+)\/?/i);
      if (!match) return;

      const slug = match[1];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const title = ($(el).text().trim() || slug.replace(/-/g, ' ')).replace(/\s*[·•|-]\s*letterboxd\s*$/i, '').trim();
      items.push({
        title,
        slug,
        url: `${this.baseUrl}/film/${slug}/`,
      });
    });

    return items.slice(0, 8);
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
    const home = await this._getProfileHomeData(username);
    return { username, items: home.favourites };
  }

  async getMemberWatchlist(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/watchlist/`);
    try {
      return await this.fetchPage(url, ($) => this._extractPosterItems($), options);
    } catch (err) {
      if (!String(err || '').includes('Cloudflare challenge')) throw err;
      if (options.allowHomeFallback === false) throw err;
      const home = await this._getProfileHomeData(username);
      return { items: home.watchlist, nextCursor: null };
    }
  }

  async getMemberFilms(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/films/`);
    try {
      return await this.fetchPage(url, ($) => this._extractPosterItems($), options);
    } catch (err) {
      if (!String(err || '').includes('Cloudflare challenge')) throw err;
      if (options.allowHomeFallback === false) throw err;
      const home = await this._getProfileHomeData(username);
      return { items: home.recent, nextCursor: null };
    }
  }

  async getMemberRatings(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/films/ratings/`);
    try {
      return await this.fetchPage(
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
        options
      );
    } catch (err) {
      if (!String(err || '').includes('Cloudflare challenge')) throw err;
      if (options.allowHomeFallback === false) throw err;
      const home = await this._getProfileHomeData(username);
      return {
        items: home.recent.filter((item) => item.rating),
        nextCursor: null,
      };
    }
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
      options
    );
  }

  async getMemberDiary(username, options = {}) {
    const url = this.resolveCursor(options.cursor, `${this.baseUrl}/${username}/diary/`);
    try {
      return await this.fetchPage(
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
        options
      );
    } catch (err) {
      if (!String(err || '').includes('Cloudflare challenge')) throw err;
      if (options.allowHomeFallback === false) throw err;
      const home = await this._getProfileHomeData(username);
      return { items: home.recent, nextCursor: null };
    }
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
    if (this.isLoggedIn && (!this.username || this.username.includes('@'))) {
      try {
        await this.refreshLoginState();
      } catch {}

      if (!this.username || this.username.includes('@')) {
        try {
          await this._ensureBrowser();
          const page = await this.browserContext.newPage();
          try {
            await page.goto(`${this.baseUrl}/me/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(600);

            const currentUrl = page.url();
            const parsed = new URL(currentUrl);
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts.length && parts[0] !== 'me' && parts[0] !== 'sign-in') {
              this.username = parts[0];
            }

            if (!this.username || this.username.includes('@')) {
              const slugFromPage = await page.evaluate(() => {
                const bodySlug = document.body?.getAttribute('data-user-name');
                if (bodySlug) return bodySlug;
                const accountHref = document.querySelector('.nav-account a, .nav-main-right .nav-account > a')?.getAttribute('href') || '';
                const segs = accountHref.split('/').filter(Boolean);
                return segs.length ? segs[segs.length - 1] : '';
              });
              if (slugFromPage && !slugFromPage.includes('@')) {
                this.username = slugFromPage;
              }
            }
          } finally {
            await page.close();
          }
        } catch {}
      }

      if (!this.username || this.username.includes('@')) {
        const cookieSlug = this._extractUserSlugFromCookies();
        if (cookieSlug) {
          this.username = cookieSlug;
        }
      }

      if (!this.username || this.username.includes('@')) {
        const envUser = normalizeLetterboxdSlug(process.env.LETTERBOXD_USERNAME);
        if (envUser) {
          this.username = envUser;
        }
      }
    }
    return { username: this.username, loggedIn: this.isLoggedIn };
  }

  async _ensureBrowser() {
    if (this.browserContext) return;
    const browserArgs = [
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
    ];
    if (IS_LINUX) {
      browserArgs.unshift('--no-sandbox');
    }
    const launchOptions = {
      headless: this.browserHeadless,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      args: browserArgs,
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

    for (const page of this.browserContext.pages()) {
      if (page.url() === 'about:blank') {
        await page.close().catch(() => {});
      }
    }

    if (STEALTH_MODE) {
      await this.browserContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      });
    }

    if (BLOCK_AD_REQUESTS && !this.routeConfigured) {
      await this.browserContext.route('**/*', async (route) => {
        const reqUrl = route.request().url();
        if (shouldBlockUrl(reqUrl)) {
          await route.abort();
          return;
        }
        await route.continue();
      });
      this.routeConfigured = true;
    }

    const cookies = Object.entries(this.cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.letterboxd.com',
      path: '/'
    }));
    await this.browserContext.addCookies(cookies);
  }

  async _performAction(url, actionFn, options = {}) {
    await this._ensureBrowser();
    // Always sync latest cookies into the browser context before each action.
    // _ensureBrowser only injects cookies at creation time, but login may have
    // happened after the browser was already created, leaving it unauthenticated.
    if (Object.keys(this.cookies).length > 0) {
      const freshCookies = Object.entries(this.cookies).map(([name, value]) => ({
        name,
        value,
        domain: '.letterboxd.com',
        path: '/',
      }));
      await this.browserContext.addCookies(freshCookies);
    }
    const page = await this.browserContext.newPage();
    try {
      console.log(`[_performAction] 导航到: ${url}`);
      let lastNavErr = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          lastNavErr = null;
          break;
        } catch (err) {
          lastNavErr = err;
          const msg = String(err && err.message ? err.message : err);
          const retryable =
            msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
            msg.includes('ERR_CONNECTION_RESET') ||
            msg.includes('ERR_CONNECTION_CLOSED') ||
            msg.includes('ERR_NETWORK_CHANGED') ||
            msg.includes('Timeout');
          if (!retryable || attempt >= 3) {
            throw err;
          }

          // Warm up the session between retries; this often clears transient anti-bot/network hiccups.
          try {
            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          } catch {}
          await page.waitForTimeout(1200 * attempt);
        }
      }
      if (lastNavErr) throw lastNavErr;

      const title = await page.title().catch(() => '');
      const hasChallenge = await page.evaluate(() => {
        return !!document.querySelector('#cf-wrapper,#challenge-stage,#challenge-error-title');
      }).catch(() => false);

      const looksBlocked = hasChallenge || /\b520\b|Just a moment|unknown error/i.test(String(title || ''));
      if (looksBlocked && this.browserHeadless && !options.visibleRetry) {
        console.warn(`[_performAction] 检测到 Cloudflare/520 页面，切换到可视浏览器重试: ${title}`);
        await page.close();
        await this.close().catch(() => {});
        this.browserHeadless = false;
        return this._performAction(url, actionFn, { ...options, visibleRetry: true });
      }

      await page.waitForTimeout(1000);
      console.log(`[_performAction] 页面加载完成`);
      await actionFn(page);
      
      // Sync back cookies from browser
      await this._syncCookiesFromBrowserContext();
        
      return true;
    } finally {
      await page.close();
    }
  }

  async _toggleFilmCollectionViaHttp(slug, remove, endpoints) {
    await this.ensureLoggedIn();

    // If browser context has fresher auth cookies, sync them back to HTTP client first.
    if (this.browserContext) {
      try {
        await this._syncCookiesFromBrowserContext();
      } catch {}
    }

    const html = await this.fetchHtml(`${this.baseUrl}/film/${slug}/`, { skipLogin: true });
    const filmId = this._extractFilmIdFromHtml(html, slug);
    if (!filmId) {
      throw new Error(`[collection-http-fallback] 无法提取 filmId: ${slug}`);
    }

    const csrf = this._getCsrfToken(html);
    if (!csrf || csrf === 'placeholder') {
      throw new Error('[collection-http-fallback] 缺少有效 CSRF token');
    }

    let lastStatus = 0;
    for (const endpoint of endpoints) {
      const body = new URLSearchParams();
      body.append('__csrf', csrf);
      body.append('filmId', String(filmId));
      if (remove) body.append('remove', 'true');

      const res = await this._request('POST', `${this.baseUrl}${endpoint}`, {
        data: body.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${this.baseUrl}/film/${slug}/`,
          'Origin': this.baseUrl,
        },
        skipLogin: true,
      });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 400) {
        return true;
      }
    }

    throw new Error(`[collection-http-fallback] 所有端点失败，最后状态码: ${lastStatus}`);
  }

  async _toggleFilmCollectionViaBrowserFetch(slug, remove, endpoints) {
    await this.ensureLoggedIn();
    await this._ensureBrowser();

    const page = await this.browserContext.newPage();
    try {
      // Load a first-party page to ensure origin/session are warm before posting AJAX actions.
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

      const meta = await page.evaluate(async ({ baseUrl, slug }) => {
        const filmUrl = `${baseUrl}/film/${slug}/`;
        const res = await fetch(filmUrl, { credentials: 'include' });
        const html = await res.text();
        const filmIdMatch =
          html.match(/data-film-id=["'](\d+)["']/i) ||
          html.match(/"uid"\s*:\s*"film:(\d+)"/i);
        const cookieCsrf = document.cookie
          .split('; ')
          .find((r) => r.startsWith('com.xk72.webparts.csrf='))
          ?.split('=')[1] || '';
        const inputCsrfMatch = html.match(/name=["']__csrf["'][^>]*value=["']([^"']+)/i);
        const csrf = decodeURIComponent((cookieCsrf || (inputCsrfMatch ? inputCsrfMatch[1] : '') || '').trim());
        return {
          ok: res.ok,
          status: res.status,
          filmId: filmIdMatch ? filmIdMatch[1] : '',
          csrf,
        };
      }, { baseUrl: this.baseUrl, slug });

      if (!meta.filmId) {
        throw new Error(`[collection-browser-fallback] 无法提取 filmId (status=${meta.status})`);
      }
      if (!meta.csrf || meta.csrf === 'placeholder') {
        throw new Error('[collection-browser-fallback] 缺少有效 CSRF token');
      }

      const ajaxResult = await page.evaluate(async ({ filmId, csrf, remove, endpoints }) => {
        let lastStatus = 0;
        for (const endpoint of endpoints) {
          try {
            const body = new URLSearchParams();
            body.append('__csrf', csrf);
            body.append('filmId', String(filmId));
            if (remove) body.append('remove', 'true');

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
              },
              credentials: 'include',
              body: body.toString(),
            });
            lastStatus = res.status;
            if (res.ok || res.status === 200) {
              return { ok: true, endpoint, status: res.status };
            }
          } catch {
            // Try next endpoint.
          }
        }
        return { ok: false, lastStatus };
      }, { filmId: meta.filmId, csrf: meta.csrf, remove, endpoints });

      if (ajaxResult && ajaxResult.ok) {
        console.log(`[collection-browser-fallback] ✅ 成功 (${ajaxResult.endpoint}, status=${ajaxResult.status})`);
        return true;
      }

      throw new Error(`[collection-browser-fallback] 所有端点失败，最后状态码: ${ajaxResult && ajaxResult.lastStatus}`);
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

    let meta = { filmUrl: `${this.baseUrl}/film/${slug}/`, filmId: '', csrf: '' };
    try {
      meta = await this._resolveFilmMeta(slug);
    } catch (e) {
      console.warn(`[addToWatched] 预读取电影元数据失败，将回退到页面提取: ${e.message}`);
    }

    try {
      return await this._performAction(meta.filmUrl, async (page) => {
      try {
        console.log(`[addToWatched] 页面已加载: ${meta.filmUrl}`);

        let filmId = meta.filmId;
        let csrf = meta.csrf;
        if (!filmId || !csrf) {
          const domMeta = await page.evaluate(() => {
            const html = document.documentElement?.outerHTML || '';
            const filmIdMatch = html.match(/data-film-id=["'](\d+)["']/i) || html.match(/"uid"\s*:\s*"film:(\d+)"/i);
            const cookieCsrf = document.cookie.split('; ').find(r => r.startsWith('com.xk72.webparts.csrf='))?.split('=')[1] || '';
            const inputCsrf = (document.querySelector('input[name="__csrf"]')?.getAttribute('value') || '').trim();
            return {
              filmId: filmIdMatch ? filmIdMatch[1] : '',
              csrf: decodeURIComponent((cookieCsrf || inputCsrf || '').trim()),
            };
          });
          filmId = filmId || domMeta.filmId;
          csrf = csrf || domMeta.csrf;
        }

        if (!filmId) throw new Error('无法提取 film ID（页面未返回电影元数据）');
        if (!csrf || csrf === 'placeholder') throw new Error('无法获取有效 CSRF token，session 可能已过期');

        console.log(`[addToWatched] filmId=${filmId}, CSRF 已获取`);

        // 通过 AJAX 调用 Letterboxd 内部接口
        const ajaxResult = await page.evaluate(async ({ filmId, csrf, remove }) => {
          const endpoints = [
            '/s/save-film-to-owned',
            '/s/toggle-film-watched',
          ];
          for (const endpoint of endpoints) {
            try {
              const body = new URLSearchParams();
              body.append('__csrf', csrf);
              body.append('filmId', filmId);
              if (remove) body.append('remove', 'true');
              const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest',
                },
                body: body.toString(),
              });
              const text = await res.text();
              if (res.ok || res.status === 200) {
                return { ok: true, endpoint, status: res.status, body: text };
              }
            } catch (e) {
              // try next endpoint
            }
          }
          return { ok: false };
        }, { filmId, csrf, remove });

        if (ajaxResult && ajaxResult.ok) {
          console.log(`[addToWatched] ✅ AJAX 操作成功 (${ajaxResult.endpoint}, status=${ajaxResult.status})`);
          return;
        }

        console.log(`[addToWatched] AJAX 未成功，改用 DOM 点击...`);

        // 回退：DOM 点击
        const selectors = [
          '.action.-watched a',
          '.action.-watched',
          '[data-action-toggle="watched"]',
          '.toggle-film-on-list.-watched',
          '.sidebar .action.-watch',
          '.sidebar .watch-button',
          '.sidebar .action-large.-watch',
          '.film-actions .action.-watch',
          'button[data-action="watch"]',
        ];
        
        let watchBtn = null;
        for (const selector of selectors) {
          try {
            watchBtn = page.locator(selector).first();
            await watchBtn.waitFor({ state: 'visible', timeout: 5000 });
            console.log(`[addToWatched] 找到按钮: ${selector}`);
            break;
          } catch (e) {
            console.log(`[addToWatched] 选择器 ${selector} 未找到，尝试下一个...`);
            watchBtn = null;
          }
        }
        
        if (!watchBtn) {
          throw new Error('AJAX 和所有 DOM 选择器均失败，无法找到 watched 按钮。请检查 Letterboxd 是否已登录以及页面结构。');
        }
        
        const classAttr = await watchBtn.getAttribute('class') || '';
        const isCurrentlyWatched = classAttr.includes('-active') || classAttr.includes('own');
        
        console.log(`[addToWatched] 当前状态: ${isCurrentlyWatched ? '已标记watched' : '未标记watched'}`);
        
        if ((!remove && !isCurrentlyWatched) || (remove && isCurrentlyWatched)) {
          await watchBtn.click();
          await page.waitForTimeout(2000);
          console.log(`[addToWatched] ✅ DOM 点击操作已执行`);
        } else {
          console.log(`[addToWatched] 已在目标状态，无需操作`);
        }
      } catch (error) {
        console.error(`[addToWatched] ❌ 错误: ${error.message}`);
        throw error;
      }
      });
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const shouldTryHttpFallback =
        msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
        msg.includes('无法找到 watched 按钮') ||
        msg.includes('Cloudflare') ||
        msg.includes('520');
      if (!shouldTryHttpFallback) {
        throw error;
      }

      console.warn(`[addToWatched] 页面导航失败，尝试 HTTP 兜底: ${msg}`);

      const html = await this.fetchHtml(`${this.baseUrl}/film/${slug}/`, { skipLogin: true });
      const $ = cheerio.load(typeof html === 'string' ? html : '');
      const filmId =
        $('[data-film-id]').first().attr('data-film-id') ||
        $('.react-component[data-film-id]').first().attr('data-film-id') ||
        '';
      if (!filmId) {
        throw new Error(`[addToWatched] HTTP 兜底失败：未能从页面提取 filmId (${slug})`);
      }

      const csrfFromCookie = this.cookies['com.xk72.webparts.csrf'] || '';
      const csrfFromHtml = $('input[name="__csrf"]').first().attr('value') || '';
      const csrf = decodeURIComponent((csrfFromCookie || csrfFromHtml || '').trim());
      if (!csrf || csrf === 'placeholder') {
        throw new Error('[addToWatched] HTTP 兜底失败：缺少有效 CSRF token');
      }

      const endpoints = ['/s/save-film-to-owned', '/s/toggle-film-watched'];
      let lastStatus = 0;
      for (const endpoint of endpoints) {
        const body = new URLSearchParams();
        body.append('__csrf', csrf);
        body.append('filmId', String(filmId));
        if (remove) body.append('remove', 'true');

        const res = await this._request('POST', `${this.baseUrl}${endpoint}`, {
          data: body.toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `${this.baseUrl}/film/${slug}/`,
            'Origin': this.baseUrl,
          },
          skipLogin: true,
        });
        lastStatus = res.status;
        if (res.status >= 200 && res.status < 400) {
          console.log(`[addToWatched] ✅ HTTP 兜底成功 (${endpoint}, status=${res.status})`);
          return true;
        }
      }

      throw new Error(`[addToWatched] HTTP 兜底失败，最后状态码: ${lastStatus}`);
    }
  }

  async addToWatchlist(slug, remove = false) {
    await this.ensureLoggedIn();
    console.log(`[addToWatchlist] 开始处理: slug=${slug}, remove=${remove}`);

    let meta = { filmUrl: `${this.baseUrl}/film/${slug}/`, filmId: '', csrf: '' };
    try {
      meta = await this._resolveFilmMeta(slug);
    } catch (e) {
      console.warn(`[addToWatchlist] 预读取电影元数据失败，将回退到页面提取: ${e.message}`);
    }
    
    const applyWatchlistAction = async (page) => {
        try {
          console.log(`[addToWatchlist] 页面已加载: ${meta.filmUrl}`);

        let filmId = meta.filmId;
        let csrf = meta.csrf;
        if (!filmId || !csrf) {
          const domMeta = await page.evaluate(() => {
            const html = document.documentElement?.outerHTML || '';
            const filmIdMatch = html.match(/data-film-id=["'](\d+)["']/i) || html.match(/"uid"\s*:\s*"film:(\d+)"/i);
            const cookieCsrf = document.cookie.split('; ').find(r => r.startsWith('com.xk72.webparts.csrf='))?.split('=')[1] || '';
            const inputCsrf = (document.querySelector('input[name="__csrf"]')?.getAttribute('value') || '').trim();
            return {
              filmId: filmIdMatch ? filmIdMatch[1] : '',
              csrf: decodeURIComponent((cookieCsrf || inputCsrf || '').trim()),
            };
          });
          filmId = filmId || domMeta.filmId;
          csrf = csrf || domMeta.csrf;
        }

        if (!filmId) throw new Error('无法提取 film ID（页面未返回电影元数据）');
        if (!csrf || csrf === 'placeholder') throw new Error('无法获取有效 CSRF token，session 可能已过期');

        console.log(`[addToWatchlist] filmId=${filmId}, CSRF 已获取`);

        // 通过 AJAX 调用 Letterboxd 内部接口（与 /s/save-diary-entry 同一模式）
        const ajaxResult = await page.evaluate(async ({ filmId, csrf, remove }) => {
          const endpoints = [
            '/s/save-film-to-watchlist',
            '/s/toggle-film-watchlist',
          ];
          for (const endpoint of endpoints) {
            try {
              const body = new URLSearchParams();
              body.append('__csrf', csrf);
              body.append('filmId', filmId);
              if (remove) body.append('remove', 'true');
              const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest',
                },
                body: body.toString(),
              });
              const text = await res.text();
              if (res.ok || res.status === 200) {
                return { ok: true, endpoint, status: res.status, body: text };
              }
              // Non-2xx: try next endpoint
            } catch (e) {
              // Network error: try next endpoint
            }
          }
          return { ok: false };
        }, { filmId, csrf, remove });

        if (ajaxResult && ajaxResult.ok) {
          console.log(`[addToWatchlist] ✅ AJAX 操作成功 (${ajaxResult.endpoint}, status=${ajaxResult.status})`);
          return;
        }

        console.log(`[addToWatchlist] AJAX 未成功，改用 DOM 点击...`);

        // 回退：DOM 点击，包含 Letterboxd 当前已知的选择器和旧版选择器
        const selectors = [
          '.action.-wishlist a',          // 当前版本: wishlist 是 watchlist 的内部名称
          '.action.-wishlist',
          'a.action.-wishlist',
          '[data-action-toggle="watchlist"]',
          '.toggle-film-on-list.-watchlist',
          'a.add-to-watchlist',
          '.action-large.-watchlist',
          'button[data-action="watchlist"]',
          '.film-actions .watchlist-button',
        ];
        
        let watchlistBtn = null;
        for (const selector of selectors) {
          try {
            watchlistBtn = page.locator(selector).first();
            await watchlistBtn.waitFor({ state: 'visible', timeout: 5000 });
            console.log(`[addToWatchlist] 找到按钮: ${selector}`);
            break;
          } catch (e) {
            console.log(`[addToWatchlist] 选择器 ${selector} 未找到，尝试下一个...`);
            watchlistBtn = null;
          }
        }
        
        if (!watchlistBtn) {
          throw new Error('AJAX 和所有 DOM 选择器均失败，无法找到 watchlist 按钮。请检查 Letterboxd 是否已登录以及页面结构。');
        }
        
        const classAttr = await watchlistBtn.getAttribute('class') || '';
        const isCurrentlyIn = classAttr.includes('-remove') || classAttr.includes('own') || classAttr.includes('-active') || classAttr.includes('-wishlisted');
        
        console.log(`[addToWatchlist] 当前状态: ${isCurrentlyIn ? '已在watchlist' : '不在watchlist'}`);

        if ((!remove && !isCurrentlyIn) || (remove && isCurrentlyIn)) {
          await watchlistBtn.click();
          await page.waitForTimeout(2000);
          console.log(`[addToWatchlist] ✅ DOM 点击操作已执行`);
        } else {
          console.log(`[addToWatchlist] 已在目标状态，无需操作`);
        }
        } catch (error) {
          console.error(`[addToWatchlist] ❌ 错误: ${error.message}`);
          throw error;
        }
      };

    try {
      return await this._performAction(meta.filmUrl, applyWatchlistAction);
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const shouldTryHttpFallback =
        msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
        msg.includes('无法找到 watchlist 按钮') ||
        msg.includes('Cloudflare') ||
        msg.includes('520');
      if (!shouldTryHttpFallback) {
        throw error;
      }

      // First retry in visible browser mode; this often bypasses transient challenge blocks.
      if (this.browserHeadless) {
        console.warn(`[addToWatchlist] 页面导航失败，切换可视浏览器重试: ${msg}`);
        await this.close().catch(() => {});
        this.browserHeadless = false;
        try {
          return await this._performAction(meta.filmUrl, applyWatchlistAction, { visibleRetry: true });
        } catch (visibleErr) {
          console.warn(`[addToWatchlist] 可视浏览器重试失败: ${visibleErr && visibleErr.message ? visibleErr.message : visibleErr}`);
        }
      }

      const watchlistEndpoints = [
        '/s/save-film-to-watchlist',
        '/s/toggle-film-watchlist',
      ];

      try {
        console.warn(`[addToWatchlist] 页面操作失败，尝试浏览器 AJAX 兜底: ${msg}`);
        return await this._toggleFilmCollectionViaBrowserFetch(slug, remove, watchlistEndpoints);
      } catch (browserFallbackErr) {
        console.warn(`[addToWatchlist] 浏览器 AJAX 兜底失败，尝试 HTTP 兜底: ${browserFallbackErr && browserFallbackErr.message ? browserFallbackErr.message : browserFallbackErr}`);
        return this._toggleFilmCollectionViaHttp(slug, remove, watchlistEndpoints);
      }
    }
  }

  async _toggleLikeViaHttpFallback(slug, remove = false) {
    const html = await this.fetchHtml(`${this.baseUrl}/film/${slug}/`, { skipLogin: true });
    const filmId = this._extractFilmIdFromHtml(html, slug);
    if (!filmId) {
      throw new Error(`[toggleLike-http-fallback] 无法提取 filmId: ${slug}`);
    }

    const csrf = this._getCsrfToken(html);
    if (!csrf || csrf === 'placeholder') {
      throw new Error('[toggleLike-http-fallback] 缺少有效 CSRF token');
    }

    const likeableId = `film:${filmId}`;
    const endpointCandidates = [
      '/s/like-film',
      '/s/toggle-like',
      '/s/film-like',
      '/s/like',
    ];

    let lastStatus = 0;
    for (const endpoint of endpointCandidates) {
      const body = new URLSearchParams();
      body.append('__csrf', csrf);
      body.append('filmId', String(filmId));
      body.append('likeableId', likeableId);
      body.append('likeableUid', likeableId);
      body.append('likeable', likeableId);
      if (remove) {
        body.append('remove', 'true');
        body.append('unlike', 'true');
      }

      const res = await this._request('POST', `${this.baseUrl}${endpoint}`, {
        data: body.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${this.baseUrl}/film/${slug}/`,
          'Origin': this.baseUrl,
        },
        skipLogin: true,
      });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 400) {
        console.log(`[toggleLike] ✅ HTTP 兜底成功 (${endpoint}, status=${res.status})`);
        return true;
      }
    }

    throw new Error(`[toggleLike-http-fallback] 所有端点失败，最后状态码: ${lastStatus}`);
  }

  async toggleLike(slug, reviewId = null, remove = false) {
    await this.ensureLoggedIn();
    const url = `${this.baseUrl}/film/${slug}/`;
    try {
      return await this._performAction(url, async (page) => {
        if (reviewId) {
            const likeBtn = page.locator(`.review-like[data-review-id="${reviewId}"]`);
            await likeBtn.click();
        } else {
            const selectors = [
              '.sidebar .like-link-target',
              '#featured-film-header .like-link-target',
              '.js-actions-panel-like .like-link-target',
              '.react-component.like-link-target[data-likeable="true"]',
              '[data-component-class="LikeComponent"][data-likeable-identifier*="film:"]',
              '.like-link-target[data-likeable-identifier*="film:"]',
            ];

            let likeBtn = null;
            for (const selector of selectors) {
              try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'attached', timeout: 3000 });
                likeBtn = candidate;
                console.log(`[toggleLike] 找到 like 按钮: ${selector}`);
                break;
              } catch (e) {
                // try next selector
              }
            }

            if (!likeBtn) {
              const debug = await page.evaluate(() => {
                return {
                  title: document.title,
                  hasCloudflare: !!document.querySelector('#cf-wrapper,#challenge-stage,#challenge-error-title'),
                  filmLikeCandidates: document.querySelectorAll('[data-component-class="LikeComponent"][data-likeable-identifier*="film:"]').length,
                  sidebarLikeCandidates: document.querySelectorAll('.sidebar .like-link-target').length,
                };
              });
              throw new Error(`未找到主电影 like 按钮: ${JSON.stringify(debug)}`);
            }

            const classAttr = await likeBtn.getAttribute('class') || '';
            const ariaPressed = await likeBtn.getAttribute('aria-pressed');
            const isLiked = classAttr.includes('active') || ariaPressed === 'true';
            if ((!remove && !isLiked) || (remove && isLiked)) {
                await likeBtn.click({ timeout: 8000 });
            }
        }
        await page.waitForTimeout(1000);
      });
    } catch (error) {
      const msg = String(error && error.message ? error.message : error);
      const shouldTryHttpFallback =
        msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
        msg.includes('Cloudflare') ||
        msg.includes('520') ||
        msg.includes('未找到主电影 like 按钮');
      if (!shouldTryHttpFallback) {
        throw error;
      }

      console.warn(`[toggleLike] 页面操作失败，尝试 HTTP 兜底: ${msg}`);
      return this._toggleLikeViaHttpFallback(slug, remove);
    }
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
      this.routeConfigured = false;
    }
  }
}

module.exports = LetterboxdClient;
