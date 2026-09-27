import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
function fromHex(value: string) { const hex = value.startsWith('\\x') ? value.slice(2) : value; return Uint8Array.from(hex.match(/.{2}/g) ?? [], pair => parseInt(pair, 16)) }
async function decrypt(value: string | null, organizationId: string, field: string, key: CryptoKey) {
  if (!value) return ''
  const packed = fromHex(value)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12), additionalData: new TextEncoder().encode(`${organizationId}:${field}`) }, key, packed.slice(12))
  return new TextDecoder().decode(plain)
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in as an administrator.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authorized, error: roleError } = await admin.rpc('is_platform_admin', { p_user_id: user.id })
  if (roleError || authorized !== true) return reply({ error: 'Only an authorized WelFlare administrator can view private applications.' }, 403)
  const keyText = Deno.env.get('DATA_ENCRYPTION_KEY') ?? ''
  if (!/^[a-f\d]{64}$/i.test(keyText)) return reply({ error: 'The encrypted review service is not available.' }, 503)
  const rawKey = Uint8Array.from(keyText.match(/.{2}/g)!, pair => parseInt(pair, 16))
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const { data: organizations, error } = await admin.from('organizations').select('id,name,organization_type,accepts,verification_status,fcra_status,created_at').in('verification_status', ['pending_verification','under_review','verified','suspended','rejected']).order('created_at', { ascending: true }).limit(100)
  if (error) return reply({ error: 'The review queue could not be loaded.' }, 500)
  const results = []
  for (const org of organizations ?? []) {
    const [{ data: secure }, { data: docs }, { data: audit }] = await Promise.all([
      admin.from('ngo_private_applications').select('*').eq('organization_id', org.id).maybeSingle(),
      admin.from('organization_documents').select('id,document_type,storage_path,expires_at,is_required,review_status,created_at').eq('organization_id', org.id),
      admin.from('verification_audit_log').select('admin_id,action,reason,created_at').eq('organization_id', org.id).order('created_at', { ascending: false }).limit(25),
    ])
    const sensitive: Record<string,string> = {}
    if (secure) for (const field of ['darpan_id','pan','registration_number','registered_address','representative_name','representative_contact','account_holder','bank_account','bank_name','ifsc','twelve_ab','eighty_g','fcra_reference']) {
      sensitive[field] = await decrypt(secure[`${field}_ciphertext`], org.id, `${field}_ciphertext`, key)
    }
    const privateDocs = await Promise.all((docs ?? []).map(async doc => {
      const { data } = await admin.storage.from('ngo-private-documents').createSignedUrl(doc.storage_path, 300)
      return { ...doc, signedUrl: data?.signedUrl ?? null }
    }))
    results.push({ ...org, sensitive, documents: privateDocs, audit: audit ?? [] })
  }
  return reply({ applications: results })
})
