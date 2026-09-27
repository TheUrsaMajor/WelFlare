import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in and apply as a recipient organization to request a pickup.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  let body: { donationId?: string }
  try { body = await request.json() } catch { return reply({ error: 'The pickup request could not be read.' }, 400) }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.donationId ?? ''))) return reply({ error: 'Choose a valid donation.' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count: recentRequests, error: rateError } = await admin.from('pickup_claims').select('id', { count: 'exact', head: true }).eq('claimant_id', user.id).gte('created_at', tenMinutesAgo)
  if (rateError) return reply({ error: 'The pickup service could not check request limits. Please try again shortly.' }, 503)
  if ((recentRequests ?? 0) >= 10) return reply({ error: 'You’ve reached the pickup request limit for now. Please try again later.' }, 429)
  const [{ data: owned, error: ownerError }, { data: memberships, error: memberError }] = await Promise.all([
    admin.from('organizations').select('id').eq('owner_id', user.id),
    admin.from('organization_memberships').select('organization_id').eq('user_id', user.id).eq('member_role','volunteer').eq('status','active'),
  ])
  if (ownerError || memberError) return reply({ error: 'Your verified organization access could not be checked.' }, 503)
  const organizationIds = [...new Set([...(owned ?? []).map(org => org.id), ...(memberships ?? []).map(member => member.organization_id)])]
  if (!organizationIds.length) return reply({ error: 'Pickup requests are available to verified organizations and their invited volunteers.' }, 403)
  const { data: organizations, error: orgError } = await admin.from('organizations').select('id,verification_status,accepts').in('id', organizationIds).eq('verification_status', 'verified')
  if (orgError || !organizations?.length) return reply({ error: 'Your recipient organization is not currently verified.' }, 403)
  const { data: donation, error: donationError } = await admin.from('donations').select('id,category,status,expires_at,pickup_deadline,recipient_organization_id').eq('id', body.donationId).maybeSingle()
  if (donationError || !donation || donation.status !== 'posted') return reply({ error: 'This donation is no longer available.' }, 409)
  const now = new Date()
  if (new Date(donation.pickup_deadline) <= now || (donation.category === 'food' && (!donation.expires_at || new Date(donation.expires_at) <= now))) return reply({ error: 'This donation has expired or its pickup window has passed.' }, 409)

  const compatible = organizations.find(org => org.accepts.includes(donation.category) && (!donation.recipient_organization_id || donation.recipient_organization_id === org.id))
  if (!compatible) return reply({ error: 'Your verified organization does not accept this donation type.' }, 403)
  const { data: requiredDocs, error: docsError } = await admin.from('organization_documents').select('review_status,expires_at').eq('organization_id', compatible.id).eq('is_required', true)
  if (docsError || !requiredDocs?.length || requiredDocs.some(doc => doc.review_status !== 'verified' || (doc.expires_at && new Date(doc.expires_at) <= now))) return reply({ error: 'A required organization document needs review or renewal. Please contact WelFlare.' }, 403)
  const { data: claimId, error: claimError } = await admin.rpc('request_verified_pickup', { p_donation_id: donation.id, p_actor_id: user.id, p_organization_id: compatible.id })
  if (claimError) return reply({ error: 'This donation is no longer available or the organization does not meet its current eligibility requirements.' }, 409)
  return reply({ claimId, donationId: donation.id, organizationId: compatible.id, status: 'accepted' }, 201)
})
