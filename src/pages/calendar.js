import { esc } from '../http-helpers.js';
import { layout } from './layout.js';
import { marketFilterSelect } from './form-helpers.js';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Builds full weeks (Sun-Sat) covering every day of the given month. */
export function monthGridWeeks(year, month) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(firstOfMonth.getUTCDate() - firstOfMonth.getUTCDay());

  const lastOfMonth = new Date(Date.UTC(year, month, 0));
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(lastOfMonth.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  const todayStr = new Date().toISOString().slice(0, 10);
  const days = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    const dateStr = cur.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      dayNum: cur.getUTCDate(),
      inMonth: cur.getUTCMonth() === month - 1,
      isToday: dateStr === todayStr,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function shiftMonth(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function monthParam(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The calendar's current filters (month/rep/status/market), as a query
 * string -- appended to every link that leads away from the calendar and
 * back (an ITB's edit page, its "Back to Bid Calendar" link, the save/delete
 * redirect) so picking a rep or a region, then opening or dropping in a new
 * ITB, doesn't silently reset the view to "everything" the way it used to.
 * `overrides` replaces one piece (prev/next month nav swaps just the month).
 */
export function filterQS(base, overrides = {}) {
  const merged = { month: base.month || '', rep: base.rep || '', status: base.status || '', market: base.market || '', ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

// Okabe-Ito colorblind-safe categorical palette. Assigned to reps in a fixed
// order (each rep's position in the `reps` picklist), never cycled/hashed --
// so a given rep keeps the same color everywhere the legend is shown. This is
// a separate identity channel from the existing itb-status-* badge colors
// (status = where it is in the process; this = who owns it), so it's shown
// as a left-edge stripe on the card rather than recoloring the badge.
const REP_PALETTE = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442'];
const UNASSIGNED_COLOR = '#94a3b8';

function colorForRep(repName, allReps) {
  const name = (repName || '').trim();
  if (!name) return UNASSIGNED_COLOR;
  // Trim both sides of the comparison -- a rep name saved with stray
  // whitespace (old data, a copy/paste) would otherwise never match its
  // entry in the picklist and would silently fall back to gray.
  const idx = allReps.findIndex((r) => r.trim() === name);
  // A rep name that isn't (or isn't yet) in the Sales Rep dropdown list --
  // e.g. typed in before the picklist was set up -- falls back to the same
  // neutral gray as truly unassigned, rather than being miscolored as
  // whichever rep happens to sit at palette index 0.
  if (idx < 0) return UNASSIGNED_COLOR;
  return REP_PALETTE[idx % REP_PALETTE.length];
}

function repLegendHtml(reps) {
  const items = reps.map((r) => `
    <span class="rep-legend-item"><span class="rep-legend-swatch" style="background:${colorForRep(r, reps)}"></span>${esc(r)}</span>`).join('');
  return `<div class="rep-legend">${items}<span class="rep-legend-item"><span class="rep-legend-swatch" style="background:${UNASSIGNED_COLOR}"></span>Unassigned</span></div>`;
}

function itbCardHtml(itb, reps, returnQS) {
  const gcNote = itb.customer_count > 1 ? ` <span class="muted small">+${itb.customer_count - 1} more</span>` : '';
  const statusSlug = esc((itb.status || 'new').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const repColor = colorForRep(itb.assigned_to, reps);
  return `
    <a class="itb-card" draggable="true" data-itb-id="${itb.id}" href="/bid-calendar/itbs/${itb.id}/edit${returnQS ? `?${returnQS}` : ''}" style="border-left-color:${repColor}" title="${itb.assigned_to ? esc(itb.assigned_to) : 'Unassigned'}">
      <div class="itb-card-title">${esc(itb.project_name)}</div>
      <div class="itb-card-meta">${esc(itb.customer_names) || '<span class="muted">No GC yet</span>'}${gcNote}</div>
      <div class="itb-card-meta">
        <span class="itb-status itb-status-${statusSlug}">${esc(itb.status || 'New')}</span>
        ${itb.market ? ` · ${esc(itb.market)}` : ''}
        ${itb.assigned_to ? ` · ${esc(itb.assigned_to)}` : ''}
      </div>
    </a>`;
}

export function renderBidCalendar({ year, month, weeks, itbsByDate, upcoming, reps, statuses, query, flash }) {
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const repOptions = reps.map((r) => `<option value="${esc(r)}"${r === query.rep ? ' selected' : ''}>${esc(r)}</option>`).join('');
  const statusOptions = statuses.map((s) => `<option value="${esc(s.label)}"${s.label === query.status ? ' selected' : ''}>${esc(s.label)}</option>`).join('');

  // Carried on every link that leads off the calendar to an ITB and (via
  // that ITB's own form) back again, so the filters picked here are still
  // in place on return -- see filterQS's doc comment above.
  const returnQS = filterQS({ month: monthParam(year, month), rep: query.rep, status: query.status, market: query.market });

  const headerCells = DOW_LABELS.map((d) => `<div class="calendar-dow">${d}</div>`).join('');

  const weeksHtml = weeks.map((week) => {
    const cells = week.map((day) => {
      const dayItbs = itbsByDate[day.date] || [];
      const cardsHtml = dayItbs.map((itb) => itbCardHtml(itb, reps, returnQS)).join('');
      const classes = ['calendar-day'];
      if (!day.inMonth) classes.push('other-month');
      if (day.isToday) classes.push('is-today');
      return `
        <div class="${classes.join(' ')}" data-date="${day.date}">
          <div class="calendar-day-head">
            <span class="calendar-day-num">${day.dayNum}</span>
            <a class="calendar-add-link" href="/bid-calendar/itbs/new?date=${day.date}&${returnQS}" title="New ITB on this day">+</a>
          </div>
          <div class="calendar-day-body">${cardsHtml}</div>
        </div>`;
    }).join('');
    return `<div class="calendar-week">${cells}</div>`;
  }).join('');

  const upcomingHtml = upcoming.map((itb) => `
    <div class="upcoming-item" style="border-left-color:${colorForRep(itb.assigned_to, reps)}">
      <div><strong>${esc(itb.project_name)}</strong></div>
      <div class="muted small">${esc(itb.due_date)} &middot; ${esc(itb.customer_names) || 'No GC yet'}</div>
      <div class="muted small">${itb.assigned_to ? esc(itb.assigned_to) : 'Unassigned'} &middot; ${esc(itb.status || 'New')}</div>
      <a class="btn btn-tiny" href="/bid-calendar/itbs/${itb.id}/edit?${returnQS}">Open</a>
    </div>
  `).join('') || '<p class="muted small">Nothing upcoming.</p>';

  const body = `
    <div class="page-header">
      <h1>Bid Calendar</h1>
      <a class="btn btn-primary" href="/bid-calendar/itbs/new?${returnQS}">+ New ITB</a>
    </div>
    <p class="muted">Incoming Invitations to Bid (ITBs). Drag a card to a new day to reschedule it, or drag an email straight from Outlook onto a day to start a new one. Click a card to open it.</p>
    ${repLegendHtml(reps)}

    <form class="filter-bar" method="get" action="/bid-calendar">
      <input type="hidden" name="month" value="${monthParam(year, month)}">
      <select name="rep">
        <option value="">All reps</option>
        ${repOptions}
      </select>
      <select name="status">
        <option value="">All statuses</option>
        ${statusOptions}
      </select>
      ${marketFilterSelect({ current: query.market })}
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/bid-calendar">Reset</a>
    </form>

    <div class="calendar-layout">
      <div class="calendar-main card">
        <div class="calendar-nav">
          <a class="btn btn-tiny" href="/bid-calendar?${filterQS(query, { month: monthParam(prev.year, prev.month) })}">&larr; Prev</a>
          <h2>${monthLabel}</h2>
          <a class="btn btn-tiny" href="/bid-calendar?${filterQS(query, { month: monthParam(next.year, next.month) })}">Next &rarr;</a>
        </div>
        <div class="calendar-grid">
          <div class="calendar-dow-row">${headerCells}</div>
          ${weeksHtml}
        </div>
      </div>
      <div class="calendar-sidebar">
        <h3>Upcoming ITBs</h3>
        <div class="upcoming-list">${upcomingHtml}</div>
      </div>
    </div>
  `;

  return layout({ title: 'Bid Calendar', active: '/bid-calendar', body, flash });
}
