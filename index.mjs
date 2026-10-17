// وسيط Vercel: يحفظ الجلسات في كوكي HttpOnly ويمرّر الطلبات إلى Google Apps Script
const NAMES = ['sa', 'sd', 'sm'];
const J = (o, cookies = []) => {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  cookies.forEach((c) => h.append('Set-Cookie', c));
  return new Response(JSON.stringify(o), { headers: h });
};
const cookieOf = (req, n) => { const m = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith('__Host-' + n + '=')); return m ? m.slice(n.length + 8) : ''; };

export async function POST(request) {
  try {
    const { GAS_URL, GAS_SECRET } = process.env;
    if (!GAS_URL || !GAS_SECRET) return J({ error: 'الخادم غير مهيأ بعد' });
    const o = request.headers.get('origin');
    if (!o || new URL(o).host !== new URL(request.url).host) return J({ error: 'مرفوض' });   // حماية CSRF
    const req = await request.json();
    const ip = (request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || 'x').split(',')[0]).trim();
    const tokens = { admin: cookieOf(request, 'sa'), driver: cookieOf(request, 'sd'), merchant: cookieOf(request, 'sm') };
    const r = await fetch(GAS_URL.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: GAS_SECRET.trim(), ip, tokens, req }), redirect: 'follow' });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch (e) { console.error('[gas] ' + r.status + ' ' + t.slice(0, 200)); return J({ error: 'تعذر الاتصال بقاعدة البيانات، حاول بعد قليل' }); }
    const c = (j._c || []).filter((x) => NAMES.includes(x.n)).map((x) => `__Host-${x.n}=${x.v}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${x.age}`);
    delete j._c;
    return J(j, c);
  } catch (e) { console.error('[api]', e && e.message); return J({ error: 'حدث خطأ، حاول مرة أخرى' }); }
}

// فحص الإعداد: افتح /api في المتصفح (لا يكشف أي سر)
export async function GET() {
  const { GAS_URL, GAS_SECRET } = process.env;
  const out = { env: [!GAS_URL && 'GAS_URL', !GAS_SECRET && 'GAS_SECRET'].filter(Boolean).join(' , ') || 'ok', apps_script: '-' };
  if (out.env !== 'ok') { out.env = 'ناقص: ' + out.env; return J(out); }
  try {
    const r = await fetch(GAS_URL.trim(), { redirect: 'follow' }); const j = JSON.parse(await r.text());
    out.apps_script = j.server === 'ok' ? 'ok' : 'رد غير متوقع';
    out.API_SECRET = j.secret ? 'ok' : 'ناقص في Script Properties';
    out.ADMIN_NAME = j.adminName ? 'ok' : 'ناقص في Script Properties';
    out.ADMIN_PASSWORD = j.adminPassword ? 'ok' : 'ناقص أو أقل من 12 حرفاً';
  } catch (e) { out.apps_script = 'تعذر الوصول: تأكد أن رابط النشر ينتهي بـ /exec وأن الوصول "Anyone"'; }
  return J(out);
}
