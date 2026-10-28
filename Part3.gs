// الواجهة الخلفية — الجزء 3: الطلبات والزبون والسائق
function routeA(b) {
  const A = b.action;
  if (A === 'ping') return { ok: true };

  /* ===== عام ===== */
  if (A === 'regions') {
    const s = getSet();
    const rs = regionsAll().slice().sort((a, c) => a.grp === c.grp ? a.name.localeCompare(c.name, 'ar') : (a.grp < c.grp ? -1 : 1));
    return { regions: rs.map((r) => ({ id: r.id, name: r.name, group: r.grp, total: r2(+r.price + fee(+r.price, s)) })), paused: s.paused, notice: s.notice, site: s.siteName };
  }
  if (A === 'createOrder') {
    const cu = customer();   // الطلب يتطلب حساباً مسجَّلاً
    const n = str(b.cname, 80, 'اكتب اسمك'), p = clean(b.cphone), ad = str(b.addr, 200, 'اكتب العنوان'), rg = clean(b.region);
    if (!phoneOk(p)) throw bad('رقم الجوال غير صحيح');
    hit('o:' + IP, 60, 3600); hit('op:' + normPhone(p), 10, 3600);
    const s = getSet(); if (s.paused) throw bad('استقبال الطلبات متوقف مؤقتاً');
    if (rows('blocked').some((x) => x.phone === normPhone(p))) throw bad('لا يمكن استقبال طلب من هذا الرقم');
    const r = regionsAll().find((x) => x.id === rg); if (!r) throw bad('منطقة غير صحيحة');
    let lat = '', lng = '';
    if (b.lat !== undefined && b.lat !== null && b.lat !== '') { const a1 = Number(b.lat), a2 = Number(b.lng); if (!inBox(a1, a2)) throw bad('الموقع خارج النطاق المتوقع'); lat = String(Math.round(a1 * 1e5) / 1e5); lng = String(Math.round(a2 * 1e5) / 1e5); }
    const price = +r.price, c = r2(fee(price, s)), id = Utilities.getUuid(), secret = rnd().slice(0, 16);
    ins('orders', { lat, lng, id, secret, cname: n, cphone: p, region: rg, addr: ad, note: clean(b.note).slice(0, 300), status: 'new', items_total: '0', mcommission: '0', price, commission: c, total: r2(price + c), created_at: now(), user_id: cu.id });
    return { id, secret, total: r2(price + c) };
  }
  if (A === 'track') {   // لا يرى الطلب إلا من يملك رمزه السري
    const list = (Array.isArray(b.orders) ? b.orders : []).slice(0, 30), ds = rows('drivers');
    const os = rows('orders').filter((o) => list.some((x) => x && x.id === o.id && x.secret === o.secret)).reverse();
    return { orders: os.map((o) => { const d = ds.find((x) => x.id === o.driver_id), live = ['accepted', 'picked', 'done'].indexOf(o.status) >= 0;
      return Object.assign(pubOrder(o), { total: +o.total, delivery: r2(+o.price + +o.commission), rating: ratingOf(o), shop: null, driver: d && live ? { name: d.name, phone: d.phone } : null, proposal: null }); }) };
  }
  if (A === 'cancel') {
    const o = ownOrder(b);
    if (!o || ['new', 'm_new', 'offer', 'd_offer'].indexOf(o.status) < 0) throw bad('لا يمكن الإلغاء بعد قبول السائق');
    upd('orders', o, { status: 'cancelled' }); return { ok: true };
  }
  if (A === 'rate') {
    const n = Number(b.n); if ([1, 2, 3, 4, 5].indexOf(n) < 0) throw bad('تقييم غير صحيح');
    const o = ownOrder(b);
    if (!o || o.status !== 'done' || o.rating) throw bad('لا يمكن التقييم');
    upd('orders', o, { rating: String(n) }); return { ok: true };
  }

  /* ===== حساب الزبون ===== */
  if (A === 'uRegister') {
    hit('ur:' + IP, 20, 3600);
    const un = clean(b.username), pw = String(b.pass || '');
    if (!/^[A-Za-z0-9_.\u0600-\u06FF]{3,30}$/.test(un)) throw bad('اسم المستخدم من 3 إلى 30 حرفاً (حروف وأرقام و _ و .)');
    if (pw.length < 8 || pw.length > 100) throw bad('كلمة المرور 8 أحرف على الأقل');
    if (pw !== String(b.pass2 || '')) throw bad('كلمتا المرور غير متطابقتين');
    const key = un.toLowerCase();
    if (rows('users').some((x) => x.username === key)) throw bad('اسم المستخدم مستخدم من قبل');
    const id = Utilities.getUuid(), salt = rnd().slice(0, 16);
    ins('users', { id, username: key, salt, hash: hashPw(pw, salt), banned: 'N', created_at: now() });
    return { username: key, _c: [{ n: 'su', v: newSession('customer', id, 7 * 86400), age: 7 * 86400 }] };
  }
  if (A === 'uLogin') {
    const un = clean(b.username).toLowerCase(), k = 'u:' + un, k2 = 'i:' + IP;
    locked(k, 8); locked(k2, 40);
    const u = rows('users').find((x) => x.username === un && x.banned !== 'Y');
    const okPw = same(hashPw(String(b.pass || ''), u ? u.salt : 'x'), u ? u.hash : 'y');   // نفس الزمن سواء وُجد المستخدم أم لا
    if (!u || !okPw) { bump(k, 900); bump(k2, 900); throw bad('اسم المستخدم أو كلمة المرور غير صحيحة'); }
    return { username: u.username, _c: [{ n: 'su', v: newSession('customer', u.id, 7 * 86400), age: 7 * 86400 }] };
  }
  if (A === 'uLogout') { endSession(TK.customer); return { ok: true, _c: [{ n: 'su', v: '', age: 0 }] }; }
  if (A === 'myOrders') {
    const u = customer(), ds = rows('drivers');
    return { username: u.username, orders: rows('orders').filter((o) => o.user_id === u.id).reverse().slice(0, 50).map((o) => customerView(o, ds)) };
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
    const debt = debtInfo('driver', d, getSet(), r2(sum(dn, 'commission') - Number(d.paid)));
    const L = getLoc(d.id), dd = (o) => (L && o.lat && o.lng) ? Math.round(dist(L.lat, L.lng, +o.lat, +o.lng) * 10) / 10 : null;
    return { approved: true, name: d.name, scope: d.scope, online: on, max: MAX_ACTIVE, debt,
      stats: { n: dn.length, today: dn.filter((o) => o.done_at && day(o.done_at) === today).length, earn: r2(sum(dn, 'price')), owed: r2(sum(dn, 'commission') - Number(d.paid)), avg: avgOf(dn) },
      history: dn.slice(0, 8).map((o) => ({ region: o.region, addr: o.addr, price: +o.price, rating: ratingOf(o) })),
      loc: !!L,
      mine: mine.map((o) => Object.assign(pubOrder(o), { cname: o.cname, cphone: o.cphone, price: +o.price, commission: +o.commission, total: +o.total, lat: o.lat ? +o.lat : null, lng: o.lng ? +o.lng : null })),
      offers: [], available: on && !(debt && debt.suspended) ? news.map((o) => Object.assign(pubOrder(o), { price: +o.price, dist: dd(o) })).sort((a, c) => ((a.dist == null) - (c.dist == null)) || ((a.dist || 0) - (c.dist || 0))) : [] };
  }
  if (A === 'proxToken') {   // التحقق من التسليم بالبلوتوث: الزبون وحده يعرف رمز طلبه ويبثّه، ولا يُعطى للسائق
    const u = customer(), o = rows('orders').find((x) => x.id === b.id && x.user_id === u.id);
    if (!o || ['accepted', 'picked'].indexOf(o.status) < 0) throw bad('لا يوجد طلب قيد التوصيل');
    if (!o.ptoken) upd('orders', o, { ptoken: rnd().slice(0, 16) });
    return { token: o.ptoken };
  }
  if (A === 'proxSeen') {   // السائق يبلّغ بما سمعه من أجهزة قريبة؛ يُعتمد فقط إن طابق رمز طلبه الجاري
    const d = me(); hit('px:' + d.id, 60, 600);
    const out = [], best = {};   // ندمج الرموز المكررة ونأخذ أقوى إشارة لكل رمز
    (Array.isArray(b.tokens) ? b.tokens : []).slice(0, 10).forEach((t) => {
      const tok = clean(t && t.token).toLowerCase(), rs = Number(t && t.rssi);
      if (/^[0-9a-f]{16}$/.test(tok)) best[tok] = Math.max(best[tok] === undefined ? -999 : best[tok], isNaN(rs) ? -999 : rs);
    });
    Object.keys(best).forEach((tok) => {
      const o = rows('orders').find((x) => x.ptoken === tok && x.driver_id === d.id && ['accepted', 'picked'].indexOf(x.status) >= 0);
      if (o) { upd('orders', o, { near_at: o.near_at || now(), near_rssi: String(Math.max(Number(o.near_rssi || -999), best[tok])) }); out.push(o.id); }
    });
    return { confirmed: out };
  }
  if (A === 'toggle') { const d = me(); upd('drivers', d, { online: d.online === 'Y' ? 'N' : 'Y' }); if (d.online !== 'Y') cache().remove('loc_' + d.id); return { ok: true }; }
  if (A === 'loc') {   // السائق المتاح يرسل موقعه ما دامت صفحته مفتوحة
    const d = me(); if (d.approved !== 'Y' || d.online !== 'Y') return { ok: false };
    hit('loc:' + d.id, 60, 300);
    const lat = Number(b.lat), lng = Number(b.lng); if (!inBox(lat, lng)) throw bad('الموقع خارج النطاق المتوقع');
    cache().put('loc_' + d.id, JSON.stringify({ lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, t: Date.now() }), LOC_TTL);
    return { ok: true };
  }
  if (A === 'nearby') {   // للزبون: كم سائقاً متاحاً قريباً؟ (عدد فقط، دون هوية أو إحداثيات)
    const u = customer(); hit('nb:' + u.id, 12, 3600);
    const lat = Math.round(Number(b.lat) * 100) / 100, lng = Math.round(Number(b.lng) * 100) / 100;
    if (!inBox(lat, lng)) throw bad('الموقع خارج النطاق المتوقع');
    const gm = GM(), rg = clean(b.region);
    const ks = liveDrivers().filter((x) => !rg || covers(x.d.scope, rg, gm)).map((x) => dist(lat, lng, x.lat, x.lng)).filter((k) => k <= NEAR_KM).sort((a, c) => a - c);
    return { count: ks.length, nearest: ks.length ? Math.max(1, Math.round(ks[0])) : null, radius: NEAR_KM };
  }
  if (A === 'accept') {
    const d = me(), os = rows('orders'), o = os.find((x) => x.id === b.id);
    if (d.approved !== 'Y' || d.online !== 'Y') throw bad('لا يمكنك قبول الطلبات الآن (تأكد أنك معتمد ومتاح)');
    const st0 = getSet(); if (st0.debtLimit > 0 || d.due_at) { const due = syncDue('driver', d, st0, owedOf('driver', d)); if (due && due.getTime() < Date.now()) throw bad('حسابك موقوف بسبب عمولة مستحقة. ادفع وارفع صورة الإشعار من لوحتك.'); }
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

  if (A === 'pay') {   // رفع صورة إشعار الدفع
    const u = me(); hit('pay:' + u.id, 6, 21600);
    const owed = owedOf('driver', u);
    if (!(owed > 0)) throw bad('لا توجد عمولة مستحقة عليك');
    if (rows('payments').filter((p) => p.user_id === u.id && p.status === 'pending').length >= 2) throw bad('لديك إيصالات قيد المراجعة، انتظر قرار المشرف');
    const f = saveImg(b.receipt, 'receipt-' + rnd().slice(0, 8));
    ins('payments', { id: Utilities.getUuid(), role: 'driver', user_id: u.id, who: u.name, amount: b.amount ? num(b.amount, 1000000) : owed, receiptFile: f, ref: clean(b.ref).slice(0, 60), status: 'pending', created_at: now() });
    return { ok: true };
  }

}
