import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { after, before, test } from 'node:test';
import postgres from '../src/vendor/postgres-js/index.js';

const FIXTURE_PASSWORD = 'auth-test-password';
let adminSql;
let testSql;
let server;
let baseUrl;
let apiKey;
let users;
let Customers;
let Bids;
let Itbs;
let Tasks;
let Attachments;
let fixture;
let managerCookie;
let repOneCookie;
let repTwoCookie;

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function login(username) {
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: FIXTURE_PASSWORD }),
    redirect: 'manual',
  });
  assert.equal(response.status, 302, `login failed for ${username}`);
  const session = response.headers.get('set-cookie')?.match(/(?:^|,\s*)session=([^;]+)/)?.[1];
  assert.ok(session, `login did not set a session for ${username}`);
  return decodeURIComponent(session);
}

function browserRequest(path, cookie, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('Cookie', `session=${cookie}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
}

function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-API-Key', apiKey);
  return fetch(`${baseUrl}/api/v1${path}`, { ...options, headers });
}

function apiRequestWithKey(path, key) {
  return fetch(`${baseUrl}/api/v1${path}`, { headers: { 'X-API-Key': key } });
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function postForm(path, cookie, values) {
  return browserRequest(path, cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(values),
  });
}

async function jsonRequest(path, cookie, values) {
  return browserRequest(path, cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}

before(async () => {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required to create an isolated authorization test database.');

  const databaseName = `crm_auth_test_${randomUUID().replaceAll('-', '')}`;
  adminSql = postgres(sourceUrl, { max: 1, ssl: 'prefer', onnotice: () => {} });
  await adminSql.unsafe(`CREATE DATABASE "${databaseName}"`);

  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.SESSION_SECRET = `isolated-auth-test-${randomUUID()}`;

  const db = await import('../src/db.js');
  testSql = db.sql;
  users = await import('../src/models/users.js');
  Customers = await import('../src/models/customers.js');
  Bids = await import('../src/models/bids.js');
  Itbs = await import('../src/models/itbs.js');
  Tasks = await import('../src/models/tasks.js');
  Attachments = await import('../src/models/itbAttachments.js');

  const manager = await users.createUser({
    username: 'authorization_manager',
    password: FIXTURE_PASSWORD,
    displayName: 'Authorization Manager',
    role: 'manager',
  });
  const repOne = await users.createUser({
    username: 'authorization_rep_one',
    password: FIXTURE_PASSWORD,
    displayName: 'Authorization Rep One',
    role: 'rep',
    repLabel: 'Rep One',
  });
  const repTwo = await users.createUser({
    username: 'authorization_rep_two',
    password: FIXTURE_PASSWORD,
    displayName: 'Authorization Rep Two',
    role: 'rep',
    repLabel: 'Rep Two',
  });
  const ownCustomer = await Customers.createCustomer({
    record_type: 'lead',
    stage: 'new',
    company_name: 'Authorization Rep One Customer',
    assigned_to: 'Rep One',
    market: 'CA',
  });
  const customer = await Customers.createCustomer({
    record_type: 'lead',
    stage: 'new',
    company_name: 'Authorization Rep Two Customer',
    assigned_to: 'Rep Two',
    market: 'CA',
    notes: 'customer baseline',
  });
  const bid = await Bids.createBid({
    customer_id: customer.id,
    project_name: 'Authorization Rep Two Bid',
    estimator: 'Rep Two',
    market: 'CA',
    notes: 'bid baseline',
  });
  const today = new Date().toISOString().slice(0, 10);
  const itb = await Itbs.createItb({
    project_name: 'Authorization Rep Two ITB',
    due_date: today,
    assigned_to: 'Rep Two',
    market: 'CA',
  });
  const task = await Tasks.createTask({
    customer_id: customer.id,
    bid_id: bid.id,
    title: 'Authorization Rep Two follow-up',
    due_date: today,
    assigned_to: 'Rep Two',
    notes: 'follow-up baseline',
  });
  const attachmentResult = await testSql.unsafe(
    `INSERT INTO itb_attachments (itb_id, stored_filename, original_name, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [itb.id, 'authorization-test-missing-file.eml', 'authorization-test.eml', 'message/rfc822', 0]
  );
  const attachmentId = attachmentResult[0].id;
  apiKey = await (await import('../src/models/apiKeys.js')).createApiKey('authorization test');
  fixture = { manager, repOne, repTwo, ownCustomer, customer, bid, itb, task, attachmentId };

  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('The app exited before the authorization test server became ready.');
    try {
      await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(500) });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ready) throw new Error('The authorization test server did not become ready.');

  managerCookie = await login('authorization_manager');
  repOneCookie = await login('authorization_rep_one');
  repTwoCookie = await login('authorization_rep_two');
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (testSql) await testSql.end({ timeout: 5 });
  if (adminSql && process.env.DATABASE_URL) {
    const testDatabaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
    if (testDatabaseName.startsWith('crm_auth_test_')) {
      await adminSql.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    }
    await adminSql.end({ timeout: 5 });
  }
});

test('browser record URLs allow the manager and assigned rep, but deny another rep', async () => {
  const { customer, bid, itb, ownCustomer } = fixture;

  for (const path of [`/customers/${customer.id}`, `/customers/${customer.id}/edit`]) {
    assert.equal((await browserRequest(path, repOneCookie)).status, 403, path);
    assert.equal((await browserRequest(path, repTwoCookie)).status, 200, path);
    assert.equal((await browserRequest(path, managerCookie)).status, 200, path);
  }
  assert.equal((await browserRequest(`/customers/${ownCustomer.id}`, repOneCookie)).status, 200);

  for (const path of [`/bids/${bid.id}/edit`]) {
    assert.equal((await browserRequest(path, repOneCookie)).status, 403, path);
    assert.equal((await browserRequest(path, repTwoCookie)).status, 200, path);
    assert.equal((await browserRequest(path, managerCookie)).status, 200, path);
  }
  for (const path of [
    `/bid-calendar/itbs/${itb.id}/edit`,
    `/bid-calendar/itbs/${itb.id}/convert`,
  ]) {
    assert.equal((await browserRequest(path, repOneCookie)).status, 403, path);
    assert.equal((await browserRequest(path, repTwoCookie)).status, 200, path);
    assert.equal((await browserRequest(path, managerCookie)).status, 200, path);
  }
});

test('browser customer edits, stage changes, and deletes enforce record ownership', async () => {
  const { customer } = fixture;

  const editResponse = await postForm(`/customers/${customer.id}`, repOneCookie, {
    company_name: 'unauthorized customer change',
    assigned_to: 'Rep One',
  });
  assert.equal(editResponse.status, 403);
  const stageResponse = await postForm(`/customers/${customer.id}/stage`, repOneCookie, { stage: 'won' });
  assert.equal(stageResponse.status, 403);
  assert.equal((await postForm(`/customers/${customer.id}/delete`, repOneCookie, {})).status, 403);

  const unchanged = await Customers.getCustomer(customer.id);
  assert.equal(unchanged.company_name, 'Authorization Rep Two Customer');
  assert.equal(unchanged.stage, 'new');
  assert.equal(unchanged.record_type, 'lead');

  assert.equal((await postForm(`/customers/${customer.id}`, managerCookie, {
    company_name: 'manager customer edit',
  })).status, 302);
  assert.equal((await Customers.getCustomer(customer.id)).company_name, 'manager customer edit');
  assert.equal((await postForm(`/customers/${customer.id}/stage`, managerCookie, { stage: 'contacted' })).status, 302);
  assert.equal((await Customers.getCustomer(customer.id)).stage, 'contacted');
});

test('browser bid writes enforce ownership while managers and assigned reps retain access', async () => {
  const { bid, customer } = fixture;

  assert.equal((await postForm(`/bids/${bid.id}`, repOneCookie, {
    project_name: 'unauthorized bid change',
  })).status, 403);
  assert.equal((await postForm(`/bids/${bid.id}/delete`, repOneCookie, {})).status, 403);
  assert.equal((await postForm(`/customers/${customer.id}/bids`, repOneCookie, {
    project_name: 'unauthorized customer bid',
    estimator: 'Rep One',
  })).status, 403);
  assert.equal((await Bids.getBid(bid.id)).project_name, 'Authorization Rep Two Bid');
  assert.equal((await Bids.listBidsForCustomer(customer.id)).length, 1);

  assert.equal((await postForm(`/bids/${bid.id}`, managerCookie, {
    project_name: 'manager bid edit',
  })).status, 302);
  assert.equal((await Bids.getBid(bid.id)).project_name, 'manager bid edit');
  assert.equal((await browserRequest(`/bids/${bid.id}/edit`, repTwoCookie)).status, 200);
});

test('browser follow-up actions enforce ownership for every write path', async () => {
  const { task } = fixture;
  const actions = [
    [`/tasks/${task.id}/notes`, { notes: 'unauthorized note', email_sent: '1' }],
    [`/tasks/${task.id}/toggle`, {}],
    [`/tasks/${task.id}/delete`, {}],
    [`/tasks/${task.id}/follow-up`, { due_date: '2099-01-01' }],
  ];
  for (const [path, body] of actions) {
    assert.equal((await postForm(path, repOneCookie, body)).status, 403, path);
  }
  const unchanged = await Tasks.getTask(task.id);
  assert.equal(unchanged.notes, 'follow-up baseline');
  assert.equal(unchanged.status, 'open');

  assert.equal((await postForm(`/tasks/${task.id}/notes`, managerCookie, { notes: 'manager note' })).status, 302);
  assert.equal((await Tasks.getTask(task.id)).notes, 'manager note');
  assert.equal((await postForm(`/tasks/${task.id}/notes`, repTwoCookie, { notes: 'rep note' })).status, 302);
  assert.equal((await Tasks.getTask(task.id)).notes, 'rep note');
});

test('ITB edits, reschedules, attachments, and deletes enforce ownership', async () => {
  const { itb, attachmentId } = fixture;
  const nextDate = '2099-02-03';

  assert.equal((await postForm(`/bid-calendar/itbs/${itb.id}`, repOneCookie, {
    project_name: 'unauthorized ITB change',
    due_date: nextDate,
  })).status, 403);
  assert.equal((await jsonRequest(`/bid-calendar/itbs/${itb.id}/reschedule`, repOneCookie, {
    due_date: nextDate,
  })).status, 403);
  assert.equal((await postForm(`/bid-calendar/itbs/${itb.id}/delete`, repOneCookie, {})).status, 403);
  assert.equal((await browserRequest(`/bid-calendar/attachments/${attachmentId}/download`, repOneCookie)).status, 403);
  assert.equal((await postForm(
    `/bid-calendar/itbs/${itb.id}/attachments/${attachmentId}/delete`,
    repOneCookie,
    {},
  )).status, 403);
  assert.equal((await browserRequest(`/bid-calendar/itbs/${itb.id}/attachments?filename=unauthorized.eml`, repOneCookie, {
    method: 'POST',
    headers: { 'Content-Type': 'message/rfc822' },
    body: 'unauthorized upload',
  })).status, 403);

  const unchanged = await Itbs.getItb(itb.id);
  assert.equal(unchanged.project_name, 'Authorization Rep Two ITB');
  assert.equal(unchanged.due_date, new Date().toISOString().slice(0, 10));
  assert.ok(await Attachments.getAttachment(attachmentId));
  const count = await testSql.unsafe('SELECT COUNT(*)::int AS n FROM itb_attachments WHERE itb_id = $1', [itb.id]);
  assert.equal(count[0].n, 1);

  assert.equal((await jsonRequest(`/bid-calendar/itbs/${itb.id}/reschedule`, managerCookie, {
    due_date: nextDate,
  })).status, 200);
  assert.equal((await Itbs.getItb(itb.id)).due_date, nextDate);
  assert.equal((await postForm(`/bid-calendar/itbs/${itb.id}`, managerCookie, {
    project_name: 'manager ITB edit',
    due_date: nextDate,
    status: 'New',
  })).status, 302);
  assert.equal((await Itbs.getItb(itb.id)).project_name, 'manager ITB edit');
});

test('rep-created calendar quick-add ITBs are owned by their creator', async () => {
  const response = await jsonRequest('/bid-calendar/itbs/quick', repOneCookie, {
    project_name: 'Rep quick-created ITB',
    due_date: new Date().toISOString().slice(0, 10),
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await Itbs.getItb(id)).assigned_to, 'Rep One');
  assert.equal((await browserRequest(`/bid-calendar/itbs/${id}/edit`, repOneCookie)).status, 200);
  assert.equal((await browserRequest(`/bid-calendar/itbs/${id}/edit`, repTwoCookie)).status, 403);
});

test('shared bid calendar remains available to reps, including other reps’ ITBs', async () => {
  const response = await browserRequest('/bid-calendar?month=2099-02', repOneCookie);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /manager ITB edit/);
});

test('manager-only aggregate views remain hidden from reps', async () => {
  assert.equal((await browserRequest('/pipeline', repOneCookie)).status, 302);
  assert.equal((await browserRequest('/pipeline', managerCookie)).status, 200);
  assert.equal((await browserRequest('/sales', repOneCookie)).status, 302);
  assert.equal((await browserRequest('/sales', managerCookie)).status, 200);
  assert.equal((await browserRequest('/settings/users', repOneCookie)).status, 302);
  assert.equal((await browserRequest('/settings/users', managerCookie)).status, 200);
});

test('API keys authorize API reads and writes independently of browser sessions', async () => {
  const { customer, bid, itb, task } = fixture;
  const noKey = await fetch(`${baseUrl}/api/v1/customers/${customer.id}`);
  assert.equal(noKey.status, 401);
  assert.equal((await browserRequest(`/api/v1/customers/${customer.id}`, repTwoCookie)).status, 401);
  assert.equal((await browserRequest(`/api/v1/customers/${customer.id}`, managerCookie)).status, 401);
  assert.equal((await apiRequestWithKey(`/customers/${customer.id}`, 'invalid-test-api-key')).status, 401);

  for (const path of [
    `/customers/${customer.id}`,
    `/bids/${bid.id}`,
    `/itbs/${itb.id}`,
    `/tasks/${task.id}`,
  ]) {
    const response = await apiRequest(path);
    assert.equal(response.status, 200, path);
    const data = await response.json();
    assert.ok(data.item, `API key did not return a record for ${path}`);
  }

  const customerUpdate = await apiRequest(`/customers/${customer.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'updated through API key' }),
  });
  assert.equal(customerUpdate.status, 200);
  assert.equal((await Customers.getCustomer(customer.id)).notes, 'updated through API key');

  const bidUpdate = await apiRequest(`/bids/${bid.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'updated through API key' }),
  });
  assert.equal(bidUpdate.status, 200);

  const itbUpdate = await apiRequest(`/itbs/${itb.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'updated through API key' }),
  });
  assert.equal(itbUpdate.status, 200);

  const taskUpdate = await apiRequest(`/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'updated through API key' }),
  });
  assert.equal(taskUpdate.status, 200);
});
