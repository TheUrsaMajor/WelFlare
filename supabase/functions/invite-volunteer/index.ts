import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in as the verified organization manager.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  let body: { organizationId?: string; email?: string }
  try { body = await request.json() } catch { return reply({ error: 'The invitation details could not be read.' }, 400) }
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^[0-9a-f-]{36}$/i.test(String(body.organizationId ?? ''))) return reply({ error: 'Add a valid email address and organization.' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: organization } = await admin.from('organizations').select('id,owner_id,verification_status').eq('id', body.organizationId).maybeSingle()
  if (!organization || organization.owner_id !== user.id || organization.verification_status !== 'verified') return reply({ error: 'Only a verified organization manager can invite pickup volunteers.' }, 403)
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: rateError } = await admin.from('organization_member_events').select('id', { count: 'exact', head: true }).eq('actor_id', user.id).gte('created_at', hourAgo)
  if (rateError) return reply({ error: 'Invitation limits could not be checked.' }, 503)
  if ((count ?? 0) >= 20) return reply({ error: 'You’ve reached the volunteer invitation limit for this hour.' }, 429)

  let targetUser: { id: string; email?: string | null } | null = null
  for (let page = 1; page <= 10 && !targetUser; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return reply({ error: 'The volunteer account could not be looked up securely.' }, 503)
    targetUser = data.users.find(candidate => candidate.email?.toLowerCase() === email) ?? null
    if (data.users.length < 1000) break
  }
  if (!targetUser) return reply({ error: 'Ask the volunteer to create a WelFlare account first, then invite the email they used.' }, 404)
  if (targetUser.id === user.id) return reply({ error: 'You already manage this organization.' }, 400)
  const { data: volunteerRole } = await admin.from('user_roles').select('role').eq('user_id', targetUser.id).eq('role','VOLUNTEER').maybeSingle()
  if (!volunteerRole) return reply({ error: 'This account has not chosen Volunteer during onboarding.' }, 409)

  const { data: membership, error: membershipError } = await admin.from('organization_memberships').upsert({ organization_id: organization.id, user_id: targetUser.id, member_role: 'volunteer', status: 'invited', invited_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,user_id' }).select('id').single()
  if (membershipError) return reply({ error: 'The invitation could not be saved.' }, 500)
  const { error: logError } = await admin.from('organization_member_events').insert({ organization_id: organization.id, user_id: targetUser.id, actor_id: user.id, action: 'invited' })
  if (logError) return reply({ error: 'The invitation was saved but its history could not be recorded. Contact WelFlare support.' }, 500)
  return reply({ invitationId: membership.id, email, status: 'invited', next: 'Ask the volunteer to sign in to WelFlare and accept the invitation.' }, 201)
})
