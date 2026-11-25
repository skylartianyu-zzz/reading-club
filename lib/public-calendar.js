'use strict';
// Public month calendar for the homepage.
//
// Events come from the published "Schedule" tab of the website-content Google Sheet
// (see sheet-schedule.js); program.json is only a fallback. Lectures link to Luma,
// small groups link to the site's own sign-up section with Open / Full from Stripe
// seat counts. Past sessions are hidden automatically. Private joining links are
// never part of any of this.
//
// No client-side JavaScript: pop-ups open on hover / keyboard focus with CSS, and on
// small screens the grid becomes a day-by-day list with details shown inline.

const { termDates, formatTime, addDays } = require('./schedule');
const { lumaKey } = require('./luma');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND = { lecture: 'Lecture', section: 'Small group', office: 'Office hours' };

const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const monthOf = (d) => d.slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const monthShort = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${y}`; };
const endTime = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** program.json's schedule in the same shape as Sheet events (fallback only). */
function publicEvents(program) {
  const { termStarts, weeks, shortName } = program;
  const out = [];
  const reading = (d) => {
    const i = Math.floor((Date.parse(d) - Date.parse(termStarts)) / (7 * 86400000));
    return (program.texts || [])[i]?.name || '';
  };
  const push = (kind, label, item, date, extra = {}) => out.push({
    uid: `${kind}-${date}-${item.time.replace(':', '')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}@nyphilosophy-reading-club`,
    kind, date, time: item.time, minutes: item.minutes, label, title: `${shortName}: ${label}`,
    host: '', reading: reading(date), description: '', where: item.where, signupUrl: '', note: '', sectionId: null, ...extra,
  });
  const lec = program.lecture;
  if (lec) termDates(termStarts, weeks, [lec.weekday]).forEach((d) => push('lecture', lec.label || 'Lecture', lec, d, { host: program.teacher?.name || '' }));
  for (const sec of program.sections || []) termDates(termStarts, weeks, sec.weekdays).forEach((d) => push('section', sec.name, sec, d, { sectionId: sec.id }));
  const oh = program.officeHours;
  if (oh) termDates(termStarts, weeks, [oh.weekday]).map((d) => oh.dateOverrides?.[d] || d).forEach((d) => push('office', oh.label || 'Office hours', oh, d));
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** 'open' | 'full' | 'sold_out' | null (unknown: no label shown). */
function statusFor(e, { avail, luma }) {
  if (e.kind === 'lecture') {
    const k = e.signupUrl && lumaKey(e.signupUrl);
    return (k && luma && luma.get(k)) || null;
  }
  if (e.kind === 'section' && e.sectionId && avail?.[e.sectionId]) {
    const slot = avail[e.sectionId].dates.find((x) => x.date === e.date);
    if (slot) return slot.left > 0 ? 'open' : 'full';
  }
  return null;
}
const STATUS_LABEL = { open: 'Open', full: 'Full', sold_out: 'Sold out' };

function eventHtml(e, status, { signupHref, alignEnd }) {
  const when = `${DAY_NAMES[dow(e.date)]} · ${formatTime(e.time)}–${formatTime(endTime(e.time, e.minutes))} ET`;
  const heading = e.kind === 'lecture' && e.reading ? e.reading : e.label;
  const sub = e.kind === 'lecture' ? (heading === e.label ? '' : 'Sunday lecture') : e.reading;
  const place = e.kind === 'lecture' ? e.where.split('.')[0] : e.where;

  let cta;
  if (e.kind === 'lecture') {
    cta = e.signupUrl
      ? `<a class="btn btn-primary btn-sm" href="${esc(e.signupUrl)}" target="_blank" rel="noopener">${status === 'sold_out' ? 'Join the waitlist on Luma' : 'Sign up on Luma'} <span aria-hidden="true">↗</span><span class="vh"> (opens Luma)</span></a>`
      : '<p class="pop-muted">Luma sign-up link coming soon.</p>';
  } else if (e.kind === 'section') {
    cta = `<a class="btn btn-primary btn-sm" href="${esc(signupHref)}">${status === 'full' ? 'See other times' : 'Sign up'} <span aria-hidden="true">→</span></a>`;
  } else {
    cta = '<p class="pop-muted">Optional, for members.</p>';
  }

  const pill = status ? ` · <span class="st st-${status}">${STATUS_LABEL[status]}</span>` : '';
  return `
                <div class="ev ev-${e.kind}" tabindex="0">
                  <p class="ev-meta">${formatTime(e.time)}${pill}</p>
                  <p class="ev-title">${esc(heading)}</p>
                  ${sub && sub !== heading ? `<p class="ev-sub">${esc(sub)}</p>` : ''}
                  <div class="pop${alignEnd ? ' pop-end' : ''}" role="group" aria-label="${esc(heading)} details">
                    <p class="pop-kind">${esc(KIND[e.kind])}${e.kind === 'section' ? ` · ${esc(e.label)}` : ''}</p>
                    <p class="pop-title">${esc(heading)}</p>
                    <p class="pop-when">${esc(when)}</p>
                    <p class="pop-desc">${e.description ? esc(e.description) : '<span class="pop-muted">Details coming soon.</span>'}</p>
                    ${e.host ? `<p class="pop-host">With ${esc(e.host)}</p>` : ''}
                    ${place ? `<p class="pop-where">${esc(place)}</p>` : ''}
                    ${e.note ? `<p class="pop-note">${esc(e.note)}</p>` : ''}
                    ${cta}
                  </div>
                </div>`;
}

// Months are switched in the browser without reloading: every upcoming month is
// rendered, and hidden radio buttons (one per month) pick which one is visible via
// CSS. The site sends no JavaScript. styles.css has show rules for MAX_MONTHS panels.
const MAX_MONTHS = 12;

function monthPanel(m, i, count, { byDate, today, avail, luma, signupHref }) {
  const monthStart = `${m}-01`;
  const monthEnd = addDays(`${addMonths(m, 1)}-01`, -1);
  const gridStart = addDays(monthStart, -dow(monthStart));
  const gridEnd = addDays(monthEnd, 6 - dow(monthEnd));

  const cells = [];
  let any = false;
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const inMonth = monthOf(d) === m;
    const past = d < today;
    const list = inMonth ? byDate.get(d) || [] : [];
    if (list.length) any = true;
    const col = dow(d);
    const cls = ['day', inMonth ? '' : 'is-out', past ? 'is-past' : '', d === today ? 'is-today' : '', list.length ? 'has-ev' : 'is-empty'].filter(Boolean).join(' ');
    const num = Number(d.slice(8));
    const label = `${DAY_NAMES[col]}, ${MONTHS[Number(d.slice(5, 7)) - 1]} ${num}`;
    const isToday = inMonth && d === today;
    cells.push(`
            <li class="${cls}"${isToday ? ' aria-current="date"' : ''}>
              <p class="day-num"><span class="day-n" aria-hidden="true">${num === 1 ? `${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ` : ''}${num}</span><span class="vh">${esc(label)}</span><span class="day-name" aria-hidden="true">${esc(label)}</span>${isToday ? ' <span class="today-tag">Today</span>' : ''}</p>${list.map((e) => eventHtml(e, statusFor(e, { avail, luma }), { signupHref, alignEnd: col >= 4 })).join('')}
            </li>`);
  }

  const step = (j, text) => `<label class="mcal-step" for="mcal-r${j}">${text}</label>`;
  return `
        <div class="mcal-panel mcal-p${i}">
          <div class="mcal-nav">
            ${i > 0 ? step(i - 1, `<span aria-hidden="true">←</span> ${esc(monthShort(addMonths(m, -1)))}`) : '<span></span>'}
            <h3 class="mcal-month" id="calendar-month-${i}">${esc(monthName(m))}</h3>
            ${i < count - 1 ? step(i + 1, `${esc(monthShort(addMonths(m, 1)))} <span aria-hidden="true">→</span>`) : '<span></span>'}
          </div>
          ${any ? '' : `<p class="muted mcal-empty">No upcoming sessions in ${esc(monthName(m))} yet.</p>`}
          <ol class="mcal-head" aria-hidden="true">${DAYS.map((d) => `<li>${d}</li>`).join('')}</ol>
          <ol class="mcal" aria-labelledby="calendar-month-${i}">${cells.join('')}
          </ol>
        </div>`;
}

/**
 * @param {object} o
 * @param {Array} o.events  Sheet (or fallback) events
 * @param {string} o.today  'YYYY-MM-DD' in New York
 * @param {string} [o.month] 'YYYY-MM' to show first (via ?month=); others are one click away
 * @param {object} [o.avail] seat availability from app.js
 * @param {Map} [o.luma]    Luma URL → status
 * @param {string} [o.signupHref] where weekday "Sign up" goes
 */
function calendarSection({ events = [], today, month, avail = null, luma = null, signupHref = '/#sections' }) {
  const upcoming = events.filter((e) => e.date >= today);
  const first = monthOf(today);
  const lastEvent = upcoming.length ? monthOf(upcoming[upcoming.length - 1].date) : first;
  const months = [];
  for (let m = first; m <= lastEvent && months.length < MAX_MONTHS; m = addMonths(m, 1)) months.push(m);
  const start = Math.max(0, months.indexOf(month && /^\d{4}-\d{2}$/.test(month) ? month : first));

  const byDate = new Map();
  for (const e of upcoming) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const radios = months.map((m, i) => `
        <input class="mcal-radio mcal-r${i} vh" type="radio" name="mcal-month" id="mcal-r${i}" aria-label="Show ${esc(monthName(m))}"${i === start ? ' checked' : ''}>`).join('');
  const panels = months.map((m, i) => monthPanel(m, i, months.length, { byDate, today, avail, luma, signupHref })).join('');

  return `
    <section class="section section-rule" id="calendar" aria-labelledby="calendar-title">
      <div class="wrap">
        <div class="head-row">
          <h2 id="calendar-title">Calendar</h2>
          <p class="muted">Sunday lectures are booked on Luma. Weekday reading sessions are booked here. Hover or tap a session for details. Times are Eastern.</p>
        </div>
        <div class="mcal-wrap">${radios}${panels}
        </div>
        <p class="mcal-foot"><a href="/schedule.ics">Add upcoming sessions to my calendar</a></p>
      </div>
    </section>`;
}

module.exports = { publicEvents, calendarSection, statusFor, MAX_MONTHS };
