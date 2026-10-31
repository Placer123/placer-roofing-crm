import { sendJson, readJsonBody } from '../http-helpers.js';
import { isAuthorized } from '../apiAuth.js';
import * as Customers from '../models/customers.js';
import * as Tasks from '../models/tasks.js';
import * as Documents from '../models/documents.js';
import * as Bids from '../models/bids.js';
import * as Picklists from '../models/picklists.js';
import * as CloseDays from '../models/closeDays.js';
import * as Itbs from '../models/itbs.js';
import { STAGES, DOC_TYPES, TASK_STATUSES, US_STATES } from '../constants.js';
import { periodRange } from '../period.js';

/** Registers /api/v1/* routes on the given Router. Every route here requires an API key. */
export function registerApiV1(router) {
  const guard = (handler) => async (req, res, params, query) => {
    if (!(await isAuthorized(req))) {
      return sendJson(res, 401, { error: 'Missing or invalid API key. Send it as X-API-Key or Authorization: Bearer <key>.' });
    }
    try {
      await handler(req, res, params, query);
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.message || 'Internal error' });
    }
  };

  // --- Meta -----------------------------------------------------------
  router.get('/api/v1/meta', guard(async (req, res) => {
    sendJson(res, 200, { stages: STAGES, docTypes: DOC_TYPES, taskStatuses: TASK_STATUSES, states: US_STATES });
  }));

  router.get('/api/v1/pipeline/summary', guard(async (req, res) => {
    sendJson(res, 200, { stages: await Customers.pipelineSummary() });
  }));

  // --- Customers / Leads ------------------------------------------------
  router.get('/api/v1/customers', guard(async (req, res, params, query) => {
    const filters = {
      recordType: query.type,
      stage: query.stage,
      state: query.state,
      branch: query.branch,
      market: query.market,
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    };
    const items = await Customers.listCustomers(filters);
    const total = await Customers.countCustomers(filters);
    sendJson(res, 200, { items, total });
  }));

  router.get('/api/v1/customers/:id', guard(async (req, res, params) => {
    const item = await Customers.getCustomer(params.id);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.post('/api/v1/customers', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.first_name && !body.last_name && !body.company_name) {
      return sendJson(res, 422, { error: 'first_name, last_name, or company_name is required' });
    }
    const item = await Customers.createCustomer(body);
    sendJson(res, 201, { item });
  }));

  router.patch('/api/v1/customers/:id', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const item = await Customers.updateCustomer(params.id, body);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.delete('/api/v1/customers/:id', guard(async (req, res, params) => {
    const ok = await Customers.deleteCustomer(params.id);
    if (!ok) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { ok: true });
  }));

  router.get('/api/v1/customers/:id/tasks', guard(async (req, res, params) => {
    sendJson(res, 200, { items: await Tasks.listTasks({ customerId: params.id }) });
  }));

  router.get('/api/v1/customers/:id/documents', guard(async (req, res, params) => {
    sendJson(res, 200, { items: await Documents.listDocuments({ customerId: params.id }) });
  }));

  // --- Tasks / Follow-ups -----------------------------------------------
  router.get('/api/v1/tasks', guard(async (req, res, params, query) => {
    const items = await Tasks.listTasks({
      customerId: query.customer_id,
      status: query.status,
      assignedTo: query.assigned_to,
      dueBefore: query.due_before,
      limit: query.limit,
      offset: query.offset,
    });
    sendJson(res, 200, { items });
  }));

  router.get('/api/v1/tasks/:id', guard(async (req, res, params) => {
    const item = await Tasks.getTask(params.id);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.post('/api/v1/tasks', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.title) return sendJson(res, 422, { error: 'title is required' });
    const item = await Tasks.createTask(body);
    sendJson(res, 201, { item });
  }));

  router.patch('/api/v1/tasks/:id', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const item = await Tasks.updateTask(params.id, body);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.delete('/api/v1/tasks/:id', guard(async (req, res, params) => {
    const ok = await Tasks.deleteTask(params.id);
    if (!ok) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { ok: true });
  }));

  // --- Documents ----------------------------------------------------------
  router.get('/api/v1/documents', guard(async (req, res, params, query) => {
    const items = await Documents.listDocuments({ customerId: query.customer_id, docType: query.doc_type });
    sendJson(res, 200, { items });
  }));

  router.post('/api/v1/documents', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.title || !body.url) return sendJson(res, 422, { error: 'title and url are required' });
    const item = await Documents.createDocument(body);
    sendJson(res, 201, { item });
  }));

  router.delete('/api/v1/documents/:id', guard(async (req, res, params) => {
    const ok = await Documents.deleteDocument(params.id);
    if (!ok) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { ok: true });
  }));

  // --- Picklists (dropdown lists) -----------------------------------------
  router.get('/api/v1/picklists', guard(async (req, res) => {
    sendJson(res, 200, { lists: await Picklists.listAll() });
  }));

  router.get('/api/v1/picklists/:listKey', guard(async (req, res, params) => {
    if (!Picklists.LIST_KEYS.includes(params.listKey)) return sendJson(res, 404, { error: 'Unknown list' });
    sendJson(res, 200, { items: await Picklists.listItems(params.listKey) });
  }));

  router.post('/api/v1/picklists/:listKey', guard(async (req, res, params) => {
    if (!Picklists.LIST_KEYS.includes(params.listKey)) return sendJson(res, 404, { error: 'Unknown list' });
    const body = await readJsonBody(req);
    if (!body.label) return sendJson(res, 422, { error: 'label is required' });
    const item = await Picklists.createItem(params.listKey, body.label, body.weight);
    sendJson(res, 201, { item });
  }));

  // --- Bids ---------------------------------------------------------------
  router.get('/api/v1/bids', guard(async (req, res, params, query) => {
    if (query.customer_id) return sendJson(res, 200, { items: await Bids.listBidsForCustomer(query.customer_id) });
    sendJson(res, 200, { items: await Bids.listAllBids({ limit: query.limit, offset: query.offset }) });
  }));

  router.get('/api/v1/bids/:id', guard(async (req, res, params) => {
    const item = await Bids.getBid(params.id);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.post('/api/v1/bids', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.customer_id) return sendJson(res, 422, { error: 'customer_id is required' });
    const item = await Bids.createBid(body);
    sendJson(res, 201, { item });
  }));

  router.patch('/api/v1/bids/:id', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const item = await Bids.updateBid(params.id, body);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.delete('/api/v1/bids/:id', guard(async (req, res, params) => {
    const ok = await Bids.deleteBid(params.id);
    if (!ok) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { ok: true });
  }));

  // --- Sales & pipeline forecast summaries --------------------------------
  router.get('/api/v1/sales', guard(async (req, res, params, query) => {
    const items = await Bids.listWonBids({ month: query.month, rep: query.rep, market: query.market, limit: query.limit, offset: query.offset });
    const totalPrice = items.reduce((sum, b) => sum + (b.price || 0), 0);
    const totalGm = items.reduce((sum, b) => sum + (b.gm_dollars || 0), 0);
    sendJson(res, 200, { items, totals: { count: items.length, totalPrice, totalGm } });
  }));

  router.get('/api/v1/pipeline/forecast', guard(async (req, res, params, query) => {
    const items = await Bids.listPipelineBids({ month: query.month, rep: query.rep, market: query.market, limit: query.limit, offset: query.offset });
    const totalPrice = items.reduce((sum, b) => sum + (b.price || 0), 0);
    const totalWeighted = items.reduce((sum, b) => sum + (b.weighted_value || 0), 0);
    sendJson(res, 200, { items, totals: { count: items.length, totalPrice, totalWeighted } });
  }));

  // --- Dashboard (period + rep) --------------------------------------------
  router.get('/api/v1/dashboard', guard(async (req, res, params, query) => {
    const { start, end } = periodRange(query.period || 'month');
    const rep = query.rep || undefined;
    const contractType = query.contract_type || undefined;
    const market = query.market || undefined;
    sendJson(res, 200, {
      period: query.period || 'month',
      range: { start, end },
      bidsOut: await Bids.bidDollarsOut({ start, end, rep, contractType, market }),
      sales: await Bids.salesTotalForPeriod({ start, end, rep, contractType, market }),
      newCustomers: await Customers.countCreatedInPeriod({ recordType: 'customer', start, end, rep, market }),
      newLeads: await Customers.countCreatedInPeriod({ recordType: 'lead', start, end, rep, market }),
    });
  }));

  // --- Bid <-> additional customers (multi-customer / New Construction) ---
  router.get('/api/v1/bids/:id/customers', guard(async (req, res, params) => {
    sendJson(res, 200, { items: await Bids.listAdditionalCustomers(params.id) });
  }));

  router.post('/api/v1/bids/:id/customers', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.customer_ids) ? body.customer_ids : [];
    await Bids.setAdditionalCustomers(params.id, ids);
    sendJson(res, 200, { items: await Bids.listAdditionalCustomers(params.id) });
  }));

  // --- ITBs (Bid Calendar) -------------------------------------------------
  router.get('/api/v1/itbs', guard(async (req, res, params, query) => {
    if (query.start && query.end) {
      return sendJson(res, 200, { items: await Itbs.listByRange({ start: query.start, end: query.end, rep: query.rep, status: query.status, market: query.market }) });
    }
    sendJson(res, 200, { items: await Itbs.listUpcoming({ rep: query.rep, market: query.market, limit: query.limit || 100 }) });
  }));

  router.get('/api/v1/itbs/:id', guard(async (req, res, params) => {
    const item = await Itbs.getItb(params.id);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item, customers: await Itbs.listLinkedCustomers(params.id) });
  }));

  router.post('/api/v1/itbs', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.project_name || !body.due_date) {
      return sendJson(res, 422, { error: 'project_name and due_date are required' });
    }
    const item = await Itbs.createItb(body);
    if (Array.isArray(body.customer_ids)) await Itbs.setLinkedCustomers(item.id, body.customer_ids);
    sendJson(res, 201, { item: await Itbs.getItb(item.id) });
  }));

  router.patch('/api/v1/itbs/:id', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const item = await Itbs.updateItb(params.id, body);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    if (Array.isArray(body.customer_ids)) await Itbs.setLinkedCustomers(params.id, body.customer_ids);
    sendJson(res, 200, { item: await Itbs.getItb(params.id) });
  }));

  router.delete('/api/v1/itbs/:id', guard(async (req, res, params) => {
    const ok = await Itbs.deleteItb(params.id);
    if (!ok) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { ok: true });
  }));

  router.post('/api/v1/itbs/:id/reschedule', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    if (!body.due_date) return sendJson(res, 422, { error: 'due_date is required' });
    const item = await Itbs.rescheduleItb(params.id, body.due_date);
    if (!item) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, { item });
  }));

  router.get('/api/v1/itbs/:id/customers', guard(async (req, res, params) => {
    sendJson(res, 200, { items: await Itbs.listLinkedCustomers(params.id) });
  }));

  router.post('/api/v1/itbs/:id/customers', guard(async (req, res, params) => {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.customer_ids) ? body.customer_ids : [];
    await Itbs.setLinkedCustomers(params.id, ids);
    sendJson(res, 200, { items: await Itbs.listLinkedCustomers(params.id) });
  }));

  // --- Close days matrix ---------------------------------------------------
  router.get('/api/v1/close-days', guard(async (req, res) => {
    sendJson(res, 200, { matrix: await CloseDays.getMatrix() });
  }));

  router.post('/api/v1/close-days', guard(async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.contract_type || !body.vertical_market) {
      return sendJson(res, 422, { error: 'contract_type and vertical_market are required' });
    }
    const rule = await CloseDays.setRule(body.contract_type, body.vertical_market, body.days);
    sendJson(res, 200, { rule });
  }));
}
