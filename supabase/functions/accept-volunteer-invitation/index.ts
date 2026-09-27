import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in to accept this invitation.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  let body: { invitationId?: string }
  try { body = await request.json() } catch { return reply({ error: 'The invitation could not be read.' }, 400) }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.invitationId ?? ''))) return reply({ error: 'Choose a valid volunteer invitation.' }, 400)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await admin.rpc('accept_organization_invitation', { p_membership_id: body.invitationId, p_user_id: user.id })
  if (error) return reply({ error: 'This invitation is no longer available or the organization is not currently verified.' }, 409)
  return reply({ invitationId: body.invitationId, status: 'active' })
})
