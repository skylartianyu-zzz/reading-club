'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadProgram } = require('../lib/app');
const { publicEvents, calendarSection, statusFor, MAX_MONTHS } = require('../lib/public-calendar');
const { parseCsv, eventsFromCsv, parseDate, parseTime, createScheduleSource } = require('../lib/sheet-schedule');
const { lumaKey } = require('../lib/luma');

const program = loadProgram();
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/schedule.csv'), 'utf8');
const HEAD = 'Date,Start time,Minutes,Type,Session,Host,Reading,Description,Where,Signup link,Luma event ID,Note';

describe('reading the Schedule sheet', () => {
  test('parses quoted CSV with commas, quotes and line breaks', () => {
    assert.deepStrictEqual(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4\n'), [['a', 'b, c', 'say "hi"', 'two\nlines'], ['1', '2', '3', '4']]);
  });

  test('reads every row of the published Schedule tab', () => {
    const events = eventsFromCsv(fixture, program);
    assert.strictEqual(events.length, 60);
    assert.deepStrictEqual([...new Set(events.map((e) => e.kind))].sort(), ['lecture', 'office', 'section']);
    const a = events.find((e) => e.date === '2026-10-19');
    assert.strictEqual(a.sectionId, 'a');
    assert.strictEqual(a.reading, 'Aristotle');
  });

  test('[TBD] counts as empty and is never shown', () => {
    const e = eventsFromCsv(fixture, program).find((x) => x.date === '2026-10-18');
    assert.strictEqual(e.description, '');
    assert.strictEqual(e.signupUrl, '');
    assert.strictEqual(e.host, 'Cole');
  });

  test('bad rows are skipped instead of breaking the page', () => {
    const csv = `${HEAD}\nnot a date,11:00,90,Lecture,X,,,,,,,\n2026-12-06,lunch,90,Lecture,X,,,,,,,\n2026-12-06,11:00,90,Party,X,,,,,,,\n2026-12-06,11:00,90,Lecture,Weekly lecture,Cole,Plato,Ok,,https://luma.com/x,,\n`;
    const events = eventsFromCsv(csv, program);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].description, 'Ok');
  });

  test('columns can be reordered; only https links are kept', () => {
    const csv = 'Type,Date,Start time,Session,Signup link\nLecture,2026-12-06,7 pm,Weekly lecture,javascript:alert(1)\n';
    const [e] = eventsFromCsv(csv, program);
    assert.strictEqual(e.time, '19:00');
    assert.strictEqual(e.signupUrl, '');
  });

  test('dates and times in the formats people actually type', () => {
    assert.strictEqual(parseDate('2026-12-07'), '2026-12-07');
    assert.strictEqual(parseDate('12/7/2026'), '2026-12-07');
    assert.strictEqual(parseDate('2026-02-30'), null);
    assert.strictEqual(parseTime('19:00'), '19:00');
    assert.strictEqual(parseTime('7:30 PM'), '19:30');
    assert.strictEqual(parseTime('12 pm'), '12:00');
    assert.strictEqual(parseTime('25:00'), null);
  });
});

describe('sheet source', () => {
  const ok = (text) => async () => ({ ok: true, status: 200, text: async () => text });
  const quiet = { error() {} };

  test('falls back to program.json when the sheet is unreachable', async () => {
    const src = createScheduleSource({ url: 'x', program, fallback: () => publicEvents(program), fetchImpl: async () => { throw new Error('offline'); }, log: quiet });
    assert.strictEqual((await src.get()).length, publicEvents(program).length);
  });

  test('keeps the last good copy when a later fetch fails', async () => {
    let t = 0;
    let fail = false;
    const src = createScheduleSource({
      url: 'x', program, ttlMs: 10, now: () => t, log: quiet,
      fetchImpl: async () => { if (fail) throw new Error('down'); return ok(fixture)(); },
    });
    assert.strictEqual((await src.get()).length, 60);
    fail = true; t = 100;
    await src.refresh();
    assert.strictEqual((await src.get()).length, 60);
  });

  test('rejects an HTML page (sheet published as a web page, not CSV)', async () => {
    const src = createScheduleSource({ url: 'x', program, fallback: () => [], fetchImpl: ok('<html>nope</html>'), log: quiet });
    assert.deepStrictEqual(await src.get(), []);
  });
});

describe('month calendar', () => {
  const events = eventsFromCsv(fixture, program);
  const today = '2026-11-24';

  // The panel for one month, e.g. panel(html, 0) is the first month shown.
  const panel = (html, i) => html.split(`<div class="mcal-panel mcal-p${i}">`)[1].split('<div class="mcal-panel')[0];

  test('hides past sessions and starts at the current month', () => {
    const html = calendarSection({ events, today });
    const nov = panel(html, 0);
    assert.match(nov, /<h3[^>]*>November 2026/);
    assert.doesNotMatch(html, /Section A<\/p>\s*<p class="ev-sub">Dhammapada/); // Mon Nov 23 is past
    assert.strictEqual((nov.match(/class="ev /g) || []).length, 5); // Nov 24 B, Nov 25 C + office, Nov 29 lecture, Nov 30 A
    assert.doesNotMatch(html, /October 2026/);
  });

  test('switches months without reloading: every upcoming month is on the page, chosen by radio + label', () => {
    const html = calendarSection({ events, today });
    assert.doesNotMatch(html, /href="\/\?month=/, 'no page-reload links');
    assert.deepStrictEqual([...html.matchAll(/<h3[^>]*>([A-Za-z]+ \d{4})/g)].map((m) => m[1]), ['November 2026', 'December 2026', 'January 2027']);
    assert.strictEqual((html.match(/type="radio" name="mcal-month"/g) || []).length, 3);
    assert.match(html, /id="mcal-r0" aria-label="Show November 2026" checked>/);
    assert.match(panel(html, 0), /<label class="mcal-step" for="mcal-r1">Dec 2026/);
    assert.match(panel(html, 1), /<label class="mcal-step" for="mcal-r0">.*Nov 2026/);
    assert.doesNotMatch(panel(html, 2), /Feb 2027/);
  });

  test('?month= picks the first month shown, ignoring months out of range', () => {
    assert.match(calendarSection({ events, today, month: '2026-12' }), /id="mcal-r1" aria-label="Show December 2026" checked>/);
    for (const month of ['2026-09', '2027-06', 'junk']) assert.match(calendarSection({ events, today, month }), /id="mcal-r0" aria-label="Show November 2026" checked>/);
  });

  test('stylesheet can show every month the calendar renders', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    for (let i = 0; i < MAX_MONTHS; i++) assert.ok(css.includes(`.mcal-r${i}:checked ~ .mcal-p${i}`), `missing show rule ${i}`);
  });

  test('lecture pop-up links to Luma; weekday pop-up shows description, host and sign-up', () => {
    const html = calendarSection({ events, today, month: '2026-11', signupHref: '/#sections' });
    assert.match(html, /href="https:\/\/luma\.com\/sample-plato" target="_blank" rel="noopener">Sign up on Luma/);
    const dec = calendarSection({ events, today, month: '2026-12', signupHref: '/#sections' });
    assert.match(dec, /SAMPLE: Apology 17a/);
    assert.match(dec, /With Stephen/);
    assert.match(dec, /href="\/#sections">Sign up/);
    assert.match(dec, /Luma sign-up link coming soon/);
  });

  test('Open / Full comes from seat counts; Open / Sold out from Luma', () => {
    const b = events.find((e) => e.date === '2026-11-24');
    assert.strictEqual(statusFor(b, { avail: { b: { dates: [{ date: '2026-11-24', left: 0 }] } } }), 'full');
    assert.strictEqual(statusFor(b, { avail: { b: { dates: [{ date: '2026-11-24', left: 3 }] } } }), 'open');
    assert.strictEqual(statusFor(b, { avail: null }), null);
    const lec = events.find((e) => e.date === '2026-11-29');
    assert.strictEqual(statusFor(lec, { luma: new Map() }), null);
    assert.strictEqual(statusFor(lec, { luma: new Map([['/sample-plato', 'sold_out']]) }), 'sold_out');
    assert.strictEqual(lumaKey('https://lu.ma/Sample-Plato?utm=x'), '/sample-plato');
  });

  test('escapes whatever instructors type', () => {
    const csv = `${HEAD}\n2026-11-30,19:00,60,Small group,Section A,<b>Eve</b>,Plato,"<script>x</script> & more",Zoom,,,\n`;
    const html = calendarSection({ events: eventsFromCsv(csv, program), today });
    assert.doesNotMatch(html, /<script>x/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; &amp; more/);
    assert.match(html, /With &lt;b&gt;Eve&lt;\/b&gt;/);
  });

  test('program.json fallback produces the same event shape', () => {
    const fb = publicEvents(program);
    assert.ok(fb.length > 0);
    assert.ok(fb.every((e) => e.kind && e.date && e.time && 'description' in e && 'signupUrl' in e));
    const moved = fb.filter((e) => e.kind === 'office').map((e) => e.date);
    for (const [from, to] of Object.entries(program.officeHours?.dateOverrides || {})) {
      assert.ok(!moved.includes(from) && moved.includes(to));
    }
  });
});
