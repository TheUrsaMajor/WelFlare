import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BadgeCheck, Bell, BookOpen, Building2,
  Camera, Check, ChevronDown, ChevronRight, Clock3, Coffee, FileCheck2,
  FileText, Filter, Heart, Home, Leaf, LogIn, MapPin, Menu, Package,
  Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Truck,
  Upload, Utensils, Users, X,
} from 'lucide-react'
import './styles.css'
import './admin.css'
import { isSupabaseConfigured, supabase } from './supabase'
import { distanceKm } from './distance.js'
import { isDonationAvailable } from './donationRules.js'
const MapView = React.lazy(() => import('./MapView'))

const filters = ['All', 'Food', 'Clothes', 'Books', 'Household']

function App() {
  const [category, setCategory] = useState('food')
  const [filter, setFilter] = useState('All')
  const [sortBy, setSortBy] = useState('newest')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState('discover')
  const [modal, setModal] = useState('account')
  const [donations, setDonations] = useState([])
  const [donationsLoading, setDonationsLoading] = useState(true)
  const [donationError, setDonationError] = useState('')
  const [claimed, setClaimed] = useState([])
  const [claimRecords, setClaimRecords] = useState([])
  const [accountType, setAccountType] = useState('Individual')
  const [intent, setIntent] = useState('Donate')
  const [toast, setToast] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [verifiedOrgCount, setVerifiedOrgCount] = useState(0)
  const [userLocation, setUserLocation] = useState(null)
  const [mapMode, setMapMode] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notificationError, setNotificationError] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now())

  React.useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const visible = useMemo(() => donations.filter(item => {
    const typeMatch = item.category === category
    const expiryMatch = isDonationAvailable(item, currentTime)
    const filterMatch = filter === 'All' || item.subtype.toLowerCase().includes(filter.toLowerCase()) || (filter === 'Household' && (item.subtype === 'Beddings' || item.subtype === 'Household items'))
    const queryMatch = `${item.name} ${item.subtype} ${item.donor} ${item.place}`.toLowerCase().includes(query.toLowerCase())
    return typeMatch && expiryMatch && filterMatch && queryMatch
  }).sort((a, b) => sortBy === 'nearest' && userLocation ? distanceKm(userLocation, a) - distanceKm(userLocation, b) : new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [donations, category, filter, query, currentTime, sortBy, userLocation])

  function notify(text) {
    setToast(text)
    window.setTimeout(() => setToast(''), 2800)
  }

  async function beginGoogle(organizationType, fullName = '', phone = '', homeArea = '') {
    if (!supabase) { notify('Add your Supabase keys to turn on secure sign-in'); return }
    window.localStorage.setItem('welflare-onboarding', JSON.stringify({ accountType, organizationType, intent, fullName, phone, homeArea }))
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) notify(error.message)
  }

  async function authenticate(email, password, mode, organizationType, fullName, phone, homeArea) {
    if (!supabase) throw new Error('Account services are not configured yet. Please try again later.')
    window.localStorage.setItem('welflare-onboarding', JSON.stringify({ accountType, organizationType, intent, fullName, phone, homeArea }))
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { data: { display_name: fullName.trim(), account_kind: accountType.toLowerCase(), organization_type: accountType === 'Organization' ? organizationType : null, intent: intent.toLowerCase() } } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) throw result.error
    return result.data
  }

  async function loadDonations() {
    if (!supabase) { setDonations([]); setDonationsLoading(false); return }
    setDonationsLoading(true); setDonationError('')
    const { data, error } = await supabase.from('donations')
      .select('id,donor_id,category,item_name,quantity,unit,expires_at,pickup_deadline,location_area,location_latitude,location_longitude,created_at,status,donation_photos(storage_path)')
      .eq('status', 'posted').order('created_at', { ascending: false }).limit(100)
    if (error) { setDonations([]); setDonationError('We could not load current donations. Please refresh in a moment.') }
    else setDonations((data ?? []).map(row => {
      const path = row.donation_photos?.[0]?.storage_path
      const photo = path ? supabase.storage.from('donation-photos').getPublicUrl(path).data.publicUrl : ''
      const expiry = row.expires_at ? new Date(row.expires_at) : null
      const hours = expiry ? Math.max(0, (expiry - new Date()) / 36e5) : 0
      return { id: row.id, name: row.item_name, category: row.category === 'food' ? 'food' : 'items', subtype: row.category.replaceAll('_',' '), qty: `${row.quantity} ${row.unit}`, expiry: expiry ? `${Math.floor(hours)}h ${Math.round(hours % 1 * 60)}m` : '', expiresAt: row.expires_at, pickupDeadline: row.pickup_deadline, urgency: expiry ? hours < 3 ? 'Critical' : hours <= 8 ? 'Soon' : 'Fresh' : '', place: row.location_area, latitude: row.location_latitude, longitude: row.location_longitude, donor: session?.user?.id === row.donor_id ? 'Your donation' : 'Community donor', icon: row.category === 'food' ? Utensils : Package, color: 'mint', image: photo, time: new Date(row.created_at).toLocaleString(), createdAt: row.created_at, status: row.status }
    }).filter(row => row.image))
    setDonationsLoading(false)
  }

  async function claim(item) {
    if (!session) { setModal('account'); notify('Sign in to request a pickup. Recipient organizations must be verified.'); return }
    if (claimed.includes(item.id)) return
    const { data, error } = await supabase.functions.invoke('request-pickup', { body: { donationId: item.id } })
    if (error) { notify(error.message || 'This organization is not yet eligible to request the donation'); return }
    setClaimRecords(current => [{ claimId: data.claimId, status: 'accepted', item }, ...current])
    setClaimed(current => [...current, item.id])
    await loadDonations()
    notify(`Pickup request sent for ${item.name}`)
  }

  React.useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (data.session) setModal('') })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
      setClaimRecords([])
      setClaimed([])
      setNotifications([])
      setNotificationOpen(false)
      if (nextSession) setModal('')
      else { setPage('discover'); setAccountType('Individual') }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  React.useEffect(() => { loadDonations() }, [session])

  React.useEffect(() => {
    if (!supabase) return
    supabase.from('organizations').select('id', { count: 'exact', head: true }).eq('verification_status', 'verified')
      .then(({ count }) => setVerifiedOrgCount(count ?? 0))
  }, [])

  React.useEffect(() => {
    if (!supabase || !session) { setProfile(null); return }
    let active = true
    supabase.from('profiles').select('display_name,account_kind,organization_type,phone,home_area').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (active && data) { setProfile(data); setAccountType(data.account_kind === 'organization' ? 'Organization' : 'Individual') } })
    return () => { active = false }
  }, [session])

  React.useEffect(() => {
    if (!supabase || !session) return
    const saved = window.localStorage.getItem('welflare-onboarding')
    if (!saved) return
    window.localStorage.removeItem('welflare-onboarding')
    try {
      const selection = JSON.parse(saved)
      supabase.rpc('save_my_onboarding', { p_account_kind: selection.accountType === 'Organization' ? 'organization' : 'individual', p_organization_type: selection.accountType === 'Organization' ? selection.organizationType : null, p_intent: selection.intent.toLowerCase() }).then(async ({ error }) => {
        if (!error && selection.fullName) await supabase.rpc('save_my_profile', { p_display_name: selection.fullName, p_phone: selection.phone || '', p_home_area: selection.homeArea || '' })
        if (error) notify('Your account is ready; review your profile details before continuing.')
        else if (selection.accountType === 'Organization' && ['Receive','Both'].includes(selection.intent)) setPage('verification')
      })
    } catch { window.localStorage.removeItem('welflare-onboarding') }
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
    if (!session?.user) { setModal('account'); throw new Error('Sign in to publish a donation.') }
    if (session?.user) {
      const { error } = await supabase.functions.invoke('create-donation', { body: {
        category: data.category, subtype: data.subtype, name: data.name,
        qty: data.qty, expiry: data.expiryDate, place: data.place,
        latitude: data.latitude, longitude: data.longitude,
        preparedAt: data.preparedAt, foodType: data.foodType, condition: data.condition,
        pickupDeadline: data.pickupDeadline, notes: data.notes, safety: data.safety, photo: data.photoData,
        photoType: data.photoType, photoName: data.photoName,
      } })
      if (error) throw new Error(error.message || 'Could not publish this donation.')
      await loadDonations()
      setCategory(data.category)
      setFilter('All')
      setModal('')
      notify('Your donation is now listed nearby')
      return
    }
  }

  async function saveProfile(details) {
    const { error } = await supabase.rpc('save_my_profile', { p_display_name: details.display_name, p_phone: details.phone, p_home_area: details.home_area })
    if (error) throw error
    setProfile(current => ({ ...current, ...details }))
    notify('Your profile has been updated')
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) { notify('We could not sign you out. Please try again.'); return }
    setPage('discover')
    notify('You have been signed out')
  }

  function setApproximateLocation(point, label = 'Map area selected') {
    if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) return
    setUserLocation({ latitude: Number(Number(point.latitude).toFixed(3)), longitude: Number(Number(point.longitude).toFixed(3)), label })
  }

  function useMyLocation(onReady) {
    if (!navigator.geolocation) { notify('This browser does not provide location access. Choose a point on the map instead.'); return }
    navigator.geolocation.getCurrentPosition(position => {
      const point = { latitude: Number(position.coords.latitude.toFixed(3)), longitude: Number(position.coords.longitude.toFixed(3)) }
      setApproximateLocation(point, 'Your approximate area')
      onReady?.(point)
      notify('Your approximate location is ready')
    }, () => notify('Location access was not available. You can choose your area directly on the map.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  }

  async function refreshNotifications() {
    if (!session) { setNotificationError('Sign in to view account notifications.'); setNotifications([]); return }
    const { data, error } = await supabase.from('notifications').select('id,kind,title,message,destination,created_at,read_at').order('created_at', { ascending: false }).limit(30)
    if (error) { setNotificationError('Notifications are not available right now.'); return }
    setNotificationError(''); setNotifications(data ?? [])
  }

  async function openNotifications() {
    setNotificationOpen(value => !value)
    if (!notificationOpen) await refreshNotifications()
  }

  async function openNotification(item) {
    if (!item.read_at) {
      const readAt = new Date().toISOString()
      const { error } = await supabase.from('notifications').update({ read_at: readAt }).eq('id', item.id)
      if (!error) setNotifications(current => current.map(row => row.id === item.id ? { ...row, read_at: readAt } : row))
    }
    setNotificationOpen(false)
    setPage(item.destination || 'discover')
  }

  const accountLabel = profile?.display_name || session?.user?.user_metadata?.display_name || 'Your profile'
  const unseenNotifications = notifications.filter(item => !item.read_at).length

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a className="brand" href="#home" onClick={e => { e.preventDefault(); setPage('discover') }}><span className="brand-mark"><Heart size={18} strokeWidth={2.6} /></span><span>wel<span>flare</span><small>GOOD THINGS, MOVING FORWARD</small></span></a>
      <button className="workspace-select" onClick={useMyLocation} title="Choose a pickup area using your browser location"><span className="workspace-icon"><MapPin size={16} /></span><span><b>Your area</b><small>{userLocation?.label || profile?.home_area || 'Choose on the map'}</small></span><ChevronDown size={15} /></button>
      <p className="nav-label">YOUR SPACE</p>
      <nav className="side-nav">
        <SideLink icon={Home} label="Discover" active={page === 'discover'} onClick={() => { setPage('discover'); setMobileNav(false) }} />
        <SideLink icon={Package} label="My donations" count={donations.filter(x => x.donor === 'Your donation').length || ''} active={page === 'donations'} onClick={() => { setPage('donations'); setMobileNav(false) }} />
        <SideLink icon={Truck} label="Pickups" count={claimed.length || ''} active={page === 'pickups'} onClick={() => { setPage('pickups'); setMobileNav(false) }} />
        <SideLink icon={Users} label="Organizations" active={page === 'organizations'} onClick={() => { setPage('organizations'); setMobileNav(false) }} />
      </nav>
      <p className="nav-label community-label">COMMUNITY</p>
      <nav className="side-nav">
        <SideLink icon={Sparkles} label="Impact so far" active={page === 'impact'} onClick={() => { setPage('impact'); setMobileNav(false) }} />
        <SideLink icon={ShieldCheck} label="NGO verification" active={page === 'verification'} onClick={() => { setPage('verification'); setMobileNav(false) }} />
        {session && <SideLink icon={Users} label="My profile" active={page === 'profile'} onClick={() => { setPage('profile'); setMobileNav(false) }} />}
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Heart size={16} /></div><b>A little can go a long way.</b><p>Share available items with your community.</p><button onClick={() => session ? setModal('donate') : setModal('account')}>{session ? 'Make a donation' : 'Sign in to donate'} <ArrowRight size={14} /></button></div>
        <button className="profile-switch" onClick={() => session ? (setPage('profile'), setMobileNav(false)) : setModal('account')}><span className="avatar">{session ? accountLabel.slice(0,2).toUpperCase() : <LogIn size={15}/>}</span><span><b>{session ? accountLabel : 'Sign in or join'}</b><small>{session ? `${profile?.account_kind === 'organization' ? 'Organization' : 'Individual'} account` : 'Create your account'}</small></span><MoreIcon /></button>
      </div>
    </aside>
    {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><b>{navName(page)}</b></div><div className="topbar-actions"><button className="location-chip" onClick={useMyLocation} title="Use your approximate location"><MapPin size={14} /> {userLocation?.label || profile?.home_area || 'Set location'} <ChevronDown size={13} /></button><div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationOpen} onClick={openNotifications}><Bell size={17} />{unseenNotifications > 0 && <i>{unseenNotifications > 9 ? '9+' : unseenNotifications}</i>}</button>{notificationOpen && <section className="notification-panel"><div className="notification-panel-head"><div><b>Notifications</b><small>{unseenNotifications ? `${unseenNotifications} unread` : 'Your account updates'}</small></div><button className="icon-button" aria-label="Close notifications" onClick={() => setNotificationOpen(false)}><X size={15}/></button></div>{notificationError && <p className="notification-empty">{notificationError}</p>}{!notificationError && notifications.length === 0 && <p className="notification-empty">No notifications yet. Pickup and organization updates will appear here.</p>}{notifications.map(item => <button className={`notification-item ${item.read_at ? '' : 'unread'}`} key={item.id} onClick={() => openNotification(item)}><b>{item.title}</b><span>{item.message}</span><small>{new Date(item.created_at).toLocaleString()}</small></button>)}</section>}</div>{session ? <button className="account-chip" onClick={() => setPage('profile')}><span className="avatar small-avatar">{accountLabel.slice(0, 2).toUpperCase()}</span><span>Profile</span></button> : <button className="account-chip" onClick={() => setModal('account')}><LogIn size={15}/> Sign in</button>}</div></header>

      {page === 'discover' ? <>
        <section className="welcome-row"><div><p className="eyebrow"><span className="live-dot" /> YOUR NEIGHBOURHOOD, A LITTLE CLOSER</p><h1>Good things are<br className="desktop-break" /> happening nearby<span className="heading-period">.</span></h1><p className="welcome-sub">Find something useful. Pass something on. It all starts here.</p></div><button className="button button-primary welcome-cta" onClick={() => setModal('donate')}><Plus size={17} /> Create a donation</button></section>
        <section className="metrics-row"><Metric icon={Package} number={donations.length} label="available donations" tone="mint" /><Metric icon={Users} number={verifiedOrgCount} label="verified organizations" tone="lavender" /><Metric icon={Heart} number={claimRecords.filter(record => record.status === 'delivered').length} label="your completed pickups" tone="peach" /><div className="metric-note"><span className="metric-note-icon"><MapPin size={15} /></span><span><b>{userLocation?.label || 'Choose your area'}</b><small>Map pins are approximate.</small></span></div></section>
        <section className="discover-section"><div className="section-heading"><div><div className="eyebrow muted-eyebrow">LIVE COMMUNITY LISTINGS</div><h2>Find what’s available</h2></div><button className="text-button" onClick={() => { setPage('organizations'); setFilter('All') }}>Verified organizations <ArrowRight size={15} /></button></div>
          <div className="category-tabs"><div className="category-switch"><button className={category === 'food' ? 'selected' : ''} onClick={() => { setCategory('food'); setFilter('All') }}><Utensils size={15} /> Food <span>{donations.filter(item => item.category === 'food').length}</span></button><button className={category === 'items' ? 'selected' : ''} onClick={() => { setCategory('items'); setFilter('All') }}><Package size={15} /> Other items <span>{donations.filter(item => item.category === 'items').length}</span></button></div><div className="view-switch"><button className={!mapMode ? 'active' : ''} onClick={() => setMapMode(false)}>List</button><button className={mapMode ? 'active' : ''} onClick={() => setMapMode(true)}>Map</button></div></div>
          <div className="filter-row">{filters.map(f => <button key={f} className={`filter-chip ${filter === f ? 'active' : ''}`} onClick={() => { setFilter(f); if (['Clothes','Books','Household'].includes(f)) setCategory('items'); else if (f === 'Food') setCategory('food') }}>{f}</button>)}<div className="search-field"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search donations" /></div></div>
          <div className="results-line"><span><b>{visible.length} {visible.length === 1 ? 'donation' : 'donations'}</b> match your filters</span><button onClick={() => { if (!userLocation) { notify('Choose your area to sort by distance.'); return } setSortBy(current => current === 'nearest' ? 'newest' : 'nearest') }}>{sortBy === 'nearest' ? 'Closest first' : 'Newest first'} <ChevronDown size={14} /></button></div>
          {donationError && <div className="form-error">{donationError}</div>}{donationsLoading ? <div className="empty-state"><div className="loading-dot"/><h3>Loading current donations…</h3></div> : mapMode ? <React.Suspense fallback={<div className="empty-state"><h3>Loading map…</h3></div>}><MapView points={visible} selectedPoint={userLocation} onSelect={point => setApproximateLocation(point)} className="board-map"/></React.Suspense> : <div className="donation-grid">{visible.map(item => <DonationCard key={item.id} item={item} claimed={claimed.includes(item.id)} onClaim={() => claim(item)} />)}</div>}
          {!donationsLoading && visible.length === 0 && <div className="empty-state"><Package size={25} /><h3>No current donations match</h3><p>Try another category or filter. New listings will appear here after someone posts them.</p>{session && <button className="button button-primary" onClick={() => setModal('donate')}><Plus size={16} /> Start a donation</button>}</div>}
        </section>
        <section className="lower-cards"><div className="community-banner"><span className="banner-stamp"><Heart size={17} /></span><div><h3>Something useful deserves another life.</h3><p>List it in a few minutes and we’ll help connect it to a verified local organization.</p></div><button className="button button-light" onClick={() => setModal('donate')}>Share something <ArrowRight size={15} /></button></div><div className="safe-card"><ShieldCheck size={18} /><span><b>Giving with confidence</b><small>Recipients are reviewed before they can receive donations.</small></span><ChevronRight size={16} /></div></section>
      </> : <SecondaryPage page={page} donations={donations} claimed={claimed} claimRecords={claimRecords} session={session} profile={profile} onSaveProfile={saveProfile} onSignOut={signOut} onExplore={() => setPage('discover')} onDonate={() => session ? setModal('donate') : setModal('account')} onRegister={() => setPage('verification')} onClaim={claim} onAdvance={advancePickup} />}
      <footer className="footer"><span>© 2026 WelFlare</span><span><ShieldCheck size={12} /> A coordination platform built around care</span></footer>
    </main>
    {modal === 'donate' && <DonationModal onClose={() => setModal('')} onCreate={createDonation} userLocation={userLocation} onUseMyLocation={useMyLocation} />}
    {modal === 'account' && <AccountModal onClose={() => setModal('')} connected={isSupabaseConfigured} accountType={accountType} setAccountType={setAccountType} intent={intent} setIntent={setIntent} onGoogle={beginGoogle} onAuth={authenticate} onContinue={() => { if (!isSupabaseConfigured) { setModal(''); notify('You’re exploring the WelFlare preview') } else if (session) { setModal(''); if (accountType === 'Organization' && intent !== 'Donate') setPage('verification') } else notify('Sign in or create an account to continue') }} />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>
}

function MoreIcon() { return <span className="more-dots">•••</span> }
function navName(page) { return ({ discover: 'Discover', donations: 'My donations', pickups: 'Pickups', organizations: 'Organizations', impact: 'Impact so far', verification: 'NGO verification', profile: 'My profile' })[page] }
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

function DonationModal({ onClose, onCreate, userLocation, onUseMyLocation }) {
  const [type, setType] = useState('food')
  const [photo, setPhoto] = useState(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [error, setError] = useState('')
  const [pin, setPin] = useState(userLocation)
  const [mapOpen, setMapOpen] = useState(false)
  const inputRef = React.useRef(null)
  function choosePhoto(file) { if (!file) return; if (!file.type.startsWith('image/')) return setError('Please choose a photo in JPG, PNG or HEIC format.'); if (file.size > 10 * 1024 * 1024) return setError('Please choose a photo under 10 MB.'); setError(''); setPhoto(file); setPhotoUrl(URL.createObjectURL(file)) }
  async function submit(e) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    if (!photo) return setError('Please add a photo so the receiving organization can see what you’re sharing.')
    if (!pin) return setError('Choose an approximate pickup point on the map.')
    if (type === 'food' && !form.get('safety')) return setError('Please confirm the food handling details before continuing.')
    const expires = form.get('expiry'), prepared = new Date(form.get('preparedAt'))
    if (type === 'food' && (!form.get('preparedAt') || prepared > new Date() || prepared >= new Date(expires))) return setError('Enter a preparation time before the best-before time.')
    if (type === 'food' && expires && new Date(expires) <= new Date()) return setError('The best-before time must be in the future.')
    const pickup = new Date(form.get('deadline'))
    if (!form.get('deadline') || pickup <= new Date()) return setError('Pickup availability must be a time in the future.')
    const expiryDate = type === 'food' ? new Date(expires) : null
    const hours = expiryDate ? Math.max(0, (expiryDate - new Date()) / 36e5) : 0
    const fileBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(photo) })
    try {
      await onCreate({ category: type, subtype: form.get('subtype'), name: form.get('name'), qty: `${form.get('qty')} ${form.get('unit')}`, expiry: expiryDate ? `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m` : '', expiryDate: expiryDate?.toISOString(), preparedAt: type === 'food' ? prepared.toISOString() : null, foodType: form.get('foodtype'), condition: form.get('condition'), pickupDeadline: pickup.toISOString(), urgency: expiryDate ? hours < 3 ? 'Critical' : hours <= 8 ? 'Soon' : 'Fresh' : '', place: form.get('location').trim(), latitude: pin.latitude, longitude: pin.longitude, notes: form.get('notes'), safety: Boolean(form.get('safety')), photoData: fileBase64, photoType: photo.type, photoName: photo.name, photoFile: photo, image: photoUrl, time: 'Posted just now' })
    } catch (err) { setError(err.message || 'We couldn’t create this donation. Please try again.') }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal donation-modal"><div className="modal-head"><div><span className="eyebrow muted-eyebrow">MAKE A DIFFERENCE, CLOSE TO HOME</span><h2>Share a donation</h2><p>Tell the community what you have to pass along.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit}><div className="category-switch modal-switch"><button type="button" className={type === 'food' ? 'selected' : ''} onClick={() => { setType('food'); setError('') }}><Utensils size={15}/> Food</button><button type="button" className={type === 'items' ? 'selected' : ''} onClick={() => { setType('items'); setError('') }}><Package size={15}/> Other items</button></div><label className="photo-upload"><input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} required={!photo} /><span className="upload-icon">{photoUrl ? <img src={photoUrl} alt="Your uploaded donation"/> : <Camera size={20}/>}</span><span><b>{photo ? photo.name : 'Add a photo of your donation'} <em>Required</em></b><small>One clear photo helps organizations know what to expect · up to 10 MB</small></span><button type="button" className="upload-browse" onClick={() => inputRef.current?.click()}><Upload size={14}/> {photo ? 'Change' : 'Upload'}</button></label>
          <div className="form-grid"><label className="field wide"><span>What are you sharing? <i>*</i></span><input name="name" placeholder={type === 'food' ? 'e.g. Freshly packed lunch boxes' : 'e.g. Warm children’s clothing'} required/></label><label className="field"><span>Category <i>*</i></span><select name="subtype" required defaultValue=""><option value="" disabled>Choose a category</option>{(type === 'food' ? ['Cooked meals','Packaged food','Bakery','Produce','Groceries','Other food'] : ['Clothes','Books','Toys','Educational supplies','Beddings','Toiletries','Household items','Medical supplies','Electronics','Other goods']).map(x => <option key={x}>{x}</option>)}</select></label><div className="field"><span>Quantity <i>*</i></span><div className="quantity-input"><input name="qty" type="number" min="1" placeholder="e.g. 12" required/><select name="unit" aria-label="Quantity unit"><option>items</option><option>meals</option><option>boxes</option><option>bags</option><option>kg</option><option>sets</option><option>pieces</option><option>trays</option></select></div></div>{type === 'food' ? <><label className="field"><span>Prepared on <i>*</i></span><input name="preparedAt" type="datetime-local" required/></label><label className="field"><span>Best before <i>*</i></span><input name="expiry" type="datetime-local" required/></label><label className="field"><span>Food type</span><select name="foodtype"><option>Vegetarian</option><option>Non-vegetarian</option><option>Vegan</option><option>Not applicable</option></select></label><label className="field wide"><span>Storage &amp; handling notes</span><input name="notes" placeholder="e.g. Keep refrigerated; sealed containers"/></label><label className="safety-check"><input type="checkbox" name="safety"/><span>I confirm that, to the best of my knowledge, this food has been handled and stored hygienically and offered within its shelf life. I’ve provided accurate preparation and expiry details.</span></label></> : <><label className="field"><span>Item condition <i>*</i></span><select name="condition" required><option>Good — ready to use</option><option>Like new</option><option>Gently used</option><option>Unopened</option></select></label><label className="field"><span>Size, if relevant</span><input placeholder="e.g. ages 5–7 or adult M"/></label><label className="field wide"><span>Anything else to know?</span><input name="notes" placeholder="Add useful details for the receiving organization"/></label></>}<label className="field wide"><span>Pickup area or landmark <i>*</i></span><input name="location" placeholder="Type a neighborhood or nearby landmark" required/></label><div className="field wide"><span>Approximate map pin <i>*</i></span><div className="map-actions"><button type="button" className="button button-secondary" onClick={() => setMapOpen(value => !value)}>{mapOpen ? 'Hide map' : pin ? 'Adjust pin on map' : 'Choose on map'} <MapPin size={14}/></button><button type="button" className="button button-quiet" onClick={() => onUseMyLocation(point => setPin(point))}>Use my location</button><small>{pin ? `${pin.latitude.toFixed(3)}, ${pin.longitude.toFixed(3)} · approximate` : 'A map pin is required. You can choose one manually.'}</small></div>{mapOpen && <React.Suspense fallback={<div className="map-loading">Loading map…</div>}><MapView points={[]} selectedPoint={pin} onSelect={setPin} className="picker-map"/></React.Suspense>}</div><label className="field wide"><span>Pickup available until <i>*</i></span><input name="deadline" type="datetime-local" required/></label></div><div className="privacy-note"><ShieldCheck size={15}/><span>The listing shares only this approximate map area. Add a nearby landmark above; share an exact address only after coordinating a pickup.</span></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit"><Plus size={16}/> List this donation <ArrowRight size={15}/></button></div></form></section></div>
}

function AccountModal({ onClose, accountType, setAccountType, intent, setIntent, onGoogle, onAuth }) {
  const [mode, setMode] = useState('signin'), [organizationType, setOrganizationType] = useState('restaurant'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [fullName, setFullName] = useState(''), [phone, setPhone] = useState(''), [homeArea, setHomeArea] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { const data = await onAuth(email, password, mode, organizationType, fullName, phone, homeArea); if (data?.user && !data.session) setError('Check your inbox for the confirmation link, then sign in here.') } catch (err) { setError(err.message || 'We couldn’t complete that request.') } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="modal account-modal"><div className="modal-head"><div><span className="eyebrow muted-eyebrow">WELCOME TO WELFLARE</span><h2>Good things start here.</h2><p>Sign in or create an account to join your community.</p></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="auth-mode"><button className={mode === 'signin' ? 'selected' : ''} onClick={() => {setMode('signin');setError('')}}>Sign in</button><button className={mode === 'signup' ? 'selected' : ''} onClick={() => {setMode('signup');setError('')}}>Create account</button></div><span className="selector-label">I’m here as a</span><div className="choice-row">{['Individual','Organization'].map(x => <button type="button" className={accountType === x ? 'choice selected' : 'choice'} onClick={() => setAccountType(x)} key={x}>{x === 'Individual' ? <Users size={17}/> : <Building2 size={17}/>} {x}</button>)}</div>{accountType === 'Organization' && <label className="field organization-select"><span>Organization type</span><select value={organizationType} onChange={e => setOrganizationType(e.target.value)}><option value="restaurant">Restaurant</option><option value="catering_service">Catering service</option><option value="hotel">Hotel</option><option value="hostel">Hostel</option><option value="pg">PG</option><option value="school">School</option><option value="college">College</option><option value="corporate">Corporate</option><option value="retail_store">Retail store</option><option value="ngo">NGO / Non-profit</option><option value="trust">Trust</option><option value="society">Society</option><option value="section_8_company">Section 8 Company</option><option value="other">Other</option></select></label>}<span className="selector-label">I would like to</span><div className="choice-row">{['Donate','Receive','Both','Volunteer'].map(x => <button type="button" className={intent === x ? 'choice selected' : 'choice'} onClick={() => setIntent(x)} key={x}>{x === 'Donate' ? <Heart size={16}/> : x === 'Receive' ? <ArrowDownLeft size={16}/> : x === 'Volunteer' ? <Users size={16}/> : <Sparkles size={16}/>} {x}</button>)}</div>{accountType === 'Organization' && ['Receive','Both'].includes(intent) && <div className="verification-callout"><ShieldCheck size={16}/><span>Receiving organizations must pass WelFlare’s verification review before they can receive donations.</span></div>}<button className="google-button" type="button" onClick={() => onGoogle(organizationType, fullName, phone, homeArea)}><GoogleMark/> Continue with Google</button><div className="divider"><span>OR WITH EMAIL</span></div><form onSubmit={submit}>{mode === 'signup' && <><label className="field"><span>Full name <i>*</i></span><input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" placeholder="Your full name" required/></label><label className="field"><span>Phone number</span><input value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" type="tel" placeholder="Optional"/></label><label className="field"><span>Home area or neighborhood</span><input value={homeArea} onChange={e => setHomeArea(e.target.value)} placeholder="Optional"/></label></>}<label className="field"><span>Email address</span><input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" required/></label><label className="field auth-password"><span>Password</span><input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength="8" placeholder="At least 8 characters" required/></label>{error && <p className="auth-error">{error}</p>}<button className="email-link" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></button></form><p className="legal-copy">Your contact details stay private to your account.</p></section></div>
}
function GoogleMark() { return <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.1v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15z"/><path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.6-4.8L31 34.1c-1.8 1.2-4.1 2-7 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.5v-5.3H5.8a20 20 0 0 0 0 18z"/><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.9-5.8A19.6 19.6 0 0 0 24 4 20 20 0 0 0 5.8 14.9l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4z"/></svg> }

function SecondaryPage({ page, donations, claimed, claimRecords = [], session, profile, onSaveProfile, onSignOut, onExplore, onDonate, onRegister, onClaim, onAdvance }) {
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
  const [orgProfiles, setOrgProfiles] = useState([])
  const [volunteerInvites, setVolunteerInvites] = useState([])
  const stepPanel = React.useRef(null)
  const [tab, setTab] = useState('application')
  if (page === 'profile') return <ProfilePage session={session} profile={profile} onSave={onSaveProfile} onSignOut={onSignOut} />
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

  if (page === 'donations') { const mine = donations.filter(x => x.donor === 'Your donation'); return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">THANKS FOR PASSING IT ON</p><h1>My donations</h1><p>Keep an eye on the useful things you’ve shared.</p></div><button className="button button-primary" onClick={onDonate}><Plus size={16}/> New donation</button></div>{mine.length ? <div className="donation-grid">{mine.map(item => <DonationCard key={item.id} item={item} claimed={false} onClaim={() => {}}/>)}</div> : <div className="empty-state"><Package size={25}/><h3>Your story starts with one small thing.</h3><p>Your donations and their pickup progress will show up here.</p><button className="button button-primary" onClick={onDonate}><Plus size={16}/> Share a donation</button></div>}</section> }

  if (page === 'pickups') { const records = claimRecords.length ? claimRecords : donations.filter(x => claimed.includes(x.id)).map(item => ({ claimId: item.id, status: 'accepted', item })); return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">ON THE WAY TO A NEW HOME</p><h1>Your pickups</h1><p>Follow the donations you’ve requested and what comes next.</p></div><span className="page-hero-icon"><Truck size={25}/></span></div>{volunteerInvites.length > 0 && <div className="invitation-list"><h2>Volunteer invitations</h2>{volunteerInvites.map(invite => <div className="invitation-row" key={invite.id}><span className="metric-icon mint"><Users size={16}/></span><span><b>{invite.organizations?.name || 'Verified organization'}</b><small>Pickup volunteer invitation · {new Date(invite.created_at).toLocaleDateString()}</small></span><button className="button button-primary" onClick={async () => { const { error } = await supabase.functions.invoke('accept-volunteer-invitation',{ body: { invitationId: invite.id } }); if (error) notify('The invitation could not be accepted. It may have expired.'); else { setVolunteerInvites(current => current.filter(item => item.id !== invite.id)); notify('You’re now an invited pickup volunteer for this organization') } }}>Accept invitation</button></div>)}</div>}{records.length ? <div className="pickup-list">{records.map(record => <div className="pickup-row" key={record.claimId}><img src={record.item.image} alt=""/><div><h3>{record.item.name}</h3><p>{record.item.donor} · {record.item.qty} · {record.item.place}</p></div><span className={`status-pill ${record.status === 'delivered' ? 'verified' : 'pending'}`}>{record.status.replaceAll('_',' ')}</span>{record.status === 'accepted' && <button className="button button-secondary" onClick={() => onAdvance(record,'picked_up')}>Mark collected <ArrowRight size={13}/></button>}{record.status === 'picked_up' && <button className="button button-primary" onClick={() => onAdvance(record,'delivered')}>Mark delivered <Check size={13}/></button>}{record.item.category === 'food' && <div className="food-handover"><ShieldCheck size={15}/><span>Donor-submitted food information{record.item.safetyTime ? ` · ${new Date(record.item.safetyTime).toLocaleString()}` : ''}. The recipient is responsible for suitable handling after handover. Do not distribute after the listed best-before time. WelFlare coordinates the pickup and does not independently certify food safety.</span></div>}</div>)}</div> : volunteerInvites.length === 0 && <div className="empty-state"><Truck size={25}/><h3>Nothing to pick up yet.</h3><p>When you request a nearby donation, it’ll appear here.</p><button className="button button-primary" onClick={onExplore}>Explore nearby <ArrowRight size={15}/></button></div>}</section> }
  return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">GOOD THINGS, ADDED UP</p><h1>Your impact</h1><p>Activity from real WelFlare listings and pickups.</p></div><span className="page-hero-icon"><Heart size={25}/></span></div><div className="impact-stats"><div><span className="metric-icon mint"><Package size={17}/></span><b>{donations.length}</b><small>currently available donations</small></div><div><span className="metric-icon lavender"><Users size={17}/></span><b>{claimRecords.length}</b><small>pickup requests in your account</small></div><div><span className="metric-icon peach"><Leaf size={17}/></span><b>{claimRecords.filter(record => record.status === 'delivered').length}</b><small>pickups marked delivered</small></div></div><div className="impact-quote"><Sparkles size={18}/><div><h3>Useful things deserve another chance.</h3><p>WelFlare connects available goods with organizations that have completed verification.</p></div></div></section>
}

function ProfilePage({ session, profile, onSave, onSignOut }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const form = new FormData(event.currentTarget); try { await onSave({ display_name: form.get('name').trim(), phone: form.get('phone').trim(), home_area: form.get('area').trim() }); setMessage('Your profile was saved.') } catch (failure) { setError(failure.message || 'We could not save your profile.') } finally { setBusy(false) } }
  return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">YOUR ACCOUNT</p><h1>My profile</h1><p>Update how your community sees you and sign out when you’re done.</p></div><span className="page-hero-icon"><Users size={25}/></span></div><div className="profile-form-card"><p><b>{session?.user?.email}</b><small> Account email</small></p><form onSubmit={submit}><label className="field"><span>Full name <i>*</i></span><input name="name" defaultValue={profile?.display_name || session?.user?.user_metadata?.display_name || ''} required maxLength="100"/></label><label className="field"><span>Phone number</span><input name="phone" type="tel" defaultValue={profile?.phone || ''} maxLength="30"/></label><label className="field"><span>Home area or neighborhood</span><input name="area" defaultValue={profile?.home_area || ''} maxLength="120"/></label>{error && <div className="form-error">{error}</div>}{message && <p className="profile-success">{message}</p>}<div className="modal-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="button button-secondary" onClick={onSignOut}>Sign out</button></div></form></div></section>
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
  const organizations = (profiles || []).map(o => ({ ...o, initials: o.name.slice(0,2).toUpperCase(), accepts: o.accepts.map(type => type.replaceAll('_',' ')), tone: 'mint', sample: false }))
  return <section className="subpage"><div className="page-hero"><div><p className="eyebrow muted-eyebrow">YOUR LOCAL NETWORK</p><h1>Organizations nearby</h1><p>Meet reviewed community organizations and see what they can receive.</p></div><span className="page-hero-icon"><Users size={25}/></span></div>{managedOrganization && <div className="invite-panel"><div><h3>Bring a pickup volunteer on board</h3><p>Only your verified organization’s accepted donation types can be picked up by invited volunteers.</p></div><form onSubmit={inviteVolunteer}><input type="email" value={volunteerEmail} onChange={e => setVolunteerEmail(e.target.value)} placeholder="Volunteer’s WelFlare email" required/><button className="button button-primary" disabled={inviteBusy}>{inviteBusy ? 'Saving…' : 'Invite volunteer'} <ArrowRight size={14}/></button></form>{inviteMessage && <p className="invite-message">{inviteMessage}</p>}</div>}{organizations.length ? <div className="org-grid">{organizations.map(o => <article className="org-card" key={o.id}><div className={`org-avatar ${o.tone}`}>{o.initials}</div><span className="status-pill verified"><BadgeCheck size={12}/> Verified</span><h3>{o.name}</h3><p className="org-type">{o.type}</p><div className="org-accepts"><span>ACCEPTS</span><b>{o.accepts.join(' · ')}</b></div>{o.checks && <div className="verification-checks">{[['darpan_verified','NGO DARPAN Verified'],['registration_verified','Organization Registration Verified'],['pan_verified','PAN Verified'],['bank_verified','Bank Account Verified'],['twelve_ab_verified','12A / 12AB Verified'],['eighty_g_verified','80G Verified'],['fcra_verified','FCRA Verified']].filter(([key]) => o.checks[key]).map(([,label]) => <span key={label}><Check size={11}/>{label}</span>)}</div>}</article>)}</div> : <div className="empty-state"><Users size={25}/><h3>No verified organizations nearby yet.</h3><p>Organizations appear here after a reviewer completes their application.</p></div>}<p className="fine-print public-verification-note"><ShieldCheck size={14}/> Verification checks submitted identity and records. WelFlare and the Government of India do not guarantee an organization’s conduct or the use of donations.</p></section>
}

function AdminReviewQueue({ applications, loading, error, reasons, setReasons, checks, setChecks, busy, onReview }) {
  if (!isSupabaseConfigured) return <div className="admin-placeholder"><div className="admin-placeholder-icon"><ShieldCheck size={22}/></div><h2>Secure review queue</h2><p>Connect Supabase, configure a server encryption key and explicitly grant reviewer access in the private administrator list. The preview never simulates NGO decisions.</p><span className="status-pill not-started">No applications submitted</span></div>
  return <div className="admin-queue"><div className="queue-heading"><div><h2>Organization applications</h2><p>Private applicant information is shown only to authorized reviewers.</p></div><span className="status-pill pending">{applications.length} records</span></div>{error && <div className="form-error">{error}</div>}{loading && <div className="queue-loading"><span className="loading-dot"/> Loading the secure review queue…</div>}{!loading && applications.length === 0 && !error && <div className="empty-state"><FileCheck2 size={24}/><h3>No applications are waiting for review.</h3><p>New NGO applications will appear here after secure submission.</p></div>}{applications.map(org => { const orgChecks = checks[org.id] || {}; const setOrgChecks = next => setChecks(current => ({ ...current, [org.id]: { ...current[org.id], ...next } })); return <article className="admin-review-card" key={org.id}><div className="review-card-title"><div className="review-avatar">{org.name.slice(0,2).toUpperCase()}</div><span><b>{org.name}</b><small>{org.organization_type.replaceAll('_',' ')} · submitted {new Date(org.created_at).toLocaleDateString()}</small></span><span className={`status-pill ${org.verification_status === 'verified' ? 'verified' : org.verification_status === 'rejected' || org.verification_status === 'suspended' ? 'not-started' : 'pending'}`}>{org.verification_status.replaceAll('_',' ')}</span></div><div className="secure-review-grid"><div><small>NGO DARPAN ID</small><b>{org.sensitive?.darpan_id || 'Not supplied'}</b></div><div><small>Organization PAN</small><b>{org.sensitive?.pan || 'Not supplied'}</b></div><div><small>Legal registration number</small><b>{org.sensitive?.registration_number || 'Not supplied'}</b></div><div><small>Registered address</small><b>{org.sensitive?.registered_address || 'Not supplied'}</b></div><div><small>Authorized representative</small><b>{org.sensitive?.representative_name || 'Not supplied'}</b></div><div><small>Representative contact</small><b>{org.sensitive?.representative_contact || 'Not supplied'}</b></div><div><small>Bank account holder & bank</small><b>{org.sensitive?.account_holder || 'Not supplied'} · {org.sensitive?.bank_name || 'Not supplied'}</b></div><div><small>Account number & IFSC</small><b>{org.sensitive?.bank_account || 'Not supplied'} · {org.sensitive?.ifsc || 'Not supplied'}</b></div><div><small>12A / 12AB</small><b>{org.sensitive?.twelve_ab || 'Not applicable'}</b></div><div><small>80G</small><b>{org.sensitive?.eighty_g || 'Not applicable'}</b></div><div><small>FCRA reference</small><b>{org.sensitive?.fcra_reference || 'Domestic contributions only'}</b></div><div><small>Accepted donation types</small><b>{org.accepts.join(', ').replaceAll('_',' ')}</b></div></div><h4>Submitted documents</h4><div className="review-documents">{org.documents?.map(doc => <div className="review-document" key={doc.id}><FileText size={15}/><span><b>{doc.document_type.replaceAll('_',' ')}</b><small>{doc.is_required ? 'Required' : 'Optional'} · {doc.expires_at ? `Expires ${new Date(doc.expires_at).toLocaleDateString()}` : 'No expiry recorded'} · {doc.review_status}</small></span>{doc.signedUrl && <a href={doc.signedUrl} target="_blank" rel="noreferrer">View</a>}{doc.review_status === 'pending' && <><button onClick={() => onReview(org.id,'review_document',{ documentId: doc.id, documentStatus: 'verified' })}>Verify</button><button className="reject-link" onClick={() => onReview(org.id,'review_document',{ documentId: doc.id, documentStatus: 'rejected' })}>Reject</button></>}</div>)}</div>{['pending_verification','under_review'].includes(org.verification_status) && <><h4>Manual record checks</h4><div className="review-checklist admin-checklist">{[['darpan','DARPAN organization identity matches'],['registration','Registration details match'],['pan','Organization PAN matches'],['bank','Bank ownership matches organization'],['twelve_ab','12A / 12AB verified (if supplied)'],['eighty_g','80G verified (if supplied)']].map(([key,label]) => <label key={key}><input type="checkbox" checked={Boolean(orgChecks[key])} onChange={e => setOrgChecks({ [key]: e.target.checked })}/><span>{label}</span></label>)}</div></>}<label className="field admin-reason"><span>Reviewer note / decision reason <i>*</i></span><textarea rows="2" value={reasons[org.id] || ''} onChange={e => setReasons(current => ({ ...current, [org.id]: e.target.value }))} placeholder="Record what you checked or why you made this decision"/></label><div className="admin-actions">{org.verification_status === 'pending_verification' && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'under_review')}>Start review</button>}{['pending_verification','under_review'].includes(org.verification_status) && <><button className="button button-primary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'approve',{ checks: orgChecks })}>Approve organization</button><button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'reject')}>Reject with reason</button></>}{org.verification_status === 'verified' && <button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'suspend')}>Suspend organization</button>}{org.fcra_status === 'pending' && <><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => onReview(org.id,'approve_fcra')}>Approve FCRA</button><button className="button button-reject" disabled={Boolean(busy)} onClick={() => onReview(org.id,'reject_fcra')}>Reject FCRA</button></>}</div>{org.audit?.length > 0 && <><h4>Verification history</h4><div className="audit-list">{org.audit.map((entry,index) => <div key={`${entry.created_at}-${index}`}><span>{entry.action.replaceAll('_',' ')}</span><time>{new Date(entry.created_at).toLocaleString()}</time><small>Admin {entry.admin_id?.slice(0,8) || 'System'} · {entry.reason}</small></div>)}</div></>}</article> })}</div>
}

async function fileAsBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) }) }

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('WelFlare screen error:', error) }
  render() { return this.state.error ? <main className="app-error-screen"><h1>WelFlare had a problem loading this screen.</h1><p>{this.state.error.message}</p><button onClick={() => window.location.reload()}>Reload the page</button></main> : this.props.children }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>)

