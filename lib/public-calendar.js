'use strict';
// Public term calendar: every lecture, section meeting and office hour, week by week.
// Built only from program.json, so changing dates or times there updates the page
// and the downloadable calendar together. Private joining links are never included.

const { termDates, formatTime, formatDate, addDays } = require('./schedule');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** All public events for the term: [{ uid, kind, date, time, minutes, title, label, where }] */
function publicEvents(program) {
  const { termStarts, weeks, shortName } = program;
  const out = [];
  const add = (kind, label, item, date) => out.push({
    uid: `${kind}-${date}@nyphilosophy-reading-club`,
    kind, date, time: item.time, minutes: item.minutes, label, where: item.where,
    title: `${shortName}: ${label}`,
  });

  const lec = program.lecture;
  if (lec) termDates(termStarts, weeks, [lec.weekday]).forEach((d) => add('lecture', lec.label || 'Lecture', lec, d));

  for (const sec of program.sections || []) {
    termDates(termStarts, weeks, sec.weekdays).forEach((d) => out.push({
      uid: `${sec.id}-${d}@nyphilosophy-reading-club`,
      kind: 'section', date: d, time: sec.time, minutes: sec.minutes, label: sec.name, where: sec.where,
      title: `${shortName}: ${sec.name}`,
    }));
  }

  const oh = program.officeHours;
  if (oh) {
    termDates(termStarts, weeks, [oh.weekday])
      .map((d) => oh.dateOverrides?.[d] || d)
      .forEach((d) => add('office', oh.label || 'Office hours', oh, d));
  }

  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** Groups events into the term's weeks, pairing week N with the Nth reading. */
function termWeeks(program) {
  const events = publicEvents(program);
  return Array.from({ length: program.weeks }, (_, i) => {
    const start = addDays(program.termStarts, i * 7);
    const end = addDays(start, 6);
    return {
      n: i + 1, start, end,
      text: (program.texts || [])[i] || null,
      events: events.filter((e) => e.date >= start && e.date <= end),
    };
  });
}

const KIND_LABEL = { lecture: 'Lecture', section: 'Small group', office: 'Optional' };

function calendarSection(program, { today } = {}) {
  const weeks = termWeeks(program);
  const current = today ? weeks.find((w) => today >= w.start && today <= w.end) : null;

  const items = weeks.map((w) => {
    const past = today && w.end < today;
    const isNow = current === w;
    const rows = w.events.map((e) => `
              <li class="cal-ev cal-${e.kind}">
                <span class="cal-day">${esc(formatDate(e.date, { short: true }))}</span>
                <span class="cal-time">${formatTime(e.time)}</span>
                <span class="cal-what"><span class="cal-kind">${esc(KIND_LABEL[e.kind])}</span> ${esc(e.label)}</span>
                <span class="cal-where">${esc(e.kind === 'lecture' ? e.where.split('.')[0] : e.where)}</span>
              </li>`).join('');
    return `
          <li class="cal-week${past ? ' is-past' : ''}${isNow ? ' is-now' : ''}"${isNow ? ' aria-current="date"' : ''}>
            <div class="cal-head">
              <p class="cal-num">Week ${ROMAN[w.n - 1] || w.n}${isNow ? ' <span class="pill pill-open">This week</span>' : ''}</p>
              <p class="cal-dates">${esc(formatDate(w.start, { weekday: false }))} – ${esc(formatDate(w.end, { weekday: false }))}</p>
              ${w.text ? `<p class="cal-text">${esc(w.text.name)}<span> · ${esc(w.text.tradition)}</span></p>` : ''}
            </div>
            <ul class="cal-events">${rows}
            </ul>
          </li>`;
  }).join('');

  return `
    <section class="section section-rule" id="calendar" aria-labelledby="calendar-title">
      <div class="wrap">
        <div class="head-row">
          <h2 id="calendar-title">Calendar</h2>
          <p class="muted">Every session this term. Times are Eastern. Joining links are shared on your member page after you sign up.</p>
        </div>
        <ol class="cal">${items}
        </ol>
        <p><a class="btn btn-outline btn-sm" href="/schedule.ics">Add the full schedule to my calendar</a></p>
      </div>
    </section>`;
}

module.exports = { publicEvents, termWeeks, calendarSection };
