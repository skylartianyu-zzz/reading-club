'use strict';
// Reads the public "Schedule" tab of the Reading Club website-content Google Sheet
// (File → Share → Publish to web → CSV) and turns its rows into calendar events.
//
// Instructors edit the Sheet; the site re-reads it every few minutes. A row that
// can't be understood is skipped, never shown half-broken, and if the Sheet can't
// be reached the site keeps the last good copy, or falls back to program.json.

const TYPES = { 'lecture': 'lecture', 'small group': 'section', 'office hours': 'office' };

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "[TBD]", "TBD", "[TBD – paste link]" all mean "not filled in yet".
const clean = (v) => {
  const t = String(v ?? '').trim();
  return /^\[?\s*tbd\b/i.test(t) ? '' : t;
};

function parseDate(v) {
  const t = clean(v);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // what Sheets shows if the column format gets reset
  if (m) return iso(+m[3], +m[1], +m[2]);
  return null;
}
function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function parseTime(v) {
  const t = clean(v).toLowerCase().replace(/\s+/g, '');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === 'pm' ? 12 : 0); }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const safeUrl = (v) => {
  const t = clean(v);
  try { const u = new URL(t); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
};

function sectionIdFor(program, label) {
  const name = String(label || '').trim().toLowerCase();
  const sec = (program.sections || []).find((s) => s.name.toLowerCase() === name || s.id.toLowerCase() === name);
  return sec ? sec.id : null;
}

/** CSV text → sorted events. Unknown columns are ignored; column order doesn't matter. */
function eventsFromCsv(text, program) {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const col = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (r, name) => (col[name] === undefined ? '' : r[col[name]] ?? '');
  const out = [];
  for (const r of body) {
    const date = parseDate(get(r, 'date'));
    const time = parseTime(get(r, 'start time'));
    const kind = TYPES[clean(get(r, 'type')).toLowerCase()];
    if (!date || !time || !kind) continue;
    const minutes = Math.min(600, Math.max(15, parseInt(clean(get(r, 'minutes')), 10) || 60));
    const label = clean(get(r, 'session')) || { lecture: 'Lecture', section: 'Small group', office: 'Office hours' }[kind];
    out.push({
      uid: `${kind}-${date}-${time.replace(':', '')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}@nyphilosophy-reading-club`,
      kind, date, time, minutes, label,
      title: `${program.shortName}: ${label}`,
      host: clean(get(r, 'host')),
      reading: clean(get(r, 'reading')),
      description: clean(get(r, 'description')),
      where: clean(get(r, 'where')),
      signupUrl: safeUrl(get(r, 'signup link')),
      note: clean(get(r, 'note')),
      sectionId: kind === 'section' ? sectionIdFor(program, label) : null,
    });
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * A cached reader. get() resolves quickly: it serves the cached copy and refreshes
 * in the background once it is older than ttlMs. Only the very first call waits.
 */
function createScheduleSource({ url, program, fallback = () => [], fetchImpl = globalThis.fetch, ttlMs = 5 * 60000, timeoutMs = 6000, log = console, now = () => Date.now() }) {
  let cache = null; // { at, events }
  let inflight = null;

  async function load() {
    if (!url) return fallback();
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Schedule sheet returned HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error('Schedule sheet returned HTML, not CSV (is it published as CSV?)');
    const events = eventsFromCsv(text, program);
    if (!events.length) throw new Error('Schedule sheet had no readable rows');
    return events;
  }

  function refresh() {
    if (!inflight) {
      inflight = load()
        .then((events) => { cache = { at: now(), events }; return events; })
        .catch((err) => {
          log.error('[schedule sheet]', err.message);
          // Keep the last good copy (or program.json) and try the Sheet again after ttl.
          cache = { at: now(), events: cache ? cache.events : fallback() };
          return cache.events;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  async function get() {
    if (!cache) return refresh();
    if (now() - cache.at > ttlMs) refresh();
    return cache.events;
  }

  return { get, refresh };
}

module.exports = { parseCsv, eventsFromCsv, parseDate, parseTime, createScheduleSource };
