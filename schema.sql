-- النسخة الآمنة: الصق هذا كله في Supabase ← SQL Editor ← Run (على مشروع جديد فارغ)
create extension if not exists pgcrypto with schema extensions;

create table regions(id text primary key, name text not null, grp text not null check (grp in ('gaza','wb')), price numeric not null default 10 check (price >= 0));
create table drivers(id uuid primary key default gen_random_uuid(), name text not null, phone text not null unique, pass_hash text not null, veh text, scope text not null,
  approved boolean not null default false, banned boolean not null default false, online boolean not null default true, paid numeric not null default 0, due_at timestamptz, created_at timestamptz not null default now());
create table kyc(driver_id uuid primary key references drivers(id) on delete cascade, id_img text not null, selfie text not null);
create table merchants(id uuid primary key default gen_random_uuid(), name text not null, shop text not null,
  cat text not null check (cat in ('restaurant','electronics','groceries','clothes','other')),
  phone text not null unique, pass_hash text not null, region text not null, addr text not null, id_img text not null,
  pref_driver uuid references drivers(id) on delete set null, paid numeric not null default 0, due_at timestamptz,
  approved boolean not null default false, banned boolean not null default false, created_at timestamptz not null default now());
create table products(id uuid primary key default gen_random_uuid(), merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null, price numeric not null check (price >= 0), descr text, img text, avail boolean not null default true, created_at timestamptz not null default now());
create index on products(merchant_id);
create table orders(id uuid primary key default gen_random_uuid(), secret text not null default encode(extensions.gen_random_bytes(8),'hex'),
  cname text not null, cphone text not null, region text not null, addr text not null, note text,
  status text not null default 'new' check (status in ('m_new','offer','d_offer','new','accepted','picked','done','cancelled')),
  driver_id uuid references drivers(id) on delete set null,
  merchant_id uuid references merchants(id) on delete set null, items jsonb, items_total numeric not null default 0, mcommission numeric not null default 0,
  price numeric not null, commission numeric not null, total numeric not null,
  rating int check (rating between 1 and 5), created_at timestamptz not null default now(), done_at timestamptz);
create index on orders(status); create index on orders(driver_id);
create table settings(id int primary key default 1 check (id = 1), ctype text not null default 'percent' check (ctype in ('fixed','percent')),
  cvalue numeric not null default 10 check (cvalue >= 0), paused boolean not null default false, notice text not null default '',
  mc_on boolean not null default false, mc_type text not null default 'percent' check (mc_type in ('fixed','percent')), mc_value numeric not null default 0 check (mc_value >= 0),
  debt_limit numeric not null default 0 check (debt_limit >= 0), grace_days int not null default 3 check (grace_days between 1 and 30),
  site_name text not null default 'توصيل فلسطين' check (char_length(site_name) between 1 and 40));
insert into settings default values;
create table blocked(phone text primary key);
create table sessions(token_hash text primary key, role text not null, user_id uuid, expires_at timestamptz not null);
create table attempts(k text primary key, n int not null, until_at timestamptz not null);
create table audit(id bigserial primary key, at timestamptz not null default now(), who text not null, action text not null, detail jsonb);

insert into regions(id,name,grp) values
('g-شمال غزة','شمال غزة','gaza'),('g-غزة','غزة','gaza'),('g-دير البلح','دير البلح','gaza'),('g-خان يونس','خان يونس','gaza'),('g-رفح','رفح','gaza'),
('w-جنين','جنين','wb'),('w-طوباس','طوباس','wb'),('w-طولكرم','طولكرم','wb'),('w-نابلس','نابلس','wb'),('w-قلقيلية','قلقيلية','wb'),('w-سلفيت','سلفيت','wb'),
('w-رام الله والبيرة','رام الله والبيرة','wb'),('w-أريحا والأغوار','أريحا والأغوار','wb'),('w-القدس','القدس','wb'),('w-بيت لحم','بيت لحم','wb'),('w-الخليل','الخليل','wb');

-- حماية الطلبات: السعر والعمولة وبيانات الزبون لا تتغير أبداً بعد الإنشاء، والحالة النهائية نهائية
create or replace function orders_guard() returns trigger language plpgsql as $$
begin
  if new.price<>old.price or new.commission<>old.commission or new.total<>old.total or new.cname<>old.cname
     or new.cphone<>old.cphone or new.region<>old.region or new.addr<>old.addr or new.secret<>old.secret
     or new.items_total<>old.items_total or new.mcommission<>old.mcommission or new.items is distinct from old.items then raise exception 'order data is immutable'; end if;
  if old.status in ('done','cancelled') and new.status<>old.status then raise exception 'order is final'; end if;
  if old.rating is not null and new.rating is distinct from old.rating then raise exception 'rating is final'; end if;
  return new;
end $$;
create trigger orders_guard before update on orders for each row execute function orders_guard();

-- سجل تدقيق تلقائي لأي تغيير في العمولة أو الأسعار، حتى لو جاء من قاعدة البيانات مباشرة
create or replace function audit_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then insert into audit(who,action,detail) values('db', tg_table_name||' delete', to_jsonb(old));
  elsif tg_op = 'INSERT' then insert into audit(who,action,detail) values('db', tg_table_name||' insert', to_jsonb(new));
  else insert into audit(who,action,detail) values('db', tg_table_name||' update', jsonb_build_object('old',to_jsonb(old),'new',to_jsonb(new))); end if;
  return null;
end $$;
create trigger audit_settings after insert or update or delete on settings for each row execute function audit_change();
create trigger audit_regions after insert or update or delete on regions for each row execute function audit_change();

-- السجل للإضافة فقط: لا تعديل ولا حذف ولا تفريغ
create or replace function audit_lock() returns trigger language plpgsql as $$ begin raise exception 'audit log is append-only'; end $$;
create trigger audit_lock1 before update or delete on audit for each row execute function audit_lock();
create trigger audit_lock2 before truncate on audit for each statement execute function audit_lock();

-- إغلاق كامل: لا وصول لأي جدول إلا من الخادم بالمفتاح السري
alter table regions enable row level security; alter table drivers enable row level security; alter table kyc enable row level security;
alter table orders enable row level security; alter table settings enable row level security; alter table blocked enable row level security;
alter table merchants enable row level security; alter table products enable row level security;
alter table sessions enable row level security; alter table attempts enable row level security; alter table audit enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

create or replace function register_driver(p_name text,p_phone text,p_pass text,p_veh text,p_scope text,p_id text,p_selfie text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if exists(select 1 from drivers where phone = p_phone) then return 'هذا الرقم مسجل مسبقاً'; end if;
  insert into drivers(name,phone,pass_hash,veh,scope) values(p_name,p_phone,crypt(p_pass,gen_salt('bf',10)),p_veh,p_scope) returning id into v;
  insert into kyc(driver_id,id_img,selfie) values(v,p_id,p_selfie);
  return 'ok';
end $$;

create or replace function login_driver(p_phone text,p_pass text)
returns uuid language sql security definer set search_path = public, extensions as $$
  select id from drivers where phone = p_phone and not banned and pass_hash = crypt(p_pass, pass_hash) limit 1 $$;

create or replace function accept_order(p_order uuid,p_driver uuid,p_max int)
returns text language plpgsql security definer set search_path = public as $$
declare v_scope text; v_region text; v_grp text; n int; r int;
begin
  perform pg_advisory_xact_lock(hashtext(p_driver::text));
  select scope into v_scope from drivers where id = p_driver and approved and not banned and online and (due_at is null or due_at > now());
  if v_scope is null then return 'لا يمكنك قبول الطلبات الآن (تأكد أنك معتمد ومتاح)'; end if;
  select region into v_region from orders where id = p_order;
  if v_region is null then return 'الطلب غير موجود'; end if;
  select grp into v_grp from regions where id = v_region;
  if not (v_scope = v_region or v_scope = 'ALL:' || coalesce(v_grp,'')) then return 'الطلب خارج منطقتك'; end if;
  select count(*) into n from orders where driver_id = p_driver and status in ('accepted','picked');
  if n >= p_max then return 'أنهِ طلباتك الحالية أولاً'; end if;
  update orders set status = 'accepted', driver_id = p_driver where id = p_order and (status = 'new' or (status = 'd_offer' and driver_id = p_driver));
  get diagnostics r = row_count;
  if r = 0 then return 'سبقك سائق آخر على هذا الطلب'; end if;
  return 'ok';
end $$;

revoke all on function register_driver(text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function login_driver(text,text) from public, anon, authenticated;
revoke all on function accept_order(uuid,uuid,int) from public, anon, authenticated;
grant execute on function register_driver(text,text,text,text,text,text,text) to service_role;
grant execute on function login_driver(text,text) to service_role;
grant execute on function accept_order(uuid,uuid,int) to service_role;

create or replace function register_merchant(p_name text,p_shop text,p_cat text,p_phone text,p_pass text,p_region text,p_addr text,p_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists(select 1 from merchants where phone = p_phone) then return 'هذا الرقم مسجل مسبقاً'; end if;
  if not exists(select 1 from regions where id = p_region) then return 'منطقة غير صحيحة'; end if;
  insert into merchants(name,shop,cat,phone,pass_hash,region,addr,id_img) values(p_name,p_shop,p_cat,p_phone,crypt(p_pass,gen_salt('bf',10)),p_region,p_addr,p_id);
  return 'ok';
end $$;
create or replace function login_merchant(p_phone text,p_pass text)
returns uuid language sql security definer set search_path = public, extensions as $$
  select id from merchants where phone = p_phone and not banned and pass_hash = crypt(p_pass, pass_hash) limit 1 $$;
revoke all on function register_merchant(text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function login_merchant(text,text) from public, anon, authenticated;
grant execute on function register_merchant(text,text,text,text,text,text,text,text) to service_role;
grant execute on function login_merchant(text,text) to service_role;

-- إيصالات دفع العمولة وإشعارات التذكير
create table payments(id uuid primary key default gen_random_uuid(), role text not null check (role in ('driver','merchant')), user_id uuid not null, who text not null,
  amount numeric not null check (amount > 0), receipt text not null, ref text, status text not null default 'pending' check (status in ('pending','approved','rejected')),
  note text, approved_amount numeric, created_at timestamptz not null default now(), decided_at timestamptz);
create index on payments(user_id); create index on payments(status);
create table notices(id bigserial primary key, role text not null, user_id uuid not null, day text not null, text text not null, at timestamptz not null default now(), unique (user_id, day));
alter table payments enable row level security; alter table notices enable row level security;
revoke all on payments, notices from anon, authenticated;
revoke all on sequence notices_id_seq from anon, authenticated;
