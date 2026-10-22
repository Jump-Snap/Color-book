alter table public.retention_jobs add column next_attempt timestamptz not null default now();
create index retention_pending on public.retention_jobs(status,next_attempt);
create or replace function public.prepare_maintenance() returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.notifications(workspace_id,order_id,key,title,body)
 select o.workspace_id,o.id,o.id||':'||o.status,'طلب يحتاج متابعة',o.name||' • '||o.code||case when o.status='confirmed' then ' — مؤكد ولم يُشحن' else ' — مشحون ولم يُسلّم' end from public.orders o join public.settings s on s.workspace_id=o.workspace_id
 where ((o.origin='historical' and s.notify_old) or (o.origin<>'historical' and s.notify_new)) and ((o.status='confirmed' and o.confirmed_at<now()-make_interval(days=>s.confirm_days)) or(o.status='shipped' and o.shipped_at<now()-make_interval(days=>s.ship_days))) on conflict do nothing;
 insert into public.retention_jobs(workspace_id,bill_id,path) select b.workspace_id,b.id,b.path from public.waybills b join public.settings s on s.workspace_id=b.workspace_id where s.retention_days is not null and b.deleted_at is null and b.created_at<now()-make_interval(days=>s.retention_days) on conflict do nothing;
 insert into public.retention_jobs(workspace_id,legacy_id,path) select b.workspace_id,b.id,b.path from public.legacy_files b join public.settings s on s.workspace_id=b.workspace_id where s.retention_days is not null and b.deleted_at is null and coalesce(b.created_at,b.imported_at)<now()-make_interval(days=>s.retention_days) on conflict do nothing;
end$$;
