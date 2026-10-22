import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, runTransaction, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// =====================================================================
//  Firebase কনফিগারেশন
//  Firebase Console → Project settings → Your apps → Web app (</>)
//  থেকে কনফিগ কপি করে নিচের মানগুলো বদলে দিন।
// =====================================================================
const firebaseConfig = {
    apiKey: "AIzaSyAQX7UnuNHrC4qq85pN9qUdb1X7OcUhwUE",
    authDomain: "tenant-form-generator.firebaseapp.com",
    projectId: "tenant-form-generator",
    storageBucket: "tenant-form-generator.firebasestorage.app",
    messagingSenderId: "395444221094",
    appId: "1:395444221094:web:9b2e57d1ef0612a2527067",
    measurementId: "G-95S3PRMP0Q"
  };


/* =====================================================================
   Firebase data model
   houses/{houseId}                      → { name, address, createdAt, tenantCount, nextSerial }
   houses/{houseId}/tenants/{tenantId}   → { serial, label, data, photoUrl, signatureUrl, savedAt, createdAt }
   (ছবি ও স্বাক্ষর ছোট করে base64 আকারে Firestore-এই রাখা হয় — Storage লাগে না, সম্পূর্ণ ফ্রি)
   ===================================================================== */

const $ = id => document.getElementById(id);
const body = document.body;
const form = $('theForm');
const fields = form.querySelectorAll('[data-key]');
const FIELD_KEYS = Array.from(fields).map(f => f.dataset.key);
const DATE_KEYS = new Set(['dob', 'formDate']);

const bnDigits = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
function toBn(n){ return String(n).split('').map(d => bnDigits[d] ?? d).join(''); }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const PHOTO_HINT_HTML = '<svg class="ic"><use href="#i-upload"/></svg><span id="photoHint">ছবি বাছাই করতে ক্লিক করুন</span>';

/* ================= TOAST ================= */
let toastTimer = null;
function showToast(msg){
  const t = $('toast');
  $('toastText').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function fbErr(err){
  const c = err && err.code ? String(err.code) : '';
  if(c.includes('permission-denied') || c.includes('unauthorized')) return 'অনুমতি নেই — Firestore/Storage rules ও লগইন চেক করুন।';
  if(c.includes('unavailable') || c.includes('network')) return 'ইন্টারনেট সংযোগ চেক করুন।';
  return (err && err.message) ? err.message : 'অজানা সমস্যা';
}

/* ================= FIREBASE INIT ================= */
const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR_');
let auth = null, db = null;
if(configured){
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  $('cfgWarn').style.display = 'block';
  $('loginBtn').disabled = true;
}

/* ================= APP STATE ================= */
let currentUser = null;
let authReady = !configured;
let activeView = 'viewLogin';
let houses = [];
let housesLoaded = false;
let housesUnsub = null;
let housesReady = Promise.resolve();
let tenants = [];
let tenantsUnsub = null;
let currentHouseId = null;
let editingTenant = null;       // tenant object when updating, null for a new one
let viewingSavedItem = null;
let editingHouseId = null;
let saving = false;

function newImgState(){ return { display:null, url:null, path:null, newDataUrl:null, removed:false }; }
let photoState = newImgState();
let sigState = newImgState();

function getHouse(id){ return houses.find(h => h.id === id) || null; }

/* ================= SETTINGS (সেটিংস — Firestore: settings/app) ================= */
const DEFAULT_SETTINGS = {
  siteName: 'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র',
  siteSubtitle: 'বাসা ব্যবস্থাপনা সিস্টেম',
  docTitle: 'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র',
  adminName: 'অ্যাডমিন',
  paper: 'a4',
  logo: null
};
let settings = Object.assign({}, DEFAULT_SETTINGS);
let settingsUnsub = null;
let logoDraft; // undefined = অপরিবর্তিত, null = সরানো হয়েছে, string = নতুন লোগো
let brandMarkOriginal = null;
let docLogoOriginal = null;

function applySettings(){
  const s = settings;
  document.title = s.siteName || DEFAULT_SETTINGS.siteName;
  const bn = $('brandName'), bs = $('brandSub'), dt = $('docTitle');
  if(bn) bn.textContent = s.siteName;
  if(bs) bs.textContent = s.siteSubtitle;
  if(dt) dt.textContent = s.docTitle;
  const ha = $('hdrAdmin'), hv = $('hdrAvatar');
  if(ha) ha.textContent = s.adminName;
  if(hv) hv.textContent = Array.from(s.adminName || 'A')[0] || 'A';
  const bm = $('brandMark'), dl = $('docLogo');
  if(bm && brandMarkOriginal === null) brandMarkOriginal = bm.innerHTML;
  if(dl && docLogoOriginal === null) docLogoOriginal = dl.getAttribute('src');
  if(bm) bm.innerHTML = s.logo ? '<img src="' + esc(s.logo) + '" alt="লোগো">' : brandMarkOriginal;
  if(dl) dl.setAttribute('src', s.logo || docLogoOriginal);
  const ps = $('paperSizeSelect');
  if(ps && s.paper) ps.value = s.paper;
  updateHeaderTitle();
}
function startSettingsListener(){
  stopSettingsListener();
  settingsUnsub = onSnapshot(doc(db, 'settings', 'app'), snap => {
    settings = Object.assign({}, DEFAULT_SETTINGS, snap.exists() ? snap.data() : {});
    applySettings();
  }, err => { console.error(err); });
}
function stopSettingsListener(){ if(settingsUnsub){ settingsUnsub(); settingsUnsub = null; } }
function paintLogoPrev(){
  const src = logoDraft === undefined ? settings.logo : logoDraft;
  $('setLogoPrev').innerHTML = src
    ? '<img src="' + esc(src) + '" alt="লোগো">'
    : '<span class="logo-none">লোগো নেই</span>';
}
function fillSettingsForm(){
  $('setSiteName').value = settings.siteName || '';
  $('setSiteSub').value = settings.siteSubtitle || '';
  $('setDocTitle').value = settings.docTitle || '';
  $('setAdminName').value = settings.adminName || '';
  $('setPaper').value = settings.paper || 'a4';
  $('setMsg').textContent = '';
  logoDraft = undefined;
  paintLogoPrev();
}
function showSettings(){
  showView('viewSettings');
  currentHouseId = null;
  fillSettingsForm();
}

/* ================= SIDEBAR (বাসা সমূহ + সেটিংস + ভবিষ্যৎ সেকশন) ================= */
// ভবিষ্যতে নতুন সেকশন যোগ করতে নিচের তালিকায় একটি অবজেক্ট বসান, যেমন:
//   { id:'x', title:'সেকশনের নাম', items:[ { label:'আইটেম', icon:'i-home', hash:'#/x', active: () => activeView === 'viewX', badge: () => '৫' } ] }
// (নতুন পেজ হলে index.html-এ একটি <section class="view" id="viewX"> ও showView/route-এ যোগ করতে হবে)
const NAV_SECTIONS = [
  { id:'main', title:'প্রধান', items:[
    { label:'ড্যাশবোর্ড', icon:'i-grid', hash:'#/', active: () => activeView === 'viewHome' },
    { label:'বাসা সমূহ', icon:'i-home', hash:'#/houses',
      active: () => ['viewHouses','viewHouse'].includes(activeView) || (activeView === 'viewForm' && /\/edit\//.test(location.hash)),
      badge: () => toBn(houses.length) },
    { label:'নতুন ভাড়াটিয়া ফর্ম', icon:'i-file', hash:'#/tenant',
      active: () => activeView === 'viewForm' && !/\/edit\//.test(location.hash) }
  ] },
  { id:'system', title:'সিস্টেম', items:[
    { label:'সেটিংস', icon:'i-settings', hash:'#/settings', active: () => activeView === 'viewSettings' }
  ] },
];
function navButton(label, icon, extraClass, onClick, badge){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav-item' + (extraClass ? ' ' + extraClass : '');
  b.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg><span class="nav-label"></span>' + (badge != null ? '<span class="nav-count">' + esc(badge) + '</span>' : '');
  b.querySelector('.nav-label').textContent = label;
  b.addEventListener('click', () => { body.classList.remove('side-open'); onClick(); });
  return b;
}
function updateHeaderTitle(){
  const el = $('pageTitle');
  if(!el) return;
  const h = getHouse(currentHouseId);
  let t = settings.siteName || DEFAULT_SETTINGS.siteName;
  if(currentUser){
    if(activeView === 'viewHome') t = 'ড্যাশবোর্ড';
    else if(activeView === 'viewHouses') t = 'বাসা সমূহ';
    else if(activeView === 'viewSettings') t = 'সেটিংস';
    else if(activeView === 'viewHouse') t = h ? 'বাসা: ' + h.name : 'বাসা';
    else if(activeView === 'viewForm') t = (/\/edit\//.test(location.hash) ? 'ভাড়াটিয়ার ফর্ম আপডেট' : 'নতুন ভাড়াটিয়া ফর্ম') + (h ? ' — ' + h.name : '');
  }
  el.textContent = t;
}
function renderSidebar(){
  const nav = $('sideNav');
  if(!nav) return;
  nav.innerHTML = '';
  NAV_SECTIONS.forEach(sec => {
    const t = document.createElement('div');
    t.className = 'nav-title';
    t.textContent = sec.title;
    nav.appendChild(t);
    (sec.items || []).forEach(it => {
      const isActive = it.active ? it.active() : location.hash === it.hash;
      nav.appendChild(navButton(it.label, it.icon, isActive ? 'active' : '', () => go(it.hash), it.badge ? it.badge() : null));
    });
  });
  updateHeaderTitle();
}

/* ================= VIEWS / ROUTER ================= */
function showView(name){
  activeView = name;
  ['viewLogin','viewHome','viewHouses','viewSettings','viewHouse','viewForm'].forEach(v => $(v).classList.toggle('active', v === name));
  if(name !== 'viewHouse') stopTenantsListener();
  body.classList.remove('preview-open','house-open','side-open');
  window.scrollTo(0, 0);
}
function go(hash){ if(location.hash === hash) route(); else location.hash = hash; }

function route(){ routeInner(); renderSidebar(); }
function routeInner(){
  if(!authReady) return;
  if(!currentUser){ showView('viewLogin'); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if(parts[0] === 'house' && parts[1]){
    if(parts[2] === 'new') openForm(parts[1], null);
    else if(parts[2] === 'edit' && parts[3]) openForm(parts[1], parts[3]);
    else showHouse(parts[1]);
  } else if(parts[0] === 'tenant'){
    openForm(null, null);
  } else if(parts[0] === 'houses'){
    showHouses();
  } else if(parts[0] === 'settings'){
    showSettings();
  } else {
    showHome();
  }
}
window.addEventListener('hashchange', route);

/* ================= AUTH ================= */
if(configured){
  onAuthStateChanged(auth, user => {
    currentUser = user;
    authReady = true;
    body.classList.toggle('authed', !!user);
    if(user){ startHousesListener(); startSettingsListener(); } else stopAllListeners();
    route();
  });
} else {
  showView('viewLogin');
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  if(!configured) return;
  const btn = $('loginBtn'), err = $('loginErr');
  err.textContent = '';
  btn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPass').value);
    $('loginPass').value = '';
  }catch(ex){
    const c = ex && ex.code || '';
    if(c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) err.textContent = '❌ ইমেইল বা পাসওয়ার্ড ভুল।';
    else if(c.includes('invalid-email')) err.textContent = '❌ ইমেইল ঠিকমতো লিখুন।';
    else if(c.includes('too-many-requests')) err.textContent = '❌ অনেকবার চেষ্টা করা হয়েছে, কিছুক্ষণ পরে আবার চেষ্টা করুন।';
    else err.textContent = '❌ লগইন করা যায়নি: ' + fbErr(ex);
  }finally{ btn.disabled = false; }
});
$('logoutBtn').addEventListener('click', async () => {
  if(!confirm('লগআউট করতে চান?')) return;
  try{ await signOut(auth); location.hash = '#/'; }catch(ex){ showToast(fbErr(ex)); }
});
$('menuBtn').addEventListener('click', () => {
  if(window.matchMedia('(max-width:900px)').matches) body.classList.toggle('side-open');
  else body.classList.toggle('side-collapsed');
});
$('sideBackdrop').addEventListener('click', () => body.classList.remove('side-open'));
$('brandHome').addEventListener('click', () => { if(currentUser) go('#/'); });

/* ================= HOUSES (dashboard) ================= */
function startHousesListener(){
  stopHousesListener();
  housesLoaded = false;
  let resolve;
  housesReady = new Promise(r => { resolve = r; });
  const q = query(collection(db, 'houses'), orderBy('createdAt', 'asc'));
  housesUnsub = onSnapshot(q, snap => {
    houses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    housesLoaded = true;
    resolve();
    renderSidebar();
    if(activeView === 'viewHome') renderHome();
    else if(activeView === 'viewHouses') renderHousesPage();
    else if(activeView === 'viewForm') refreshFormHouses();
    else if(activeView === 'viewHouse') renderHouseHeader();
  }, err => {
    console.error(err);
    housesLoaded = true; resolve();
    showToast('বাসার তালিকা আনতে সমস্যা: ' + fbErr(err));
    if(activeView === 'viewHome') renderHome();
    else if(activeView === 'viewHouses') renderHousesPage();
    else if(activeView === 'viewForm') refreshFormHouses();
  });
}
function stopHousesListener(){ if(housesUnsub){ housesUnsub(); housesUnsub = null; } houses = []; }
function stopTenantsListener(){ if(tenantsUnsub){ tenantsUnsub(); tenantsUnsub = null; } tenants = []; }
function stopAllListeners(){ stopHousesListener(); stopTenantsListener(); stopSettingsListener(); housesLoaded = false; }

function showHome(){
  showView('viewHome');
  currentHouseId = null;
  renderHome();
}
function houseCard(h, manage){
  const card = document.createElement('div');
  card.className = 'house-card';
  card.innerHTML =
    '<div class="house-top"><div class="house-ic"><svg class="ic"><use href="#i-home"/></svg></div>' +
      '<div class="house-meta"><b>বাসা: ' + esc(h.name) + '</b>' +
      '<small><svg class="ic"><use href="#i-pin"/></svg><span>' + esc(h.address || 'ঠিকানা দেওয়া নেই') + '</span></small></div></div>' +
    '<div class="house-count"><span>ভাড়াটিয়া সংখ্যা:</span><span class="n">' + toBn(h.tenantCount || 0) + '</span><span>জন</span></div>' +
    '<div class="house-sub">ফ্ল্যাট/তলা ' + toBn(houseFlats(h).length) + 'টি' + (houseFlats(h).some(f => f.rent != null) ? ' • মোট মাসিক ভাড়া ' + fmtMoney(houseFlats(h).reduce((s, f) => s + (Number(f.rent) || 0), 0)) : '') + '</div>' +
    '<div class="house-actions">' +
      '<button class="btn btn-primary btn-sm" data-act="open"><svg class="ic"><use href="#i-users"/></svg>খুলুন</button>' +
      (manage ? '<button class="btn btn-outline btn-sm" data-act="edit"><svg class="ic"><use href="#i-edit"/></svg>এডিট</button>' +
                '<button class="btn btn-danger btn-sm" data-act="delete"><svg class="ic"><use href="#i-trash"/></svg>মুছুন</button>' : '') +
    '</div>';
  card.addEventListener('click', () => go('#/house/' + h.id));
  card.querySelector('[data-act=open]').addEventListener('click', e => { e.stopPropagation(); go('#/house/' + h.id); });
  if(manage){
    card.querySelector('[data-act=edit]').addEventListener('click', e => { e.stopPropagation(); openHouseModal(h); });
    card.querySelector('[data-act=delete]').addEventListener('click', e => { e.stopPropagation(); deleteHouse(h); });
  }
  return card;
}
function fillHouseGrid(grid, manage, emptyMsg){
  if(!housesLoaded){
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">☁️ লোড হচ্ছে...</div>';
    return;
  }
  if(!houses.length){
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">' + emptyMsg + '</div>';
    return;
  }
  grid.innerHTML = '';
  houses.forEach(h => grid.appendChild(houseCard(h, manage)));
}
// ড্যাশবোর্ড: শুধু তথ্য দেখা যাবে (ক্লিক/এডিট/মুছা কিছুই নেই)
const DASH_COLORS = ['#1F8A55','#2F6FDB','#E0A82E','#7A4FD6','#E0536A','#16A5A5','#E07B2F','#8A9A2B'];
function updateClock(){
  const d = new Date();
  const dt = $('dashDate'), ck = $('dashClock');
  if(dt) dt.textContent = d.toLocaleDateString('bn-BD', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  if(ck) ck.textContent = d.toLocaleTimeString('bn-BD', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(() => { if(activeView === 'viewHome') updateClock(); }, 1000);
function renderHome(){
  updateClock();
  const total = houses.reduce((s, h) => s + (Number(h.tenantCount) || 0), 0);
  const maxH = houses.reduce((m, h) => (Number(h.tenantCount) || 0) > (m ? Number(m.tenantCount) || 0 : -1) ? h : m, null);
  $('statHouses').textContent = toBn(houses.length);
  $('statTenants').textContent = toBn(total);
  $('statAvg').textContent = toBn(houses.length ? (total / houses.length).toFixed(1) : 0);
  $('statTop').textContent = toBn(maxH ? (Number(maxH.tenantCount) || 0) : 0);
  $('statTopName').textContent = maxH && (Number(maxH.tenantCount) || 0) > 0 ? maxH.name : '—';

  const bars = $('dashBars'), donut = $('dashDonut'), legend = $('dashLegend');
  if(!housesLoaded){
    bars.innerHTML = '<div class="empty-state">☁️ লোড হচ্ছে...</div>';
    donut.style.background = '#E8EEE6'; legend.innerHTML = '';
    $('donutTotal').textContent = toBn(0);
    return;
  }
  if(!houses.length){
    bars.innerHTML = '<div class="empty-state">এখনও কোনো বাসা যোগ করা হয়নি।<br>বাম পাশের "বাসা সমূহ" এ গিয়ে প্রথম বাসা যোগ করুন।</div>';
    donut.style.background = '#E8EEE6'; legend.innerHTML = '';
    $('donutTotal').textContent = toBn(0);
    return;
  }
  const max = Math.max(1, ...houses.map(h => Number(h.tenantCount) || 0));
  bars.innerHTML = houses.map((h, i) => {
    const c = Number(h.tenantCount) || 0;
    const w = c ? Math.max(4, Math.round(c / max * 100)) : 0;
    return '<div class="bar-row"><div class="bar-ic"><svg class="ic"><use href="#i-home"/></svg></div>' +
      '<div class="bar-main"><b>বাসা: ' + esc(h.name) + '</b><small>' + esc(h.address || 'ঠিকানা দেওয়া নেই') + '</small>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%;background:' + DASH_COLORS[i % DASH_COLORS.length] + '"></div></div></div>' +
      '<div class="bar-count">' + toBn(c) + ' জন</div></div>';
  }).join('');
  let acc = 0;
  const stops = [];
  houses.forEach((h, i) => {
    const c = Number(h.tenantCount) || 0;
    if(!c || !total) return;
    const from = acc / total * 360; acc += c; const to = acc / total * 360;
    stops.push(DASH_COLORS[i % DASH_COLORS.length] + ' ' + from.toFixed(2) + 'deg ' + to.toFixed(2) + 'deg');
  });
  donut.style.background = stops.length ? 'conic-gradient(' + stops.join(',') + ')' : '#E8EEE6';
  $('donutTotal').textContent = toBn(total);
  legend.innerHTML = houses.map((h, i) =>
    '<div><i style="background:' + DASH_COLORS[i % DASH_COLORS.length] + '"></i><span class="n">' + esc(h.name) + '</span><b>' + toBn(Number(h.tenantCount) || 0) + '</b></div>'
  ).join('');
}
// বাসা সমূহ সেকশন: নতুন বাসা যোগ + এডিট/মুছা
function showHouses(){
  showView('viewHouses');
  currentHouseId = null;
  renderHousesPage();
}
function renderHousesPage(){
  fillHouseGrid($('housesManageGrid'), true, 'এখনও কোনো বাসা নেই।<br>উপরের "নতুন বাসা যোগ করুন" চেপে প্রথম বাসা বানান।');
}

/* ---- বাসার তথ্য: ফ্ল্যাট/তলা, পাশ, ভাড়া, গ্যাস বিল ---- */
let tenantsLoadedFor = null;
function flatLabel(f){ return (f.floor || '') + (f.side ? ' — ' + f.side + ' পাশ' : ''); }
function fmtMoney(n){ return '৳' + toBn((Number(n) || 0).toLocaleString('en-US')); }
function houseFlats(h){ return (h && Array.isArray(h.flats)) ? h.flats : []; }

const flatRows = $('flatRows');
function addFlatRow(v){
  v = v || {};
  const row = document.createElement('div');
  row.className = 'flat-row';
  row.innerHTML =
    '<input type="text" list="floorList" placeholder="যেমনঃ ৩য় তলা" data-f="floor">' +
    '<select data-f="side"><option value="">পাশ</option><option>পূর্ব</option><option>পশ্চিম</option><option>উত্তর</option><option>দক্ষিণ</option></select>' +
    '<input type="number" inputmode="numeric" min="0" placeholder="বাসা ভাড়া" data-f="rent">' +
    '<input type="number" inputmode="numeric" min="0" placeholder="গ্যাস বিল" data-f="gas">' +
    '<button type="button" class="fam-remove" title="মুছে ফেলুন" aria-label="মুছে ফেলুন">×</button>';
  flatRows.appendChild(row);
  row.querySelector('[data-f=floor]').value = v.floor || '';
  row.querySelector('[data-f=side]').value = v.side || '';
  row.querySelector('[data-f=rent]').value = v.rent != null ? v.rent : '';
  row.querySelector('[data-f=gas]').value = v.gas != null ? v.gas : '';
  row.querySelector('.fam-remove').addEventListener('click', () => row.remove());
}
$('addFlatRow').addEventListener('click', () => addFlatRow());
function collectFlats(){
  const rows = Array.from(flatRows.querySelectorAll('.flat-row'));
  const flats = [], seen = new Set();
  for(const row of rows){
    const floor = row.querySelector('[data-f=floor]').value.trim();
    const side = row.querySelector('[data-f=side]').value;
    const rentV = row.querySelector('[data-f=rent]').value.trim();
    const gasV = row.querySelector('[data-f=gas]').value.trim();
    if(!floor && !side && !rentV && !gasV) continue;
    if(!floor) return { error: 'প্রতিটি ফ্ল্যাটের জন্য ফ্লোর/তলা লিখতে হবে।' };
    const f = { floor, side, rent: rentV === '' ? null : Number(rentV), gas: gasV === '' ? null : Number(gasV) };
    const key = flatLabel(f);
    if(seen.has(key)) return { error: '"' + key + '" দুইবার দেওয়া হয়েছে।' };
    seen.add(key);
    flats.push(f);
  }
  return { flats };
}

/* ---- add / edit house modal ---- */
function openHouseModal(h){
  editingHouseId = h ? h.id : null;
  $('houseModalTitle').textContent = h ? 'বাসা এডিট করুন' : 'নতুন বাসা';
  $('houseNameInput').value = h ? (h.name || '') : '';
  $('houseAddrInput').value = h ? (h.address || '') : '';
  $('houseErr').textContent = '';
  flatRows.innerHTML = '';
  const fl = houseFlats(h);
  if(fl.length) fl.forEach(f => addFlatRow(f)); else addFlatRow();
  body.classList.add('house-open');
  setTimeout(() => $('houseNameInput').focus(), 80);
}
$('addHouseBtn').addEventListener('click', () => openHouseModal(null));
$('closeHouse').addEventListener('click', () => body.classList.remove('house-open'));
$('houseOverlay').addEventListener('click', e => { if(e.target.id === 'houseOverlay') body.classList.remove('house-open'); });
$('houseSaveBtn').addEventListener('click', async () => {
  const name = $('houseNameInput').value.trim();
  const address = $('houseAddrInput').value.trim();
  const err = $('houseErr');
  if(!name){ err.textContent = 'বাসার নাম দিতে হবে।'; return; }
  if(!address){ err.textContent = 'ঠিকানা দিতে হবে।'; return; }
  const fr = collectFlats();
  if(fr.error){ err.textContent = fr.error; return; }
  const btn = $('houseSaveBtn');
  btn.disabled = true;
  try{
    if(editingHouseId){
      await updateDoc(doc(db, 'houses', editingHouseId), { name, address, flats: fr.flats });
    } else {
      await addDoc(collection(db, 'houses'), { name, address, flats: fr.flats, createdAt: Date.now(), tenantCount: 0, nextSerial: 1 });
    }
    body.classList.remove('house-open');
    showToast('বাসা সংরক্ষণ করা হয়েছে।');
  }catch(ex){
    console.error(ex);
    err.textContent = 'সংরক্ষণ করা যায়নি: ' + fbErr(ex);
  }finally{ btn.disabled = false; }
});

async function delStorage(){ /* Storage ব্যবহার হয় না — ছবি Firestore ডকুমেন্টের ভেতরেই থাকে */ }
async function deleteHouse(h){
  if(!confirm('"' + h.name + '" বাসা এবং এর ' + toBn(h.tenantCount || 0) + ' জন ভাড়াটিয়ার সব তথ্য ও ছবি স্থায়ীভাবে মুছে যাবে। এগিয়ে যাবেন?')) return;
  try{
    const snap = await getDocs(collection(db, 'houses', h.id, 'tenants'));
    const docs = snap.docs;
    for(const d of docs){
      const t = d.data();
      await delStorage(t.photoPath);
      await delStorage(t.signaturePath);
    }
    for(let i = 0; i < docs.length; i += 400){
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'houses', h.id));
    showToast('বাসাটি মুছে ফেলা হয়েছে।');
  }catch(ex){
    console.error(ex);
    alert('বাসা মুছতে সমস্যা হয়েছে: ' + fbErr(ex));
  }
}

/* ================= HOUSE PAGE (tenants, serial wise) ================= */
async function showHouse(id){
  showView('viewHouse');
  currentHouseId = id;
  $('tenantList').innerHTML = '<div class="empty-state">☁️ লোড হচ্ছে...</div>';
  await housesReady;
  if(currentHouseId !== id) return;
  if(!getHouse(id)){ showToast('বাসাটি খুঁজে পাওয়া যায়নি।'); go('#/houses'); return; }
  renderHouseHeader();
  stopTenantsListener();
  const q = query(collection(db, 'houses', id, 'tenants'), orderBy('serial', 'asc'));
  tenantsUnsub = onSnapshot(q, snap => {
    if(currentHouseId !== id) return;
    tenants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    tenantsLoadedFor = id;
    renderHouseHeader();
    renderTenantList();
    const h = getHouse(id);
    if(h && !snap.metadata.fromCache && !snap.metadata.hasPendingWrites && h.tenantCount !== tenants.length){
      updateDoc(doc(db, 'houses', id), { tenantCount: tenants.length }).catch(() => {});
    }
  }, err => {
    console.error(err);
    $('tenantList').innerHTML = '<div class="empty-state">তালিকা আনতে সমস্যা: ' + esc(fbErr(err)) + '</div>';
  });
}
function renderHouseHeader(){
  const h = getHouse(currentHouseId);
  if(!h) return;
  $('hName').textContent = 'বাসা: ' + h.name;
  $('hAddr').textContent = h.address || '';
  $('hCount').textContent = toBn(tenantsUnsub ? tenants.length : (h.tenantCount || 0));
  renderFlatsPanel();
}
function renderFlatsPanel(){
  const h = getHouse(currentHouseId), panel = $('flatsPanel');
  const flats = houseFlats(h);
  if(!h || !flats.length){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const loaded = tenantsLoadedFor === currentHouseId;
  $('flatsBody').innerHTML = flats.map(f => {
    const label = flatLabel(f);
    const occ = tenants.filter(t => t.data && t.data.flat === label).map(t => esc(t.label || 'নামহীন'));
    const who = !loaded ? '…' : (occ.length ? occ.join(', ') : '<span class="tag-vacant">খালি</span>');
    return '<tr><td><b>' + esc(f.floor) + '</b></td><td>' + esc(f.side || '—') + '</td><td>' + (f.rent != null ? fmtMoney(f.rent) : '—') + '</td><td>' + (f.gas != null ? fmtMoney(f.gas) : '—') + '</td><td>' + who + '</td></tr>';
  }).join('');
}
function renderTenantList(){
  const wrap = $('tenantList');
  if(!tenants.length){
    wrap.innerHTML = '<div class="empty-state">এই বাসায় এখনও কোনো ভাড়াটিয়া নেই।<br>"নতুন ভাড়াটিয়ার ফর্ম" বাটনে ক্লিক করে ফর্ম পূরণ করুন।</div>';
    return;
  }
  wrap.innerHTML = '';
  tenants.forEach((item, idx) => {
    const d = new Date(item.savedAt);
    const dateStr = isNaN(d) ? '' : d.toLocaleDateString('bn-BD', { year:'numeric', month:'long', day:'numeric' }) + ' ' + d.toLocaleTimeString('bn-BD', { hour:'2-digit', minute:'2-digit' });
    const mobile = item.data && item.data.mobile ? ' • ' + item.data.mobile : '';
    const card = document.createElement('div');
    card.className = 'saved-card';
    card.innerHTML =
      '<div class="info">' + (item.photoUrl ? '<div class="avatar has-photo"><img src="' + esc(item.photoUrl) + '" alt="ছবি"></div>' : '<div class="avatar">' + toBn(idx + 1) + '</div>') + '<div><b>' + esc(item.label || 'নামহীন ভাড়াটিয়া') + '</b>' +
      '<small>সিরিয়াল ' + toBn(idx + 1) + esc(mobile) + ' • ' + esc(dateStr) + '</small></div></div>' +
      '<div class="btnbar">' +
        '<button class="btn btn-primary btn-sm" data-act="view"><svg class="ic"><use href="#i-eye"/></svg>দেখুন</button>' +
        '<button class="btn btn-outline btn-sm" data-act="edit"><svg class="ic"><use href="#i-edit"/></svg>আপডেট</button>' +
        '<button class="btn btn-outline btn-sm" data-act="print"><svg class="ic"><use href="#i-print"/></svg>প্রিন্ট</button>' +
        '<button class="btn btn-whatsapp btn-sm" data-act="share"><svg class="ic"><use href="#i-send"/></svg>শেয়ার</button>' +
        '<button class="btn btn-danger btn-sm" data-act="delete"><svg class="ic"><use href="#i-trash"/></svg>মুছুন</button>' +
      '</div>';
    card.querySelector('[data-act=view]').addEventListener('click', () => openPreviewForItem(item));
    card.querySelector('[data-act=edit]').addEventListener('click', () => go('#/house/' + currentHouseId + '/edit/' + item.id));
    card.querySelector('[data-act=print]').addEventListener('click', async () => { await openPreviewForItem(item); printFromOverlay(); });
    card.querySelector('[data-act=share]').addEventListener('click', () => openPreviewForItem(item));
    card.querySelector('[data-act=delete]').addEventListener('click', () => deleteTenant(item));
    wrap.appendChild(card);
  });
}
async function deleteTenant(item){
  if(!confirm('"' + (item.label || 'এই ভাড়াটিয়া') + '" এর ফর্মটি মুছে ফেলতে চান?')) return;
  try{
    const batch = writeBatch(db);
    batch.delete(doc(db, 'houses', currentHouseId, 'tenants', item.id));
    batch.update(doc(db, 'houses', currentHouseId), { tenantCount: increment(-1) });
    await batch.commit();
    await delStorage(item.photoPath);
    await delStorage(item.signaturePath);
    showToast('ফর্মটি মুছে ফেলা হয়েছে।');
  }catch(ex){
    console.error(ex);
    alert('মুছতে সমস্যা হয়েছে: ' + fbErr(ex));
  }
}
$('backHomeBtn').addEventListener('click', () => go('#/houses'));
$('newTenantBtn').addEventListener('click', () => go('#/house/' + currentHouseId + '/new'));
$('backToHouseBtn').addEventListener('click', () => go(currentHouseId ? '#/house/' + currentHouseId : '#/houses'));

/* ================= IMAGE HELPERS ================= */
function compressDataUrl(dataUrl, maxDim, mime, quality){
  return new Promise(resolve => {
    if(!dataUrl){ resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if(mime === 'image/jpeg'){ ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL(mime, quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
// Firebase Storage URL → data URL (so html2canvas / canvas don't get tainted). Needs bucket CORS (see SETUP.md).
async function toDataUrlSafe(url){
  if(!url) return null;
  if(url.startsWith('data:')) return url;
  try{
    const res = await fetch(url, { mode: 'cors' });
    if(!res.ok) throw new Error('http ' + res.status);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }catch(e){
    console.warn('image fetch failed (CORS?)', e);
    return url;
  }
}
// ছবি/স্বাক্ষর ছোট করে data URL হিসেবে Firestore-এ রাখা হয় (Firestore ডকুমেন্ট সীমা ১MB, তাই সাইজ ছোট রাখা হয়েছে)
async function syncImage(state, kind){
  if(state.newDataUrl){
    const isSig = kind === 'signature';
    const small = isSig
      ? await compressDataUrl(state.newDataUrl, 450, 'image/png', 0.8)
      : state.newDataUrl; // ছবি আগেই পাসপোর্ট মাপে (৩১৫×৪০৫) কেটে ছোট করা হয়েছে
    return { url: small, path: null, stale: null };
  }
  if(state.removed) return { url: null, path: null, stale: null };
  return { url: state.url || null, path: null, stale: null };
}

// যেকোনো ছবিকে পাসপোর্ট অনুপাতে (৭:৯) ফ্রেমে বসিয়ে কেটে নেয়; মুখ সাধারণত উপরের দিকে থাকে, তাই উপরের দিক একটু বেশি রাখা হয়
function cropToPassport(dataUrl, outW, outH, quality){
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const target = outW / outH;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if(sw / sh > target){ sw = sh * target; sx = (img.width - sw) / 2; }
      else { sh = sw / target; sy = (img.height - sh) * 0.25; }
      const c = document.createElement('canvas'); c.width = outW; c.height = outH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ================= FAMILY ROWS ================= */
const famRows = $('famRows');
function addFamRow(vals){
  const row = document.createElement('div');
  row.className = 'fam-row';
  row.innerHTML =
    '<input type="text" placeholder="নাম" data-f="name">' +
    '<input type="text" placeholder="বয়স" data-f="age" inputmode="numeric">' +
    '<input type="text" placeholder="সম্পর্ক" data-f="relation">' +
    '<input type="text" placeholder="পেশা" data-f="occ">' +
    '<input type="tel" placeholder="মোবাইল" data-f="mob" inputmode="tel">' +
    '<button type="button" class="fam-remove" title="মুছে ফেলুন" aria-label="মুছে ফেলুন">×</button>';
  famRows.appendChild(row);
  if(vals){
    row.querySelector('[data-f=name]').value = vals.name || '';
    row.querySelector('[data-f=age]').value = vals.age || '';
    row.querySelector('[data-f=relation]').value = vals.relation || '';
    row.querySelector('[data-f=occ]').value = vals.occ || '';
    row.querySelector('[data-f=mob]').value = vals.mob || '';
  }
  row.querySelector('.fam-remove').addEventListener('click', () => { row.remove(); onLiveInput(); });
}
function getFamData(){
  return Array.from(famRows.querySelectorAll('.fam-row')).map(row => ({
    name: row.querySelector('[data-f=name]').value,
    age: row.querySelector('[data-f=age]').value,
    relation: row.querySelector('[data-f=relation]').value,
    occ: row.querySelector('[data-f=occ]').value,
    mob: row.querySelector('[data-f=mob]').value,
  }));
}
$('addFamRow').addEventListener('click', () => { addFamRow(); onLiveInput(); });

/* ================= PHOTO ================= */
const photoDrop = $('photoDrop');
const photoInput = $('photoInput');
function paintPhotoDrop(){
  photoDrop.innerHTML = photoState.display
    ? '<img src="' + esc(photoState.display) + '" alt="ছবি"><span>ছবি পরিবর্তন করুন</span>'
    : PHOTO_HINT_HTML;
}
photoDrop.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const small = await cropToPassport(e.target.result, 315, 405, 0.85);
    photoState.newDataUrl = small;
    photoState.display = small;
    photoState.removed = false;
    paintPhotoDrop();
    onLiveInput();
  };
  reader.readAsDataURL(file);
  photoInput.value = '';
});

/* ================= SIGNATURE PAD ================= */
const sigCanvas = $('sigCanvas');
const sigCtx = sigCanvas.getContext('2d');
let drawing = false, lastX = 0, lastY = 0;
function sigPos(e){
  const rect = sigCanvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (sigCanvas.width / rect.width), y: (e.clientY - rect.top) * (sigCanvas.height / rect.height) };
}
sigCanvas.addEventListener('pointerdown', e => {
  drawing = true;
  sigCanvas.setPointerCapture(e.pointerId);
  const p = sigPos(e); lastX = p.x; lastY = p.y;
});
sigCanvas.addEventListener('pointermove', e => {
  if(!drawing) return;
  const p = sigPos(e);
  sigCtx.strokeStyle = '#1a1a1a'; sigCtx.lineWidth = 2.4; sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
  sigCtx.beginPath(); sigCtx.moveTo(lastX, lastY); sigCtx.lineTo(p.x, p.y); sigCtx.stroke();
  lastX = p.x; lastY = p.y;
});
function endStroke(){ if(drawing){ drawing = false; saveSignatureFromCanvas(); } }
sigCanvas.addEventListener('pointerup', endStroke);
sigCanvas.addEventListener('pointerleave', endStroke);
sigCanvas.addEventListener('pointercancel', endStroke);

function saveSignatureFromCanvas(){
  try{
    const url = sigCanvas.toDataURL('image/png');
    sigState.newDataUrl = url;
    sigState.display = url;
    sigState.removed = false;
    onLiveInput();
  }catch(e){
    console.error(e);
    showToast('স্বাক্ষর সংরক্ষণ করা যায়নি (ছবির CORS সেটআপ চেক করুন)।');
  }
}
$('sigClearBtn').addEventListener('click', () => {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigState.newDataUrl = null;
  sigState.display = null;
  sigState.removed = true;
  onLiveInput();
});
function handleSigImageFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
      const scale = Math.min(sigCanvas.width / img.width, sigCanvas.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      sigCtx.drawImage(img, (sigCanvas.width - w) / 2, (sigCanvas.height - h) / 2, w, h);
      saveSignatureFromCanvas();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
const sigCameraInput = $('sigCameraInput');
const sigGalleryInput = $('sigGalleryInput');
$('sigCameraBtn').addEventListener('click', () => sigCameraInput.click());
$('sigGalleryBtn').addEventListener('click', () => sigGalleryInput.click());
sigCameraInput.addEventListener('change', () => { handleSigImageFile(sigCameraInput.files[0]); sigCameraInput.value = ''; });
sigGalleryInput.addEventListener('change', () => { handleSigImageFile(sigGalleryInput.files[0]); sigGalleryInput.value = ''; });
function loadSignatureIntoCanvas(dataUrl){
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  if(!dataUrl) return;
  const img = new Image();
  if(/^https?:/i.test(dataUrl)) img.crossOrigin = 'anonymous';
  img.onload = () => {
    const scale = Math.min(sigCanvas.width / img.width, sigCanvas.height / img.height, 1);
    const w = img.width * scale, h = img.height * scale;
    sigCtx.drawImage(img, (sigCanvas.width - w) / 2, (sigCanvas.height - h) / 2, w, h);
  };
  img.src = dataUrl;
}

/* ================= ADDRESS COMPOSITION ================= */
function composePermAddr(data){
  const parts = [];
  if(data.permHolding) parts.push('বাসা/হোল্ডিংঃ ' + data.permHolding);
  if(data.permVillageRoad) parts.push('গ্রাম/রাস্তাঃ ' + data.permVillageRoad);
  if(data.permPostOffice) parts.push('ডাকঘরঃ ' + data.permPostOffice);
  if(data.permThana) parts.push('থানাঃ ' + data.permThana);
  if(data.permDistrict) parts.push('জেলাঃ ' + data.permDistrict);
  return parts.join(', ');
}

/* ================= FORM DATA ================= */
function collectData(){
  const data = {};
  fields.forEach(f => { data[f.dataset.key] = f.value; });
  data.family = getFamData();
  return data;
}
function collectPreviewData(){
  return Object.assign(collectData(), { photo: photoState.display, signature: sigState.display });
}
function fillFields(data){
  form.reset();
  if(data && data.flat) ensureFlatOption(data.flat);
  fields.forEach(f => { if(data && data[f.dataset.key] !== undefined) f.value = data[f.dataset.key]; });
  famRows.innerHTML = '';
  if(data && data.family && data.family.length) data.family.forEach(r => addFamRow(r));
  else { addFamRow(); addFamRow(); addFamRow(); }
  updateFlatHint();
}
function applyImageStates(){
  paintPhotoDrop();
  loadSignatureIntoCanvas(sigState.display);
}
function blankForm(){
  fillFields(null);
  photoState = newImgState();
  sigState = newImgState();
  applyImageStates();
}
async function fillFromTenant(t){
  fillFields(t.data || {});
  const [pd, sd] = await Promise.all([toDataUrlSafe(t.photoUrl), toDataUrlSafe(t.signatureUrl)]);
  photoState = { display: pd, url: t.photoUrl || null, path: t.photoPath || null, newDataUrl: null, removed: false };
  sigState = { display: sd, url: t.signatureUrl || null, path: t.signaturePath || null, newDataUrl: null, removed: false };
  applyImageStates();
}

/* ================= PREVIEW PAINTING ================= */
function renderVal(id, text, isDate){
  const el = $('p_' + id);
  if(!el) return;
  let display = text || '';
  if(isDate && text){
    const d = new Date(text);
    if(!isNaN(d)) display = d.toLocaleDateString('bn-BD', { year:'numeric', month:'long', day:'numeric' });
  }
  if(display){ el.textContent = display; el.classList.add('filled'); el.classList.remove('empty'); }
  else { el.textContent = '\u00A0'.repeat(20); el.classList.add('empty'); el.classList.remove('filled'); }
}
function renderFamTableFromData(arr){
  const tb = $('p_famBody');
  tb.innerHTML = '';
  (arr || []).forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + toBn(i + 1) + '।</td><td>' + (esc(r.name) || '\u00A0') + '</td><td>' + (esc(r.age) || '\u00A0') + '</td><td>' + (esc(r.relation) || '\u00A0') + '</td><td>' + (esc(r.occ) || '\u00A0') + '</td><td>' + (esc(r.mob) || '\u00A0') + '</td>';
    tb.appendChild(tr);
  });
}
function setImgIn(el, src, alt, fallbackHtml){
  el.innerHTML = '';
  if(!src){ el.innerHTML = fallbackHtml || ''; return; }
  const img = new Image();
  if(/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
  img.alt = alt;
  img.src = src;
  el.appendChild(img);
}
function paintPreview(data){
  data = data || {};
  FIELD_KEYS.forEach(key => renderVal(key, data[key], DATE_KEYS.has(key)));
  renderVal('permAddr', composePermAddr(data), false);
  const dateEl = $('p_formDate');
  if(data.formDate){
    const d = new Date(data.formDate);
    dateEl.textContent = 'তারিখ: ' + (isNaN(d) ? data.formDate : d.toLocaleDateString('bn-BD', { year:'numeric', month:'long', day:'numeric' }));
  } else { dateEl.textContent = 'তারিখ'; }
  renderFamTableFromData(data.family);
  setImgIn($('previewPhotoBox'), data.photo, 'ছবি', 'এক কপি পাসপোর্ট<br>সাইজ ছবি');
  setImgIn($('p_signatureImgWrap'), data.signature, 'স্বাক্ষর', '');
}

/* ================= DRAFT (নতুন ফর্ম, রিলোডে হারিয়ে যাওয়া ঠেকাতে) ================= */
function saveDraft(){
  if(editingTenant || activeView !== 'viewForm') return;
  try{ sessionStorage.setItem('tf_draft_new', JSON.stringify({ houseId: currentHouseId, data: collectData() })); }catch(e){}
}
function clearDraft(){ try{ sessionStorage.removeItem('tf_draft_new'); }catch(e){} }

function onLiveInput(){
  viewingSavedItem = null;
  saveDraft();
  updateContextLabel();
}
form.addEventListener('input', onLiveInput);
form.addEventListener('change', onLiveInput);

/* ================= FORM VIEW (সাইডবারের আলাদা সেকশন: নতুন ভাড়াটিয়া ফর্ম) ================= */
function populateHouseSelect(selectedId, locked){
  const sel = $('formHouse');
  sel.innerHTML = '<option value="">— বাসা নির্বাচন করুন —</option>' +
    houses.map(h => '<option value="' + esc(h.id) + '">' + esc(h.name) + '</option>').join('');
  sel.value = selectedId || '';
  sel.disabled = !!locked;
}
function ensureFlatOption(val){
  const sel = $('flatSelect');
  if(!val) return;
  if(!Array.from(sel.options).some(o => o.value === val)){
    const o = document.createElement('option');
    o.value = val; o.textContent = val;
    sel.appendChild(o);
  }
}
// নির্বাচিত বাসার তথ্য থেকে ফ্ল্যাট/তলার ড্রপডাউন বানায়
function populateFlatSelect(keep){
  const sel = $('flatSelect');
  const h = getHouse(currentHouseId);
  const flats = houseFlats(h);
  let ph = 'আগে বাসা নির্বাচন করুন';
  if(h) ph = flats.length ? '— ফ্ল্যাট/তলা নির্বাচন করুন —' : 'এই বাসায় ফ্ল্যাটের তথ্য নেই (বাসা সমূহ থেকে যোগ করুন)';
  sel.innerHTML = '<option value="">' + esc(ph) + '</option>' +
    flats.map(f => { const l = flatLabel(f); return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('');
  if(keep){ ensureFlatOption(keep); sel.value = keep; }
}
function updateFlatHint(){
  const el = $('flatHint');
  if(!el) return;
  const v = $('flatSelect').value;
  if(!v){ el.style.display = 'none'; return; }
  const f = houseFlats(getHouse(currentHouseId)).find(x => flatLabel(x) === v);
  el.style.display = 'block';
  el.innerHTML = f
    ? 'বাসা ভাড়া: <b>' + (f.rent != null ? fmtMoney(f.rent) : '—') + '</b> &nbsp;•&nbsp; গ্যাস বিল: <b>' + (f.gas != null ? fmtMoney(f.gas) : '—') + '</b>'
    : 'এই ফ্ল্যাটের তথ্য বাসার তালিকায় পাওয়া যায়নি।';
}
function refreshFormHouses(){
  if(saving) return;
  populateHouseSelect(currentHouseId, !!editingTenant || /\/edit\//.test(location.hash));
  populateFlatSelect($('flatSelect').value);
  updateFlatHint();
  updateFormBanner();
}
$('formHouse').addEventListener('change', e => {
  if(editingTenant) return;
  currentHouseId = e.target.value || null;
  populateFlatSelect('');
  updateFlatHint();
  updateFormBanner();
  updateHeaderTitle();
  saveDraft();
});
$('flatSelect').addEventListener('change', updateFlatHint);

async function openForm(houseId, tenantId){
  showView('viewForm');
  editingTenant = null;
  viewingSavedItem = null;
  currentHouseId = houseId || null;
  await housesReady;
  if(activeView !== 'viewForm') return;
  if(houseId && !getHouse(houseId)){ showToast('বাসাটি খুঁজে পাওয়া যায়নি।'); go('#/houses'); return; }

  if(tenantId){
    $('editBannerTxt').textContent = '⏳ লোড হচ্ছে...';
    populateHouseSelect(houseId, true);
    populateFlatSelect('');
    try{
      const snap = await getDoc(doc(db, 'houses', houseId, 'tenants', tenantId));
      if(activeView !== 'viewForm' || currentHouseId !== houseId) return;
      if(!snap.exists()){ showToast('ফর্মটি খুঁজে পাওয়া যায়নি।'); go('#/house/' + houseId); return; }
      editingTenant = { id: snap.id, ...snap.data() };
      await fillFromTenant(editingTenant);
    }catch(ex){
      console.error(ex);
      showToast('ফর্ম লোড করা যায়নি: ' + fbErr(ex));
      go('#/house/' + houseId);
      return;
    }
  } else {
    blankForm();
    let draft = null;
    try{ draft = JSON.parse(sessionStorage.getItem('tf_draft_new') || 'null'); }catch(e){}
    let hid = houseId || (draft && draft.houseId) || null;
    if(hid && !getHouse(hid)) hid = null;
    currentHouseId = hid;
    populateHouseSelect(hid, false);
    populateFlatSelect('');
    if(draft && draft.data && (!houseId || draft.houseId === houseId)) fillFields(draft.data);
    updateFlatHint();
  }
  updateFormBanner();
  updateHeaderTitle();
  window.scrollTo(0, 0);
}
function updateFormBanner(){
  const house = getHouse(currentHouseId);
  const hn = house ? house.name : '';
  if(editingTenant){
    $('editBannerTxt').textContent = '✏️ "' + (editingTenant.label || '') + '" এর ফর্ম আপডেট করছেন — বাসা: ' + hn;
    $('saveBtnLabel').textContent = 'আপডেট সংরক্ষণ করুন';
  } else {
    $('editBannerTxt').textContent = '🏠 নতুন ভাড়াটিয়ার ফর্ম' + (hn ? ' — বাসা: ' + hn : ' — প্রথমে বাসা নির্বাচন করুন');
    $('saveBtnLabel').textContent = 'সংরক্ষণ করুন';
  }
}

$('saveFormBtn').addEventListener('click', async () => {
  if(saving) return;
  if(!currentHouseId){ alert('আগে "বাসা নির্বাচন" থেকে বাসা বেছে নিন।'); return; }
  const btn = $('saveFormBtn');
  const original = btn.innerHTML;
  const data = collectData();
  const label = (data.name || '').trim() || 'নামহীন ভাড়াটিয়া';
  saving = true;
  btn.disabled = true;
  btn.innerHTML = '☁️ সংরক্ষণ হচ্ছে...';
  try{
    const houseRef = doc(db, 'houses', currentHouseId);
    const tenantsCol = collection(db, 'houses', currentHouseId, 'tenants');
    const tRef = editingTenant ? doc(tenantsCol, editingTenant.id) : doc(tenantsCol);
    const photo = await syncImage(photoState, 'photo', tRef.id);
    const sig = await syncImage(sigState, 'signature', tRef.id);
    const imgBytes = ((photo.url || '').length + (sig.url || '').length);
    if(imgBytes > 800000) throw new Error('ছবি/স্বাক্ষরের সাইজ বেশি — ছোট ছবি ব্যবহার করুন।');
    const payload = {
      label, data,
      photoUrl: photo.url, photoPath: null,
      signatureUrl: sig.url, signaturePath: null,
      savedAt: new Date().toISOString()
    };
    if(editingTenant){
      await updateDoc(tRef, payload);
    } else {
      await runTransaction(db, async tx => {
        const hs = await tx.get(houseRef);
        if(!hs.exists()) throw new Error('বাসাটি পাওয়া যায়নি।');
        const hd = hs.data();
        const serial = hd.nextSerial || ((hd.tenantCount || 0) + 1);
        tx.set(tRef, Object.assign({}, payload, { serial, createdAt: Date.now() }));
        tx.update(houseRef, { nextSerial: serial + 1, tenantCount: increment(1) });
      });
    }
    await delStorage(photo.stale);
    await delStorage(sig.stale);
    clearDraft();
    showToast(editingTenant ? 'ফর্ম আপডেট করা হয়েছে।' : 'ফর্মটি সংরক্ষণ করা হয়েছে।');
    go('#/house/' + currentHouseId);
  }catch(ex){
    console.error(ex);
    alert('সংরক্ষণ করা যায়নি: ' + fbErr(ex));
  }finally{
    saving = false;
    btn.disabled = false;
    btn.innerHTML = original;
  }
});

$('resetBtn').addEventListener('click', async () => {
  if(editingTenant){
    if(!confirm('আপনার করা পরিবর্তনগুলো বাদ দিয়ে সংরক্ষিত তথ্যে ফিরে যেতে চান?')) return;
    await fillFromTenant(editingTenant);
  } else {
    if(!confirm('বর্তমান ফর্মের সব তথ্য মুছে ফেলতে চান?')) return;
    clearDraft();
    blankForm();
    populateHouseSelect(currentHouseId, false);
    populateFlatSelect('');
  }
  onLiveInput();
});

/* ================= PREVIEW OVERLAY ================= */
function updateContextLabel(){
  const el = $('previewContextLabel');
  const editBtn = $('editFromPreviewBtn');
  if(viewingSavedItem){
    el.textContent = 'সংরক্ষিত ফর্ম দেখছেনঃ ' + (viewingSavedItem.label || '');
    editBtn.style.display = 'inline-flex';
  } else {
    el.textContent = 'বর্তমান খসড়া দেখাচ্ছে';
    editBtn.style.display = 'none';
  }
}
function openPreviewLive(){
  viewingSavedItem = null;
  paintPreview(collectPreviewData());
  updateContextLabel();
  body.classList.add('preview-open');
  resetPaperScale();
}
async function openPreviewForItem(item){
  const [photo, signature] = await Promise.all([toDataUrlSafe(item.photoUrl), toDataUrlSafe(item.signatureUrl)]);
  viewingSavedItem = item;
  paintPreview(Object.assign({}, item.data, { photo, signature }));
  updateContextLabel();
  body.classList.add('preview-open');
  resetPaperScale();
}
function closePreview(){ body.classList.remove('preview-open'); resetPaperScale(); }
$('previewBtn').addEventListener('click', openPreviewLive);
$('closePreview').addEventListener('click', closePreview);
$('editFromPreviewBtn').addEventListener('click', () => {
  if(!viewingSavedItem) return;
  const id = viewingSavedItem.id;
  closePreview();
  go('#/house/' + currentHouseId + '/edit/' + id);
});
$('previewOverlay').addEventListener('click', e => { if(e.target.id === 'previewOverlay') closePreview(); });
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){ closePreview(); body.classList.remove('house-open'); }
});

/* ================= PRINT: FILL THE WHOLE PAGE (A4 / LEGAL), ONE PAGE ONLY ================= */
const PAGE_SIZES = { a4:{ w:210, h:297 }, legal:{ w:215.9, h:355.6 } };
const MM_TO_PX = 3.7795275591;
function mm2px(mm){ return mm * MM_TO_PX; }
function applyPageSizeStyle(key){
  let styleTag = $('dynPageSize');
  if(!styleTag){ styleTag = document.createElement('style'); styleTag.id = 'dynPageSize'; document.head.appendChild(styleTag); }
  styleTag.textContent = '@page { size: ' + (key === 'legal' ? 'legal' : 'A4') + '; margin:0; }';
}
function resetPaperScale(){ $('paper').style.setProperty('--s', 1); }
// Grows/shrinks real font-size, spacing and image sizes so the document fills the chosen page on exactly one page.
function fitPaperToPage(){
  const key = $('paperSizeSelect').value;
  applyPageSizeStyle(key);
  const page = PAGE_SIZES[key] || PAGE_SIZES.a4;
  const availableHeightPx = mm2px(page.h) - mm2px(28);
  const paperEl = $('paper');
  let s = 1;
  paperEl.style.setProperty('--s', s);
  for(let iter = 0; iter < 8; iter++){
    const h = paperEl.scrollHeight;
    if(h <= 0) break;
    let next = s * (availableHeightPx / h);
    next = Math.max(0.45, Math.min(next, 1.9));
    if(Math.abs(next - s) < 0.006){ s = next; break; }
    s = next;
    paperEl.style.setProperty('--s', s);
  }
  paperEl.style.setProperty('--s', s);
}
$('paperSizeSelect').addEventListener('change', fitPaperToPage);
function printFromOverlay(){ fitPaperToPage(); setTimeout(() => window.print(), 70); }
$('printBtn').addEventListener('click', printFromOverlay);
window.addEventListener('beforeprint', fitPaperToPage);
window.addEventListener('afterprint', resetPaperScale);

/* ================= SHARE AS JPG / PDF (WhatsApp via Web Share API) ================= */
async function renderPaperCanvas(){
  fitPaperToPage();
  await new Promise(r => setTimeout(r, 60));
  return window.html2canvas($('paper'), { scale: 2, backgroundColor: '#FBF8F1', useCORS: true });
}
async function buildJpgBlob(){
  const canvas = await renderPaperCanvas();
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92));
}
async function buildPdfBlob(){
  const canvas = await renderPaperCanvas();
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const key = $('paperSizeSelect').value;
  const size = key === 'legal' ? [215.9, 355.6] : [210, 297];
  const pdf = new window.jspdf.jsPDF({ unit:'mm', format:size });
  const pageW = size[0], pageH = size[1];
  const ratio = canvas.width / canvas.height;
  let w = pageW, h = w / ratio;
  if(h > pageH){ h = pageH; w = h * ratio; }
  pdf.addImage(imgData, 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h);
  return pdf.output('blob');
}
async function shareFile(blob, filename, mime, btnEl){
  const originalHtml = btnEl ? btnEl.innerHTML : null;
  if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '⏳ তৈরি হচ্ছে...'; }
  try{
    const file = new File([blob], filename, { type: mime });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title:'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র', text:'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      alert('ফাইলটি ডাউনলোড হয়েছে। এখন WhatsApp Web/অ্যাপ খুলে চ্যাটে ফাইলটি অ্যাটাচ করে পাঠান।');
      window.open('https://web.whatsapp.com/', '_blank');
    }
  }catch(err){
    if(err && err.name !== 'AbortError'){
      console.error(err);
      alert('ফাইল তৈরি/শেয়ার করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    }
  }finally{
    if(btnEl){ btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
  }
}
function fileNameBase(){
  const label = viewingSavedItem ? viewingSavedItem.label : ($('previewContextLabel') ? 'tenant-form' : 'tenant-form');
  return String(label || 'tenant-form').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'tenant-form';
}
$('whatsappJpgBtn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try{
    const blob = await buildJpgBlob();
    btn.disabled = false;
    shareFile(blob, fileNameBase() + '.jpg', 'image/jpeg', btn);
  }catch(err){ console.error(err); btn.disabled = false; alert('ছবি তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); }
});
$('whatsappPdfBtn').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try{
    const blob = await buildPdfBlob();
    btn.disabled = false;
    shareFile(blob, fileNameBase() + '.pdf', 'application/pdf', btn);
  }catch(err){ console.error(err); btn.disabled = false; alert('PDF তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); }
});


/* ================= SETTINGS PAGE HANDLERS ================= */
$('setLogoPick').addEventListener('click', () => $('setLogoInput').click());
$('setLogoInput').addEventListener('change', () => {
  const f = $('setLogoInput').files[0];
  if(!f) return;
  const r = new FileReader();
  r.onload = async e => {
    logoDraft = await compressDataUrl(e.target.result, 260, 'image/png', 0.92);
    paintLogoPrev();
  };
  r.readAsDataURL(f);
  $('setLogoInput').value = '';
});
$('setLogoRemove').addEventListener('click', () => { logoDraft = null; paintLogoPrev(); });
$('setSaveBtn').addEventListener('click', async () => {
  const msg = $('setMsg');
  const siteName = $('setSiteName').value.trim();
  if(!siteName){ msg.textContent = 'ওয়েবসাইটের নাম দিতে হবে।'; return; }
  const logo = logoDraft === undefined ? (settings.logo || null) : logoDraft;
  if(logo && logo.length > 600000){ msg.textContent = 'লোগোর সাইজ বেশি — ছোট ছবি ব্যবহার করুন।'; return; }
  const payload = {
    siteName,
    siteSubtitle: $('setSiteSub').value.trim(),
    docTitle: $('setDocTitle').value.trim() || siteName,
    adminName: $('setAdminName').value.trim() || DEFAULT_SETTINGS.adminName,
    paper: $('setPaper').value === 'legal' ? 'legal' : 'a4',
    logo
  };
  const btn = $('setSaveBtn'); btn.disabled = true; msg.textContent = '';
  try{
    await setDoc(doc(db, 'settings', 'app'), payload);
    settings = Object.assign({}, DEFAULT_SETTINGS, payload);
    applySettings(); fillSettingsForm();
    showToast('সেটিংস সংরক্ষণ করা হয়েছে।');
  }catch(ex){ console.error(ex); msg.textContent = 'সংরক্ষণ করা যায়নি: ' + fbErr(ex); }
  finally{ btn.disabled = false; }
});
$('setResetBtn').addEventListener('click', async () => {
  if(!confirm('সব সেটিংস ডিফল্টে ফিরিয়ে নিতে চান?')) return;
  try{
    await setDoc(doc(db, 'settings', 'app'), DEFAULT_SETTINGS);
    settings = Object.assign({}, DEFAULT_SETTINGS);
    applySettings(); fillSettingsForm();
    showToast('ডিফল্ট সেটিংস ফিরে এসেছে।');
  }catch(ex){ console.error(ex); $('setMsg').textContent = 'সংরক্ষণ করা যায়নি: ' + fbErr(ex); }
});

/* ================= INIT ================= */
blankForm();
paintPreview(collectPreviewData());
route();