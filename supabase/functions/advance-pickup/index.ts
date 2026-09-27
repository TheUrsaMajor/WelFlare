import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in to update this pickup.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  let body: { claimId?: string; status?: string; note?: string }
  try { body = await request.json() } catch { return reply({ error: 'The pickup update could not be read.' }, 400) }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.claimId ?? '')) || !['picked_up','delivered','cancelled'].includes(String(body.status)) || String(body.note ?? '').length > 500) return reply({ error: 'Choose a valid pickup update.' }, 400)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await admin.rpc('advance_pickup_claim', { p_claim_id: body.claimId, p_actor_id: user.id, p_status: body.status, p_note: String(body.note ?? '').trim() })
  if (error) return reply({ error: error.message.includes('after their best-before time') ? 'Food cannot be handed over after its best-before time.' : 'This update is not available for your pickup. Refresh and check the current status.' }, 409)
  return reply({ claimId: body.claimId, status: body.status })
})
