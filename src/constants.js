// Pipeline stages for leads moving toward becoming a customer.
export const STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'estimate_sent', label: 'Estimate Sent' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

export const DOC_TYPES = ['plan', 'spec', 'proposal', 'contract', 'permit', 'photo', 'estimate', 'invoice', 'other'];

export const TASK_STATUSES = ['open', 'done'];

// Which state's book of business a customer/bid/ITB belongs to -- separate
// from a customer's own mailing-address State field (US_STATES below): a
// California-based GC could still be bidding an Arizona job, so this is set
// explicitly on each record rather than derived from an address. Fixed to
// two values for now (the company operates in CA and is expanding into AZ);
// add a third here and everywhere this is imported stays a plain dropdown,
// no further changes needed, since it's not an editable Dropdown List like
// Contract Type -- it's closer to the role field on a user account.
export const MARKETS = ['CA', 'AZ'];

// U.S. states/territories used for branch + address dropdowns.
export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];
