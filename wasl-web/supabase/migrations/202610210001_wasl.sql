create extension if not exists pgcrypto with schema extensions;
create table public.workspaces(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.profiles(id uuid primary key references auth.users on delete cascade,workspace_id uuid not null references public.workspaces,username text not null unique,role text not null check(role in ('admin','member')));
create function public.my_workspace() returns uuid language sql stable security definer set search_path='' as $$select workspace_id from public.profiles where id=auth.uid()$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select role='admin' from public.profiles where id=auth.uid()),false)$$;
create table public.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,code text not null,name text not null,phone text not null,address text not null default '',product text not null default '',amount numeric not null default 0,status text not null default 'new' check(status in ('new','confirmed','shipped','delivered','returned','cancelled')),tracking text,carrier_status text not null default '',notes text not null default '',origin text not null default 'manual',created_at timestamptz not null default now(),confirmed_at timestamptz,shipped_at timestamptz,delivered_at timestamptz,updated_at timestamptz not null default now(),unique(workspace_id,code),check(tracking is null or tracking~'^[A-Z]{2}[0-9]{9}EG$'));
create unique index orders_tracking on public.orders(workspace_id,tracking) where tracking is not null;
create index orders_phone on public.orders(workspace_id,phone);
create index orders_workspace_date on public.orders(workspace_id,created_at desc,id);
create table public.waybills(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,order_id uuid not null references public.orders,tracking text not null,path text not null,sha256 text not null,file_name text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,unique(workspace_id,tracking));
create index bills_workspace_date on public.waybills(workspace_id,created_at,id);
create table public.postal_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,event_key text not null,tracking text not null,kind text not null,text text not null,received_at timestamptz,imported_at timestamptz not null default now(),order_id uuid references public.orders,source text not null,unique(workspace_id,event_key,tracking));
create index postal_workspace_pending on public.postal_events(workspace_id,order_id,imported_at desc);
create table public.settings(workspace_id uuid primary key references public.workspaces,confirm_days int not null default 3 check(confirm_days between 1 and 365),ship_days int not null default 3 check(ship_days between 1 and 365),notify_new boolean not null default true,notify_old boolean not null default false,retention_days int check(retention_days between 7 and 3650),automatic_postal boolean not null default true);
create table public.sheet_connections(workspace_id uuid primary key references public.workspaces,sheet_id text not null,enabled boolean not null default false,interval_minutes int not null default 5 check(interval_minutes between 1 and 1440),last_success timestamptz,last_error text,last_count int not null default 0,next_run timestamptz not null default now(),locked_until timestamptz);
create table public.notifications(id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces,order_id uuid references public.orders,key text not null,title text not null,body text not null,created_at timestamptz not null default now(),unique(workspace_id,key));
create table public.audit(id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces,order_id uuid references public.orders,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create table public.devices(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,name text not null,token_hash text not null unique,fcm_token text,expires_at timestamptz not null default now()+interval '90 days',revoked_at timestamptz,last_seen_at timestamptz,created_at timestamptz not null default now());
create table public.retention_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,bill_id uuid not null references public.waybills,path text not null,status text not null default 'pending',created_at timestamptz not null default now(),error text,unique(bill_id,path));
create table public.bootstrap_tokens(token_hash text primary key,expires_at timestamptz not null);
create schema if not exists wasl_private;
revoke all on schema wasl_private from public,anon,authenticated;
create table wasl_private.sheet_secrets(workspace_id uuid primary key references public.workspaces,url text not null,secret text not null,sheet_id text not null);
create table wasl_private.runtime_secrets(name text primary key,value text not null);
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(id=public.my_workspace());
create policy profile_read on public.profiles for select to authenticated using(workspace_id=public.my_workspace());
do $$declare t text;begin foreach t in array array['orders','waybills','postal_events','settings','sheet_connections','notifications','audit','devices','retention_jobs'] loop execute format('alter table public.%I enable row level security',t);execute format('create policy workspace_read on public.%I for select to authenticated using(workspace_id=public.my_workspace())',t);end loop;end$$;
alter table public.bootstrap_tokens enable row level security;
create policy order_insert on public.orders for insert to authenticated with check(workspace_id=public.my_workspace());
create policy order_update on public.orders for update to authenticated using(workspace_id=public.my_workspace()) with check(workspace_id=public.my_workspace());
create policy settings_update on public.settings for update to authenticated using(workspace_id=public.my_workspace() and public.is_admin()) with check(workspace_id=public.my_workspace() and public.is_admin());
revoke all on public.devices from anon,authenticated;
grant select(id,workspace_id,name,expires_at,revoked_at,last_seen_at,created_at) on public.devices to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('waybills','waybills',false,52428800,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy file_read on storage.objects for select to authenticated using(bucket_id='waybills' and (storage.foldername(name))[1]=public.my_workspace()::text);
create policy file_insert on storage.objects for insert to authenticated with check(bucket_id='waybills' and (storage.foldername(name))[1]=public.my_workspace()::text);
create function public.claim_bootstrap(p_hash text) returns boolean language plpgsql security definer set search_path='' as $$begin delete from public.bootstrap_tokens where token_hash=p_hash and expires_at>now();return found;end$$;
revoke all on function public.claim_bootstrap(text) from public,anon,authenticated;
grant execute on function public.claim_bootstrap(text) to service_role;
create function public.get_sheet_secret(p_workspace uuid) returns jsonb language sql security definer set search_path='' as $$select to_jsonb(s) from wasl_private.sheet_secrets s where workspace_id=p_workspace$$;
revoke all on function public.get_sheet_secret(uuid) from public,anon,authenticated;
grant execute on function public.get_sheet_secret(uuid) to service_role;
create function public.merge_sheet(p_workspace uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;o public.orders;v_status text;v_tracking text;n int:=0;u int:=0;skipped int:=0;begin
for r in select * from jsonb_array_elements(p_rows) loop
 if coalesce(r->>'code','')='' or coalesce(r->>'phone','')='' or coalesce(r->>'name','')='' then skipped:=skipped+1;continue;end if;
 select * into o from public.orders where workspace_id=p_workspace and code=r->>'code' for update;
 v_status:=coalesce(r->>'status','new');if v_status not in ('new','confirmed','shipped','delivered','returned','cancelled') then skipped:=skipped+1;continue;end if;
 v_tracking:=nullif(r->>'tracking','');if v_tracking is not null and (v_tracking!~'^[A-Z]{2}[0-9]{9}EG$' or exists(select 1 from public.orders where workspace_id=p_workspace and tracking=v_tracking and code<>r->>'code')) then skipped:=skipped+1;continue;end if;
 if o.id is null then
 insert into public.orders(workspace_id,code,name,phone,address,product,amount,status,tracking,origin,created_at,confirmed_at,shipped_at,delivered_at) values(p_workspace,r->>'code',r->>'name',r->>'phone',coalesce(r->>'address',''),coalesce(r->>'product',''),coalesce((r->>'amount')::numeric,0),v_status,v_tracking,'google-sheets',coalesce((r->>'createdAt')::timestamptz,now()),(r->>'confirmedAt')::timestamptz,(r->>'shippedAt')::timestamptz,(r->>'deliveredAt')::timestamptz);n:=n+1;
 else
 if o.status in ('delivered','returned','cancelled') or (o.status='shipped' and v_status in ('new','confirmed')) or (o.status='confirmed' and v_status='new') then v_status:=o.status;end if;
 update public.orders set name=r->>'name',phone=r->>'phone',address=coalesce(r->>'address',o.address),product=coalesce(r->>'product',o.product),amount=coalesce((r->>'amount')::numeric,o.amount),status=v_status,tracking=coalesce(o.tracking,v_tracking),confirmed_at=coalesce(o.confirmed_at,(r->>'confirmedAt')::timestamptz),shipped_at=coalesce(o.shipped_at,(r->>'shippedAt')::timestamptz),delivered_at=coalesce(o.delivered_at,(r->>'deliveredAt')::timestamptz),updated_at=now() where id=o.id;
 if v_status<>o.status then insert into public.audit(workspace_id,order_id,action,details) values(p_workspace,o.id,'sheet_status',jsonb_build_object('from',o.status,'to',v_status));end if;u:=u+1;
 end if;
end loop;
return jsonb_build_object('inserted',n,'updated',u,'skipped',skipped);end$$;
revoke all on function public.merge_sheet(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.merge_sheet(uuid,jsonb) to service_role;
create function public.apply_postal(p_workspace uuid) returns int language plpgsql security definer set search_path='' as $$declare e public.postal_events;o public.orders;n int:=0;begin
 for e in select * from public.postal_events where workspace_id=p_workspace and order_id is null and kind in ('delivered','attempt','created') order by received_at nulls last,imported_at,id for update loop
 select * into o from public.orders where workspace_id=p_workspace and tracking=e.tracking for update;if o.id is null then continue;end if;
 update public.postal_events set order_id=o.id where id=e.id;
 if e.kind='delivered' and o.status not in ('returned','cancelled') then update public.orders set status='delivered',delivered_at=coalesce(delivered_at,e.received_at),carrier_status='تم التسليم للمرسل إليه',updated_at=now() where id=o.id;
 elsif e.kind='attempt' and o.status<>'delivered' then update public.orders set carrier_status='محاولة توصيل غير ناجحة',updated_at=now() where id=o.id;end if;
 insert into public.audit(workspace_id,order_id,action,details) values(p_workspace,o.id,'postal_match',jsonb_build_object('event',e.id,'kind',e.kind));n:=n+1;end loop;return n;end$$;
revoke all on function public.apply_postal(uuid) from public,anon,authenticated;
grant execute on function public.apply_postal(uuid) to service_role;
create function public.accept_bill(p_order uuid,p_tracking text,p_path text,p_hash text,p_name text,p_duplicate text default 'reject') returns jsonb language plpgsql security definer set search_path='' as $$declare w uuid:=public.my_workspace();o public.orders;b public.waybills;begin
 if w is null or p_tracking!~'^[A-Z]{2}[0-9]{9}EG$' or p_hash!~'^[0-9a-f]{64}$' or p_path not like w::text||'/%' then raise exception 'Invalid waybill';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||p_tracking,0));
 select * into o from public.orders where id=p_order and workspace_id=w for update;if o.id is null then raise exception 'Order not found';end if;
 if exists(select 1 from public.orders where workspace_id=w and tracking=p_tracking and id<>p_order) then return jsonb_build_object('ok',false,'conflict',true,'message','رقم الشحنة مربوط بطلب آخر');end if;
 select * into b from public.waybills where workspace_id=w and tracking=p_tracking for update;
 if b.id is not null and b.order_id<>p_order then return jsonb_build_object('ok',false,'conflict',true,'message','البوليصة محفوظة تحت طلب آخر');end if;
 if b.id is not null and p_duplicate<>'update' then return jsonb_build_object('ok',false,'duplicate',true,'message','البوليصة مرفوعة من قبل: اختار تحديث أو تجاهل');end if;
 if not exists(select 1 from storage.objects where bucket_id='waybills' and name=p_path) then raise exception 'File not uploaded';end if;
 if b.id is null then insert into public.waybills(workspace_id,order_id,tracking,path,sha256,file_name) values(w,p_order,p_tracking,p_path,p_hash,p_name);
 else
 if b.path<>p_path and b.deleted_at is null then insert into public.retention_jobs(workspace_id,bill_id,path) values(w,b.id,b.path) on conflict do nothing;end if;
 update public.waybills set path=p_path,sha256=p_hash,file_name=p_name,updated_at=now(),deleted_at=null where id=b.id;end if;
 update public.orders set tracking=p_tracking,status=case when status in ('new','confirmed') then 'shipped' else status end,shipped_at=coalesce(shipped_at,now()),updated_at=now() where id=p_order;
 insert into public.audit(workspace_id,order_id,action,details) values(w,p_order,'accept_bill',jsonb_build_object('tracking',p_tracking,'duplicate',p_duplicate));
 perform public.apply_postal(w);return jsonb_build_object('ok',true);end$$;
revoke all on function public.accept_bill(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.accept_bill(uuid,text,text,text,text,text) to authenticated;
create function public.queue_deletion(p_ids uuid[],p_from timestamptz,p_to timestamptz) returns int language plpgsql security definer set search_path='' as $$declare w uuid:=public.my_workspace();n int;begin
 if not public.is_admin() or p_from>=p_to or array_length(p_ids,1)>500 then raise exception 'Invalid deletion request';end if;
 insert into public.retention_jobs(workspace_id,bill_id,path) select w,id,path from public.waybills where workspace_id=w and id=any(p_ids) and created_at>=p_from and created_at<p_to and deleted_at is null on conflict do nothing;get diagnostics n=row_count;return n;end$$;
revoke all on function public.queue_deletion(uuid[],timestamptz,timestamptz) from public,anon;
grant execute on function public.queue_deletion(uuid[],timestamptz,timestamptz) to authenticated;
