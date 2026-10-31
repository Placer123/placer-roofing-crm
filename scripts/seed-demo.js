// Seeds a handful of demo records so the app isn't empty on first run.
// Safe to run once; running again will add duplicate demo rows, so it
// checks for existing data first.

import { createCustomer, countCustomers } from '../src/models/customers.js';
import { createTask } from '../src/models/tasks.js';
import { createDocument } from '../src/models/documents.js';
import { createBid } from '../src/models/bids.js';
import { createItem, listItems, seedDefaults } from '../src/models/picklists.js';

await seedDefaults();

if ((await countCustomers()) > 0) {
  console.log('Database already has records - skipping demo seed.');
  process.exit(0);
}

// A couple of named reps/estimators so the new dropdowns aren't empty.
for (const name of ['Josh', 'Sam']) {
  if (!(await listItems('sales_rep')).some((i) => i.label === name)) await createItem('sales_rep', name);
  if (!(await listItems('estimator')).some((i) => i.label === name)) await createItem('estimator', name);
}

const demo = [
  {
    record_type: 'lead', stage: 'new', first_name: 'Dana', last_name: 'Ruiz',
    phone: '916-555-0142', email: 'dana.ruiz@example.com', city: 'Roseville', state: 'CA',
    branch: 'Sacramento', source: 'Website form', assigned_to: 'Josh',
    notes: 'Asked about a full re-roof after a hail event.',
  },
  {
    record_type: 'lead', stage: 'contacted', first_name: 'Miguel', last_name: 'Torres',
    phone: '702-555-0198', email: 'mtorres@example.com', city: 'Henderson', state: 'NV',
    branch: 'Las Vegas', source: 'Referral', assigned_to: 'Sam',
  },
  {
    record_type: 'lead', stage: 'estimate_sent', company_name: 'Foothill Storage LLC',
    phone: '530-555-0110', city: 'Auburn', state: 'CA', branch: 'Sacramento',
    source: 'Google Ads', assigned_to: 'Josh',
  },
  {
    record_type: 'customer', stage: 'won', first_name: 'Karen', last_name: 'Lee',
    phone: '916-555-0177', email: 'karen.lee@example.com', city: 'Placer', state: 'CA',
    branch: 'Sacramento', source: 'Referral', assigned_to: 'Josh',
    notes: 'Full tear-off and re-roof completed last season.',
  },
];

const customers = [];
for (const record of demo) {
  customers.push(await createCustomer(record));
}

for (let i = 0; i < demo.length; i++) {
  const record = demo[i];
  const customer = customers[i];
  if (record.stage === 'new' || record.stage === 'contacted') {
    await createTask({
      customer_id: customer.id,
      title: record.stage === 'new' ? 'Schedule initial inspection' : 'Follow up after first call',
      due_date: '',
      assigned_to: record.assigned_to,
    });
  }
  if (record.record_type === 'customer') {
    await createDocument({
      customer_id: customer.id,
      title: 'Signed contract',
      url: 'https://placerroofing.sharepoint.com/example-contract',
      doc_type: 'contract',
    });
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// A spread of bids across open pipeline stages and a couple of won sales,
// so Pipeline / Sales show something meaningful right away.
await createBid({
  customer_id: customers[0].id, // Dana Ruiz
  price: 18500, gm_percent: 32, sales_status: '20%', estimator: 'Josh',
  contract_type: 'Reroof', vertical_market: 'Residential', roof_type: 'Shingle',
  squares: 28, delivered_date: daysAgo(5), next_follow_up_date: '',
});
await createBid({
  customer_id: customers[1].id, // Miguel Torres
  price: 42000, gm_percent: 28, sales_status: '50%', estimator: 'Sam',
  contract_type: 'Reroof', vertical_market: 'Residential', roof_type: 'Tile',
  squares: 45, delivered_date: daysAgo(12), next_follow_up_date: '',
});
await createBid({
  customer_id: customers[2].id, // Foothill Storage LLC
  price: 265000, gm_percent: 22, sales_status: '90%', estimator: 'Josh',
  contract_type: 'New Construction', vertical_market: 'Industrial', roof_type: 'TPO',
  squares: 310, delivered_date: daysAgo(20), next_follow_up_date: '',
});
await createBid({
  customer_id: customers[3].id, // Karen Lee - already a won customer
  price: 21000, gm_percent: 35, sales_status: 'Won', estimator: 'Josh',
  contract_type: 'Reroof', vertical_market: 'Residential', roof_type: 'Shingle',
  squares: 30, delivered_date: daysAgo(90), next_follow_up_date: '',
});

console.log(`Seeded ${demo.length} demo customers and 4 demo bids.`);
// postgres-js keeps its connection pool open, which would otherwise keep
// this one-off script running forever instead of exiting once done.
process.exit(0);
