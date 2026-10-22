create table wasl_private.file_tombstones(path text primary key,created_at timestamptz not null default now());
create function public.prepare_file_removal(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare j public.retention_jobs;refs int;begin
 select * into j from public.retention_jobs where id=p_job for update;
 if j.id is null or j.status='done' then return jsonb_build_object('skip',true);end if;
 perform pg_advisory_xact_lock(hashtextextended(j.path,1));
 if j.legacy_id is not null then update public.legacy_files set deleted_at=coalesce(deleted_at,now()) where id=j.legacy_id and path=j.path;
 else update public.waybills set deleted_at=coalesce(deleted_at,now()) where id=j.bill_id and path=j.path;end if;
 select count(*) into refs from public.file_archive where path=j.path and deleted_at is null;
 if refs=0 then insert into wasl_private.file_tombstones(path) values(j.path) on conflict do nothing;end if;
 return jsonb_build_object('skip',false,'delete_object',refs=0,'path',j.path);
end$$;
revoke all on function public.prepare_file_removal(uuid) from public,anon,authenticated;
grant execute on function public.prepare_file_removal(uuid) to service_role;
create or replace function public.accept_bill(p_order uuid,p_tracking text,p_path text,p_hash text,p_name text,p_duplicate text default 'reject') returns jsonb language plpgsql security definer set search_path='' as $$declare w uuid:=public.my_workspace();o public.orders;b public.waybills;begin
 if w is null or p_tracking!~'^[A-Z]{2}[0-9]{9}EG$' or p_hash!~'^[0-9a-f]{64}$' or p_path not like w::text||'/%' then raise exception 'Invalid waybill';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||p_tracking,0));
 perform pg_advisory_xact_lock(hashtextextended(p_path,1));if exists(select 1 from wasl_private.file_tombstones where path=p_path) then raise exception 'File was removed; upload it again';end if;select * into o from public.orders where id=p_order and workspace_id=w for update;if o.id is null then raise exception 'Order not found';end if;
 if o.tracking is not null and o.tracking<>p_tracking then return jsonb_build_object('ok',false,'conflict',true,'message','الطلب مرتبط برقم شحنة آخر؛ راجع الطلب قبل الربط');end if;if exists(select 1 from public.orders where workspace_id=w and tracking=p_tracking and id<>p_order) then return jsonb_build_object('ok',false,'conflict',true,'message','رقم الشحنة مربوط بطلب آخر');end if;
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

