import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const ITCHIO_URL = 'https://itch.io/jams';
const ITCHIO_MIN_ITEMS = 5;
const ITCHIO_MAX_FUTURE_DAYS = Number(process.env.ITCHIO_MAX_FUTURE_DAYS) || 400;

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function parseItchDurationMs(html) {
  const text = stripHtml(html).toLowerCase();
  const unitMs = {
    minute: 60000,
    minutes: 60000,
    hour: 3600000,
    hours: 3600000,
    day: 86400000,
    days: 86400000,
    week: 7 * 86400000,
    weeks: 7 * 86400000,
    month: 30 * 86400000,
    months: 30 * 86400000
  };
  let total = 0;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s+(minutes?|hours?|days?|weeks?|months?)/g)) {
    total += Number(match[1]) * unitMs[match[2]];
  }
  return total > 0 ? total : null;
}

async function parseItchIoJams() {
  const report = {
    sourceId: 'itchio',
    source: 'itch.io Jams',
    url: ITCHIO_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'itch.io jams parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
      const res = await fetch(ITCHIO_URL, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' }
      });
      clearTimeout(timer);
      report.httpStatus = res.status;
      report.finalUrl = res.url;
      text = await res.text();
      report.reachable = res.status >= 200 && res.status < 400;
    } catch (fetchErr) {
      const fallbackText = fetchViaPowerShell(ITCHIO_URL);
      if (!fallbackText) throw fetchErr;
      text = fallbackText;
      report.httpStatus = 200;
      report.finalUrl = ITCHIO_URL;
      report.reachable = true;
      report.note = 'Fetched itch.io with Windows PowerShell fallback after Node fetch failed.';
    }
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;

    if (!report.reachable) {
      report.note = 'itch.io returned HTTP ' + report.httpStatus + '. No items parsed.';
      return report;
    }

    // Parse jam blocks from itch.io/jams.
    // Each jam is inside a <div class="jam ..."> block containing:
    //   <a href="/jam/<slug>">Title</a>
    //   <span class="date_countdown" title="2026-08-23 10:00:00">2026-08-23T10:00:00Z</span>
    // Status label "Ends in" / "Starts in" appears near the countdown span.

    // Strategy: find all /jam/<slug> links, then for each look at surrounding
    // context for a date_countdown span and the Ends in / Starts in label.
    const jamLinkRe2 = /<a\s+[^>]*href="(\/jam\/[^"/]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seenSlugs = new Set();
    const jamEntries = [];
    let jm;
    while ((jm = jamLinkRe2.exec(text)) !== null) {
      const href = jm[1];
      const innerHtml = jm[2];
      const title = stripHtml(innerHtml);
      if (!title || title.length < 2) continue;
      const slugMatch = href.match(/^\/jam\/([^\/]+)$/);
      if (!slugMatch) continue;
      const jamSlug = slugMatch[1];
      if (seenSlugs.has(jamSlug)) continue;
      seenSlugs.add(jamSlug);
      jamEntries.push({ href, title, jamSlug, pos: jm.index });
    }

    for (const entry of jamEntries) {
      // Search a window after the link for the date_countdown span and status label
      const windowStart = entry.pos;
      const windowEnd = Math.min(text.length, entry.pos + entry.href.length + 5000);
      const blockHtml = text.substring(windowStart, windowEnd);

      // Find the first date_countdown span in this block
      const countdownMatch = blockHtml.match(/<span\s+([^>]*\bclass="date_countdown"[^>]*)>([^<]*)<\/span>/i);
      if (!countdownMatch) {
        report.invalidItemCount += 1;
        continue;
      }

      // Use the text content (ISO) or the title attribute (full datetime).
      const attrs = countdownMatch[1];
      const titleAttr = (attrs.match(/\btitle="([^"]*)"/i) || [])[1] || '';
      const textContent = countdownMatch[2]; // e.g. "2026-08-23T10:00:00Z"

      let isoDeadline;
      if (textContent && /T\d{2}:\d{2}/.test(textContent)) {
        isoDeadline = textContent.trim();
      } else if (titleAttr) {
        // Convert "YYYY-MM-DD HH:MM:SS" to ISO
        isoDeadline = titleAttr.replace(' ', 'T') + 'Z';
      } else {
        report.invalidItemCount += 1;
        continue;
      }

      let deadlineDate = new Date(isoDeadline);
      if (isNaN(deadlineDate.getTime())) {
        report.invalidItemCount += 1;
        continue;
      }

      // Determine deadline type from label text preceding the countdown span.
      // "Ends in" / "Submission closes in" → deadlineType: end. "Starts in" + duration → computed end time.
      const beforeCountdown = blockHtml.substring(0, blockHtml.indexOf(countdownMatch[0]));
      const endsIn = /(Ends|Submissions?\s+closes?|Voting\s+ends)\s+in/i.test(beforeCountdown);
      const startsIn = /Starts\s+in/i.test(beforeCountdown);
      const durationMatch = blockHtml.match(/<span\s+class="date_duration"[^>]*>([\s\S]*?)<\/span>/i);
      const durationMs = startsIn && durationMatch ? parseItchDurationMs(durationMatch[1]) : null;
      let deadlineType = endsIn ? 'end' : 'start';
      let description = endsIn
        ? 'Parsed from itch.io/jams. Deadline is the jam end time.'
        : 'Parsed from itch.io/jams. Deadline is the jam start time; check jam page for end date.';
      if (!endsIn && durationMs) {
        deadlineDate = new Date(deadlineDate.getTime() + durationMs);
        isoDeadline = deadlineDate.toISOString().replace('.000Z', 'Z');
        deadlineType = 'end-computed';
        description = 'Parsed from itch.io/jams. Deadline is computed from the listed start time plus jam duration.';
      }

      const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > ITCHIO_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }

      const tags = ['game jam'];

      const itemId = 'itchio-jam-' + entry.jamSlug;

      report.items.push({
        id: itemId,
        title: entry.title,
        deadline: isoDeadline,
        deadlineType,
        tags,
        url: 'https://itch.io' + entry.href,
        status: 'upcoming',
        description,
        stage: 'upcoming',
        source: 'itch.io Jams',
        type: 'contest'
      });
    }

    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= ITCHIO_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' jam items from itch.io/jams; rejected ' + report.invalidItemCount + ' invalid/no-date entries.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'itch.io fetch failed: ' + report.error;
  }
  return report;
}

async function itchIoJamsAdapter() {
  return parseItchIoJams();
}
async function globalGameJamAdapter() {
  return fetchSourcePage({ id: "global-game-jam", name: "Global Game Jam", url: "https://globalgamejam.org" });
}

async function igfAdapter() {
  return fetchSourcePage({ id: "igf", name: "Independent Games Festival", url: "https://igf.com" });
}

async function unityAdapter() {
  return fetchSourcePage({ id: "unity", name: "Unity Challenges", url: "https://unity.com" });
}

const adapters = [globalGameJamAdapter, itchIoJamsAdapter, igfAdapter, unityAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);
if (harvestedItems.length >= ITCHIO_MIN_ITEMS && parserHealthy && parserDropOk) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "game-dev-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
