import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const requiredTypes = ['registration_certificate', 'pan_document', 'representative_proof', 'bank_proof']
const accepted = new Set(['food','clothes','books','educational_supplies','medical_supplies','household_items','toys','beddings','toiletries','electronics','other_goods','monetary_donations'])

function keyBytes() {
  const value = Deno.env.get('DATA_ENCRYPTION_KEY') ?? ''
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('The secure document service is not ready. Please contact WelFlare support.')
  return Uint8Array.from(value.match(/.{2}/g)!, byte => parseInt(byte, 16))
}
function hex(value: Uint8Array) { return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('') }
async function encrypt(value: string, organizationId: string, field: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${organizationId}:${field}`) }, key, new TextEncoder().encode(value))
  return `\\x${hex(new Uint8Array([...iv, ...new Uint8Array(ciphertext)]))}`
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Sign in to submit an organization application.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return reply({ error: 'Your sign-in has expired. Please sign in again.' }, 401)

  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 40 * 1024 * 1024) return reply({ error: 'The documents are too large to submit together. Choose smaller files.' }, 413)
  let body: Record<string, unknown>
  try { const raw = await request.text(); if (raw.length > 40 * 1024 * 1024) return reply({ error: 'The documents are too large to submit together. Choose smaller files.' }, 413); body = JSON.parse(raw) } catch { return reply({ error: 'The application could not be read.' }, 400) }
  const fields = body.fields as Record<string, unknown> | undefined
  const files = Array.isArray(body.documents) ? body.documents as Array<Record<string, unknown>> : []
  if (!fields) return reply({ error: 'Please complete the organization details.' }, 400)

  const name = String(fields.name ?? '').trim()
  const type = String(fields.organizationType ?? '')
  const repContact = String(fields.representativeContact ?? '').trim()
  const pan = String(fields.pan ?? '').replace(/\s/g, '').toUpperCase()
  const ifsc = String(fields.ifsc ?? '').replace(/\s/g, '').toUpperCase()
  const bankAccount = String(fields.bankAccount ?? '').replace(/\s/g, '')
  const darpan = String(fields.darpanId ?? '').trim()
  const legalNumber = String(fields.registrationNumber ?? '').trim()
  const accepts = Array.isArray(fields.accepts) ? fields.accepts.map(String) : []
  const validTypes = new Set(['trust','society','section_8_company','other_nonprofit'])

  if (name.length < 2 || name.length > 160 || !validTypes.has(type)) return reply({ error: 'Add an organization name and eligible non-profit type.' }, 400)
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return reply({ error: 'Enter a valid 10-character organization PAN.' }, 400)
  if (darpan.length < 2 || darpan.length > 100 || legalNumber.length < 2 || legalNumber.length > 120) return reply({ error: 'Check the DARPAN ID and legal registration number.' }, 400)
  if (!repContact || repContact.length > 160 || String(fields.address ?? '').trim().length < 8) return reply({ error: 'Add the registered address and authorized representative contact details.' }, 400)
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) || !/^[A-Z0-9]{8,34}$/.test(bankAccount) || String(fields.accountHolder ?? '').trim().toLowerCase() !== name.toLowerCase()) return reply({ error: 'Check the organization account holder name, account number and IFSC.' }, 400)
  if (bankAccount !== String(fields.bankAccountConfirm ?? '').replace(/\s/g, '')) return reply({ error: 'The two account number entries do not match.' }, 400)
  if (!accepts.length || accepts.some(kind => !accepted.has(kind))) return reply({ error: 'Choose at least one valid donation type.' }, 400)
  if (requiredTypes.some(kind => !files.some(file => file.documentType === kind))) return reply({ error: 'Upload the registration certificate, PAN, representative proof and bank proof.' }, 400)
  if (fields.fcraRequested === true && (!String(fields.fcraReference ?? '').trim() || !files.some(file => file.documentType === 'fcra_certificate'))) return reply({ error: 'Provide FCRA registration or prior-permission details and upload the matching document to request foreign-contribution review.' }, 400)
  if (files.length > 10) return reply({ error: 'Upload no more than 10 supporting documents.' }, 400)

  let key: CryptoKey
  try { key = await crypto.subtle.importKey('raw', keyBytes(), { name: 'AES-GCM' }, false, ['encrypt']) }
  catch { return reply({ error: 'The secure document service is not ready. Please contact WelFlare support.' }, 503) }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: recentApplications, error: rateError } = await admin.from('organizations').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).gte('created_at', dayAgo)
  if (rateError) return reply({ error: 'We could not check application limits. Please try again shortly.' }, 503)
  if ((recentApplications ?? 0) >= 3) return reply({ error: 'You’ve reached the application limit for today. Please contact WelFlare if you need help.' }, 429)
  const organizationId = crypto.randomUUID()
  const privateValues: Record<string, string> = {
    darpan_id_ciphertext: darpan,
    pan_ciphertext: pan,
    registration_number_ciphertext: legalNumber,
    registered_address_ciphertext: String(fields.address).trim(),
    representative_name_ciphertext: String(fields.representativeName ?? '').trim(),
    representative_contact_ciphertext: repContact,
    account_holder_ciphertext: String(fields.accountHolder).trim(),
    bank_account_ciphertext: bankAccount,
    bank_name_ciphertext: String(fields.bankName).trim(),
    ifsc_ciphertext: ifsc,
    twelve_ab_ciphertext: String(fields.twelveAb ?? ''),
    eighty_g_ciphertext: String(fields.eightyG ?? ''),
    fcra_reference_ciphertext: String(fields.fcraReference ?? ''),
  }
  const encrypted: Record<string, string | null> = {}
  for (const [field, value] of Object.entries(privateValues)) encrypted[field] = value ? await encrypt(value, organizationId, field, key) : null
  const uploaded: string[] = []
  let uploadedBytes = 0

  const { error: organizationError } = await admin.from('organizations').insert({
    id: organizationId, owner_id: user.id, name, organization_type: type,
    accepts, verification_status: 'pending_verification',
    fcra_status: fields.fcraRequested ? 'pending' : 'not_applicable',
  })
  if (organizationError) return reply({ error: 'We could not open an application for this account. Contact support if an organization application already exists.' }, 400)

  const { error: privateError } = await admin.from('ngo_private_applications').insert({
    organization_id: organizationId, owner_id: user.id,
    ...encrypted, fcra_requested: fields.fcraRequested === true,
  })
  if (privateError) {
    await admin.from('organizations').delete().eq('id', organizationId)
    return reply({ error: 'We could not securely save this application. No verification decision was made.' }, 500)
  }

  const documentRows = []
  for (const file of files) {
    const documentType = String(file.documentType ?? '')
    const mimeType = String(file.mimeType ?? '')
    const base64 = String(file.base64 ?? '')
    const allowed = new Set(['application/pdf','image/jpeg','image/png','image/webp'])
    if (!/^[a-z_]{2,48}$/.test(documentType) || !allowed.has(mimeType) || base64.length > 11_200_000) {
      await admin.storage.from('ngo-private-documents').remove(uploaded)
      await admin.from('organizations').delete().eq('id', organizationId)
      return reply({ error: 'A document has an unsupported file type or is larger than 8 MB.' }, 400)
    }
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)) } catch {
      await admin.storage.from('ngo-private-documents').remove(uploaded)
      await admin.from('organizations').delete().eq('id', organizationId)
      return reply({ error: 'A supporting document could not be read. Please try again.' }, 400)
    }
    uploadedBytes += bytes.length
    if (!bytes.length || bytes.length > 8 * 1024 * 1024 || uploadedBytes > 24 * 1024 * 1024) {
      await admin.storage.from('ngo-private-documents').remove(uploaded)
      await admin.from('organizations').delete().eq('id', organizationId)
      return reply({ error: 'Each supporting document must be under 8 MB, with no more than 24 MB total.' }, 400)
    }
    const prefix = String.fromCharCode(...bytes.slice(0, 12))
    const signatureOkay = mimeType === 'application/pdf' ? prefix.startsWith('%PDF-')
      : mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mimeType === 'image/png' ? prefix.startsWith('\x89PNG\r\n\x1a\n')
          : prefix.startsWith('RIFF') && prefix.slice(8,12) === 'WEBP'
    if (!signatureOkay) {
      await admin.storage.from('ngo-private-documents').remove(uploaded)
      await admin.from('organizations').delete().eq('id', organizationId)
      return reply({ error: 'A supporting file does not match its selected file format.' }, 400)
    }
    const extension = mimeType === 'application/pdf' ? 'pdf' : ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[mimeType]
    const path = `${organizationId}/${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await admin.storage.from('ngo-private-documents').upload(path, bytes, { contentType: mimeType, upsert: false })
    if (uploadError) {
      await admin.storage.from('ngo-private-documents').remove(uploaded)
      await admin.from('organizations').delete().eq('id', organizationId)
      return reply({ error: 'A private document could not be saved. The application was not submitted.' }, 500)
    }
    uploaded.push(path)
    documentRows.push({ organization_id: organizationId, document_type: documentType, storage_path: path, is_required: requiredTypes.includes(documentType), expires_at: file.expiresAt || null })
  }

  const { error: docsError } = await admin.from('organization_documents').insert(documentRows)
  if (docsError) {
    await admin.storage.from('ngo-private-documents').remove(uploaded)
    await admin.from('organizations').delete().eq('id', organizationId)
    return reply({ error: 'The documents could not be attached. The application was not submitted.' }, 500)
  }
  await admin.from('verification_audit_log').insert({ organization_id: organizationId, admin_id: null, action: 'submitted', reason: 'Application submitted by organization representative.' })
  return reply({ organizationId, status: 'pending_verification' }, 201)
})
