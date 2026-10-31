// Parses a dropped email file (an Outlook .msg, or a plain .eml/raw-MIME
// text file) well enough to pull out a subject/sender/date and a plain-text
// body. This feeds the Bid Calendar's "drag an email in" flow, so it can
// scrub the body for GC (General Contractor) contact info instead of just
// filing the file away as an opaque attachment -- see extractGcInfo below.
//
// Best-effort only, by design: every GC formats their emails differently, so
// nothing here should ever throw on a file it can't fully parse -- a failed
// or partial parse should just mean less got auto-filled, never a broken
// upload. Zero npm dependencies (same rule as the rest of this app), so the
// .msg half of this is a small hand-rolled reader for the OLE2/CFBF compound
// file format Outlook uses -- see parseMsg below for the format notes.

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FREESECT = 0xfffffffa >= 0 ? 0xffffffff : 0xffffffff; // -1 unsigned
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

export function parseEmailFile(buffer, filename = '') {
  try {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
      return parseMsg(buffer);
    }
    return parseEml(buffer.toString('utf8'));
  } catch (err) {
    return emptyParse();
  }
}

function emptyParse() {
  return { subject: '', from: '', fromName: '', fromEmail: '', receivedAt: '', bodyText: '' };
}

// --- .eml / raw MIME ---------------------------------------------------------

function parseEml(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  const headerBlock = splitAt === -1 ? normalized : normalized.slice(0, splitAt);
  const bodyBlock = splitAt === -1 ? '' : normalized.slice(splitAt + 2);
  const headers = parseHeaders(headerBlock);

  const subject = headers.subject || '';
  const from = headers.from || '';
  const { name: fromName, email: fromEmail } = splitFromHeader(from);
  const receivedAt = headers.date || '';

  const bodyText = extractBodyText(headers, bodyBlock);
  return { subject, from, fromName, fromEmail, receivedAt, bodyText };
}

/** Unfolds continuation lines (start with whitespace) and lowercases header names for lookup. */
function parseHeaders(headerBlock) {
  const unfolded = headerBlock.replace(/\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split('\n')) {
    const m = line.match(/^([^:\s][^:]*):\s*(.*)$/);
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return headers;
}

function splitFromHeader(from) {
  if (!from) return { name: '', email: '' };
  const m = from.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '');
    return { name, email: m[2].trim() };
  }
  if (from.includes('@')) return { name: '', email: from.trim() };
  return { name: from.trim(), email: '' };
}

function extractBodyText(headers, bodyBlock) {
  const contentType = headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (boundaryMatch) {
    const part = findMimePart(bodyBlock, boundaryMatch[1]);
    if (part !== null) return part;
    return ''; // multipart we couldn't find a usable part in -- don't guess at raw boundary soup
  }
  const decoded = decodeByEncoding(bodyBlock, headers['content-transfer-encoding'] || '');
  if (/text\/html/i.test(contentType)) return htmlToText(decoded);
  return decoded;
}

/** Walks a multipart body for its boundary, preferring text/plain, falling back to text/html stripped of tags, recursing one level into a nested multipart/alternative part. */
function findMimePart(bodyBlock, boundary) {
  const delimiter = `--${boundary}`;
  const rawParts = bodyBlock.split(delimiter).slice(1, -1); // drop preamble and the closing "--boundary--"
  let htmlFallback = null;
  for (const raw of rawParts) {
    const trimmed = raw.replace(/^\n/, '');
    const splitAt = trimmed.indexOf('\n\n');
    if (splitAt === -1) continue;
    const partHeaders = parseHeaders(trimmed.slice(0, splitAt));
    const partBody = trimmed.slice(splitAt + 2);
    const partType = partHeaders['content-type'] || '';
    const nestedBoundary = partType.match(/boundary="?([^";]+)"?/i);
    if (nestedBoundary) {
      const nested = findMimePart(partBody, nestedBoundary[1]);
      if (nested !== null) return nested;
      continue;
    }
    const decoded = decodeByEncoding(partBody, partHeaders['content-transfer-encoding'] || '');
    if (/text\/plain/i.test(partType)) return decoded;
    if (/text\/html/i.test(partType) && !htmlFallback) htmlFallback = htmlToText(decoded);
  }
  return htmlFallback;
}

function decodeByEncoding(text, encoding) {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') {
    try { return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { return text; }
  }
  if (enc === 'quoted-printable') return decodeQuotedPrintable(text);
  return text;
}

function decodeQuotedPrintable(text) {
  const joined = text.replace(/=\n/g, ''); // soft line breaks
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- .msg (OLE2 / Compound File Binary Format) ------------------------------
//
// A .msg file is an OLE2 "compound file" -- the same container format old
// .doc/.xls files used -- carved into 512-byte sectors (almost always; a
// handful of very old/large files use 4096, which this bails out on rather
// than risk misreading). The header points at a FAT (a chain-linked-list
// over sector indices) and a directory stream listing every storage/stream
// in the file. Outlook stores each MAPI property as its own stream, named
// "__substg1.0_XXXXYYYY" where XXXX is the property tag and YYYY is its type
// (001E = ANSI string, 001F = Unicode string, 0102 = binary). Small streams
// (under 4096 bytes -- true for nearly every property we care about: subject
// and sender lines are short) are packed into a separate "mini stream" with
// its own 64-byte-sector mini-FAT, rather than the regular FAT.
//
// This reader flat-scans every directory entry for a stream name matching
// one of the property tags we want, rather than correctly walking the
// red-black tree of storages/streams -- storages here are Outlook's
// recipient/attachment sub-objects, which use a different set of property
// tags (3001, 3701, 3704, ...) than the message-level ones this cares about
// (0037, 0C1A, 0C1F, 1000, ...), so a flat scan can't accidentally pick up
// the wrong one. That's what keeps this short enough to hand-write at all.
function parseMsg(buffer) {
  const sectorShift = buffer.readUInt16LE(30);
  if (sectorShift !== 9) return emptyParse(); // not a standard 512-byte-sector file -- bail out rather than guess
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = buffer.readUInt16LE(32);
  const miniSectorSize = 1 << miniSectorShift;
  const miniCutoff = buffer.readUInt32LE(56);
  const firstDirSector = buffer.readUInt32LE(48);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const firstDifatSector = buffer.readUInt32LE(68);
  const numFatSectors = buffer.readUInt32LE(44);

  const sectorOffset = (sector) => 512 + sector * sectorSize;
  const readSector = (sector) => buffer.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize);

  // DIFAT: first 109 FAT-sector locations live in the header itself; any
  // more spill into DIFAT sectors (each a chain, last 4 bytes of each
  // pointing at the next DIFAT sector) -- most .msg files never need those.
  const fatSectorLocations = [];
  for (let i = 0; i < 109 && fatSectorLocations.length < numFatSectors; i++) {
    const loc = buffer.readUInt32LE(76 + i * 4);
    if (loc !== ENDOFCHAIN && loc !== FREESECT) fatSectorLocations.push(loc);
  }
  let difatSector = firstDifatSector;
  while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT && fatSectorLocations.length < numFatSectors) {
    const sec = readSector(difatSector);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectorLocations.length < numFatSectors; i++) {
      const loc = sec.readUInt32LE(i * 4);
      if (loc !== ENDOFCHAIN && loc !== FREESECT) fatSectorLocations.push(loc);
    }
    difatSector = sec.readUInt32LE(sectorSize - 4);
  }

  const fatEntriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectorLocations.length * fatEntriesPerSector);
  fatSectorLocations.forEach((sec, idx) => {
    const data = readSector(sec);
    for (let i = 0; i < fatEntriesPerSector; i++) fat[idx * fatEntriesPerSector + i] = data.readUInt32LE(i * 4);
  });

  function readChain(startSector, knownSize) {
    const chunks = [];
    let sector = startSector;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && sector < fat.length && guard < 200000) {
      chunks.push(readSector(sector));
      sector = fat[sector];
      guard++;
    }
    const combined = Buffer.concat(chunks);
    return knownSize !== undefined ? combined.subarray(0, knownSize) : combined;
  }

  // Directory entries: 128 bytes each, packed into the sectors of the
  // directory chain starting at firstDirSector.
  const dirBuffer = readChain(firstDirSector);
  const entryCount = Math.floor(dirBuffer.length / 128);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    const entry = dirBuffer.subarray(i * 128, i * 128 + 128);
    const nameLenBytes = entry.readUInt16LE(64);
    const objectType = entry.readUInt8(66);
    if (objectType === 0) continue; // unused slot
    const nameLen = Math.max(0, nameLenBytes - 2); // byte length excludes the null terminator's 2 bytes... (nameLenBytes includes it)
    const name = entry.subarray(0, Math.min(nameLen, 64)).toString('utf16le');
    const startSector = entry.readUInt32LE(116);
    const sizeLow = entry.readUInt32LE(120);
    entries.push({ name, objectType, startSector, size: sizeLow });
  }

  const root = entries.find((e) => e.objectType === 5);
  let miniStreamBuffer = Buffer.alloc(0);
  let miniFat = new Uint32Array(0);
  if (root && root.size > 0) {
    miniStreamBuffer = readChain(root.startSector, root.size);
    const miniFatBuffer = readChain(firstMiniFatSector);
    miniFat = new Uint32Array(Math.floor(miniFatBuffer.length / 4));
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = miniFatBuffer.readUInt32LE(i * 4);
  }

  function readMiniChain(startSector, size) {
    const chunks = [];
    let sector = startSector;
    let guard = 0;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && sector < miniFat.length && guard < 200000) {
      const off = sector * miniSectorSize;
      chunks.push(miniStreamBuffer.subarray(off, off + miniSectorSize));
      sector = miniFat[sector];
      guard++;
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  function readStream(entry) {
    if (entry.size === 0) return Buffer.alloc(0);
    if (entry.size < miniCutoff) return readMiniChain(entry.startSector, entry.size);
    return readChain(entry.startSector, entry.size);
  }

  const streamsByTag = {}; // "0037" -> { type: '001E'|'001F', data: Buffer }
  for (const entry of entries) {
    if (entry.objectType !== 2) continue; // only plain streams, not storages
    const m = entry.name.match(/^__substg1\.0_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})$/);
    if (!m) continue;
    streamsByTag[m[1].toUpperCase()] = { type: m[2].toUpperCase(), data: readStream(entry) };
  }

  const readString = (tag) => {
    const s = streamsByTag[tag];
    if (!s) return '';
    if (s.type === '001F') return s.data.toString('utf16le').replace(/\0+$/, '');
    if (s.type === '001E') return s.data.toString('latin1').replace(/\0+$/, '');
    return '';
  };

  const subject = readString('0037');
  const senderName = readString('0C1A');
  // 5D01 (PidTagSenderSmtpAddress) is the modern, reliable SMTP address;
  // 0C1F (PidTagSenderEmailAddress) is older and can hold an Exchange
  // "/O=.../CN=..." legacy DN instead of a real address on some servers, so
  // prefer 5D01 and only fall back to 0C1F if that address actually has an "@".
  let senderEmail = readString('5D01');
  if (!senderEmail || !senderEmail.includes('@')) {
    const legacy = readString('0C1F');
    if (legacy.includes('@')) senderEmail = legacy;
  }
  const bodyText = readString('1000');
  const submitTime = readFileTime(streamsByTag['0039']); // PidTagClientSubmitTime

  return {
    subject,
    from: senderName && senderEmail ? `${senderName} <${senderEmail}>` : (senderEmail || senderName),
    fromName: senderName,
    fromEmail: senderEmail,
    receivedAt: submitTime,
    bodyText,
  };
}

/** PidTagClientSubmitTime etc. are a Windows FILETIME: a 64-bit little-endian count of 100ns ticks since 1601-01-01. Returns an ISO string, or '' if the stream isn't there / isn't 8 bytes. */
function readFileTime(stream) {
  if (!stream || !stream.data || stream.data.length !== 8) return '';
  const low = stream.data.readUInt32LE(0);
  const high = stream.data.readUInt32LE(4);
  const ticks = high * 4294967296 + low; // 64-bit value, reassembled as a double (plenty of precision for a date)
  const EPOCH_DIFF_MS = 11644473600000; // ms between 1601-01-01 and 1970-01-01
  const ms = ticks / 10000 - EPOCH_DIFF_MS;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try { return new Date(ms).toISOString(); } catch { return ''; }
}

// --- Heuristic GC (General Contractor) info extraction ----------------------

const COMPANY_SUFFIX = /(?:Inc|LLC|L\.L\.C\.|Corp|Co|Company|Construction|Contracting|Contractors|Builders|Building|Roofing|Group|Enterprises|Services)\.?/;
const COMPANY_LINE = new RegExp(`^[A-Z][A-Za-z0-9&',.\\- ]{1,70}\\b${COMPANY_SUFFIX.source}\\.?\\s*$`);
const PHONE_RE = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Looks for a quoted "forwarded message" header block inside the body text
 * itself -- Outlook, Gmail and Apple Mail all paste one in when forwarding
 * ("From: ... / Sent: ... / To: ... / Subject: ..."). When an ITB invite
 * gets forwarded along before it's dragged onto the calendar, the envelope's
 * own From is whoever did the forwarding (a colleague, a shared inbox, a bid
 * platform's notification address) -- not the GC -- so the GC's real name
 * and address are in here, not in whatever parseEmailFile already pulled out
 * of the top-level sender fields. A bare "From:" matched without a
 * Subject/Sent/Date line nearby is almost certainly just that word
 * appearing in a sentence, not a real quoted header, so that's required too.
 *
 * Split on any of \r\n, lone \r, or \n -- Outlook's own plain-text body
 * (PidTagBody, what .msg files actually hand us) is CRLF-terminated, so a
 * naive split('\n') leaves a trailing \r on every line. That \r then broke
 * the match below silently: JS's `.` doesn't match \r, so "(.+)$" could
 * never reach the true end of a line that still had one, which meant real
 * forwarded Outlook invites never matched here at all and fell straight
 * through to the forwarder's own name/address -- exactly the bug reported
 * (every GC on an ITB showing up as whoever forwarded the invite in).
 */
function findForwardedSender(body) {
  const lines = body.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*From:\s*(.+)$/i);
    if (!m) continue;
    const nearby = lines.slice(i + 1, i + 5).join('\n');
    if (!/^\s*(Sent|Date|Subject|To):/im.test(nearby)) continue;
    return splitFromHeader(m[1].trim());
  }
  return null;
}

/**
 * Best-effort guess at who's bidding this project, from a parsed email.
 * Nothing here is certain -- signature blocks vary wildly -- so this is
 * meant to save Josh the trouble of typing in a new GC by hand, not to be
 * trusted blindly; the ITB keeps the raw subject/sender so he can always
 * double check or correct it. Deliberately returns nothing (no company name,
 * no contact name) rather than guess from a bare email address alone --
 * that used to fall back to inventing a company name out of whichever
 * domain the email happened to arrive from (a bid-platform notification
 * address, a shared inbox, whoever forwarded it along), which is exactly
 * the bug reported: the sending address was getting added as if it were the
 * customer, instead of the actual GC named in the email. Without a real
 * name to go on, scrubEmailForGc (ui-routes.js) leaves the ITB's GC list
 * untouched rather than create a customer out of an address alone.
 */
export function extractGcInfo(parsed) {
  const body = parsed.bodyText || '';
  // A bid-platform notification email's body is mostly tracking links and
  // embedded image URLs (BuildingConnected's invite format is almost all of
  // this) -- those lines can coincidentally contain digit runs that look
  // like a phone number, or get mistaken for other signature-block content,
  // so every scan below skips a line that's clearly a URL rather than real
  // signature text. Also skip a quoted forwarded-header field itself
  // (From:/Sent:/Date:/To:/Subject:/Cc:) -- findForwardedSender already
  // pulls the real sender out of the "From:" line with its own targeted
  // match, so leaving that line in here would let the "To:" line right
  // below it (the recipient -- e.g. whoever the invite was forwarded to)
  // get picked up as if it were the GC's own email instead.
  const lines = body.split('\n').map((l) => l.trim())
    .filter((l) => l && !/https?:\/\//i.test(l) && !/^(From|Sent|Date|To|Subject|Cc|Bcc):/i.test(l));

  const forwarded = findForwardedSender(body);
  const effectiveFromName = (forwarded && forwarded.name) || parsed.fromName || '';
  const effectiveFromEmail = (forwarded && forwarded.email) || parsed.fromEmail || '';

  // Signature blocks are almost always near the bottom -- scanning from the
  // end finds "ABC Roofing Supply, Inc." in a sign-off before it finds an
  // unrelated company name mentioned earlier in the message body.
  let companyName = '';
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 25; i--) {
    if (COMPANY_LINE.test(lines[i])) { companyName = lines[i].replace(/\.$/, ''); break; }
  }

  // A signature block's own email (searched the same tail window, and the
  // same way, as the company name and phone above) is the actual GC
  // contact's address. The envelope's From can't be trusted for this the
  // way it can for "who sent this": plenty of real ITB invites arrive
  // through a bid-notification platform (BuildingConnected, Procore,
  // SmartBid...) whose own sending address becomes parsed.fromEmail -- fine
  // for identifying the message, but not who the GC is. Worse, every GC that
  // happens to invite through the same platform would share that one
  // address, so trusting it here would make scrubEmailForGc's findByEmail
  // lookup (ui-routes.js) collide unrelated GCs onto the same customer
  // record. So a signature-block email wins when one is found.
  let bodyEmail = '';
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 25; i--) {
    const m = lines[i].match(EMAIL_RE);
    if (m) { bodyEmail = m[0]; break; }
  }

  let email = bodyEmail || effectiveFromEmail || '';
  if (!email) {
    const m = body.match(EMAIL_RE);
    if (m) email = m[0];
  }

  let contactName = effectiveFromName || '';
  if (contactName && contactName.includes('@')) contactName = ''; // some clients put the raw address in the name slot
  // BuildingConnected (and similar bid platforms) format a forwarded
  // invite's From line as "Alex Robles (Deacon Construction LLC)" -- the
  // company name is already captured separately above, so strip it back off
  // the contact name rather than storing "Robles (Deacon Construction LLC)"
  // as someone's last name.
  contactName = contactName.replace(/\s*\([^)]*\)\s*$/, '').trim();

  let phone = '';
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 25; i--) {
    const m = lines[i].match(PHONE_RE);
    if (m) { phone = m[1]; break; }
  }

  return { companyName, contactName, email, phone };
}
