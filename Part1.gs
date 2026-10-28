// الواجهة الخلفية: Google Apps Script + Google Sheets   (الجزء 1: الأساس)
const MAX_ACTIVE = 2, EXPIRED = 'انتهت الجلسة، سجّل الدخول من جديد';
const COLS = {
  regions: ['id', 'name', 'grp', 'price'],
  drivers: ['id', 'name', 'phone', 'salt', 'hash', 'veh', 'scope', 'approved', 'banned', 'online', 'paid', 'due_at', 'created_at', 'idFile', 'selfieFile'],
  orders: ['id', 'secret', 'cname', 'cphone', 'region', 'addr', 'note', 'status', 'driver_id', 'merchant_id', 'items', 'items_total', 'mcommission', 'price', 'commission', 'total', 'rating', 'created_at', 'done_at', 'user_id', 'lat', 'lng', 'ptoken', 'near_at', 'near_rssi'],
  users: ['id', 'username', 'salt', 'hash', 'banned', 'created_at'],
  settings: ['k', 'v'], blocked: ['phone'], sessions: ['hash', 'role', 'user_id', 'exp'], audit: ['at', 'who', 'action', 'detail'],
  merchants: ['id', 'name', 'shop', 'cat', 'phone', 'salt', 'hash', 'region', 'addr', 'idFile', 'pref_driver', 'paid', 'due_at', 'approved', 'banned', 'created_at'],
  products: ['id', 'merchant_id', 'name', 'price', 'descr', 'avail', 'created_at'], product_imgs: ['product_id', 'img'],
  payments: ['id', 'role', 'user_id', 'who', 'amount', 'receiptFile', 'ref', 'status', 'note', 'approved_amount', 'created_at', 'decided_at'],
  notices: ['id', 'role', 'user_id', 'day', 'text', 'at'],
  pay_accounts: ['id', 'type', 'name', 'number', 'note', 'active']
};
const WRITES = ['createOrder', 'cancel', 'rate', 'register', 'login', 'logout', 'toggle', 'accept', 'pick', 'done', 'return', 'adminLogin', 'adminLogout', 'adminAct', 'adminKyc', 'adminReceipt', 'pay', 'proxToken', 'proxSeen', 'uRegister', 'uLogin', 'uLogout'];
const BASE = [['g-شمال غزة', 'شمال غزة', 'gaza'], ['g-غزة', 'غزة', 'gaza'], ['g-دير البلح', 'دير البلح', 'gaza'], ['g-خان يونس', 'خان يونس', 'gaza'], ['g-رفح', 'رفح', 'gaza'],
  ['w-جنين', 'جنين', 'wb'], ['w-طوباس', 'طوباس', 'wb'], ['w-طولكرم', 'طولكرم', 'wb'], ['w-نابلس', 'نابلس', 'wb'], ['w-قلقيلية', 'قلقيلية', 'wb'], ['w-سلفيت', 'سلفيت', 'wb'],
  ['w-رام الله والبيرة', 'رام الله والبيرة', 'wb'], ['w-أريحا والأغوار', 'أريحا والأغوار', 'wb'], ['w-القدس', 'القدس', 'wb'], ['w-بيت لحم', 'بيت لحم', 'wb'], ['w-الخليل', 'الخليل', 'wb']];
const DEF = { ctype: 'percent', cvalue: '10', paused: 'N', notice: '', siteName: 'توصيل فلسطين', mc_on: 'N', mc_type: 'percent', mc_value: '0', debt_limit: '0', grace_days: '3' };
let TK = {}, IP = 'x', MEM = {}, SHS = {};

/* ---------- مساعدات ---------- */
const bad = (m) => { const e = new Error(m); e.expose = true; return e; };
const clean = (v) => String(v == null ? '' : v).trim();
const str = (v, max, msg) => { const s = clean(v); if (!s || s.length > max) throw bad(msg); return s; };
const num = (v, max) => { const n = Number(v); if (v === '' || v == null || !(n >= 0) || n > max) throw bad('قيمة غير صحيحة'); return n; };
const phoneOk = (p) => /^[0-9+\s-]{7,20}$/.test(p);
const normPhone = (p) => { let d = String(p).replace(/\D/g, ''); if (d.indexOf('00970') === 0) d = d.slice(5); else if (d.indexOf('970') === 0) d = d.slice(3); return d.charAt(0) === '0' ? d : '0' + d; };
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a, k) => a.reduce((s, o) => s + Number(o[k] || 0), 0);
const now = () => new Date().toISOString();
const day = (t) => Utilities.formatDate(new Date(t), 'Asia/Gaza', 'yyyy-MM-dd');
const rnd = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
const prop = (k) => String(PropertiesService.getScriptProperties().getProperty(k) || '').trim();
const sha = (s) => Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
function same(a, b) { const x = sha('1' + a), y = sha('1' + b); let d = x.length ^ y.length; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; }
function hashPw(pw, salt) { let h = salt + '|' + pw; for (let i = 0; i < 1000; i++) h = sha(h + salt); return h; }
const fee = (price, s) => s.ctype === 'percent' ? Math.round(price * s.cvalue) / 100 : s.cvalue;
const covers = (scope, region, gm) => scope === region || scope === 'ALL:' + gm[region];
const cache = () => CacheService.getScriptCache();

/* ---------- الجداول (Google Sheets) ---------- */
function sh(n) {
  if (SHS[n]) return SHS[n];
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(n);
  if (!s) { s = ss.insertSheet(n); s.getRange(1, 1, s.getMaxRows(), COLS[n].length).setNumberFormat('@'); s.getRange(1, 1, 1, COLS[n].length).setValues([COLS[n]]); s.setFrozenRows(1); }
  return (SHS[n] = s);
}
function rows(n) {
  if (MEM[n]) return MEM[n];
  const v = sh(n).getDataRange().getValues(); v.shift();
  return (MEM[n] = v.map((r, i) => { const o = { _r: i + 2 }; COLS[n].forEach((k, j) => { o[k] = String(r[j] == null ? '' : r[j]); }); return o; }));
}
function ins(n, o) {
  const s = sh(n), row = s.getLastRow() + 1;
  if (row > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), 500);
  const g = s.getRange(row, 1, 1, COLS[n].length); g.setNumberFormat('@'); g.setValues([COLS[n].map((k) => String(o[k] == null ? '' : o[k]))]);
  delete MEM[n];
}
function upd(n, o, patch) { Object.assign(o, patch); sh(n).getRange(o._r, 1, 1, COLS[n].length).setValues([COLS[n].map((k) => String(o[k] == null ? '' : o[k]))]); }
function delRows(n, list) { list.slice().sort((a, b) => b._r - a._r).forEach((o) => sh(n).deleteRow(o._r)); delete MEM[n]; }
function regionsAll() {
  let r = rows('regions');
  if (!r.length) { sh('regions').getRange(2, 1, BASE.length, 4).setValues(BASE.map((b) => [b[0], b[1], b[2], '10'])); delete MEM.regions; r = rows('regions'); }
  return r;
}
const GM = () => Object.fromEntries(regionsAll().map((r) => [r.id, r.grp]));
function getSet() {
  const m = Object.assign({}, DEF); rows('settings').forEach((r) => { m[r.k] = r.v; });
  return { ctype: m.ctype, cvalue: +m.cvalue, paused: m.paused === 'Y', notice: m.notice, siteName: m.siteName, mc: { on: m.mc_on === 'Y', type: m.mc_type, value: +m.mc_value }, debtLimit: +m.debt_limit, graceDays: +m.grace_days };
}
function setSet(k, v) { const r = rows('settings').find((x) => x.k === k); if (r) upd('settings', r, { v: String(v) }); else ins('settings', { k, v: String(v) }); }
function audit(who, action, detail) { ins('audit', { at: now(), who, action, detail: JSON.stringify(detail || {}).slice(0, 600) }); }

// فحص ذاتي: شغّله بعد لصق الأجزاء الأربعة ليخبرك إن كان ينقصك شيء
function selfTest() {
  const has = (n) => { try { return eval('typeof ' + n) === 'function'; } catch (e) { return false; } };
  const need = ['doGet', 'doPost', 'setup', 'route', 'routeA', 'routeB', 'newSession', 'getSession', 'killSessions', 'saveImg', 'readImg', 'regionsAll', 'getSet', 'hashPw', 'owedOf', 'syncDue', 'debtInfo', 'customer'];
  const miss = need.filter((n) => !has(n));
  Logger.log(miss.length ? 'ناقص: ' + miss.join(' , ') + '  ← تأكد أنك لصقت الأجزاء الأربعة كاملة' : 'الأجزاء الأربعة كلها موجودة ✓');
  Logger.log('API_SECRET: ' + (prop('API_SECRET') ? 'موجود ✓' : 'ناقص ✗'));
  Logger.log('ADMIN_NAME: ' + (prop('ADMIN_NAME') ? 'موجود ✓' : 'ناقص ✗'));
  Logger.log('ADMIN_PASSWORD: ' + (prop('ADMIN_PASSWORD').length >= 12 ? 'موجود ✓' : 'ناقص أو أقل من 12 حرفاً ✗'));
  if (!miss.length) Logger.log('المناطق في الجدول: ' + regionsAll().length + (regionsAll().length === 16 ? ' ✓' : ''));
}
