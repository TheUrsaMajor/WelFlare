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
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in as an authorized reviewer.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired.' }, 401)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authorized, error: roleError } = await admin.rpc('is_platform_admin', { p_user_id: user.id })
  if (roleError || authorized !== true) return reply({ error: 'Only an authorized WelFlare administrator can review applications.' }, 403)
  const minuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
  const { count: recentActions, error: rateError } = await admin.from('verification_audit_log').select('id', { count: 'exact', head: true }).eq('admin_id', user.id).gte('created_at', minuteAgo)
  if (rateError) return reply({ error: 'The review service could not check request limits.' }, 503)
  if ((recentActions ?? 0) >= 60) return reply({ error: 'The review request limit has been reached. Please wait a minute.' }, 429)

  let input: Record<string, unknown>
  try { input = await request.json() } catch { return reply({ error: 'The review details could not be read.' }, 400) }
  const organizationId = String(input.organizationId ?? '')
  const action = String(input.action ?? '')
  const reason = String(input.reason ?? '').trim()
  const allowed = new Set(['under_review','approve','reject','suspend','reinstate','review_document','approve_fcra','reject_fcra'])
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !allowed.has(action) || reason.length < 8 || reason.length > 1200) return reply({ error: 'Choose a review action and add a clear reason or note.' }, 400)

  const { data: organization, error: orgError } = await admin.from('organizations').select('id, verification_status, fcra_status, accepts').eq('id', organizationId).maybeSingle()
  if (orgError || !organization) return reply({ error: 'That organization application could not be found.' }, 404)
  let nextStatus: string | null = null
  let nextFcra: string | null = null
  const eventAction: Record<string, string> = {
    under_review: 'under_review', approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'reinstated', review_document: 'document_verified', approve_fcra: 'fcra_approved', reject_fcra: 'fcra_rejected',
  }
  if (action === 'review_document') {
    const documentId = String(input.documentId ?? '')
    const documentStatus = String(input.documentStatus ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(documentId) || !['verified','rejected'].includes(documentStatus) || (documentStatus === 'rejected' && reason.length < 16)) return reply({ error: 'Choose a document decision and provide a clear reason for rejection.' }, 400)
    const { data: doc, error: documentError } = await admin.from('organization_documents').select('id,document_type,expires_at').eq('id', documentId).eq('organization_id', organizationId).maybeSingle()
    if (documentError || !doc) return reply({ error: 'That private document is not attached to this application.' }, 404)
    if (doc.expires_at && new Date(doc.expires_at) <= new Date() && documentStatus === 'verified') return reply({ error: 'An expired document cannot be marked verified.' }, 409)
    const { error: saveError } = await admin.rpc('admin_review_organization_document', { p_organization_id: organizationId, p_document_id: documentId, p_admin_id: user.id, p_document_status: documentStatus, p_reason: reason })
    if (saveError) return reply({ error: 'The document decision and audit entry could not be saved.' }, 500)
    return reply({ organizationId, documentId, documentStatus })
  }
  if (action === 'approve') {
    if (!['pending_verification','under_review'].includes(organization.verification_status)) return reply({ error: 'Only a pending application can be approved.' }, 409)
    const checks = input.checks as Record<string, unknown> | undefined
    if (!checks || checks.darpan !== true || checks.registration !== true || checks.pan !== true || checks.bank !== true) return reply({ error: 'Confirm the DARPAN record, organization registration, PAN and organization-owned bank account before approval.' }, 400)
    const { data: documents, error: docsError } = await admin.from('organization_documents').select('document_type, review_status, expires_at').eq('organization_id', organizationId).eq('is_required', true)
    if (docsError) return reply({ error: 'Required documents could not be checked.' }, 500)
    const required = ['registration_certificate','pan_document','representative_proof','bank_proof']
    if (required.some(type => !documents?.some(doc => doc.document_type === type && doc.review_status === 'verified' && (!doc.expires_at || new Date(doc.expires_at) > new Date())))) return reply({ error: 'Every required document must be verified and current before approval.' }, 409)
    for (const [type, field] of [['twelve_ab_certificate','twelve_ab'],['eighty_g_certificate','eighty_g']]) {
      if (checks[field] === true && !documents?.some(doc => doc.document_type === type && doc.review_status === 'verified' && (!doc.expires_at || new Date(doc.expires_at) > new Date()))) return reply({ error: `Verify a current ${field === 'twelve_ab' ? '12A / 12AB' : '80G'} document before displaying this badge.` }, 409)
    }
    const { data: application } = await admin.from('ngo_private_applications').select('organization_id').eq('organization_id', organizationId).maybeSingle()
    if (!application) return reply({ error: 'The encrypted registration application is incomplete.' }, 409)
    nextStatus = 'verified'
  }
  if (action === 'reject') {
    if (organization.verification_status === 'verified') return reply({ error: 'Suspend a verified organization instead of rejecting its original application.' }, 409)
    nextStatus = 'rejected'
  }
  if (action === 'suspend') {
    if (organization.verification_status !== 'verified') return reply({ error: 'Only a verified organization can be suspended.' }, 409)
    nextStatus = 'suspended'
  }
  if (action === 'reinstate') {
    if (organization.verification_status !== 'suspended') return reply({ error: 'Only a suspended organization can be reinstated.' }, 409)
    nextStatus = 'under_review'
  }
  if (action === 'under_review') {
    if (organization.verification_status !== 'pending_verification') return reply({ error: 'Only a pending application can move into review.' }, 409)
    nextStatus = 'under_review'
  }
  if (action === 'approve_fcra' || action === 'reject_fcra') {
    const { data: privateApplication } = await admin.from('ngo_private_applications').select('fcra_requested, fcra_reference_ciphertext').eq('organization_id', organizationId).maybeSingle()
    if (!privateApplication?.fcra_requested || !privateApplication.fcra_reference_ciphertext) return reply({ error: 'This organization did not submit FCRA registration or prior-permission information.' }, 409)
    if (organization.verification_status !== 'verified') return reply({ error: 'First verify the organization for domestic donations.' }, 409)
    if (action === 'approve_fcra') {
      const { data: fcraDocs } = await admin.from('organization_documents').select('document_type, review_status, expires_at').eq('organization_id', organizationId).eq('document_type', 'fcra_certificate')
      if (!fcraDocs?.some(doc => doc.review_status === 'verified' && (!doc.expires_at || new Date(doc.expires_at) > new Date()))) return reply({ error: 'Verify a current FCRA registration or permission document before enabling foreign contributions.' }, 409)
      nextFcra = 'verified'
    } else nextFcra = 'rejected'
  }

  const checks = input.checks as Record<string, unknown> | undefined
  const { error: decisionError } = await admin.rpc('admin_update_organization_review', {
    p_organization_id: organizationId, p_admin_id: user.id, p_action: eventAction[action], p_reason: reason,
    p_verification_status: nextStatus, p_fcra_status: nextFcra,
    p_checks: action === 'approve' ? { darpan: true, registration: true, pan: true, bank: true, twelve_ab: checks?.twelve_ab === true, eighty_g: checks?.eighty_g === true } : action === 'approve_fcra' ? { fcra: true } : {},
  })
  if (decisionError) return reply({ error: 'The decision and its audit entry could not be saved.' }, 500)
  return reply({ organizationId, status: nextStatus ?? organization.verification_status, fcraStatus: nextFcra ?? organization.fcra_status, action }, 200)
})
