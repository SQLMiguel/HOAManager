/* =============================================================
   directory.js  –  Glenridge Community Member Directory
   API contract based on server.js buildProfile() shape:
     GET /api/directory → array of { user, profile, adults, children, pets, social, photos }
     GET /api/directory/me → same shape for current user
     POST /api/directory/profile → body matches dir_profiles columns
     POST/DELETE /api/directory/adults   (DELETE uses /:id URL param)
     POST/DELETE /api/directory/children (first_name, birth_month, birth_day)
     POST/DELETE /api/directory/pets     (name, pet_type)
     POST/DELETE /api/directory/social   (platform, url, is_visible)
     POST        /api/directory/photos   (multipart: photo file + category, caption)
     PUT/DELETE  /api/directory/photos/:id
     GET         /api/directory/print
   ============================================================= */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  let myProfile  = null;   // raw buildProfile() object for current user
  let allMembers = [];

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    initTabs();
    initSearch();
    initPrintBtn();
    initProfileToggle();
    initFamilyTab();
    initSocialTab();
    initPhotosTab();
    initPublishTab();
    initInfoTab();
    loadDirectory();
    loadMyProfile();

    // Auto-open profile editor when linked with #edit-profile
    if (window.location.hash === '#edit-profile') {
      const sec = document.getElementById('profileSection');
      sec.style.display = 'block';
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', window.location.pathname);
    }
  });

  // ── Auth Guard ───────────────────────────────────────────────
  async function checkAuth() {
    try {
      const res  = await fetch('/api/me');
      const data = await res.json();
      if (!data.authenticated) { window.location.href = 'members.html'; return; }
    } catch {
      window.location.href = 'members.html';
      return;
    }
    document.getElementById('authGate').style.display = 'none';
    document.getElementById('dirApp').style.display   = 'block';
  }

  // ── Helpers: data extraction from buildProfile shape ─────────
  function fullName(bp) {
    if (!bp || !bp.user) return '';
    return [bp.user.first_name, bp.user.last_name].filter(Boolean).join(' ');
  }
  function displayName(bp) {
    return (bp && bp.profile && bp.profile.display_name) || fullName(bp);
  }
  function primaryPhotoUrl(bp) {
    if (!bp || !bp.photos) return null;
    const vis = bp.photos.filter(p => p.is_visible);
    return vis.length ? vis[0].filename : null;
  }

  // ── Directory Listing ────────────────────────────────────────
  async function loadDirectory() {
    const grid = document.getElementById('dirGrid');
    try {
      const res = await fetch('/api/directory');
      if (!res.ok) {
        if (res.status === 401) { window.location.href = 'members.html'; return; }
        throw new Error(`Server error ${res.status}`);
      }
      const data = await res.json();
      allMembers = Array.isArray(data) ? data : [];
      renderDirectory(allMembers);
    } catch (err) {
      console.error('loadDirectory error:', err);
      if (grid) grid.innerHTML = '<p class="dir-error">Unable to load directory. Please try again.</p>';
    }
  }

  function renderDirectory(members) {
    const grid  = document.getElementById('dirGrid');
    const stats = document.getElementById('dirStats');
    const noRes = document.getElementById('dirNoResults');

    if (!members.length) {
      grid.innerHTML      = '';
      noRes.style.display = 'block';
      stats.textContent   = '';
      return;
    }
    noRes.style.display = 'none';
    stats.textContent   = `${members.length} household${members.length !== 1 ? 's' : ''} in directory`;
    grid.innerHTML      = members.map(m => memberCard(m)).join('');
  }

  function memberCard(m) {
    const name     = displayName(m);
    const address  = m.user ? m.user.address || '' : '';
    const photoUrl = primaryPhotoUrl(m);
    const prof     = m.profile || {};

    const photo = photoUrl
      ? `<img src="${e(photoUrl)}" alt="${e(name)}" class="dir-card-photo">`
      : `<div class="dir-card-photo dir-card-photo-placeholder">${initials(name)}</div>`;

    const rows = [];
    if (address)                                rows.push(rHtml('📍', `<a href="https://maps.google.com/?q=${encodeURIComponent(address)}" target="_blank" rel="noopener">${e(address)}</a>`));
    if (m.user && m.user.email)                 rows.push(rHtml('✉️', `<a href="mailto:${e(m.user.email)}">${e(m.user.email)}</a>`));
    if (prof.show_phone && prof.phone)          rows.push(rHtml('📞', e(prof.phone)));
    if (prof.show_anniversary && prof.anniversary) rows.push(rHtml('🎉', e(prof.anniversary)));
    if (prof.show_interests && prof.interests)     rows.push(rHtml('⭐', e(prof.interests)));
    if (prof.show_notes && prof.notes)             rows.push(rHtml('💬', e(prof.notes)));

    const family = buildFamilyBadges(m);
    const social = buildSocialLinks(m.social || []);

    return `
      <div class="dir-card dir-card-appear">
        <div class="dir-card-top">
          ${photo}
          <div class="dir-card-info">
            <h3 class="dir-card-name">${e(name)}</h3>
            ${rows.join('')}
          </div>
        </div>
        ${family ? `<div class="dir-card-family">${family}</div>` : ''}
        ${social ? `<div class="dir-card-social">${social}</div>` : ''}
      </div>`;
  }

  function rHtml(icon, content) {
    return `<p class="dir-card-row">${icon} ${content}</p>`;
  }

  function buildFamilyBadges(m) {
    const parts = [];
    (m.adults   || []).forEach(a => parts.push(`<span class="dir-badge">${e(a.name)}</span>`));
    (m.children || []).forEach(c => parts.push(`<span class="dir-badge dir-badge-child">${e(c.first_name)}</span>`));
    (m.pets     || []).forEach(p => parts.push(`<span class="dir-badge dir-badge-pet">🐾 ${e(p.name)}</span>`));
    return parts.join('');
  }

  function buildSocialLinks(socialArr) {
    if (!socialArr || !socialArr.length) return '';
    return socialArr.filter(s => s.is_visible).map(s =>
      `<a href="${e(s.url)}" target="_blank" rel="noopener" class="dir-social-link" title="${e(s.platform)}">${socialIcon(s.platform)}</a>`
    ).join('');
  }

  function socialIcon(platform) {
    const p = (platform || '').toLowerCase();
    if (p.includes('facebook'))  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>';
    if (p.includes('instagram')) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>';
    if (p.includes('linkedin'))  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>';
    if (p.includes('nextdoor'))  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8l4 4-4 4-4-4 4-4z"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>';
  }

  // ── Search ───────────────────────────────────────────────────
  function initSearch() {
    document.getElementById('dirSearch').addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      if (!q) { renderDirectory(allMembers); return; }
      const filtered = allMembers.filter(m => {
        const name    = displayName(m).toLowerCase();
        const address = (m.user ? m.user.address || '' : '').toLowerCase();
        return name.includes(q) || address.includes(q);
      });
      renderDirectory(filtered);
    });
  }

  // ── Print ────────────────────────────────────────────────────
  function initPrintBtn() {
    document.getElementById('printDirBtn').addEventListener('click', doPrint);
  }

  function doPrint() {
    window.open('directory-print.html', '_blank', 'noopener');
  }

  function populatePrint(members) {
    const dateStr = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
    document.getElementById('printDate').textContent = dateStr;
    document.querySelectorAll('.pfDate').forEach(el => el.textContent = dateStr);
    const body = document.getElementById('printBody');
    if (!Array.isArray(members) || !members.length) {
      body.innerHTML = '<p class="dir-print-empty">No members in directory.</p>'; return;
    }
    const countEl = document.getElementById('printCount');
    if (countEl) countEl.textContent = `${members.length} household${members.length !== 1 ? 's' : ''}`;

    // Group alphabetically by sort name
    const groups = {};
    members.forEach(m => {
      const sortName = (m.profile && m.profile.display_name)
        || `${(m.user && m.user.last_name) || ''} ${(m.user && m.user.first_name) || ''}`.trim();
      const letter = (sortName[0] || '#').toUpperCase();
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(m);
    });

    const letters = Object.keys(groups).sort();
    body.innerHTML = letters.map(letter => {
      const entries = groups[letter].map(m => {
        const user = m.user || {};
        const prof = m.profile || {};
        const name = displayName(m);

        const adultNames   = (m.adults   || []).filter(a => a.name).map(a => e(a.name));
        const childNames   = (m.children || []).filter(c => c.first_name).map(c => e(c.first_name));
        const petNames     = (m.pets     || []).filter(p => p.name)
          .map(p => `${e(p.name)}${p.pet_type ? ` (${e(p.pet_type)})` : ''}`);

        const rows = [];
        if (user.address)                       rows.push(`<span class="dpl">Address</span> ${e(user.address)}`);
        if (user.email)                         rows.push(`<span class="dpl">Email</span> ${e(user.email)}`);
        if (prof.show_phone && prof.phone)      rows.push(`<span class="dpl">Phone</span> ${e(prof.phone)}`);
        if (adultNames.length)                  rows.push(`<span class="dpl">Adults</span> ${adultNames.join(', ')}`);
        if (childNames.length)                  rows.push(`<span class="dpl">Children</span> ${childNames.join(', ')}`);
        if (petNames.length)                    rows.push(`<span class="dpl">Pets</span> ${petNames.join(', ')}`);
        if (prof.show_interests && prof.interests) rows.push(`<span class="dpl">Interests</span> ${e(prof.interests)}`);

        return `<div class="dir-pe">
          <div class="dir-pe-name">${e(name)}</div>
          ${rows.map(r => `<div class="dir-pe-row">${r}</div>`).join('')}
        </div>`;
      }).join('');

      return `<div class="dir-pg">
        <div class="dir-pg-letter">${letter}</div>
        <div class="dir-pg-entries">${entries}</div>
      </div>`;
    }).join('');
  }

  // ── Profile Toggle ───────────────────────────────────────────
  function initProfileToggle() {
    document.getElementById('myProfileBtn').addEventListener('click', () => {
      const sec    = document.getElementById('profileSection');
      const hidden = sec.style.display === 'none' || sec.style.display === '';
      sec.style.display = hidden ? 'block' : 'none';
      if (hidden) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('closeProfileBtn').addEventListener('click', () => {
      document.getElementById('profileSection').style.display = 'none';
    });
  }

  // ── Tabs ─────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.dir-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.dir-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.dir-tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ── Load My Profile ──────────────────────────────────────────
  async function loadMyProfile() {
    try {
      const res  = await fetch('/api/directory/me');
      myProfile  = await res.json();
      populateEditor(myProfile);
    } catch { /* profile doesn't exist yet */ }
  }

  function populateEditor(bp) {
    if (!bp) return;
    const prof = bp.profile || {};
    const user = bp.user    || {};

    document.getElementById('infoNameDisplay').textContent    = fullName(bp) || '—';
    document.getElementById('infoAddressDisplay').textContent = user.address  || '—';
    const emailEl = document.getElementById('infoEmailValue');
    if (emailEl) emailEl.textContent = user.email || '—';

    setVal('profDisplayName',    prof.display_name);
    setVal('profPhone',          prof.phone);
    setVal('profAnniversary',    prof.anniversary);
    setVal('profInterests',      prof.interests);
    setVal('profNotes',          prof.notes);
    setChk('profShowPhone',      prof.show_phone);
    setChk('profShowAnniversary',prof.show_anniversary);
    setChk('profShowInterests',  prof.show_interests);
    setChk('profShowNotes',      prof.show_notes);
    setChk('profDoNotList',      prof.do_not_list);
    setChk('consentCheck',       prof.consent_given);

    const pubBtn   = document.getElementById('publishBtn');
    const unpubBtn = document.getElementById('unpublishBtn');
    const status   = document.getElementById('publishStatus');
    if (prof.is_published) {
      pubBtn.style.display   = 'none';
      unpubBtn.style.display = '';
      status.textContent     = 'Your profile is published.';
      status.className       = 'dir-publish-status dir-status-live';
    } else {
      pubBtn.style.display   = '';
      unpubBtn.style.display = 'none';
      status.textContent     = 'Profile not published.';
      status.className       = 'dir-publish-status';
    }

    renderAdults(bp.adults   || []);
    renderChildren(bp.children || []);
    renderPets(bp.pets       || []);
    renderSocial(bp.social   || []);
    renderPhotos(bp.photos   || []);
  }

  // ── Info Tab ─────────────────────────────────────────────────
  function initInfoTab() {
    document.getElementById('saveInfoBtn').addEventListener('click', saveInfo);
    // Phone auto-formatter is handled by validation.js (auto-init)
  }

  async function saveInfo() {
    const displayName = val('profDisplayName');
    if (!displayName) {
      showMsg('saveInfoMsg', 'Display Name is required.', true);
      document.getElementById('profDisplayName').focus();
      return;
    }
    if (!FormValidation.isValidPhone(val('profPhone'))) {
      showMsg('saveInfoMsg', 'Phone number must be 10 digits.', true);
      document.getElementById('profPhone').focus();
      return;
    }
    const payload = {
      display_name:     displayName,
      phone:            val('profPhone'),
      show_phone:       chk('profShowPhone')        ? 1 : 0,
      anniversary:       val('profAnniversary'),
      show_anniversary:  chk('profShowAnniversary')  ? 1 : 0,
      interests:         val('profInterests'),
      show_interests:    chk('profShowInterests')    ? 1 : 0,
      notes:             val('profNotes'),
      show_notes:        chk('profShowNotes')        ? 1 : 0,
    };
    const [ok, msg] = await apiPost('/api/directory/profile', payload);
    showMsg('saveInfoMsg', msg, !ok);
    if (ok) { myProfile = await (await fetch('/api/directory/me')).json(); loadDirectory(); }
  }

  // ── Family Tab ───────────────────────────────────────────────
  function initFamilyTab() {
    document.getElementById('addAdultBtn').addEventListener('click', addAdult);
    document.getElementById('addChildBtn').addEventListener('click', addChild);
    document.getElementById('addPetBtn').addEventListener('click', addPet);
  }

  function renderAdults(list) {
    document.getElementById('adultsList').innerHTML = list.map(a =>
      `<div class="dir-list-item">
        <span>${e(a.name)}${a.birthday ? ` · ${e(a.birthday)}` : ''}</span>
        <button class="dir-del-btn" data-id="${a.id}" data-type="adult" title="Remove">✕</button>
      </div>`
    ).join('');
    document.querySelectorAll('#adultsList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteItem('adults', btn.dataset.id)));
  }

  function renderChildren(list) {
    document.getElementById('childrenList').innerHTML = list.map(c => {
      const bday = c.birth_month ? ` · ${e(c.birth_month)}${c.birth_day ? ' ' + c.birth_day : ''}` : '';
      return `<div class="dir-list-item">
        <span>${e(c.first_name)}${bday}</span>
        <button class="dir-del-btn" data-id="${c.id}" data-type="child" title="Remove">✕</button>
      </div>`;
    }).join('');
    document.querySelectorAll('#childrenList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteItem('children', btn.dataset.id)));
  }

  function renderPets(list) {
    document.getElementById('petsList').innerHTML = list.map(p =>
      `<div class="dir-list-item">
        <span>${e(p.name)}${p.pet_type ? ` (${e(p.pet_type)})` : ''}</span>
        <button class="dir-del-btn" data-id="${p.id}" data-type="pet" title="Remove">✕</button>
      </div>`
    ).join('');
    document.querySelectorAll('#petsList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteItem('pets', btn.dataset.id)));
  }


  async function addAdult() {
    const name         = val('adultName');  if (!name) return;
    const birthday     = val('adultBirthday');
    const show_birthday = chk('adultShowBday') ? 1 : 0;
    const [ok] = await apiPost('/api/directory/adults', { name, birthday, show_birthday });
    if (ok) { clearInputs('adultName', 'adultBirthday'); await refreshProfile(); }
  }

  async function addChild() {
    const first_name   = val('childName');  if (!first_name) return;
    const birth_month  = val('childMonth');
    const birth_day    = val('childDay');
    const show_birthday = chk('childShowBday') ? 1 : 0;
    const [ok] = await apiPost('/api/directory/children', { first_name, birth_month, birth_day, show_birthday });
    if (ok) { clearInputs('childName', 'childDay'); document.getElementById('childMonth').value = ''; await refreshProfile(); }
  }

  async function addPet() {
    const name     = val('petName');  if (!name) return;
    const pet_type = val('petType');
    const [ok] = await apiPost('/api/directory/pets', { name, pet_type });
    if (ok) { clearInputs('petName', 'petType'); await refreshProfile(); }
  }

  // DELETE uses /:id URL param
  async function deleteItem(segment, id) {
    await fetch(`/api/directory/${segment}/${id}`, { method: 'DELETE' });
    await refreshProfile();
  }

  // ── Social Tab ───────────────────────────────────────────────
  function initSocialTab() {
    document.getElementById('addSocialBtn').addEventListener('click', addSocial);
  }

  function renderSocial(list) {
    document.getElementById('socialList').innerHTML = list.map(s =>
      `<div class="dir-list-item">
        <span>${e(s.platform)} — <a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.url)}</a></span>
        <button class="dir-del-btn" data-id="${s.id}" data-type="social" title="Remove">✕</button>
      </div>`
    ).join('');
    document.querySelectorAll('#socialList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteItem('social', btn.dataset.id)));
  }

  async function addSocial() {
    const platform   = val('socialPlatform'); if (!platform) return;
    const url        = val('socialUrl');       if (!url)       return;
    const is_visible = chk('socialVisible')    ? 1 : 0;
    const [ok] = await apiPost('/api/directory/social', { platform, url, is_visible });
    if (ok) { clearInputs('socialUrl'); document.getElementById('socialPlatform').value = ''; await refreshProfile(); }
  }

  // ── Photos Tab ───────────────────────────────────────────────
  function initPhotosTab() {
    document.getElementById('uploadPhotoBtn').addEventListener('click', uploadPhoto);
  }

  function renderPhotos(list) {
    document.getElementById('photoGrid').innerHTML = list.map(ph =>
      `<div class="dir-photo-thumb" data-id="${ph.id}">
        <img src="${e(ph.filename)}" alt="${e(ph.caption || '')}">
        ${ph.caption ? `<p class="dir-photo-caption">${e(ph.caption)}</p>` : ''}
        <div class="dir-photo-overlay">
          <label class="dir-toggle dir-toggle-small" title="Visible in directory">
            <input type="checkbox" class="photo-vis-toggle" data-id="${ph.id}" ${ph.is_visible ? 'checked' : ''}>
            <span class="dir-toggle-slider"></span>
          </label>
          <button class="dir-del-photo-btn" data-id="${ph.id}" title="Delete photo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </div>`
    ).join('');

    // Visibility toggles
    document.querySelectorAll('.photo-vis-toggle').forEach(cb => {
      cb.addEventListener('change', () => updatePhotoVisibility(cb.dataset.id, cb.checked));
    });
    // Delete buttons
    document.querySelectorAll('.dir-del-photo-btn').forEach(btn => {
      btn.addEventListener('click', () => deletePhoto(btn.dataset.id));
    });
  }

  async function uploadPhoto() {
    const fileInput = document.getElementById('photoFileInput');
    const file = fileInput.files[0];
    if (!file) { showMsg('photoUploadMsg', 'Please select a photo.', true); return; }
    if (file.size > 5 * 1024 * 1024) { showMsg('photoUploadMsg', 'File must be under 5MB.', true); return; }

    const fd = new FormData();
    fd.append('photo', file);
    fd.append('caption',  val('photoCaption'));
    fd.append('category', val('photoCategory'));

    showMsg('photoUploadMsg', 'Uploading…');
    try {
      const res  = await fetch('/api/directory/photos', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        showMsg('photoUploadMsg', 'Photo uploaded!');
        fileInput.value = '';
        clearInputs('photoCaption');
        await refreshProfile();
      } else {
        showMsg('photoUploadMsg', data.error || 'Upload failed.', true);
      }
    } catch {
      showMsg('photoUploadMsg', 'Network error — upload failed.', true);
    }
  }

  async function updatePhotoVisibility(id, visible) {
    await fetch(`/api/directory/photos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_visible: visible ? 1 : 0 }),
    });
  }

  async function deletePhoto(id) {
    if (!confirm('Delete this photo?')) return;
    await fetch(`/api/directory/photos/${id}`, { method: 'DELETE' });
    await refreshProfile();
  }

  // ── Publish Tab ──────────────────────────────────────────────
  function initPublishTab() {
    document.getElementById('publishBtn').addEventListener('click',   publishProfile);
    document.getElementById('unpublishBtn').addEventListener('click', unpublishProfile);
    document.getElementById('profDoNotList').addEventListener('change', saveDoNotList);
  }

  async function publishProfile() {
    if (!chk('consentCheck')) { showNotif('Please accept the terms to publish your profile.', true); return; }
    const [ok, msg] = await apiPost('/api/directory/profile', { consent_given: 1, is_published: 1 });
    if (ok) { await refreshProfile(); loadDirectory(); }
    showNotif(msg, !ok);
  }

  async function unpublishProfile() {
    const [ok, msg] = await apiPost('/api/directory/profile', { is_published: 0 });
    if (ok) { await refreshProfile(); loadDirectory(); }
    showNotif(msg, !ok);
  }

  async function saveDoNotList() {
    await apiPost('/api/directory/profile', { do_not_list: chk('profDoNotList') ? 1 : 0 });
    loadDirectory();
  }

  // ── Shared Helpers ───────────────────────────────────────────
  async function refreshProfile() {
    myProfile = await (await fetch('/api/directory/me')).json();
    populateEditor(myProfile);
  }

  // ── API Helpers ───────────────────────────────────────────────
  async function apiPost(url, payload) {
    return apiFetch(url, 'POST', payload);
  }

  async function apiFetch(url, method, payload) {
    try {
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return [data.success || false, data.message || data.error || (data.success ? 'Saved.' : 'Error.')];
    } catch {
      return [false, 'Network error.'];
    }
  }

  function val(id)   { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function chk(id)   { const el = document.getElementById(id); return el ? el.checked     : false; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }
  function setChk(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
  function clearInputs(...ids) { ids.forEach(id => setVal(id, '')); }
  function e(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function initials(name) {
    return (name || 'GC').split(' ').filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');
  }

  function showMsg(id, msg, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent  = msg;
    el.className    = 'dir-save-msg' + (isError ? ' dir-save-msg-error' : ' dir-save-msg-ok');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; el.className = 'dir-save-msg'; }, 4000);
  }

  function showNotif(msg, isError) {
    // Re-use any existing notification system (main.js may define showNotification)
    if (typeof showNotification === 'function') { showNotification(msg, isError ? 'error' : 'success'); return; }
    const n = document.createElement('div');
    n.textContent  = msg;
    n.className    = 'dir-notif' + (isError ? ' dir-notif-error' : '');
    document.body.appendChild(n);
    setTimeout(() => n.classList.add('dir-notif-show'), 10);
    setTimeout(() => { n.classList.remove('dir-notif-show'); setTimeout(() => n.remove(), 400); }, 3500);
  }

})();
