-- Admin console, private moderation, support tickets, audit history and safe retries.

create table if not exists public.donation_creation_requests (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  donation_id uuid not null,
  state text not null default 'processing' check (state in ('processing','complete','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (donor_id, idempotency_key)
);
alter table public.donation_creation_requests enable row level security;
revoke all on public.donation_creation_requests from public, anon, authenticated;
grant all on public.donation_creation_requests to service_role;

create or replace function public.reserve_donation_creation(p_donor_id uuid, p_key uuid, p_new_donation_id uuid)
returns table(reservation_state text, reserved_donation_id uuid) language plpgsql security definer set search_path = '' as $$
declare current_state text; current_donation uuid;
begin
  insert into public.donation_creation_requests(donor_id,idempotency_key,donation_id,state)
    values(p_donor_id,p_key,p_new_donation_id,'processing') on conflict(donor_id,idempotency_key) do nothing;
  select state, donation_id into current_state,current_donation from public.donation_creation_requests
    where donor_id=p_donor_id and idempotency_key=p_key for update;
  if current_state='failed' then
    update public.donation_creation_requests set donation_id=p_new_donation_id,state='processing',updated_at=now()
      where donor_id=p_donor_id and idempotency_key=p_key;
    current_state := 'processing'; current_donation := p_new_donation_id;
  end if;
  return query select current_state,current_donation;
end;
$$;
revoke all on function public.reserve_donation_creation(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_donation_creation(uuid,uuid,uuid) to service_role;

create table if not exists public.donation_moderation (
  donation_id uuid primary key references public.donations(id) on delete cascade,
  visibility text not null check (visibility in ('hidden','visible')),
  reason text not null default '',
  moderated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.donation_moderation enable row level security;
revoke all on public.donation_moderation from public, anon, authenticated;
grant all on public.donation_moderation to service_role;

create or replace function public.donation_is_visible(p_donation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.donation_moderation m
    where m.donation_id = p_donation_id and m.visibility = 'hidden'
  );
$$;
revoke all on function public.donation_is_visible(uuid) from public;
grant execute on function public.donation_is_visible(uuid) to anon, authenticated;
drop policy if exists "active nonexpired donations visible" on public.donations;
create policy "active nonexpired donations visible" on public.donations for select to anon, authenticated
  using (status = 'posted' and pickup_deadline > now() and (category <> 'food' or expires_at > now()) and public.donation_is_visible(id));

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('dispute','abuse','donation','pickup','account','other')),
  subject text not null check (length(subject) between 4 and 140),
  description text not null check (length(description) between 10 and 4000),
  related_donation_id uuid references public.donations(id) on delete set null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  admin_response text not null default '' check (length(admin_response) <= 4000),
  assigned_admin uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_owner_created_idx on public.support_tickets(created_by, created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from public, anon, authenticated;
grant select on public.support_tickets to authenticated;
create policy "users can read their own support tickets" on public.support_tickets for select to authenticated
  using (created_by = (select auth.uid()));
grant all on public.support_tickets to service_role;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  action text not null check (length(action) between 2 and 80),
  target_type text not null check (length(target_type) between 2 and 40),
  target_id uuid,
  reason text not null check (length(reason) between 8 and 1200),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_log(target_type, target_id, created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant all on public.admin_audit_log to service_role;

create or replace function public.admin_apply_console_action(
  p_admin_id uuid, p_action text, p_target_type text, p_target_id uuid,
  p_reason text, p_payload jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare current_status text; current_deadline timestamptz; current_expiry timestamptz; current_category public.donation_category;
begin
  if not exists (select 1 from private.platform_admins where user_id = p_admin_id) then raise exception 'Unauthorized administrator'; end if;
  if length(trim(coalesce(p_reason,''))) < 8 or length(p_reason) > 1200 then raise exception 'A clear reason of 8 to 1200 characters is required'; end if;
  if p_target_type = 'donation' and p_action in ('listing_hidden','listing_restored') then
    select status::text, pickup_deadline, expires_at, category into current_status, current_deadline, current_expiry, current_category
      from public.donations where id = p_target_id for update;
    if not found then raise exception 'Donation was not found'; end if;
    if p_action = 'listing_restored' and (current_status <> 'posted' or current_deadline <= now() or (current_category = 'food' and (current_expiry is null or current_expiry <= now()))) then
      raise exception 'An expired or unavailable donation cannot be restored';
    end if;
    insert into public.donation_moderation(donation_id, visibility, reason, moderated_by, updated_at)
      values(p_target_id, case when p_action = 'listing_hidden' then 'hidden' else 'visible' end, trim(p_reason), p_admin_id, now())
      on conflict(donation_id) do update set visibility = excluded.visibility, reason = excluded.reason, moderated_by = excluded.moderated_by, updated_at = now();
  elsif p_target_type = 'support_ticket' and p_action = 'ticket_updated' then
    if p_payload->>'status' not in ('open','in_progress','resolved','closed') or p_payload->>'priority' not in ('low','normal','high','urgent') or length(coalesce(p_payload->>'admin_response','')) > 4000 then
      raise exception 'Invalid support ticket update';
    end if;
    update public.support_tickets set status = p_payload->>'status', priority = p_payload->>'priority',
      admin_response = coalesce(p_payload->>'admin_response', admin_response), assigned_admin = p_admin_id,
      updated_at = now(), closed_at = case when p_payload->>'status' in ('resolved','closed') then now() else null end
      where id = p_target_id;
    if not found then raise exception 'Support ticket was not found'; end if;
  else raise exception 'Unsupported administrator action';
  end if;
  insert into public.admin_audit_log(admin_id, action, target_type, target_id, reason, metadata)
    values(p_admin_id, p_action, p_target_type, p_target_id, trim(p_reason), p_payload - 'admin_response');
  return true;
end;
$$;
revoke all on function public.admin_apply_console_action(uuid,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.admin_apply_console_action(uuid,text,text,uuid,text,jsonb) to service_role;
