// الواجهة الخلفية: Google Apps Script + Google Sheets   (الجزء 1: الأساس)
const MAX_ACTIVE = 2, EXPIRED = 'انتهت الجلسة، سجّل الدخول من جديد';
const COLS = {
  regions: ['id', 'name', 'grp', 'price'],
  drivers: ['id', 'name', 'phone', 'salt', 'hash', 'veh', 'scope', 'approved', 'banned', 'online', 'paid', 'due_at', 'created_at', 'idFile', 'selfieFile'],
  orders: ['id', 'secret', 'cname', 'cphone', 'region', 'addr', 'note', 'status', 'driver_id', 'merchant_id', 'items', 'items_total', 'mcommission', 'price', 'commission', 'total', 'rating', 'created_at', 'done_at'],
  settings: ['k', 'v'], blocked: ['phone'], sessions: ['hash', 'role', 'user_id', 'exp'], audit: ['at', 'who', 'action', 'detail'],
  merchants: ['id', 'name', 'shop', 'cat', 'phone', 'salt', 'hash', 'region', 'addr', 'idFile', 'pref_driver', 'paid', 'due_at', 'approved', 'banned', 'created_at'],
  products: ['id', 'merchant_id', 'name', 'price', 'descr', 'avail', 'created_at'], product_imgs: ['product_id', 'img'],
  payments: ['id', 'role', 'user_id', 'who', 'amount', 'receiptFile', 'ref', 'status', 'note', 'approved_amount', 'created_at', 'decided_at'],
  notices: ['id', 'role', 'user_id', 'day', 'text', 'at']
};
const WRITES = ['createOrder', 'cancel', 'rate', 'register', 'login', 'logout', 'toggle', 'accept', 'pick', 'done', 'return', 'adminLogin', 'adminLogout', 'adminAct'];
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

/* ---------- الصور في Google Drive الخاص (لا تدخل الجدول) ---------- */
function folder() { const it = DriveApp.getFoldersByName('tawseel-private'); return it.hasNext() ? it.next() : DriveApp.createFolder('tawseel-private'); }
function saveImg(d, name) {
  const m = typeof d === 'string' && d.length <= 450000 && /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(d);
  if (!m) throw bad('الصورة غير صالحة');
  return folder().createFile(Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/jpeg', name + '.jpg')).getId();
}
function readImg(id) { if (!id) return null; try { return 'data:image/jpeg;base64,' + Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); } catch (e) { return null; } }
function trash(id) { if (id) try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { } }

/* ---------- الحماية من التخمين (ذاكرة مؤقتة) ---------- */
function bump(k, sec) { const c = cache(), key = 'a_' + k, n = Number(c.get(key) || 0) + 1; c.put(key, String(n), Math.min(sec, 21600)); return n; }
function locked(k, max) { if (Number(cache().get('a_' + k) || 0) >= max) throw bad('محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة'); }
function hit(k, max, sec) { if (bump(k, sec) > max) throw bad('طلبات كثيرة، انتظر قليلاً'); }

/* ---------- الجلسات: رمز عشوائي (يصل للمتصفح في كوكي HttpOnly عبر الوسيط) ويُحفظ مشفّراً ---------- */
function newSession(role, user, ttl) {
  const t = rnd(), h = sha(t), exp = Date.now() + ttl * 1000;
  const dead = rows('sessions').filter((r) => Number(r.exp) < Date.now()); if (dead.length) delRows('sessions', dead);
  ins('sessions', { hash: h, role, user_id: user, exp: String(exp) });
  cache().put('s_' + h, JSON.stringify({ role, user_id: user, exp }), Math.min(ttl, 21600));
  return t;
}
function getSession(tok, role) {
  if (!tok) return null;
  const h = sha(tok), c = cache().get('s_' + h);
  if (c) { const s = JSON.parse(c); return s.role === role && s.exp > Date.now() ? s : null; }
  const r = rows('sessions').find((x) => x.hash === h && x.role === role && Number(x.exp) > Date.now());
  if (!r) return null;
  const s = { role, user_id: r.user_id, exp: Number(r.exp) };
  cache().put('s_' + h, JSON.stringify(s), Math.max(1, Math.min(21600, Math.floor((s.exp - Date.now()) / 1000))));
  return s;
}
function killSessions(pred) { const list = rows('sessions').filter(pred); list.forEach((r) => cache().remove('s_' + r.hash)); if (list.length) delRows('sessions', list); }
function endSession(tok) { if (tok) { const h = sha(tok); killSessions((r) => r.hash === h); } }
function me() {
  const s = getSession(TK.driver, 'driver'); if (!s) throw bad(EXPIRED);
  const d = rows('drivers').find((x) => x.id === s.user_id); if (!d || d.banned === 'Y') throw bad(EXPIRED);
  return d;
}
function needAdmin() { if (!getSession(TK.admin, 'admin')) throw bad(EXPIRED); }
function needPassword(b) {
  locked('a:' + IP, 5);
  if (!same(b.password || '', prop('ADMIN_PASSWORD'))) { bump('a:' + IP, 900); throw bad('كلمة السر غير صحيحة'); }
}

const pubOrder = (o) => ({ id: o.id, region: o.region, addr: o.addr, note: o.note, status: o.status, kind: o.merchant_id ? 'shop' : 'delivery', items: o.items ? JSON.parse(o.items) : null, items_total: +o.items_total || 0 });
const ratingOf = (o) => (o.rating ? +o.rating : null);
const avgOf = (list) => { const rt = list.filter((o) => o.rating); return rt.length ? Math.round(sum(rt, 'rating') / rt.length * 10) / 10 : null; };

/* ---------- نقطة الدخول ---------- */
function doGet() {
  const out = { server: 'ok', secret: !!prop('API_SECRET'), adminName: !!prop('ADMIN_NAME'), adminPassword: prop('ADMIN_PASSWORD').length >= 12 };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  let out;
  try {
    const env = JSON.parse(e.postData.contents);
    if (!prop('API_SECRET') || !same(env.secret || '', prop('API_SECRET'))) throw bad('مرفوض');
    TK = env.tokens || {}; IP = clean(env.ip).slice(0, 60) || 'x'; MEM = {}; SHS = {};
    const b = env.req || {};
    out = WRITES.indexOf(b.action) >= 0 ? withLock(() => route(b)) : route(b);
  } catch (err) { if (!err.expose) console.error(err && err.stack ? err.stack : err); out = { error: err.expose ? err.message : 'حدث خطأ، حاول مرة أخرى' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function withLock(fn) { const l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }
function setup() { Object.keys(COLS).forEach(sh); regionsAll(); folder(); Logger.log('تم الإعداد: أُنشئت الجداول وبُذرت المناطق وجُهّز مجلد الصور الخاص.'); }

const SENS = ['setCommission', 'setPrice', 'addRegion', 'delRegion', 'settle', 'delDriver', 'delMerchant', 'setMerchantCommission', 'settleMerchant', 'payOk', 'setDebtPolicy'];

function route(b) {
  const A = b.action;
  if (A === 'ping') return { ok: true };

  /* ===== عام ===== */
  if (A === 'regions') {
    const s = getSet();
    const rs = regionsAll().slice().sort((a, c) => a.grp === c.grp ? a.name.localeCompare(c.name, 'ar') : (a.grp < c.grp ? -1 : 1));
    return { regions: rs.map((r) => ({ id: r.id, name: r.name, group: r.grp, total: r2(+r.price + fee(+r.price, s)) })), paused: s.paused, notice: s.notice, site: s.siteName };
  }
  if (A === 'createOrder') {
    const n = str(b.cname, 80, 'اكتب اسمك'), p = clean(b.cphone), ad = str(b.addr, 200, 'اكتب العنوان'), rg = clean(b.region);
    if (!phoneOk(p)) throw bad('رقم الجوال غير صحيح');
    hit('o:' + IP, 60, 3600); hit('op:' + normPhone(p), 10, 3600);
    const s = getSet(); if (s.paused) throw bad('استقبال الطلبات متوقف مؤقتاً');
    if (rows('blocked').some((x) => x.phone === normPhone(p))) throw bad('لا يمكن استقبال طلب من هذا الرقم');
    const r = regionsAll().find((x) => x.id === rg); if (!r) throw bad('منطقة غير صحيحة');
    const price = +r.price, c = r2(fee(price, s)), id = Utilities.getUuid(), secret = rnd().slice(0, 16);
    ins('orders', { id, secret, cname: n, cphone: p, region: rg, addr: ad, note: clean(b.note).slice(0, 300), status: 'new', items_total: '0', mcommission: '0', price, commission: c, total: r2(price + c), created_at: now() });
    return { id, secret, total: r2(price + c) };
  }
  if (A === 'track') {   // لا يرى الطلب إلا من يملك رمزه السري
    const list = (Array.isArray(b.orders) ? b.orders : []).slice(0, 30), ds = rows('drivers');
    const os = rows('orders').filter((o) => list.some((x) => x && x.id === o.id && x.secret === o.secret)).reverse();
    return { orders: os.map((o) => { const d = ds.find((x) => x.id === o.driver_id), live = ['accepted', 'picked', 'done'].indexOf(o.status) >= 0;
      return Object.assign(pubOrder(o), { total: +o.total, delivery: r2(+o.price + +o.commission), rating: ratingOf(o), shop: null, driver: d && live ? { name: d.name, phone: d.phone } : null, proposal: null }); }) };
  }
  if (A === 'cancel') {
    const o = rows('orders').find((x) => x.id === b.id && x.secret === clean(b.secret));
    if (!o || ['new', 'm_new', 'offer', 'd_offer'].indexOf(o.status) < 0) throw bad('لا يمكن الإلغاء بعد قبول السائق');
    upd('orders', o, { status: 'cancelled' }); return { ok: true };
  }
  if (A === 'rate') {
    const n = Number(b.n); if ([1, 2, 3, 4, 5].indexOf(n) < 0) throw bad('تقييم غير صحيح');
    const o = rows('orders').find((x) => x.id === b.id && x.secret === clean(b.secret));
    if (!o || o.status !== 'done' || o.rating) throw bad('لا يمكن التقييم');
    upd('orders', o, { rating: String(n) }); return { ok: true };
  }

  /* ===== السائق ===== */
  if (A === 'register') {
    hit('r:' + IP, 20, 3600);
    const n = str(b.name, 80, 'اكتب الاسم'), p = clean(b.phone), pw = String(b.pass || ''), sc = clean(b.scope);
    if (!phoneOk(p) || pw.length < 6 || pw.length > 100) throw bad('اكتب جوالاً صحيحاً وكلمة سر من 6 أحرف على الأقل');
    if (sc !== 'ALL:gaza' && sc !== 'ALL:wb' && !regionsAll().some((x) => x.id === sc)) throw bad('منطقة غير صحيحة');
    if (rows('drivers').some((d) => d.phone === p)) throw bad('هذا الرقم مسجل مسبقاً');
    const f1 = saveImg(b.idImg, 'id-' + rnd().slice(0, 8)), f2 = saveImg(b.selfie, 'selfie-' + rnd().slice(0, 8)), salt = rnd().slice(0, 16);
    ins('drivers', { id: Utilities.getUuid(), name: n, phone: p, salt, hash: hashPw(pw, salt), veh: clean(b.veh).slice(0, 40), scope: sc, approved: 'N', banned: 'N', online: 'Y', paid: '0', created_at: now(), idFile: f1, selfieFile: f2 });
    return { ok: true };
  }
  if (A === 'login') {
    const p = clean(b.phone), k = 'p:' + p, k2 = 'i:' + IP;
    locked(k, 8); locked(k2, 40);
    const d = rows('drivers').find((x) => x.phone === p && x.banned !== 'Y');
    if (!d || !same(hashPw(String(b.pass || ''), d.salt), d.hash)) { bump(k, 900); bump(k2, 900); throw bad('بيانات غير صحيحة أو الحساب موقوف'); }
    return { name: d.name, approved: d.approved === 'Y', _c: [{ n: 'sd', v: newSession('driver', d.id, 7 * 86400), age: 7 * 86400 }] };
  }
  if (A === 'logout') { endSession(TK.driver); return { ok: true, _c: [{ n: 'sd', v: '', age: 0 }] }; }

  if (A === 'driverState') {
    const d = me();
    if (d.approved !== 'Y') return { approved: false, name: d.name, scope: d.scope };
    const os = rows('orders'), gm = GM(), today = day(Date.now());
    const mine = os.filter((o) => o.driver_id === d.id && ['accepted', 'picked'].indexOf(o.status) >= 0);
    const dn = os.filter((o) => o.driver_id === d.id && o.status === 'done').sort((a, c) => (c.done_at > a.done_at ? 1 : -1));
    const news = os.filter((o) => o.status === 'new' && covers(d.scope, o.region, gm)).reverse(), on = d.online === 'Y';
    return { approved: true, name: d.name, scope: d.scope, online: on, max: MAX_ACTIVE,
      stats: { n: dn.length, today: dn.filter((o) => o.done_at && day(o.done_at) === today).length, earn: r2(sum(dn, 'price')), owed: r2(sum(dn, 'commission') - Number(d.paid)), avg: avgOf(dn) },
      history: dn.slice(0, 8).map((o) => ({ region: o.region, addr: o.addr, price: +o.price, rating: ratingOf(o) })),
      mine: mine.map((o) => Object.assign(pubOrder(o), { cname: o.cname, cphone: o.cphone, price: +o.price, commission: +o.commission, total: +o.total })),
      offers: [], available: on ? news.map((o) => Object.assign(pubOrder(o), { price: +o.price })) : [] };
  }
  if (A === 'toggle') { const d = me(); upd('drivers', d, { online: d.online === 'Y' ? 'N' : 'Y' }); return { ok: true }; }
  if (A === 'accept') {
    const d = me(), os = rows('orders'), o = os.find((x) => x.id === b.id);
    if (d.approved !== 'Y' || d.online !== 'Y') throw bad('لا يمكنك قبول الطلبات الآن (تأكد أنك معتمد ومتاح)');
    if (!o) throw bad('الطلب غير موجود');
    if (!covers(d.scope, o.region, GM())) throw bad('الطلب خارج منطقتك');
    if (os.filter((x) => x.driver_id === d.id && ['accepted', 'picked'].indexOf(x.status) >= 0).length >= MAX_ACTIVE) throw bad('أنهِ طلباتك الحالية أولاً');
    if (!(o.status === 'new' || (o.status === 'd_offer' && o.driver_id === d.id))) throw bad('سبقك سائق آخر على هذا الطلب');
    upd('orders', o, { status: 'accepted', driver_id: d.id }); return { ok: true };
  }
  if (A === 'pick' || A === 'done' || A === 'return') {
    const d = me(), o = rows('orders').find((x) => x.id === b.id && x.driver_id === d.id);
    const from = { pick: 'accepted', done: 'picked', 'return': 'accepted' }[A];
    if (!o || o.status !== from) throw bad('لا يمكن تنفيذ هذا الإجراء الآن');
    if (A === 'pick') upd('orders', o, { status: 'picked' });
    else if (A === 'done') upd('orders', o, { status: 'done', done_at: now() });
    else upd('orders', o, { status: 'new', driver_id: '' });
    return { ok: true };
  }

  /* ===== المشرف ===== */
  if (A === 'adminProbe') {
    locked('a:' + IP, 5);
    const ok = !!prop('ADMIN_NAME') && same(clean(b.name), prop('ADMIN_NAME'));
    if (!ok) bump('a:' + IP, 900);
    return { ok };
  }
  if (A === 'adminLogin') {
    locked('a:' + IP, 5); locked('a:all', 20);
    if (!prop('ADMIN_NAME') || !prop('ADMIN_PASSWORD')) throw bad('الخادم غير مهيأ بعد');
    if (prop('ADMIN_PASSWORD').length < 12) throw bad('كلمة سر المشرف في إعدادات السكربت قصيرة، استخدم 12 حرفاً على الأقل');
    const ok = same(clean(b.name), prop('ADMIN_NAME')) & same(b.password || '', prop('ADMIN_PASSWORD'));
    if (!ok) { bump('a:' + IP, 900); bump('a:all', 3600); audit('admin', 'login_failed', { ip: IP }); throw bad('بيانات الدخول غير صحيحة'); }
    killSessions((r) => r.role === 'admin');   // جلسة واحدة فقط: الدخول الجديد يُسقط أي جلسة قديمة
    audit('admin', 'login', { ip: IP });
    return { ok: true, _c: [{ n: 'sa', v: newSession('admin', '', 7200), age: 7200 }] };
  }
  if (A === 'adminLogout') { endSession(TK.admin); return { ok: true, _c: [{ n: 'sa', v: '', age: 0 }] }; }

  if (A === 'adminState') {
    needAdmin();
    const ds = rows('drivers'), os = rows('orders'), dn = os.filter((o) => o.status === 'done');
    return { settings: getSet(), blocked: rows('blocked').map((x) => x.phone), merchants: [], payments: [],
      audit: rows('audit').slice(-30).reverse().map((a) => { let det = {}; try { det = JSON.parse(a.detail); } catch (e) { } return { at: a.at, who: a.who, action: a.action, detail: det }; }),
      regions: regionsAll().map((r) => ({ id: r.id, name: r.name, group: r.grp, price: +r.price })),
      drivers: ds.map((d) => { const x = dn.filter((o) => o.driver_id === d.id); return { id: d.id, name: d.name, phone: d.phone, veh: d.veh, scope: d.scope, approved: d.approved === 'Y', banned: d.banned === 'Y', online: d.online === 'Y', paid: +d.paid, n: x.length, avg: avgOf(x), owed: r2(sum(x, 'commission') - Number(d.paid)), due_at: d.due_at || null }; }),
      orders: os.slice(-200).reverse().map((o) => Object.assign(pubOrder(o), { cname: o.cname, cphone: o.cphone, driver_id: o.driver_id || null, shop: null, price: +o.price, commission: +o.commission, total: +o.total, rating: ratingOf(o) })),
      totals: { n: dn.length, price: r2(sum(dn, 'price')), commission: r2(sum(dn, 'commission')), mcommission: r2(sum(dn, 'mcommission')) } };
  }
  if (A === 'adminKyc') {   // صورة الهوية والصورة الشخصية: لا تخرج إلا هنا، وكل مشاهدة تُسجّل
    needAdmin();
    const d = rows('drivers').find((x) => x.id === b.id);
    audit('admin', 'view_kyc', { driver: b.id });
    return { idImg: d ? readImg(d.idFile) : null, selfie: d ? readImg(d.selfieFile) : null };
  }
  if (A === 'adminAct') {
    needAdmin();
    const op = b.op;
    if (SENS.indexOf(op) >= 0) needPassword(b);   // العمليات المالية تتطلب كلمة السر مرة أخرى
    const drv = () => { const d = rows('drivers').find((x) => x.id === b.id); if (!d) throw bad('السائق غير موجود'); return d; };
    const requeue = (id, st) => rows('orders').filter((o) => o.driver_id === id && st.indexOf(o.status) >= 0).forEach((o) => upd('orders', o, { status: 'new', driver_id: '' }));
    if (op === 'approve') upd('drivers', drv(), { approved: 'Y' });
    else if (op === 'ban' || op === 'unban') {
      const d = drv(); upd('drivers', d, { banned: op === 'ban' ? 'Y' : 'N' });
      if (op === 'ban') { killSessions((r) => r.user_id === d.id); requeue(d.id, ['accepted']); }
    }
    else if (op === 'delDriver') {
      const d = drv(); requeue(d.id, ['accepted', 'picked']); killSessions((r) => r.user_id === d.id);
      trash(d.idFile); trash(d.selfieFile); delRows('drivers', [d]);
    }
    else if (op === 'settle') { const d = drv(); upd('drivers', d, { paid: String(r2(sum(rows('orders').filter((o) => o.driver_id === d.id && o.status === 'done'), 'commission'))), due_at: '' }); }
    else if (op === 'cancelOrder') { const o = rows('orders').find((x) => x.id === b.id); if (o && ['new', 'm_new', 'offer', 'd_offer', 'accepted', 'picked'].indexOf(o.status) >= 0) upd('orders', o, { status: 'cancelled' }); }
    else if (op === 'requeue') { const o = rows('orders').find((x) => x.id === b.id); if (o && ['accepted', 'picked'].indexOf(o.status) >= 0) upd('orders', o, { status: 'new', driver_id: '' }); }
    else if (op === 'setCommission') {
      if (['fixed', 'percent'].indexOf(b.ctype) < 0) throw bad('نوع العمولة غير صحيح');
      const v = num(b.cvalue, b.ctype === 'percent' ? 100 : 100000); setSet('ctype', b.ctype); setSet('cvalue', v);
    }
    else if (op === 'setPrice') { const r = regionsAll().find((x) => x.id === clean(b.id)); if (!r) throw bad('المنطقة غير موجودة'); upd('regions', r, { price: String(num(b.price, 100000)) }); }
    else if (op === 'addRegion') ins('regions', { id: 'c-' + rnd().slice(0, 8), name: str(b.name, 60, 'اكتب اسم المنطقة'), grp: b.grp === 'wb' ? 'wb' : 'gaza', price: String(num(b.price, 100000)) });
    else if (op === 'delRegion') { const id = clean(b.id); if (id.indexOf('c-') !== 0) throw bad('لا يمكن حذف هذه المنطقة'); delRows('regions', rows('regions').filter((r) => r.id === id)); }
    else if (op === 'setPause') setSet('paused', b.paused ? 'Y' : 'N');
    else if (op === 'setNotice') setSet('notice', clean(b.notice).slice(0, 200));
    else if (op === 'setSiteName') { const n = clean(b.name).replace(/[\u0000-\u001f<>]/g, ''); if (!n || n.length > 40) throw bad('اسم الموقع من 1 إلى 40 حرفاً'); setSet('siteName', n); }
    else if (op === 'block') { const p = normPhone(str(b.phone, 20, 'رقم غير صحيح')); if (p.length < 8) throw bad('رقم غير صحيح'); if (!rows('blocked').some((x) => x.phone === p)) ins('blocked', { phone: p }); }
    else if (op === 'unblock') delRows('blocked', rows('blocked').filter((x) => x.phone === clean(b.phone)));
    else throw bad('عملية غير معروفة');
    const d2 = Object.assign({}, b); delete d2.action; delete d2.password; audit('admin', op, d2);
    return { ok: true };
  }
  throw bad('طلب غير معروف');
}
