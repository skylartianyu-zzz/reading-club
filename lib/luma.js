'use strict';
// Sold-out / open status for Sunday lectures, read from Luma.
//
// PLACEHOLDER until the club's Luma API key is available (it needs Luma Plus on the
// club's calendar). Without LUMA_API_KEY this returns no statuses, and the calendar
// simply shows "Sign up on Luma" with no Open / Sold out label.
//
// To finish: set LUMA_API_KEY on Render, then implement fetchStatuses() against
// GET https://public-api.luma.com/v1/calendars/events/list (header x-luma-api-key),
// mapping each event's public URL to 'open' | 'sold_out'. Verify the field names
// against a real response before relying on them.

function createLumaStatus({ apiKey, log = console, ttlMs = 5 * 60000, now = () => Date.now() } = {}) {
  let cache = null;

  async function fetchStatuses() {
    // TODO(luma): call the Luma API here once a key exists. Return Map<url, 'open'|'sold_out'>.
    return new Map();
  }

  /** Map of normalized Luma event URL → 'open' | 'sold_out'. Empty when not configured. */
  async function statuses() {
    if (!apiKey) return new Map();
    if (cache && now() - cache.at < ttlMs) return cache.map;
    try {
      cache = { at: now(), map: await fetchStatuses() };
    } catch (err) {
      log.error('[luma]', err.message);
      cache = { at: now(), map: cache ? cache.map : new Map() };
    }
    return cache.map;
  }

  return { statuses, configured: Boolean(apiKey) };
}

/** Luma links come as lu.ma/x or luma.com/x, with or without tracking params. */
function lumaKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'lu.ma' && host !== 'luma.com') return null;
    return u.pathname.replace(/\/+$/, '').toLowerCase();
  } catch { return null; }
}

module.exports = { createLumaStatus, lumaKey };
