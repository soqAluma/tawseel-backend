// الواجهة الخلفية — الجزء 4: المشرف وموزّع الطلبات
function routeB(b) {
  const A = b.action;
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
    const nameOk = same(clean(b.name), prop('ADMIN_NAME')), passOk = same(b.password || '', prop('ADMIN_PASSWORD')), ok = nameOk && passOk;   // نقيس الاثنين دائماً
    if (!ok) { bump('a:' + IP, 900); bump('a:all', 3600); audit('admin', 'login_failed', { ip: IP }); throw bad('بيانات الدخول غير صحيحة'); }
    killSessions((r) => r.role === 'admin');   // جلسة واحدة فقط: الدخول الجديد يُسقط أي جلسة قديمة
    audit('admin', 'login', { ip: IP });
    return { ok: true, _c: [{ n: 'sa', v: newSession('admin', '', 7200), age: 7200 }] };
  }
  if (A === 'adminLogout') { endSession(TK.admin); return { ok: true, _c: [{ n: 'sa', v: '', age: 0 }] }; }

  if (A === 'adminState') {
    needAdmin();
    const st = getSet();
    if (st.debtLimit > 0 || rows('drivers').some((d) => d.due_at)) {   // يضبط مهل المتأخرين دفعة واحدة
      const need = rows('drivers').filter((d) => { const ow = owedOf('driver', d), over = st.debtLimit > 0 && ow >= st.debtLimit; return (over && !d.due_at) || (!over && d.due_at); });
      if (need.length) withLock(() => { MEM = {}; rows('drivers').forEach((d) => syncDue('driver', d, st, owedOf('driver', d))); });
    }
    const ds = rows('drivers'), os = rows('orders'), dn = os.filter((o) => o.status === 'done'), pays = rows('payments'), okp = pays.filter((p) => p.status === 'approved');
    const live = Object.fromEntries(liveDrivers().map((x) => [x.d.id, x]));
    const drivers = ds.map((d) => { const x = dn.filter((o) => o.driver_id === d.id); return { id: d.id, name: d.name, phone: d.phone, veh: d.veh, scope: d.scope, approved: d.approved === 'Y', banned: d.banned === 'Y', online: d.online === 'Y', paid: +d.paid, n: x.length, avg: avgOf(x), owed: r2(sum(x, 'commission') - Number(d.paid)), due_at: d.due_at || null, loc: live[d.id] ? { lat: live[d.id].lat, lng: live[d.id].lng, ago: Math.round((Date.now() - live[d.id].t) / 1000) } : null }; });
    const today = day(Date.now()), month = today.slice(0, 7), within = (list, k, pre) => list.filter((x) => x[k] && day(x[k]).indexOf(pre) === 0);
    const earn = (list) => r2(sum(list, 'commission') + sum(list, 'mcommission'));
    const report = { earned: earn(dn), earnedDelivery: r2(sum(dn, 'commission')), earnedMerchants: r2(sum(dn, 'mcommission')), received: r2(sum(okp, 'approved_amount')),
      earnedToday: earn(within(dn, 'done_at', today)), earnedMonth: earn(within(dn, 'done_at', month)),
      receivedToday: r2(sum(within(okp, 'decided_at', today), 'approved_amount')), receivedMonth: r2(sum(within(okp, 'decided_at', month), 'approved_amount')),
      outstanding: r2(drivers.reduce((a, d) => a + Math.max(0, d.owed), 0)), pending: pays.filter((p) => p.status === 'pending').length, payers: new Set(okp.map((p) => p.user_id)).size };
    return { settings: st, blocked: rows('blocked').map((x) => x.phone), merchants: [], report,
      users: rows('users').slice(-100).reverse().map((u) => ({ id: u.id, username: u.username, banned: u.banned === 'Y', n: os.filter((o) => o.user_id === u.id).length, created_at: u.created_at })),
      accounts: rows('pay_accounts').map((a) => ({ id: a.id, type: a.type, name: a.name, number: a.number, note: a.note, active: a.active === 'Y' })),
      payments: pays.slice(-50).reverse().map((p) => ({ id: p.id, role: p.role, who: p.who, amount: +p.amount, status: p.status, note: p.note, approved_amount: p.approved_amount ? +p.approved_amount : null, created_at: p.created_at, hasReceipt: !!p.receiptFile })),
      audit: rows('audit').slice(-30).reverse().map((a) => { let det = {}; try { det = JSON.parse(a.detail); } catch (e) { } return { at: a.at, who: a.who, action: a.action, detail: det }; }),
      regions: regionsAll().map((r) => ({ id: r.id, name: r.name, group: r.grp, price: +r.price })), drivers,
      orders: os.slice(-200).reverse().map((o) => Object.assign(pubOrder(o), { cname: o.cname, cphone: o.cphone, driver_id: o.driver_id || null, shop: null, price: +o.price, commission: +o.commission, total: +o.total, rating: ratingOf(o) })),
      totals: { n: dn.length, price: r2(sum(dn, 'price')), commission: r2(sum(dn, 'commission')), mcommission: r2(sum(dn, 'mcommission')) } };
  }
  if (A === 'adminReceipt') {   // صورة إيصال الدفع: لا تخرج إلا هنا، وكل مشاهدة تُسجّل
    needAdmin();
    const p = rows('payments').find((x) => x.id === b.id);
    audit('admin', 'view_receipt', { payment: b.id });
    return { receipt: p ? readImg(p.receiptFile) : null };
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
    else if (op === 'settle') {   // تسوية يدوية (استلمت المبلغ نقداً): تُسجّل في سجل المدفوعات
      const d = drv(), total = r2(sum(rows('orders').filter((o) => o.driver_id === d.id && o.status === 'done'), 'commission')), delta = r2(total - Number(d.paid));
      if (delta > 0) ins('payments', { id: Utilities.getUuid(), role: 'driver', user_id: d.id, who: d.name, amount: String(delta), receiptFile: '', ref: 'تسوية يدوية', status: 'approved', note: 'سجّلها المشرف يدوياً', approved_amount: String(delta), created_at: now(), decided_at: now() });
      upd('drivers', d, { paid: String(total), due_at: '' });
    }
    else if (op === 'banUser' || op === 'unbanUser') {
      const u = rows('users').find((x) => x.id === b.id); if (!u) throw bad('المستخدم غير موجود');
      upd('users', u, { banned: op === 'banUser' ? 'Y' : 'N' }); if (op === 'banUser') killSessions((r) => r.user_id === u.id);
    }
    else if (op === 'payOk') {   // اعتماد إيصال: يُضاف المبلغ لمدفوعات الحساب وتُلغى المهلة إن نزلت العمولة تحت الحد
      const p = rows('payments').find((x) => x.id === b.id && x.status === 'pending'); if (!p) throw bad('الإيصال غير موجود أو تمت مراجعته');
      const amt = (b.amount === undefined || b.amount === '') ? Number(p.amount) : num(b.amount, 1000000);
      const tbl = p.role === 'driver' ? 'drivers' : 'merchants', u = rows(tbl).find((x) => x.id === p.user_id); if (!u) throw bad('الحساب غير موجود');
      const paid = r2(Number(u.paid) + amt), owed = r2(owedOf(p.role, u) + Number(u.paid) - paid), st = getSet();
      upd(tbl, u, { paid: String(paid), due_at: (st.debtLimit > 0 && owed >= st.debtLimit) ? u.due_at : '' });
      upd('payments', p, { status: 'approved', approved_amount: String(amt), decided_at: now() });
    }
    else if (op === 'payNo') { const p = rows('payments').find((x) => x.id === b.id && x.status === 'pending'); if (!p) throw bad('الإيصال غير موجود أو تمت مراجعته'); upd('payments', p, { status: 'rejected', note: clean(b.note).slice(0, 200), decided_at: now() }); }
    else if (op === 'setDebtPolicy') { const days = Math.floor(Number(b.days)); if (!(days >= 1 && days <= 30)) throw bad('عدد الأيام بين 1 و30'); setSet('debt_limit', num(b.limit, 1000000)); setSet('grace_days', days); }
    else if (op === 'addAccount') ins('pay_accounts', { id: 'a-' + rnd().slice(0, 8), type: str(b.type, 40, 'اختر نوع الحساب'), name: str(b.name, 60, 'اكتب اسم صاحب الحساب'), number: str(b.number, 40, 'اكتب رقم الحساب أو المحفظة'), note: clean(b.note).slice(0, 120), active: 'Y' });
    else if (op === 'delAccount') delRows('pay_accounts', rows('pay_accounts').filter((a) => a.id === clean(b.id)));
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
}

function route(b) {
  const r = routeA(b); if (r !== undefined) return r;
  const r2 = routeB(b); if (r2 !== undefined) return r2;
  throw bad('طلب غير معروف');
}
