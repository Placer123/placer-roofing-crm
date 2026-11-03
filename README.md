# Placer Roofing CRM — V1

## Running on Replit

Click **Run** to start the configured workflow on port 5000.
Use Node.js 22.5 or newer; no npm packages need installing.

**The SQLite instructions below describe the original version. The current
code uses PostgreSQL**, through the vendored driver in `src/vendor/postgres-js`.
It requires `DATABASE_URL` (provided by the Replit database) and a stable
`SESSION_SECRET` in Secrets. Never commit either value.

The server initializes the database schema and default dropdowns on startup;
no manual database initialization or demo seed is needed. On a fresh database,
open the preview and create the first manager account on the setup page.

To start manually in the Replit shell:

```bash
PORT=5000 npm run dev
```

See `replit.md` for environment and verification notes.

A lightweight, dependency-free CRM covering the 4 core modules: **Customers/Leads,
Follow-up Tasks, Documents (linked, not stored), and the Sales Pipeline**.

Built as plain Node.js (no npm packages, no build step, no external database
server) so it's easy to run anywhere and easy to bolt an API integration onto.

## Why no dependencies?

Node 22's built-in `node:sqlite` module and built-in `http` server cover
everything V1 needs. That means:

- `npm install` isn't required — clone/copy the folder and run it.
- No Postgres/MySQL server to stand up for V1 (the whole database is one file:
  `data/crm.db`). It's straightforward to swap in Postgres later without
  touching the API or UI layer — only `src/db.js` and the `src/models/*.js`
  query strings would change.
- Nothing to install to reach parity between your Mac and wherever this ends
  up deployed.

## Running it

Requires Node.js 22.5+ (check with `node -v`).

```bash
node scripts/init-db.js      # creates data/crm.db from src/schema.sql
node scripts/seed-demo.js    # optional: adds a few sample leads/tasks so it's not empty
node server.js               # starts the app on http://localhost:3000
```

For auto-restart on file changes during development:

```bash
npm run dev
```

## What's in V1

- **Customers & Leads** — one table covering both; a `stage` field drives the
  pipeline (`new → contacted → estimate_sent → won/lost`), and moving a lead to
  "won" automatically promotes it to a customer record. Includes a `branch`
  field for multi-state/branch tracking, search, and filters by type, stage,
  state, and branch. A brand-new lead always starts at "New" — the Pipeline
  stage field only appears once you're editing a record, since new-lead
  intake is just customer housing, not a stage decision; move it along the
  pipeline from the Pipeline board or the Edit screen.
- **Sales Pipeline** — a Kanban-style board grouped by lead stage with
  one-click stage moves, plus a **Weighted Bid Forecast** section (see below).
- **Follow-up Tasks** — open/done tasks tied to a customer, with due dates and
  an assigned rep; a global `/tasks` view across everyone. Setting a "Next
  Follow-up Date" on a bid (Projects, a customer's Bids, or converting an
  ITB) automatically creates or updates that bid's follow-up task — no
  re-typing the title/date by hand. Once a follow-up is marked done, a
  "+ Next follow-up" control appears right there to schedule the next one
  with the same title/rep, so a follow-up cadence (1st, 2nd, 3rd...) is just
  picking the next date each time.
- **Documents** — not file storage. Each record is a title + a link (paste in
  a SharePoint/OneDrive URL) tagged by type (plan, spec, proposal, contract,
  permit, estimate, invoice, photo, other), tied to a customer and/or a
  specific bid/project — a project's edit page has its own Documents section
  for plans, specs, and proposals, alongside the one on a customer's detail
  page. This matches the "CRM app → SharePoint" architecture from the
  original plan: files live in SharePoint, this just indexes them.
- **Bids** — the pricing/estimate record for a specific job, now identified
  by **Project Name** first (with a Location field alongside it) rather than
  by whichever customer it's under — a customer can have more than one
  project over time, and a project can involve more than one customer/GC
  (see Projects below), so the project name is what actually identifies the
  job everywhere in the app: Projects, the customer's Bids list, Pipeline,
  and Sales all lead with the project name, showing the customer/GC
  underneath it. Older bids created before this field existed just fall back
  to showing the customer's name until you add a project name to them.
  Fields: Project Name, Location, Price, GM % (GM $ is shown alongside,
  computed automatically), Sales Status, Estimator, Contract Type, Vertical
  Market Type, Roof Type, Squares, Delivered Date, Next Follow-up Date,
  Notes. **Estimator uses the same list as Sales Rep** — one dropdown of
  people covers both roles instead of maintaining two lists.
- **Projects tab** (`/projects`) — the fastest way to start a new bid: name
  the project and its location first, then search-and-pick an existing
  customer (type to filter — company names show alongside personal names) or
  fill in a new one right there, fill in the bid details (including
  Estimator — there's no separate "assigned rep" field on this form anymore,
  since it duplicated Estimator), and link any number of **additional
  customers** for a New Construction project with more than one
  owner/GC/stakeholder — each row lets you either pick an existing customer
  or type a brand-new name/company to create one on the spot, and "+ Add
  another customer" adds more rows. Also lists every project across every
  customer, with a search box (project name, location, or customer) plus
  filters by status, contract type, and rep. Adding a bid from a customer's
  own detail page still works too, and editing any bid now lets you change
  which customer it's linked to. ITBs on the Bid Calendar already carry a
  project name and location of their own, which flow straight into the Bid
  when you convert one.
- **Sales tab** — every bid whose Sales Status is "Won" (100%), filterable by
  month (of the bid's delivered date) and rep, with totals for count, total
  price, total GM $, and average GM %.
- **Dashboard** — Bid $ Out and Sales $ (switchable between This Week / This
  Month / Year to Date, or pick one or more **specific months** directly),
  plus New Customers Added, New Opportunities Posted, and **Kill Ratio**
  (Won / (Won + Lost)) for the same period, filterable by rep and by
  **Contract Type** (Reroof / New Construction / Service, or every type
  combined). Each $ tile shows its bid count right underneath. "Bid $ Out"
  totals every bid delivered in the period regardless of status (bidding
  activity/volume); "Sales $" is the same period's Won bids only. "New
  Customers Added" counts every new customer/lead record created in the
  period (including ones created on the fly from Projects setup); "New
  Opportunities Posted" counts every new project/bid created in the period.
  Your filter picks (period, months, rep, contract type) are remembered as
  you move between tabs — use Reset to clear them back to defaults. Upcoming
  Follow-ups and Recent Leads both lead with the project name when one's
  linked, same as everywhere else in the app.
- **Dropdown Lists** (`/settings/dropdowns`) — the one place to manage every
  dropdown's options: Contract Type, Vertical Market Type, Roof Type, Sales
  Status, Sales Rep (also used for Estimator), ITB Status. Add, rename, or
  delete options here; deleting one doesn't touch records that already used
  it, it just won't be offered again. Two of these lists carry a number
  beyond their label because the forecast math depends on it:
  - **Contract Type** — default "forecast days": how many days after a bid's
    delivered date it typically closes (defaults: Reroof = 60, New
    Construction = 120). Overridden per vertical market on the Close Days
    page below.
  - **Sales Status** — "win probability %": defaults are 20% / 50% / 90% /
    Won (100%) / Lost (0%). Add more in-between stages any time.
- **Close Days** (`/settings/close-days`) — a Contract Type × Vertical Market
  grid to fine-tune forecast days beyond the Contract Type default (e.g.
  Reroof + Residential closes faster than Reroof + Commercial). Leave a cell
  blank to fall back to that contract type's default. Recalculates every
  existing bid's expected close date immediately — nothing is fixed at the
  time a bid was created.

- **Bid Calendar** (`/bid-calendar`) — a real month-grid calendar for
  incoming **ITBs** (Invitations to Bid). An ITB is a separate, earlier-stage
  record than a Bid: it's the "we've been invited to bid this" stage, tracked
  from the moment it comes in until you either submit a priced Bid for it or
  decline. Fields: project/job name, due date, received date, status (New /
  Reviewing / Bidding / Declined / Converted — editable in Dropdown Lists),
  assigned rep, Contract Type, Vertical Market, Notes, and any number of
  linked customers/GCs (some projects get shopped through more than one
  general contractor at once — all of them show on the card).
  - **Drag to reschedule** — drag an ITB's card from one day to another on
    the calendar and it saves immediately.
  - **Drag an email in** — drag an email (or several at once — select
    multiple in Outlook first, e.g. one per GC) out of the Outlook desktop
    app and drop it on a day. Outlook hands the browser the actual email
    file rather than readable text, so instead of trying to parse it, the
    app saves it as an **email attachment** on a new ITB (named after the
    file for now — rename it once it opens) and takes you straight to that
    ITB's edit page to fill in the rest. Open an attachment any time to
    download the original email and see the links/details inside it.
  - **Email Attachments** section (on an existing ITB) — its own drop zone
    for adding more emails later, which is what handles "a different GC
    sent their own invite for the same project": drag more emails in (or
    click to browse) and they all show up as separate downloadable
    attachments, each removable on its own. Files are stored on disk under
    `data/attachments/` and indexed in the `itb_attachments` table — nothing
    is parsed or altered, so whatever Outlook exports (`.msg`, `.eml`, etc.)
    downloads back exactly as it was dropped.
  - **Convert to Bid** — from an open ITB, "Convert to Bid" carries its
    Contract Type/Vertical Market/Notes over, lets you pick which linked
    customer is primary (the rest come along as additional customers, same
    as a New Construction project), and marks the ITB "Converted" once the
    Bid is created. The resulting Bid remembers which ITB it came from.

### Weighted bid forecast (Pipeline tab)

For every open bid (Sales Status strictly between 0% and 100%):

- **Expected close date** = Delivered Date + that bid's Contract Type
  forecast-days.
- **Weighted value** = Price × Sales Status probability.

The Pipeline tab filters by month (of the *expected close date*) and rep, and
totals the weighted value across whatever's filtered. A bar chart across the
top groups those same open bids by expected-close month, showing Total Bid
Value alongside Weighted Forecast for each month so it's easy to see how much
is really likely to land versus what's technically still in the pipeline.
Change the forecast days or probabilities any time in Dropdown Lists — the
math re-computes on every page load, nothing is baked in at bid-creation
time. (The old per-lead-stage kanban board and stage-count chart are gone —
see "Latest fixes & updates" below. A customer's Stage field itself still
exists and is still editable from the customer's edit page.)

Not in V1 (by design — see Roadmap below): estimates as line-itemized
documents, job/crew scheduling, invoicing, and the actual SharePoint API
integration (right now a "document" is just a pasted link). User
login/roles shipped ahead of schedule — see "Logins & rep dashboards"
below.

### This round's other updates

- **Search-to-pick customer dropdowns** — every "existing customer" dropdown
  that matters most (New Project, converting an ITB, changing a bid's
  customer) is now type-to-filter instead of a giant scroll list, and shows
  the company name alongside the personal name so a GC is easy to spot.
- **Follow-up notes** — every follow-up task (on `/tasks` and on a customer's
  detail page) has a "Notes" disclosure with a notes field and an "Email
  sent" checkbox, saved inline without leaving the page.
- **Reorderable dropdown lists** — drag the handle on any option in
  `/settings/dropdowns` to reorder it (e.g. put TPO above Shingle); saves
  immediately.
- **Pipeline board cards** now lead with the project name (customer
  underneath) and are a bit more compact so more fit on screen at once.

### Latest fixes & updates

- **Fixed: Pipeline "Won"/"Lost" columns showing empty.** A bid's Sales
  Status and a customer's Pipeline stage were two separate fields with
  nothing keeping them in sync — marking a bid "Won" (or "Lost") on the bid
  form didn't move that customer's card on the Pipeline board. Now it does:
  saving a bid with a 100% (Won) or 0% (Lost) Sales Status automatically
  moves its customer to that same Pipeline stage. It only moves it forward
  into Won/Lost — it won't move a customer back out from some unrelated bid
  edit, and it does nothing for a bid with no customer linked yet.
- **Fixed: Kill Ratio formula.** It's now Won bids / total bids delivered in
  the period (matches "won jobs vs. total bid jobs"), not Won / (Won + Lost)
  — that old formula read as artificially high whenever there weren't many
  bids explicitly marked "Lost".
- **Fixed: Sales tab's Avg GM %.** Now dollar-weighted (total GM $ ÷ total
  Price $) instead of a plain average of each bid's GM % — a $500k job
  counts for more than a $5k job now, the way it should.
- **Projects can start with no customer known yet.** New Project no longer
  blocks you if you don't have a customer to attach — leave the Customer
  section blank and fill it in later from the project's edit page (which now
  has a search-to-pick Customer field either way).
- **Dropped-email project names are cleaned up.** Dragging an email onto the
  Bid Calendar strips the file extension, collapses Outlook's usual
  underscore/dash spacing back to normal spaces, and strips repeated
  "FW/RE/Fwd:" reply-chain markers, so you get "Riverbend Office Roof Bid"
  instead of "FW_ RE_ Riverbend_Office_Roof_Bid". Still just a starting
  guess — rename it if needed once the ITB opens. The customer list on a
  quick-created ITB is left blank by design (it gets linked at project
  setup), and dropping several emails at once (from the same GC or
  different ones) still attaches all of them to the one new ITB.
- **Documents moved off their own tab.** The global Documents tab is gone
  from the nav (its page and links still work if you have the URL) — a
  bid/project's edit page now has its own **Documents** section for plans,
  specs, and proposals, alongside the customer detail page's existing one.
  Bid Calendar's email attachments remain the place for the invitation
  emails themselves.
- **Pipeline "Lead Stages" board removed entirely.** In its place, the top of
  the Pipeline tab now shows a Total-Bid-Value-vs-Weighted-Forecast bar chart
  by expected-close month (see "Weighted bid forecast" above) — the existing
  month/rep filters and the Open Bids table underneath are unchanged.
- **Bid Calendar cards are color-coded by sales rep.** Each ITB card gets a
  colored left-edge stripe for whichever rep it's assigned to (a legend runs
  above the calendar), separate from the status badge — status still shows
  where it is in the process, the stripe shows who owns it. Set reps up (and
  their order, which sets their color) in `/settings/dropdowns` → Sales Rep;
  an ITB assigned to a name not in that list, or with no rep at all, shows
  the same neutral gray as "Unassigned."
- **Dashboard's date filter is one dropdown now**, not two. It's a single
  multi-select with three quick ranges (This Week / This Month / Year to
  Date) followed by the current calendar year's months, January first —
  Cmd/Ctrl-click to pick specific months, which overrides the quick range,
  same behavior as before, just one control instead of two.
- **Nav renamed and reordered.** "Customers & Leads" is now just
  **Customers**, and the tab order is Dashboard, Sales, Projects, Pipeline,
  Bid Calendar, Customers, Follow-ups, Dropdown Lists, API Keys.
- **Fixed: ITB rep color not showing everywhere.** The "Upcoming ITBs"
  sidebar list on Bid Calendar now gets the same colored left-edge stripe the
  day-grid cards do (it was missing there before). Also made the rep-name
  match whitespace-tolerant, so an old/typed-in rep name with stray spaces
  still matches its Sales Rep dropdown entry instead of falling back to gray.
- **Saving an edited ITB now returns you to the Bid Calendar** instead of
  back to that ITB's edit page.
- **Dashboard's Kill Ratio now shows a dollar-weighted version alongside the
  existing one.** "Kill Ratio" stays Won bids / total bids delivered (a
  count). The new "Kill Ratio ($)" tile is Won bid $ / total delivered bid $
  for the same period/filters — a big job that dies pulls this one down more
  than a small one does.
- **Real logins, roles, and individual rep dashboards.** This is the big one
  — see "Logins & rep dashboards" below for the full rundown. One-time step
  after this update: the very first page load will send you to `/setup` to
  create the first Manager login, since the app previously had no login at
  all. Nothing else about your existing data changes — every customer, bid,
  ITB, and follow-up you already have is untouched.
- **Reps now have access to the Bid Calendar** (a new "Bid Calendar" tab on
  their nav) — it's a shared team view, so a rep sees every rep's ITBs on
  it, same as a manager does; editing or deleting one is still locked to
  whichever rep it's assigned to. A rep creating a new ITB now always gets
  it assigned to themselves automatically (same rule already in place for
  customers, projects, and bids).
- **Fixed: assigning/saving an ITB's rep, and the "return to calendar"
  redirect, "not working" for reps.** Both actually worked for a manager;
  the real gap was that reps couldn't reach the Bid Calendar page at all
  yet, so saving an ITB sent them to their own dashboard instead — now that
  reps have access (above), this resolves itself.
- **Manager Dashboard's "Upcoming follow-ups" now shows which rep each one's
  assigned to**, not just the task and customer.
- **Fixed: an older ITB's edit page silently refusing to save anything.**
  Root cause: a browser's date field only accepts an exact YYYY-MM-DD value
  — an older ITB's due date (or a bid's Delivered/Next Follow-up date)
  stored in a slightly different format made the date field show blank,
  and since due date is required, the browser silently blocked the entire
  Save with no visible error at all (this is why it looked like nothing was
  wrong with the form, yet nothing happened when you clicked Save). Existing
  dates are now normalized to display correctly no matter how they were
  originally stored, and saving now shows a clear message instead of
  silently failing if a required field is ever still blank.
- **Small "Build" number added to the bottom of every page** so we can
  always confirm at a glance which update is actually running.
- **Fixed for real this time: an older ITB's Save button doing nothing.**
  The date-format fix above was one real cause, but not the only one — the
  ITB form's Project Name and Due Date fields were marked as
  browser-required, and depending on the exact data and browser, that could
  silently block the whole Save with zero visible error (some browsers show
  a tiny warning bubble, some effectively don't). That client-side
  requirement is now removed entirely — the server checks those two fields
  instead, and if either is genuinely missing, you'll get a clear on-screen
  message telling you which one, instead of the page just sitting there.
- **Found and fixed the actual root cause: an ITB with an email attachment
  couldn't be saved at all.** The "Remove" button on each attached email was
  its own mini-form nested inside the main ITB form — nested forms aren't
  legal HTML, and a browser hitting that inner form's closing tag actually
  closes the outer form early, silently stranding the Save button (and
  everything after the Email Attachments section) outside any form at all.
  Clicking Save then does nothing — no error, no request, nothing — which is
  exactly why this only ever hit ITBs that already had an emailed invite
  attached. Confirmed and fixed with an actual browser test, not just the
  server directly, which is why earlier rounds kept missing it.
- **Same underlying issue, found in two more places, both fixed:** editing
  an existing bid's Save button had the identical nested-form problem
  (caused by the "Delete bid" button), and the "Save" button next to any
  option on the Dropdown Lists page (Sales Rep, Contract Type, etc.) was
  sitting in HTML a browser can't parse correctly at all (a form directly
  inside a table row), so **editing or renaming any dropdown option — including
  Sales Rep — never actually saved**, silently, this whole time. That's the
  real explanation for the very first "rep color not working" report from
  this session. Both are fixed and confirmed working with real browser
  tests.
- **Fixed: deleting a bid, or an ITB already converted to a bid, could
  crash with a database error** if that bid still had its auto-created
  follow-up task attached (a side effect of the mandatory follow-up feature
  added this round) — the delete request would just hang with no response.
  Deleting a bid now cleans up its follow-up task with it; deleting a
  converted ITB now unlinks its bid instead of touching it, so the bid and
  its data are untouched.
- **Auto-scheduled follow-ups now say so.** The follow-up-on-every-bid
  feature was actually working correctly the whole time — a follow-up task
  was always being created behind the scenes — but nothing on screen ever
  confirmed it, so it looked like it wasn't there. Adding or saving a bid or
  project, converting an ITB to a bid, and marking a follow-up done now all
  say the actual scheduled date right in the confirmation message, e.g.
  "Bid added. Follow-up scheduled for 2026-10-02."
- **Fixed: a new project's auto-follow-up could land on the wrong rep.**
  Picking an existing customer on a new project/bid, and assigning a
  *different* rep as that bid's Estimator, used to send the follow-up task
  to whoever the customer was already assigned to (its original owner — a
  separate thing from who's actually estimating this particular bid), not
  the rep actually picked on the form. Follow-up tasks now always go to the
  bid's own Estimator; changing a bid's Estimator later now also moves its
  open follow-up task over to match.
- **Bid Calendar emails are now scrubbed for GC contact info automatically.**
  Dragging an email onto the calendar (or onto an existing ITB's Email
  Attachments box) now reads the sender's company/contact info out of the
  email itself and adds them straight to that ITB's "Customers / GCs
  bidding this project" list — dropping a second GC's email onto an
  already-created ITB adds that GC alongside the first, instead of needing
  them added by hand on the Customers page first. This is a best-effort
  read of the email (works on the standard Outlook .msg format as well as
  plain-text/.eml), so it's always worth a quick double check — the ITB
  still keeps the original subject/sender either way.
- **Fixed: a follow-up could stop renewing on a project that was neither
  Won nor Lost.** Completing a follow-up was only supposed to stop
  scheduling the next one once a project was Won, Lost, or past its
  expected close date — but a brand-new project (no Delivered Date yet, so
  no expected close date to compare against) was wrongly treated the same
  as "past its timeline," so its very first follow-up was also its last.
  Follow-ups now keep renewing on schedule for exactly the cases meant to
  keep going — anything that isn't Won, Lost, or genuinely past its
  expected close date.
- **CA / AZ filtering, everywhere.** Every tab that filters by rep or month
  (Dashboard, My Dashboard, Customers, Sales, Pipeline, Projects, Bid
  Calendar) now has a **Region** filter too — CA only, AZ only, or leave it
  blank for both combined. It's a new field directly on each customer, bid,
  and ITB, not reused from the existing Branch field, so a California-based
  GC bidding an Arizona job can be marked AZ without touching its branch.
  Every record from before this update was automatically set to CA on first
  boot, so nothing you already have disappears from view. Note: this is
  separate from the existing **Market** column on Projects/Sales (that one's
  still the Commercial/Residential picklist) — to avoid confusing the two,
  the new CA/AZ field is labeled **Region** everywhere in the app.
- **Bid Calendar is one shared calendar with a Region filter**, not two
  separate calendars — filter it to AZ, CA, or leave it on Combined. Dropping
  a new email onto a calendar already filtered to one region defaults the
  new ITB to that region automatically, since that's almost always what's
  intended.
- **Fixed: dragging an ITB email onto the calendar could add the wrong
  company as the GC.** The GC auto-fill added last round had two related
  bugs. First, if an invite arrived with no real name anywhere in it (just a
  bare notification address), it was inventing a fake company name out of
  whatever domain the email happened to arrive from — so a generic
  "noreply@" notification would get added as if it were the GC itself. That
  guessing is removed entirely; an email with no actual name in it now just
  attaches as a file, same as before this feature existed, instead of
  creating a bogus customer. Second, a signature block's company name was
  being found correctly, but paired with the *sender's* address instead of
  the GC contact's own email from the signature — meaning every invite that
  arrived through the same bid-notification platform (BuildingConnected,
  Procore, and similar plan-room services all do this) could get matched to
  whichever GC happened to use that platform first. Both are fixed: the GC's
  actual name and email are now read from the body/signature, not the
  envelope's sender address. Also added: if an ITB invite gets forwarded
  internally before you drag it onto the calendar, the scrub now digs
  through the forwarded message's own "From:" line to find the real original
  GC, instead of picking up whoever forwarded it along.
- **Fixed: a forwarded ITB email (e.g. Chris forwarding you a BuildingConnected
  invite) was still adding Chris himself as the GC**, with a different GC
  company name attached to his name on each one. The "find the real sender
  inside a forwarded message" fix above didn't actually work on a real
  Outlook email — Outlook's own plain-text body uses Windows-style line
  endings, and the detection missed every one of them because of it, so it
  silently fell back to whoever did the forwarding every time. Also fixed
  two related issues that showed up once real invite emails were tested
  against this: a forwarded GC's email sometimes came out as the recipient's
  address instead of the GC's own (same forwarded-header parsing fix), and
  a company name baked into a display name like "Alex Robles (Deacon
  Construction LLC)" is now split apart correctly instead of landing in the
  last name field. One more: a bid-platform invite's body is mostly tracking
  links and embedded image URLs, which could get mistaken for a phone
  number — those lines are now skipped when scanning for contact info.
- **"Rep" on a bid now means the bid's own Estimator**, not the customer's
  assigned rep — those two used to be assumed the same, but it's common
  to estimate a bid for a customer someone else owns. This was silently
  breaking more than filtering: a rep who was Estimator on a bid, but not
  the owner of its customer, could be denied access to that bid entirely,
  and it wouldn't show up on their My Dashboard or in a Rep-filtered
  Pipeline/Sales/Projects/Dashboard view. All of those now follow the
  Estimator when one's set, falling back to the customer's assigned rep
  only for older bids from before Estimator was in regular use — nothing
  about your existing data needs fixing up, this is just which field gets
  read.
- **Pipeline, Sales, and Projects already had a Rep filter** — the dropdown
  itself wasn't new, it just wasn't filtering by the field the previous bug
  fix made correct until this round.
- **A bid/project can now have more than one customer/GC** without going
  through "Convert ITB to Bid." Every project's edit page has a new
  "Additional customers / GCs" field, the same multi-select already used
  when creating a brand-new project or converting an ITB — pick everyone
  else bidding alongside the primary customer, any time, not just at
  creation.
- **Bid Calendar keeps its filters (month/rep/status/region) in place**
  when you open, create, or drop an email onto an ITB, instead of resetting
  to "everything" the moment you save, delete, or come back. This covers
  every way an ITB leads off the calendar and back: clicking a card, "+ New
  ITB," dropping an email on a day, and the "Back to Bid Calendar" link.
- **Delivered Date now defaults to today** on New Project, New Bid (under a
  customer), and Convert ITB to Bid — still just a plain date field, so it's
  one click to change if you're entering something late. Editing an existing
  bid/project is unaffected; it always shows whatever's actually saved.
- **Logins now have a Region (AZ/CA)**, set on the Users settings page —
  every existing login was defaulted to CA, so AZ reps need that changed
  there once. A login's Region sets which territory their dashboard filters
  to by default (My Dashboard for a rep, the main Dashboard for a manager)
  — the usual Region filter is still right there to switch to the other
  territory or "combined" any time, this just sets the starting view. A
  change here takes effect the next time that person logs in.
- **Fixed: a completed follow-up could look like it never went away.** A bid
  could end up with more than one open follow-up task at once — completing
  one auto-schedules the next, but a manual "+ Next follow-up" or reopening
  an old done one could add a second alongside it — so the dashboard still
  showed a line for that job right after marking the real one done. Every
  way a follow-up task gets created or reopened now keeps a bid down to one
  open follow-up at a time, and any duplicates already sitting in your data
  from before this fix are cleaned up automatically the first time this
  update runs.
- **Follow-up tasks are now clickable by job name** (My Dashboard, the
  Follow-ups tab, and a customer's Follow-up Tasks section) instead of by
  customer name — click through to the bid itself. A "← Back" button on the
  bid/project edit page returns you to exactly where you clicked in from,
  scroll position included.
- **My Dashboard's Current Pipeline and Follow-ups boxes are capped to a
  scrollable window** (roughly 10 rows) instead of growing to fit your
  whole book of business and pushing everything below further down the
  page — the rest is one scroll away, with the column headers staying in
  view as you scroll.

## Logins & rep dashboards

The app now has real accounts instead of being wide open to anyone with the
URL.

- **First run after this update** — loading any page sends you to `/setup`
  (a one-time screen, only reachable while no logins exist yet) to create the
  first login. Make this one a **Manager** — that's you and Chris. After
  that, `/setup` stops working and everyone goes through `/login` instead.
- **Two roles**: **Manager** sees everything, exactly like today — the same
  Dashboard, Sales, Projects, Pipeline, Bid Calendar, Customers, Follow-ups,
  Dropdown Lists, and API Keys tabs, plus a new **Users** tab. **Rep** signs
  into their own `/my-dashboard` instead, and is technically blocked (not
  just steered away) from the manager-only list/aggregate pages and from any
  other rep's customers, bids, and ITBs — opening someone else's record
  directly by URL gets a "Not authorized" page, not the data.
- **Users tab** (`/settings/users`, Managers only) — create a login for each
  rep (name, username, password, and which Sales Rep name it's linked to —
  that link is what scopes their dashboard and their record access), reset
  anyone's password, or delete a login. A rep's login must be linked to their
  Sales Rep picklist entry (`/settings/dropdowns` → Sales Rep) — that's the
  name that has to match on their customers/bids/ITBs for their dashboard to
  find them.
- **My Dashboard** (reps) — their own book of business: Past Due
  Follow-ups, Open Pipeline Bids, Weighted Forecast, Kill Ratio (count and
  $), their own Bid $ Out / Sales $ for the period (same filters as the
  manager Dashboard), their Current Pipeline table, their Upcoming Bids
  (ITBs), and their full Follow-ups list. The manager Dashboard also picked
  up a new "Past Due Follow-ups" tile (all reps combined).
- **Follow-ups are now mandatory, and repeat automatically.** A follow-up
  can't be marked done until it has a note, "Email sent" is checked, or the
  linked project has been marked Won or Lost. Complete one on a project
  that's still open, and the next follow-up is created automatically at that
  project's Contract Type's cadence — no more remembering to re-schedule by
  hand. This also means a follow-up now gets created for every bid
  automatically (previously only if you typed in a Next Follow-up Date). The
  cadence stops auto-renewing once the project's expected close date has
  passed.
- **Follow-up cadence is adjustable per Contract Type** — in
  `/settings/dropdowns` → Contract Type, alongside the existing "forecast
  days" field, there's now a "Follow-up cadence (days)" field (defaults:
  Reroof every 3 days, New Construction and Service every 7 — change any of
  these any time).
- **Not in this round**: dragging an email file directly onto a follow-up
  task the way you can drag one onto the Bid Calendar. The Notes field +
  "Email sent" checkbox on every follow-up (already there, and what
  satisfies the mandatory-completion rule above) covers logging a call or
  email for now — flagged as a possible future add if you want the literal
  drag-and-drop too.

## Integrating with your other app

Since this CRM is meant to be bolted onto an existing app, every module is
also available as a JSON REST API under `/api/v1`, separate from the web UI.

1. Go to **API Keys** in the nav (`/settings/api-keys`) and generate a key, or
   run `node scripts/create-api-key.js "label"` from the command line.
2. Send it on every request as either header:
   - `X-API-Key: <your key>`
   - `Authorization: Bearer <your key>`
3. CORS is wide open on `/api/*` so a browser-based app on a different origin
   can call it directly.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/meta` | Stage list, doc types, task statuses, US states |
| GET | `/api/v1/pipeline/summary` | Lead counts grouped by stage |
| GET | `/api/v1/customers` | Query params: `type`, `stage`, `state`, `branch`, `q`, `limit`, `offset` |
| GET | `/api/v1/customers/:id` | |
| POST | `/api/v1/customers` | JSON body: any customer field |
| PATCH | `/api/v1/customers/:id` | Partial update |
| DELETE | `/api/v1/customers/:id` | |
| GET | `/api/v1/customers/:id/tasks` | |
| GET | `/api/v1/customers/:id/documents` | |
| GET | `/api/v1/tasks` | Query params: `customer_id`, `status`, `assigned_to`, `due_before` |
| POST | `/api/v1/tasks` | Body needs `title`; optional `customer_id`, `bid_id`, `due_date`, `assigned_to`, `notes`, `email_sent` |
| PATCH | `/api/v1/tasks/:id` | |
| DELETE | `/api/v1/tasks/:id` | |
| GET | `/api/v1/documents` | Query params: `customer_id`, `doc_type` |
| POST | `/api/v1/documents` | Body needs `title`, `url`; optional `customer_id`, `doc_type` |
| DELETE | `/api/v1/documents/:id` | |
| GET | `/api/v1/bids` | Query params: `customer_id` (else all bids), `limit`, `offset` |
| GET | `/api/v1/bids/:id` | |
| POST | `/api/v1/bids` | Body needs `customer_id`; see bid fields below |
| PATCH | `/api/v1/bids/:id` | |
| DELETE | `/api/v1/bids/:id` | |
| GET | `/api/v1/sales` | Won bids + totals. Query params: `month` (`YYYY-MM`, by delivered date), `rep` |
| GET | `/api/v1/pipeline/forecast` | Open bids + weighted totals. Query params: `month` (`YYYY-MM`, by expected close date), `rep` |
| GET | `/api/v1/picklists` | All seven dropdown lists at once |
| GET | `/api/v1/picklists/:listKey` | One list's items (`contract_type`, `vertical_market`, `roof_type`, `sales_status`, `estimator`, `sales_rep`, `itb_status`) |
| POST | `/api/v1/picklists/:listKey` | Body needs `label`; optional `weight` |
| GET | `/api/v1/itbs` | With `start`+`end` (`YYYY-MM-DD`): every ITB due in that range (for calendar views). Without them: upcoming open ITBs. Optional `rep`, `status`, `limit` |
| GET | `/api/v1/itbs/:id` | Includes linked `customers` |
| POST | `/api/v1/itbs` | Body needs `project_name`, `due_date`; see ITB fields below. Optional `customer_ids` array |
| PATCH | `/api/v1/itbs/:id` | Partial update; optional `customer_ids` array replaces the linked customers |
| DELETE | `/api/v1/itbs/:id` | |
| POST | `/api/v1/itbs/:id/reschedule` | Body needs `due_date` |
| GET | `/api/v1/itbs/:id/customers` | Linked customers/GCs |
| POST | `/api/v1/itbs/:id/customers` | Body needs `customer_ids` array; replaces the full set |

Customer fields accepted by POST/PATCH: `record_type` (`lead`|`customer`),
`stage`, `first_name`, `last_name`, `company_name`, `email`, `phone`,
`address`, `city`, `state`, `zip`, `branch`, `source`, `assigned_to`, `notes`.

Bid fields accepted by POST/PATCH: `customer_id`, `project_name`,
`location`, `price`, `gm_percent`, `sales_status`, `estimator`,
`contract_type`, `vertical_market`, `roof_type`, `squares`,
`delivered_date`, `next_follow_up_date`, `notes`. Every bid response also
includes the computed `expected_close_date`, `weighted_value`, and
`gm_dollars` fields described above. An `itb_id` is set automatically when a
Bid is created by converting an ITB.

ITB fields accepted by POST/PATCH: `project_name`, `location`, `due_date`,
`received_date`, `status`, `assigned_to`, `contract_type`, `vertical_market`,
`notes`, `source_subject`, `source_from`, `source_received_at` (the last
three capture where a dropped email came from, when there was one).

## Importing your client list

Once you're ready to hand over `Client list.xlsx`, drop it in and tell me the
column names (or just attach it) — I'll write an importer that maps its
columns onto the `customers` table and run it once so your existing clients
show up right away, without wiping anything you've entered manually in the
meantime.

## Project layout

```
server.js              entry point — HTTP server, routing, static files
src/db.js               opens data/crm.db, runs schema.sql on boot
src/schema.sql           table definitions
src/constants.js          pipeline stages, doc types, US states
src/models/               CRUD functions per table (customers, tasks, documents, bids, picklists, apiKeys)
src/api/v1.js             external JSON API (/api/v1/*), API-key protected
src/ui-routes.js          web UI routes (forms, redirects)
src/pages/                server-rendered HTML for each screen
public/                   styles.css, app.js (served as static files)
scripts/                  init-db, seed-demo, create-api-key CLI helpers
```

## Roadmap (matches the phased plan, adjusted for what's already built)

- **Phase 2** — Estimates (line items, totals, PDF/email) and job tracking
  (crew assignment, schedule, status).
- **Phase 3** — Real SharePoint integration (upload/browse from within the
  CRM instead of pasting links). (User accounts/roles shipped ahead of
  schedule — see "Logins & rep dashboards" above.)
- **Phase 4** — Mobile-friendly field crew view.
- **Phase 5** — Reporting dashboards (conversion rates by branch/rep, job
  profitability, etc).

## A note on the database

`node:sqlite` is still an experimental Node API (hence the warning printed on
startup) — stable enough for V1, but worth knowing if we later move this to a
long-running production deployment behind your other app, at which point
swapping to Postgres is a clean, contained change.
