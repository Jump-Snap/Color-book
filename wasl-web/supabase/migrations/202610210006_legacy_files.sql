alter table public.orders add column details jsonb not null default '{}';
create table public.legacy_files(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,order_id uuid references public.orders,tracking text,path text not null,sha256 text not null,file_name text not null,created_at timestamptz,imported_at timestamptz not null default now(),deleted_at timestamptz,unique(workspace_id,path));
alter table public.legacy_files enable row level security;
create policy workspace_read on public.legacy_files for select to authenticated using(workspace_id=public.my_workspace());
alter table public.retention_jobs alter column bill_id drop not null;
alter table public.retention_jobs add column legacy_id uuid references public.legacy_files;
alter table public.retention_jobs add constraint one_file_reference check(num_nonnulls(bill_id,legacy_id)=1);
alter table public.retention_jobs add unique(legacy_id,path);
create view public.file_archive with(security_invoker=true) as select id,workspace_id,order_id,tracking,path,sha256,file_name,created_at,deleted_at,'waybill'::text kind from public.waybills union all select id,workspace_id,order_id,tracking,path,sha256,file_name,created_at,deleted_at,'legacy'::text kind from public.legacy_files;
grant select on public.file_archive to authenticated;
create or replace function public.queue_deletion(p_ids uuid[],p_from timestamptz,p_to timestamptz) returns int language plpgsql security definer set search_path='' as $$declare w uuid:=public.my_workspace();n int;m int;begin
 if not public.is_admin() or p_from>=p_to or array_length(p_ids,1)>500 then raise exception 'Invalid deletion request';end if;
 insert into public.retention_jobs(workspace_id,bill_id,path) select w,id,path from public.waybills where workspace_id=w and id=any(p_ids) and created_at>=p_from and created_at<p_to and deleted_at is null on conflict do nothing;get diagnostics n=row_count;
 insert into public.retention_jobs(workspace_id,legacy_id,path) select w,id,path from public.legacy_files where workspace_id=w and id=any(p_ids) and coalesce(created_at,imported_at)>=p_from and coalesce(created_at,imported_at)<p_to and deleted_at is null on conflict do nothing;get diagnostics m=row_count;return n+m;end$$;
create or replace view public.file_archive with(security_invoker=true) as select id,workspace_id,order_id,tracking,path,sha256,file_name,created_at,deleted_at,'waybill'::text kind from public.waybills union all select id,workspace_id,order_id,tracking,path,sha256,file_name,coalesce(created_at,imported_at) created_at,deleted_at,'legacy'::text kind from public.legacy_files;
