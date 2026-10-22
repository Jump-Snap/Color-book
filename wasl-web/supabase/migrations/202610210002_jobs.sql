create function public.runtime_secret(p_name text) returns text language sql security definer set search_path='' as $$select value from wasl_private.runtime_secrets where name=p_name$$;
revoke all on function public.runtime_secret(text) from public,anon,authenticated;
grant execute on function public.runtime_secret(text) to service_role;
create function public.claim_sheet_jobs() returns setof public.sheet_connections language sql security definer set search_path='' as $$update public.sheet_connections set locked_until=now()+interval '5 minutes' where workspace_id in(select workspace_id from public.sheet_connections where enabled and next_run<=now() and (locked_until is null or locked_until<now()) for update skip locked limit 10) returning *$$;
revoke all on function public.claim_sheet_jobs() from public,anon,authenticated;
grant execute on function public.claim_sheet_jobs() to service_role;
create function public.prepare_maintenance() returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.notifications(workspace_id,order_id,key,title,body)
 select o.workspace_id,o.id,o.id||':'||o.status,'طلب يحتاج متابعة',o.name||' • '||o.code||case when o.status='confirmed' then ' — مؤكد ولم يُشحن' else ' — مشحون ولم يُسلّم' end from public.orders o join public.settings s on s.workspace_id=o.workspace_id
 where ((o.origin='historical' and s.notify_old) or (o.origin<>'historical' and s.notify_new)) and ((o.status='confirmed' and o.confirmed_at<now()-make_interval(days=>s.confirm_days)) or(o.status='shipped' and o.shipped_at<now()-make_interval(days=>s.ship_days))) on conflict do nothing;
 insert into public.retention_jobs(workspace_id,bill_id,path) select b.workspace_id,b.id,b.path from public.waybills b join public.settings s on s.workspace_id=b.workspace_id where s.retention_days is not null and b.deleted_at is null and b.created_at<now()-make_interval(days=>s.retention_days) on conflict do nothing;
end$$;
revoke all on function public.prepare_maintenance() from public,anon,authenticated;
grant execute on function public.prepare_maintenance() to service_role;
