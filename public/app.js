// Small progressive-enhancement touches. Everything works without JS too.
document.addEventListener('DOMContentLoaded', () => {
  const flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(() => { flash.style.transition = 'opacity 0.4s'; flash.style.opacity = '0'; }, 3000);
  }

  // Auto-focus the search box on list pages for fast keyboard use.
  const searchBox = document.querySelector('.filter-bar input[name="q"]');
  if (searchBox && document.activeElement === document.body) {
    searchBox.focus({ preventScroll: true });
  }

  initBidCalendar();
  prefillItbFormFromDrop();
  initAttachmentDropzones();
  initRepeatRows();
  initSearchableSelects();
  initDropdownReorder();
});

// --- Searchable combobox: turns a plain <select class="js-searchable"> into
// a type-to-filter text box, while leaving the real <select> in the form
// (just visually hidden) so nothing on the server side has to change. -------

function initSearchableSelects(root = document) {
  root.querySelectorAll('select.js-searchable').forEach(enhanceSearchableSelect);
}

function enhanceSearchableSelect(select) {
  if (!select || select.dataset.searchEnhanced) return;
  select.dataset.searchEnhanced = '1';

  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-select';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.classList.add('searchable-select-native');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select-input';
  input.autocomplete = 'off';
  input.placeholder = select.dataset.placeholder || 'Type to search...';

  const list = document.createElement('div');
  list.className = 'searchable-select-list';
  list.hidden = true;

  wrapper.insertBefore(input, select);
  wrapper.appendChild(list);

  function currentOptions() {
    return Array.from(select.options).filter((o) => o.value !== '');
  }

  function labelFor(value) {
    const opt = currentOptions().find((o) => o.value === value);
    return opt ? opt.textContent : '';
  }

  function setInputFromSelect() {
    input.value = select.value ? labelFor(select.value) : '';
  }
  setInputFromSelect();

  function renderList(filterText) {
    const q = filterText.trim().toLowerCase();
    const options = currentOptions();
    const matches = options.filter((o) => !q || o.textContent.toLowerCase().includes(q)).slice(0, 60);
    list.innerHTML = '';

    const blankOption = select.options[0] && select.options[0].value === '' ? select.options[0] : null;
    if (blankOption) {
      const clearItem = document.createElement('div');
      clearItem.className = 'searchable-select-option searchable-select-clear';
      clearItem.textContent = blankOption.textContent || '-- clear --';
      clearItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select.value = '';
        setInputFromSelect();
        list.hidden = true;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.appendChild(clearItem);
    }

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'searchable-select-empty';
      empty.textContent = 'No matches';
      list.appendChild(empty);
    }

    matches.forEach((opt) => {
      const item = document.createElement('div');
      item.className = 'searchable-select-option';
      item.textContent = opt.textContent;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select.value = opt.value;
        setInputFromSelect();
        list.hidden = true;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      list.appendChild(item);
    });

    list.hidden = false;
  }

  input.addEventListener('focus', () => renderList(''));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => {
    // Delay so a click on a list item (mousedown) fires before we hide it.
    setTimeout(() => { list.hidden = true; setInputFromSelect(); }, 150);
  });
}

// --- Dropdown Lists: drag an option row to reorder it (e.g. drag TPO above
// Shingle). Saves the new order immediately on drop via a small JSON POST. --

function initDropdownReorder() {
  document.querySelectorAll('.dropdown-table[data-list-key]').forEach((table) => {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const listKey = table.dataset.listKey;
    let dragging = null;

    tbody.addEventListener('dragstart', (e) => {
      const row = e.target.closest('tr[draggable="true"]');
      if (!row) return;
      dragging = row;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id || '');
      row.classList.add('dragging-row');
    });

    tbody.addEventListener('dragend', () => {
      if (dragging) dragging.classList.remove('dragging-row');
      dragging = null;
    });

    tbody.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const overRow = e.target.closest('tr');
      if (!overRow || overRow === dragging || !overRow.dataset.id) return;
      const rect = overRow.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      tbody.insertBefore(dragging, before ? overRow : overRow.nextSibling);
    });

    tbody.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragging) return;
      saveDropdownOrder(listKey, tbody);
    });
  });
}

async function saveDropdownOrder(listKey, tbody) {
  const ids = Array.from(tbody.querySelectorAll('tr[data-id]')).map((row) => Number(row.dataset.id));
  try {
    await fetch(`/settings/dropdowns/${encodeURIComponent(listKey)}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch (err) {
    alert("Couldn't save the new order — try again.");
  }
}

// --- Additional-customer repeater rows on the New Project form -------------

function initRepeatRows() {
  const container = document.getElementById('extra-customers');
  const addBtn = document.getElementById('add-extra-customer');
  if (!container || !addBtn) return;

  addBtn.addEventListener('click', () => {
    const template = container.querySelector('.repeat-row');
    const clone = template.cloneNode(true);
    clone.querySelectorAll('input').forEach((input) => { input.value = ''; });
    clone.querySelectorAll('select').forEach((select) => { select.value = ''; });
    container.appendChild(clone);
  });

  container.addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove-row')) return;
    const rows = container.querySelectorAll('.repeat-row');
    const row = e.target.closest('.repeat-row');
    if (rows.length > 1) {
      row.remove();
    } else {
      // Keep at least one row -- just clear it instead of removing it.
      row.querySelectorAll('input').forEach((input) => { input.value = ''; });
      row.querySelectorAll('select').forEach((select) => { select.value = ''; });
    }
  });
}

// --- Bid Calendar: drag an ITB card to a new day, or drag an email in ------

function initBidCalendar() {
  const grid = document.querySelector('.calendar-grid');
  if (!grid) return;

  grid.querySelectorAll('.calendar-day').forEach((cell) => {
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      const dateStr = cell.dataset.date;
      const itbId = e.dataTransfer.getData('text/x-itb-id');
      if (itbId) {
        rescheduleItb(itbId, dateStr);
      } else {
        handleExternalDrop(e, dateStr);
      }
    });
  });

  grid.querySelectorAll('.itb-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-itb-id', card.dataset.itbId);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
}

async function rescheduleItb(itbId, dateStr) {
  try {
    const res = await fetch(`/bid-calendar/itbs/${itbId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: dateStr }),
    });
    if (!res.ok) throw new Error('reschedule failed');
    window.location.reload();
  } catch (err) {
    alert("Couldn't move that ITB — try again.");
  }
}

// Dropping something that isn't an ITB card -- e.g. an email dragged from
// Outlook. Outlook's desktop apps hand over an actual file (.msg on Windows,
// often an .eml-ish file on Mac) rather than readable text, so the safest
// thing is to save it as an attachment rather than try to read it as text --
// reading a .msg as text produces binary garbage, not a subject/sender.
// A multi-select drag (several emails at once, e.g. one per GC) comes
// through as multiple files, so every project can get more than one email
// attached from a single drop.
async function handleExternalDrop(e, dateStr) {
  const dt = e.dataTransfer;
  const files = dt.files && dt.files.length > 0 ? Array.from(dt.files) : [];

  if (files.length > 0) {
    await createItbFromDroppedFiles(files, dateStr);
    return;
  }

  // Fallback for drag sources that only hand over text (no file) -- still
  // useful for prefilling the New ITB form from a subject/from/date.
  const rawText = dt.getData('text/plain') || dt.getData('text/rtf') || dt.getData('text/uri-list') || '';
  if (!rawText) {
    alert("Couldn't read anything from what was dropped. Try dragging the email again, or click + New ITB to add it by hand.");
    return;
  }

  const parsed = parseDroppedEmailText(rawText);
  try {
    sessionStorage.setItem('itb_drop_data', JSON.stringify({ ...parsed, raw: rawText }));
  } catch (err) {
    // sessionStorage unavailable/full -- still navigate, form just won't prefill
  }
  const returnParams = new URLSearchParams(location.search);
  returnParams.set('date', dateStr);
  returnParams.set('fromDrop', '1');
  window.location.href = `/bid-calendar/itbs/new?${returnParams.toString()}`;
}

/**
 * Turns a raw dropped-email filename into a readable project name guess --
 * Outlook exports tend to look like "FW_ RE_ Riverbend_Office_Roof_Bid.msg",
 * so this strips the extension, any number of leading Fwd:/Re: markers, and
 * normalizes underscore/dash runs (Outlook's usual space substitute) back to
 * plain spaces. Still just a starting point -- rename it once the ITB opens.
 */
function cleanProjectNameGuess(filename) {
  let name = (filename || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  name = name.replace(/[_]+/g, ' '); // Outlook's usual space substitute in exported filenames
  name = name.replace(/\s{2,}/g, ' ').trim();
  // Strip any number of leading Fwd:/Re:/FW reply-chain markers -- Outlook
  // filenames often drop the colon (just "FW " / "RE "), so match either.
  name = name.replace(/^((fwd?|re|fw)\s*[:\-]?\s+)+/i, '');
  name = name.replace(/\s*-?\s*(message|email)$/i, '');
  name = name.replace(/\s{2,}/g, ' ').trim();
  if (name.length > 120) name = name.slice(0, 120).trim();
  return name || 'New ITB (from email)';
}

/** Creates a stub ITB on the given day, attaches every dropped file to it, then opens it for editing. */
async function createItbFromDroppedFiles(files, dateStr) {
  try {
    const projectNameGuess = cleanProjectNameGuess(files[0].name);
    // If the calendar is currently filtered to a single market (AZ or CA),
    // a new ITB dropped in while that filter is active is almost certainly
    // for that same market -- saves having to set it by hand every time on
    // a calendar that's been filtered down to just one state's work.
    const currentMarket = new URLSearchParams(location.search).get('market') || '';
    const createRes = await fetch('/bid-calendar/itbs/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: projectNameGuess, due_date: dateStr, market: currentMarket }),
    });
    if (!createRes.ok) throw new Error('create failed');
    const { id } = await createRes.json();

    const gcMessages = [];
    for (const file of files) {
      const { gc } = await uploadItbAttachment(id, file);
      const msg = describeGcResult(gc);
      if (msg) gcMessages.push(msg);
    }
    const flash = gcMessages.length ? `New ITB created. ${gcMessages.join(' ')}` : '';
    // Carry the calendar's current filters (month/rep/status/market) along
    // to the new ITB's edit page -- so Save/Delete/"Back to Bid Calendar"
    // from there land back on the same filtered view, not a reset calendar.
    const returnParams = new URLSearchParams(location.search);
    returnParams.delete('flash');
    if (flash) returnParams.set('flash', flash);
    const qs = returnParams.toString();
    window.location.href = `/bid-calendar/itbs/${id}/edit${qs ? `?${qs}` : ''}`;
  } catch (err) {
    alert("Couldn't save the dropped email(s) — try again, or click + New ITB to add it by hand.");
  }
}

/** Uploads one file's raw bytes to an ITB's attachments. Returns { item, gc } -- gc is the server's best-effort guess at who's bidding (see describeGcResult), or null if nothing usable was found in this email. */
async function uploadItbAttachment(itbId, file) {
  const res = await fetch(`/bid-calendar/itbs/${itbId}/attachments?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error('upload failed');
  return res.json();
}

/** Turns an attachment upload's "gc" result into a short, human flash-message fragment -- or '' if there's nothing to say (parsing found no usable GC info, which just means this email's attachment was saved as-is with no auto-linking). */
function describeGcResult(gc) {
  if (!gc) return '';
  if (gc.created) return `Added "${gc.name}" to this project's GC list (detected from the email — double check it).`;
  if (gc.linked) return `Linked existing customer "${gc.name}" as a GC on this project (detected from the email).`;
  return '';
}

// --- Email Attachments dropzone on the ITB edit form ------------------------

function initAttachmentDropzones() {
  document.querySelectorAll('.attachment-dropzone').forEach((zone) => {
    const itbId = zone.dataset.itbId;
    const input = zone.querySelector('.attachment-file-input');

    zone.addEventListener('click', () => input && input.click());
    if (input) {
      input.addEventListener('change', () => {
        if (input.files.length > 0) uploadAndReload(itbId, Array.from(input.files));
      });
    }

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files && e.dataTransfer.files.length > 0 ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) uploadAndReload(itbId, files);
    });
  });
}

async function uploadAndReload(itbId, files) {
  try {
    const gcMessages = [];
    for (const file of files) {
      const { gc } = await uploadItbAttachment(itbId, file);
      const msg = describeGcResult(gc);
      if (msg) gcMessages.push(msg);
    }
    const url = new URL(window.location.href);
    url.searchParams.set('flash', gcMessages.length ? gcMessages.join(' ') : 'Email attached.');
    window.location.href = url.toString();
  } catch (err) {
    alert("Couldn't upload that file — try again.");
  }
}

function parseDroppedEmailText(text) {
  const subjectMatch = text.match(/^Subject:\s*(.+)$/im);
  const fromMatch = text.match(/^From:\s*(.+)$/im);
  const dateMatch = text.match(/^Date:\s*(.+)$/im);
  return {
    subject: subjectMatch ? subjectMatch[1].trim() : '',
    from: fromMatch ? fromMatch[1].trim() : '',
    receivedAt: dateMatch ? dateMatch[1].trim() : '',
  };
}

function prefillItbFormFromDrop() {
  const form = document.querySelector('form.itb-form');
  if (!form) return;
  const params = new URLSearchParams(location.search);
  if (params.get('fromDrop') !== '1') return;

  let raw;
  try {
    raw = sessionStorage.getItem('itb_drop_data');
    sessionStorage.removeItem('itb_drop_data');
  } catch (err) {
    return;
  }
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    if (data.subject && form.elements['project_name'] && !form.elements['project_name'].value) {
      form.elements['project_name'].value = data.subject;
    }
    if (form.elements['source_subject']) form.elements['source_subject'].value = data.subject || '';
    if (form.elements['source_from']) form.elements['source_from'].value = data.from || '';
    if (form.elements['source_received_at']) form.elements['source_received_at'].value = data.receivedAt || '';
    if (data.raw && form.elements['notes'] && !form.elements['notes'].value) {
      form.elements['notes'].value = data.raw.slice(0, 4000);
    }
    const banner = document.querySelector('.drop-banner');
    if (banner) banner.hidden = false;
  } catch (err) {
    // malformed staged data -- ignore, user fills the form manually
  }
}
