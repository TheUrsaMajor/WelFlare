import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to post a donation.' }, 401)

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your sign-in has expired. Please sign in again.' }, 401)

  const rateCheck = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentPosts, error: rateError } = await rateCheck.from('donations').select('id', { count: 'exact', head: true }).eq('donor_id', user.id).gte('created_at', since)
  if (rateError) return json({ error: 'We could not check posting limits. Please try again shortly.' }, 503)
  if ((recentPosts ?? 0) >= 20) return json({ error: 'You’ve reached the hourly posting limit. Please try again later.' }, 429)

  let input: Record<string, unknown>
  try { input = await request.json() } catch { return json({ error: 'The donation details could not be read.' }, 400) }

  const categoryMap: Record<string, string> = {
    'Cooked meals': 'food', 'Packaged food': 'food', Bakery: 'food', Produce: 'food', Groceries: 'food', 'Other food': 'food',
    Clothes: 'clothes', Books: 'books', Toys: 'toys', 'Educational supplies': 'educational_supplies',
    Beddings: 'beddings', Toiletries: 'toiletries', 'Household items': 'household_items',
    'Medical supplies': 'medical_supplies', Electronics: 'electronics', 'Other goods': 'other_goods',
  }
  const category = typeof input.category === 'string' && input.category === 'food' ? 'food' : categoryMap[String(input.subtype)]
  const idempotencyKey = String(input.idempotencyKey ?? '')
  const itemName = String(input.name ?? '').trim()
  const quantity = String(input.qty ?? '').trim().match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
  const place = String(input.place ?? '').trim()
  const coordinate = (value: unknown) => value == null || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean' ? Number.NaN : Number(value)
  const latitude = coordinate(input.latitude)
  const longitude = coordinate(input.longitude)
  const pickupDeadline = new Date(String(input.pickupDeadline ?? ''))
  const expiry = input.expiry ? new Date(String(input.expiry)) : null
  const preparedAt = input.preparedAt ? new Date(String(input.preparedAt)) : null
  const imageBase64 = String(input.photo ?? '')
  const imageType = String(input.photoType ?? '')
  const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

  if (!category || itemName.length < 2 || itemName.length > 120) return json({ error: 'Please add a valid name and category.' }, 400)
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json({ error: 'This listing attempt could not be verified. Close the form and try again.' }, 400)
  if (!quantity || Number(quantity[1]) <= 0 || Number(quantity[1]) > 1000000) return json({ error: 'Please enter a valid donation quantity.' }, 400)
  if (!place || place.length > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(pickupDeadline.valueOf()) || pickupDeadline <= new Date()) return json({ error: 'Please choose a pickup area on the map and set a future pickup deadline.' }, 400)
  if (category === 'food' && (!expiry || !Number.isFinite(expiry.valueOf()) || expiry <= new Date() || !preparedAt || !Number.isFinite(preparedAt.valueOf()) || preparedAt > new Date() || preparedAt >= expiry || !input.safety)) return json({ error: 'Food needs an accurate preparation time, future best-before time and a food handling acknowledgement.' }, 400)
  if (!allowedImages.has(imageType) || !imageBase64 || imageBase64.length > 14_000_000) return json({ error: 'Add one JPG, PNG, WebP or HEIC photo under 10 MB.' }, 400)

  let imageBytes: Uint8Array
  try { imageBytes = Uint8Array.from(atob(imageBase64), char => char.charCodeAt(0)) } catch { return json({ error: 'The uploaded image could not be read.' }, 400) }
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > 10 * 1024 * 1024) return json({ error: 'Choose a photo under 10 MB.' }, 400)
  const prefix = String.fromCharCode(...imageBytes.slice(0, 12))
  const validImage = imageType === 'image/jpeg' ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
    : imageType === 'image/png' ? prefix.startsWith('\x89PNG\r\n\x1a\n')
      : imageType === 'image/webp' ? prefix.startsWith('RIFF') && prefix.slice(8,12) === 'WEBP'
        : imageType === 'image/heic' ? prefix.slice(4, 8) === 'ftyp' && /hei[cfm]|mif1/.test(prefix.slice(8,12))
          : false
  if (!validImage) return json({ error: 'The uploaded file does not match a supported image format.' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const proposedDonationId = crypto.randomUUID()
  const { data: reservation, error: reservationError } = await admin.rpc('reserve_donation_creation', { p_donor_id: user.id, p_key: idempotencyKey, p_new_donation_id: proposedDonationId })
  if (reservationError || !reservation?.[0]) return json({ error: 'We could not reserve this listing attempt. Please try again.' }, 503)
  const donationId = reservation[0].reserved_donation_id
  if (reservation[0].reservation_state === 'complete') return json({ donationId, status: 'posted', duplicate: true }, 200)
  if (donationId !== proposedDonationId) return json({ error: 'This listing is already being created. Please wait a moment before trying again.' }, 409)
  const failRequest = async () => { await admin.from('donation_creation_requests').update({ state: 'failed', updated_at: new Date().toISOString() }).eq('donor_id', user.id).eq('idempotency_key', idempotencyKey) }
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' } as Record<string, string>)[imageType]
  const storagePath = `${donationId}/${crypto.randomUUID()}.${extension}`

  const { error: insertError } = await admin.from('donations').insert({
    id: donationId, donor_id: user.id, category, item_name: itemName,
    description: String(input.notes ?? '').slice(0, 1000), storage_notes: category === 'food' ? String(input.notes ?? '').slice(0, 1000) : null, quantity: Number(quantity[1]), unit: quantity[2].slice(0, 32),
    pickup_deadline: pickupDeadline.toISOString(), expires_at: expiry?.toISOString() ?? null,
    prepared_at: preparedAt?.toISOString() ?? null, food_type: category === 'food' ? String(input.foodType ?? 'unspecified').slice(0, 40) : null,
    condition: category !== 'food' ? String(input.condition ?? '').slice(0, 60) : null,
    location_area: place, location_latitude: Number(latitude.toFixed(3)), location_longitude: Number(longitude.toFixed(3)), status: 'draft',
    food_safety_declaration: category === 'food' && input.safety === true,
    food_safety_declaration_version: category === 'food' ? 'food-safety-v1' : null,
    food_safety_declared_at: category === 'food' ? new Date().toISOString() : null,
    food_safety_declared_by: category === 'food' ? user.id : null,
  })
  if (insertError) { await failRequest(); return json({ error: 'The donation could not be saved. Please check the details and try again.' }, 400) }

  const { error: uploadError } = await admin.storage.from('donation-photos').upload(storagePath, imageBytes, { contentType: imageType, upsert: false })
  if (uploadError) {
    await admin.from('donations').delete().eq('id', donationId)
    await failRequest()
    return json({ error: 'The photo could not be saved securely, so the listing was not published.' }, 500)
  }

  const { error: photoError } = await admin.from('donation_photos').insert({ donation_id: donationId, storage_path: storagePath })
  if (photoError) {
    await admin.storage.from('donation-photos').remove([storagePath])
    await admin.from('donations').delete().eq('id', donationId)
    await failRequest()
    return json({ error: 'The photo could not be attached, so the listing was not published.' }, 500)
  }

  const { error: publishError } = await admin.from('donations').update({ status: 'posted' }).eq('id', donationId)
  if (publishError) {
    await admin.storage.from('donation-photos').remove([storagePath])
    await admin.from('donations').delete().eq('id', donationId)
    await failRequest()
    return json({ error: 'The listing could not be published. Please try again.' }, 500)
  }

  const { data: { publicUrl } } = admin.storage.from('donation-photos').getPublicUrl(storagePath)
  const { error: completeError } = await admin.from('donation_creation_requests').update({ state: 'complete', updated_at: new Date().toISOString() }).eq('donor_id', user.id).eq('idempotency_key', idempotencyKey)
  if (completeError) return json({ donationId, photoUrl: publicUrl, status: 'posted', duplicate: false, notice: 'Your donation is posted. Refresh your donations to see it.' }, 201)
  return json({ donationId, photoUrl: publicUrl, status: 'posted' }, 201)
})
