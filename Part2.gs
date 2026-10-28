// الواجهة الخلفية — الجزء 2: الصور والحماية والجلسات ونقطة الدخول والتحصيل
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
function customer() {
  const s = getSession(TK.customer, 'customer'); if (!s) throw bad(EXPIRED);
  const u = rows('users').find((x) => x.id === s.user_id); if (!u || u.banned === 'Y') throw bad(EXPIRED);
  return u;
}
function ownOrder(b) {   // صاحب الطلب: برمزه السري (قديم) أو بحسابه المسجَّل
  if (b.secret) return rows('orders').find((x) => x.id === b.id && x.secret === clean(b.secret));
  const u = customer(); return rows('orders').find((x) => x.id === b.id && x.user_id === u.id);
}
const customerView = (o, ds) => { const d = ds.find((x) => x.id === o.driver_id), live = ['accepted', 'picked', 'done'].indexOf(o.status) >= 0;
  return Object.assign(pubOrder(o), { total: +o.total, delivery: r2(+o.price + +o.commission), rating: ratingOf(o), shop: null, driver: d && live ? { name: d.name, phone: d.phone } : null, proposal: null }); };
function needAdmin() { if (!getSession(TK.admin, 'admin')) throw bad(EXPIRED); }
function needPassword(b) {
  locked('a:' + IP, 5);
  if (!same(b.password || '', prop('ADMIN_PASSWORD'))) { bump('a:' + IP, 900); throw bad('كلمة السر غير صحيحة'); }
}

const pubOrder = (o) => ({ id: o.id, region: o.region, addr: o.addr, note: o.note, status: o.status, near: !!o.near_at, kind: o.merchant_id ? 'shop' : 'delivery', items: o.items ? JSON.parse(o.items) : null, items_total: +o.items_total || 0 });
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
function setup() { Object.keys(COLS).forEach((n) => { sh(n).getRange(1, 1, 1, COLS[n].length).setValues([COLS[n]]); }); regionsAll(); folder(); Logger.log('تم الإعداد: أُنشئت الجداول وبُذرت المناطق وجُهّز مجلد الصور الخاص.'); }

/* ---------- تحصيل العمولة: المهلة والإشعارات والإيقاف ---------- */
function owedOf(role, u) { const f = role === 'driver' ? 'commission' : 'mcommission', col = role === 'driver' ? 'driver_id' : 'merchant_id'; return r2(sum(rows('orders').filter((o) => o[col] === u.id && o.status === 'done'), f) - Number(u.paid)); }
// تبدأ المهلة عند أول تجاوز لحد العمولة وتنتهي بالدفع؛ بعد انتهائها يُوقف الحساب عن العمل ويبقى دخوله مفتوحاً للدفع
function syncDue(role, u, s, owed) {
  const tbl = role === 'driver' ? 'drivers' : 'merchants', over = s.debtLimit > 0 && owed >= s.debtLimit;
  let due = u.due_at ? new Date(u.due_at) : null;
  if (over && !due) { due = new Date(Date.now() + s.graceDays * 86400000); upd(tbl, u, { due_at: due.toISOString() }); }
  else if (!over && due) { due = null; upd(tbl, u, { due_at: '' }); }
  return due;
}
function debtInfo(role, u, s, owed) {
  if (!(s.debtLimit > 0) && !u.due_at && !(owed > 0)) return null;
  const tbl = role === 'driver' ? 'drivers' : 'merchants', today = day(Date.now()), over = s.debtLimit > 0 && owed >= s.debtLimit;
  const keyOf = (d) => (d && new Date(d).getTime() < Date.now() ? today + '-s' : today);   // تذكير يومي + إشعار إيقاف منفصل
  const mine = () => rows('notices').filter((n) => n.user_id === u.id);
  if ((over && !u.due_at) || (!over && u.due_at) || (over && !mine().some((n) => n.day === keyOf(u.due_at)))) withLock(() => {
    MEM = {}; const u2 = rows(tbl).find((x) => x.id === u.id); if (!u2) return;
    const due = syncDue(role, u2, s, owed); u.due_at = u2.due_at;
    const key = keyOf(due && due.toISOString());
    if (due && !mine().some((n) => n.day === key)) {   // إشعار واحد كل يوم طوال المهلة، ثم إشعار الإيقاف
      const suspended = due.getTime() < Date.now(), left = Math.ceil((due.getTime() - Date.now()) / 86400000);
      ins('notices', { id: Utilities.getUuid(), role, user_id: u.id, day: key, at: now(), text: suspended ? 'تم إيقاف حسابك لعدم سداد العمولة المستحقة (' + owed + ' ₪). ادفعها وارفع صورة الإشعار ليُعاد تفعيله.' : 'عليك عمولة ' + owed + ' ₪ تجاوزت الحد (' + s.debtLimit + ' ₪). ادفعها وارفع صورة الإشعار خلال ' + left + ' يوم وإلا يُوقف حسابك.' });
    }
  });
  const due = u.due_at ? new Date(u.due_at) : null;
  return { owed, limit: s.debtLimit, days: s.graceDays, due: due ? due.toISOString() : null, left: due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null, suspended: !!due && due.getTime() < Date.now(),
    notices: mine().slice(-4).reverse().map((n) => ({ day: n.day, text: n.text })),
    payments: rows('payments').filter((p) => p.user_id === u.id).slice(-4).reverse().map((p) => ({ amount: +p.amount, status: p.status, note: p.note, created_at: p.created_at })),
    accounts: rows('pay_accounts').filter((a) => a.active === 'Y').map((a) => ({ type: a.type, name: a.name, number: a.number, note: a.note })) };
}

/* ---------- القريبون: الموقع الحي للسائقين في الذاكرة المؤقتة (لا يُكتب في الجدول، ويختفي بعد 5 دقائق من آخر تحديث) ---------- */
const NEAR_KM = 5, LOC_TTL = 300;
const inBox = (lat, lng) => lat >= 29 && lat <= 33.7 && lng >= 33.8 && lng <= 36;   // نطاق فلسطين التقريبي
function dist(a, b, c, d) { const rad = (x) => x * Math.PI / 180, dl = rad(c - a), dg = rad(d - b); const h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dg / 2) * Math.sin(dg / 2); return 2 * 6371 * Math.asin(Math.sqrt(h)); }
function getLoc(id) { const v = cache().get('loc_' + id); if (!v) return null; try { const o = JSON.parse(v); return Date.now() - o.t < LOC_TTL * 1000 ? o : null; } catch (e) { return null; } }
function liveDrivers() {   // السائقون المعتمدون المتاحون الذين لهم موقع حديث
  const ds = rows('drivers').filter((d) => d.approved === 'Y' && d.banned !== 'Y' && d.online === 'Y');
  const m = ds.length ? cache().getAll(ds.map((d) => 'loc_' + d.id)) : {};
  return ds.map((d) => { let o = null; try { o = m['loc_' + d.id] ? JSON.parse(m['loc_' + d.id]) : null; } catch (e) { } return o && Date.now() - o.t < LOC_TTL * 1000 ? { d, lat: o.lat, lng: o.lng, t: o.t } : null; }).filter(Boolean);
}
const SENS = ['setCommission', 'setPrice', 'addRegion', 'delRegion', 'settle', 'delDriver', 'delMerchant', 'setMerchantCommission', 'settleMerchant', 'payOk', 'setDebtPolicy', 'addAccount', 'delAccount'];
