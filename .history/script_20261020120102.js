<script>
(function(){
  const form = document.getElementById('theForm');
  const fields = form.querySelectorAll('[data-key]');
  const FIELD_KEYS = Array.from(fields).map(f=>f.dataset.key);
  const DATE_KEYS = new Set(['dob','formDate']);
  const DRAFT_KEY = 'tf_draft_v3';
  const SAVED_KEY = 'tf_saved_forms_v3';
  const body = document.body;

  let currentPhotoDataUrl = null;
  let currentSignatureDataUrl = null;
  let currentEditingId = null;
  let viewingSavedItem = null;

  const bnDigits = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  function toBn(n){ return String(n).split('').map(d => bnDigits[d] ?? d).join(''); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  const PHOTO_HINT_HTML = '<svg class="ic"><use href="#i-upload"/></svg><span id="photoHint">ছবি বাছাই করতে ক্লিক করুন</span>';

  /* ================= TOAST ================= */
  let toastTimer = null;
  function showToast(msg){
    const t = document.getElementById('toast');
    document.getElementById('toastText').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
  }

  /* ================= FAMILY ROWS (edit form) ================= */
  const famRows = document.getElementById('famRows');
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
    row.querySelectorAll('input').forEach(inp=>inp.addEventListener('input', onLiveInput));
    row.querySelector('.fam-remove').addEventListener('click', ()=>{ row.remove(); onLiveInput(); });
  }
  function getFamData(){
    return Array.from(famRows.querySelectorAll('.fam-row')).map(row=>({
      name: row.querySelector('[data-f=name]').value,
      age: row.querySelector('[data-f=age]').value,
      relation: row.querySelector('[data-f=relation]').value,
      occ: row.querySelector('[data-f=occ]').value,
      mob: row.querySelector('[data-f=mob]').value,
    }));
  }
  document.getElementById('addFamRow').addEventListener('click', ()=>{ addFamRow(); onLiveInput(); });

  /* ================= PHOTO (edit form) ================= */
  const photoDrop = document.getElementById('photoDrop');
  const photoInput = document.getElementById('photoInput');
  photoDrop.addEventListener('click', ()=>photoInput.click());
  photoInput.addEventListener('change', ()=>{
    const file = photoInput.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e=>{
      currentPhotoDataUrl = e.target.result;
      photoDrop.innerHTML = '<img src="'+currentPhotoDataUrl+'" alt="ছবি"><span>ছবি পরিবর্তন করুন</span>';
      onLiveInput();
    };
    reader.readAsDataURL(file);
  });

  /* ================= SIGNATURE PAD (draw + camera + gallery) ================= */
  const sigCanvas = document.getElementById('sigCanvas');
  const sigCtx = sigCanvas.getContext('2d');
  let drawing = false, lastX = 0, lastY = 0;
  function sigPos(e){
    const rect = sigCanvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (sigCanvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (sigCanvas.height / rect.height);
    return {x:cx, y:cy};
  }
  sigCanvas.addEventListener('pointerdown', e=>{
    drawing = true;
    sigCanvas.setPointerCapture(e.pointerId);
    const p = sigPos(e); lastX = p.x; lastY = p.y;
  });
  sigCanvas.addEventListener('pointermove', e=>{
    if(!drawing) return;
    const p = sigPos(e);
    sigCtx.strokeStyle = '#1a1a1a'; sigCtx.lineWidth = 2.4; sigCtx.lineCap = 'round'; sigCtx.lineJoin='round';
    sigCtx.beginPath(); sigCtx.moveTo(lastX,lastY); sigCtx.lineTo(p.x,p.y); sigCtx.stroke();
    lastX = p.x; lastY = p.y;
  });
  function endStroke(){ if(drawing){ drawing = false; saveSignatureFromCanvas(); } }
  sigCanvas.addEventListener('pointerup', endStroke);
  sigCanvas.addEventListener('pointerleave', endStroke);
  sigCanvas.addEventListener('pointercancel', endStroke);

  function saveSignatureFromCanvas(){
    currentSignatureDataUrl = sigCanvas.toDataURL('image/png');
    onLiveInput();
  }
  document.getElementById('sigClearBtn').addEventListener('click', ()=>{
    sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
    currentSignatureDataUrl = null;
    onLiveInput();
  });

  function handleSigImageFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
        const scale = Math.min(sigCanvas.width/img.width, sigCanvas.height/img.height);
        const w = img.width*scale, h = img.height*scale;
        const x = (sigCanvas.width-w)/2, y = (sigCanvas.height-h)/2;
        sigCtx.drawImage(img, x, y, w, h);
        saveSignatureFromCanvas();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  const sigCameraInput = document.getElementById('sigCameraInput');
  const sigGalleryInput = document.getElementById('sigGalleryInput');
  document.getElementById('sigCameraBtn').addEventListener('click', ()=>sigCameraInput.click());
  document.getElementById('sigGalleryBtn').addEventListener('click', ()=>sigGalleryInput.click());
  sigCameraInput.addEventListener('change', ()=>{ handleSigImageFile(sigCameraInput.files[0]); sigCameraInput.value=''; });
  sigGalleryInput.addEventListener('change', ()=>{ handleSigImageFile(sigGalleryInput.files[0]); sigGalleryInput.value=''; });

  function loadSignatureIntoCanvas(dataUrl){
    sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
    if(!dataUrl) return;
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(sigCanvas.width/img.width, sigCanvas.height/img.height, 1);
      const w = img.width*scale, h = img.height*scale;
      const x = (sigCanvas.width-w)/2, y = (sigCanvas.height-h)/2;
      sigCtx.drawImage(img, x, y, w, h);
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

  /* ================= DATA COLLECT / FILL ================= */
  function collectData(){
    const data = {};
    fields.forEach(f=>{ data[f.dataset.key] = f.value; });
    data.family = getFamData();
    data.photo = currentPhotoDataUrl;
    data.signature = currentSignatureDataUrl;
    return data;
  }

  function fillForm(data){
    viewingSavedItem = null;
    fields.forEach(f=>{ if(data[f.dataset.key] !== undefined) f.value = data[f.dataset.key]; });
    famRows.innerHTML = '';
    if(data.family && data.family.length){ data.family.forEach(r => addFamRow(r)); }
    else { addFamRow(); addFamRow(); addFamRow(); }

    currentPhotoDataUrl = data.photo || null;
    photoDrop.innerHTML = currentPhotoDataUrl
      ? '<img src="'+currentPhotoDataUrl+'" alt="ছবি"><span>ছবি পরিবর্তন করুন</span>'
      : PHOTO_HINT_HTML;

    currentSignatureDataUrl = data.signature || null;
    loadSignatureIntoCanvas(currentSignatureDataUrl);

    paintPreview(collectData());
    saveDraft();
  }

  function resetFormState(){
    form.reset();
    famRows.innerHTML = '';
    addFamRow(); addFamRow(); addFamRow();
    currentPhotoDataUrl = null;
    photoDrop.innerHTML = PHOTO_HINT_HTML;
    currentSignatureDataUrl = null;
    sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height);
    currentEditingId = null;
    viewingSavedItem = null;
    updateEditBanner();
    paintPreview(collectData());
    saveDraft();
  }

  /* ================= PREVIEW PAINTING ================= */
  function renderVal(id, text, isDate){
    const el = document.getElementById('p_' + id);
    if(!el) return;
    let display = text || '';
    if(isDate && text){
      const d = new Date(text);
      if(!isNaN(d)) display = d.toLocaleDateString('bn-BD', {year:'numeric', month:'long', day:'numeric'});
    }
    if(display){ el.textContent = display; el.classList.add('filled'); el.classList.remove('empty'); }
    else { el.textContent = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'; el.classList.add('empty'); el.classList.remove('filled'); }
  }
  function renderFamTableFromData(arr){
    const body_ = document.getElementById('p_famBody');
    body_.innerHTML = '';
    (arr||[]).forEach((r,i)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>'+toBn(i+1)+'।</td><td>'+(esc(r.name)||'\u00A0')+'</td><td>'+(esc(r.age)||'\u00A0')+'</td><td>'+(esc(r.relation)||'\u00A0')+'</td><td>'+(esc(r.occ)||'\u00A0')+'</td><td>'+(esc(r.mob)||'\u00A0')+'</td>';
      body_.appendChild(tr);
    });
  }
  function paintPreview(data){
    data = data || {};
    FIELD_KEYS.forEach(key=> renderVal(key, data[key], DATE_KEYS.has(key)));
    renderVal('permAddr', composePermAddr(data), false);
    const dateEl = document.getElementById('p_formDate');
    if(data.formDate){
      const d = new Date(data.formDate);
      dateEl.textContent = 'তারিখ: ' + (isNaN(d) ? data.formDate : d.toLocaleDateString('bn-BD',{year:'numeric',month:'long',day:'numeric'}));
    } else { dateEl.textContent = 'তারিখ'; }
    renderFamTableFromData(data.family);
    document.getElementById('previewPhotoBox').innerHTML = data.photo
      ? '<img src="'+data.photo+'" alt="ছবি">'
      : 'এক কপি পাসপোর্ট<br>সাইজ ছবি';
    document.getElementById('p_signatureImgWrap').innerHTML = data.signature
      ? '<img src="'+data.signature+'" alt="স্বাক্ষর">'
      : '';
  }

  function onLiveInput(){
    viewingSavedItem = null;
    paintPreview(collectData());
    saveDraft();
    updateContextLabel();
  }
  form.addEventListener('input', onLiveInput);
  form.addEventListener('change', onLiveInput);

  /* ================= DRAFT AUTOSAVE ================= */
  function saveDraft(){ try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(collectData())); }catch(e){} }
  function loadDraft(){
    try{
      const raw = localStorage.getItem(DRAFT_KEY);
      if(raw) fillForm(JSON.parse(raw));
    }catch(e){}
  }

  /* ================= SAVED FORMS (CRUD, local cache) ================= */
  function getSavedForms(){ try{ return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }catch(e){ return []; } }
  function setSavedForms(list){
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    document.getElementById('savedCount').textContent = toBn(list.length);
  }

  /* ================= OPTIONAL CROSS-DEVICE SYNC (Google Sheets Web App) ================= */
  const SYNC_URL_KEY = 'tf_sync_url';
  const SYNC_SECRET_KEY = 'tf_sync_secret';
  function getSyncConfig(){ return { url: localStorage.getItem(SYNC_URL_KEY) || '', key: localStorage.getItem(SYNC_SECRET_KEY) || '' }; }
  function isSyncEnabled(){ const c = getSyncConfig(); return !!(c.url && c.key); }

  async function apiCall(action, payload){
    const c = getSyncConfig();
    if(!c.url || !c.key) throw new Error('sync-not-configured');
    const body = Object.assign({ action, key: c.key }, payload || {});
    // text/plain avoids a CORS preflight that Apps Script Web Apps don't handle
    const res = await fetch(c.url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body) });
    const json = await res.json();
    if(json.error) throw new Error(json.error);
    return json;
  }
  // Small helper: shrink big base64 images before they go into a Sheet cell (~50k char/cell limit)
  function compressDataUrl(dataUrl, maxDim, quality){
    return new Promise((resolve)=>{
      if(!dataUrl){ resolve(dataUrl); return; }
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w,h));
        w = Math.round(w*scale); h = Math.round(h*scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality || 0.7));
      };
      img.onerror = ()=> resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  async function shrinkItemImages(item){
    const d = Object.assign({}, item.data);
    if(d.photo) d.photo = await compressDataUrl(d.photo, 500, 0.7);
    if(d.signature) d.signature = await compressDataUrl(d.signature, 500, 0.7);
    return Object.assign({}, item, { data: d });
  }

  function setSyncStatus(msg, isError){
    const el = document.getElementById('syncStatus');
    if(!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--danger)' : 'var(--green-dark)';
  }
  function refreshSyncPanel(){
    const c = getSyncConfig();
    document.getElementById('syncUrlInput').value = c.url;
    document.getElementById('syncKeyInput').value = c.key;
    setSyncStatus(isSyncEnabled() ? '✅ সিঙ্ক চালু আছে — সব ডিভাইসে একই তালিকা দেখাবে।' : 'সিঙ্ক বন্ধ আছে — শুধু এই ডিভাইসেই ফর্মগুলো সংরক্ষিত থাকবে।', false);
  }

  /* ---- PIN lock for the sync settings panel (deters casual snooping on a shared device;
     NOTE: this is client-side only — someone using browser devtools could still bypass it) ---- */
  const PIN_HASH_KEY = 'tf_sync_pin_hash';
  const PIN_SALT_KEY = 'tf_sync_pin_salt';
  const PIN_SESSION_KEY = 'tf_sync_unlocked';
  async function sha256Hex(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function isPinSet(){ return !!localStorage.getItem(PIN_HASH_KEY); }
  function isUnlockedThisSession(){ return sessionStorage.getItem(PIN_SESSION_KEY) === '1'; }
  async function setPin(pin){
    const salt = 'tf-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const hash = await sha256Hex(salt + pin);
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
    sessionStorage.setItem(PIN_SESSION_KEY, '1');
  }
  async function checkPin(pin){
    const salt = localStorage.getItem(PIN_SALT_KEY) || '';
    const hash = await sha256Hex(salt + pin);
    return hash === localStorage.getItem(PIN_HASH_KEY);
  }
  function clearPin(){
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    sessionStorage.removeItem(PIN_SESSION_KEY);
  }
  function showSyncView(name){
    ['syncSetupView','syncLockView','syncSettingsView'].forEach(id=>{
      document.getElementById(id).style.display = (id === name) ? 'block' : 'none';
    });
  }
  function openSyncOverlay(){
    body.classList.add('sync-open');
    if(!isPinSet()){
      document.getElementById('pinSetupStatus').textContent = '';
      document.getElementById('pinNewInput').value = '';
      document.getElementById('pinNewConfirm').value = '';
      showSyncView('syncSetupView');
    } else if(!isUnlockedThisSession()){
      document.getElementById('pinUnlockStatus').textContent = '';
      document.getElementById('pinUnlockInput').value = '';
      showSyncView('syncLockView');
    } else {
      refreshSyncPanel();
      showSyncView('syncSettingsView');
    }
  }
  document.getElementById('pinSetBtn').addEventListener('click', async ()=>{
    const p1 = document.getElementById('pinNewInput').value.trim();
    const p2 = document.getElementById('pinNewConfirm').value.trim();
    const statusEl = document.getElementById('pinSetupStatus');
    if(p1.length < 4 || p1.length > 6 || !/^\d+$/.test(p1)){ statusEl.textContent = '৪-৬ সংখ্যার PIN দিন।'; statusEl.style.color='var(--danger)'; return; }
    if(p1 !== p2){ statusEl.textContent = 'দুটো PIN মিলছে না।'; statusEl.style.color='var(--danger)'; return; }
    await setPin(p1);
    refreshSyncPanel();
    showSyncView('syncSettingsView');
  });
  document.getElementById('pinSkipBtn').addEventListener('click', ()=>{
    sessionStorage.setItem(PIN_SESSION_KEY, '1'); // treated as unlocked for this session without a PIN
    refreshSyncPanel();
    showSyncView('syncSettingsView');
  });
  document.getElementById('pinUnlockBtn').addEventListener('click', async ()=>{
    const p = document.getElementById('pinUnlockInput').value.trim();
    const ok = await checkPin(p);
    if(ok){
      sessionStorage.setItem(PIN_SESSION_KEY, '1');
      refreshSyncPanel();
      showSyncView('syncSettingsView');
    } else {
      const el = document.getElementById('pinUnlockStatus');
      el.textContent = '❌ ভুল PIN।';
      el.style.color = 'var(--danger)';
    }
  });
  document.getElementById('pinForgotBtn').addEventListener('click', ()=>{
    if(!confirm('PIN রিসেট করলে সংরক্ষিত সিঙ্ক URL ও কী মুছে যাবে (সংরক্ষিত ফর্মগুলো মুছবে না)। এগিয়ে যাবেন?')) return;
    clearPin();
    localStorage.removeItem(SYNC_URL_KEY);
    localStorage.removeItem(SYNC_SECRET_KEY);
    showSyncView('syncSetupView');
    document.getElementById('pinSetupStatus').textContent = '';
  });
  document.getElementById('pinLockNowBtn').addEventListener('click', ()=>{
    sessionStorage.removeItem(PIN_SESSION_KEY);
    body.classList.remove('sync-open');
  });
  document.getElementById('pinChangeBtn').addEventListener('click', ()=>{
    document.getElementById('pinSetupStatus').textContent = 'নতুন PIN সেট করুন — আগেরটা বদলে যাবে।';
    document.getElementById('pinSetupStatus').style.color = 'var(--green-dark)';
    document.getElementById('pinNewInput').value = '';
    document.getElementById('pinNewConfirm').value = '';
    showSyncView('syncSetupView');
  });

  document.getElementById('syncSettingsBtn').addEventListener('click', openSyncOverlay);
  document.getElementById('closeSync').addEventListener('click', ()=> body.classList.remove('sync-open'));
  document.getElementById('syncOverlay').addEventListener('click', (e)=>{ if(e.target.id==='syncOverlay') body.classList.remove('sync-open'); });
  document.getElementById('saveSyncBtn').addEventListener('click', async ()=>{
    const url = document.getElementById('syncUrlInput').value.trim();
    const key = document.getElementById('syncKeyInput').value.trim();
    if(!url || !key){ setSyncStatus('URL এবং সিক্রেট কী দুটোই দিতে হবে।', true); return; }
    localStorage.setItem(SYNC_URL_KEY, url);
    localStorage.setItem(SYNC_SECRET_KEY, key);
    setSyncStatus('⏳ কানেকশন যাচাই করা হচ্ছে...', false);
    try{
      const remote = await fetchSavedFormsRemote();
      setSavedForms(remote);
      setSyncStatus('✅ কানেক্ট হয়েছে! ' + toBn(remote.length) + 'টা ফর্ম পাওয়া গেছে।', false);
    }catch(err){
      console.error(err);
      setSyncStatus('❌ কানেক্ট করা যায়নি: URL/কী চেক করুন। (' + err.message + ')', true);
    }
  });
  document.getElementById('disableSyncBtn').addEventListener('click', ()=>{
    localStorage.removeItem(SYNC_URL_KEY);
    localStorage.removeItem(SYNC_SECRET_KEY);
    refreshSyncPanel();
  });

  async function fetchSavedFormsRemote(){
    const json = await apiCall('list');
    return json.items || [];
  }
  async function saveSavedFormRemote(item){
    const slim = await shrinkItemImages(item);
    await apiCall('save', { item: slim });
  }
  async function deleteSavedFormRemote(id){
    await apiCall('delete', { id });
  }
  // Local cache is shown immediately; if sync is configured we refresh from
  // the shared sheet in the background and re-render once it arrives.
  async function refreshSavedList(){
    if(!isSyncEnabled()) return getSavedForms();
    try{
      const remote = await fetchSavedFormsRemote();
      setSavedForms(remote);
      return remote;
    }catch(err){
      console.error(err);
      return getSavedForms();
    }
  }

  function updateEditBanner(){
    const banner = document.getElementById('editBanner');
    if(currentEditingId){
      const item = getSavedForms().find(x=>x.id===currentEditingId);
      banner.style.display = 'flex';
      banner.querySelector('.txt').textContent = '✏️ আপনি "' + (item? item.label : '') + '" ফর্মটি সম্পাদনা করছেন।';
      document.getElementById('saveBtnLabel').textContent = 'পরিবর্তন সংরক্ষণ করুন';
    } else {
      banner.style.display = 'none';
      document.getElementById('saveBtnLabel').textContent = 'এই ফর্ম সংরক্ষণ করুন';
    }
  }
  document.getElementById('cancelEditBtn').addEventListener('click', ()=>{
    if(!confirm('সম্পাদনা বাতিল করে নতুন ফাঁকা ফর্ম শুরু করবেন?')) return;
    resetFormState();
  });

  document.getElementById('saveFormBtn').addEventListener('click', async ()=>{
    const btn = document.getElementById('saveFormBtn');
    const list = getSavedForms();
    let item;
    if(currentEditingId){
      const idx = list.findIndex(x=>x.id===currentEditingId);
      if(idx > -1){
        const newLabel = prompt('ফর্মের নাম:', list[idx].label);
        if(newLabel === null) return;
        list[idx].label = newLabel || list[idx].label;
        list[idx].data = collectData();
        list[idx].savedAt = new Date().toISOString();
        item = list[idx];
        setSavedForms(list);
      }
    }
    if(!item){
      const suggested = (form.querySelector('[data-key=name]').value) || 'ফর্ম';
      const label = prompt('এই ফর্মটির নাম দিন (যেমন ভাড়াটিয়ার নাম):', suggested);
      if(label === null) return;
      item = { id:'f'+Date.now(), label: label || suggested, savedAt: new Date().toISOString(), data: collectData() };
      list.unshift(item);
      setSavedForms(list);
      currentEditingId = item.id;
      updateEditBanner();
    }
    if(isSyncEnabled()){
      const originalHtml = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '☁️ সিঙ্ক হচ্ছে...';
      try{ await saveSavedFormRemote(item); }
      catch(err){ console.error(err); alert('ফর্মটি এই ডিভাইসে সেভ হয়েছে, কিন্তু অন্য ডিভাইসে সিঙ্ক করতে সমস্যা হয়েছে: ' + err.message); }
      finally{ btn.disabled = false; btn.innerHTML = originalHtml; }
    }
    showToast('ফর্মটি সংরক্ষণ করা হয়েছে।');
  });

  async function renderSavedList(){
    const wrap = document.getElementById('savedList');
    wrap.innerHTML = isSyncEnabled()
      ? '<div class="empty-state">☁️ সব ডিভাইস থেকে তথ্য আনা হচ্ছে...</div>'
      : '<div class="empty-state">লোড হচ্ছে...</div>';
    const list = await refreshSavedList();
    if(!list.length){
      wrap.innerHTML = '<div class="empty-state">এখনও কোনো ফর্ম সংরক্ষণ করা হয়নি।<br>ফর্ম পূরণের পর "এই ফর্ম সংরক্ষণ করুন" বাটনে ক্লিক করুন।</div>';
      return;
    }
    wrap.innerHTML = '';
    list.forEach(item=>{
      const d = new Date(item.savedAt);
      const dateStr = isNaN(d) ? '' : d.toLocaleDateString('bn-BD',{year:'numeric',month:'long',day:'numeric'}) + ' ' + d.toLocaleTimeString('bn-BD',{hour:'2-digit',minute:'2-digit'});
      const label = item.label || 'নামহীন ফর্ম';
      const card = document.createElement('div');
      card.className = 'saved-card';
      card.innerHTML =
        '<div class="info"><div class="avatar">'+esc(Array.from(label)[0] || '?')+'</div><div><b>'+ esc(label) +'</b><small>সংরক্ষণের সময়: '+esc(dateStr)+'</small></div></div>' +
        '<div class="btnbar">' +
          '<button class="btn btn-primary btn-sm" data-act="view"><svg class="ic"><use href="#i-eye"/></svg>দেখুন</button>' +
          '<button class="btn btn-outline btn-sm" data-act="edit"><svg class="ic"><use href="#i-edit"/></svg>আপডেট</button>' +
          '<button class="btn btn-outline btn-sm" data-act="print"><svg class="ic"><use href="#i-print"/></svg>প্রিন্ট</button>' +
          '<button class="btn btn-whatsapp btn-sm" data-act="share"><svg class="ic"><use href="#i-send"/></svg>শেয়ার</button>' +
          '<button class="btn btn-danger btn-sm" data-act="delete"><svg class="ic"><use href="#i-trash"/></svg>মুছুন</button>' +
        '</div>';
      card.querySelector('[data-act=view]').addEventListener('click', ()=> openPreviewForItem(item));
      card.querySelector('[data-act=edit]').addEventListener('click', ()=>{
        fillForm(item.data);
        currentEditingId = item.id;
        updateEditBanner();
        body.classList.remove('saved-open');
        window.scrollTo({top:0, behavior:'smooth'});
      });
      card.querySelector('[data-act=print]').addEventListener('click', ()=>{
        openPreviewForItem(item);
        printFromOverlay();
      });
      card.querySelector('[data-act=share]').addEventListener('click', ()=> openPreviewForItem(item));
      card.querySelector('[data-act=delete]').addEventListener('click', async ()=>{
        if(!confirm('এই সংরক্ষিত ফর্মটি মুছে ফেলতে চান?')) return;
        setSavedForms(getSavedForms().filter(x=>x.id !== item.id));
        if(currentEditingId === item.id){ currentEditingId = null; updateEditBanner(); }
        if(isSyncEnabled()){
          try{ await deleteSavedFormRemote(item.id); }
          catch(err){ console.error(err); alert('এই ডিভাইস থেকে মুছে ফেলা হয়েছে, কিন্তু অন্য ডিভাইসে মুছতে সমস্যা হয়েছে: ' + err.message); }
        }
        renderSavedList();
      });
      wrap.appendChild(card);
    });
  }
  document.getElementById('savedListBtn').addEventListener('click', ()=>{ renderSavedList(); body.classList.add('saved-open'); });
  document.getElementById('closeSaved').addEventListener('click', ()=> body.classList.remove('saved-open'));


  /* ================= PREVIEW OVERLAY CONTROL ================= */
  function updateContextLabel(){
    const el = document.getElementById('previewContextLabel');
    const editBtn = document.getElementById('editFromPreviewBtn');
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
    paintPreview(collectData());
    updateContextLabel();
    body.classList.add('preview-open');
    resetPaperScale();
  }
  function openPreviewForItem(item){
    viewingSavedItem = item;
    paintPreview(item.data);
    updateContextLabel();
    body.classList.remove('saved-open');
    body.classList.add('preview-open');
    resetPaperScale();
  }
  document.getElementById('previewBtn').addEventListener('click', openPreviewLive);
  document.getElementById('closePreview').addEventListener('click', ()=>{ body.classList.remove('preview-open'); resetPaperScale(); });
  document.getElementById('editFromPreviewBtn').addEventListener('click', ()=>{
    if(!viewingSavedItem) return;
    const item = viewingSavedItem;
    fillForm(item.data);
    currentEditingId = item.id;
    updateEditBanner();
    body.classList.remove('preview-open');
    window.scrollTo({top:0, behavior:'smooth'});
  });
  document.getElementById('previewOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'previewOverlay'){ body.classList.remove('preview-open'); resetPaperScale(); } });
  document.getElementById('savedOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'savedOverlay') body.classList.remove('saved-open'); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ body.classList.remove('preview-open'); body.classList.remove('saved-open'); body.classList.remove('sync-open'); resetPaperScale(); } });

  /* ================= PRINT: FILL THE WHOLE PAGE (A4 / LEGAL), ONE PAGE ONLY ================= */
  const PAGE_SIZES = { a4:{w:210,h:297}, legal:{w:215.9,h:355.6} };
  const MM_TO_PX = 3.7795275591;
  function mm2px(mm){ return mm*MM_TO_PX; }
  function applyPageSizeStyle(key){
    let styleTag = document.getElementById('dynPageSize');
    if(!styleTag){ styleTag = document.createElement('style'); styleTag.id = 'dynPageSize'; document.head.appendChild(styleTag); }
    styleTag.textContent = '@page { size: ' + (key === 'legal' ? 'legal' : 'A4') + '; margin:0; }';
  }
  function resetPaperScale(){
    document.getElementById('paper').style.setProperty('--s', 1);
  }
  // Continuously grows/shrinks real font-size, spacing, image sizes (not a visual
  // transform) so the document always fills the chosen page edge-to-edge, on
  // exactly one page. Uses real layout changes so print pagination respects it.
  function fitPaperToPage(){
    const key = document.getElementById('paperSizeSelect').value;
    applyPageSizeStyle(key);
    const page = PAGE_SIZES[key] || PAGE_SIZES.a4;
    const availableHeightPx = mm2px(page.h) - mm2px(28); // reserve ~14mm top+bottom
    const paperEl = document.getElementById('paper');

    let s = 1;
    paperEl.style.setProperty('--s', s);
    for(let iter = 0; iter < 8; iter++){
      const h = paperEl.scrollHeight;
      if(h <= 0) break;
      let next = s * (availableHeightPx / h);
      next = Math.max(0.45, Math.min(next, 1.9)); // keep text from getting unreadably small or huge
      if(Math.abs(next - s) < 0.006){ s = next; break; }
      s = next;
      paperEl.style.setProperty('--s', s);
    }
    paperEl.style.setProperty('--s', s);
  }
  document.getElementById('paperSizeSelect').addEventListener('change', fitPaperToPage);
  function printFromOverlay(){ fitPaperToPage(); setTimeout(()=>window.print(), 70); }
  document.getElementById('printBtn').addEventListener('click', printFromOverlay);
  window.addEventListener('beforeprint', fitPaperToPage);
  window.addEventListener('afterprint', resetPaperScale);

  /* ================= SHARE AS JPG / PDF (WhatsApp via Web Share API) ================= */
  async function renderPaperCanvas(){
    fitPaperToPage(); // same full-page fill look as print
    await new Promise(r=>setTimeout(r, 60));
    const paperEl = document.getElementById('paper');
    return html2canvas(paperEl, {scale:2, backgroundColor:'#FBF8F1', useCORS:true});
  }
  async function buildJpgBlob(){
    const canvas = await renderPaperCanvas();
    return new Promise(resolve=> canvas.toBlob(b=>resolve(b), 'image/jpeg', 0.92));
  }
  async function buildPdfBlob(){
    const canvas = await renderPaperCanvas();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const key = document.getElementById('paperSizeSelect').value;
    const size = key === 'legal' ? [215.9,355.6] : [210,297];
    const pdf = new window.jspdf.jsPDF({unit:'mm', format:size});
    const pageW = size[0], pageH = size[1];
    const ratio = canvas.width / canvas.height;
    let w = pageW, h = w/ratio;
    if(h > pageH){ h = pageH; w = h*ratio; }
    const x = (pageW-w)/2, y = (pageH-h)/2;
    pdf.addImage(imgData, 'JPEG', x, y, w, h);
    return pdf.output('blob');
  }
  async function shareFile(blob, filename, mime, btnEl){
    const originalHtml = btnEl ? btnEl.innerHTML : null;
    if(btnEl){ btnEl.disabled = true; btnEl.innerHTML = '⏳ তৈরি হচ্ছে...'; }
    try{
      const file = new File([blob], filename, {type: mime});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র', text:'অস্থায়ী ভাড়াটিয়া চুক্তিপত্র'});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 5000);
        alert('ফাইলটি ডাউনলোড হয়েছে। এখন WhatsApp Web/অ্যাপ খুলে চ্যাটে ফাইলটি অ্যাটাচ করে পাঠান।');
        window.open('https://web.whatsapp.com/', '_blank');
      }
    } catch(err){
      if(err && err.name !== 'AbortError'){
        console.error(err);
        alert('ফাইল তৈরি/শেয়ার করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
      }
    } finally {
      if(btnEl){ btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
    }
  }
  document.getElementById('whatsappJpgBtn').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    btn.disabled = true;
    try{
      const blob = await buildJpgBlob();
      btn.disabled = false;
      shareFile(blob, 'tenant-form.jpg', 'image/jpeg', btn);
    }catch(err){ console.error(err); btn.disabled = false; alert('ছবি তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); }
  });
  document.getElementById('whatsappPdfBtn').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    btn.disabled = true;
    try{
      const blob = await buildPdfBlob();
      btn.disabled = false;
      shareFile(blob, 'tenant-form.pdf', 'application/pdf', btn);
    }catch(err){ console.error(err); btn.disabled = false; alert('PDF তৈরি করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'); }
  });

  /* ================= RESET ================= */
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    if(!confirm('বর্তমান ফর্মের সব তথ্য মুছে ফেলতে চান? (সংরক্ষিত ফর্মগুলো থাকবে)')) return;
    resetFormState();
  });

  /* ================= INIT ================= */
  setSavedForms(getSavedForms());
  loadDraft();
  if(!famRows.children.length){ addFamRow(); addFamRow(); addFamRow(); }
  updateEditBanner();
  paintPreview(collectData());
  if(isSyncEnabled()){ refreshSavedList().catch(()=>{}); } // quiet background refresh of the badge count
})();
