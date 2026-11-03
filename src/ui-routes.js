import { sendHtml, sendRedirect, readFormBody, sendJson, readJsonBody, readRawBody, parseCookies, setCookie } from './http-helpers.js';
import * as Customers from './models/customers.js';
import * as Tasks from './models/tasks.js';
import * as Documents from './models/documents.js';
import * as ApiKeys from './models/apiKeys.js';
import * as Bids from './models/bids.js';
import * as Picklists from './models/picklists.js';
import * as CloseDays from './models/closeDays.js';
import * as Itbs from './models/itbs.js';
import * as ItbAttachments from './models/itbAttachments.js';
import * as Users from './models/users.js';
import { parseEmailFile, extractGcInfo } from './email-parser.js';
import fs from 'node:fs';
import path from 'node:path';
import { renderCustomerList, renderCustomerForm, renderCustomerDetail } from './pages/customers.js';
import { renderPipeline } from './pages/pipeline.js';
import { renderTasks } from './pages/tasks.js';
import { renderDocuments } from './pages/documents.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderApiKeys } from './pages/apiKeys.js';
import { renderBidForm } from './pages/bids.js';
import { renderSales } from './pages/sales.js';
import { renderProjectsList, renderProjectForm } from './pages/projects.js';
import { renderDropdowns } from './pages/dropdowns.js';
import { renderCloseDays } from './pages/closeDays.js';
import { renderBidCalendar, monthGridWeeks, filterQS } from './pages/calendar.js';
import { renderItbForm, renderConvertItbForm } from './pages/itbs.js';
import { renderUsers } from './pages/users.js';
import { renderRepDashboard } from './pages/repDashboard.js';
import { customerDisplayName } from './pages/form-helpers.js';
import { STAGES } from './constants.js';
import { periodRange } from './period.js';
import { getCurrentUser } from './request-context.js';

/**
 * A rep may only reach a record that's theirs (matched by rep name, e.g. a
 * customer's assigned_to, a bid's rep -- which is its customer's
 * assigned_to -- or an ITB's assigned_to). A manager (or no logged-in user,
 * which shouldn't happen for a UI route past server.js's session check, but
 * defends anyway) can always reach it. An unassigned record (no rep) belongs
 * to nobody's "mine" view, so a rep is denied there too -- correct, since it
 * won't be showing up on their dashboard either.
 */
function canAccessOwner(ownerRep) {
  const user = getCurrentUser();
  if (!user || user.role === 'manager') return true;
  return Boolean(ownerRep) && ownerRep === user.rep;
}

function denyAccess(res) {
  sendHtml(res, 403, '<h1>Not authorized</h1><p><a href="/my-dashboard">Back to your dashboard</a></p>');
}

/** Union of sales_rep picklist labels + any legacy free-text rep values already on customers. */
async function allRepOptions() {
  const picklistReps = (await Picklists.listItems('sales_rep')).map((i) => i.label);
  const legacyReps = await Bids.distinctReps();
  return [...new Set([...picklistReps, ...legacyReps])].sort();
}

async function bidPicklists() {
  const salesReps = await Picklists.listItems('sales_rep');
  return {
    sales_status: await Picklists.listItems('sales_status'),
    estimator: salesReps, // Estimator shares the Sales Rep list -- same pool of people, no separate list to maintain.
    contract_type: await Picklists.listItems('contract_type'),
    vertical_market: await Picklists.listItems('vertical_market'),
    roof_type: await Picklists.listItems('roof_type'),
    sales_rep: salesReps,
    itb_status: await Picklists.listItems('itb_status'),
  };
}

/** Always returns an array, whether readFormBody gave back one value, many, or none (repeated form field names). */
function toArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The "Additional customers / GCs" multi-select on a bid's own edit/create form -- the same job bid to more than one GC. Excludes whichever id is the bid's primary customer, in case the same one got picked in both places. */
function extraCustomerIdsFromBody(body, excludeId) {
  return toArray(body.additional_customer_ids).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== excludeId);
}

/**
 * Creates any brand-new customers entered in the "Additional customers"
 * repeater rows (a first/last/company with no existing customer picked) and
 * returns the full list of customer ids -- existing + newly created -- to
 * link onto a bid.
 */
async function resolveExtraCustomerIds(body, { assignedTo, market } = {}) {
  const existingIds = toArray(body.extra_existing_id);
  const firsts = toArray(body.extra_first_name);
  const lasts = toArray(body.extra_last_name);
  const companies = toArray(body.extra_company_name);
  const rowCount = Math.max(existingIds.length, firsts.length, lasts.length, companies.length);

  const ids = [];
  for (let i = 0; i < rowCount; i++) {
    const existingId = existingIds[i];
    if (existingId) {
      ids.push(Number(existingId));
      continue;
    }
    const first = (firsts[i] || '').trim();
    const last = (lasts[i] || '').trim();
    const company = (companies[i] || '').trim();
    if (!first && !last && !company) continue; // empty row -- nothing to do
    const newCustomer = await Customers.createCustomer({
      record_type: 'lead',
      stage: 'estimate_sent',
      first_name: first,
      last_name: last,
      company_name: company,
      assigned_to: assignedTo || '',
      market: market || '',
    });
    ids.push(newCustomer.id);
  }
  return ids;
}

/** A bid is "resolved" once its Sales Status is Won (100%) or Lost (0%) -- either way, nothing more to chase. */
async function isBidResolved(bid) {
  if (!bid) return false;
  const probability = await Picklists.getWeight('sales_status', bid.sales_status);
  return probability === 100 || probability === 0;
}

/**
 * Keeps a bid's "Next Follow-up Date" and its follow-up task in sync: updates
 * the existing open follow-up task for this bid if there is one, otherwise
 * creates one. Called after every bid create/update so the customer's
 * Follow-up Tasks section always reflects what was entered on the bid,
 * without the user re-typing it by hand.
 *
 * Follow-ups are mandatory on every open project, not just ones where
 * someone typed a date in -- so if no date was given and there's still no
 * open follow-up task for this bid, one gets created anyway, due out at
 * this contract type's configured cadence (falls back to 3 days if that
 * hasn't been set). Does nothing once the bid is Won/Lost.
 */
// Returns the follow-up task that now exists for this bid (created or
// already-there), or null if none was needed (bid already resolved). This
// return value is purely so callers can tell the user what happened -- e.g.
// including the scheduled date in a flash message right after creating a
// project, since nothing on the bid form itself shows it otherwise (there's
// no "Next Follow-up Date" auto-fill; the auto-cadence only ever creates a
// separate Follow-up Tasks entry, so without a visible confirmation it looks
// like nothing happened at all).
async function syncBidFollowUpTask(bid) {
  if (!bid) return null;
  // Who the follow-up belongs to: the Estimator chosen on THIS bid, not
  // bid.rep (that's actually the linked customer's assigned_to, joined in
  // from BID_SELECT -- a customer can already be "owned" by a different rep
  // than whoever is actually estimating/working this particular project, so
  // using it here was handing every auto-created follow-up to whichever rep
  // the customer record happened to be assigned to instead of the rep
  // actually picked on the bid/project form). Falls back to bid.rep only
  // for older bids that predate the Estimator field being required.
  const owner = bid.estimator || bid.rep || '';
  const existing = await Tasks.getOpenTaskForBid(bid.id);
  if (bid.next_follow_up_date) {
    if (existing) {
      if (existing.due_date !== bid.next_follow_up_date || existing.assigned_to !== owner) {
        return Tasks.updateTask(existing.id, { due_date: bid.next_follow_up_date, assigned_to: owner });
      }
      return existing;
    }
    return Tasks.createTask({
      customer_id: bid.customer_id,
      bid_id: bid.id,
      title: 'Bid follow-up',
      due_date: bid.next_follow_up_date,
      assigned_to: owner,
    });
  }
  if (existing) {
    if (existing.assigned_to !== owner) return Tasks.updateTask(existing.id, { assigned_to: owner });
    return existing;
  }
  if (await isBidResolved(bid)) return null;
  const cadenceDays = Number(await Picklists.getWeight2('contract_type', bid.contract_type)) || 3;
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + cadenceDays);
  return Tasks.createTask({
    customer_id: bid.customer_id,
    bid_id: bid.id,
    title: 'Bid follow-up',
    due_date: due.toISOString().slice(0, 10),
    assigned_to: owner,
  });
}

/** Appends the scheduled follow-up date to a flash message, when there is one. */
function withFollowUpFlash(message, task) {
  return task && task.due_date ? `${message} Follow-up scheduled for ${task.due_date}.` : message;
}

/**
 * Handles "Mark done" on a follow-up task. Follow-ups are mandatory: a rep
 * can't complete one without having logged something first -- notes (a
 * phone call), the Email Sent flag, or the project itself having been
 * resolved (Won/Lost, so there's nothing left to chase). If none of those
 * are true, the completion is refused and the rep is sent back with a flash
 * explaining why. Otherwise, if the project is still open, the next
 * follow-up is auto-scheduled at the contract type's cadence (falls back to
 * 3 days, same as syncBidFollowUpTask, if that hasn't been configured) --
 * this keeps renewing indefinitely, the same way a brand-new bid's first
 * follow-up does, until the bid is Won/Lost or its expected-close date
 * (delivered date + forecast days) has actually passed. A bid that doesn't
 * have an expected-close date yet (no delivered date, or no forecast days
 * configured for its contract type) is NOT treated as past its timeline --
 * that was the bug: it silently stopped renewing follow-ups on exactly the
 * projects that hadn't been delivered/dated yet, i.e. most new projects,
 * making them fall off the list after a single follow-up instead of only
 * once they're actually Won, Lost, or genuinely overdue.
 */
async function completeFollowUpTask(task, referer, res) {
  const notesOk = Boolean(task.notes && task.notes.trim());
  const emailOk = Boolean(task.email_sent);
  const bid = task.bid_id ? await Bids.getBid(task.bid_id) : null;
  const bidResolved = await isBidResolved(bid);
  if (!notesOk && !emailOk && !bidResolved) {
    const sep = referer.includes('?') ? '&' : '?';
    return sendRedirect(res, `${referer}${sep}flash=${encodeURIComponent('Add a note, check "Email sent," or mark the project Won/Lost before completing this follow-up.')}`);
  }
  await Tasks.updateTask(task.id, { status: 'done' });
  let flashMessage = 'Marked done.';
  if (bid && !bidResolved) {
    const pastTimeline = Boolean(bid.expected_close_date) && new Date().toISOString().slice(0, 10) > bid.expected_close_date;
    if (!pastTimeline) {
      const cadenceDays = Number(await Picklists.getWeight2('contract_type', bid.contract_type)) || 3;
      const nextDue = new Date();
      nextDue.setUTCDate(nextDue.getUTCDate() + cadenceDays);
      const nextDueStr = nextDue.toISOString().slice(0, 10);
      const nextTask = await Tasks.createTask({
        customer_id: task.customer_id,
        bid_id: task.bid_id,
        title: task.title,
        due_date: nextDueStr,
        assigned_to: task.assigned_to,
      });
      // Belt-and-suspenders: task.id is already done at this point, so this
      // shouldn't normally find anything, but if a duplicate open task for
      // this bid already existed (manually added, or reopened) this keeps
      // only the one we just created -- see closeOtherOpenTasksForBid.
      await Tasks.closeOtherOpenTasksForBid(task.bid_id, nextTask.id);
      flashMessage = `Marked done. Next follow-up scheduled for ${nextDueStr}.`;
    } else {
      flashMessage = 'Marked done. This project is past its expected close date, so no further follow-up was scheduled.';
    }
  }
  const sep = referer.includes('?') ? '&' : '?';
  sendRedirect(res, `${referer}${sep}flash=${encodeURIComponent(flashMessage)}`);
}

/**
 * Keeps a customer's Pipeline stage in step with what actually happened on
 * their bid: marking a bid's Sales Status as Won (100%) or Lost (0%) moves
 * the linked customer to that same stage on the Pipeline board. Without
 * this, a bid could be sitting "Won" on the Sales tab while its customer is
 * still parked in an earlier stage, so the Pipeline board's Won/Lost columns
 * never show it. Only moves the stage forward into won/lost -- never back
 * out of it from some other in-between bid edit, and does nothing for a bid
 * with no linked customer yet.
 */
async function syncCustomerStageFromBid(bid) {
  if (!bid || !bid.customer_id) return;
  const probability = await Picklists.getWeight('sales_status', bid.sales_status);
  if (probability !== 100 && probability !== 0) return;
  const targetStage = probability === 100 ? 'won' : 'lost';
  const customer = await Customers.getCustomer(bid.customer_id);
  if (customer && customer.stage !== targetStage) {
    await Customers.updateCustomer(bid.customer_id, { stage: targetStage });
  }
}

function flashFromQuery(query) {
  return query.flash ? decodeURIComponent(query.flash) : '';
}

/**
 * Best-effort: scrubs a dropped email (.msg or .eml) for GC (General
 * Contractor) contact info and links it onto the ITB's "Customers / GCs
 * bidding this project" list automatically -- matching an existing customer
 * by email or company name first, so dragging in a second/third GC's email
 * on an already-created ITB doesn't require going to Customers and adding
 * them by hand first. Also backfills the ITB's source_subject/source_from/
 * source_received_at from the first email dropped on it, same fields the
 * calendar's "dropped as text" fallback path has always filled in -- the
 * "dropped as a file" path (the normal case, an actual .msg/.eml) never did
 * until now. Returns a small summary object for the upload response so the
 * browser can tell the user what got detected/linked, or null if nothing
 * usable could be pulled out of this particular email -- never throws, so a
 * file this can't parse still just gets saved as a plain attachment.
 */
async function scrubEmailForGc(itb, buffer, filename) {
  const parsed = parseEmailFile(buffer, filename);
  if (!itb.source_subject && !itb.source_from && (parsed.subject || parsed.from)) {
    await Itbs.updateItb(itb.id, {
      source_subject: parsed.subject || '',
      source_from: parsed.from || '',
      source_received_at: parsed.receivedAt || '',
    });
  }
  const info = extractGcInfo(parsed);
  // Require an actual name (company or contact) before auto-linking anything
  // -- a bare email address with no name attached isn't enough to safely
  // guess who's bidding (that was the bug: the sending address itself was
  // getting added as the customer). See extractGcInfo's doc comment.
  if (!info.companyName && !info.contactName) return null;

  let customer = (info.email && await Customers.findByEmail(info.email)) || (info.companyName && await Customers.findByCompanyName(info.companyName)) || null;
  let created = false;
  if (!customer) {
    const [firstName, ...rest] = (info.contactName || '').split(' ');
    customer = await Customers.createCustomer({
      record_type: 'lead',
      stage: 'estimate_sent',
      company_name: info.companyName || '',
      first_name: firstName || '',
      last_name: rest.join(' '),
      email: info.email || '',
      phone: info.phone || '',
      assigned_to: itb.assigned_to || '',
      market: itb.market || '',
    });
    created = true;
  }

  const linkedIds = (await Itbs.listLinkedCustomers(itb.id)).map((c) => c.id);
  let linked = false;
  if (!linkedIds.includes(customer.id)) {
    await Itbs.setLinkedCustomers(itb.id, [...linkedIds, customer.id]);
    linked = true;
  }
  return { name: customerDisplayName(customer), created, linked };
}

export function registerUiRoutes(router) {
  // --- Dashboard ---------------------------------------------------------
  // Filter selections (quick range/months/rep/contract type) persist across
  // navigation via a cookie: a GET that came from the filter-bar form always
  // includes the hidden "dash_submit" field, so its presence is how we tell
  // "the user just submitted filters" apart from "the user just clicked the
  // Dashboard nav link" -- the latter falls back to whatever was saved last,
  // instead of silently reverting to defaults. The filter bar itself is one
  // combined <select multiple name="dash_filter"> mixing three "preset:*"
  // quick-range options with specific calendar months; picking any month(s)
  // overrides the preset, same as the old two-dropdown setup did.
  router.get('/', async (req, res, params, query) => {
    const user = getCurrentUser();
    const cookies = parseCookies(req);
    let effective = null;

    if (query.reset !== undefined) {
      setCookie(res, 'dash_filters', '', { maxAgeDays: 0 });
    } else if (query.dash_submit !== undefined) {
      const picked = toArray(query.dash_filter).filter(Boolean);
      const months = picked.filter((v) => /^\d{4}-\d{2}$/.test(v));
      const presetPick = picked.find((v) => v.startsWith('preset:'));
      effective = {
        period: months.length ? '' : (presetPick ? presetPick.slice('preset:'.length) : 'month'),
        rep: query.rep || '',
        contract_type: query.contract_type || '',
        market: query.market || '',
        months,
      };
      setCookie(res, 'dash_filters', JSON.stringify(effective));
    } else if (cookies.dash_filters) {
      try { effective = JSON.parse(cookies.dash_filters); } catch { effective = null; }
    }
    // No saved filter yet (brand-new login, or they hit Reset): default the
    // Region filter to this user's own territory instead of "combined" --
    // see Users.market / the AZ/CA designation set on the Users settings
    // page. Falls back to '' (combined) for a session predating that field.
    if (!effective) effective = { period: 'month', rep: '', contract_type: '', market: (user && user.market) || '', months: [] };

    const rep = effective.rep || undefined;
    const contractType = effective.contract_type || undefined;
    const market = effective.market || undefined;
    const months = Array.isArray(effective.months) ? effective.months.filter(Boolean) : [];
    const { start, end } = periodRange(effective.period || 'month');

    const periodStats = {
      bidsOut: await Bids.bidDollarsOut({ start, end, months, rep, contractType, market }),
      sales: await Bids.salesTotalForPeriod({ start, end, months, rep, contractType, market }),
      newCustomers: await Customers.countCreatedInPeriod({ start, end, months, rep, market }),
      newLeads: await Bids.countCreatedInPeriod({ start, end, months, rep, contractType, market }),
    };
    const killRatioStat = await Bids.killRatio({ start, end, months, rep, contractType, market });

    const todayStr = new Date().toISOString().slice(0, 10);
    const counts = {
      leads: await Customers.countCustomers({ recordType: 'lead' }),
      customers: await Customers.countCustomers({ recordType: 'customer' }),
      openTasks: (await Tasks.listTasks({ status: 'open', limit: 100000 })).length,
      documents: (await Documents.listDocuments({ limit: 100000 })).length,
      pastDueTasks: (await Tasks.listTasks({ status: 'open', dueBefore: todayStr, limit: 100000 })).length,
    };
    const upcomingTasks = await Tasks.listTasks({ status: 'open', limit: 8 });
    const recentLeadsRaw = await Customers.listCustomers({ recordType: 'lead', limit: 8 });
    const recentLeads = await Promise.all(recentLeadsRaw.map(async (c) => ({ ...c, project_name: await Bids.latestProjectNameForCustomer(c.id) })));

    const dashFilterSelection = months.length ? months : [`preset:${effective.period || 'month'}`];
    sendHtml(res, 200, renderDashboard({
      periodStats, killRatio: killRatioStat, counts, upcomingTasks, recentLeads,
      reps: await allRepOptions(), contractTypes: await Picklists.listItems('contract_type'),
      query: { dash_filter: dashFilterSelection, rep: effective.rep, contract_type: effective.contract_type, market: effective.market },
      flash: flashFromQuery(query),
    }));
  });

  // --- Rep dashboard (each rep's own book of business) --------------------
  router.get('/my-dashboard', async (req, res, params, query) => {
    const user = getCurrentUser();
    const rep = user.rep;
    const cookies = parseCookies(req);
    let effective = null;
    if (query.reset !== undefined) {
      setCookie(res, 'rep_dash_filters', '', { maxAgeDays: 0 });
    } else if (query.dash_submit !== undefined) {
      const picked = toArray(query.dash_filter).filter(Boolean);
      const filterMonths = picked.filter((v) => /^\d{4}-\d{2}$/.test(v));
      const presetPick = picked.find((v) => v.startsWith('preset:'));
      effective = { period: filterMonths.length ? '' : (presetPick ? presetPick.slice('preset:'.length) : 'month'), market: query.market || '', months: filterMonths };
      setCookie(res, 'rep_dash_filters', JSON.stringify(effective));
    } else if (cookies.rep_dash_filters) {
      try { effective = JSON.parse(cookies.rep_dash_filters); } catch { effective = null; }
    }
    // Same default-to-their-own-territory behavior as the manager Dashboard
    // above, for a rep's own dashboard.
    if (!effective) effective = { period: 'month', market: user.market || '', months: [] };
    const filterMonths = Array.isArray(effective.months) ? effective.months.filter(Boolean) : [];
    const market = effective.market || undefined;
    const { start, end } = periodRange(effective.period || 'month');

    const salesStats = {
      bidsOut: await Bids.bidDollarsOut({ start, end, months: filterMonths, rep, market }),
      sales: await Bids.salesTotalForPeriod({ start, end, months: filterMonths, rep, market }),
    };
    const killRatioStat = await Bids.killRatio({ start, end, months: filterMonths, rep, market });
    const openTasks = await Tasks.listTasks({ status: 'open', assignedTo: rep, limit: 200 });
    const upcomingItbs = await Itbs.listUpcoming({ rep, market, limit: 10 });
    const pipelineBids = await Bids.listPipelineBids({ rep, market, limit: 1000 });

    const dashFilterSelection = filterMonths.length ? filterMonths : [`preset:${effective.period || 'month'}`];
    sendHtml(res, 200, renderRepDashboard({
      user, salesStats, killRatio: killRatioStat, openTasks, upcomingItbs, pipelineBids,
      query: { dash_filter: dashFilterSelection, market: effective.market },
      flash: flashFromQuery(query),
    }));
  });

  // --- Customers -----------------------------------------------------------
  router.get('/customers', async (req, res, params, query) => {
    const filters = { recordType: query.type, stage: query.stage, state: query.state, branch: query.branch, market: query.market, q: query.q };
    const items = await Customers.listCustomers(filters);
    const total = await Customers.countCustomers(filters);
    sendHtml(res, 200, renderCustomerList({ items, total, query, flash: flashFromQuery(query) }));
  });

  router.get('/customers/new', async (req, res, params, query) => {
    sendHtml(res, 200, renderCustomerForm({ customer: null, salesReps: await Picklists.listItems('sales_rep'), flash: flashFromQuery(query) }));
  });

  router.post('/customers', async (req, res) => {
    const body = await readFormBody(req);
    const user = getCurrentUser();
    // A rep creating their own new lead/customer -- always assigned to
    // themselves, regardless of what (if anything) the form sent.
    if (user && user.role === 'rep') body.assigned_to = user.rep;
    const item = await Customers.createCustomer(body);
    sendRedirect(res, `/customers/${item.id}?flash=${encodeURIComponent('Created.')}`);
  });

  router.get('/customers/:id/edit', async (req, res, params, query) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    sendHtml(res, 200, renderCustomerForm({ customer, salesReps: await Picklists.listItems('sales_rep'), flash: flashFromQuery(query) }));
  });

  router.get('/customers/:id', async (req, res, params, query) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    const tasks = await Tasks.listTasks({ customerId: params.id });
    const documents = await Documents.listDocuments({ customerId: params.id });
    const bids = await Bids.listBidsLinkedToCustomer(params.id);
    sendHtml(res, 200, renderCustomerDetail({ customer, tasks, documents, bids, flash: flashFromQuery(query) }));
  });

  router.post('/customers/:id', async (req, res, params) => {
    const existing = await Customers.getCustomer(params.id);
    if (!existing) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(existing.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    const user = getCurrentUser();
    // A rep can't reassign their own customer to someone else (or unassign
    // it) by editing the form -- it stays theirs.
    if (user && user.role === 'rep') body.assigned_to = user.rep;
    const item = await Customers.updateCustomer(params.id, body);
    if (!item) return sendHtml(res, 404, '<h1>Not found</h1>');
    sendRedirect(res, `/customers/${params.id}?flash=${encodeURIComponent('Saved.')}`);
  });

  router.post('/customers/:id/delete', async (req, res, params) => {
    const existing = await Customers.getCustomer(params.id);
    if (existing && !canAccessOwner(existing.assigned_to)) return denyAccess(res);
    await Customers.deleteCustomer(params.id);
    sendRedirect(res, `/customers?flash=${encodeURIComponent('Deleted.')}`);
  });

  router.post('/customers/:id/stage', async (req, res, params) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    if (STAGES.some((s) => s.id === body.stage)) {
      await Customers.updateCustomer(params.id, { stage: body.stage });
    }
    sendRedirect(res, '/pipeline');
  });

  // --- Tasks (global list + creation from a customer page) --------------
  router.get('/tasks', async (req, res, params, query) => {
    const user = getCurrentUser();
    // A rep always sees only their own follow-ups here, regardless of any
    // ?assigned_to= in the URL -- this is the same "Follow-ups" tab a
    // manager uses, just automatically scoped rather than filterable.
    const assignedTo = user && user.role === 'rep' ? user.rep : query.assigned_to;
    const items = await Tasks.listTasks({ status: query.status, assignedTo, limit: 500 });
    sendHtml(res, 200, renderTasks({ items, query, isRepView: Boolean(user && user.role === 'rep'), flash: flashFromQuery(query) }));
  });

  router.post('/customers/:id/tasks', async (req, res, params) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    await Tasks.createTask({ ...body, customer_id: Number(params.id), assigned_to: customer.assigned_to || body.assigned_to || '' });
    sendRedirect(res, `/customers/${params.id}?flash=${encodeURIComponent('Task added.')}`);
  });

  router.post('/tasks/:id/toggle', async (req, res, params) => {
    const task = await Tasks.getTask(params.id);
    if (!task) return sendRedirect(res, req.headers.referer || '/tasks');
    if (!canAccessOwner(task.assigned_to)) return denyAccess(res);
    const referer = req.headers.referer || '/tasks';
    if (task.status === 'done') {
      await Tasks.updateTask(params.id, { status: 'open' });
      // Reopening this one wins -- if another task for the same bid got
      // auto-scheduled (or added manually) while this one was done, don't
      // leave both open. See closeOtherOpenTasksForBid.
      await Tasks.closeOtherOpenTasksForBid(task.bid_id, task.id);
      return sendRedirect(res, referer);
    }
    await completeFollowUpTask(task, referer, res);
  });

  router.post('/tasks/:id/delete', async (req, res, params) => {
    const task = await Tasks.getTask(params.id);
    if (task && !canAccessOwner(task.assigned_to)) return denyAccess(res);
    await Tasks.deleteTask(params.id);
    const referer = req.headers.referer || '/tasks';
    sendRedirect(res, referer);
  });

  // Saves per-follow-up notes + an "email sent" flag, editable inline from
  // the Tasks list or a customer's Follow-up tasks card.
  router.post('/tasks/:id/notes', async (req, res, params) => {
    const task = await Tasks.getTask(params.id);
    if (!task) return sendRedirect(res, req.headers.referer || '/tasks');
    if (!canAccessOwner(task.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    await Tasks.updateTask(params.id, { notes: body.notes || '', email_sent: body.email_sent ? 1 : 0 });
    const referer = req.headers.referer || '/tasks';
    sendRedirect(res, referer);
  });

  // Schedules the next follow-up after one is completed -- clones the same
  // title/customer/rep/bid link onto a new open task at the given date, so
  // a follow-up cadence (1st FU, 2nd FU, ...) doesn't need re-typing.
  router.post('/tasks/:id/follow-up', async (req, res, params) => {
    const body = await readFormBody(req);
    const original = await Tasks.getTask(params.id);
    const referer = req.headers.referer || '/tasks';
    if (!original || !body.due_date) return sendRedirect(res, referer);
    if (!canAccessOwner(original.assigned_to)) return denyAccess(res);
    // If completing the original already auto-scheduled a next follow-up
    // for this same bid (see completeFollowUpTask), this manual button
    // would otherwise add a second open task on top of it -- reuse that
    // existing open task (just moving its due date) instead of doubling up.
    const existingOpenForBid = original.bid_id ? await Tasks.getOpenTaskForBid(original.bid_id) : null;
    if (existingOpenForBid) {
      await Tasks.updateTask(existingOpenForBid.id, { due_date: body.due_date });
      return sendRedirect(res, referer);
    }
    await Tasks.createTask({
      customer_id: original.customer_id,
      bid_id: original.bid_id,
      title: original.title,
      due_date: body.due_date,
      assigned_to: original.assigned_to,
    });
    sendRedirect(res, referer);
  });

  // --- Bids ------------------------------------------------------------------
  router.get('/customers/:id/bids/new', async (req, res, params, query) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    const customers = await Customers.listCustomers({ limit: 5000 });
    sendHtml(res, 200, renderBidForm({ bid: null, customer, customers, documents: [], picklists: await bidPicklists(), flash: flashFromQuery(query), additionalCustomerIds: [] }));
  });

  router.post('/customers/:id/bids', async (req, res, params) => {
    const customer = await Customers.getCustomer(params.id);
    if (!customer) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(customer.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    const bid = await Bids.createBid({ ...body, customer_id: Number(params.id) });
    const extraIds = extraCustomerIdsFromBody(body, bid.customer_id);
    if (extraIds.length) await Bids.setAdditionalCustomers(bid.id, extraIds);
    const followUpTask = await syncBidFollowUpTask(bid);
    await syncCustomerStageFromBid(bid);
    sendRedirect(res, `/customers/${params.id}?flash=${encodeURIComponent(withFollowUpFlash('Bid added.', followUpTask))}`);
  });

  router.get('/bids/:id/edit', async (req, res, params, query) => {
    const bid = await Bids.getBid(params.id);
    if (!bid) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(bid.rep)) return denyAccess(res);
    const customer = bid.customer_id ? await Customers.getCustomer(bid.customer_id) : null;
    const customers = await Customers.listCustomers({ limit: 5000 });
    const documents = await Documents.listDocuments({ bidId: bid.id });
    const additionalCustomerIds = (await Bids.listAdditionalCustomers(bid.id)).map((c) => c.id);
    sendHtml(res, 200, renderBidForm({ bid, customer, customers, documents, picklists: await bidPicklists(), flash: flashFromQuery(query), additionalCustomerIds }));
  });

  router.post('/bids/:id', async (req, res, params) => {
    const existing = await Bids.getBid(params.id);
    if (!existing) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(existing.rep)) return denyAccess(res);
    const body = await readFormBody(req);
    if (body.customer_id !== undefined) {
      // A blank selection ("no customer yet") explicitly unlinks the bid's
      // customer, rather than leaving it untouched.
      const trimmed = String(body.customer_id).trim();
      if (trimmed === '') {
        body.customer_id = null;
      } else {
        const n = Number(trimmed);
        body.customer_id = Number.isInteger(n) && n > 0 ? n : null;
      }
    }
    const bid = await Bids.updateBid(params.id, body);
    if (!bid) return sendHtml(res, 404, '<h1>Not found</h1>');
    // additional_customer_ids is always present on this form (even as an
    // empty/missing field when nothing's picked), so this fully replaces the
    // additional-customer list every save -- unlike customer_id, there's no
    // "leave untouched" case to worry about here.
    await Bids.setAdditionalCustomers(bid.id, extraCustomerIdsFromBody(body, bid.customer_id));
    const followUpTask = await syncBidFollowUpTask(bid);
    await syncCustomerStageFromBid(bid);
    const redirectTarget = bid.customer_id ? `/customers/${bid.customer_id}` : `/bids/${bid.id}/edit`;
    sendRedirect(res, `${redirectTarget}?flash=${encodeURIComponent(withFollowUpFlash('Bid saved.', followUpTask))}`);
  });

  router.post('/bids/:id/delete', async (req, res, params) => {
    const bid = await Bids.getBid(params.id);
    if (bid && !canAccessOwner(bid.rep)) return denyAccess(res);
    await Bids.deleteBid(params.id);
    sendRedirect(res, bid && bid.customer_id ? `/customers/${bid.customer_id}?flash=${encodeURIComponent('Bid deleted.')}` : `/projects?flash=${encodeURIComponent('Bid deleted.')}`);
  });

  // --- Pipeline ------------------------------------------------------------
  router.get('/pipeline', async (req, res, params, query) => {
    const forecastBids = await Bids.listPipelineBids({ month: query.month, rep: query.rep, market: query.market, limit: 1000 });
    sendHtml(res, 200, renderPipeline({ forecastBids, reps: await allRepOptions(), query, flash: flashFromQuery(query) }));
  });

  // --- Sales -----------------------------------------------------------------
  router.get('/sales', async (req, res, params, query) => {
    const items = await Bids.listWonBids({ month: query.month, rep: query.rep, market: query.market, limit: 1000 });
    const killRatio = await Bids.killRatio({ months: query.month ? [query.month] : undefined, rep: query.rep, market: query.market });
    sendHtml(res, 200, renderSales({ items, killRatio, reps: await allRepOptions(), query, flash: flashFromQuery(query) }));
  });

  // --- Projects (all-bids hub: create without visiting a customer first) ----
  router.get('/projects', async (req, res, params, query) => {
    const items = await Bids.listProjects({ status: query.status, rep: query.rep, contractType: query.contract_type, market: query.market, q: query.q, limit: 1000 });
    sendHtml(res, 200, renderProjectsList({ items, reps: await allRepOptions(), picklists: await bidPicklists(), query, flash: flashFromQuery(query) }));
  });

  router.get('/projects/new', async (req, res, params, query) => {
    const customers = await Customers.listCustomers({ limit: 5000 });
    sendHtml(res, 200, renderProjectForm({ customers, picklists: await bidPicklists(), flash: flashFromQuery(query) }));
  });

  router.post('/projects', async (req, res) => {
    const body = await readFormBody(req);
    if (!body.project_name || !body.project_name.trim()) {
      return sendRedirect(res, `/projects/new?flash=${encodeURIComponent('Project name is required.')}`);
    }
    const currentUser = getCurrentUser();
    // A rep creating their own project can't hand it to another rep by
    // picking a different Estimator -- it's assigned to them either way.
    if (currentUser && currentUser.role === 'rep') body.estimator = currentUser.rep;

    // Leaving both "existing customer" and every new-customer field blank is
    // allowed -- the customer just isn't known yet and can be linked later
    // from the project's edit page (which is where this redirects to below).
    let customerId = body.existing_customer_id ? Number(body.existing_customer_id) : null;
    if (!customerId && (body.first_name || body.last_name || body.company_name)) {
      const newCustomer = await Customers.createCustomer({
        record_type: 'lead',
        stage: 'estimate_sent',
        first_name: body.first_name || '',
        last_name: body.last_name || '',
        company_name: body.company_name || '',
        email: body.email || '',
        phone: body.phone || '',
        city: body.city || '',
        state: body.state || '',
        branch: body.branch || '',
        market: body.market || '',
        assigned_to: body.estimator || '',
      });
      customerId = newCustomer.id;
    }

    const bid = await Bids.createBid({
      customer_id: customerId,
      project_name: body.project_name.trim(), location: body.location || '',
      price: body.price, gm_percent: body.gm_percent, sales_status: body.sales_status,
      estimator: body.estimator, contract_type: body.contract_type, vertical_market: body.vertical_market,
      roof_type: body.roof_type, squares: body.squares, delivered_date: body.delivered_date,
      next_follow_up_date: body.next_follow_up_date, notes: body.notes, market: body.market || '',
    });

    const extraIds = await resolveExtraCustomerIds(body, { assignedTo: body.estimator, market: body.market });
    if (extraIds.length) await Bids.setAdditionalCustomers(bid.id, extraIds.filter((id) => id !== customerId));
    const followUpTask = await syncBidFollowUpTask(bid);
    await syncCustomerStageFromBid(bid);

    const redirectTarget = customerId ? `/customers/${customerId}` : `/bids/${bid.id}/edit`;
    sendRedirect(res, `${redirectTarget}?flash=${encodeURIComponent(withFollowUpFlash('Project created.', followUpTask))}`);
  });

  // --- Bid Calendar / ITBs ---------------------------------------------------
  router.get('/bid-calendar', async (req, res, params, query) => {
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;
    if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
      const [y, m] = query.month.split('-').map(Number);
      if (y && m >= 1 && m <= 12) { year = y; month = m; }
    }
    const weeks = monthGridWeeks(year, month);
    const gridStart = weeks[0][0].date;
    const gridEnd = weeks[weeks.length - 1][6].date;
    const rep = query.rep || undefined;
    const status = query.status || undefined;
    const market = query.market || undefined;

    const itbs = await Itbs.listByRange({ start: gridStart, end: gridEnd, rep, status, market });
    const itbsByDate = {};
    for (const itb of itbs) {
      if (!itbsByDate[itb.due_date]) itbsByDate[itb.due_date] = [];
      itbsByDate[itb.due_date].push(itb);
    }
    const upcoming = await Itbs.listUpcoming({ rep, market, limit: 8 });

    sendHtml(res, 200, renderBidCalendar({
      year, month, weeks, itbsByDate, upcoming,
      reps: await allRepOptions(), statuses: await Picklists.listItems('itb_status'),
      query, flash: flashFromQuery(query),
    }));
  });

  router.get('/bid-calendar/itbs/new', async (req, res, params, query) => {
    const customers = await Customers.listCustomers({ limit: 5000 });
    sendHtml(res, 200, renderItbForm({
      itb: null, linkedCustomerIds: [], customers,
      picklists: await bidPicklists(), reps: await allRepOptions(),
      defaultDate: query.date || '', flash: flashFromQuery(query),
      returnQS: filterQS(query),
    }));
  });

  router.post('/bid-calendar/itbs', async (req, res, params, query) => {
    const body = await readFormBody(req);
    const backQS = filterQS(query);
    if (!body.project_name || !body.due_date) {
      return sendRedirect(res, `/bid-calendar/itbs/new?${backQS}&flash=${encodeURIComponent('Project name and due date are required.')}`);
    }
    const creatingUser = getCurrentUser();
    // A rep creating a new ITB can only create it as their own -- same rule
    // as the update route below.
    if (creatingUser && creatingUser.role === 'rep') body.assigned_to = creatingUser.rep;
    const itb = await Itbs.createItb({
      project_name: body.project_name,
      location: body.location || '',
      due_date: body.due_date,
      received_date: body.received_date || '',
      status: body.status || 'New',
      assigned_to: body.assigned_to || '',
      contract_type: body.contract_type || '',
      vertical_market: body.vertical_market || '',
      market: body.market || '',
      notes: body.notes || '',
      source_subject: body.source_subject || '',
      source_from: body.source_from || '',
      source_received_at: body.source_received_at || '',
    });
    const customerIds = body.customer_ids ? (Array.isArray(body.customer_ids) ? body.customer_ids : [body.customer_ids]) : [];
    if (customerIds.length) await Itbs.setLinkedCustomers(itb.id, customerIds.map(Number));
    sendRedirect(res, `/bid-calendar?${backQS}&flash=${encodeURIComponent('ITB added.')}`);
  });

  // Minimal JSON create used only by the calendar's drag-an-email-in flow --
  // it needs an ITB id to attach the dropped file(s) to right away, before
  // the user has filled in the rest of the form. Registered before the
  // POST /bid-calendar/itbs/:id update route below so "quick" isn't ever
  // matched as an :id.
  router.post('/bid-calendar/itbs/quick', async (req, res) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    if (!body.due_date) return sendJson(res, 422, { error: 'due_date is required' });
    const creatingUser = getCurrentUser();
    const itb = await Itbs.createItb({
      project_name: body.project_name || 'New ITB (from email)',
      due_date: body.due_date,
      status: 'New',
      assigned_to: creatingUser?.role === 'rep' ? creatingUser.rep : (body.assigned_to || ''),
      market: body.market || creatingUser?.market || '',
    });
    sendJson(res, 201, { id: itb.id });
  });

  router.get('/bid-calendar/itbs/:id/convert', async (req, res, params, query) => {
    const itb = await Itbs.getItb(params.id);
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    const linkedCustomers = await Itbs.listLinkedCustomers(params.id);
    const customers = await Customers.listCustomers({ limit: 5000 });
    sendHtml(res, 200, renderConvertItbForm({ itb, linkedCustomers, customers, picklists: await bidPicklists(), flash: flashFromQuery(query) }));
  });

  router.post('/bid-calendar/itbs/:id/convert', async (req, res, params) => {
    const itb = await Itbs.getItb(params.id);
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    if (!body.primary_customer_id) {
      return sendRedirect(res, `/bid-calendar/itbs/${params.id}/convert?flash=${encodeURIComponent('Pick a primary customer first.')}`);
    }
    const convertingUser = getCurrentUser();
    if (convertingUser && convertingUser.role === 'rep') body.estimator = convertingUser.rep;
    const primaryId = Number(body.primary_customer_id);
    const bid = await Bids.createBid({
      customer_id: primaryId,
      itb_id: Number(params.id),
      project_name: (body.project_name && body.project_name.trim()) || itb.project_name,
      location: body.location || itb.location || '',
      price: body.price, gm_percent: body.gm_percent, sales_status: body.sales_status,
      estimator: body.estimator, contract_type: body.contract_type, vertical_market: body.vertical_market,
      roof_type: body.roof_type, squares: body.squares, delivered_date: body.delivered_date,
      next_follow_up_date: body.next_follow_up_date, notes: body.notes, market: body.market || itb.market || '',
    });
    const additionalIds = body.additional_customer_ids
      ? (Array.isArray(body.additional_customer_ids) ? body.additional_customer_ids : [body.additional_customer_ids])
      : [];
    if (additionalIds.length) await Bids.setAdditionalCustomers(bid.id, additionalIds.map(Number).filter((id) => id !== primaryId));
    const followUpTask = await syncBidFollowUpTask(bid);
    await syncCustomerStageFromBid(bid);
    await Itbs.updateItb(params.id, { status: 'Converted' });
    sendRedirect(res, `/customers/${primaryId}?flash=${encodeURIComponent(withFollowUpFlash('Bid created from ITB.', followUpTask))}`);
  });

  router.get('/bid-calendar/itbs/:id/edit', async (req, res, params, query) => {
    const itb = await Itbs.getItb(params.id);
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    const linked = await Itbs.listLinkedCustomers(params.id);
    const customers = await Customers.listCustomers({ limit: 5000 });
    sendHtml(res, 200, renderItbForm({
      itb, linkedCustomerIds: linked.map((c) => c.id), customers,
      picklists: await bidPicklists(), reps: await allRepOptions(),
      defaultDate: '', attachments: await ItbAttachments.listForItb(params.id), flash: flashFromQuery(query),
      returnQS: filterQS(query),
    }));
  });

  router.post('/bid-calendar/itbs/:id', async (req, res, params, query) => {
    const existingItb = await Itbs.getItb(params.id);
    if (!existingItb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(existingItb.assigned_to)) return denyAccess(res);
    const body = await readFormBody(req);
    const backQS = filterQS(query);
    // Defense in depth: the form's own required-field validation should
    // already stop this in a browser, but if project name or due date ever
    // arrive blank anyway (an old record whose date the browser couldn't
    // parse, a non-browser client, etc.) fail loudly with a flash message
    // instead of silently saving a broken record -- see toDateInputValue in
    // form-helpers.js for the pre-fill half of this fix.
    if (!body.project_name || !body.due_date) {
      return sendRedirect(res, `/bid-calendar/itbs/${params.id}/edit?${backQS}&flash=${encodeURIComponent('Project name and due date are required.')}`);
    }
    const itbUser = getCurrentUser();
    // A rep can't hand their own ITB to someone else by changing this field.
    if (itbUser && itbUser.role === 'rep') body.assigned_to = itbUser.rep;
    const itb = await Itbs.updateItb(params.id, {
      project_name: body.project_name,
      location: body.location || '',
      due_date: body.due_date,
      received_date: body.received_date || '',
      status: body.status || 'New',
      assigned_to: body.assigned_to || '',
      contract_type: body.contract_type || '',
      vertical_market: body.vertical_market || '',
      market: body.market || '',
      notes: body.notes || '',
      source_subject: body.source_subject || '',
      source_from: body.source_from || '',
      source_received_at: body.source_received_at || '',
    });
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    const customerIds = body.customer_ids ? (Array.isArray(body.customer_ids) ? body.customer_ids : [body.customer_ids]) : [];
    await Itbs.setLinkedCustomers(itb.id, customerIds.map(Number));
    sendRedirect(res, `/bid-calendar?${backQS}&flash=${encodeURIComponent('Saved.')}`);
  });

  router.post('/bid-calendar/itbs/:id/delete', async (req, res, params, query) => {
    const itb = await Itbs.getItb(params.id);
    if (itb && !canAccessOwner(itb.assigned_to)) return denyAccess(res);
    await Itbs.deleteItb(params.id);
    sendRedirect(res, `/bid-calendar?${filterQS(query)}&flash=${encodeURIComponent('ITB deleted.')}`);
  });

  router.post('/bid-calendar/itbs/:id/reschedule', async (req, res, params) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    if (!body.due_date) return sendJson(res, 422, { error: 'due_date is required' });
    const existing = await Itbs.getItb(params.id);
    if (!existing) return sendJson(res, 404, { error: 'Not found' });
    if (!canAccessOwner(existing.assigned_to)) return denyAccess(res);
    const itb = await Itbs.rescheduleItb(params.id, body.due_date);
    if (!itb) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item: itb });
  });

  // --- ITB email attachments ---------------------------------------------
  router.post('/bid-calendar/itbs/:id/attachments', async (req, res, params, query) => {
    const itb = await Itbs.getItb(params.id);
    if (!itb) return sendJson(res, 404, { error: 'Not found' });
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    let buffer;
    try {
      buffer = await readRawBody(req);
    } catch (err) {
      return sendJson(res, err.statusCode || 400, { error: err.message || 'Upload failed' });
    }
    if (buffer.length === 0) return sendJson(res, 422, { error: 'Empty file' });
    // query.filename is already URL-decoded by the router (URLSearchParams) --
    // decoding it again here would break on a literal "%" in the file name.
    const originalName = query.filename || 'email';
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const item = await ItbAttachments.saveAttachment(itb.id, { originalName, contentType, buffer });
    let gc = null;
    try {
      gc = await scrubEmailForGc(itb, buffer, originalName);
    } catch (err) {
      console.error('GC scrub failed for attachment', item.id, err);
    }
    sendJson(res, 201, { item, gc });
  });

  router.get('/bid-calendar/attachments/:id/download', async (req, res, params) => {
    const attachment = await ItbAttachments.getAttachment(params.id);
    if (!attachment) return sendHtml(res, 404, '<h1>Not found</h1>');
    const itb = await Itbs.getItb(attachment.itb_id);
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    const filePath = path.join(ItbAttachments.ATTACHMENTS_DIR, attachment.stored_filename);
    if (!fs.existsSync(filePath)) return sendHtml(res, 404, '<h1>File missing on disk</h1>');
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': attachment.content_type || 'application/octet-stream',
      'Content-Length': content.length,
      'Content-Disposition': `attachment; filename="${attachment.original_name.replace(/"/g, '')}"`,
    });
    res.end(content);
  });

  router.post('/bid-calendar/itbs/:id/attachments/:attId/delete', async (req, res, params) => {
    const attachment = await ItbAttachments.getAttachment(params.attId);
    if (!attachment || String(attachment.itb_id) !== String(params.id)) {
      return sendHtml(res, 404, '<h1>Not found</h1>');
    }
    const itb = await Itbs.getItb(params.id);
    if (!itb) return sendHtml(res, 404, '<h1>Not found</h1>');
    if (!canAccessOwner(itb.assigned_to)) return denyAccess(res);
    await ItbAttachments.deleteAttachment(params.attId);
    sendRedirect(res, `/bid-calendar/itbs/${params.id}/edit?flash=${encodeURIComponent('Attachment removed.')}`);
  });

  // --- Documents -------------------------------------------------------------
  router.get('/documents', async (req, res, params, query) => {
    const items = await Documents.listDocuments({ docType: query.doc_type, limit: 500 });
    const customers = await Customers.listCustomers({ limit: 1000 });
    sendHtml(res, 200, renderDocuments({ items, customers, query, flash: flashFromQuery(query) }));
  });

  router.post('/documents', async (req, res) => {
    const body = await readFormBody(req);
    await Documents.createDocument({
      ...body,
      customer_id: body.customer_id ? Number(body.customer_id) : null,
      bid_id: body.bid_id ? Number(body.bid_id) : null,
    });
    const referer = req.headers.referer || '/documents';
    sendRedirect(res, referer.includes('?') ? referer : `${referer}?flash=${encodeURIComponent('Document added.')}`);
  });

  router.post('/documents/:id/delete', async (req, res, params) => {
    await Documents.deleteDocument(params.id);
    const referer = req.headers.referer || '/documents';
    sendRedirect(res, referer);
  });

  // --- API key management (UI) ------------------------------------------
  router.get('/settings/api-keys', async (req, res, params, query) => {
    const keys = await ApiKeys.listApiKeys();
    sendHtml(res, 200, renderApiKeys({ keys, newKey: query.newKey || null, flash: flashFromQuery(query) }));
  });

  router.post('/settings/api-keys', async (req, res) => {
    const body = await readFormBody(req);
    const key = await ApiKeys.createApiKey(body.label || '');
    sendRedirect(res, `/settings/api-keys?newKey=${encodeURIComponent(key)}`);
  });

  router.post('/settings/api-keys/:id/delete', async (req, res, params) => {
    await ApiKeys.revokeApiKey(params.id);
    sendRedirect(res, '/settings/api-keys');
  });

  // --- Dropdown list management (UI) --------------------------------------
  router.get('/settings/dropdowns', async (req, res, params, query) => {
    sendHtml(res, 200, renderDropdowns({ picklists: await Picklists.listAll(), flash: flashFromQuery(query) }));
  });

  router.post('/settings/dropdowns/:listKey', async (req, res, params) => {
    const body = await readFormBody(req);
    if (Picklists.LIST_KEYS.includes(params.listKey) && body.label) {
      await Picklists.createItem(params.listKey, body.label, body.weight, body.weight2);
    }
    sendRedirect(res, '/settings/dropdowns');
  });

  // Registered before /settings/dropdowns/:listKey/:id below -- same segment
  // shape, so the specific "reorder" literal has to win the match first.
  router.post('/settings/dropdowns/:listKey/reorder', async (req, res, params) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    if (!Picklists.LIST_KEYS.includes(params.listKey) || !Array.isArray(body.ids)) {
      return sendJson(res, 422, { error: 'Invalid request' });
    }
    await Picklists.reorderItems(params.listKey, body.ids.map(Number));
    sendJson(res, 200, { ok: true });
  });

  router.post('/settings/dropdowns/:listKey/:id', async (req, res, params) => {
    const body = await readFormBody(req);
    await Picklists.updateItem(params.id, { label: body.label, weight: body.weight, weight2: body.weight2 });
    sendRedirect(res, '/settings/dropdowns');
  });

  router.post('/settings/dropdowns/:listKey/:id/delete', async (req, res, params) => {
    await Picklists.deleteItem(params.id);
    sendRedirect(res, '/settings/dropdowns');
  });

  // --- Close days matrix ---------------------------------------------------
  router.get('/settings/close-days', async (req, res, params, query) => {
    const contractTypes = await Picklists.listItems('contract_type');
    const verticalMarkets = await Picklists.listItems('vertical_market');
    sendHtml(res, 200, renderCloseDays({ contractTypes, verticalMarkets, matrix: await CloseDays.getMatrix(), flash: flashFromQuery(query) }));
  });

  router.post('/settings/close-days', async (req, res) => {
    const body = await readFormBody(req);
    const contractTypes = await Picklists.listItems('contract_type');
    const verticalMarkets = await Picklists.listItems('vertical_market');
    const ctById = Object.fromEntries(contractTypes.map((ct) => [ct.id, ct.label]));
    const vmById = Object.fromEntries(verticalMarkets.map((vm) => [vm.id, vm.label]));
    for (const [key, value] of Object.entries(body)) {
      const m = key.match(/^days_(\d+)_(\d+)$/);
      if (!m) continue;
      const ctLabel = ctById[m[1]];
      const vmLabel = vmById[m[2]];
      if (ctLabel && vmLabel) await CloseDays.setRule(ctLabel, vmLabel, value);
    }
    sendRedirect(res, `/settings/close-days?flash=${encodeURIComponent('Saved.')}`);
  });

  // --- Users (logins) -------------------------------------------------------
  router.get('/settings/users', async (req, res, params, query) => {
    sendHtml(res, 200, renderUsers({ users: await Users.listUsers(), reps: await allRepOptions(), flash: flashFromQuery(query) }));
  });

  router.post('/settings/users', async (req, res) => {
    const body = await readFormBody(req);
    if (body.username && body.password && body.display_name) {
      await Users.createUser({
        username: body.username, password: body.password, displayName: body.display_name,
        role: body.role === 'manager' ? 'manager' : 'rep', repLabel: body.rep_label || '',
        market: body.market || 'CA',
      });
    }
    sendRedirect(res, '/settings/users');
  });

  router.post('/settings/users/:id/password', async (req, res, params) => {
    const body = await readFormBody(req);
    if (body.password) await Users.updateUser(params.id, { password: body.password });
    sendRedirect(res, `/settings/users?flash=${encodeURIComponent('Password updated.')}`);
  });

  router.post('/settings/users/:id/market', async (req, res, params) => {
    const body = await readFormBody(req);
    await Users.updateUser(params.id, { market: body.market || 'CA' });
    sendRedirect(res, `/settings/users?flash=${encodeURIComponent('Region updated.')}`);
  });

  router.post('/settings/users/:id/delete', async (req, res, params) => {
    await Users.deleteUser(params.id);
    sendRedirect(res, '/settings/users');
  });
}
