// الخادم الآمن: Cloudflare Pages Function  →  /api
let E;
const MAX_ACTIVE = 2, EXPIRED = 'انتهت الجلسة، سجّل الدخول من جديد';
const enc = new TextEncoder();
const bad = (m) => { const e = new Error(m); e.expose = true; return e; };
const J = (o, cookies = []) => {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  cookies.forEach((c) => h.append('Set-Cookie', c));
  return new Response(JSON.stringify(o), { headers: h });
};

export async function onRequestPost({ request, env }) {
  E = env;
  if (!['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ADMIN_NAME', 'ADMIN_PASSWORD'].every((k) => E[k])) return J({ error: 'الخادم غير مهيأ بعد' });
  try {
    const o = request.headers.get('Origin');
    if (!o || new URL(o).host !== new URL(request.url).host) return J({ error: 'مرفوض' });   // حماية CSRF
    const out = await route(await request.json(), request, request.headers.get('cf-connecting-ip') || 'x');
    const c = out._c; delete out._c;
    return J(out, c);
  } catch (e) { return J({ error: e.expose ? e.message : 'حدث خطأ، حاول مرة أخرى' }); }
}

/* ---------- قاعدة البيانات (المفتاح السري هنا فقط) ---------- */
async function sb(path, o = {}) {
  const r = await fetch(E.SUPABASE_URL + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: { apikey: E.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + E.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', ...(o.prefer ? { Prefer: o.prefer } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + r.status);
  return t ? JSON.parse(t) : null;
}
const q = encodeURIComponent;
const UUID = /^[0-9a-f-]{36}$/i;
const uid = (v) => { if (!UUID.test(String(v))) throw bad('طلب غير صحيح'); return String(v); };
const clean = (v) => String(v == null ? '' : v).trim();
const str = (v, max, msg) => { const s = clean(v); if (!s || s.length > max) throw bad(msg); return s; };
const num = (v, max) => { const n = Number(v); if (v === '' || !(n >= 0) || n > max) throw bad('قيمة غير صحيحة'); return n; };
const phoneOk = (p) => /^[0-9+\s-]{7,20}$/.test(p);
const normPhone = (p) => { let d = String(p).replace(/\D/g, ''); if (d.startsWith('00970')) d = d.slice(5); else if (d.startsWith('970')) d = d.slice(3); return d.startsWith('0') ? d : '0' + d; };
const img = (x, max = 450000) => { if (typeof x !== 'string' || x.length > max || !x.startsWith('data:image/jpeg;base64,') || /["'<>\s]/.test(x)) throw bad('الصورة غير صالحة'); return x; };
const r2 = (n) => Math.round(n * 100) / 100;
const mfee = (t, s) => s.mc.on ? r2(s.mc.type === 'percent' ? t * s.mc.value / 100 : s.mc.value) : 0;   // عمولة التاجر: تُخصم من مستحقاته ولا تُضاف على الزبون
const sum = (a, k) => a.reduce((s, o) => s + Number(o[k] || 0), 0);
const getSettings = async () => { const s = (await sb('settings?id=eq.1'))[0]; return { ctype: s.ctype, cvalue: Number(s.cvalue), paused: s.paused, notice: s.notice, mc: { on: s.mc_on, type: s.mc_type, value: Number(s.mc_value) }, debtLimit: Number(s.debt_limit), graceDays: s.grace_days, siteName: s.site_name }; };
const fee = (price, s) => s.ctype === 'percent' ? Math.round(price * s.cvalue) / 100 : s.cvalue;
const audit = (who, action, detail) => sb('audit', { method: 'POST', body: { who, action, detail } });

/* ---------- حماية من التخمين والإغراق (مخزّنة في قاعدة البيانات) ---------- */
async function bump(k, sec) {
  let r = (await sb('attempts?k=eq.' + q(k)))[0];
  if (!r || new Date(r.until_at) < Date.now()) r = { k, n: 0, until_at: new Date(Date.now() + sec * 1000).toISOString() };
  r.n++;
  await sb('attempts', { method: 'POST', body: r, prefer: 'resolution=merge-duplicates' });
  return r.n;
}
async function locked(k, max) {
  const r = (await sb('attempts?k=eq.' + q(k)))[0];
  if (r && r.n >= max && new Date(r.until_at) > Date.now()) throw bad('محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة');
}
async function hit(k, max, sec) { if (await bump(k, sec) > max) throw bad('طلبات كثيرة، انتظر قليلاً'); }

/* ---------- الجلسات: رمز عشوائي في كوكي HttpOnly، ويُحفظ مشفّراً في القاعدة ويمكن إبطاله ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function same(a, b) {
  const x = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(a)))), y = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(b))));
  let d = 0; for (let i = 0; i < 32; i++) d |= x[i] ^ y[i]; return d === 0;
}
const CK = { admin: 'sa', driver: 'sd', merchant: 'sm' }, CATS = ['restaurant', 'electronics', 'groceries', 'clothes', 'other'];
const cookie = (req, n) => { const m = (req.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith('__Host-' + n + '=')); return m ? m.slice(n.length + 8) : ''; };
const setC = (n, v, age) => `__Host-${n}=${v}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
async function newSession(role, user, ttl) {
  const t = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await sb('sessions?expires_at=lt.' + q(new Date().toISOString()), { method: 'DELETE' });
  await sb('sessions', { method: 'POST', body: { token_hash: await sha(t), role, user_id: user, expires_at: new Date(Date.now() + ttl * 1000).toISOString() } });
  return t;
}
async function getSession(req, role) {
  const t = cookie(req, CK[role]); if (!t) return null;
  return (await sb('sessions?token_hash=eq.' + q(await sha(t)) + '&role=eq.' + role + '&expires_at=gt.' + q(new Date().toISOString())))[0] || null;
}
async function endSession(req, role) { const t = cookie(req, CK[role]); if (t) await sb('sessions?token_hash=eq.' + q(await sha(t)), { method: 'DELETE' }); }
async function me(req) {
  const s = await getSession(req, 'driver'); if (!s) throw bad(EXPIRED);
  const d = (await sb('drivers?id=eq.' + s.user_id))[0]; if (!d || d.banned) throw bad(EXPIRED);
  return d;
}
async function needPassword(b, ip) {
  await locked('a:' + ip, 5);
  if (!(await same(b.password || '', E.ADMIN_PASSWORD))) { await bump('a:' + ip, 900); throw bad('كلمة السر غير صحيحة'); }
}

const pubOrder = (o) => ({ id: o.id, region: o.region, addr: o.addr, note: o.note, status: o.status, kind: o.merchant_id ? 'shop' : 'delivery', items: o.items || null, items_total: Number(o.items_total || 0) });
const GM = async () => Object.fromEntries((await sb('regions?select=id,grp')).map((r) => [r.id, r.grp]));   // المنطقة ← قطاع غزة أو الضفة
async function rates(ids) {
  if (!ids.length) return {};
  const m = {};
  (await sb('orders?select=driver_id,rating&status=eq.done&driver_id=in.(' + ids.join(',') + ')')).forEach((o) => { const x = m[o.driver_id] || (m[o.driver_id] = { n: 0, s: 0, c: 0 }); x.n++; if (o.rating) { x.s += o.rating; x.c++; } });
  return m;
}
const dcard = (d, m) => ({ id: d.id, name: d.name, veh: d.veh, n: m[d.id] ? m[d.id].n : 0, avg: m[d.id] && m[d.id].c ? Math.round(m[d.id].s / m[d.id].c * 10) / 10 : null });
// السائقون المسموح عرضهم: نفس القطاع (غزة/الضفة) وتغطي منطقتهم منطقة الطلب، ومتاحون
async function eligible(region) {
  const g = (await GM())[region]; if (!g) return [];
  const ds = await sb('drivers?select=id,name,veh&approved=eq.true&banned=eq.false&online=eq.true&and=(or(scope.eq.' + q(region) + ',scope.eq.' + q('ALL:' + g) + '),or(due_at.is.null,due_at.gt.' + q(new Date().toISOString()) + '))&limit=60');
  const rt = await rates(ds.map((d) => d.id));
  return ds.map((d) => dcard(d, rt)).sort((a, b) => (b.avg || 0) - (a.avg || 0) || b.n - a.n).slice(0, 30);
}
async function shopMap(os) {
  const ids = [...new Set(os.filter((o) => o.merchant_id).map((o) => o.merchant_id))];
  if (!ids.length) return {};
  return Object.fromEntries((await sb('merchants?select=id,shop,addr,phone&id=in.(' + ids.join(',') + ')')).map((m) => [m.id, m]));
}
const shopOf = (o, sm) => (o.merchant_id && sm[o.merchant_id]) ? { shop: sm[o.merchant_id].shop, saddr: sm[o.merchant_id].addr, sphone: sm[o.merchant_id].phone } : {};
const releaseOffers = (id) => sb('orders?driver_id=eq.' + id + '&status=eq.d_offer', { method: 'PATCH', body: { status: 'offer', driver_id: null } });
async function meM(req) {
  const s = await getSession(req, 'merchant'); if (!s) throw bad(EXPIRED);
  const m = (await sb('merchants?id=eq.' + s.user_id))[0]; if (!m || m.banned) throw bad(EXPIRED);
  return m;
}
const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Gaza' });
const owedOf = async (role, u) => { const f = role === 'driver' ? 'commission' : 'mcommission', col = role === 'driver' ? 'driver_id' : 'merchant_id'; return r2(sum(await sb('orders?select=' + f + '&' + col + '=eq.' + u.id + '&status=eq.done'), f) - Number(u.paid)); };
// المهلة تبدأ عند أول تجاوز لحد العمولة وتنتهي بالدفع؛ بعد انتهائها يُوقف الحساب عن العمل ويبقى دخوله مفتوحاً للدفع فقط
async function syncDue(role, u, s, owed) {
  const tbl = role === 'driver' ? 'drivers' : 'merchants', over = s.debtLimit > 0 && owed >= s.debtLimit;
  let due = u.due_at ? new Date(u.due_at) : null;
  if (over && !due) { due = new Date(Date.now() + s.graceDays * 86400000); await sb(tbl + '?id=eq.' + u.id, { method: 'PATCH', body: { due_at: due.toISOString() } }); }
  else if (!over && due) { due = null; await sb(tbl + '?id=eq.' + u.id, { method: 'PATCH', body: { due_at: null } }); }
  return due;
}
async function debtInfo(role, u, s, owed) {
  const due = await syncDue(role, u, s, owed);
  if (!(s.debtLimit > 0) && !due) return null;
  const today = day(Date.now());
  let [nt, pays] = await Promise.all([sb('notices?select=day,text&user_id=eq.' + u.id + '&order=id.desc&limit=4'), sb('payments?select=amount,status,note,created_at&user_id=eq.' + u.id + '&order=created_at.desc&limit=4')]);
  const suspended = !!due && due.getTime() < Date.now(), left = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null;
  if (due && !nt.some((n) => n.day === today)) {   // إشعار واحد في اليوم طوال المهلة، ثم إشعار الإيقاف
    const text = suspended ? `تم إيقاف حسابك لعدم سداد العمولة المستحقة (${owed} ₪). ادفعها وارفع صورة الإشعار ليُعاد تفعيله.` : `عليك عمولة ${owed} ₪ تجاوزت الحد (${s.debtLimit} ₪). ادفعها وارفع صورة الإشعار خلال ${left} يوم وإلا يُوقف حسابك.`;
    await sb('notices?on_conflict=user_id,day', { method: 'POST', body: { role, user_id: u.id, day: today, text }, prefer: 'resolution=ignore-duplicates' });
    nt = [{ day: today, text }, ...nt].slice(0, 4);
  }
  return { owed, limit: s.debtLimit, days: s.graceDays, due: due ? due.toISOString() : null, left, suspended, notices: nt, payments: pays.map((p) => ({ ...p, amount: Number(p.amount) })) };
}
const SENS = ['setCommission', 'setPrice', 'addRegion', 'delRegion', 'settle', 'delDriver', 'delMerchant', 'setMerchantCommission', 'settleMerchant', 'payOk', 'setDebtPolicy'];

async function route(b, req, ip) {
  const A = b.action;

  /* ===== عام ===== */
  if (A === 'regions') {
    const [rs, s] = await Promise.all([sb('regions?select=*&order=grp.asc,name.asc'), getSettings()]);
    return { regions: rs.map((r) => ({ id: r.id, name: r.name, group: r.grp, total: r2(Number(r.price) + fee(Number(r.price), s)) })), paused: s.paused, notice: s.notice, site: s.siteName };
  }

  if (A === 'createOrder') {
    const n = str(b.cname, 80, 'اكتب اسمك'), p = clean(b.cphone), ad = str(b.addr, 200, 'اكتب العنوان'), rg = clean(b.region);
    if (!phoneOk(p)) throw bad('رقم الجوال غير صحيح');
    await hit('o:' + ip, 60, 3600); await hit('op:' + normPhone(p), 10, 3600);
    const s = await getSettings(); if (s.paused) throw bad('استقبال الطلبات متوقف مؤقتاً');
    if ((await sb('blocked?phone=eq.' + q(normPhone(p)))).length) throw bad('لا يمكن استقبال طلب من هذا الرقم');
    const r = (await sb('regions?id=eq.' + q(rg)))[0]; if (!r) throw bad('منطقة غير صحيحة');
    const price = Number(r.price), c = r2(fee(price, s));
    const o = (await sb('orders', { method: 'POST', prefer: 'return=representation', body: { cname: n, cphone: p, region: rg, addr: ad, note: clean(b.note).slice(0, 300), price, commission: c, total: r2(price + c) } }))[0];
    return { id: o.id, secret: o.secret, total: Number(o.total) };
  }

  if (A === 'track') {   // لا تتبّع بالجوال: لا يرى الطلب إلا من يملك رمزه السري
    const list = (Array.isArray(b.orders) ? b.orders : []).slice(0, 30).filter((x) => x && UUID.test(String(x.id)));
    if (!list.length) return { orders: [] };
    const os = (await sb('orders?id=in.(' + list.map((x) => x.id).join(',') + ')&order=created_at.desc')).filter((o) => list.some((x) => x.id === o.id && x.secret === o.secret));
    const ids = [...new Set(os.filter((o) => o.driver_id && o.status !== 'cancelled').map((o) => o.driver_id))];
    const [ds, rt] = ids.length ? await Promise.all([sb('drivers?select=id,name,phone,veh&id=in.(' + ids.join(',') + ')'), rates(ids)]) : [[], {}];
    const sm = await shopMap(os);
    return { orders: os.map((o) => {
      const d = ds.find((x) => x.id === o.driver_id), live = ['accepted', 'picked', 'done'].includes(o.status);
      return { ...pubOrder(o), total: Number(o.total), delivery: r2(Number(o.price) + Number(o.commission)), rating: o.rating, shop: (sm[o.merchant_id] || {}).shop || null,
        driver: d && live ? { name: d.name, phone: d.phone } : null,
        proposal: d && ['offer', 'd_offer'].includes(o.status) ? { ...dcard(d, rt), pending: o.status === 'd_offer' } : null };
    }) };
  }
  if (A === 'cancel') {
    const r = await sb('orders?id=eq.' + uid(b.id) + '&secret=eq.' + q(clean(b.secret)) + '&status=in.(new,m_new,offer,d_offer)', { method: 'PATCH', body: { status: 'cancelled' }, prefer: 'return=representation' });
    if (!r || !r.length) throw bad('لا يمكن الإلغاء بعد قبول السائق');
    return { ok: true };
  }
  if (A === 'rate') {
    const n = Number(b.n); if (![1, 2, 3, 4, 5].includes(n)) throw bad('تقييم غير صحيح');
    const r = await sb('orders?id=eq.' + uid(b.id) + '&secret=eq.' + q(clean(b.secret)) + '&status=eq.done&rating=is.null', { method: 'PATCH', body: { rating: n }, prefer: 'return=representation' });
    if (!r || !r.length) throw bad('لا يمكن التقييم');
    return { ok: true };
  }

  /* ===== السائق ===== */
  if (A === 'register') {
    await hit('r:' + ip, 20, 3600);
    const n = str(b.name, 80, 'اكتب الاسم'), p = clean(b.phone), pw = String(b.pass || ''), sc = clean(b.scope);
    if (!phoneOk(p) || pw.length < 6 || pw.length > 100) throw bad('اكتب جوالاً صحيحاً وكلمة سر من 6 أحرف على الأقل');
    if (sc !== 'ALL:gaza' && sc !== 'ALL:wb' && !(await sb('regions?select=id&id=eq.' + q(sc)))[0]) throw bad('منطقة غير صحيحة');
    const r = await sb('rpc/register_driver', { method: 'POST', body: { p_name: n, p_phone: p, p_pass: pw, p_veh: clean(b.veh).slice(0, 40), p_scope: sc, p_id: img(b.idImg), p_selfie: img(b.selfie) } });
    if (r !== 'ok') throw bad(r);
    return { ok: true };
  }
  if (A === 'login') {
    const p = clean(b.phone), k = 'p:' + p, k2 = 'i:' + ip;
    await locked(k, 8); await locked(k2, 40);
    const id = await sb('rpc/login_driver', { method: 'POST', body: { p_phone: p, p_pass: String(b.pass || '') } });
    if (!id) { await bump(k, 900); await bump(k2, 900); throw bad('بيانات غير صحيحة أو الحساب موقوف'); }
    const d = (await sb('drivers?select=name,approved&id=eq.' + id))[0];
    return { name: d.name, approved: d.approved, _c: [setC('sd', await newSession('driver', id, 7 * 86400), 7 * 86400)] };
  }
  if (A === 'logout') { await endSession(req, 'driver'); return { ok: true, _c: [setC('sd', '', 0)] }; }

  if (A === 'driverState') {
    const d = await me(req);
    if (!d.approved) return { approved: false, name: d.name, scope: d.scope };
    const [mine, news, rs, dn, offers, st] = await Promise.all([
      sb('orders?driver_id=eq.' + d.id + '&status=in.(accepted,picked)&order=created_at.asc'),
      sb('orders?status=eq.new&order=created_at.desc&limit=100'),
      sb('regions?select=id,grp'),
      sb('orders?select=region,addr,price,commission,rating,done_at&driver_id=eq.' + d.id + '&status=eq.done&order=done_at.desc'),
      sb('orders?driver_id=eq.' + d.id + '&status=eq.d_offer'),
      getSettings()]);
    const groups = Object.fromEntries(rs.map((r) => [r.id, r.grp])), rt = dn.filter((o) => o.rating), today = day(Date.now());
    const sm = await shopMap([...mine, ...news, ...offers]);
    const debt = await debtInfo('driver', d, st, r2(sum(dn, 'commission') - Number(d.paid)));
    return {
      approved: true, name: d.name, scope: d.scope, online: d.online, max: MAX_ACTIVE, debt,
      stats: { n: dn.length, today: dn.filter((o) => o.done_at && day(o.done_at) === today).length, earn: r2(sum(dn, 'price')), owed: r2(sum(dn, 'commission') - Number(d.paid)), avg: rt.length ? Math.round(sum(rt, 'rating') / rt.length * 10) / 10 : null },
      history: dn.slice(0, 8).map((o) => ({ region: o.region, addr: o.addr, price: Number(o.price), rating: o.rating })),
      offers: offers.map((o) => ({ ...pubOrder(o), ...shopOf(o, sm), price: Number(o.price), total: Number(o.total) })),
      mine: mine.map((o) => ({ ...pubOrder(o), ...shopOf(o, sm), cname: o.cname, cphone: o.cphone, price: Number(o.price), commission: Number(o.commission), total: Number(o.total) })),
      available: d.online && !(debt && debt.suspended) ? news.filter((o) => o.region === d.scope || d.scope === 'ALL:' + groups[o.region]).map((o) => ({ ...pubOrder(o), ...shopOf(o, sm), price: Number(o.price) })) : []
    };
  }
  if (A === 'toggle') { const d = await me(req); await sb('drivers?id=eq.' + d.id, { method: 'PATCH', body: { online: !d.online } }); return { ok: true }; }
  if (A === 'accept') {
    const d = await me(req), s0 = await getSettings();
    if (s0.debtLimit > 0 || d.due_at) { const due = await syncDue('driver', d, s0, await owedOf('driver', d)); if (due && due < Date.now()) throw bad('حسابك موقوف بسبب عمولة مستحقة. ادفع وارفع صورة الإشعار من لوحتك.'); }
    const r = await sb('rpc/accept_order', { method: 'POST', body: { p_order: uid(b.id), p_driver: d.id, p_max: MAX_ACTIVE } });
    if (r !== 'ok') throw bad(r);
    return { ok: true };
  }
  if (A === 'pick' || A === 'done' || A === 'return') {
    const d = await me(req);
    const m = { pick: ['accepted', { status: 'picked' }], done: ['picked', { status: 'done', done_at: new Date().toISOString() }], return: ['accepted', { status: 'new', driver_id: null }] }[A];
    const r = await sb('orders?id=eq.' + uid(b.id) + '&driver_id=eq.' + d.id + '&status=eq.' + m[0], { method: 'PATCH', body: m[1], prefer: 'return=representation' });
    if (!r || !r.length) throw bad('لا يمكن تنفيذ هذا الإجراء الآن');
    return { ok: true };
  }

  /* ===== المشرف ===== */
  if (A === 'adminProbe') {   // يتحقق من الاسم فقط لإظهار خانة كلمة السر
    await locked('a:' + ip, 5);
    const ok = await same(clean(b.name), E.ADMIN_NAME);
    if (!ok) await bump('a:' + ip, 900);
    return { ok };
  }
  if (A === 'adminLogin') {
    await locked('a:' + ip, 5); await locked('a:all', 20);
    if (String(E.ADMIN_PASSWORD).length < 12) throw bad('كلمة سر المشرف في إعدادات الخادم قصيرة، استخدم 12 حرفاً على الأقل');
    const ok = (await same(clean(b.name), E.ADMIN_NAME)) & (await same(b.password || '', E.ADMIN_PASSWORD));
    if (!ok) { await bump('a:' + ip, 900); await bump('a:all', 3600); await audit('admin', 'login_failed', { ip }); throw bad('بيانات الدخول غير صحيحة'); }
    await sb('sessions?role=eq.admin', { method: 'DELETE' });   // جلسة واحدة فقط: الدخول الجديد يُسقط أي جلسة قديمة
    await audit('admin', 'login', { ip });
    return { ok: true, _c: [setC('sa', await newSession('admin', null, 2 * 3600), 2 * 3600)] };
  }
  if (A === 'adminLogout') { await endSession(req, 'admin'); return { ok: true, _c: [setC('sa', '', 0)] }; }

  if (A === 'adminState' || A === 'adminKyc' || A === 'adminAct' || A === 'adminReceipt') {
    if (!(await getSession(req, 'admin'))) throw bad(EXPIRED);

    if (A === 'adminState') {
      const [ds, os, rs, s, dn, au, bl, ms, pay] = await Promise.all([
        sb('drivers?select=id,name,phone,veh,scope,approved,banned,online,paid,due_at&order=created_at.desc'),
        sb('orders?order=created_at.desc&limit=200'),
        sb('regions?select=*&order=grp.asc,name.asc'),
        getSettings(),
        sb('orders?select=driver_id,merchant_id,price,commission,rating,items_total,mcommission&status=eq.done'),
        sb('audit?select=at,who,action,detail&order=id.desc&limit=30'),
        sb('blocked?select=phone'),
        sb('merchants?select=id,name,shop,cat,phone,region,approved,banned,paid,due_at&order=created_at.desc'),
        sb('payments?select=id,role,who,amount,status,note,approved_amount,created_at&order=created_at.desc&limit=50')]);
      return {
        settings: s, blocked: bl.map((x) => x.phone), audit: au, payments: pay.map((p) => ({ ...p, amount: Number(p.amount) })),
        merchants: await Promise.all(ms.map(async (m) => { const x = dn.filter((o) => o.merchant_id === m.id), owed = r2(sum(x, 'mcommission') - Number(m.paid)), due = await syncDue('merchant', m, s, owed); return { ...m, paid: Number(m.paid), n: x.length, sales: r2(sum(x, 'items_total')), owed, due_at: due ? due.toISOString() : null }; })),
        regions: rs.map((r) => ({ id: r.id, name: r.name, group: r.grp, price: Number(r.price) })),
        drivers: await Promise.all(ds.map(async (d) => { const x = dn.filter((o) => o.driver_id === d.id), rt = x.filter((o) => o.rating), owed = r2(sum(x, 'commission') - Number(d.paid)), due = await syncDue('driver', d, s, owed); return { ...d, paid: Number(d.paid), n: x.length, avg: rt.length ? Math.round(sum(rt, 'rating') / rt.length * 10) / 10 : null, owed, due_at: due ? due.toISOString() : null }; })),
        orders: os.map((o) => ({ ...pubOrder(o), cname: o.cname, cphone: o.cphone, driver_id: o.driver_id, shop: (ms.find((m) => m.id === o.merchant_id) || {}).shop || null, price: Number(o.price), commission: Number(o.commission), total: Number(o.total), rating: o.rating })),
        totals: { n: dn.length, price: r2(sum(dn, 'price')), commission: r2(sum(dn, 'commission')), mcommission: r2(sum(dn, 'mcommission')) }
      };
    }

    if (A === 'adminKyc') {   // صورة الهوية والصورة الشخصية: لا تخرج من الخادم إلا هنا، وكل مشاهدة تُسجّل
      if (b.kind === 'merchant') { const m = (await sb('merchants?select=id_img&id=eq.' + uid(b.id)))[0]; await audit('admin', 'view_kyc', { merchant: b.id }); return { idImg: m ? m.id_img : null, selfie: null }; }
      const k = (await sb('kyc?driver_id=eq.' + uid(b.id)))[0];
      await audit('admin', 'view_kyc', { driver: b.id });
      return { idImg: k ? k.id_img : null, selfie: k ? k.selfie : null };
    }

    if (A === 'adminReceipt') { const p = (await sb('payments?select=receipt&id=eq.' + uid(b.id)))[0]; await audit('admin', 'view_receipt', { payment: b.id }); return { receipt: p ? p.receipt : null }; }
    const op = b.op;
    if (SENS.includes(op)) await needPassword(b, ip);   // العمليات المالية تتطلب كلمة السر مرة أخرى
    if (op === 'approve') await sb('drivers?id=eq.' + uid(b.id), { method: 'PATCH', body: { approved: true } });
    else if (op === 'ban' || op === 'unban') {
      await sb('drivers?id=eq.' + uid(b.id), { method: 'PATCH', body: { banned: op === 'ban' } });
      if (op === 'ban') { await releaseOffers(uid(b.id)); await sb('sessions?user_id=eq.' + uid(b.id), { method: 'DELETE' }); await sb('orders?driver_id=eq.' + uid(b.id) + '&status=eq.accepted', { method: 'PATCH', body: { status: 'new', driver_id: null } }); }
    }
    else if (op === 'delDriver') {
      await sb('orders?driver_id=eq.' + uid(b.id) + '&status=in.(accepted,picked)', { method: 'PATCH', body: { status: 'new', driver_id: null } });
      await releaseOffers(uid(b.id));
      await sb('sessions?user_id=eq.' + uid(b.id), { method: 'DELETE' });
      await sb('drivers?id=eq.' + uid(b.id), { method: 'DELETE' });
    }
    else if (op === 'settle') {
      const dn = await sb('orders?select=commission&driver_id=eq.' + uid(b.id) + '&status=eq.done');
      await sb('drivers?id=eq.' + uid(b.id), { method: 'PATCH', body: { paid: r2(sum(dn, 'commission')), due_at: null } });
    }
    else if (op === 'payOk') {   // اعتماد إيصال دفع: يُضاف المبلغ لمدفوعات الحساب وتُلغى المهلة إن نزلت العمولة تحت الحد
      const p = (await sb('payments?id=eq.' + uid(b.id) + '&status=eq.pending'))[0]; if (!p) throw bad('الإيصال غير موجود أو تمت مراجعته');
      const amt = (b.amount === undefined || b.amount === '') ? Number(p.amount) : num(b.amount, 1000000);
      const tbl = p.role === 'driver' ? 'drivers' : 'merchants', u = (await sb(tbl + '?id=eq.' + p.user_id))[0]; if (!u) throw bad('الحساب غير موجود');
      const paid = r2(Number(u.paid) + amt), owed = r2((await owedOf(p.role, u)) + Number(u.paid) - paid), st2 = await getSettings();
      await sb(tbl + '?id=eq.' + u.id, { method: 'PATCH', body: { paid, ...(st2.debtLimit > 0 && owed >= st2.debtLimit ? {} : { due_at: null }) } });
      await sb('payments?id=eq.' + p.id, { method: 'PATCH', body: { status: 'approved', approved_amount: amt, decided_at: new Date().toISOString() } });
    }
    else if (op === 'payNo') await sb('payments?id=eq.' + uid(b.id) + '&status=eq.pending', { method: 'PATCH', body: { status: 'rejected', note: clean(b.note).slice(0, 200), decided_at: new Date().toISOString() } });
    else if (op === 'setDebtPolicy') {
      const days = Math.floor(Number(b.days)); if (!(days >= 1 && days <= 30)) throw bad('عدد الأيام بين 1 و30');
      await sb('settings?id=eq.1', { method: 'PATCH', body: { debt_limit: num(b.limit, 1000000), grace_days: days } });
    }
    else if (op === 'setMerchantCommission') {   // عمولة التجار: مغلقة افتراضياً، والمشرف يفتحها
      if (!['fixed', 'percent'].includes(b.ctype)) throw bad('نوع العمولة غير صحيح');
      const v = num(b.cvalue, b.ctype === 'percent' ? 100 : 100000);
      await sb('settings?id=eq.1', { method: 'PATCH', body: { mc_on: !!b.on, mc_type: b.ctype, mc_value: v } });
    }
    else if (op === 'settleMerchant') {
      const dn = await sb('orders?select=mcommission&merchant_id=eq.' + uid(b.id) + '&status=eq.done');
      await sb('merchants?id=eq.' + uid(b.id), { method: 'PATCH', body: { paid: r2(sum(dn, 'mcommission')), due_at: null } });
    }
    else if (op === 'approveMerchant') await sb('merchants?id=eq.' + uid(b.id), { method: 'PATCH', body: { approved: true } });
    else if (op === 'banMerchant' || op === 'unbanMerchant') {
      await sb('merchants?id=eq.' + uid(b.id), { method: 'PATCH', body: { banned: op === 'banMerchant' } });
      if (op === 'banMerchant') await sb('sessions?user_id=eq.' + uid(b.id), { method: 'DELETE' });
    }
    else if (op === 'delMerchant') {
      await sb('orders?merchant_id=eq.' + uid(b.id) + '&status=in.(m_new,offer,d_offer)', { method: 'PATCH', body: { status: 'cancelled' } });
      await sb('sessions?user_id=eq.' + uid(b.id), { method: 'DELETE' });
      await sb('merchants?id=eq.' + uid(b.id), { method: 'DELETE' });
    }
    else if (op === 'cancelOrder') await sb('orders?id=eq.' + uid(b.id) + '&status=in.(new,m_new,offer,d_offer,accepted,picked)', { method: 'PATCH', body: { status: 'cancelled' } });
    else if (op === 'requeue') await sb('orders?id=eq.' + uid(b.id) + '&status=in.(accepted,picked)', { method: 'PATCH', body: { status: 'new', driver_id: null } });
    else if (op === 'setCommission') {
      if (!['fixed', 'percent'].includes(b.ctype)) throw bad('نوع العمولة غير صحيح');
      const v = num(b.cvalue, b.ctype === 'percent' ? 100 : 100000);
      await sb('settings?id=eq.1', { method: 'PATCH', body: { ctype: b.ctype, cvalue: v } });
    }
    else if (op === 'setPrice') await sb('regions?id=eq.' + q(clean(b.id)), { method: 'PATCH', body: { price: num(b.price, 100000) } });
    else if (op === 'addRegion') await sb('regions', { method: 'POST', body: { id: 'c-' + crypto.randomUUID().slice(0, 8), name: str(b.name, 60, 'اكتب اسم المنطقة'), grp: b.grp === 'wb' ? 'wb' : 'gaza', price: num(b.price, 100000) } });
    else if (op === 'delRegion') { const id = clean(b.id); if (!id.startsWith('c-')) throw bad('لا يمكن حذف هذه المنطقة'); await sb('regions?id=eq.' + q(id), { method: 'DELETE' }); }
    else if (op === 'setPause') await sb('settings?id=eq.1', { method: 'PATCH', body: { paused: !!b.paused } });
    else if (op === 'setSiteName') { const n = clean(b.name).replace(/[\u0000-\u001f<>]/g, ''); if (!n || n.length > 40) throw bad('اسم الموقع من 1 إلى 40 حرفاً'); await sb('settings?id=eq.1', { method: 'PATCH', body: { site_name: n } }); }
    else if (op === 'setNotice') await sb('settings?id=eq.1', { method: 'PATCH', body: { notice: clean(b.notice).slice(0, 200) } });
    else if (op === 'block') { const p = normPhone(str(b.phone, 20, 'رقم غير صحيح')); if (p.length < 8) throw bad('رقم غير صحيح'); await sb('blocked', { method: 'POST', body: { phone: p }, prefer: 'resolution=ignore-duplicates' }); }
    else if (op === 'unblock') await sb('blocked?phone=eq.' + q(clean(b.phone)), { method: 'DELETE' });
    else throw bad('عملية غير معروفة');
    const { action, password, ...detail } = b;
    await audit('admin', op, detail);
    return { ok: true };
  }

  /* ===== المتاجر: ما يراه الزبون ===== */
  if (A === 'shops') {   // المتاجر التي في نفس قطاع الزبون فقط
    const gm = await GM(), g = gm[clean(b.region)]; if (!g) throw bad('منطقة غير صحيحة');
    const ms = await sb('merchants?select=id,shop,cat,region&approved=eq.true&banned=eq.false&or=(due_at.is.null,due_at.gt.' + q(new Date().toISOString()) + ')&order=created_at.desc&limit=100');
    return { shops: ms.filter((m) => gm[m.region] === g).map((m) => ({ id: m.id, shop: m.shop, cat: m.cat, region: m.region })) };
  }
  if (A === 'products') {
    const m = (await sb('merchants?id=eq.' + uid(b.merchant)))[0]; if (!m || !m.approved || m.banned || (m.due_at && new Date(m.due_at) < Date.now())) throw bad('المتجر غير متاح');
    return { shop: m.shop, products: (await sb('products?select=id,name,price,descr,img&avail=eq.true&merchant_id=eq.' + m.id + '&order=created_at.desc')).map((p) => ({ ...p, price: Number(p.price) })) };
  }
  if (A === 'createShopOrder') {
    const n = str(b.cname, 80, 'اكتب اسمك'), p = clean(b.cphone), ad = str(b.addr, 200, 'اكتب العنوان'), rg = clean(b.region);
    if (!phoneOk(p)) throw bad('رقم الجوال غير صحيح');
    await hit('o:' + ip, 60, 3600); await hit('op:' + normPhone(p), 10, 3600);
    const s = await getSettings(); if (s.paused) throw bad('استقبال الطلبات متوقف مؤقتاً');
    if ((await sb('blocked?phone=eq.' + q(normPhone(p)))).length) throw bad('لا يمكن استقبال طلب من هذا الرقم');
    const m = (await sb('merchants?id=eq.' + uid(b.merchant)))[0]; if (!m || !m.approved || m.banned || (m.due_at && new Date(m.due_at) < Date.now())) throw bad('المتجر غير متاح');
    const r = (await sb('regions?id=eq.' + q(rg)))[0]; if (!r) throw bad('منطقة غير صحيحة');
    if ((await GM())[m.region] !== r.grp) throw bad('هذا المتجر لا يوصّل إلى منطقتك');
    const lines = (Array.isArray(b.items) ? b.items : []).slice(0, 30);
    if (!lines.length) throw bad('اختر منتجاً واحداً على الأقل');
    const ps = await sb('products?merchant_id=eq.' + m.id + '&avail=eq.true&id=in.(' + [...new Set(lines.map((x) => uid(x.pid)))].join(',') + ')');
    const items = lines.map((x) => { const pr = ps.find((y) => y.id === x.pid), k = Math.floor(Number(x.qty)); if (!pr || !(k >= 1) || k > 20) throw bad('منتج غير متاح'); return { pid: pr.id, name: pr.name, price: Number(pr.price), qty: k }; });
    const itemsTotal = r2(items.reduce((t, i) => t + i.price * i.qty, 0)), price = Number(r.price), c = r2(fee(price, s));
    const o = (await sb('orders', { method: 'POST', prefer: 'return=representation', body: { cname: n, cphone: p, region: rg, addr: ad, note: clean(b.note).slice(0, 300), status: 'm_new', merchant_id: m.id, items, items_total: itemsTotal, mcommission: mfee(itemsTotal, s), price, commission: c, total: r2(itemsTotal + price + c) } }))[0];
    return { id: o.id, secret: o.secret, total: Number(o.total) };
  }
  if (['candidates', 'custApprove', 'custReject', 'custPick', 'custPool'].includes(A)) {   // قرار الزبون في عرض السائق
    const o = (await sb('orders?id=eq.' + uid(b.id) + '&secret=eq.' + q(clean(b.secret))))[0];
    if (!o || o.status !== 'offer') throw bad('لا يمكن تنفيذ ذلك الآن');
    const P = (body) => sb('orders?id=eq.' + o.id + '&status=eq.offer', { method: 'PATCH', body });
    if (A === 'candidates') return { drivers: await eligible(o.region) };
    if (A === 'custApprove') { if (!o.driver_id) throw bad('اختر سائقاً أولاً'); await P({ status: 'd_offer' }); }
    else if (A === 'custReject') await P({ driver_id: null });
    else if (A === 'custPool') await P({ status: 'new', driver_id: null });
    else { const d = (await eligible(o.region)).find((x) => x.id === b.driver); if (!d) throw bad('هذا السائق غير متاح'); await P({ driver_id: d.id, status: 'd_offer' }); }
    return { ok: true };
  }
  if (A === 'refuse') {   // السائق يرفض عرضاً مباشراً فيعود للزبون ليختار غيره
    const d = await me(req);
    const r = await sb('orders?id=eq.' + uid(b.id) + '&driver_id=eq.' + d.id + '&status=eq.d_offer', { method: 'PATCH', body: { status: 'offer', driver_id: null }, prefer: 'return=representation' });
    if (!r || !r.length) throw bad('لا يمكن تنفيذ هذا الإجراء الآن');
    return { ok: true };
  }

  /* ===== حساب المتجر ===== */
  if (A === 'mRegister') {
    await hit('r:' + ip, 20, 3600);
    const n = str(b.name, 80, 'اكتب اسمك'), sh = str(b.shop, 80, 'اكتب اسم المتجر'), ad = str(b.addr, 200, 'اكتب عنوان المتجر'), p = clean(b.phone), pw = String(b.pass || '');
    if (!CATS.includes(b.cat)) throw bad('اختر نوع المتجر');
    if (!phoneOk(p) || pw.length < 6 || pw.length > 100) throw bad('اكتب جوالاً صحيحاً وكلمة سر من 6 أحرف على الأقل');
    const r = await sb('rpc/register_merchant', { method: 'POST', body: { p_name: n, p_shop: sh, p_cat: b.cat, p_phone: p, p_pass: pw, p_region: clean(b.region), p_addr: ad, p_id: img(b.idImg) } });
    if (r !== 'ok') throw bad(r);
    return { ok: true };
  }
  if (A === 'mLogin') {
    const p = clean(b.phone), k = 'mp:' + p, k2 = 'i:' + ip;
    await locked(k, 8); await locked(k2, 40);
    const id = await sb('rpc/login_merchant', { method: 'POST', body: { p_phone: p, p_pass: String(b.pass || '') } });
    if (!id) { await bump(k, 900); await bump(k2, 900); throw bad('بيانات غير صحيحة أو الحساب موقوف'); }
    const m = (await sb('merchants?select=shop,approved&id=eq.' + id))[0];
    return { shop: m.shop, approved: m.approved, _c: [setC('sm', await newSession('merchant', id, 7 * 86400), 7 * 86400)] };
  }
  if (A === 'pay') {   // رفع صورة إشعار الدفع (للسائق أو التاجر)
    const role = b.role === 'merchant' ? 'merchant' : 'driver', u = role === 'driver' ? await me(req) : await meM(req);
    await hit('pay:' + u.id, 6, 86400);
    const owed = await owedOf(role, u);
    if (!(owed > 0)) throw bad('لا توجد عمولة مستحقة عليك');
    if ((await sb('payments?select=id&user_id=eq.' + u.id + '&status=eq.pending')).length >= 2) throw bad('لديك إيصالات قيد المراجعة، انتظر قرار المشرف');
    await sb('payments', { method: 'POST', body: { role, user_id: u.id, who: role === 'driver' ? u.name : u.shop, amount: b.amount ? num(b.amount, 1000000) : owed, receipt: img(b.receipt), ref: clean(b.ref).slice(0, 60) } });
    return { ok: true };
  }
  if (A === 'mLogout') { await endSession(req, 'merchant'); return { ok: true, _c: [setC('sm', '', 0)] }; }

  if (['mState', 'mOrders', 'mProduct', 'mPref', 'mAssign', 'mReject'].includes(A)) {
    const m = await meM(req);
    if (!m.approved) return A === 'mState' ? { approved: false, shop: m.shop } : (() => { throw bad('حسابك بانتظار الموافقة'); })();
    const ordersOf = async () => {
      const os = await sb('orders?merchant_id=eq.' + m.id + '&order=created_at.desc&limit=50');
      const ids = [...new Set(os.map((o) => o.driver_id).filter(Boolean))];
      const dn = ids.length ? await sb('drivers?select=id,name&id=in.(' + ids.join(',') + ')') : [];
      return os.map((o) => ({ ...pubOrder(o), cname: o.cname, cphone: o.cphone, region: o.region, mcommission: Number(o.mcommission), total: Number(o.total), delivery: r2(Number(o.price) + Number(o.commission)), driver_id: o.driver_id, driver: (dn.find((d) => d.id === o.driver_id) || {}).name || null }));
    };
    if (A === 'mOrders') return { orders: await ordersOf() };
    if (A === 'mState') {
      const gm = await GM(), g = gm[m.region];
      const [ps, ds, md, st] = await Promise.all([sb('products?merchant_id=eq.' + m.id + '&order=created_at.desc'), sb('drivers?select=id,name,veh,scope&approved=eq.true&banned=eq.false&limit=300'), sb('orders?select=items_total,mcommission&merchant_id=eq.' + m.id + '&status=eq.done'), getSettings()]);
      const gd = ds.filter((d) => (d.scope.startsWith('ALL:') ? d.scope.slice(4) : gm[d.scope]) === g);
      const rt = await rates(gd.map((d) => d.id));
      return { approved: true, shop: m.shop, region: m.region, pref: m.pref_driver, mc: st.mc, debt: await debtInfo('merchant', m, st, r2(sum(md, 'mcommission') - Number(m.paid))), stats: { n: md.length, sales: r2(sum(md, 'items_total')), owed: r2(sum(md, 'mcommission') - Number(m.paid)) }, drivers: gd.map((d) => dcard(d, rt)), orders: await ordersOf(),
        products: ps.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), descr: p.descr, img: p.img, avail: p.avail })) };
    }
    if (A === 'mProduct') {
      const op = b.op;
      if (op === 'add') {
        if ((await sb('products?select=id&merchant_id=eq.' + m.id)).length >= 40) throw bad('وصلت للحد الأقصى (40 منتجاً)');
        await sb('products', { method: 'POST', body: { merchant_id: m.id, name: str(b.name, 60, 'اكتب اسم المنتج'), price: num(b.price, 100000), descr: clean(b.descr).slice(0, 200), img: b.img ? img(b.img, 45000) : null } });
      } else if (op === 'toggle') {
        const p = (await sb('products?id=eq.' + uid(b.id) + '&merchant_id=eq.' + m.id))[0]; if (!p) throw bad('المنتج غير موجود');
        await sb('products?id=eq.' + p.id, { method: 'PATCH', body: { avail: !p.avail } });
      } else if (op === 'del') await sb('products?id=eq.' + uid(b.id) + '&merchant_id=eq.' + m.id, { method: 'DELETE' });
      else throw bad('عملية غير معروفة');
      return { ok: true };
    }
    if (A === 'mPref') {   // السائق المحدد مسبقاً للمتجر (اقتراحه الأول عند التحويل)
      let id = null;
      if (b.driver) {
        const gm = await GM(), d = (await sb('drivers?select=id,scope&id=eq.' + uid(b.driver) + '&approved=eq.true&banned=eq.false'))[0];
        if (!d || (d.scope.startsWith('ALL:') ? d.scope.slice(4) : gm[d.scope]) !== gm[m.region]) throw bad('هذا السائق غير متاح لمنطقتك');
        id = d.id;
      }
      await sb('merchants?id=eq.' + m.id, { method: 'PATCH', body: { pref_driver: id } });
      return { ok: true };
    }
    const o = (await sb('orders?id=eq.' + uid(b.id) + '&merchant_id=eq.' + m.id + '&status=eq.m_new'))[0];
    if (!o) throw bad('لا يمكن تنفيذ ذلك الآن');
    const P = (body) => sb('orders?id=eq.' + o.id + '&status=eq.m_new', { method: 'PATCH', body });
    if (A === 'mReject') await P({ status: 'cancelled' });
    else if (b.pool) await P({ status: 'new', driver_id: null });
    else { const d = (await eligible(o.region)).find((x) => x.id === b.driver); if (!d) throw bad('هذا السائق غير متاح في منطقة الزبون'); await P({ status: 'offer', driver_id: d.id }); }
    return { ok: true };
  }

  throw bad('طلب غير معروف');
}
