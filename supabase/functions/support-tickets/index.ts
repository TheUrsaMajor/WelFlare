import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to contact support.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your sign-in has expired. Please sign in again.' }, 401)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  if (request.method === 'GET') {
    const { data, error } = await admin.from('support_tickets').select('id,category,subject,description,related_donation_id,status,priority,admin_response,created_at,updated_at,closed_at').eq('created_by', user.id).order('created_at', { ascending: false }).limit(100)
    return error ? json({ error: 'Your support requests could not be loaded.' }, 503) : json({ tickets: data ?? [] })
  }
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json({ error: 'The support request could not be read.' }, 400) }
  const categories = new Set(['dispute', 'abuse', 'donation', 'pickup', 'account', 'other'])
  const subject = String(body.subject ?? '').trim(), description = String(body.description ?? '').trim(), category = String(body.category ?? '')
  const related = body.relatedDonationId ? String(body.relatedDonationId) : null
  if (!categories.has(category) || subject.length < 4 || subject.length > 140 || description.length < 10 || description.length > 4000 || (related && !/^[0-9a-f-]{36}$/i.test(related))) return json({ error: 'Check the category, subject, description and related donation.' }, 400)
  const since = new Date(Date.now() - 86400000).toISOString()
  const { count, error: countError } = await admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('created_by', user.id).gte('created_at', since)
  if (countError) return json({ error: 'We could not check support request limits. Please try again.' }, 503)
  if ((count ?? 0) >= 5) return json({ error: 'You have reached the daily support request limit. Please try again tomorrow.' }, 429)
  const { data, error } = await admin.from('support_tickets').insert({ created_by: user.id, category, subject, description, related_donation_id: related }).select('id,category,subject,description,related_donation_id,status,priority,admin_response,created_at,updated_at,closed_at').single()
  return error ? json({ error: 'Your support request could not be submitted. Please try again.' }, 503) : json({ ticket: data }, 201)
})
