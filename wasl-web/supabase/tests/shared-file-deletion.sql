begin;
do $$declare w uuid:=gen_random_uuid();a uuid;b uuid;bill uuid;legacy uuid;j uuid;r jsonb;begin
 insert into public.workspaces(id,name) values(w,'Disposable shared-file deletion test');
 insert into public.orders(workspace_id,code,name,phone) values(w,'A','Synthetic A','+201000000001') returning id into a;
 insert into public.orders(workspace_id,code,name,phone) values(w,'B','Synthetic B','+201000000002') returning id into b;
 insert into public.waybills(workspace_id,order_id,tracking,path,sha256,file_name) values(w,a,'EN012345678EG',w||'/shared.png',repeat('a',64),'shared.png') returning id into bill;
 insert into public.legacy_files(workspace_id,order_id,path,sha256,file_name) values(w,b,w||'/shared.png',repeat('a',64),'shared.png') returning id into legacy;
 insert into public.retention_jobs(workspace_id,bill_id,path) values(w,bill,w||'/shared.png') returning id into j;
 r:=public.prepare_file_removal(j);if (r->>'delete_object')::boolean then raise exception 'Shared object deleted while still referenced';end if;
 if (select deleted_at from public.legacy_files where id=legacy) is not null then raise exception 'Other attachment was removed';end if;
 insert into public.retention_jobs(workspace_id,legacy_id,path) values(w,legacy,w||'/shared.png') returning id into j;
 r:=public.prepare_file_removal(j);if not (r->>'delete_object')::boolean then raise exception 'Last reference did not release the object';end if;
 if not exists(select 1 from wasl_private.file_tombstones where path=w||'/shared.png') then raise exception 'Deleted path is not protected from reuse';end if;
end$$;
rollback;
select 'Shared-file deletion checks passed; synthetic data rolled back' as result;
