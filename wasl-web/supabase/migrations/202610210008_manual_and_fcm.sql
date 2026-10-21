create or replace function public.merge_sheet(p_workspace uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;o public.orders;v_status text;v_tracking text;n int:=0;u int:=0;skipped int:=0;begin
for r in select * from jsonb_array_elements(p_rows) loop
 if coalesce(r->>'code','')='' or coalesce(r->>'phone','')='' or coalesce(r->>'name','')='' then skipped:=skipped+1;continue;end if;
 select * into o from public.orders where workspace_id=p_workspace and code=r->>'code' for update;
 v_status:=coalesce(r->>'status','new');if v_status not in ('new','confirmed','shipped','delivered','returned','cancelled') then skipped:=skipped+1;continue;end if;
 v_tracking:=nullif(r->>'tracking','');if v_tracking is not null and (v_tracking!~'^[A-Z]{2}[0-9]{9}EG$' or exists(select 1 from public.orders where workspace_id=p_workspace and tracking=v_tracking and code<>r->>'code')) then skipped:=skipped+1;continue;end if;
 if o.id is null then
 insert into public.orders(workspace_id,code,name,phone,address,product,amount,status,tracking,origin,created_at,confirmed_at,shipped_at,delivered_at,notes) values(p_workspace,r->>'code',r->>'name',r->>'phone',coalesce(r->>'address',''),coalesce(r->>'product',''),coalesce((r->>'amount')::numeric,0),v_status,v_tracking,case when r->>'origin'='historical' or nullif(r->>'createdAt','') is null or (r->>'createdAt')::timestamptz<now()-interval '1 day' then 'historical' else 'google-sheets' end,(r->>'createdAt')::timestamptz,(r->>'confirmedAt')::timestamptz,(r->>'shippedAt')::timestamptz,(r->>'deliveredAt')::timestamptz,coalesce(r->>'notes',''));n:=n+1;
 else
 if o.status in ('delivered','returned','cancelled') or (o.status='shipped' and v_status in ('new','confirmed')) or (o.status='confirmed' and v_status='new') then v_status:=o.status;end if;
 update public.orders set name=case when o.details->>'manualCustomer'='true' then o.name else r->>'name' end,phone=case when o.details->>'manualCustomer'='true' then o.phone else r->>'phone' end,address=case when o.details->>'manualCustomer'='true' then o.address else coalesce(r->>'address',o.address) end,product=case when o.details->>'manualCustomer'='true' then o.product else coalesce(r->>'product',o.product) end,amount=case when o.details->>'manualCustomer'='true' then o.amount else coalesce((r->>'amount')::numeric,o.amount) end,status=v_status,notes=case when o.notes='' then coalesce(r->>'notes','') else o.notes end,tracking=coalesce(o.tracking,v_tracking),confirmed_at=coalesce(o.confirmed_at,(r->>'confirmedAt')::timestamptz,case when o.status='new' and v_status='confirmed' then now() end),shipped_at=coalesce(o.shipped_at,(r->>'shippedAt')::timestamptz),delivered_at=coalesce(o.delivered_at,(r->>'deliveredAt')::timestamptz),updated_at=now() where id=o.id;
 if v_status<>o.status then insert into public.audit(workspace_id,order_id,action,details) values(p_workspace,o.id,'sheet_status',jsonb_build_object('from',o.status,'to',v_status));end if;u:=u+1;
 end if;
end loop;
return jsonb_build_object('inserted',n,'updated',u,'skipped',skipped);end$$;
revoke all on function public.merge_sheet(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.merge_sheet(uuid,jsonb) to service_role;
create function public.register_device_fcm(p_device uuid,p_token text) returns void language plpgsql security definer set search_path='' as $$begin
 if length(p_token)<20 or length(p_token)>4096 then raise exception 'Invalid FCM token';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_token,2));
 update public.devices set fcm_token=null where fcm_token=p_token and id<>p_device;
 update public.devices set fcm_token=p_token where id=p_device and revoked_at is null and expires_at>now();
end$$;
revoke all on function public.register_device_fcm(uuid,text) from public,anon,authenticated;
grant execute on function public.register_device_fcm(uuid,text) to service_role;
revoke all on function public.my_workspace() from public,anon;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.my_workspace() to authenticated,service_role;
grant execute on function public.is_admin() to authenticated,service_role;

