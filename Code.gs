/**
 * Coursework Planner — Google Apps Script back end
 * ------------------------------------------------
 * Stores your assignments in this Google Sheet, checks Canvas every morning,
 * and emails you deadline reminders from your own Gmail.
 *
 * Setup guide: https://miniman7.github.io/coursework-planner/setup.html
 * Your Canvas link is added from the app, so there's nothing to edit here.
 */

// ===== Your settings =====
const PLANNER_URL = 'https://miniman7.github.io/coursework-planner/';
const REMINDER_DAYS = [7, 3, 1, 0]; // Days before a deadline to email you (0 = on the day)
const OVERDUE_DAYS = 3;             // Keep reminding for this many days after a missed deadline
const DAILY_HOUR = 7;               // Hour (UK time) for the morning check and email
// =========================

const TZ = 'Europe/London';
const COLS = ['id', 'title', 'module', 'due', 'url', 'status', 'notes', 'custom'];

/* ---------- one-time setup ---------- */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss && props.getProperty('SHEET_ID')) ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  if (!ss) ss = SpreadsheetApp.create('Coursework Planner'); // standalone script: make the sheet in your Drive
  props.setProperty('SHEET_ID', ss.getId());
  Logger.log('Your sheet: ' + ss.getUrl());

  let sh = ss.getSheetByName('Assignments');
  if (!sh) sh = ss.insertSheet('Assignments');
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.getRange('A:H').setNumberFormat('@'); // keep dates as text so Sheets doesn't reformat them
  sh.setFrozenRows(1);
  let meta = ss.getSheetByName('Meta');
  if (!meta) meta = ss.insertSheet('Meta');
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  let key = props.getProperty('KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 16); props.setProperty('KEY', key); }

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyJob').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(DAILY_HOUR).inTimezone(TZ).create();

  if (feedUrl_()) syncCanvas_();
  Logger.log('Setup complete.');
  Logger.log('YOUR ACCESS KEY:  ' + key);
  const url = ScriptApp.getService().getUrl();
  if (url && /\/exec$/.test(url)) {
    Logger.log('YOUR PHONE LINK (keep it private, it unlocks your planner):');
    Logger.log(PLANNER_URL + '#connect=' + Utilities.base64EncodeWebSafe(url + '|' + key));
  } else {
    Logger.log('Now go back to the setup guide and paste your access key and web app URL into step 5.');
  }
}

/** The Canvas calendar feed link, added from the app's first-run screen. */
function feedUrl_() { return PropertiesService.getScriptProperties().getProperty('FEED_URL') || ''; }

/* ---------- web app (the planner page talks to these) ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== PropertiesService.getScriptProperties().getProperty('KEY')) return json_({ ok: false, error: 'bad key' });
  if (p.action === 'list') return json_({ ok: true, items: readAll_(), meta: Object.assign(readMeta_(), { hasFeed: !!feedUrl_(), version: 2 }) });
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (body.key !== PropertiesService.getScriptProperties().getProperty('KEY')) return json_({ ok: false, error: 'bad key' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'save') {
      const it = clean_(body.item);
      if (!it.id) return json_({ ok: false, error: 'missing id' });
      const all = readAll_(); const i = all.findIndex(x => x.id === it.id);
      if (i >= 0) all[i] = Object.assign(all[i], it); else all.push(it);
      writeAll_(all);
      return json_({ ok: true });
    }
    if (body.action === 'delete') {
      writeAll_(readAll_().filter(x => x.id !== body.id));
      return json_({ ok: true });
    }
    if (body.action === 'import') {
      const res = merge_((body.items || []).map(clean_));
      return json_({ ok: true, summary: res.summary });
    }
    if (body.action === 'config') {
      const f = String(body.feedUrl || '').trim().replace(/^webcal:\/\//i, 'https://');
      if (!/^https:\/\/[^\s/]+\/feeds\/calendars\/[\w.-]+\.ics$/i.test(f)) return json_({ ok: false, error: 'bad feed' });
      lock.releaseLock();
      let test;
      try { test = UrlFetchApp.fetch(f, { muteHttpExceptions: true }); } catch (err) { return json_({ ok: false, error: 'unreachable' }); }
      if (test.getResponseCode() !== 200 || test.getContentText().indexOf('BEGIN:VCALENDAR') < 0) return json_({ ok: false, error: 'unreachable' });
      PropertiesService.getScriptProperties().setProperty('FEED_URL', f);
      const res = syncCanvas_();
      return json_({ ok: true, summary: res.summary, count: readAll_().length });
    }
    if (body.action === 'testEmail') {
      lock.releaseLock();
      runDaily_(true);
      return json_({ ok: true });
    }
    if (body.action === 'sync') {
      lock.releaseLock();
      const res = syncCanvas_();
      return json_({ ok: true, summary: res.summary, error: res.error || null });
    }
    return json_({ ok: false, error: 'unknown action' });
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

/* ---------- daily job: sync + reminder email ---------- */
function dailyJob() { runDaily_(false); }

/** Run this from the editor to send yourself a sample reminder right now. */
function testEmail() { runDaily_(true); }

function runDaily_(forceTest) {
  if (!feedUrl_() && !forceTest) return;
  const res = syncCanvas_();
  const today = ukDay_(new Date());
  const all = readAll_();
  let due = all
    .filter(x => x.status !== 'done' && x.status !== 'hidden')
    .map(x => Object.assign({}, x, { days: ukDay_(new Date(x.due)) - today }))
    .filter(x => REMINDER_DAYS.indexOf(x.days) >= 0 || (x.days < 0 && x.days >= -OVERDUE_DAYS))
    .sort((a, b) => a.days - b.days);
  if (forceTest && due.length === 0) {
    const next = all.filter(x => x.status !== 'done' && x.status !== 'hidden')
      .map(x => Object.assign({}, x, { days: ukDay_(new Date(x.due)) - today }))
      .filter(x => x.days >= 0).sort((a, b) => a.days - b.days)[0];
    if (next) due = [next];
  }
  const hiddenIds = new Set(all.filter(x => x.status === 'hidden').map(x => x.id));
  const added = (res.added || []).filter(x => !hiddenIds.has(x.id));
  const changed = (res.changed || []).filter(x => !hiddenIds.has(x.id));

  if (!forceTest && !due.length && !added.length && !changed.length && !res.error) return;
  if (res.error === 'no feed') res.error = null;
  sendEmail_(due, added, changed, res.error, forceTest);
}

function sendEmail_(due, added, changed, canvasError, isTest) {
  const timing = d => d < 0 ? (-d) + (d === -1 ? ' day overdue' : ' days overdue') : d === 0 ? 'Due today' : d === 1 ? 'Tomorrow' : 'In ' + d + ' days';
  const subjFor = d => d < 0 ? 'Overdue' : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : 'Due in ' + d + ' days';
  const when = iso => Utilities.formatDate(new Date(iso), TZ, "EEEE d MMMM, HH:mm");
  const statusName = s => s === 'doing' ? 'In progress' : 'Not started';
  const pill = (txt, kind) => {
    const c = { red: ['#fce8e6', '#d93025'], amber: ['#fef7e0', '#b06000'], blue: ['#e8f0fe', '#1967d2'], grey: ['#f1f3f4', '#5f6368'] }[kind];
    return '<span style="display:inline-block;font-size:12px;font-weight:500;background:' + c[0] + ';color:' + c[1] + ';padding:3px 8px;border-radius:6px;margin-right:6px">' + esc_(txt) + '</span>';
  };

  let subject;
  if (due.length) subject = subjFor(due[0].days) + ': ' + due[0].title + (due.length > 1 ? ' (+' + (due.length - 1) + ' more)' : '');
  else if (added.length) subject = 'New on Canvas: ' + added[0].title + (added.length > 1 ? ' (+' + (added.length - 1) + ' more)' : '');
  else if (changed.length) subject = 'Canvas deadline changed: ' + changed[0].title;
  else subject = canvasError ? "Coursework Planner couldn't reach Canvas" : 'Your reminders are set up';
  if (isTest) subject = 'Test: ' + subject;

  const headline = due.length ? (due.length === 1 ? '1 deadline coming up' : due.length + ' deadlines coming up') : (added.length || changed.length) ? 'Changes on Canvas' : canvasError ? "Canvas couldn't be reached" : 'Your reminders are set up';
  let html = '<div style="font-family:Roboto,Arial,sans-serif;color:#202124;max-width:560px;margin:0 auto;padding:8px">' +
    '<p style="font-size:13px;color:#5f6368;margin:0 0 4px">Coursework Planner' + (isTest ? ' · test' : '') + '</p>' +
    '<h1 style="font-size:22px;font-weight:400;margin:0 0 16px">' + headline + '</h1>';
  let text = 'Coursework Planner' + (isTest ? ' (test)' : '') + '\n' + headline + '\n\n';

  due.forEach(x => {
    const urgent = x.days <= 0 || (x.days <= 3 && x.status !== 'doing');
    const tKind = x.days <= 0 ? 'red' : x.days <= 3 ? 'amber' : 'blue';
    html += '<div style="background:#f8f9fa;border-radius:12px;padding:14px 16px;margin:0 0 10px">' +
      '<div style="font-size:16px;font-weight:500">' + esc_(x.title) + '</div>' +
      '<div style="font-size:13px;color:#5f6368;margin:4px 0 8px">' + esc_(x.module) + ' · ' + when(x.due) + '</div>' +
      pill(timing(x.days), tKind) + pill(statusName(x.status), urgent && x.status !== 'doing' ? 'red' : 'grey') +
      (x.url ? '<a href="' + esc_(x.url) + '" style="font-size:13px;color:#1a73e8;text-decoration:none">Canvas</a>' : '') +
      '</div>';
    text += '• ' + x.title + ' (' + x.module + ') — ' + when(x.due) + ' · ' + timing(x.days) + ' · ' + statusName(x.status) +
      (x.days <= 3 && x.status !== 'doing' ? ' — not started yet!' : '') + '\n';
  });

  if (added.length || changed.length) {
    html += '<h2 style="font-size:15px;font-weight:500;margin:18px 0 8px">Changes on Canvas</h2><ul style="margin:0;padding-left:18px;font-size:14px;color:#3c4043">';
    text += '\nChanges on Canvas\n';
    added.forEach(x => { html += '<li>New: <b>' + esc_(x.title) + '</b> (' + esc_(x.module) + '), due ' + when(x.due) + '</li>'; text += '• New: ' + x.title + ', due ' + when(x.due) + '\n'; });
    changed.forEach(x => { html += '<li>Date changed: <b>' + esc_(x.title) + '</b>, now due ' + when(x.due) + '</li>'; text += '• Date changed: ' + x.title + ', now due ' + when(x.due) + '\n'; });
    html += '</ul>';
  }
  if (canvasError) {
    html += '<p style="font-size:13px;color:#d93025;margin:16px 0 0">Canvas couldn\'t be reached this morning, so this uses your last saved list.</p>';
    text += "\nCanvas couldn't be reached this morning.\n";
  }
  if (PLANNER_URL) {
    html += '<p style="margin:20px 0 0"><a href="' + PLANNER_URL + '" style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:10px 20px;border-radius:999px">Open your planner</a></p>';
    text += '\nOpen your planner: ' + PLANNER_URL + '\n';
  }
  html += '</div>';

  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: subject, htmlBody: html, body: text, name: 'Coursework Planner' });
}

/* ---------- Canvas ---------- */
function syncCanvas_() {
  let res;
  if (!feedUrl_()) return { summary: 'no Canvas link yet', error: 'no feed', added: [], changed: [] };
  try {
    const r = UrlFetchApp.fetch(feedUrl_(), { muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
    const events = parseIcs_(r.getContentText());
    if (!events.length) throw new Error('feed was empty');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { res = merge_(events); } finally { lock.releaseLock(); }
  } catch (err) {
    res = { summary: "couldn't reach Canvas", error: String(err), added: [], changed: [] };
  }
  writeMeta_({ lastSync: new Date().toISOString(), summary: res.summary });
  return res;
}

function merge_(events) {
  const all = readAll_(); const byId = {}; all.forEach(x => byId[x.id] = x);
  const added = [], changed = [];
  events.forEach(e => {
    const cur = byId[e.id];
    if (!cur) { const it = { id: e.id, title: e.title, module: e.module, due: e.due, url: e.url, status: 'todo', notes: '', custom: false }; all.push(it); byId[e.id] = it; added.push(it); return; }
    const dateMoved = cur.due !== e.due;
    if (dateMoved || cur.title !== e.title || cur.url !== e.url || cur.module !== e.module) {
      Object.assign(cur, { title: e.title, module: e.module, due: e.due, url: e.url }); // never touches status or notes
      if (dateMoved) changed.push(cur);
    }
  });
  writeAll_(all);
  const parts = [];
  if (added.length) parts.push(added.length + ' new');
  if (changed.length) parts.push(changed.length + ' date' + (changed.length > 1 ? 's' : '') + ' changed');
  return { summary: parts.length ? parts.join(', ') : 'no changes', added: added, changed: changed };
}

function parseIcs_(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  lines.forEach(ln => {
    if (ln === 'BEGIN:VEVENT') ev = {};
    else if (ln === 'END:VEVENT') { if (ev) out.push(ev); ev = null; }
    else if (ev) { const i = ln.indexOf(':'); if (i < 0) return; ev[ln.slice(0, i).split(';')[0].toUpperCase()] = ln.slice(i + 1); }
  });
  return out.map(e => {
    let title = (e.SUMMARY || 'Untitled').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    const br = title.match(/\s*\[(?:\d+_)?([^\]]+)\]\s*$/); const module = br ? br[1] : 'Other';
    if (br) title = title.slice(0, br.index);
    title = title.replace(new RegExp('^' + module.replace(/[-]/g, '\\-') + '\\s*[:\\-–]?\\s*(Assignment:\\s*)?', 'i'), '').trim() || title;
    const url = e.URL || ''; const aid = (url.match(/assignment_(\d+)/) || [])[1];
    const id = aid ? 'a' + aid : 'e' + String(e.UID || title + e.DTSTART).replace(/[^A-Za-z0-9]/g, '').slice(-60);
    return { id: id, title: title, module: module, due: icsDate_(e.DTSTART || e.DTEND || ''), url: url };
  }).filter(x => x.due);
}

function icsDate_(v) {
  const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); if (!m) return null;
  if (!m[4]) return Utilities.parseDate(m[1] + m[2] + m[3] + '2359', TZ, 'yyyyMMddHHmm').toISOString();
  if (m[7]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  return Utilities.parseDate(m[1] + m[2] + m[3] + m[4] + m[5] + m[6], TZ, 'yyyyMMddHHmmss').toISOString();
}

/* ---------- Sheet storage ---------- */
function sheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name);
}
function readAll_() {
  const sh = sheet_('Assignments'); const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLS.length).getDisplayValues().filter(r => r[0]).map(r => ({
    id: r[0], title: r[1], module: r[2], due: r[3], url: r[4], status: r[5] || 'todo', notes: r[6], custom: r[7] === 'true'
  }));
}
function writeAll_(list) {
  const sh = sheet_('Assignments');
  list.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, COLS.length).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, COLS.length).setNumberFormat('@')
    .setValues(list.map(x => [x.id, x.title, x.module, x.due, x.url || '', x.status || 'todo', x.notes || '', x.custom ? 'true' : 'false']));
}
function readMeta_() {
  const v = sheet_('Meta').getRange('A1:B2').getDisplayValues();
  return { lastSync: v[0][1] || null, summary: v[1][1] || '' };
}
function writeMeta_(m) {
  sheet_('Meta').getRange('A1:B2').setNumberFormat('@').setValues([['lastSync', m.lastSync], ['summary', m.summary]]);
}

/* ---------- helpers ---------- */
function clean_(it) {
  it = it || {};
  const ok = ['todo', 'doing', 'done', 'hidden'];
  return {
    id: String(it.id || '').slice(0, 80), title: String(it.title || '').slice(0, 300), module: String(it.module || 'Other').slice(0, 40),
    due: String(it.due || ''), url: String(it.url || '').slice(0, 500), status: ok.indexOf(it.status) >= 0 ? it.status : 'todo',
    notes: String(it.notes || '').slice(0, 5000), custom: !!it.custom
  };
}
function ukDay_(d) {
  const p = Utilities.formatDate(d, TZ, 'yyyy-MM-dd').split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5);
}
function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
