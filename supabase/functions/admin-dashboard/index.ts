import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Administrator sign-in is required.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your sign-in has expired. Please sign in again.' }, 401)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: allowed, error: roleError } = await admin.rpc('is_platform_admin', { p_user_id: user.id })
  if (roleError) return json({ error: 'Administrator access could not be checked.' }, 503)
  if (allowed !== true) return json({ error: 'This area is restricted to authorized administrators.' }, 403)

  if (request.method === 'POST') {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return json({ error: 'The requested action could not be read.' }, 400) }
    const action = String(body.action ?? ''), reason = String(body.reason ?? '').trim(), targetId = body.targetId
    if (!uuid(targetId) || reason.length < 8 || reason.length > 1200) return json({ error: 'Choose a valid record and enter a reason of 8 to 1200 characters.' }, 400)
    if (['listing_hidden', 'listing_restored', 'ticket_updated'].includes(action)) {
      const targetType = action === 'ticket_updated' ? 'support_ticket' : 'donation'
      const payload = action === 'ticket_updated' ? { status: body.status, priority: body.priority, admin_response: String(body.adminResponse ?? '').slice(0, 4000) } : {}
      const { error } = await admin.rpc('admin_apply_console_action', { p_admin_id: user.id, p_action: action, p_target_type: targetType, p_target_id: targetId, p_reason: reason, p_payload: payload })
      return error ? json({ error: error.message || 'The action could not be recorded.' }, 400) : json({ ok: true })
    }
    if (!['suspend_user', 'restore_user'].includes(action)) return json({ error: 'That administrator action is not available.' }, 400)
    if (targetId === user.id) return json({ error: 'You cannot suspend your own administrator account.' }, 400)
    const { data: isAdmin, error: targetRoleError } = await admin.rpc('is_platform_admin', { p_user_id: targetId })
    if (targetRoleError) return json({ error: 'The account role could not be checked.' }, 503)
    if (isAdmin) return json({ error: 'Administrator accounts cannot be suspended from this screen.' }, 403)
    const { data: before, error: getError } = await admin.auth.admin.getUserById(targetId)
    if (getError || !before.user) return json({ error: 'That account could not be found.' }, 404)
    const { error: changeError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: action === 'suspend_user' ? '876000h' : 'none' })
    if (changeError) return json({ error: 'The account status could not be changed.' }, 503)
    const { error: auditError } = await admin.from('admin_audit_log').insert({ admin_id: user.id, action, target_type: 'user', target_id: targetId, reason, metadata: { previous_banned_until: before.user.banned_until ?? null } })
    if (auditError) {
      const remainingMs = before.user.banned_until ? new Date(before.user.banned_until).getTime() - Date.now() : 0
      const rollbackDuration = remainingMs > 0 ? `${Math.ceil(remainingMs / 1000)}s` : 'none'
      await admin.auth.admin.updateUserById(targetId, { ban_duration: rollbackDuration })
      return json({ error: 'The audit record could not be saved, so the account change was rolled back.' }, 503)
    }
    return json({ ok: true })
  }

  const [usersResult, profilesResult, donationsResult, moderationResult, ticketsResult, auditResult, ngoAuditResult, donationCount, ticketCount, orgCount] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from('profiles').select('id,display_name,account_kind,organization_type,created_at'),
    admin.from('donations').select('id,donor_id,category,item_name,quantity,unit,location_area,pickup_deadline,expires_at,status,created_at').order('created_at', { ascending: false }).limit(100),
    admin.from('donation_moderation').select('donation_id,visibility,reason,updated_at,moderated_by'),
    admin.from('support_tickets').select('id,created_by,category,subject,description,related_donation_id,status,priority,admin_response,assigned_admin,created_at,updated_at,closed_at').order('created_at', { ascending: false }).limit(100),
    admin.from('admin_audit_log').select('id,admin_id,action,target_type,target_id,reason,metadata,created_at').order('created_at', { ascending: false }).limit(100),
    admin.from('verification_audit_log').select('*').order('created_at', { ascending: false }).limit(100),
    admin.from('donations').select('id', { count: 'exact', head: true }),
    admin.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    admin.from('organizations').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending_verification'),
  ])
  const required = [profilesResult, donationsResult, moderationResult, ticketsResult, auditResult, ngoAuditResult]
  if (usersResult.error || required.some(result => result.error)) return json({ error: 'The admin dashboard could not load all records. Please refresh.' }, 503)
  const profiles = new Map((profilesResult.data ?? []).map(profile => [profile.id, profile]))
  const moderation = new Map((moderationResult.data ?? []).map(item => [item.donation_id, item]))
  return json({
    summary: { users: usersResult.data.users.length, donations: donationCount.count ?? 0, openTickets: ticketCount.count ?? 0, pendingOrganizations: orgCount.count ?? 0 },
    users: usersResult.data.users.map(item => ({ id: item.id, email: item.email ?? '', created_at: item.created_at, banned_until: item.banned_until, profile: profiles.get(item.id) ?? null })),
    donations: (donationsResult.data ?? []).map(item => ({ ...item, moderation: moderation.get(item.id) ?? null })),
    tickets: ticketsResult.data ?? [], audit: auditResult.data ?? [], ngoAudit: ngoAuditResult.data ?? [],
  })
})
