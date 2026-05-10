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
  let smsPrefs   = null;

  // ── Init ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    initProfileWizard();
    initSearch();
    initPrintBtn();
    initProfileToggle();
    initFamilyTab();
    initSocialTab();
    initPhotosTab();
    initPublishTab();
    initSmsPreferences();
    initPoolPhones();
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
      // Safety net: never display members who opted out via do_not_list
      const filtered = (Array.isArray(data) ? data : [])
        .filter(m => !(m && m.profile && m.profile.do_not_list));
      allMembers = filtered;
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
    (m.adults   || []).filter(a => a.is_visible !== 0).forEach(a => {
      const contact = [
        a.show_phone !== 0 && a.email ? `<span class="dir-badge-email">${e(a.email)}</span>` : '',
        a.show_email !== 0 && a.phone ? `<span class="dir-badge-email">${e(a.phone)}</span>` : ''
      ].filter(Boolean).join('');
      parts.push(`<span class="dir-badge">${e(a.name)}${contact}</span>`);
    });
    (m.children || []).filter(c => c.is_visible !== 0).forEach(c => parts.push(`<span class="dir-badge dir-badge-child">${e(c.first_name)}</span>`));
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

        const adults = (m.adults || []).filter(a => a.name && a.is_visible !== 0);
        const childNames   = (m.children || []).filter(c => c.first_name).map(c => e(c.first_name));
        const petNames     = (m.pets     || []).filter(p => p.name)
          .map(p => `${e(p.name)}${p.pet_type ? ` (${e(p.pet_type)})` : ''}`);

        const rows = [];
        if (user.address)                       rows.push(`<span class="dpl">Address</span> ${e(user.address)}`);
        if (user.email)                         rows.push(`<span class="dpl">Email</span> ${e(user.email)}`);
        if (prof.show_phone && prof.phone)      rows.push(`<span class="dpl">Phone</span> ${e(prof.phone)}`);
        adults.forEach(a => {
          const details = [a.phone ? e(a.phone) : '', a.email ? e(a.email) : ''].filter(Boolean).join(' · ');
          rows.push(`<span class="dpl">Adult</span> ${e(a.name)}${details ? ' — ' + details : ''}`);
        });
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
      if (hidden) {
        goToProfileStep(1);
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    document.getElementById('closeProfileBtn').addEventListener('click', () => {
      document.getElementById('profileSection').style.display = 'none';
    });
  }

  // ── Tabs (kept for hash-based auto-open compatibility) ───────
  function initTabs() { /* replaced by initProfileWizard */ }

  // ── Load My Profile ──────────────────────────────────────────
  async function loadMyProfile() {
    try {
      const res  = await fetch('/api/directory/me');
      myProfile  = await res.json();
      populateEditor(myProfile);
      await loadSmsPreferences();
    } catch { /* profile doesn't exist yet */ }
  }

  async function loadSmsPreferences() {
    try {
      const res = await fetch('/api/sms/preferences');
      if (!res.ok) return;
      smsPrefs = await res.json();
      renderSmsPreferences();
    } catch {}
  }

  function renderSmsPreferences() {
    if (!smsPrefs) return;

    const phoneEl = document.getElementById('smsPhoneDisplay');
    const outBtn = document.getElementById('smsOptOutBtn');
    const inBtn = document.getElementById('smsOptInBtn');
    const status = document.getElementById('smsPrefStatus');

    if (phoneEl) phoneEl.textContent = smsPrefs.phoneMasked || 'No valid phone number on file';

    // Sync the inline SMS toggle on the Household Info tab
    const infoToggle = document.getElementById('profSmsOptIn');
    const infoStatus = document.getElementById('profSmsStatus');
    if (infoToggle) {
      infoToggle.disabled = false;
      infoToggle.checked = !smsPrefs.optedOut;
      if (infoStatus) {
        infoStatus.textContent = smsPrefs.optedOut ? 'Enable to receive SMS notices' : '';
        infoStatus.className = 'dir-sms-inline-status';
      }
    }

    // Render household SMS members list
    const hhList = document.getElementById('smsHouseholdList');
    if (hhList) {
      if (smsPrefs.householdSms && smsPrefs.householdSms.length) {
        hhList.innerHTML = smsPrefs.householdSms.map(m =>
          `<div class="dir-sms-hh-item"><span class="dir-badge-sms">📱</span> ${e(m.name)} · ${m.phoneMasked}</div>`
        ).join('');
        hhList.style.display = 'block';
      } else {
        hhList.innerHTML = '';
        hhList.style.display = 'none';
      }
    }

    if (!smsPrefs.hasPhone) {
      outBtn.classList.add('dir-hidden');
      inBtn.classList.add('dir-hidden');
      status.textContent = 'Add a phone number in Household Info to enable SMS alerts.';
      status.className = 'dir-publish-status';
      return;
    }

    if (smsPrefs.optedOut) {
      outBtn.classList.add('dir-hidden');
      inBtn.classList.remove('dir-hidden');
      status.textContent = 'You are currently opted out of HOA SMS messages.';
      status.className = 'dir-publish-status';
    } else {
      outBtn.classList.remove('dir-hidden');
      inBtn.classList.add('dir-hidden');
      status.textContent = 'You are currently subscribed to HOA SMS messages.';
      status.className = 'dir-publish-status dir-status-live';
    }
  }

  function populateEditor(bp) {
    if (!bp) return;
    const prof = bp.profile || {};
    const user = bp.user    || {};

    document.getElementById('infoNameDisplay').textContent    = fullName(bp) || '—';
    document.getElementById('infoAddressDisplay').textContent = user.address  || '—';
    const familyAddrEl = document.getElementById('familyHouseholdAddress');
    if (familyAddrEl) familyAddrEl.textContent = user.address || 'No address on file — please contact the HOA admin.';
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
    refreshPoolPhones();
  }

  // ── Profile Wizard State ─────────────────────────────────────
  let _profileStep = 1;

  function initProfileWizard() {
    // Clicking a stepper indicator navigates to that step (auto-saving step 1 first if needed)
    document.querySelectorAll('.profile-step-item').forEach(el => {
      el.addEventListener('click', async () => {
        const target = parseInt(el.dataset.pstep);
        if (target === _profileStep) return;
        if (_profileStep === 1) {
          const saved = await autoSaveInfo();
          if (!saved) return;
        }
        goToProfileStep(target);
      });
    });

    // Step 1 → 2: auto-save then advance
    document.getElementById('profNextBtn1').addEventListener('click', async () => {
      const saved = await autoSaveInfo();
      if (saved) goToProfileStep(2);
    });

    // Generic next buttons on steps 2–5
    document.querySelectorAll('.pstep-next-btn').forEach(btn => {
      btn.addEventListener('click', () => goToProfileStep(_profileStep + 1));
    });

    // Generic back buttons on steps 2–6
    document.querySelectorAll('.pstep-back-btn').forEach(btn => {
      btn.addEventListener('click', () => goToProfileStep(_profileStep - 1));
    });

    // Done button on step 6
    document.getElementById('profDoneBtn').addEventListener('click', () => {
      document.getElementById('profileSection').style.display = 'none';
    });

    // SMS opt-in/out toggle on the Household Info tab
    const smsToggle = document.getElementById('profSmsOptIn');
    if (smsToggle) {
      smsToggle.addEventListener('change', async () => {
        const optedOut = !smsToggle.checked;
        const [ok] = await apiPost('/api/sms/preferences', { opted_out: optedOut ? 1 : 0 });
        if (!ok) smsToggle.checked = !smsToggle.checked;
        await loadSmsPreferences();
      });
    }
  }

  function goToProfileStep(step) {
    step = Math.max(1, Math.min(6, step));
    const panelIds = ['tab-info', 'tab-family', 'tab-pool-gate', 'tab-social', 'tab-photos', 'tab-publish'];
    panelIds.forEach((id, i) => {
      const panel = document.getElementById(id);
      if (panel) panel.classList.toggle('active', i + 1 === step);
    });

    document.querySelectorAll('.profile-step-item').forEach((el, i) => {
      const n = i + 1;
      const circle = el.querySelector('.pstep-circle');
      el.classList.remove('active', 'done');
      if (n === step) {
        el.classList.add('active');
        circle.textContent = n;
      } else if (n < step) {
        el.classList.add('done');
        circle.textContent = '✓';
      } else {
        circle.textContent = n;
      }
    });

    document.querySelectorAll('.profile-step-connector').forEach((el, i) => {
      el.classList.toggle('done', i + 1 < step);
    });

    _profileStep = step;
    document.getElementById('profileSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Refresh pool gate data whenever step 3 is entered
    if (step === 3) refreshPoolGateStep();
  }

  async function autoSaveInfo() {
    const statusEl = document.getElementById('autoSaveStatus');
    const displayNameVal = val('profDisplayName');

    if (!displayNameVal) {
      statusEl.textContent = '⚠ Display Name is required.';
      statusEl.className   = 'auto-save-status auto-save-error';
      document.getElementById('profDisplayName').focus();
      return false;
    }
    const phoneVal = val('profPhone');
    if (phoneVal && !FormValidation.isValidPhone(phoneVal)) {
      statusEl.textContent = '⚠ Phone number must be 10 digits.';
      statusEl.className   = 'auto-save-status auto-save-error';
      document.getElementById('profPhone').focus();
      return false;
    }

    statusEl.textContent = 'Saving…';
    statusEl.className   = 'auto-save-status auto-save-pending';

    const payload = {
      display_name:      displayNameVal,
      phone:             phoneVal,
      show_phone:        chk('profShowPhone')       ? 1 : 0,
      anniversary:       val('profAnniversary'),
      show_anniversary:  chk('profShowAnniversary') ? 1 : 0,
      interests:         val('profInterests'),
      show_interests:    chk('profShowInterests')   ? 1 : 0,
      notes:             val('profNotes'),
      show_notes:        chk('profShowNotes')       ? 1 : 0,
    };

    const [ok, msg] = await apiPost('/api/directory/profile', payload);
    if (ok) {
      statusEl.textContent = '✓ Saved';
      statusEl.className   = 'auto-save-status auto-save-ok';
      myProfile = await (await fetch('/api/directory/me')).json();
      loadDirectory();
      await loadSmsPreferences();
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className   = 'auto-save-status';
      }, 3000);
      return true;
    } else {
      statusEl.textContent = '⚠ ' + msg;
      statusEl.className   = 'auto-save-status auto-save-error';
      return false;
    }
  }

  // ── Family Tab ───────────────────────────────────────────────
  function initFamilyTab() {
    document.getElementById('addAdultBtn').addEventListener('click', addAdult);
    document.getElementById('addChildBtn').addEventListener('click', addChild);
    document.getElementById('addPetBtn').addEventListener('click', addPet);
    // Toggle phone/email fields when "16+" is checked in add-child row
    const is16Chk = document.getElementById('childIs16Plus');
    if (is16Chk) {
      is16Chk.addEventListener('change', () => {
        document.getElementById('addChildContactRow').style.display = is16Chk.checked ? 'flex' : 'none';
      });
    }
  }

  function renderAdults(list) {
    document.getElementById('adultsList').innerHTML = list.map(a => {
      const details = [
        a.birthday ? e(a.birthday) : '',
        a.phone && a.show_phone !== 0 ? `📞 ${e(a.phone)}` : (a.phone ? '📞 <em class="dir-hidden-hint">(hidden)</em>' : ''),
        a.email && a.show_email !== 0 ? `✉ ${e(a.email)}` : (a.email ? '✉ <em class="dir-hidden-hint">(hidden)</em>' : '')
      ].filter(Boolean).join(' · ');
      const smsOn = a.sms_opt_in ? 1 : 0;
      const showPhoneChk = a.show_phone !== 0 ? 'checked' : '';
      const showEmailChk = a.show_email !== 0 ? 'checked' : '';
      return `<div class="dir-list-item">
        <div class="dir-member-header">
          <strong class="dir-member-name">${e(a.name)}</strong>
          <div class="dir-item-actions">
            <button class="dir-edit-btn" data-id="${a.id}" data-type="adult" title="Edit">✎</button>
            <button class="dir-del-btn" data-id="${a.id}" data-type="adult" title="Remove">✕</button>
          </div>
        </div>
        ${details ? `<div class="dir-member-details">${details}${smsOn ? ' · <span class="dir-badge-sms">📱 SMS</span>' : ''}</div>` : (smsOn ? `<div class="dir-member-details"><span class="dir-badge-sms">📱 SMS</span></div>` : '')}
      </div>
      <div class="dir-edit-form" id="edit-adult-${a.id}" style="display:none;">
        <div class="dir-edit-fields">
          <div class="dir-edit-field">
            <label>Phone</label>
            <input type="tel" class="dir-input" id="edit-adult-phone-${a.id}" value="${e(a.phone || '')}" placeholder="Phone number">
          </div>
          <div class="dir-edit-field">
            <label>Email</label>
            <input type="email" class="dir-input" id="edit-adult-email-${a.id}" value="${e(a.email || '')}" placeholder="Email address">
          </div>
          <div class="dir-edit-field dir-edit-field-full dir-edit-visibility-row">
            <label class="dir-toggle" title="Show phone in directory">
              <input type="checkbox" id="edit-adult-showphone-${a.id}" ${showPhoneChk}>
              <span class="dir-toggle-slider"></span>
              <span class="dir-toggle-label">Show phone in directory</span>
            </label>
            <label class="dir-toggle" title="Show email in directory">
              <input type="checkbox" id="edit-adult-showemail-${a.id}" ${showEmailChk}>
              <span class="dir-toggle-slider"></span>
              <span class="dir-toggle-label">Show email in directory</span>
            </label>
          </div>
          <div class="dir-edit-field dir-edit-field-full">
            <label class="dir-toggle dir-toggle-sms">
              <input type="checkbox" id="edit-adult-sms-${a.id}" ${smsOn ? 'checked' : ''}>
              <span class="dir-toggle-slider"></span>
              <span class="dir-toggle-label">Enroll in HOA SMS text alerts</span>
            </label>
            <p class="dir-field-hint" style="margin-top:4px;">Requires a valid phone number above.</p>
          </div>
        </div>
        <div class="dir-edit-actions">
          <button class="btn btn-primary dir-save-btn" data-id="${a.id}" data-type="adult" type="button">Save</button>
          <button class="btn btn-outline dir-cancel-btn" data-id="${a.id}" data-type="adult" type="button">Cancel</button>
        </div>
      </div>`;
    }).join('');
    document.querySelectorAll('#adultsList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const adult = (myProfile?.adults || []).find(a => String(a.id) === String(btn.dataset.id));
        const name = adult?.name || 'this household member';
        if (!confirm(`Are you sure you want to delete ${name} from your household?\n\nThis action cannot be undone.`)) return;
        deleteItem('adults', btn.dataset.id);
      }));
    document.querySelectorAll('#adultsList .dir-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => toggleEditForm('adult', btn.dataset.id)));
    document.querySelectorAll('#adultsList .dir-cancel-btn').forEach(btn =>
      btn.addEventListener('click', () => toggleEditForm('adult', btn.dataset.id, false)));
    document.querySelectorAll('#adultsList .dir-save-btn').forEach(btn =>
      btn.addEventListener('click', () => saveAdult(btn.dataset.id)));
    // Attach phone mask + email validation to dynamically created edit inputs
    document.querySelectorAll('#adultsList input[type="tel"]').forEach(el => {
      FormValidation.maskPhone(el); FormValidation.validatePhoneInput(el);
    });
    document.querySelectorAll('#adultsList input[type="email"]').forEach(el => {
      FormValidation.validateEmailInput(el);
    });
  }

  function renderChildren(list) {
    document.getElementById('childrenList').innerHTML = list.map(c => {
      const bday = c.birth_month ? ` · ${e(c.birth_month)}${c.birth_day ? ' ' + c.birth_day : ''}` : '';
      const is16 = c.is_16_plus ? 1 : 0;
      const smsOn = c.sms_opt_in ? 1 : 0;
      const isVis = c.is_visible !== 0;
      const ageLabel = is16 ? ' · <span class="dir-badge-16plus">16+</span>' : '';
      const contactDetails = [
        c.phone ? `📞 ${e(c.phone)}` : '',
        c.email ? `✉ ${e(c.email)}` : ''
      ].filter(Boolean).join(' · ');
      const hiddenBadge = !isVis ? ' · <span class="dir-badge-hidden">hidden from directory</span>' : '';
      return `<div class="dir-list-item">
        <div class="dir-member-header">
          <strong class="dir-member-name">${e(c.first_name)}</strong>${ageLabel}
          <div class="dir-item-actions">
            <button class="dir-edit-btn" data-id="${c.id}" data-type="child" title="Edit">✎</button>
            <button class="dir-del-btn" data-id="${c.id}" data-type="child" title="Remove">✕</button>
          </div>
        </div>
        ${(bday || contactDetails || smsOn || !isVis) ? `<div class="dir-member-details">${bday.replace(' · ', '')}${contactDetails ? (bday ? ' · ' : '') + contactDetails : ''}${is16 && smsOn ? ' · <span class="dir-badge-sms">📱 SMS</span>' : ''}${hiddenBadge}</div>` : ''}
      </div>
      <div class="dir-edit-form" id="edit-child-${c.id}" style="display:none;">
        <div class="dir-edit-fields">
          <div class="dir-edit-field dir-edit-field-full">
            <label>Is this child 16 years old or older?</label>
            <div class="dir-radio-group">
              <label class="dir-radio"><input type="radio" name="child16-${c.id}" value="1" ${is16 ? 'checked' : ''} class="child-16-radio" data-id="${c.id}"> Yes</label>
              <label class="dir-radio"><input type="radio" name="child16-${c.id}" value="0" ${!is16 ? 'checked' : ''} class="child-16-radio" data-id="${c.id}"> No</label>
            </div>
          </div>
          <div class="dir-child-contact-fields" id="child-contact-${c.id}" style="display:${is16 ? 'flex' : 'none'};">
            <div class="dir-edit-field">
              <label>Phone</label>
              <input type="tel" class="dir-input" id="edit-child-phone-${c.id}" value="${e(c.phone || '')}" placeholder="Phone number">
            </div>
            <div class="dir-edit-field">
              <label>Email</label>
              <input type="email" class="dir-input" id="edit-child-email-${c.id}" value="${e(c.email || '')}" placeholder="Email address">
            </div>
            <div class="dir-edit-field dir-edit-field-full">
              <label class="dir-toggle dir-toggle-sms">
                <input type="checkbox" id="edit-child-sms-${c.id}" ${smsOn ? 'checked' : ''}>
                <span class="dir-toggle-slider"></span>
                <span class="dir-toggle-label">Enroll in HOA SMS text alerts</span>
              </label>
              <p class="dir-field-hint" style="margin-top:4px;">Requires a valid phone number above.</p>
            </div>
          </div>
          <div class="dir-edit-field dir-edit-field-full">
            <label class="dir-toggle">
              <input type="checkbox" id="edit-child-visible-${c.id}" ${isVis ? 'checked' : ''}>
              <span class="dir-toggle-slider"></span>
              <span class="dir-toggle-label">Show in directory</span>
            </label>
            <p class="dir-field-hint" style="margin-top:4px;">Hiding from the directory does not affect pool gate access or SMS alerts.</p>
          </div>
        </div>
        <div class="dir-edit-actions">
          <button class="btn btn-primary dir-save-btn" data-id="${c.id}" data-type="child" type="button">Save</button>
          <button class="btn btn-outline dir-cancel-btn" data-id="${c.id}" data-type="child" type="button">Cancel</button>
        </div>
      </div>`;
    }).join('');
    document.querySelectorAll('#childrenList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const child = (myProfile?.children || []).find(c => String(c.id) === String(btn.dataset.id));
        const name = child?.first_name || 'this household member';
        if (!confirm(`Are you sure you want to delete ${name} from your household?\n\nThis action cannot be undone.`)) return;
        deleteItem('children', btn.dataset.id);
      }));
    document.querySelectorAll('#childrenList .dir-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => toggleEditForm('child', btn.dataset.id)));
    document.querySelectorAll('#childrenList .dir-cancel-btn').forEach(btn =>
      btn.addEventListener('click', () => toggleEditForm('child', btn.dataset.id, false)));
    document.querySelectorAll('#childrenList .dir-save-btn').forEach(btn =>
      btn.addEventListener('click', () => saveChild(btn.dataset.id)));
    document.querySelectorAll('#childrenList .child-16-radio').forEach(radio =>
      radio.addEventListener('change', (ev) => {
        const id = ev.target.dataset.id;
        const show = ev.target.value === '1';
        const contactEl = document.getElementById('child-contact-' + id);
        if (contactEl) contactEl.style.display = show ? 'flex' : 'none';
      }));
    // Attach phone mask + email validation to dynamically created edit inputs
    document.querySelectorAll('#childrenList input[type="tel"]').forEach(el => {
      FormValidation.maskPhone(el); FormValidation.validatePhoneInput(el);
    });
    document.querySelectorAll('#childrenList input[type="email"]').forEach(el => {
      FormValidation.validateEmailInput(el);
    });
  }

  function renderPets(list) {
    document.getElementById('petsList').innerHTML = list.map(p =>
      `<div class="dir-list-item">
        <div class="dir-member-header">
          <span>${e(p.name)}${p.pet_type ? ` <em style="color:#888;font-size:.85em;">(${e(p.pet_type)})</em>` : ''}</span>
          <button class="dir-del-btn" data-id="${p.id}" data-type="pet" title="Remove">✕</button>
        </div>
      </div>`
    ).join('');
    document.querySelectorAll('#petsList .dir-del-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteItem('pets', btn.dataset.id)));
  }

  function toggleEditForm(type, id, show) {
    const form = document.getElementById(`edit-${type}-${id}`);
    if (!form) return;
    if (typeof show === 'undefined') show = form.style.display === 'none';
    form.style.display = show ? 'block' : 'none';
  }

  async function saveAdult(id) {
    const phone = document.getElementById('edit-adult-phone-' + id)?.value.trim() || '';
    const email = document.getElementById('edit-adult-email-' + id)?.value.trim() || '';
    const sms_opt_in  = document.getElementById('edit-adult-sms-'       + id)?.checked ? 1 : 0;
    const show_phone  = document.getElementById('edit-adult-showphone-'  + id)?.checked ? 1 : 0;
    const show_email  = document.getElementById('edit-adult-showemail-'  + id)?.checked ? 1 : 0;
    if (sms_opt_in && !phone) { alert('A phone number is required to enroll in SMS alerts.'); return; }
    if (phone && !FormValidation.isValidPhone(phone)) { alert('Please enter a valid phone number.'); return; }
    if (email && !FormValidation.isValidEmail(email)) { alert('Please enter a valid email address.'); return; }
    const r = await fetch('/api/directory/adults/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, email, sms_opt_in, show_phone, show_email })
    });
    const data = await r.json();
    if (!r.ok || !data.success) { alert(data.error || 'Failed to save.'); return; }
    const adultBtn = document.querySelector(`#adultsList .dir-save-btn[data-id="${id}"]`);
    markSaved(adultBtn);
    setTimeout(async () => {
      await refreshProfile();
      await loadSmsPreferences();
    }, 3000);
  }

  async function saveChild(id) {
    const is16Radio = document.querySelector(`input[name="child16-${id}"]:checked`);
    const is_16_plus = is16Radio ? parseInt(is16Radio.value) : 0;
    const phone = is_16_plus ? (document.getElementById('edit-child-phone-' + id)?.value.trim() || '') : '';
    const email = is_16_plus ? (document.getElementById('edit-child-email-' + id)?.value.trim() || '') : '';
    const sms_opt_in = is_16_plus ? (document.getElementById('edit-child-sms-' + id)?.checked ? 1 : 0) : 0;
    const is_visible = document.getElementById('edit-child-visible-' + id)?.checked ? 1 : 0;
    if (sms_opt_in && !phone) { alert('A phone number is required to enroll in SMS alerts.'); return; }
    if (phone && !FormValidation.isValidPhone(phone)) { alert('Please enter a valid phone number.'); return; }
    if (email && !FormValidation.isValidEmail(email)) { alert('Please enter a valid email address.'); return; }
    const r = await fetch('/api/directory/children/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_16_plus, phone, email, sms_opt_in, is_visible })
    });
    const data = await r.json();
    if (!r.ok || !data.success) { alert(data.error || 'Failed to save.'); return; }
    const childBtn = document.querySelector(`#childrenList .dir-save-btn[data-id="${id}"]`);
    markSaved(childBtn);
    setTimeout(async () => {
      await refreshProfile();
      await loadSmsPreferences();
    }, 3000);
  }


  async function addAdult() {
    const name         = val('adultName');  if (!name) return;
    const birthday     = val('adultBirthday');
    const show_birthday = chk('adultShowBday') ? 1 : 0;
    const phone        = val('adultPhone');
    const email        = val('adultEmail');
    const sms_opt_in   = chk('adultSmsOptIn') ? 1 : 0;
    if (phone && !FormValidation.isValidPhone(phone)) return;
    if (email && !FormValidation.isValidEmail(email)) return;
    if (sms_opt_in && !phone) { alert('A phone number is required to enroll in SMS alerts.'); return; }
    const [ok] = await apiPost('/api/directory/adults', { name, birthday, show_birthday, phone, email, sms_opt_in });
    if (ok) {
      clearInputs('adultName', 'adultBirthday', 'adultPhone', 'adultEmail');
      document.getElementById('adultSmsOptIn').checked = false;
      await refreshProfile();
    }
  }

  async function addChild() {
    const first_name   = val('childName');  if (!first_name) return;
    const birth_month  = val('childMonth');
    const birth_day    = val('childDay');
    const show_birthday = chk('childShowBday') ? 1 : 0;
    const is_16_plus   = chk('childIs16Plus') ? 1 : 0;
    const phone        = is_16_plus ? val('childPhone') : '';
    const email        = is_16_plus ? val('childEmail') : '';
    if (phone && !FormValidation.isValidPhone(phone)) return;
    if (email && !FormValidation.isValidEmail(email)) return;
    const [ok] = await apiPost('/api/directory/children', { first_name, birth_month, birth_day, show_birthday, is_16_plus, phone, email });
    if (ok) {
      clearInputs('childName', 'childDay', 'childPhone', 'childEmail');
      document.getElementById('childMonth').value = '';
      document.getElementById('childIs16Plus').checked = false;
      document.getElementById('addChildContactRow').style.display = 'none';
      await refreshProfile();
    }
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
        <div class="dir-member-header">
          <span>${e(s.platform)} — <a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.url)}</a></span>
          <button class="dir-del-btn" data-id="${s.id}" data-type="social" title="Remove">✕</button>
        </div>
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

  function initSmsPreferences() {
    const outBtn = document.getElementById('smsOptOutBtn');
    const inBtn = document.getElementById('smsOptInBtn');

    if (outBtn) {
      outBtn.addEventListener('click', async () => {
        const [ok, msg] = await apiPost('/api/sms/preferences', { opted_out: 1 });
        showNotif(msg, !ok);
        if (ok) {
          await loadSmsPreferences();
        }
      });
    }

    if (inBtn) {
      inBtn.addEventListener('click', async () => {
        const [ok, msg] = await apiPost('/api/sms/preferences', { opted_out: 0 });
        showNotif(msg, !ok);
        if (ok) {
          await loadSmsPreferences();
        }
      });
    }
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

  // ── Pool Gate Step ───────────────────────────────────────────
  let _poolCardStatus = null;

  async function refreshPoolGateStep() {
    await refreshPoolPhones();
    renderPoolGateHouseholdPhones();
    await loadPoolCardStatus();
  }

  function renderPoolGateHouseholdPhones() {
    const container = document.getElementById('poolGateHouseholdPhones');
    if (!container) return;
    const adults   = (myProfile && myProfile.adults)   || [];
    const children = (myProfile && myProfile.children) || [];
    const rows = [
      ...adults.map(a => ({ type: 'adult', id: a.id, name: a.name })),
      ...children.filter(c => c.is_16_plus).map(c => ({ type: 'child', id: c.id, name: c.first_name }))
    ];
    if (!rows.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = rows.map(r =>
      `<div class="dir-pool-phone-row" data-pp-person-type="${r.type}" data-pp-person-id="${e(String(r.id))}" data-pp-person-name="${e(r.name)}"></div>`
    ).join('');
    container.querySelectorAll('.dir-pool-phone-row').forEach(box => {
      const pt = box.dataset.ppPersonType;
      const pid = box.dataset.ppPersonId;
      const pname = box.dataset.ppPersonName;
      box.innerHTML = buildPhoneRowInner(pt, pid, pname);
      attachRowHandlers(box);
    });
  }

  async function loadPoolCardStatus() {
    try {
      const r = await fetch('/api/directory/me/pool-card-status');
      if (!r.ok) return;
      _poolCardStatus = await r.json();
      renderPoolCardStatus();
    } catch {}
  }

  function renderPoolCardStatus() {
    const statusEl    = document.getElementById('poolCardStatus');
    const instructEl  = document.getElementById('poolCardInstructions');
    const actionsEl   = document.getElementById('poolCardActions');
    if (!statusEl || !actionsEl) return;

    if (!_poolCardStatus) {
      statusEl.innerHTML = '<span class="dir-pp-status-none">Unable to load card status.</span>';
      instructEl.style.display = 'none';
      actionsEl.innerHTML = '';
      return;
    }

    if (_poolCardStatus.no_pool_record) {
      statusEl.innerHTML = `<div class="dir-pp-info"><span class="dir-pp-status-none">
        Your pool membership record has not been set up yet.
        Contact the HOA admin to be added as a pool member before requesting key cards.
      </span></div>`;
      instructEl.style.display = 'none';
      actionsEl.innerHTML = '';
      return;
    }

    const active    = _poolCardStatus.active_cards    || 0;
    const requested = _poolCardStatus.cards_requested || 0;
    const max       = _poolCardStatus.max_cards       || 2;
    const total     = active + requested;

    // Build card slot rows
    let slotsHtml = '';
    for (let i = 0; i < active; i++) {
      slotsHtml += `<div class="pool-card-slot">
        <span class="pool-card-slot-icon">💳</span>
        <span class="dir-pp-status-active">Key Card ${i + 1} — Active (registered at pool)</span>
      </div>`;
    }
    for (let i = 0; i < requested; i++) {
      slotsHtml += `<div class="pool-card-slot">
        <span class="pool-card-slot-icon">💳</span>
        <span class="dir-pp-status-pending">Key Card ${active + i + 1} — Request pending
          &nbsp;<small style="font-weight:400;color:#888;">Present at the pool entry gate to complete registration.</small>
        </span>
      </div>`;
    }
    statusEl.innerHTML = slotsHtml || `<div class="dir-pp-info"><span class="dir-pp-status-none">No key cards on file</span></div>`;

    // Instructions box
    instructEl.style.display = (total < max) ? '' : 'none';

    // Action buttons
    const canRequest = total < max;
    const canRequestTwo = (total + 1) < max;
    let actionsHtml = '';

    if (canRequest) {
      actionsHtml += `<button class="btn btn-primary" type="button" id="requestCard1Btn">Request 1 Key Card</button>`;
      if (canRequestTwo) {
        actionsHtml += ` <button class="btn btn-outline" type="button" id="requestCard2Btn" style="margin-left:.5rem;">Request 2 Key Cards</button>`;
      }
    }
    if (requested > 0) {
      actionsHtml += `<button class="btn btn-outline dir-danger-btn" type="button" id="cancelCardRequestBtn" style="margin-left:.5rem;">Cancel ${requested === 2 ? 'All ' : ''}Requests</button>`;
    }
    if (active === max) {
      actionsHtml = `<p class="dir-field-hint" style="margin:0;">Your family has reached the maximum of ${max} RFID key cards. To replace or deactivate a card, visit the pool office.</p>`;
    }

    actionsEl.innerHTML = actionsHtml;

    const btn1 = document.getElementById('requestCard1Btn');
    if (btn1) btn1.addEventListener('click', () => requestPoolCard(1));
    const btn2 = document.getElementById('requestCard2Btn');
    if (btn2) btn2.addEventListener('click', () => requestPoolCard(2));
    const cancelBtn = document.getElementById('cancelCardRequestBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelPoolCardRequest);
  }

  async function requestPoolCard(quantity) {
    const statusEl = document.getElementById('poolCardRequestStatus');
    statusEl.textContent = 'Sending request…';
    statusEl.className = 'dir-save-msg';
    const [ok, msg] = await apiPost('/api/directory/me/pool-card-request', { quantity });
    if (ok) {
      const label = quantity === 2 ? '2 key cards' : '1 key card';
      statusEl.textContent = `✓ Request for ${label} sent! Bring yourself to the pool gate to complete registration.`;
      statusEl.className = 'dir-save-msg dir-save-msg-ok';
      await loadPoolCardStatus();
    } else {
      statusEl.textContent = '⚠ ' + msg;
      statusEl.className = 'dir-save-msg dir-save-msg-error';
    }
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'dir-save-msg'; }, 6000);
  }

  async function cancelPoolCardRequest() {
    const statusEl = document.getElementById('poolCardRequestStatus');
    const [ok, msg] = await apiPost('/api/directory/me/pool-card-request', { cancel: true });
    if (ok) {
      await loadPoolCardStatus();
    } else {
      statusEl.textContent = '⚠ ' + msg;
      statusEl.className = 'dir-save-msg dir-save-msg-error';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'dir-save-msg'; }, 4000);
    }
  }

  // ── Pool Phone Access ────────────────────────────────────────
  let _poolPhones = [];
  let _ppmCtx = null; // { person_type, person_id, person_name }

  function initPoolPhones() {
    const modal = document.getElementById('poolPhoneModal');
    if (!modal) return;
    document.getElementById('ppmCloseBtn').addEventListener('click', closePoolPhoneModal);
    modal.querySelector('.dir-modal-backdrop').addEventListener('click', closePoolPhoneModal);
    document.getElementById('ppmDoneBtn').addEventListener('click', closePoolPhoneModal);
    document.getElementById('ppmRegIosBtn').addEventListener('click', () => submitPoolPhoneRegistration('ios'));
    document.getElementById('ppmRegAndroidBtn').addEventListener('click', () => submitPoolPhoneRegistration('android'));
  }

  async function refreshPoolPhones() {
    try {
      const r = await fetch('/api/directory/me/pool-phones');
      if (!r.ok) return;
      const data = await r.json();
      _poolPhones = data.phones || [];
      renderPoolPhoneRows();
    } catch (err) {
      console.warn('refreshPoolPhones failed', err);
    }
  }

  function findPhoneFor(personType, personId) {
    return _poolPhones.find(p =>
      p.status === 'active' &&
      p.person_type === personType &&
      ((personType === 'self' && !p.person_id) ||
       (p.person_id && String(p.person_id) === String(personId)))
    );
  }

  function renderPoolPhoneRows() {
    const selfBox = document.getElementById('poolPhoneSelf');
    if (selfBox) {
      const me = myProfile && myProfile.user;
      const myName = me ? `${me.first_name} ${me.last_name}` : 'Me';
      selfBox.dataset.ppPersonType = 'self';
      selfBox.dataset.ppPersonId = '';
      selfBox.dataset.ppPersonName = myName;
      selfBox.innerHTML = buildPhoneRowInner('self', null, myName);
      attachRowHandlers(selfBox);
    }
    document.querySelectorAll('.dir-pool-phone-row[data-pp-person-type]').forEach(box => {
      const pt = box.dataset.ppPersonType;
      if (pt === 'self') return;
      const pid = box.dataset.ppPersonId;
      const pname = box.dataset.ppPersonName || '';
      box.innerHTML = buildPhoneRowInner(pt, pid, pname);
      attachRowHandlers(box);
    });
  }

  function buildPhoneRowInner(personType, personId, personName) {
    const phone = findPhoneFor(personType, personId);
    let info, actionsHtml;
    if (phone) {
      const platform = phone.device_platform === 'ios' ? 'iPhone' : 'Android';
      const label = phone.device_label ? ` &mdash; ${e(phone.device_label)}` : '';
      const walletStatus = phone.wallet_pass_status === 'sent'
        ? `<span class="dir-pp-status-active">✓ Wallet pass sent</span>`
        : `<span class="dir-pp-status-pending">⏳ Wallet pass pending — admin will email it to you</span>`;
      const guestStatus = phone.is_active_guest
        ? `<span class="dir-pp-status-active">✓ Active pool guest</span>`
        : `<span class="dir-pp-status-pending">⏳ Awaiting admin to activate as pool guest</span>`;
      info = `<div class="dir-pp-info">
        <span class="dir-pp-platform-badge">${e(platform)}</span>
        <strong>${e(personName)}</strong>${label}<br>
        ${walletStatus}<br>
        ${guestStatus}
      </div>`;
      actionsHtml = `<div class="dir-pp-actions">
        <button class="btn btn-outline dir-pp-replace-btn" type="button">Replace Phone</button>
        <button class="btn btn-outline dir-pp-revoke-btn" data-pp-id="${e(phone.id)}" type="button">Remove</button>
      </div>`;
    } else {
      info = `<div class="dir-pp-info">
        <strong>${e(personName)}</strong><br>
        <span class="dir-pp-status-none">No phone registered for pool gate access</span>
      </div>`;
      actionsHtml = `<div class="dir-pp-actions">
        <button class="btn btn-primary dir-pp-register-btn" type="button">Register Phone</button>
      </div>`;
    }
    return info + actionsHtml;
  }

  function attachRowHandlers(box) {
    const pt = box.dataset.ppPersonType;
    const pid = box.dataset.ppPersonId || null;
    const pname = box.dataset.ppPersonName || '';
    const reg = box.querySelector('.dir-pp-register-btn');
    if (reg) reg.addEventListener('click', () => openPoolPhoneModal(pt, pid, pname));
    const rep = box.querySelector('.dir-pp-replace-btn');
    if (rep) rep.addEventListener('click', () => openPoolPhoneModal(pt, pid, pname));
    const rev = box.querySelector('.dir-pp-revoke-btn');
    if (rev) rev.addEventListener('click', () => revokePoolPhone(rev.dataset.ppId));
  }

  function openPoolPhoneModal(personType, personId, personName) {
    _ppmCtx = { person_type: personType, person_id: personId, person_name: personName };
    document.getElementById('ppmPersonName').textContent = personName;
    document.getElementById('ppmDeviceLabel').value = '';
    document.getElementById('ppmStepChoose').style.display = '';
    document.getElementById('ppmStepShow').style.display = 'none';
    const phone = findPhoneFor(personType, personId);
    const status = document.getElementById('ppmGuestStatus');
    if (phone && phone.is_active_guest) {
      status.textContent = '✓ This person is currently an active pool guest. Their new phone will work immediately at the gate.';
      status.className = 'dir-pp-guest-status is-active';
    } else {
      status.textContent = 'ⓘ This person is not yet listed as an active pool guest. The admin must add them in the pool member list before the phone will open the gate.';
      status.className = 'dir-pp-guest-status';
    }
    document.getElementById('poolPhoneModal').style.display = 'flex';
  }

  function closePoolPhoneModal() {
    document.getElementById('poolPhoneModal').style.display = 'none';
    _ppmCtx = null;
  }

  async function submitPoolPhoneRegistration(platform) {
    if (!_ppmCtx) return;
    const label = document.getElementById('ppmDeviceLabel').value.trim();
    const payload = {
      person_type: _ppmCtx.person_type,
      person_id: _ppmCtx.person_id || null,
      device_platform: platform,
      device_label: label
    };
    const r = await fetch('/api/directory/me/pool-phones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      alert(data.error || 'Registration failed.');
      return;
    }
    showEnrollmentResult(platform);
    await refreshPoolPhones();
  }

  function showEnrollmentResult(platform) {
    document.getElementById('ppmStepChoose').style.display = 'none';
    document.getElementById('ppmStepShow').style.display = '';
    document.getElementById('ppmPlatformLabel').textContent = platform === 'ios' ? 'iPhone' : 'Android phone';
  }

  async function revokePoolPhone(id) {
    if (!confirm('Remove this phone? It will no longer open the pool gate.')) return;
    const r = await fetch(`/api/directory/me/pool-phones/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) await refreshPoolPhones();
    else alert('Failed to remove phone.');
  }

  // ── Shared Helpers ───────────────────────────────────────────
  async function refreshProfile() {
    myProfile = await (await fetch('/api/directory/me')).json();
    // Only refresh sub-lists (family, social, photos, pool phones) — do NOT
    // overwrite Household Info fields, which the user may have edited but not
    // yet saved.
    if (!myProfile) return;
    renderAdults(myProfile.adults     || []);
    renderChildren(myProfile.children || []);
    renderPets(myProfile.pets         || []);
    renderSocial(myProfile.social     || []);
    renderPhotos(myProfile.photos     || []);
    refreshPoolPhones();
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

  function markSaved(btn) {
    if (!btn) return;
    const origText = btn.textContent;
    const origBg = btn.style.background;
    const origColor = btn.style.color;
    btn.textContent = '✓ Saved';
    btn.classList.add('btn-saved');
    btn.style.background = '#6c757d';
    btn.style.color = '#fff';
    btn.disabled = true;
    clearTimeout(btn._savedT);
    btn._savedT = setTimeout(() => {
      btn.textContent = origText;
      btn.classList.remove('btn-saved');
      btn.style.background = origBg;
      btn.style.color = origColor;
      btn.disabled = false;
    }, 3000);
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

  // Expose for inline onclick in HTML cross-link buttons
  window.goToProfileStepPublic = goToProfileStep;

})();
