-- Real profile, approximate donation map pins, and private notifications.
-- Safe to run once against an existing WelFlare database.

alter table public.profiles
  add column if not exists phone text not null default '',
  add column if not exists home_area text not null default '';

-- Google supplies `name`/`full_name`, while email signup supplies `display_name`.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, account_kind, organization_type)
  values(new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'name'), ''), ''),
    case when new.raw_user_meta_data ->> 'account_kind' = 'organization' then 'organization' else 'individual' end,
    case when new.raw_user_meta_data ->> 'account_kind' = 'organization' then new.raw_user_meta_data ->> 'organization_type' else null end)
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.donations
  add column if not exists location_latitude double precision,
  add column if not exists location_longitude double precision;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'donation_location_pair') then
    alter table public.donations add constraint donation_location_pair check (
      (location_latitude is null and location_longitude is null) or
      (location_latitude between -90 and 90 and location_longitude between -180 and 180)
    );
  end if;
end $$;

grant select (location_latitude, location_longitude) on public.donations to anon, authenticated;
create index if not exists donations_map_location_idx on public.donations(location_latitude, location_longitude) where status = 'posted';

create or replace function public.save_my_profile(p_display_name text, p_phone text default '', p_home_area text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in to update your profile'; end if;
  if length(trim(coalesce(p_display_name, ''))) not between 2 and 100 then raise exception 'Enter a name between 2 and 100 characters'; end if;
  if length(coalesce(p_phone, '')) > 32 or length(coalesce(p_home_area, '')) > 120 then raise exception 'Profile details are too long'; end if;
  update public.profiles set
    display_name = trim(p_display_name),
    phone = trim(coalesce(p_phone, '')),
    home_area = trim(coalesce(p_home_area, ''))
  where id = (select auth.uid());
  if not found then raise exception 'Your profile was not found'; end if;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', trim(p_display_name)) where id = (select auth.uid());
  return true;
end;
$$;
revoke all on function public.save_my_profile(text, text, text) from public, anon;
grant execute on function public.save_my_profile(text, text, text) to authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('pickup_request','pickup_update','organization_review','volunteer_invitation')),
  title text not null check (length(title) between 2 and 140),
  message text not null default '' check (length(message) <= 500),
  destination text not null default 'discover' check (destination in ('discover','donations','pickups','organizations','verification','profile')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index if not exists notifications_user_recent_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, delete on public.notifications from public, anon, authenticated;
drop policy if exists "users read their own notifications" on public.notifications;
drop policy if exists "users mark their own notifications read" on public.notifications;
create policy "users read their own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "users mark their own notifications read" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.notify_pickup_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item_name text; donor_id uuid;
begin
  select d.item_name, d.donor_id into item_name, donor_id from public.donations d where d.id = new.donation_id;
  if donor_id is not null then
    insert into public.notifications(user_id, kind, title, message, destination)
    values(donor_id, 'pickup_request', 'A pickup was requested', coalesce(item_name, 'Your donation') || ' has a verified recipient pickup request.', 'donations');
  end if;
  insert into public.notifications(user_id, kind, title, message, destination)
  values(new.claimant_id, 'pickup_request', 'Pickup request accepted', coalesce(item_name, 'Your pickup') || ' is ready to coordinate.', 'pickups');
  return new;
end;
$$;
revoke all on function public.notify_pickup_insert() from public, anon, authenticated;
drop trigger if exists pickup_insert_notifications on public.pickup_claims;
create trigger pickup_insert_notifications after insert on public.pickup_claims for each row execute function public.notify_pickup_insert();

create or replace function public.notify_pickup_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item_name text; donor_id uuid; status_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select d.item_name, d.donor_id into item_name, donor_id from public.donations d where d.id = new.donation_id;
  status_label := replace(new.status, '_', ' ');
  if donor_id is not null then
    insert into public.notifications(user_id, kind, title, message, destination)
    values(donor_id, 'pickup_update', 'Pickup status updated', coalesce(item_name, 'Your donation') || ' is now ' || status_label || '.', 'donations');
  end if;
  insert into public.notifications(user_id, kind, title, message, destination)
  values(new.claimant_id, 'pickup_update', 'Pickup status updated', coalesce(item_name, 'Your pickup') || ' is now ' || status_label || '.', 'pickups');
  return new;
end;
$$;
revoke all on function public.notify_pickup_status_change() from public, anon, authenticated;
drop trigger if exists pickup_status_notifications on public.pickup_claims;
create trigger pickup_status_notifications after update of status on public.pickup_claims for each row execute function public.notify_pickup_status_change();

create or replace function public.notify_organization_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification_status is not distinct from old.verification_status and new.fcra_status is not distinct from old.fcra_status then return new; end if;
  insert into public.notifications(user_id, kind, title, message, destination)
  values(new.owner_id, 'organization_review', 'Organization review updated', 'Your organization application status is now ' || replace(new.verification_status::text, '_', ' ') || '.', 'verification');
  return new;
end;
$$;
revoke all on function public.notify_organization_review() from public, anon, authenticated;
drop trigger if exists organization_review_notifications on public.organizations;
create trigger organization_review_notifications after update of verification_status, fcra_status on public.organizations for each row execute function public.notify_organization_review();

create or replace function public.notify_volunteer_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_name text;
begin
  if new.status <> 'invited' then return new; end if;
  select o.name into org_name from public.organizations o where o.id = new.organization_id;
  insert into public.notifications(user_id, kind, title, message, destination)
  values(new.user_id, 'volunteer_invitation', 'Pickup volunteer invitation', 'You have an invitation from ' || coalesce(org_name, 'a verified organization') || '.', 'pickups');
  return new;
end;
$$;
revoke all on function public.notify_volunteer_invitation() from public, anon, authenticated;
drop trigger if exists volunteer_invitation_notifications on public.organization_memberships;
create trigger volunteer_invitation_notifications after insert on public.organization_memberships for each row execute function public.notify_volunteer_invitation();
