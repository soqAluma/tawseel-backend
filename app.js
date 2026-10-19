'use strict';
const $=id=>document.getElementById(id),V=id=>$(id).value.trim();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
const GN={gaza:"قطاع غزة",wb:"الضفة الغربية"};
const AR={new:"بانتظار سائق",accepted:"قبله سائق",picked:"في الطريق",done:"تم التوصيل",cancelled:"ملغي"};
const STEPS=['new','accepted','picked','done'],SL=['تم الطلب','قبله سائق','في الطريق','تم التوصيل'];
const norm=p=>String(p).replace(/\D/g,'');
const money=n=>(+n).toLocaleString('en',{maximumFractionDigits:2})+' ₪';
const wa=p=>'https://wa.me/'+norm(p).replace(/^0/,'970');
const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
const okImg=x=>typeof x==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(x);
let tab='c',R=[],CO=[],ADM=null,adminName='',KY={},stream=null,selfie=null,idImg=null,busy=false,again=false,tick=0,payImg=null,RC={};
const reg=id=>R.find(r=>r.id===id);
const scopeName=v=>v==="ALL:gaza"?"قطاع غزة كله":v==="ALL:wb"?"الضفة كلها":(reg(v)?.name||"—");
const mapUrl=o=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(o.addr+' '+(reg(o.region)?.name||'')+' فلسطين');

function toast(t){const e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',3500)}
async function api(action,data={}){let j;
 try{const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})});j=await r.json()}
 catch(e){throw new Error('تعذر الاتصال بالخادم، تحقق من الإنترنت')}
 if(j.error)throw Object.assign(new Error(j.error),{expired:j.error.startsWith('انتهت الجلسة')});return j}
const run=async f=>{try{await f()}catch(e){toast(e.message);if(e.expired){if(tab==='c')ls.set('su',0);if(tab==='d')ls.set('sd',0);refresh()}}};

async function loadRegions(){const j=await api('regions');R=j.regions;setSite(j.site);$('banner').hidden=!(j.paused||j.notice);$('banner').textContent=[j.paused?'استقبال الطلبات متوقف مؤقتاً.':'',j.notice].filter(Boolean).join(' ');fillSelects()}
function setSite(n){if(!n)return;$('site').textContent=n;document.title=n;ls.set('site',n)}
function opts(all){let h=all?`<option value="ALL:gaza">قطاع غزة كله</option><option value="ALL:wb">الضفة كلها</option>`:"";
 for(const g in GN){const rs=R.filter(r=>r.group===g);if(rs.length)h+=`<optgroup label="${GN[g]}">`+rs.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")+`</optgroup>`}return h}
function fillSelects(){const a=$('c_region').value,b=$('r_scope').value;$('c_region').innerHTML=opts(false);$('r_scope').innerHTML=opts(true);if(a&&reg(a))$('c_region').value=a;if(b)$('r_scope').value=b;showPrice()}
function showPrice(){const r=reg($('c_region').value),e=$('c_price');e.hidden=!r;if(r)e.textContent='سعر التوصيل: '+money(r.total)+' (يُدفع نقداً للسائق)'}
function showTab(t){if(t!=='d')camStop();tab=t;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t===t));document.querySelectorAll('section').forEach(x=>x.classList.toggle('on',x.id===t));if(t==='c')run(loadRegions);refresh()}

function renderDebt(d){const box=$('d_pay');
 if(!d||!(d.owed>0)){box.hidden=true;$('d_acc').innerHTML='';return}
 box.hidden=false;
 const st=d.suspended?'<span class="bad">حسابك موقوف حتى تدفع</span>':d.due?`المهلة: تبقّى ${d.left} يوم`:(d.limit>0?`الحد المسموح ${money(d.limit)}`:'');
 $('d_acc').innerHTML=`<div class="note"><b>المطلوب دفعه: ${money(d.owed)}</b><br>${st}</div>`+
  `<div class="mute" style="margin-top:8px">حوّل المبلغ إلى أحد الحسابات التالية ثم ارفع صورة الإشعار:</div>`+
  (d.accounts.length?d.accounts.map(a=>`<div class="item"><b>${esc(a.type)}</b> — ${esc(a.name)}<div dir="ltr" style="text-align:start"><b>${esc(a.number)}</b></div>${a.note?`<div class="mute">${esc(a.note)}</div>`:''}</div>`).join(''):'<p class="mute">لم يحدد المشرف حساباً للدفع بعد، تواصل معه.</p>')+
  d.notices.map(n=>`<div class="mute">🔔 ${esc(n.text)}</div>`).join('')+
  d.payments.map(p=>`<div class="mute">إشعارك بقيمة ${money(p.amount)}: ${p.status==='approved'?'تم اعتماده':p.status==='rejected'?'مرفوض'+(p.note?' ('+esc(p.note)+')':''):'قيد المراجعة'}</div>`).join('')}
function steps(o){if(o.status==='cancelled')return'';const i=STEPS.indexOf(o.status);return`<div class="steps">${SL.map((t,k)=>`<span class="${k<=i?'on':''}">${t}</span>`).join('')}</div>`}
function card(o,v){
 const B=(a,t,c='')=>`<button class="b ${c}" data-act="${a}" data-id="${esc(o.id)}">${t}</button>`;
 const links=p=>`<a href="tel:${esc(p)}">اتصال</a> <a href="${wa(p)}" target="_blank" rel="noopener noreferrer">واتساب</a>`;
 const map=`<a href="${mapUrl(o)}" target="_blank" rel="noopener noreferrer">الخريطة</a>`;
 let h=`<div class="item"><b>${esc(reg(o.region)?.name||"—")}</b>`+(o.status?` <span class="pill s-${o.status}">${AR[o.status]}</span>`:'')+`<div>${esc(o.addr)}</div>`+(o.note?`<div class="mute">${esc(o.note)}</div>`:'');
 if(v==='c'){h+=steps(o)+`<div class="mute">المبلغ: ${money(o.total)} نقداً للسائق</div>`;
  if(o.driver)h+=`<div class="mute">السائق: ${esc(o.driver.name)} — ${links(o.driver.phone)}</div>`;
  if(o.status==='new')h+=B('cancel','إلغاء الطلب','x');
  if(o.status==='done')h+=o.rating?`<div class="mute">تقييمك: ${stars(o.rating)}</div>`:`<div class="stars">قيّم السائق: ${[1,2,3,4,5].map(n=>`<button data-act="rate" data-id="${esc(o.id)}" data-n="${n}">★${n}</button>`).join("")}</div>`;
  if(o.status==='done'||o.status==='cancelled')h+=B('again','اطلب مرة أخرى')}
 if(v==='v')h+=`<div class="mute">أجرتك: ${money(o.price)}</div>${map}<br>`+B('accept','قبول الطلب','p');
 if(v==='m'){h+=`<div class="mute">الزبون: ${esc(o.cname)} — ${links(o.cphone)} ${map}</div><div class="mute">تحصّل من الزبون ${money(o.total)} (منها عمولة المنصة ${money(o.commission)})</div>`;
  if(o.status==='accepted')h+=B('pick','استلمت الطلب','p')+B('return','إرجاع الطلب','x');
  if(o.status==='picked')h+=B('done','تم التوصيل','p')}
 if(v==='h')h+=`<div class="mute">أجرتك ${money(o.price)}${o.rating?' · '+stars(o.rating):''}</div>`;
 if(v==='a'){const d=ADM.drivers.find(x=>x.id===o.driver_id);
  h+=`<div class="mute">الزبون: ${esc(o.cname)} ${esc(o.cphone)} · السائق: ${d?esc(d.name):"—"}</div><div class="mute">أصل ${money(o.price)} + عمولة ${money(o.commission)} = ${money(o.total)}${o.rating?' · '+stars(o.rating):''}</div>`;
  if(o.status==='accepted'||o.status==='picked')h+=B('requeue','إعادة للطابور');
  if(!['done','cancelled'].includes(o.status))h+=B('acancel','إلغاء','x')}
 return h+"</div>"}

async function renderC(){const on=ls.get('su',0);$('c_auth').hidden=!!on;$('c_app').hidden=!on;if(!on)return;
 let j;try{j=await api('myOrders')}catch(e){if(e.expired){ls.set('su',0);$('c_auth').hidden=false;$('c_app').hidden=true;toast(e.message);return}throw e}
 $('c_hi').textContent='أهلاً '+j.username;CO=j.orders;
 $('c_list').innerHTML=CO.length?CO.map(o=>card(o,'c')).join(""):`<p class="mute">لا توجد طلبات بعد.</p>`}

async function renderD(){const on=ls.get('sd',0);$('d_auth').hidden=!!on;$('d_dash').hidden=!on;if(!on)return;
 let j;try{j=await api('driverState')}catch(e){if(e.expired){ls.set('sd',0);$('d_auth').hidden=false;$('d_dash').hidden=true;toast(e.message);return}throw e}
 $('d_hi').textContent="أهلاً "+j.name;
 if(!j.approved){$('d_pay').hidden=true;$('d_body').innerHTML=`<div class="note">حسابك بانتظار موافقة المشرف. سترى الطلبات فور الموافقة.</div>`;return}
 const s=j.stats;renderDebt(j.debt);
 $('d_body').innerHTML=`<div class="kpi"><div><b>${s.today}</b>اليوم</div><div><b>${s.n}</b>المكتملة</div><div><b>${s.avg??'—'}</b>تقييمك</div><div><b>${money(s.earn)}</b>أرباحك</div><div><b>${money(s.owed)}</b>عمولة عليك</div></div>
 <button class="go ${j.online?'alt':''}" data-go="toggle">${j.online?'أنت متاح — اضغط للإيقاف':'أنت غير متاح — اضغط للتفعيل'}</button>
 <div class="mute" style="margin-top:8px">منطقة عملك: ${esc(scopeName(j.scope))}</div>
 <h3>طلباتي الحالية (${j.mine.length}/${j.max})</h3>${j.mine.map(o=>card(o,'m')).join("")||`<p class="mute">لا توجد طلبات حالية.</p>`}
 <h3>طلبات متاحة</h3>${j.online?(j.available.map(o=>card(o,'v')).join("")||`<p class="mute">لا توجد طلبات الآن، تتحدث القائمة تلقائياً.</p>`):`<p class="mute">فعّل حالة «متاح» لترى الطلبات.</p>`}
 <h3>آخر ما أنجزته</h3>${j.history.map(o=>card(o,'h')).join("")||`<p class="mute">لا يوجد بعد.</p>`}`}

/* ---- المشرف ---- */
async function renderA(){let j;
 try{j=await api('adminState')}catch(e){if(e.expired){$('a_auth').hidden=false;$('a_dash').hidden=true;return}throw e}
 const first=!ADM;ADM=j;$('a_auth').hidden=true;$('a_dash').hidden=false;
 if(!$('a_octl').innerHTML)buildFilters();
 if(first||!$('a_cfg').innerHTML)buildCfg();
 drawA()}
function buildFilters(){$('a_octl').innerHTML=`<h3>الطلبات</h3><div class="row"><select id="af"><option value="">كل الحالات</option>${Object.keys(AR).map(k=>`<option value="${k}">${AR[k]}</option>`).join("")}</select><input id="aq" placeholder="بحث بالجوال أو الاسم"></div>`}
function buildCfg(){const c=ADM.settings;
 const TYPES=['بنك فلسطين','جوال باي (Jawwal Pay)','PalPay','البنك الإسلامي العربي','بنك القدس','البنك الوطني','حوالة / مكتب صرافة','أخرى'];
 const accHtml=`<h3>حسابات استلام العمولة</h3><div class="mute">يراها السائق عند الدفع. تغييرها يتطلب كلمة سر المشرف.</div>`+ADM.accounts.map(a=>`<div class="item"><b>${esc(a.type)}</b> — ${esc(a.name)}<div dir="ltr" style="text-align:start">${esc(a.number)}</div>${a.note?`<div class="mute">${esc(a.note)}</div>`:''}<button class="b x" data-uact="delAccount" data-id="${esc(a.id)}">حذف</button></div>`).join('')+
  `<select id="a_type" style="margin-top:8px">${TYPES.map(t=>`<option>${t}</option>`).join('')}</select><input id="a_name" placeholder="اسم صاحب الحساب أو المحفظة" style="margin-top:8px"><input id="a_num" placeholder="رقم الحساب أو المحفظة" inputmode="tel" style="margin-top:8px"><input id="a_note" placeholder="ملاحظة للدافع (اختياري)" style="margin-top:8px"><button class="go alt" data-go="addaccount">إضافة الحساب</button>
 <h3>سياسة تحصيل العمولة</h3><label>حد العمولة المستحقة بالشيكل (0 = مغلق)</label><input id="k_limit" type="number" min="0" step="0.5" value="${c.debtLimit}"><label>مهلة الدفع بالأيام</label><input id="k_days" type="number" min="1" max="30" value="${c.graceDays}"><button class="go alt" data-go="savepolicy">حفظ السياسة</button><div class="mute">عند بلوغ الحد يصل السائق إشعار يومي، فإن انتهت المهلة دون اعتماد دفعه يُوقف حتى يدفع.</div>`;
 $('a_cfg').innerHTML=`<h3>اسم الموقع</h3><input id="k_site" maxlength="40" value="${esc(c.siteName)}"><button class="go alt" data-go="savesite">حفظ الاسم</button>
 ${accHtml}<h3>العمولة</h3><div class="row"><select id="k_type"><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت ₪</option></select><input id="k_val" type="number" min="0" step="0.01" value="${c.cvalue}"></div><button class="go alt" data-go="savecom">حفظ العمولة</button><div class="mute">تُضاف إلى سعر التوصيل الأصلي، والطلبات السابقة لا تتغير أبداً.</div>
 <h3>التحكم</h3><button class="go ${c.paused?'':'alt'}" data-go="pause">${c.paused?'استئناف استقبال الطلبات':'إيقاف استقبال الطلبات مؤقتاً'}</button>
 <label>إعلان يظهر للجميع</label><input id="k_note" value="${esc(c.notice)}" placeholder="اتركه فارغاً لإخفائه"><button class="go alt" data-go="savenote">حفظ الإعلان</button>
 <h3>الأرقام المحظورة</h3><div class="row"><input id="k_blk" type="tel" inputmode="tel" placeholder="رقم الجوال"><button class="b p" data-go="addblock">حظر</button></div>${ADM.blocked.map(p=>`<div class="item">${esc(p)} <button class="b x" data-uact="unblock" data-id="${esc(p)}">رفع الحظر</button></div>`).join("")}
 <h3>أسعار التوصيل الأصلية</h3>${ADM.regions.map(r=>`<div class="item"><b>${esc(r.name)}</b> <span class="pill">${GN[r.group]}</span><div class="row"><input type="number" min="0" step="0.5" value="${r.price}" data-pin><button class="b p" data-uact="setPrice" data-id="${esc(r.id)}">حفظ السعر</button>${r.id.startsWith('c-')?`<button class="b x" data-uact="delRegion" data-id="${esc(r.id)}">حذف</button>`:''}</div></div>`).join("")}
 <h3>إضافة منطقة جديدة</h3><input id="n_name" placeholder="اسم المنطقة"><select id="n_group" style="margin-top:8px"><option value="gaza">قطاع غزة</option><option value="wb">الضفة الغربية</option></select><input id="n_price" type="number" min="0" step="0.5" placeholder="سعر التوصيل الأصلي ₪" style="margin-top:8px"><button class="go alt" data-go="addregion">أضف المنطقة</button>`;
 $('k_type').value=c.ctype}
function kycHtml(k){return (okImg(k.selfie)?`<img class="selfie" src="${k.selfie}" alt="">`:'')+(okImg(k.idImg)?`<img class="idimg" src="${k.idImg}" alt="">`:'')||`<div class="mute">لا توجد صور.</div>`}
function drawA(){if(!ADM)return;const os=ADM.orders,t=ADM.totals,cnt=s=>os.filter(o=>o.status===s).length;
 $('a_stats').innerHTML=`<div class="kpi"><div><b>${cnt('new')}</b>جديدة</div><div><b>${cnt('accepted')+cnt('picked')}</b>جارية</div><div><b>${t.n}</b>مكتملة</div><div><b>${money(t.commission)}</b>عمولاتك</div><div><b>${money(t.price)}</b>أجور السائقين</div><div><b>${ADM.drivers.filter(u=>u.approved&&!u.banned).length}</b>سائق نشط</div></div>`;
 $('a_users').innerHTML=(ADM.users||[]).map(u=>`<div class="item"><b>${esc(u.username)}</b>${u.banned?' <span class="pill s-cancelled">موقوف</span>':''} <span class="mute">${u.n} طلب</span> <button class="b ${u.banned?'':'x'}" data-uact="${u.banned?'unbanUser':'banUser'}" data-id="${esc(u.id)}">${u.banned?'إلغاء الإيقاف':'إيقاف'}</button></div>`).join('')||'<p class="mute">لا يوجد عملاء بعد.</p>';
 const P=ADM.report;
 $('a_report').innerHTML=`<h3>الأرباح والمدفوعات</h3><div class="kpi"><div><b>${money(P.earned)}</b>إجمالي عمولاتك</div><div><b>${money(P.received)}</b>المستلم فعلاً</div><div><b>${money(P.outstanding)}</b>غير مسدَّد</div><div><b>${money(P.earnedToday)}</b>عمولات اليوم</div><div><b>${money(P.earnedMonth)}</b>عمولات الشهر</div><div><b>${money(P.receivedMonth)}</b>مستلم هذا الشهر</div></div><div class="mute">عدد من دفعوا: ${P.payers} · إشعارات تنتظر مراجعتك: ${P.pending}</div>`;
 if(!$('a_pay').contains(document.activeElement)){
  const UB2=(a,id,t,c='')=>`<button class="b ${c}" data-uact="${a}" data-id="${esc(id)}">${t}</button>`;
  $('a_pay').innerHTML=`<h3>إشعارات الدفع</h3>`+(ADM.payments.length?ADM.payments.map(p=>{const im=RC[p.id];
   return `<div class="item"><b>${esc(p.who)}</b> <span class="pill s-${p.status==='approved'?'accepted':p.status==='rejected'?'cancelled':'new'}">${p.status==='approved'?'معتمد':p.status==='rejected'?'مرفوض':'بانتظارك'}</span><div class="mute">${money(p.amount)} · ${esc(new Date(p.created_at).toLocaleString('ar'))}${p.approved_amount!=null?' · المعتمد '+money(p.approved_amount):''}${p.note?' · '+esc(p.note):''}</div>`+
   (p.hasReceipt?UB2('receipt',p.id,im?'إخفاء الإيصال':'عرض الإيصال'):'')+(im&&okImg(im)?`<img class="idimg" src="${im}" alt="">`:'')+
   (p.status==='pending'?`<div class="row"><input type="number" step="0.01" min="0" placeholder="المبلغ المعتمد (اختياري)" data-amt><input placeholder="سبب الرفض" data-why></div>`+UB2('payOk',p.id,'اعتماد','p')+UB2('payNo',p.id,'رفض','x'):'')+'</div>'}).join(''):'<p class="mute">لا توجد إشعارات دفع بعد.</p>')}
 const f=$('af')?$('af').value:'',q=$('aq')?V('aq'):'';
 const list=os.filter(o=>(!f||o.status===f)&&(!q||o.cphone.includes(q)||o.cname.includes(q)));
 $('a_orders').innerHTML=list.map(o=>card(o,'a')).join("")||`<p class="mute">لا توجد طلبات.</p>`;
 const UB=(a,id,t,c='')=>`<button class="b ${c}" data-uact="${a}" data-id="${esc(id)}">${t}</button>`;
 const drv=u=>`<div class="item"><b>${esc(u.name)}</b>${u.banned?' <span class="pill s-cancelled">موقوف</span>':''}<div class="mute">${esc(u.phone)} · ${esc(u.veh)} · ${esc(scopeName(u.scope))}</div><div class="mute">مكتمل ${u.n} · تقييم ${u.avg??'—'} · عمولة مستحقة ${money(u.owed)}</div>${UB('kyc',u.id,KY[u.id]?'إخفاء الصور':'عرض الهوية والصورة')}${KY[u.id]?kycHtml(KY[u.id]):''}`;
 const pend=ADM.drivers.filter(u=>!u.approved);
 $('a_drivers').innerHTML=(pend.length?`<div class="mute">بانتظار الموافقة (${pend.length})</div>`+pend.map(u=>drv(u)+UB('approve',u.id,'موافقة','p')+UB('delDriver',u.id,'رفض','x')+"</div>").join(""):"")+
  (ADM.drivers.filter(u=>u.approved).map(u=>drv(u)+(u.owed>0?UB('settle',u.id,'تسجيل استلام العمولة','p'):'')+UB(u.banned?'unban':'ban',u.id,u.banned?'إلغاء الإيقاف':'إيقاف','x')+UB('delDriver',u.id,'حذف','x')+"</div>").join("")||`<p class="mute">لا يوجد سائقون معتمدون.</p>`);
 $('a_audit').innerHTML=`<h3>سجل العمليات (آخر 30)</h3>`+ADM.audit.map(a=>`<div class="item mute">${esc(new Date(a.at).toLocaleString('ar'))} · ${esc(a.who)} · <b>${esc(a.action)}</b> ${esc(JSON.stringify(a.detail||{}).slice(0,140))}</div>`).join("")}

async function refresh(){if(busy){again=true;return}busy=true;
 do{again=false;try{if(tab==='c')await renderC();else if(tab==='d')await renderD();else await renderA()}catch(e){}}while(again);busy=false}

async function act(a,id,t){
 if(a==='again'){const o=CO.find(x=>x.id===id);if(!o)return;$('c_region').value=o.region;$('c_addr').value=o.addr;$('c_note').value=o.note||'';showPrice();window.scrollTo(0,0);return toast('تمت تعبئة الطلب، راجعه ثم أرسله')}
 if(a==='cancel'||a==='rate')await api(a,{id,n:t.dataset.n});
 else if(a==='acancel'||a==='requeue')await api('adminAct',{op:a==='acancel'?'cancelOrder':'requeue',id});
 else await api(a,{id});
 await refresh()}
async function adminAct(op,d={}){const SENS=['setCommission','setPrice','addRegion','delRegion','settle','delDriver','payOk','setDebtPolicy','addAccount','delAccount'];let password;
 if(SENS.includes(op)){password=$('k_pw').value;if(!password)throw new Error('اكتب كلمة السر في خانة التأكيد أعلى اللوحة')}
 await api('adminAct',{op,password,...d});$('k_pw').value='';
 ADM=await api('adminState');buildCfg();drawA();if(op==='setPrice'||op==='addRegion'||op==='delRegion')loadRegions()}
async function uact(op,id,t){
 if(op==='receipt'){if(RC[id]){delete RC[id]}else{RC[id]=(await api('adminReceipt',{id})).receipt}return drawA()}
 if(op==='payOk')return adminAct(op,{id,amount:t.parentElement.querySelector('[data-amt]').value});
 if(op==='payNo')return adminAct(op,{id,note:t.parentElement.querySelector('[data-why]').value});
 if(op==='kyc'){if(KY[id]){delete KY[id]}else{KY[id]=await api('adminKyc',{id})}return drawA()}
 if(op==='setPrice')return adminAct(op,{id,price:t.parentElement.querySelector('[data-pin]').value});
 if(op==='unblock')return adminAct(op,{phone:id});
 await adminAct(op,{id});toast('تم')}

function camStop(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}$('cam_v').hidden=true;$('cam_snap').hidden=true}
async function camStart(mode){camStop();selfie=null;$('cam_img').hidden=true;
 try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:mode}},audio:false});const v=$('cam_v');v.srcObject=stream;v.hidden=false;$('cam_snap').hidden=false}
 catch(e){toast('تعذر تشغيل الكاميرا، اسمح للموقع باستخدامها من إعدادات المتصفح')}}
function snap(){const v=$('cam_v');if(!v.videoWidth)return toast('انتظر ثانية حتى تظهر الكاميرا');
 const w=480,h=Math.round(v.videoHeight*w/v.videoWidth),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(v,0,0,w,h);
 selfie=c.toDataURL('image/jpeg',.7);camStop();$('cam_img').src=selfie;$('cam_img').hidden=false}
function resetKyc(){camStop();selfie=idImg=null;$('r_id').value='';$('id_prev').hidden=true;$('cam_img').hidden=true}
function shrink(src,max){return new Promise((ok,no)=>{const i=new Image();i.onload=()=>{const k=Math.min(1,max/Math.max(i.width,i.height)),c=document.createElement('canvas');c.width=Math.round(i.width*k);c.height=Math.round(i.height*k);c.getContext('2d').drawImage(i,0,0,c.width,c.height);ok(c.toDataURL('image/jpeg',.7))};i.onerror=no;i.src=src})}

const GO={
 async order(){const n=V('c_name'),p=V('c_phone'),ad=V('c_addr');if(!n||!p||!ad)return toast('اكتب الاسم والجوال والعنوان');
  const j=await api('createOrder',{cname:n,cphone:p,region:$('c_region').value,addr:ad,note:V('c_note')});
  ls.set('prof',{name:n,phone:p,addr:ad});
  $('c_note').value='';toast('تم إرسال طلبك، المبلغ '+money(j.total));await renderC()},
 async register(){const n=V('r_name'),p=V('r_phone'),pw=$('r_pass').value;if(!n||!p||pw.length<6)return toast('اكتب الاسم والجوال وكلمة سر من 6 أحرف على الأقل');
  if(!idImg||!selfie)return toast('ارفع صورة الهوية والتقط صورتك بالكاميرا');
  await api('register',{name:n,phone:p,pass:pw,veh:$('r_veh').value,scope:$('r_scope').value,idImg,selfie});
  toast('تم التسجيل، بانتظار موافقة المشرف');['r_name','r_phone','r_pass'].forEach(i=>$(i).value='');resetKyc()},
 async ulogin(){await api('uLogin',{username:V('u_user'),pass:$('u_pass').value});ls.set('su',1);$('u_pass').value='';await renderC()},
 async uregister(){if($('g_pass').value!==$('g_pass2').value)return toast('كلمتا المرور غير متطابقتين');await api('uRegister',{username:V('g_user'),pass:$('g_pass').value,pass2:$('g_pass2').value});ls.set('su',1);['g_user','g_pass','g_pass2'].forEach(i=>$(i).value='');await renderC()},
 async ulogout(){await api('uLogout').catch(()=>{});ls.set('su',0);CO=[];await renderC()},
 async login(){await api('login',{phone:V('l_phone'),pass:$('l_pass').value});ls.set('sd',1);$('l_pass').value='';await renderD()},
 async logout(){await api('logout').catch(()=>{});ls.set('sd',0);await renderD()},
 async toggle(){await api('toggle');await renderD()},
 camfront(){camStart('user')},camrear(){camStart('environment')},snap,
 async alogin(){if(!adminName)return toast('اكتب اسمك المخصص في خانة الاسم أولاً');await api('adminLogin',{name:adminName,password:$('a_pass').value});$('a_pass').value='';ADM=null;await renderA()},
 async alogout(){await api('adminLogout').catch(()=>{});ADM=null;adminName='';KY={};['a_octl','a_cfg'].forEach(i=>$(i).innerHTML='');showTab('c')},
 async savecom(){await adminAct('setCommission',{ctype:$('k_type').value,cvalue:$('k_val').value});toast('تم حفظ العمولة')},
 async pause(){await adminAct('setPause',{paused:!ADM.settings.paused});loadRegions()},
 async savenote(){await adminAct('setNotice',{notice:V('k_note')});toast('تم الحفظ');loadRegions()},
 async savesite(){await adminAct('setSiteName',{name:V('k_site')});toast('تم تغيير اسم الموقع');loadRegions()},
 async addaccount(){await adminAct('addAccount',{type:$('a_type').value,name:V('a_name'),number:V('a_num'),note:V('a_note')});toast('تمت إضافة الحساب')},
 async savepolicy(){await adminAct('setDebtPolicy',{limit:$('k_limit').value,days:$('k_days').value});toast('تم حفظ السياسة')},
 async paysend(){if(!payImg)return toast('اختر صورة إشعار الدفع');await api('pay',{role:'driver',amount:$('p_amt').value,ref:V('p_ref'),receipt:payImg});toast('تم إرسال الإشعار، بانتظار مراجعة المشرف');payImg=null;['p_img','p_amt','p_ref'].forEach(i=>$(i).value='');$('p_prev').hidden=true;await renderD()},
 async addblock(){await adminAct('block',{phone:V('k_blk')})},
 async addregion(){await adminAct('addRegion',{name:V('n_name'),grp:$('n_group').value,price:$('n_price').value});toast('تمت إضافة المنطقة')}
};
document.body.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
 if(t.parentElement.id==='tabs')return showTab(t.dataset.t);
 const d=t.dataset;if(d.go)run(()=>GO[d.go]());if(d.act)run(()=>act(d.act,d.id,t));if(d.uact)run(()=>uact(d.uact,d.id,t))});
let adT;
document.body.addEventListener('input',e=>{const i=e.target.id;
 if(i==='af'||i==='aq')return drawA();
 if(['c_name','r_name','l_phone','u_user','g_user'].includes(i)){const v=e.target.value.trim();clearTimeout(adT);if(v.length<40)return;
  adT=setTimeout(async()=>{try{const j=await api('adminProbe',{name:v});if(j.ok){adminName=v;e.target.value='';showTab('a')}}catch(x){}},700)}});
$('c_region').addEventListener('change',showPrice);
$('p_img').addEventListener('change',e=>{const f=e.target.files[0];payImg=null;$('p_prev').hidden=true;if(!f)return;if(!f.type.startsWith('image/'))return toast('اختر صورة فقط');
 const r=new FileReader();r.onload=()=>shrink(r.result,1000).then(d=>{payImg=d;$('p_prev').src=d;$('p_prev').hidden=false}).catch(()=>toast('تعذر قراءة الصورة'));r.readAsDataURL(f)});
$('r_id').addEventListener('change',e=>{const f=e.target.files[0];idImg=null;$('id_prev').hidden=true;if(!f)return;if(!f.type.startsWith('image/'))return toast('اختر صورة فقط');
 const r=new FileReader();r.onload=()=>shrink(r.result,1000).then(d=>{idImg=d;$('id_prev').src=d;$('id_prev').hidden=false}).catch(()=>toast('تعذر قراءة الصورة'));r.readAsDataURL(f)});
setInterval(()=>{if(!document.hidden){if(tab==='c'&&++tick%4===0)run(loadRegions);refresh()}},15000);
{const pf=ls.get('prof',null);if(pf){$('c_name').value=pf.name;$('c_phone').value=pf.phone;$('c_addr').value=pf.addr}}
setSite(ls.get('site',''));
run(loadRegions);refresh();
