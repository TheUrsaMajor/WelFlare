import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BadgeCheck, Bell, BookOpen, Building2,
  Camera, Check, ChevronDown, ChevronRight, Clock3, Coffee, FileCheck2,
  FileText, Filter, Heart, Home, Leaf, LogIn, MapPin, Menu, Package,
  Plus, Search, ShieldCheck, Shirt, SlidersHorizontal, Sparkles, Truck,
  Upload, Utensils, Users, X,
} from 'lucide-react'
import './styles.css'
import './admin.css'
import { isSupabaseConfigured, supabase } from './supabase'

const initialDonations = [
  { id: 1, name: 'Fresh lunch boxes', category: 'food', subtype: 'Cooked meals', qty: '24 meals', expiry: '2h 14m', expiresAt: new Date(Date.now()+2.23*3600000).toISOString(), urgency: 'Critical', place: 'Indiranagar · 1.2 km', donor: 'Green Leaf Kitchen', icon: Utensils, color: 'peach', image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=80', time: 'Posted 12 min ago' },
  { id: 2, name: 'Everyday clothing bundle', category: 'items', subtype: 'Clothes', qty: '18 pieces', expiry: '', urgency: '', place: 'Koramangala · 2.4 km', donor: 'Aarav Mehta', icon: Shirt, color: 'lavender', image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=700&q=80', time: 'Posted 28 min ago' },
  { id: 3, name: 'Bakery assortment', category: 'food', subtype: 'Bakery', qty: '3 trays', expiry: '5h 30m', expiresAt: new Date(Date.now()+5.5*3600000).toISOString(), urgency: 'Soon', place: 'Domlur · 2.8 km', donor: 'Daily Bread Co.', icon: Coffee, color: 'sand', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=80', time: 'Posted 35 min ago' },
  { id: 4, name: 'Children’s storybooks', category: 'items', subtype: 'Books', qty: '32 books', expiry: '', urgency: '', place: 'HSR Layout · 3.1 km', donor: 'Maya & family', icon: BookOpen, color: 'mint', image: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=700&q=80', time: 'Posted 1 hr ago' },
  { id: 5, name: 'Seasonal fruit boxes', category: 'food', subtype: 'Produce', qty: '12 boxes', expiry: '10h', expiresAt: new Date(Date.now()+10*3600000).toISOString(), urgency: 'Fresh', place: 'Ulsoor · 3.7 km', donor: 'Harvest House', icon: Leaf, color: 'mint', image: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=700&q=80', time: 'Posted 1 hr ago' },
  { id: 6, name: 'Warm blankets', category: 'items', subtype: 'Beddings', qty: '9 blankets', expiry: '', urgency: '', place: 'Jayanagar · 4.2 km', donor: 'Homefolk PG', icon: Package, color: 'peach', image: 'https://images.unsplash.com/photo-1600369671236-e74521d4b6ad?auto=format&fit=crop&w=700&q=80', time: 'Posted 2 hrs ago' },
]

const filters = ['All nearby', 'Food', 'Clothes', 'Books', 'Household']

function App() {
  const [category, setCategory] = useState('food')
  const [filter, setFilter] = useState('All nearby')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState('discover')
  const [modal, setModal] = useState('account')
  const [donations, setDonations] = useState(initialDonations)
  const [claimed, setClaimed] = useState([])
  const [claimRecords, setClaimRecords] = useState([])
  const [accountType, setAccountType] = useState('Individual')
  const [intent, setIntent] = useState('Donate')
  const [toast, setToast] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [session, setSession] = useState(null)
  const [currentTime, setCurrentTime] = useState(Date.now())

  React.useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const visible = useMemo(() => donations.filter(item => {
    const typeMatch = item.category === category
    const expiryMatch = item.category !== 'food' || !item.expiresAt || new Date(item.expiresAt) > new Date()
    const statusMatch = !item.status || item.status === 'posted'
    const filterMatch = filter === 'All nearby' || item.subtype.toLowerCase().includes(filter.toLowerCase()) || (filter === 'Household' && item.subtype === 'Beddings')
    const queryMatch = `${item.name} ${item.subtype} ${item.donor} ${item.place}`.toLowerCase().includes(query.toLowerCase())
    return typeMatch && expiryMatch && statusMatch && filterMatch && queryMatch
  }), [donations, category, filter, query, currentTime])

  function notify(text) {
    setToast(text)
    window.setTimeout(() => setToast(''), 2800)
  }

  async function beginGoogle(organizationType) {
    if (!supabase) { notify('Add your Supabase keys to turn on secure sign-in'); return }
    window.localStorage.setItem('welflare-onboarding', JSON.stringify({ accountType, organizationType, intent }))
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) notify(error.message)
  }

  async function authenticate(email, password, mode, organizationType) {
    if (!supabase) { notify('Demo preview only · Add Supabase keys to enable account sign-in'); return }
    window.localStorage.setItem('welflare-onboarding', JSON.stringify({ accountType, organizationType, intent }))
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { display_name: '', account_kind: accountType.toLowerCase(), organization_type: accountType === 'Organization' ? organizationType : null, intent: intent.toLowerCase() } } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) throw result.error
    return result.data
  }

  async function claim(item) {
    if (claimed.includes(item.id)) return
    if (isSupabaseConfigured) {
      if (!session) { setModal('account'); notify('Sign in as a verified recipient organization to request a pickup'); return }
      const { data, error } = await supabase.functions.invoke('request-pickup', { body: { donationId: item.id } })
      if (error) { notify(error.message || 'This organization is not yet eligible to request the donation'); return }
      setClaimRecords(current => [{ claimId: data.claimId, status: 'accepted', item }, ...current])
    }
    setClaimed([...claimed, item.id])
    notify(`Pickup request sent for ${item.name}`)
  }

  React.useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); if (nextSession) setModal('') })
    return () => listener.subscription.unsubscribe()
  }, [])

  React.useEffect(() => {
    if (!supabase || !session) return
    const saved = window.localStorage.getItem('welflare-onboarding')
    if (!saved) return
    window.localStorage.removeItem('welflare-onboarding')
    try {
      const selection = JSON.parse(saved)
      supabase.rpc('save_my_onboarding', { p_account_kind: selection.accountType === 'Organization' ? 'organization' : 'individual', p_organization_type: selection.accountType === 'Organization' ? selection.organizationType : null, p_intent: selection.intent.toLowerCase() }).then(({ error }) => {
        if (error) notify('Your account is ready; finish your community profile from the account menu.')
        else if (selection.accountType === 'Organization' && ['Receive','Both'].includes(selection.intent)) setPage('verification')
      })
    } catch { window.localStorage.removeItem('welflare-onboarding') }
  }, [session])

  React.useEffect(() => {
    if (!supabase || !session) return
    let active = true
    supabase.from('donations').select('id,donor_id,category,item_name,quantity,unit,expires_at,pickup_deadline,location_area,created_at,status,donation_photos(storage_path)').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!active || error || !data) return
      setDonations(data.map(row => {
        const path = row.donation_photos?.[0]?.storage_path
        const photo = path ? supabase.storage.from('donation-photos').getPublicUrl(path).data.publicUrl : ''
        const expiry = row.expires_at ? new Date(row.expires_at) : null
        const hours = expiry ? Math.max(0, (expiry - new Date()) / 36e5) : 0
        return { id: row.id, name: row.item_name, category: row.category === 'food' ? 'food' : 'items', subtype: row.category.replaceAll('_',' '), qty: `${row.quantity} ${row.unit}`, expiry: expiry ? `${Math.floor(hours)}h ${Math.round(hours % 1 * 60)}m` : '', expiresAt: row.expires_at, urgency: expiry ? hours < 3 ? 'Critical' : hours <= 8 ? 'Soon' : 'Fresh' : '', place: row.location_area, donor: row.donor_id === session.user.id ? 'You' : 'Community member', icon: row.category === 'food' ? Utensils : Package, color: 'mint', image: photo, time: new Date(row.created_at).toLocaleString(), status: row.status }
      }).filter(row => row.image))
    })
    return () => { active = false }
  }, [session])

  React.useEffect(() => {
    if (!supabase || !session) return
    let active = true
    supabase.from('pickup_claims').select('id,donation_id,claimant_id,status,created_at,donations(id,donor_id,category,item_name,quantity,unit,expires_at,location_area,food_safety_declaration,food_safety_declared_at,donation_photos(storage_path))').order('created_at', { ascending: false }).then(({ data }) => {
      if (!active || !data) return
      const records = data.map(record => {
        const row = record.donations
        if (!row) return null
        const path = row.donation_photos?.[0]?.storage_path
        const image = path ? supabase.storage.from('donation-photos').getPublicUrl(path).data.publicUrl : ''
        const item = { id: row.id, name: row.item_name, category: row.category === 'food' ? 'food' : 'items', subtype: row.category.replaceAll('_',' '), qty: `${row.quantity} ${row.unit}`, expiry: row.expires_at ? new Date(row.expires_at).toLocaleString() : '', donor: row.donor_id === session.user.id ? 'Your donation' : 'Community member', place: row.location_area, image, safetySubmitted: row.food_safety_declaration, safetyTime: row.food_safety_declared_at }
        return { claimId: record.id, claimantId: record.claimant_id, status: record.status, item }
      }).filter(Boolean)
      setClaimRecords(records)
      setClaimed(records.filter(record => record.claimantId === session.user.id).map(record => record.item.id))
    })
    return () => { active = false }
  }, [session])

  async function advancePickup(record, status) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.functions.invoke('advance-pickup', { body: { claimId: record.claimId, status } })
      if (error) { notify(error.message || 'The pickup status could not be updated'); return }
    }
    setClaimRecords(current => current.map(item => item.claimId === record.claimId ? { ...item, status } : item))
    notify(status === 'delivered' ? 'Delivery marked complete' : 'Pickup marked collected')
  }

  async function createDonation(data) {
    if (isSupabaseConfigured && session?.user) {
      const { error } = await supabase.functions.invoke('create-donation', { body: {
        category: data.category, subtype: data.subtype, name: data.name,
        qty: data.qty, expiry: data.expiryDate, place: data.place,
        preparedAt: data.preparedAt, foodType: data.foodType, condition: data.condition,
        pickupDeadline: data.pickupDeadline, notes: data.notes, safety: data.safety, photo: data.photoData,
        photoType: data.photoType, photoName: data.photoName,
      } })
      if (error) throw new Error(error.message || 'Could not publish this donation.')
      setDonations(current => [{ id: Date.now(), name: data.name, category: data.category, subtype: data.subtype, qty: data.qty, expiry: data.expiry, expiresAt: data.expiryDate, urgency: data.urgency, place: data.place, donor: 'You', icon: data.category === 'food' ? Utensils : Package, image: URL.createObjectURL(data.photoFile), time: 'Posted just now' }, ...current])
      setCategory(data.category)
      setFilter('All nearby')
      setModal('')
      notify('Your donation is now listed nearby')
      return
    }
    const item = { ...data, id: Date.now(), donor: 'You', time: 'Posted just now', place: data.place || 'Your location', color: 'mint', icon: data.category === 'food' ? Utensils : Package }
    setDonations([item, ...donations])
    setCategory(item.category)
    setFilter('All nearby')
    setModal('')
    notify('Your donation is now listed nearby')
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a className="brand" href="#home" onClick={e => { e.preventDefault(); setPage('discover') }}><span className="brand-mark"><Heart size={18} strokeWidth={2.6} /></span><span>wel<span>flare</span><small>GOOD THINGS, MOVING FORWARD</small></span></a>
      <button className="workspace-select"><span className="workspace-icon"><Home size={16} /></span><span><b>Community hub</b><small>Bengaluru, India</small></span><ChevronDown size={15} /></button>
      <p className="nav-label">YOUR SPACE</p>
      <nav className="side-nav">
        <SideLink icon={Home} label="Discover" active={page === 'discover'} onClick={() => { setPage('discover'); setMobileNav(false) }} />
        <SideLink icon={Package} label="My donations" count={donations.filter(x => x.donor === 'You').length || ''} active={page === 'donations'} onClick={() => { setPage('donations'); setMobileNav(false) }} />
        <SideLink icon={Truck} label="Pickups" count={claimed.length || ''} active={page === 'pickups'} onClick={() => { setPage('pickups'); setMobileNav(false) }} />
        <SideLink icon={Users} label="Organizations" active={page === 'organizations'} onClick={() => { setPage('organizations'); setMobileNav(false) }} />
      </nav>
      <p className="nav-label community-label">COMMUNITY</p>
      <nav className="side-nav">
        <SideLink icon={Sparkles} label="Impact so far" active={page === 'impact'} onClick={() => { setPage('impact'); setMobileNav(false) }} />
        <SideLink icon={ShieldCheck} label="NGO verification" active={page === 'verification'} onClick={() => { setPage('verification'); setMobileNav(false) }} />
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Heart size={16} /></div><b>A little can go a long way.</b><p>Every thoughtful donation adds up.</p><button onClick={() => setModal('donate')}>Make a donation <ArrowRight size={14} /></button></div>
        <button className="profile-switch" onClick={() => setModal('account')}><span className="avatar">AM</span><span><b>Aarav Mehta</b><small>Individual account</small></span><MoreIcon /></button>
      </div>
    </aside>
    {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><span className="breadcrumb">Community hub</span><ChevronRight size={14} /><b>{navName(page)}</b>{(!isSupabaseConfigured || !session) && <span className="preview-chip">{isSupabaseConfigured ? 'SAMPLE DATA' : 'PREVIEW'}</span>}</div><div className="topbar-actions"><span className="location-chip"><MapPin size={14} /> Bengaluru <ChevronDown size={13} /></span><button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify('You’re all caught up')}><Bell size={17} /><i /></button>{session ? <button className="account-chip" onClick={async () => { await supabase.auth.signOut(); notify('You have been signed out') }}><span className="avatar small-avatar">{session.user.email?.slice(0, 2).toUpperCase() || 'WF'}</span><span>Sign out</span></button> : <button className="account-chip" onClick={() => setModal('account')}><LogIn size={15}/> Sign in</button>}</div></header>

      {page === 'discover' ? <>
        <section className="welcome-row"><div><p className="eyebrow"><span className="live-dot" /> YOUR NEIGHBOURHOOD, A LITTLE CLOSER</p><h1>Good things are<br className="desktop-break" /> happening nearby<span className="heading-period">.</span></h1><p className="welcome-sub">Find something useful. Pass something on. It all starts here.</p></div><button className="button button-primary welcome-cta" onClick={() => setModal('donate')}><Plus size={17} /> Create a donation</button></section>
        <section className="metrics-row"><Metric icon={Package} number="128" label="items shared this week" tone="mint" /><Metric icon={Users} number="34" label="local organizations" tone="lavender" /><Metric icon={Heart} number="612" label="neighbors helped" tone="peach" /><div className="metric-note"><span className="metric-note-icon"><Sparkles size={15} /></span><span><b>Small acts, real impact.</b><small>There’s room for yours, too.</small></span></div></section>
        <section className="discover-section"><div className="section-heading"><div><div className="eyebrow muted-eyebrow">THE COMMUNITY BOARD</div><h2>Find what’s needed</h2></div><button className="text-button" onClick={() => { setPage('organizations'); setFilter('All nearby') }}>Meet local organizations <ArrowRight size={15} /></button></div>
          <div className="category-tabs"><div className="category-switch"><button className={category === 'food' ? 'selected' : ''} onClick={() => { setCategory('food'); setFilter('All nearby') }}><Utensils size={15} /> Food <span>12</span></button><button className={category === 'items' ? 'selected' : ''} onClick={() => { setCategory('items'); setFilter('All nearby') }}><Package size={15} /> Other items <span>18</span></button></div><button className="filter-button" onClick={() => notify('Showing donations closest to you')}><SlidersHorizontal size={15} /> Filters</button></div>
          <div className="filter-row">{filters.map(f => <button key={f} className={`filter-chip ${filter === f ? 'active' : ''}`} onClick={() => { setFilter(f); if (f === 'Clothes' || f === 'Books' || f === 'Household') setCategory('items'); else if (f === 'Food') setCategory('food') }}>{f}</button>)}<div className="search-field"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search nearby donations" /></div></div>
          <div className="results-line"><span><b>{visible.length} donations</b> close to you</span><button onClick={() => notify('Sorted by closest first')}>Closest first <ChevronDown size={14} /></button></div>
          <div className="donation-grid">{visible.map(item => <DonationCard key={item.id} item={item} claimed={claimed.includes(item.id)} onClaim={() => claim(item)} />)}</div>
          {visible.length === 0 && <div className="empty-state"><Package size={25} /><h3>Nothing in this category just yet</h3><p>Try another filter, or be the first to share something.</p><button className="button button-primary" onClick={() => setModal('donate')}><Plus size={16} /> Start a donation</button></div>}
          <button className="load-more" onClick={() => notify('You’re seeing all recent donations in your area')}>You’re all caught up <span><Check size={14} /></span></button>
        </section>
        <section className="lower-cards"><div className="community-banner"><span className="banner-stamp"><Heart size={17} /></span><div><h3>Something useful deserves another life.</h3><p>List it in a few minutes and we’ll help connect it to a verified local organization.</p></div><button className="button button-light" onClick={() => setModal('donate')}>Share something <ArrowRight size={15} /></button></div><div className="safe-card"><ShieldCheck size={18} /><span><b>Giving with confidence</b><small>Recipients are reviewed before they can receive donations.</small></span><ChevronRight size={16} /></div></section>
      </> : <SecondaryPage page={page} donations={donations} claimed={claimed} claimRecords={claimRecords} session={session} onDonate={() => setModal('donate')} onRegister={() => setPage('verification')} onClaim={claim} onAdvance={advancePickup} />}
      <footer className="footer"><span>© 2026 WelFlare</span><span><ShieldCheck size={12} /> A coordination platform built around care</span><button onClick={() => notify('Help is on its way')}>Need a hand?</button></footer>
    </main>
    {modal === 'donate' && <DonationModal onClose={() => setModal('')} onCreate={createDonation} />}
    {modal === 'account' && <AccountModal onClose={() => setModal('')} connected={isSupabaseConfigured} accountType={accountType} setAccountType={setAccountType} intent={intent} setIntent={setIntent} onGoogle={beginGoogle} onAuth={authenticate} onContinue={() => { if (!isSupabaseConfigured) { setModal(''); notify('You’re exploring the WelFlare preview') } else if (session) { setModal(''); if (accountType === 'Organization' && intent !== 'Donate') setPage('verification') } else notify('Sign in or create an account to continue') }} />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>
}

function MoreIcon() { return <span className="more-dots">•••</span> }
function navName(page) { return ({ discover: 'Discover', donations: 'My donations', pickups: 'Pickups', organizations: 'Organizations', impact: 'Impact so far', verification: 'NGO verification' })[page] }
function SideLink({ icon: Icon, label, count, active, onClick }) { return <button className={`side-link ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{count && <i>{count}</i>}</button> }
function Metric({ icon: Icon, number, label, tone }) { return <div className="metric"><span className={`metric-icon ${tone}`}><Icon size={16} /></span><span className="metric-text"><b>{number}</b><small>{label}</small></span></div> }
function DonationCard({ item, claimed, onClaim }) {
  const Icon = item.icon || Package
  const remaining = item.expiresAt ? Math.max(0, new Date(item.expiresAt).getTime() - Date.now()) : null
  const totalSeconds = remaining === null ? 0 : Math.floor(remaining / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const urgency = remaining === null ? item.urgency : remaining < 3 * 3600000 ? 'Critical' : remaining < 8 * 3600000 ? 'Soon' : 'Fresh'
  const countdown = remaining === null ? item.expiry : `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
  return <article className="donation-card"><div className="card-photo-wrap"><img className="card-photo" src={item.image} alt={`${item.name} donation`} loading="lazy"/><span className={`type-badge ${item.category}`}><Icon size={12}/>{item.subtype}</span>{item.urgency && <span className={`urgency-badge ${(urgency || '').toLowerCase()}`}><Clock3 size={11}/>{countdown}{item.expiresAt ? '' : ' left'}</span>}<button className="save-button" aria-label="Save donation"><Heart size={15}/></button></div><div className="donation-card-body"><div className="donation-card-title"><div><h3>{item.name}</h3><p className="donor-name">{item.donor}</p></div><button className="card-more" aria-label="More options">···</button></div><div className="detail-row"><span><Package size={13}/>{item.qty}</span><span><MapPin size={13}/>{item.place}</span></div><div className="card-footer"><span className="posted-time">{item.time}</span><button className={`claim-button ${claimed ? 'claimed' : ''}`} onClick={onClaim}>{claimed ? <><Check size={13}/> Requested</> : <>Request pickup <ArrowRight size={13}/></>}</button></div></div></article>
}

function DonationModal({ onClose, onCreate }) {
  const [type, setType] = useState('food')
  const [photo, setPhoto] = useState(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [error, setError] = useState('')
  const inputRef = React.useRef(null)
  function choosePhoto(file) { if (!file) return; if (!file.type.startsWith('image/')) return setError('Please choose a photo in JPG, PNG or HEIC format.'); if (file.size > 10 * 1024 * 1024) return setError('Please choose a photo under 10 MB.'); setError(''); setPhoto(file); setPhotoUrl(URL.createObjectURL(file)) }
  async function submit(e) { e.preventDefault(); const form = new FormData(e.currentTarget); if (!photo) return setError('Please add a photo so the receiving organization can see what you’re sharing.'); if (type === 'food' && !form.get('safety')) return setError('Please confirm the food handling details before continuing.'); const expires = form.get('expiry'); const prepared = new Date(form.get('preparedAt')); if (type === 'food' && (!form.get('preparedAt') || prepared > new Date() || prepared >= new Date(expires))) return setError('Enter a preparation time before the best-before time.'); if (type === 'food' && expires && new Date(expires) <= new Date()) return setError('The best-before time must be in the future.'); const pickup = new Date(form.get('deadline')); if (!form.get('deadline') || pickup <= new Date()) return setError('Pickup availability must be a time in the future.'); const expiryDate = type === 'food' ? new Date(expires) : null; const hours = expiryDate ? Math.max(0, (expiryDate - new Date()) / 36e5) : 0; const fileBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(photo) }); try { await onCreate({ category: type, subtype: form.get('subtype'), name: form.get('name'), qty: `${form.get('qty')} ${form.get('unit')}`, expiry: expiryDate ? `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m` : '', expiryDate: expiryDate?.toISOString(), preparedAt: type === 'food' ? prepared.toISOString() : null, foodType: form.get('foodtype'), condition: form.get('condition'), pickupDeadline: pickup.toISOString(), urgency: expiryDate ? hours < 3 ? 'Critical' : hours <= 8 ? 'Soon' : 'Fresh' : '', place: form.get('location') || 'Bengaluru · nearby', notes: form.get('notes'), safety: Boolean(form.get('safety')), photoData: fileBase64, photoType: photo.type, photoName: photo.name, photoFile: photo, image: photoUrl, time: 'Posted just now' }) } catch (err) { setError(err.message || 'We couldn’t create this donation. Please try again.') } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal donation-modal"><div className="modal-head"><div><span className="eyebrow muted-eyebrow">MAKE A DIFFERENCE, CLOSE TO HOME</span><h2>Share a donation</h2><p>Tell the community what you have to pass along.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit}><div className="category-switch modal-switch"><button type="button" className={type === 'food' ? 'selected' : ''} onClick={() => { setType('food'); setError('') }}><Utensils size={15}/> Food</button><button type="button" className={type === 'items' ? 'selected' : ''} onClick={() => { setType('items'); setError('') }}><Package size={15}/> Other items</button></div><label className="photo-upload"><input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} required={!photo} /><span className="upload-icon">{photoUrl ? <img src={photoUrl} alt="Your uploaded donation"/> : <Camera size={20}/>}</span><span><b>{photo ? photo.name : 'Add a photo of your donation'} <em>Required</em></b><small>One clear photo helps organizations know what to expect · up to 10 MB</small></span><button type="button" className="upload-browse" onClick={() => inputRef.current?.click()}><Upload size={14}/> {photo ? 'Change' : 'Upload'}</button></label>
          <div className="form-grid"><label className="field wide"><span>What are you sharing? <i>*</i></span><input name="name" placeholder={type === 'food' ? 'e.g. Freshly packed lunch boxes' : 'e.g. Warm children’s clothing'} required/></label><label className="field"><span>Category <i>*</i></span><select name="subtype" required defaultValue=""><option value="" disabled>Choose a category</option>{(type === 'food' ? ['Cooked meals','Packaged food','Bakery','Produce','Groceries','Other food'] : ['Clothes','Books','Toys','Educational supplies','Beddings','Toiletries','Household items','Medical supplies','Electronics','Other goods']).map(x => <option key={x}>{x}</option>)}</select></label><div className="field"><span>Quantity <i>*</i></span><div className="quantity-input"><input name="qty" type="number" min="1" placeholder="e.g. 12" required/><select name="unit" aria-label="Quantity unit"><option>items</option><option>meals</option><option>boxes</option><option>bags</option><option>kg</option><option>sets</option><option>pieces</option><option>trays</option></select></div></div>{type === 'food' ? <><label className="field"><span>Prepared on <i>*</i></span><input name="preparedAt" type="datetime-local" required/></label><label className="field"><span>Best before <i>*</i></span><input name="expiry" type="datetime-local" required/></label><label className="field"><span>Food type</span><select name="foodtype"><option>Vegetarian</option><option>Non-vegetarian</option><option>Vegan</option><option>Not applicable</option></select></label><label className="field wide"><span>Storage & handling notes</span><input name="notes" placeholder="e.g. Keep refrigerated; sealed containers"/></label><label className="safety-check"><input type="checkbox" name="safety"/><span>I confirm that, to the best of my knowledge, this food has been handled and stored hygienically and offered within its shelf life. I’ve provided accurate preparation and expiry details.</span></label></> : <><label className="field"><span>Item condition <i>*</i></span><select name="condition" required><option>Good — ready to use</option><option>Like new</option><option>Gently used</option><option>Unopened</option></select></label><label className="field"><span>Size, if relevant</span><input placeholder="e.g. ages 5–7 or adult M"/></label><label className="field wide"><span>Anything else to know?</span><input name="notes" placeholder="Add useful details for the receiving organization"/></label></>}<label className="field wide"><span>Pickup location <i>*</i></span><input name="location" placeholder="Area or neighborhood; exact address after pickup is arranged" required/></label><label className="field wide"><span>Pickup available until <i>*</i></span><input name="deadline" type="datetime-local" required/></label></div><div className="privacy-note"><ShieldCheck size={15}/><span>Your exact address is shared only after a pickup is arranged.</span></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit"><Plus size={16}/> List this donation <ArrowRight size={15}/></button></div></form></section></div>
}

function AccountModal({ onClose, connected, accountType, setAccountType, intent, setIntent, onContinue, onGoogle, onAuth }) {
  const [mode, setMode] = useState('signin')
  const [organizationType, setOrganizationType] = useState('restaurant')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { const data = await onAuth(email, password, mode, organizationType); if (data?.user && !data.session) setError('Check your inbox for the confirmation link, then sign in here.') } catch (err) { setError(err.message || 'We couldn’t complete that request.') } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal account-modal"><div className="modal-head"><div><span className="eyebrow muted-eyebrow">WELCOME TO WELFLARE</span><h2>Good things start here.</h2><p>Sign in or create an account to join your community.</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="auth-mode"><button className={mode === 'signin' ? 'selected' : ''} onClick={() => {setMode('signin');setError('')}}>Sign in</button><button className={mode === 'signup' ? 'selected' : ''} onClick={() => {setMode('signup');setError('')}}>Create account</button></div><button className="google-button" onClick={() => onGoogle(organizationType)}><GoogleMark/> Continue with Google</button><div className="divider"><span>OR WITH EMAIL</span></div><form onSubmit={submit}><label className="field"><span>Email address</span><input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" required/></label><label className="field auth-password"><span>Password</span><input value={password} onChange={e => setPassword(e.target.value)} type="password" minLength="8" placeholder="At least 8 characters" required/></label>{error && <p className="auth-error">{error}</p>}<button className="email-link" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></button></form><div className="divider"><span>YOUR COMMUNITY PROFILE</span></div><span className="selector-label">I’m here as a</span><div className="choice-row">{['Individual','Organization'].map(x => <button className={accountType === x ? 'choice selected' : 'choice'} onClick={() => setAccountType(x)} key={x}>{x === 'Individual' ? <Users size={17}/> : <Building2 size={17}/>} {x}</button>)}</div>{accountType === 'Organization' && <label className="field organization-select"><span>Organization type</span><select value={organizationType} onChange={e => setOrganizationType(e.target.value)}><option value="restaurant">Restaurant</option><option value="catering_service">Catering service</option><option value="hotel">Hotel</option><option value="hostel">Hostel</option><option value="pg">PG</option><option value="school">School</option><option value="college">College</option><option value="corporate">Corporate</option><option value="retail_store">Retail store</option><option value="ngo">NGO / Non-profit</option><option value="trust">Trust</option><option value="society">Society</option><option value="section_8_company">Section 8 Company</option><option value="other">Other</option></select></label>}<span className="selector-label">I would like to</span><div className="choice-row">{['Donate','Receive','Both','Volunteer'].map(x => <button className={intent === x ? 'choice selected' : 'choice'} onClick={() => setIntent(x)} key={x}>{x === 'Donate' ? <Heart size={16}/> : x === 'Receive' ? <ArrowDownLeft size={16}/> : x === 'Volunteer' ? <Users size={16}/> : <Sparkles size={16}/>} {x}</button>)}</div>{intent === 'Receive' || intent === 'Both' ? <div className="verification-callout"><ShieldCheck size={16}/><span>Receiving organizations must pass WelFlare’s verification review before they can receive donations.</span></div> : null}{connected ? <p className="legal-copy">Choose sign in or create an account above to use WelFlare.</p> : <><button className="button button-primary continue-button" onClick={onContinue}>Explore the preview <ArrowRight size={16}/></button><p className="legal-copy">Preview uses sample content. Connect your Supabase project to enable real accounts and secure organization reviews.</p></>}</section></div>
}
function GoogleMark() { return <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.1v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15z"/><path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.6-4.8L31 34.1c-1.8 1.2-4.1 2-7 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.5v-5.3H5.8a20 20 0 0 0 0 18z"/><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.9-5.8A19.6 19.6 0 0 0 24 4 20 20 0 0 0 5.8 14.9l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4z"/></svg> }

function SecondaryPage({ page, donations, claimed, claimRecords = [], session, onDonate, onRegister, onClaim, onAdvance }) {
  const [step, setStep] = useState(0)
  const [sent, setSent] = useState(false)
  const [previewSubmission, setPreviewSubmission] = useState(false)
  const [applicationError, setApplicationError] = useState('')
  const [applicationBusy, setApplicationBusy] = useState(false)
  const [applicationDocuments, setApplicationDocuments] = useState({})
  const [queue, setQueue] = useState([])
  const [queueError, setQueueError] = useState('')
  const [queueLoading, setQueueLoading] = useState(false)
  const [reviewReasons, setReviewReasons] = useState({})
  const [reviewChecks, setReviewChecks] = useState({})
  const [adminBusy, setAdminBusy] = useState('')
  const [orgProfiles, setOrgProfiles] = useState(null)
  const [volunteerInvites, setVolunteerInvites] = useState([])
  const stepPanel = React.useRef(null)
  const [tab, setTab] = useState('application')
  React.useEffect(() => {
    if (page !== 'verification' || tab !== 'admin' || !supabase) return
    let current = true
    setQueueLoading(true); setQueueError('')
    supabase.functions.invoke('get-review-queue').then(({ data, error }) => {
      if (!current) return
      if (error) setQueueError(error.message || 'This view is restricted to authorized WelFlare administrators.')
      else setQueue(data?.applications ?? [])
    }).finally(() => { if (current) setQueueLoading(false) })
    return () => { current = false }
  }, [page, tab])
  React.useEffect(() => {
    if (page !== 'organizations' || !supabase) return
    let current = true
    supabase.from('organizations').select('id,name,organization_type,accepts,verification_status,darpan_verified,registration_verified,pan_verified,bank_verified,twelve_ab_verified,eighty_g_verified,fcra_verified').eq('verification_status','verified').then(({ data }) => { if (current && data) setOrgProfiles(data.map(o => ({ id:o.id, name:o.name, type:o.organization_type.replaceAll('_',' '), accepts:o.accepts, verified:true, checks:o }))) })
    return () => { current = false }
  }, [page])
  React.useEffect(() => {
    if (page !== 'pickups' || !supabase || !session) return
    let current = true
    supabase.from('organization_memberships').select('id,organization_id,created_at,organizations(name)').eq('user_id',session.user.id).eq('status','invited').then(({ data }) => { if (current && data) setVolunteerInvites(data) })
    return () => { current = false }
  }, [page,session])
  async function adminReview(organizationId, action, extra = {}) {
    const reason = reviewReasons[organizationId]?.trim() || ''
    if (reason.length < 8) { setQueueError('Add a clear reason or review note of at least 8 characters before recording a decision.'); return }
    if (!supabase) { setQueueError('Administrator decisions are available only through the connected, protected review service.'); return }
    setAdminBusy(organizationId); setQueueError('')
    const { error } = await supabase.functions.invoke('review-organization', { body: { organizationId, action, reason, ...extra } })
    setAdminBusy('')
    if (error) { setQueueError(error.message || 'The review action could not be recorded.'); return }
    if (tab === 'admin') {
      const { data } = await supabase.functions.invoke('get-review-queue')
      if (data?.applications) setQueue(data.applications)
    }
  }
  async function submitApplication(e) {
    e.preventDefault()
    const activePanel = document.querySelector(`[data-application-step="${step}"]`); const invalidField = activePanel?.querySelector(':invalid'); if (invalidField) { invalidField.reportValidity(); return }
    if (step < 4) { setStep(step + 1); return }
    const form = e.currentTarget
    const data = new FormData(form)
    const missing = ['registration_certificate','pan_document','representative_proof','bank_proof'].filter(type => !applicationDocuments[type])
    if (missing.length) { setApplicationError('Please upload all four required documents before submitting.'); return }
    if (data.get('bankAccount') !== data.get('bankAccountConfirm')) { setApplicationError('The two bank account numbers do not match.'); return }
    if (data.get('fcraRequested') === 'on' && (!data.get('fcraReference') || !applicationDocuments.fcra_certificate)) { setApplicationError('Add FCRA registration or prior-permission details and upload the matching document to request foreign-contribution review.'); return }
    if (!supabase) { setPreviewSubmission(true); setSent(true); return }
    setApplicationBusy(true); setApplicationError('')
    try {
      const documents = await Promise.all(Object.entries(applicationDocuments).map(async ([documentType, file]) => ({
        documentType, mimeType: file.type, base64: await fileAsBase64(file),
      })))
      const { error } = await supabase.functions.invoke('submit-ngo-application', { body: { fields: {
        name: data.get('name'), organizationType: data.get('organizationType'),
        accepts: data.getAll('accepts'), address: data.get('address'),
        representativeName: data.get('representativeName'), representativeContact: data.get('representativeContact'),
        darpanId: data.get('darpanId'), pan: data.get('pan'), registrationNumber: data.get('registrationNumber'),
        twelveAb: data.get('twelveAb'), eightyG: data.get('eightyG'), fcraReference: data.get('fcraReference'), fcraRequested: data.get('fcraRequested') === 'on',
        accountHolder: data.get('accountHolder'), bankName: data.get('bankName'), bankAccount: data.get('bankAccount'), bankAccountConfirm: data.get('bankAccountConfirm'), ifsc: data.get('ifsc'),
      }, documents } })
      if (error) throw error
      setSent(true)
    } catch (err) { setApplicationError(err.message || 'We couldn’t submit this application. Please try again.') }
    finally { setApplicationBusy(false) }
  }
  function nextApplicationStep(e) {
    e.preventDefault()
    const activePanel = document.querySelector(`[data-application-step="${step}"]`); const invalidField = activePanel?.querySelector(':invalid'); if (invalidField) { invalidField.reportValidity(); return }
    setStep(step + 1)
    setApplicationError('')
  }
  function saveApplicationDocument(type, file) { setApplicationDocuments(current => ({ ...current, [type]: file })) }
  if (page === 'verification') return <section className="subpage">
    <div className="page-hero"><div><p className="eyebrow muted-eyebrow">VERIFIED RECIPIENTS</p><h1>Organization verification</h1><p>Organizations complete a review before they can receive community donations.</p></div><span className="page-hero-icon"><ShieldCheck size={25}/></span></div>
    <div className="verify-tabs"><button className={tab === 'application' ? 'active' : ''} onClick={() => setTab('application')}>Your application</button><button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Admin review</button></div>
    {tab === 'application' ? sent ? <div className="submitted-card"><span className="submitted-icon"><Check size={22}/></span><div><span className={`status-pill ${previewSubmission ? 'not-started' : 'pending'}`}>{previewSubmission ? 'Preview only' : 'Pending Verification'}</span><h2>{previewSubmission ? 'Your application preview is complete.' : 'Your application is in the review queue.'}</h2><p>{previewSubmission ? 'No information was sent. Connect Supabase and deploy the secure application function to submit a real verification request.' : 'Your organization verification application has been submitted. Our verification team will review your information before your organization can receive donations.'}</p>{!previewSubmission && <div className="submitted-timeline"><span className="done"><Check size={14}/> Application received</span><span><Clock3 size={14}/> Manual document review</span><span><Clock3 size={14}/> Organization decision</span></div>}<p className="fine-print">DARPAN details and documents are submitted for manual review. WelFlare does not call or simulate a government verification service, and verification does not guarantee an organization’s conduct.</p></div></div> : <div className="form-panel"><div className="form-panel-head"><div><h2>Apply to receive donations</h2><p>Complete the steps below. Applications are reviewed before an organization can receive goods.</p></div><span className="status-pill not-started">Not started</span></div><div className="steps">{["Organization details","Government registration","Documents","Bank details","Review & submit","Verification"].map((label,index)=><span className={index<step ? "complete" : index===step ? "current" : ""} key={label}>{label}</span>)}</div><form noValidate onSubmit={submitApplication}>
      <div data-application-step="0" hidden={step !== 0}><div className="form-grid"><label className="field wide"><span>Organization name <i>*</i></span><input name="name" required placeholder="Registered organization name"/></label><label className="field"><span>Organization type <i>*</i></span><select name="organizationType" required defaultValue=""><option value="">Choose type</option><option value="trust">Trust</option><option value="society">Society</option><option value="section_8_company">Section 8 Company</option><option value="other_nonprofit">Other eligible non-profit</option></select></label><label className="field"><span>Donation types accepted <i>*</i></span><select name="accepts" required multiple size="3">{[['food','Food'],['clothes','Clothes'],['books','Books'],['educational_supplies','Educational supplies'],['medical_supplies','Medical supplies'],['household_items','Household items'],['toys','Toys'],['beddings','Beddings'],['toiletries','Toiletries'],['electronics','Electronics'],['other_goods','Other goods'],['monetary_donations','Monetary donations']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field wide"><span>Registered address <i>*</i></span><textarea name="address" required placeholder="Full registered address" rows="3"/></label><label className="field"><span>Authorized representative <i>*</i></span><input name="representativeName" required placeholder="Full name"/></label><label className="field"><span>Representative email or phone <i>*</i></span><input name="representativeContact" required placeholder="name@example.org or +91"/></label></div><div className="info-callout"><ShieldCheck size={16}/><p><b>Receiving organizations must be verified.</b> Choosing an organization type does not itself grant access to donations.</p></div></div>
      <div data-application-step="1" hidden={step !== 1}><div className="form-grid"><label className="field"><span>NGO DARPAN Unique ID <i>*</i></span><input name="darpanId" required placeholder="Enter the ID shown in your DARPAN record"/></label><label className="field"><span>Organization PAN <i>*</i></span><input name="pan" required placeholder="ABCDE1234F" maxLength="10"/></label><label className="field wide"><span>Legal registration number <i>*</i></span><input name="registrationNumber" required placeholder="Trust / Society / Section 8 registration number"/></label><label className="field"><span>12A / 12AB registration (if applicable)</span><input name="twelveAb" placeholder="Registration number"/></label><label className="field"><span>80G approval (if applicable)</span><input name="eightyG" placeholder="Approval reference"/></label><label className="field wide"><span>FCRA registration / prior permission (foreign contributions only)</span><input name="fcraReference" placeholder="Leave blank for domestic contributions"/></label><label className="foreign-check"><input type="checkbox" name="fcraRequested"/><span>Request separate FCRA review for foreign contributions</span></label><div className="info-callout wide-note"><ShieldCheck size={16}/><p>Domestic donation eligibility is reviewed separately. FCRA is only required before enabling foreign-contribution functionality. DARPAN is a source to check submitted details; it is not a government endorsement.</p></div></div></div>
      <div data-application-step="2" hidden={step !== 2}><div className="form-grid"><UploadField docType="registration_certificate" onFile={saveApplicationDocument} title="Registration certificate" description="Trust deed, Society registration or Section 8 certificate" required/><UploadField docType="pan_document" onFile={saveApplicationDocument} title="PAN document" description="Organization PAN card or official document" required/><UploadField docType="twelve_ab_certificate" onFile={saveApplicationDocument} title="12A / 12AB certificate" description="Upload if applicable"/><UploadField docType="eighty_g_certificate" onFile={saveApplicationDocument} title="80G approval" description="Upload if applicable"/><UploadField docType="fcra_certificate" onFile={saveApplicationDocument} title="FCRA certificate / permission" description="Required for foreign-contribution review"/><UploadField docType="representative_proof" onFile={saveApplicationDocument} title="Authorized representative proof" description="For the named representative" required/></div><div className="privacy-note"><ShieldCheck size={15}/><span>Documents are privately stored. Only your organization’s authorized reviewers can access them.</span></div></div>
      <div data-application-step="3" hidden={step !== 3}><div className="form-grid"><label className="field"><span>Account holder name <i>*</i></span><input name="accountHolder" required placeholder="Must belong to the organization"/></label><label className="field"><span>Bank name <i>*</i></span><input name="bankName" required placeholder="Bank name"/></label><label className="field"><span>Account number <i>*</i></span><input name="bankAccount" required type="password" placeholder="Stored securely"/></label><label className="field"><span>Re-enter account number <i>*</i></span><input name="bankAccountConfirm" required type="password" placeholder="Confirm account number"/></label><label className="field"><span>IFSC code <i>*</i></span><input name="ifsc" required placeholder="e.g. HDFC0001234"/></label><UploadField docType="bank_proof" onFile={saveApplicationDocument} title="Cancelled cheque or bank proof" description="The account name should match the organization" required/></div><div className="info-callout"><ShieldCheck size={16}/><p>Bank ownership is reviewed separately before any monetary donation transfer. Full details stay private.</p></div></div>
      <div data-application-step="4" hidden={step !== 4}><h3>Before you submit</h3><div className="review-checklist">{['Organization identity and address are accurate','DARPAN ID and registration details are accurate','Uploaded documents are valid and readable','Bank account belongs to the organization','Donation types reflect what your organization can receive'].map(x => <label key={x}><input type="checkbox" required/><span>{x}</span></label>)}</div><p className="fine-print">Submitting creates a Pending Verification application for manual document and record review. FCRA remains a separate decision for foreign contributions. WelFlare verification does not guarantee an organization’s conduct or use of donations.</p></div>
      {applicationError && <div className="form-error">{applicationError}</div>}<div className="wizard-actions">{step > 0 && <button type="button" className="button button-quiet" onClick={() => { setStep(step - 1); setApplicationError('') }}><ArrowLeft size={15}/> Back</button>}{step < 4 ? <button className="button button-primary" type="button" onClick={nextApplicationStep}>Continue <ArrowRight size={15}/></button> : <button className="button button-primary" type="submit" disabled={applicationBusy}>{applicationBusy ? 'Submitting securely…' : 'Submit for review'} <ArrowRight size={15}/></button>}<span>Step {step + 1} of 5</span></div>
      </form></div> : <AdminReviewQueue applications={queue} loading={queueLoading} error={queueError} reasons={reviewReasons} setReasons={setReviewReasons} checks={reviewChecks} setChecks={setReviewChecks} busy={adminBusy} onReview={adminReview} />}
  </section>

  if (page === 'organizations') return <OrganizationDirectory profiles={orgProfiles} session={session} />

  if (page === 'donations') { const mine = donations.filter(x => x.donor === 'You'); return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">THANKS FOR PASSING IT ON</p><h1>My donations</h1><p>Keep an eye on the useful things you’ve shared.</p></div><button className="button button-primary" onClick={onDonate}><Plus size={16}/> New donation</button></div>{mine.length ? <div className="donation-grid">{mine.map(item => <DonationCard key={item.id} item={item} claimed={false} onClaim={() => {}}/>)}</div> : <div className="empty-state"><Package size={25}/><h3>Your story starts with one small thing.</h3><p>Your donations and their pickup progress will show up here.</p><button className="button button-primary" onClick={onDonate}><Plus size={16}/> Share a donation</button></div>}</section> }

  if (page === 'pickups') { const records = claimRecords.length ? claimRecords : donations.filter(x => claimed.includes(x.id)).map(item => ({ claimId: item.id, status: 'accepted', item })); return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">ON THE WAY TO A NEW HOME</p><h1>Your pickups</h1><p>Follow the donations you’ve requested and what comes next.</p></div><span className="page-hero-icon"><Truck size={25}/></span></div>{volunteerInvites.length > 0 && <div className="invitation-list"><h2>Volunteer invitations</h2>{volunteerInvites.map(invite => <div className="invitation-row" key={invite.id}><span className="metric-icon mint"><Users size={16}/></span><span><b>{invite.organizations?.name || 'Verified organization'}</b><small>Pickup volunteer invitation · {new Date(invite.created_at).toLocaleDateString()}</small></span><button className="button button-primary" onClick={async () => { const { error } = await supabase.functions.invoke('accept-volunteer-invitation',{ body: { invitationId: invite.id } }); if (error) notify('The invitation could not be accepted. It may have expired.'); else { setVolunteerInvites(current => current.filter(item => item.id !== invite.id)); notify('You’re now an invited pickup volunteer for this organization') } }}>Accept invitation</button></div>)}</div>}{records.length ? <div className="pickup-list">{records.map(record => <div className="pickup-row" key={record.claimId}><img src={record.item.image} alt=""/><div><h3>{record.item.name}</h3><p>{record.item.donor} · {record.item.qty} · {record.item.place}</p></div><span className={`status-pill ${record.status === 'delivered' ? 'verified' : 'pending'}`}>{record.status.replaceAll('_',' ')}</span>{record.status === 'accepted' && <button className="button button-secondary" onClick={() => onAdvance(record,'picked_up')}>Mark collected <ArrowRight size={13}/></button>}{record.status === 'picked_up' && <button className="button button-primary" onClick={() => onAdvance(record,'delivered')}>Mark delivered <Check size={13}/></button>}{record.item.category === 'food' && <div className="food-handover"><ShieldCheck size={15}/><span>Donor-submitted food information{record.item.safetyTime ? ` · ${new Date(record.item.safetyTime).toLocaleString()}` : ''}. The recipient is responsible for suitable handling after handover. Do not distribute after the listed best-before time. WelFlare coordinates the pickup and does not independently certify food safety.</span></div>}</div>)}</div> : volunteerInvites.length === 0 && <div className="empty-state"><Truck size={25}/><h3>Nothing to pick up yet.</h3><p>When you request a nearby donation, it’ll appear here.</p><button className="button button-primary">Explore nearby <ArrowRight size={15}/></button></div>}</section> }
  return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">GOOD THINGS, ADDED UP</p><h1>Your impact, in real numbers</h1><p>Every shared item finds a new purpose through your community.</p></div><span className="page-hero-icon"><Heart size={25}/></span></div><div className="impact-stats"><div><span className="metric-icon mint"><Package size={17}/></span><b>128</b><small>donations shared this week</small></div><div><span className="metric-icon lavender"><Users size={17}/></span><b>612</b><small>neighbors supported</small></div><div><span className="metric-icon peach"><Leaf size={17}/></span><b>84%</b><small>matched within a day</small></div></div><div className="impact-quote"><Sparkles size={18}/><div><h3>Useful things deserve another chance.</h3><p>WelFlare helps neighbors and community organizations find one another. Your participation makes the network stronger.</p></div></div></section>
}

function UploadField({ title, description, required, docType, onFile }) { const [name, setName] = useState(''); return <label className="document-upload"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; setName(file?.name || ''); if (docType && file) onFile(docType, file) }} required={required} name={docType || undefined}/><FileText size={18}/><span><b>{title} {required && <i>*</i>}</b><small>{name || description}</small></span><Upload size={15}/></label> }

function OrganizationDirectory({ profiles, session }) {
  const [managedOrganization, setManagedOrganization] = useState(null)
  const [volunteerEmail, setVolunteerEmail] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  React.useEffect(() => {
    if (!supabase || !session) return
    supabase.from('organizations').select('id,name').eq('owner_id',session.user.id).eq('verification_status','verified').maybeSingle().then(({ data }) => setManagedOrganization(data))
  }, [session])
  async function inviteVolunteer(e) {
    e.preventDefault(); setInviteBusy(true); setInviteMessage('')
    const { data, error } = await supabase.functions.invoke('invite-volunteer', { body: { organizationId: managedOrganization.id, email: volunteerEmail } })
    setInviteBusy(false)
    if (error) setInviteMessage(error.message || 'The invitation could not be sent.')
    else { setInviteMessage(`Invitation saved for ${data.email}. Ask them to sign in and accept it in Pickups.`); setVolunteerEmail('') }
  }
  const examples = [
    { id: 'demo-hf', initials: 'HF', name: 'Helping Hands Foundation', type: 'NGO · example', accepts: ['Clothes','Books','Household items'], dist: '1.4 km away', tone: 'lavender', sample: true },
    { id: 'demo-nk', initials: 'NK', name: 'Northside Community Kitchen', type: 'NGO · example', accepts: ['Cooked meals','Produce','Groceries'], dist: '2.1 km away', tone: 'mint', sample: true },
    { id: 'demo-sc', initials: 'SC', name: 'Sunrise Children’s Centre', type: 'NGO · example', accepts: ['Books','Educational supplies','Toys'], dist: '3.6 km away', tone: 'peach', sample: true },
  ]
  const organizations = profiles === null ? examples : profiles.map(o => ({ ...o, initials: o.name.slice(0,2).toUpperCase(), accepts: o.accepts.map(type => type.replaceAll('_',' ')), tone: 'mint', sample: false }))
  return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">YOUR LOCAL NETWORK</p><h1>Organizations nearby</h1><p>Meet reviewed community organizations and see what they can receive.</p></div><span className="page-hero-icon"><Users size={25}/></span></div>{managedOrganization && <div className="invite-panel"><div><h3>Bring a pickup volunteer on board</h3><p>Only your verified organization’s accepted donation types can be picked up by invited volunteers.</p></div><form onSubmit={inviteVolunteer}><input type="email" value={volunteerEmail} onChange={e => setVolunteerEmail(e.target.value)} placeholder="Volunteer’s WelFlare email" required/><button className="button button-primary" disabled={inviteBusy}>{inviteBusy ? 'Saving…' : 'Invite volunteer'} <ArrowRight size={14}/></button></form>{inviteMessage && <p className="invite-message">{inviteMessage}</p>}</div>}{organizations.length ? <div className="org-grid">{organizations.map(o => <article className="org-card" key={o.id}><div className={`org-avatar ${o.tone}`}>{o.initials}</div><span className={`status-pill ${o.sample ? 'not-started' : 'verified'}`}>{o.sample ? 'Example profile' : <><BadgeCheck size={12}/> Verified</>}</span><h3>{o.name}</h3><p className="org-type">{o.type}</p><div className="org-accepts"><span>ACCEPTS</span><b>{o.accepts.join(' · ')}</b></div>{o.checks && <div className="verification-checks">{[['darpan_verified','NGO DARPAN Verified'],['registration_verified','Organization Registration Verified'],['pan_verified','PAN Verified'],['bank_verified','Bank Account Verified'],['twelve_ab_verified','12A / 12AB Verified'],['eighty_g_verified','80G Verified'],['fcra_verified','FCRA Verified']].filter(([key]) => o.checks[key]).map(([,label]) => <span key={label}><Check size={11}/>{label}</span>)}</div>}{o.dist && <p className="org-distance"><MapPin size={13}/>{o.dist}</p>}{o.sample && <p className="example-note">Sample listing for the preview. No real organization verification is implied.</p>}<button className="button button-secondary">View profile <ArrowRight size={14}/></button></article>)}</div> : <div className="empty-state"><Users size={25}/><h3>No verified organizations nearby yet.</h3><p>Organizations appear here after a reviewer completes their application.</p></div>}<p className="fine-print public-verification-note"><ShieldCheck size={14}/> Verification checks submitted identity and records. WelFlare and the Government of India do not guarantee an organization’s conduct or the use of donations.</p></section>
}

function AdminReviewQueue({ applications, loading, error, reasons, setReasons, checks, setChecks, busy, onReview }) {
  if (!isSupabaseConfigured) return <div className="admin-placeholder"><div className="admin-placeholder-icon"><ShieldCheck size={22}/></div><h2>Secure review queue</h2><p>Connect Supabase, configure a server encryption key and explicitly grant reviewer access in the private administrator list. The preview never simulates NGO decisions.</p><span className="status-pill not-started">No applications submitted</span></div>
  return <div className="admin-queue"><div className="queue-heading"><div><h2>Organization applications</h2><p>Private applicant information is shown only to authorized reviewers.</p></div><span className="status-pill pending">{applications.length} records</span></div>{error && <div className="form-error">{error}</div>}{loading && <div className="queue-loading"><span className="loading-dot"/> Loading the secure review queue…</div>}{!loading && applications.length === 0 && !error && <div className="empty-state"><FileCheck2 size={24}/><h3>No applications are waiting for review.</h3><p>New NGO applications will appear here after secure submission.</p></div>}{applications.map(org => { const orgChecks = checks[org.id] || {}; const setOrgChecks = next => setChecks(current => ({ ...current, [org.id]: { ...current[org.id], ...next } })); return <article className="admin-review-card" key={org.id}><div className="review-card-title"><div className="review-avatar">{org.name.slice(0,2).toUpperCase()}</div><span><b>{org.name}</b><small>{org.organization_type.replaceAll('_',' ')} · submitted {new Date(org.created_at).toLocaleDateString()}</small></span><span className={`status-pill ${org.verification_status === 'verified' ? 'verified' : org.verification_status === 'rejected' || org.verification_status === 'suspended' ? 'not-started' : 'pending'}`}>{org.verification_status.replaceAll('_',' ')}</span></div><div className="secure-review-grid"><div><small>NGO DARPAN ID</small><b>{org.sensitive?.darpan_id || 'Not supplied'}</b></div><div><small>Organization PAN</small><b>{org.sensitive?.pan || 'Not supplied'}</b></div><div><small>Legal registration number</small><b>{org.sensitive?.registration_number || 'Not supplied'}</b></div><div><small>Registered address</small><b>{org.sensitive?.registered_address || 'Not supplied'}</b></div><div><small>Authorized representative</small><b>{org.sensitive?.representative_name || 'Not supplied'}</b></div><div><small>Representative contact</small><b>{org.sensitive?.representative_contact || 'Not supplied'}</b></div><div><small>Bank account holder & bank</small><b>{org.sensitive?.account_holder || 'Not supplied'} · {org.sensitive?.bank_name || 'Not supplied'}</b></div><div><small>Account number & IFSC</small><b>{org.sensitive?.bank_account || 'Not supplied'} · {org.sensitive?.ifsc || 'Not supplied'}</b></div><div><small>12A / 12AB</small><b>{org.sensitive?.twelve_ab || 'Not applicable'}</b></div><div><small>80G</small><b>{org.sensitive?.eighty_g || 'Not applicable'}</b></div><div><small>FCRA reference</small><b>{org.sensitive?.fcra_reference || 'Domestic contributions only'}</b></div><div><small>Accepted donation types</small><b>{org.accepts.join(', ').replaceAll('_',' ')}</b></div></div><h4>Submitted documents</h4><div className="review-documents">{org.documents?.map(doc => <div className="review-document" key={doc.id}><FileText size={15}/><span><b>{doc.document_type.replaceAll('_',' ')}</b><small>{doc.is_required ? 'Required' : 'Optional'} · {doc.expires_at ? `Expires ${new Date(doc.expires_at).toLocaleDateString()}` : 'No expiry recorded'} · {doc.review_status}</small></span>{doc.signedUrl && <a href={doc.signedUrl} target="_blank" rel="noreferrer">View</a>}{doc.review_status === 'pending' && <><button onClick={() => onReview(org.id,'review_document',{ documentId: doc.id, documentStatus: 'verified' })}>Verify</button><button className="reject-link" onClick={() => onReview(org.id,'review_document',{ documentId: doc.id, documentStatus: 'rejected' })}>Reject</button></>}</div>)}</div>{['pending_verification','under_review'].includes(org.verification_status) && <><h4>Manual record checks</h4><div className="review-checklist admin-checklist">{[['darpan','DARPAN organization identity matches'],['registration','Registration details match'],['pan','Organization PAN matches'],['bank','Bank ownership matches organization'],['twelve_ab','12A / 12AB verified (if supplied)'],['eighty_g','80G verified (if supplied)']].map(([key,label]) => <label key={key}><input type="checkbox" checked={Boolean(orgChecks[key])} onChange={e => setOrgChecks({ [key]: e.target.checked })}/><span>{label}</span></label>)}</div></>}<label className="field admin-reason"><span>Reviewer note / decision reason <i>*</i></span><textarea rows="2" value={reasons[org.id] || ''} onChange={e => setReasons(current => ({ ...current, [org.id]: e.target.value }))} placeholder="Record what you checked or why you made this decision"/></label><div className="admin-actions">{org.verification_status === 'pending_verification' && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'under_review')}>Start review</button>}{['pending_verification','under_review'].includes(org.verification_status) && <><button className="button button-primary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'approve',{ checks: orgChecks })}>Approve organization</button><button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'reject')}>Reject with reason</button></>}{org.verification_status === 'verified' && <button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'suspend')}>Suspend organization</button>}{org.fcra_status === 'pending' && <><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'approve_fcra')}>Approve FCRA</button><button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'reject_fcra')}>Reject FCRA</button></>}</div>{org.audit?.length > 0 && <><h4>Verification history</h4><div className="audit-list">{org.audit.map((entry,index) => <div key={`${entry.created_at}-${index}`}><span>{entry.action.replaceAll('_',' ')}</span><time>{new Date(entry.created_at).toLocaleString()}</time><small>Admin {entry.admin_id?.slice(0,8) || 'System'} · {entry.reason}</small></div>)}</div></>}</article> })}</div>
}

async function fileAsBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) }) }

createRoot(document.getElementById('root')).render(<App />)

