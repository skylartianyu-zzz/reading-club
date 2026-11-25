'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { loadProgram } = require('../lib/app');
const { publicEvents, termWeeks, calendarSection } = require('../lib/public-calendar');

const program = loadProgram();

test('public calendar lists every session for the term from program.json', () => {
  const events = publicEvents(program);
  const per = program.sections.reduce((n, s) => n + s.weekdays.length, 0);
  const expected = program.weeks * (1 + per + (program.officeHours ? 1 : 0));
  assert.strictEqual(events.length, expected);
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].date + events[i - 1].time <= e.date + e.time), 'sorted');
});

test('office-hour date overrides are applied', () => {
  const dates = publicEvents(program).filter((e) => e.kind === 'office').map((e) => e.date);
  for (const [from, to] of Object.entries(program.officeHours?.dateOverrides || {})) {
    assert.ok(!dates.includes(from));
    assert.ok(dates.includes(to));
  }
});

test('weeks pair with readings and contain only their own dates', () => {
  const weeks = termWeeks(program);
  assert.strictEqual(weeks.length, program.weeks);
  weeks.forEach((w, i) => {
    assert.strictEqual(w.text?.name, program.texts[i]?.name);
    assert.ok(w.events.every((e) => e.date >= w.start && e.date <= w.end));
  });
});

test('calendar section marks the current week and never includes private links', () => {
  const today = termWeeks(program)[1].start;
  const html = calendarSection(program, { today });
  assert.match(html, /id="calendar"/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /href="\/schedule\.ics"/);
  assert.doesNotMatch(html, /zoom\.us|https?:\/\/(?!nyphilosophy)/i);
});
