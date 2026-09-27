-- WelFlare baseline schema. Run this in a fresh Supabase project.
-- Sensitive application and bank fields live in a service-role-only table.
-- Do not put the service role key in the browser.

create extension if not exists pgcrypto;

create type public.donation_category as enum ('food', 'clothes', 'books', 'educational_supplies', 'medical_supplies', 'household_items', 'toys', 'beddings', 'toiletries', 'electronics', 'other_goods', 'monetary_donations');
create type public.verification_status as enum ('pending_verification', 'under_review', 'verified', 'rejected', 'suspended');
create type public.donation_status as enum ('draft', 'posted', 'claimed', 'picked_up', 'delivered', 'cancelled', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  account_kind text not null default 'individual' check (account_kind in ('individual','organization')),
  organization_type text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('USER','DONOR','RECIPIENT','VOLUNTEER','ADMIN')),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(user_id, role)
);
alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.platform_admins (user_id uuid primary key references auth.users(id) on delete cascade, added_at timestamptz not null default now());
revoke all on private.platform_admins from public, anon, authenticated;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, account_kind, organization_type)
  values(new.id, coalesce(new.raw_user_meta_data ->> 'display_name',''),
    case when new.raw_user_meta_data ->> 'account_kind' = 'organization' then 'organization' else 'individual' end,
    case when new.raw_user_meta_data ->> 'account_kind' = 'organization' then new.raw_user_meta_data ->> 'organization_type' else null end)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.add_default_user_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.user_roles(user_id, role) values(new.id, 'USER') on conflict do nothing; return new; end;
$$;
create trigger on_profile_created_add_role after insert on public.profiles for each row execute function public.add_default_user_role();

create function public.save_my_onboarding(p_account_kind text, p_organization_type text default null, p_intent text default 'donate')
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_account_kind not in ('individual','organization') then raise exception 'Invalid account kind'; end if;
  if p_account_kind = 'organization' and p_organization_type not in ('restaurant','catering_service','hotel','hostel','pg','school','college','corporate','retail_store','ngo','trust','society','section_8_company','other') then raise exception 'Invalid organization type'; end if;
  if p_intent not in ('donate','receive','both','volunteer') then raise exception 'Invalid participation choice'; end if;
  update public.profiles set account_kind = p_account_kind, organization_type = case when p_account_kind = 'organization' then p_organization_type else null end where id = (select auth.uid());
  delete from public.user_roles where user_id = (select auth.uid()) and role in ('DONOR','VOLUNTEER');
  if p_intent in ('donate','both') then insert into public.user_roles(user_id,role) values((select auth.uid()),'DONOR') on conflict do nothing; end if;
  if p_intent = 'volunteer' then insert into public.user_roles(user_id,role) values((select auth.uid()),'VOLUNTEER') on conflict do nothing; end if;
  return true;
end;
$$;
revoke all on function public.save_my_onboarding(text,text,text) from public, anon;
grant execute on function public.save_my_onboarding(text,text,text) to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  organization_type text not null check (organization_type in ('trust','society','section_8_company','other_nonprofit')),
  accepts public.donation_category[] not null default '{}',
  verification_status public.verification_status not null default 'pending_verification',
  fcra_status text not null default 'not_applicable' check (fcra_status in ('not_applicable','pending','verified','rejected','suspended')),
  darpan_verified boolean not null default false,
  registration_verified boolean not null default false,
  pan_verified boolean not null default false,
  bank_verified boolean not null default false,
  twelve_ab_verified boolean not null default false,
  eighty_g_verified boolean not null default false,
  fcra_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Never grant authenticated clients direct access to this table. Service-role
-- Edge Functions encrypt values before insertion and decrypt only for review.
create table public.ngo_private_applications (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  darpan_id_ciphertext bytea not null,
  pan_ciphertext bytea not null,
  registration_number_ciphertext bytea not null,
  registered_address_ciphertext bytea not null,
  representative_name_ciphertext bytea not null,
  representative_contact_ciphertext bytea not null,
  account_holder_ciphertext bytea not null,
  bank_account_ciphertext bytea not null,
  bank_name_ciphertext bytea not null,
  ifsc_ciphertext bytea not null,
  twelve_ab_ciphertext bytea,
  eighty_g_ciphertext bytea,
  fcra_reference_ciphertext bytea,
  fcra_requested boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.organization_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  storage_path text not null unique,
  expires_at timestamptz,
  is_required boolean not null default true,
  review_status text not null default 'pending' check(review_status in ('pending','verified','rejected','expired')),
  created_at timestamptz not null default now()
);

create function public.organization_required_documents_current(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    not exists(select 1 from public.organization_documents d where d.organization_id = p_organization_id and d.is_required and (d.review_status <> 'verified' or (d.expires_at is not null and d.expires_at <= now())))
    and not exists(select 1 from unnest(array['registration_certificate','pan_document','representative_proof','bank_proof']) as required(required_type) where not exists(select 1 from public.organization_documents d where d.organization_id = p_organization_id and d.document_type = required.required_type and d.is_required and d.review_status = 'verified' and (d.expires_at is null or d.expires_at > now())))
$$;
revoke all on function public.organization_required_documents_current(uuid) from public;
grant execute on function public.organization_required_documents_current(uuid) to anon, authenticated;

create table public.verification_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  admin_id uuid references public.profiles(id),
  action text not null check(action in ('submitted','under_review','approved','rejected','suspended','reinstated','document_verified','document_rejected','fcra_approved','fcra_rejected')),
  reason text,
  created_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'volunteer' check(member_role in ('volunteer','recipient_staff')),
  status text not null default 'invited' check(status in ('invited','active','revoked')),
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,user_id)
);

create table public.organization_member_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null check(action in ('invited','accepted','revoked')),
  created_at timestamptz not null default now()
);

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.profiles(id),
  recipient_organization_id uuid references public.organizations(id),
  category public.donation_category not null,
  item_name text not null check(length(item_name) between 2 and 120),
  description text not null default '',
  quantity numeric not null check(quantity > 0),
  unit text not null,
  condition text,
  food_type text,
  prepared_at timestamptz,
  expires_at timestamptz,
  pickup_deadline timestamptz not null,
  location_area text not null,
  exact_address_ciphertext bytea,
  storage_notes text,
  food_safety_declaration boolean not null default false,
  food_safety_declaration_version text,
  food_safety_declared_at timestamptz,
  food_safety_declared_by uuid references public.profiles(id),
  status public.donation_status not null default 'posted',
  created_at timestamptz not null default now(),
  constraint food_expiry_required check(category <> 'food' or expires_at is not null),
  constraint food_safety_required check(category <> 'food' or food_safety_declaration),
  constraint expiry_in_future check(category <> 'food' or expires_at > created_at)
);

create table public.donation_photos (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table public.pickup_claims (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id),
  claimant_id uuid not null references public.profiles(id),
  recipient_organization_id uuid references public.organizations(id),
  status text not null default 'requested' check(status in ('requested','accepted','picked_up','delivered','cancelled')),
  created_at timestamptz not null default now()
);
create unique index pickup_one_active_claim_idx on public.pickup_claims(donation_id) where status in ('accepted','picked_up');

create table public.pickup_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.pickup_claims(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  status text not null check(status in ('accepted','picked_up','delivered','cancelled')),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index organizations_status_idx on public.organizations(verification_status, created_at);
create index organization_documents_review_idx on public.organization_documents(organization_id, is_required, review_status, expires_at);
create index donations_active_expiry_idx on public.donations(status, category, expires_at, pickup_deadline);
create index donations_owner_created_idx on public.donations(donor_id, created_at desc);
create index pickup_claims_actor_created_idx on public.pickup_claims(claimant_id, created_at desc);
create index verification_audit_admin_created_idx on public.verification_audit_log(admin_id, created_at desc);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.platform_admins a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
create function public.is_donation_owner(p_donation_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.donations d where d.id = p_donation_id and d.donor_id = (select auth.uid()))
$$;
revoke all on function public.is_donation_owner(uuid) from public, anon;
grant execute on function public.is_donation_owner(uuid) to authenticated;
create policy "users can view their own role labels" on public.user_roles for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create function public.is_platform_admin(p_user_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.platform_admins a where a.user_id = p_user_id)
$$;
revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;

create function public.admin_update_organization_review(
  p_organization_id uuid, p_admin_id uuid, p_action text, p_reason text,
  p_verification_status public.verification_status default null,
  p_fcra_status text default null, p_checks jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.platform_admins where user_id = p_admin_id) then raise exception 'Unauthorized administrator'; end if;
  if length(trim(coalesce(p_reason,''))) < 8 or length(p_reason) > 1200 then raise exception 'A review reason is required'; end if;
  if p_action not in ('under_review','approved','rejected','suspended','reinstated','fcra_approved','fcra_rejected') then raise exception 'Invalid audit action'; end if;
  update public.organizations set
    verification_status = coalesce(p_verification_status, verification_status),
    fcra_status = coalesce(p_fcra_status, fcra_status),
    darpan_verified = coalesce((p_checks ->> 'darpan')::boolean, darpan_verified),
    registration_verified = coalesce((p_checks ->> 'registration')::boolean, registration_verified),
    pan_verified = coalesce((p_checks ->> 'pan')::boolean, pan_verified),
    bank_verified = coalesce((p_checks ->> 'bank')::boolean, bank_verified),
    twelve_ab_verified = coalesce((p_checks ->> 'twelve_ab')::boolean, twelve_ab_verified),
    eighty_g_verified = coalesce((p_checks ->> 'eighty_g')::boolean, eighty_g_verified),
    fcra_verified = coalesce((p_checks ->> 'fcra')::boolean, fcra_verified),
    updated_at = now()
  where id = p_organization_id;
  if not found then raise exception 'Organization not found'; end if;
  insert into public.verification_audit_log(organization_id, admin_id, action, reason)
  values(p_organization_id, p_admin_id, p_action, trim(p_reason));
  if p_verification_status = 'verified' then insert into public.user_roles(user_id,role,granted_by) select owner_id,'RECIPIENT',p_admin_id from public.organizations where id=p_organization_id on conflict do nothing; end if;
  return true;
end;
$$;
revoke all on function public.admin_update_organization_review(uuid, uuid, text, text, public.verification_status, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_organization_review(uuid, uuid, text, text, public.verification_status, text, jsonb) to service_role;

create function public.admin_review_organization_document(
  p_organization_id uuid, p_document_id uuid, p_admin_id uuid, p_document_status text, p_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare document_type text; document_expiry timestamptz;
begin
  if not exists(select 1 from private.platform_admins where user_id = p_admin_id) then raise exception 'Unauthorized administrator'; end if;
  if p_document_status not in ('verified','rejected') or length(trim(coalesce(p_reason,''))) < 8 then raise exception 'Invalid document review'; end if;
  select d.document_type, d.expires_at into document_type, document_expiry from public.organization_documents d where d.id = p_document_id and d.organization_id = p_organization_id;
  if not found then raise exception 'Document not found'; end if;
  if p_document_status = 'verified' and document_expiry is not null and document_expiry <= now() then raise exception 'Expired documents cannot be verified'; end if;
  update public.organization_documents set review_status = p_document_status where id = p_document_id;
  insert into public.verification_audit_log(organization_id, admin_id, action, reason)
  values(p_organization_id, p_admin_id, case when p_document_status = 'verified' then 'document_verified' else 'document_rejected' end, document_type || ': ' || trim(p_reason));
  return true;
end;
$$;
revoke all on function public.admin_review_organization_document(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_organization_document(uuid, uuid, uuid, text, text) to service_role;

alter table public.organization_memberships enable row level security;
grant select on public.organization_memberships to authenticated;
create policy "members can see their own invitation" on public.organization_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy "organization owner and admin can manage membership list" on public.organization_memberships for select to authenticated using (exists(select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())) or public.is_admin());
revoke insert, update, delete on public.organization_memberships from anon, authenticated;
alter table public.organization_member_events enable row level security;
grant select on public.organization_member_events to authenticated;
create policy "membership participants can read invitation history" on public.organization_member_events for select to authenticated using (user_id = (select auth.uid()) or exists(select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())) or public.is_admin());
revoke insert, update, delete on public.organization_member_events from anon, authenticated;

create function public.accept_organization_invitation(p_membership_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare m public.organization_memberships%rowtype;
begin
  if not exists(select 1 from auth.users where id = p_user_id) then raise exception 'User not found'; end if;
  select * into m from public.organization_memberships where id = p_membership_id and user_id = p_user_id for update;
  if not found or m.status <> 'invited' then raise exception 'Invitation unavailable'; end if;
  if not exists(select 1 from public.organizations where id = m.organization_id and verification_status = 'verified') then raise exception 'Organization is not currently verified'; end if;
  update public.organization_memberships set status = 'active', updated_at = now() where id = m.id;
  insert into public.organization_member_events(organization_id,user_id,actor_id,action) values(m.organization_id,p_user_id,p_user_id,'accepted');
  return true;
end;
$$;
revoke all on function public.accept_organization_invitation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.accept_organization_invitation(uuid,uuid) to service_role;

create function public.request_verified_pickup(p_donation_id uuid, p_actor_id uuid, p_organization_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.donations%rowtype; claim_key uuid := gen_random_uuid();
begin
  select * into d from public.donations where id = p_donation_id for update;
  if not found or d.status <> 'posted' or d.donor_id = p_actor_id or d.pickup_deadline <= now() or (d.category = 'food' and (d.expires_at is null or d.expires_at <= now())) then raise exception 'Donation is unavailable or expired'; end if;
  if not exists(select 1 from public.organizations o where o.id = p_organization_id and o.verification_status = 'verified' and d.category = any(o.accepts) and (d.recipient_organization_id is null or d.recipient_organization_id = o.id) and (o.owner_id = p_actor_id or exists(select 1 from public.organization_memberships m where m.organization_id = o.id and m.user_id = p_actor_id and m.member_role = 'volunteer' and m.status = 'active'))) then raise exception 'Organization is not eligible for this donation'; end if;
  if exists(select 1 from public.organization_documents doc where doc.organization_id = p_organization_id and doc.is_required and (doc.review_status <> 'verified' or (doc.expires_at is not null and doc.expires_at <= now()))) then raise exception 'Required organization documents are not current'; end if;
  insert into public.pickup_claims(id, donation_id, claimant_id, recipient_organization_id, status) values(claim_key, p_donation_id, p_actor_id, p_organization_id, 'accepted');
  update public.donations set status = 'claimed', recipient_organization_id = p_organization_id where id = p_donation_id;
  insert into public.pickup_events(claim_id, actor_id, status, note) values(claim_key, p_actor_id, 'accepted', 'Pickup requested by verified recipient.');
  return claim_key;
end;
$$;
revoke all on function public.request_verified_pickup(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_verified_pickup(uuid, uuid, uuid) to service_role;

create function public.advance_pickup_claim(p_claim_id uuid, p_actor_id uuid, p_status text, p_note text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.pickup_claims%rowtype; d public.donations%rowtype;
begin
  select * into c from public.pickup_claims where id = p_claim_id for update;
  if not found or c.claimant_id <> p_actor_id then raise exception 'Pickup is not assigned to this account'; end if;
  select * into d from public.donations where id = c.donation_id for update;
  if not exists(select 1 from public.organizations o where o.id = c.recipient_organization_id and o.verification_status = 'verified' and d.category = any(o.accepts) and (o.owner_id = p_actor_id or exists(select 1 from public.organization_memberships m where m.organization_id = o.id and m.user_id = p_actor_id and m.member_role = 'volunteer' and m.status = 'active'))) then raise exception 'Recipient organization is no longer eligible'; end if;
  if exists(select 1 from public.organization_documents doc where doc.organization_id = c.recipient_organization_id and doc.is_required and (doc.review_status <> 'verified' or (doc.expires_at is not null and doc.expires_at <= now()))) then raise exception 'Required recipient documents are no longer current'; end if;
  if p_status not in ('picked_up','delivered','cancelled') or length(p_note) > 500 then raise exception 'Invalid pickup update'; end if;
  if p_status = 'picked_up' and c.status <> 'accepted' then raise exception 'Pickup must be accepted first'; end if;
  if p_status = 'delivered' and c.status <> 'picked_up' then raise exception 'Mark the pickup as collected first'; end if;
  if p_status = 'cancelled' and c.status not in ('accepted','picked_up') then raise exception 'This pickup cannot be cancelled now'; end if;
  if d.category = 'food' and d.expires_at <= now() and p_status in ('picked_up','delivered') then raise exception 'Food donations cannot be handed over after their best-before time'; end if;
  update public.pickup_claims set status = p_status where id = c.id;
  update public.donations set status = case when p_status = 'delivered' then 'delivered'::public.donation_status when p_status = 'picked_up' then 'picked_up'::public.donation_status when p_status = 'cancelled' and pickup_deadline > now() and (category <> 'food' or expires_at > now()) then 'posted'::public.donation_status when p_status = 'cancelled' then 'expired'::public.donation_status else status end where id = d.id;
  insert into public.pickup_events(claim_id, actor_id, status, note) values(c.id, p_actor_id, p_status, left(trim(p_note),500));
  return true;
end;
$$;
revoke all on function public.advance_pickup_claim(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.advance_pickup_claim(uuid, uuid, text, text) to service_role;

-- Roles are set by a trusted administrator only; a user cannot grant themselves admin.
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
create policy "profile owner can read profile" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy "profile owner can create profile" on public.profiles for insert to authenticated with check (id = (select auth.uid()) and organization_type is distinct from 'platform_admin');
create policy "profile owner can update non-role fields" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()) and organization_type is distinct from 'platform_admin');
revoke update (organization_type) on public.profiles from authenticated;

alter table public.organizations enable row level security;
create policy "public can view current verified organization profile" on public.organizations for select to anon, authenticated using (verification_status = 'verified' and public.organization_required_documents_current(id));
create policy "owner can view own application" on public.organizations for select to authenticated using (owner_id = (select auth.uid()));
create policy "admin can view all organizations" on public.organizations for select to authenticated using (public.is_admin());
create policy "owner can submit organization application" on public.organizations for insert to authenticated with check (owner_id = (select auth.uid()) and verification_status = 'pending_verification');
revoke insert on public.organizations from anon, authenticated;
create policy "admin can update organization verification" on public.organizations for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke select on public.organizations from anon, authenticated;
grant select (id, owner_id, name, organization_type, accepts, verification_status, fcra_status, darpan_verified, registration_verified, pan_verified, bank_verified, twelve_ab_verified, eighty_g_verified, fcra_verified, created_at) on public.organizations to anon, authenticated;
revoke update (verification_status, fcra_status, registration_verified, pan_verified, bank_verified, twelve_ab_verified, eighty_g_verified, fcra_verified) on public.organizations from authenticated;

alter table public.ngo_private_applications enable row level security;
-- No client policies or table grants: only Edge Functions using the service role access this table.
revoke all on public.ngo_private_applications from anon, authenticated;

alter table public.organization_documents enable row level security;
grant select on public.organization_documents to authenticated;
create policy "organization owner can list document metadata" on public.organization_documents for select to authenticated using (exists(select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid())) or public.is_admin());
create policy "organization owner can attach documents" on public.organization_documents for insert to authenticated with check (exists(select 1 from public.organizations o where o.id = organization_id and o.owner_id = (select auth.uid()) and o.verification_status = 'pending_verification'));
create policy "admin can review documents" on public.organization_documents for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert on public.organization_documents from anon, authenticated;

alter table public.verification_audit_log enable row level security;
grant select on public.verification_audit_log to authenticated;
create policy "admin can read audit log" on public.verification_audit_log for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.verification_audit_log from anon, authenticated;

alter table public.donations enable row level security;
grant select (id, donor_id, recipient_organization_id, category, item_name, description, quantity, unit, condition, food_type, prepared_at, expires_at, pickup_deadline, location_area, storage_notes, food_safety_declaration, food_safety_declaration_version, food_safety_declared_at, food_safety_declared_by, status, created_at) on public.donations to anon, authenticated;
create policy "active nonexpired donations visible" on public.donations for select to anon, authenticated using (status = 'posted' and pickup_deadline > now() and (category <> 'food' or expires_at > now()));
create policy "donors can read own donations" on public.donations for select to authenticated using (donor_id = (select auth.uid()));
create policy "claimants can read claimed donations" on public.donations for select to authenticated using (exists(select 1 from public.pickup_claims c where c.donation_id = id and c.claimant_id = (select auth.uid())));
create policy "donors create their own donation" on public.donations for insert to authenticated with check (donor_id = (select auth.uid()) and (category <> 'food' or (food_safety_declaration and food_safety_declared_by = (select auth.uid()) and food_safety_declared_at is not null and expires_at > now())));
revoke insert on public.donations from anon, authenticated;
revoke select on public.donations from anon, authenticated;
grant select (id, donor_id, recipient_organization_id, category, item_name, description, quantity, unit, condition, food_type, prepared_at, expires_at, pickup_deadline, location_area, storage_notes, food_safety_declaration, food_safety_declaration_version, food_safety_declared_at, food_safety_declared_by, status, created_at) on public.donations to anon, authenticated;
create policy "donors cancel own donations" on public.donations for update to authenticated using (donor_id = (select auth.uid())) with check (donor_id = (select auth.uid()) and status = 'cancelled');

alter table public.donation_photos enable row level security;
grant select on public.donation_photos to anon, authenticated;
revoke insert, update, delete on public.donation_photos from anon, authenticated;
create policy "public can read photos of active donations" on public.donation_photos for select to anon, authenticated using (exists(select 1 from public.donations d where d.id = donation_id and d.status in ('posted','claimed','picked_up','delivered')));
create policy "donors attach photos to own donation" on public.donation_photos for insert to authenticated with check (exists(select 1 from public.donations d where d.id = donation_id and d.donor_id = (select auth.uid())));

alter table public.pickup_claims enable row level security;
grant select on public.pickup_claims to authenticated;
create policy "claimants can view own claims" on public.pickup_claims for select to authenticated using (claimant_id = (select auth.uid()) or public.is_admin());
create policy "donors can view claims on their donations" on public.pickup_claims for select to authenticated using (public.is_donation_owner(donation_id));
revoke insert, update, delete on public.pickup_claims from anon, authenticated;

alter table public.pickup_events enable row level security;
grant select on public.pickup_events to authenticated;
create policy "donors and recipient can see pickup history" on public.pickup_events for select to authenticated using (
  exists(select 1 from public.pickup_claims c where c.id = claim_id and (c.claimant_id = (select auth.uid()) or public.is_donation_owner(c.donation_id))) or public.is_admin()
);
revoke insert, update, delete on public.pickup_events from anon, authenticated;

-- Documents live in a private bucket; donation photos are public by design after publication.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ngo-private-documents', 'ngo-private-documents', false, 12582912, array['application/pdf','image/jpeg','image/png','image/webp']),
       ('donation-photos', 'donation-photos', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy "organization owners and admins can view private documents" on storage.objects for select to authenticated using (
  bucket_id = 'ngo-private-documents' and (public.is_admin() or exists(
    select 1 from public.organizations o where o.id::text = (storage.foldername(name))[1] and o.owner_id = (select auth.uid())
  ))
);
create policy "organization owners can upload private documents" on storage.objects for insert to authenticated with check (
  bucket_id = 'ngo-private-documents' and exists(
    select 1 from public.organizations o where o.id::text = (storage.foldername(name))[1] and o.owner_id = (select auth.uid()) and o.verification_status = 'pending_verification'
  )
);
create policy "donation owners can add a donation photo" on storage.objects for insert to authenticated with check (
  bucket_id = 'donation-photos' and exists(
    select 1 from public.donations d where d.id::text = (storage.foldername(name))[1] and d.donor_id = (select auth.uid())
  )
);

-- Production claim, submission and verification mutations should be implemented
-- as authenticated Edge Functions with a server-owned service role and audit insert.
-- Never accept a verification status or admin id from browser input.
