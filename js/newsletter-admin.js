/* ════════════════════════════════════════════
   Newsletter Admin — newsletter-admin.js
   ════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────
let state = {
  currentNlId: null,
  currentNl: null,
  blocks: [],
  dirty: false,
  view: 'welcome',        // welcome | editor | analytics | subscribers
  sideView: 'list',       // list | subscribers
  previewMode: 'desktop'  // desktop | mobile
};

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const me = await apiFetch('/api/admin/status');
  if (!me || !me.isAdmin) { location.href = 'admin.html'; return; }

  wireNav();
  wireSidebar();
  wireEditor();
  wireModals();
  await loadNlList();
  showView('welcome');
});

// ── API helpers ───────────────────────────────
async function apiFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('json')) return res.json();
    return { ok: res.ok };
  } catch { return null; }
}

function toast(msg, isError = false) {
  const el = document.getElementById('nlToast');
  el.textContent = msg;
  el.className = 'nl-toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'nl-toast'; }, 3200);
}

// ── Nav ───────────────────────────────────────
function wireNav() {
  document.getElementById('btnNewNl').addEventListener('click', newNewsletter);
}

// ── Sidebar nav ───────────────────────────────
function wireSidebar() {
  document.querySelectorAll('.nl-sidenav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nl-sidenav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      state.sideView = v;
      if (v === 'list') {
        loadNlList();
        if (state.view === 'subscribers') showView('welcome');
      } else if (v === 'subscribers') {
        showView('subscribers');
        loadSubscribers();
      }
    });
  });
}

// ── Views ─────────────────────────────────────
function showView(name) {
  state.view = name;
  document.querySelectorAll('.nl-view').forEach(v => v.classList.remove('active'));
  const el = {
    welcome:     document.getElementById('viewWelcome'),
    editor:      document.getElementById('viewEditor'),
    analytics:   document.getElementById('viewAnalytics'),
    subscribers: document.getElementById('viewSubscribers')
  }[name];
  if (el) el.classList.add('active');
}

// ── Newsletter List ───────────────────────────
async function loadNlList() {
  const listEl = document.getElementById('nlList');
  listEl.innerHTML = '<div class="nl-list-empty">Loading...</div>';
  const nls = await apiFetch('/api/nl/newsletters');
  if (!Array.isArray(nls) || nls.length === 0) {
    listEl.innerHTML = '<div class="nl-list-empty">No newsletters yet. Click + New Newsletter to create one.</div>';
    return;
  }
  listEl.innerHTML = '';
  nls.forEach(nl => {
    const div = document.createElement('div');
    div.className = 'nl-list-item' + (nl.id === state.currentNlId ? ' active' : '');
    div.dataset.id = nl.id;
    const sentStr = nl.sent_at ? `Sent ${new Date(nl.sent_at).toLocaleDateString()}` : `Updated ${new Date(nl.updated_at || nl.created_at).toLocaleDateString()}`;
    div.innerHTML = `
      <div class="nl-list-item-title">${nl.subject || '(Untitled)'}</div>
      <div class="nl-list-item-meta">
        <span class="nl-pill nl-pill-${nl.status}">${nl.status}</span>
        <span>${sentStr}</span>
      </div>
      <div class="nl-list-item-actions">
        <button class="nl-list-item-btn edit" data-id="${nl.id}">Edit</button>
        ${nl.status === 'sent' ? `<button class="nl-list-item-btn analytics" data-id="${nl.id}">Analytics</button>` : ''}
        <button class="nl-list-item-btn delete" data-id="${nl.id}">Delete</button>
      </div>`;
    div.querySelector('.nl-list-item-btn.edit').addEventListener('click', e => { e.stopPropagation(); openNl(nl.id); });
    if (nl.status === 'sent') {
      div.querySelector('.nl-list-item-btn.analytics').addEventListener('click', e => { e.stopPropagation(); openAnalytics(nl.id, nl.subject); });
    }
    div.querySelector('.nl-list-item-btn.delete').addEventListener('click', e => { e.stopPropagation(); deleteNl(nl.id, div); });
    div.addEventListener('click', () => openNl(nl.id));
    listEl.appendChild(div);
  });
}

// ── Create newsletter ─────────────────────────
async function newNewsletter() {
  const data = await apiFetch('/api/nl/newsletters', {
    method: 'POST',
    body: JSON.stringify({ subject: 'Untitled Newsletter', preview_text: '', html_content: '', blocks_json: '[]' })
  });
  if (data && data.id) {
    await loadNlList();
    openNl(data.id);
  } else {
    toast('Could not create newsletter.', true);
  }
}

// ── Open newsletter in editor ─────────────────
async function openNl(id) {
  const nl = await apiFetch(`/api/nl/newsletters/${id}`);
  if (!nl) { toast('Could not load newsletter.', true); return; }
  state.currentNlId = id;
  state.currentNl = nl;
  state.dirty = false;

  // Update sidebar active item
  document.querySelectorAll('.nl-list-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));

  // Populate fields
  document.getElementById('nlSubject').value = nl.subject || '';
  document.getElementById('nlPreview').value = nl.preview_text || '';

  // Status badge
  const badge = document.getElementById('editorStatus');
  badge.textContent = nl.status.charAt(0).toUpperCase() + nl.status.slice(1);
  badge.className = 'nl-status-badge' + (nl.status === 'sent' ? ' sent' : '');

  // Lock fields if sent
  const isSent = nl.status === 'sent';
  ['nlSubject','nlPreview'].forEach(id => { document.getElementById(id).disabled = isSent; });
  document.getElementById('btnSaveDraft').disabled = isSent;
  document.getElementById('btnSendAll').disabled = isSent;
  document.querySelectorAll('.nl-add-block').forEach(b => b.disabled = isSent);

  // Load blocks
  try { state.blocks = JSON.parse(nl.blocks_json || '[]'); } catch { state.blocks = []; }
  renderBlocks();
  updatePreview();
  showView('editor');
}

// ── Delete newsletter ─────────────────────────
async function deleteNl(id, itemEl) {
  if (!confirm('Delete this newsletter? This cannot be undone.')) return;
  const d = await apiFetch(`/api/nl/newsletters/${id}`, { method: 'DELETE' });
  if (d && d.success) {
    if (state.currentNlId === id) { state.currentNlId = null; showView('welcome'); }
    itemEl.remove();
    toast('Newsletter deleted.');
  } else {
    toast('Delete failed.', true);
  }
}

// ── Editor wiring ─────────────────────────────
function wireEditor() {
  document.getElementById('nlSubject').addEventListener('input', () => { state.dirty = true; updatePreview(); });
  document.getElementById('nlPreview').addEventListener('input', () => { state.dirty = true; updatePreview(); });

  document.querySelectorAll('.nl-add-block').forEach(btn => {
    btn.addEventListener('click', () => addBlock(btn.dataset.type));
  });

  document.getElementById('btnSaveDraft').addEventListener('click', saveDraft);
  document.getElementById('btnTestSend').addEventListener('click', () => openModal('testModal'));
  document.getElementById('btnSendAll').addEventListener('click', () => openModal('sendModal'));
  document.getElementById('btnBackToEditor').addEventListener('click', () => openNl(state.currentNlId));

  // Preview toggle
  document.querySelectorAll('.nl-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nl-preview-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.previewMode = btn.dataset.mode;
      const frame = document.getElementById('nlPreviewFrame');
      frame.className = `nl-preview-frame ${state.previewMode}`;
    });
  });
}

// ── Save draft ────────────────────────────────
async function saveDraft() {
  if (!state.currentNlId) return;
  const payload = {
    subject:      document.getElementById('nlSubject').value,
    preview_text: document.getElementById('nlPreview').value,
    blocks_json:  JSON.stringify(state.blocks),
    html_content: buildHtml()
  };
  const d = await apiFetch(`/api/nl/newsletters/${state.currentNlId}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (d && d.success) { state.dirty = false; toast('Saved.'); } else { toast('Save failed.', true); }
}

// ── Block management ─────────────────────────
function addBlock(type) {
  const id = `b_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  const defaults = {
    header:    { type:'header',    text:'Community Update', level:'h2', align:'center', color:'#2d6a4f' },
    text:      { type:'text',      text:'Write your message here...' },
    image:     { type:'image',     src:'', alt:'', link:'' },
    button:    { type:'button',    label:'Click Here', url:'https://', align:'center', bgColor:'#2d6a4f', textColor:'#ffffff' },
    divider:   { type:'divider',   color:'#e0e0e0', height:'1' },
    'two-col': { type:'two-col',   leftText:'Left column content.', rightText:'Right column content.' },
    video:     { type:'video',     url:'', thumbnailUrl:'' },
    logo:      { type:'logo',      src:'', alt:'Glenridge Community', link:'', width:'200', align:'center' },
    article:   { type:'article',   title:'Article Title', text:'Article summary text...', imageUrl:'', linkUrl:'', linkLabel:'Read More' },
    social:    { type:'social',    align:'center', facebook:'', twitter:'', instagram:'', website:'' },
    signature: { type:'signature', name:'Glenridge HOA Board', title:'', email:'', phone:'' },
    spacer:    { type:'spacer',    height:'32' },
    html:      { type:'html',      code:'<div>Custom HTML here</div>' }
  };
  state.blocks.push({ id, ...defaults[type] });
  renderBlocks();
  updatePreview();
  state.dirty = true;
}

function removeBlock(id) {
  state.blocks = state.blocks.filter(b => b.id !== id);
  renderBlocks();
  updatePreview();
  state.dirty = true;
}

function moveBlock(id, dir) {
  const idx = state.blocks.findIndex(b => b.id === id);
  if (idx === -1) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.blocks.length) return;
  [state.blocks[idx], state.blocks[newIdx]] = [state.blocks[newIdx], state.blocks[idx]];
  renderBlocks();
  updatePreview();
  state.dirty = true;
}

function updateBlock(id, field, value) {
  const block = state.blocks.find(b => b.id === id);
  if (block) { block[field] = value; state.dirty = true; updatePreview(); }
}

// ── Render blocks ─────────────────────────────
function renderBlocks() {
  const canvas = document.getElementById('nlBlocks');
  canvas.innerHTML = '';
  if (!state.blocks.length) {
    canvas.innerHTML = '<div class="nl-blocks-empty">No blocks yet. Add a block above to start building your email.</div>';
    return;
  }
  state.blocks.forEach((block, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'nl-block';
    wrapper.dataset.id = block.id;
    wrapper.innerHTML = `
      <div class="nl-block-handle">
        <div class="nl-block-handle-left">
          <span class="nl-drag-icon">⠿</span>
          <span>${blockLabel(block.type)}</span>
        </div>
        <div class="nl-block-controls">
          ${idx > 0 ? `<button class="nl-block-ctrl move-up" data-id="${block.id}">↑</button>` : ''}
          ${idx < state.blocks.length-1 ? `<button class="nl-block-ctrl move-down" data-id="${block.id}">↓</button>` : ''}
          <button class="nl-block-ctrl del" data-id="${block.id}">Remove</button>
        </div>
      </div>
      <div class="nl-block-body">${renderBlockEditor(block)}</div>`;

    wrapper.querySelector('.nl-block-ctrl.del').addEventListener('click', () => removeBlock(block.id));
    const ub = wrapper.querySelector('.move-up');
    const db = wrapper.querySelector('.move-down');
    if (ub) ub.addEventListener('click', () => moveBlock(block.id, -1));
    if (db) db.addEventListener('click', () => moveBlock(block.id,  1));
    bindBlockInputs(wrapper, block);
    canvas.appendChild(wrapper);
  });
}

function blockLabel(type) {
  return { header:'Header', text:'Text', image:'Image', button:'Button', divider:'Divider', 'two-col':'Row (2-Column)', video:'Video', logo:'Logo', article:'Article', social:'Social', signature:'Signature', spacer:'Spacer', html:'HTML' }[type] || type;
}

function renderBlockEditor(block) {
  switch (block.type) {
    case 'header':
      return `
        <div class="nl-block-row" style="margin-bottom:8px">
          <div>
            <label class="nl-label">Tag</label>
            <select class="nl-block-field" data-field="level">
              <option value="h1" ${block.level==='h1'?'selected':''}>H1</option>
              <option value="h2" ${block.level==='h2'?'selected':''}>H2</option>
              <option value="h3" ${block.level==='h3'?'selected':''}>H3</option>
            </select>
          </div>
          <div>
            <label class="nl-label">Align</label>
            <select class="nl-block-field" data-field="align">
              <option value="left"   ${block.align==='left'  ?'selected':''}>Left</option>
              <option value="center" ${block.align==='center'?'selected':''}>Center</option>
              <option value="right"  ${block.align==='right' ?'selected':''}>Right</option>
            </select>
          </div>
        </div>
        <label class="nl-label">Heading Text</label>
        <input type="text" class="nl-block-field" data-field="text" value="${esc(block.text)}">
        <label class="nl-label" style="margin-top:8px">Color</label>
        <input type="color" class="nl-block-field" data-field="color" value="${block.color||'#2d6a4f'}" style="padding:4px;height:36px">`;

    case 'text':
      return `
        <label class="nl-label">Content (HTML allowed)</label>
        <textarea class="nl-block-field" data-field="text" rows="5" style="font-family:monospace;font-size:.83rem">${esc(block.text)}</textarea>`;

    case 'image':
      return `
        ${block.src ? `<img src="${esc(block.src)}" class="nl-img-preview" alt="preview">` : ''}
        <button class="nl-img-upload-btn" type="button" data-id="${block.id}">📷 Click to upload image</button>
        <label class="nl-label" style="margin-top:8px">Alt text</label>
        <input type="text" class="nl-block-field" data-field="alt" value="${esc(block.alt||'')}">
        <label class="nl-label" style="margin-top:8px">Link URL (optional)</label>
        <input type="url" class="nl-block-field" data-field="link" value="${esc(block.link||'')}">`;

    case 'button':
      return `
        <div class="nl-block-row" style="margin-bottom:8px">
          <div>
            <label class="nl-label">Label</label>
            <input type="text" class="nl-block-field" data-field="label" value="${esc(block.label)}">
          </div>
          <div>
            <label class="nl-label">Align</label>
            <select class="nl-block-field" data-field="align">
              <option value="left"   ${block.align==='left'  ?'selected':''}>Left</option>
              <option value="center" ${block.align==='center'?'selected':''}>Center</option>
              <option value="right"  ${block.align==='right' ?'selected':''}>Right</option>
            </select>
          </div>
        </div>
        <label class="nl-label">URL</label>
        <input type="url" class="nl-block-field" data-field="url" value="${esc(block.url||'')}">
        <div class="nl-block-row" style="margin-top:8px">
          <div><label class="nl-label">Background</label><input type="color" class="nl-block-field" data-field="bgColor" value="${block.bgColor||'#2d6a4f'}" style="padding:4px;height:36px"></div>
          <div><label class="nl-label">Text Color</label><input type="color" class="nl-block-field" data-field="textColor" value="${block.textColor||'#ffffff'}" style="padding:4px;height:36px"></div>
        </div>`;

    case 'divider':
      return `
        <div class="nl-block-row">
          <div><label class="nl-label">Color</label><input type="color" class="nl-block-field" data-field="color" value="${block.color||'#e0e0e0'}" style="padding:4px;height:36px"></div>
          <div><label class="nl-label">Height (px)</label><input type="number" class="nl-block-field" data-field="height" value="${block.height||1}" min="1" max="10"></div>
        </div>`;

    case 'two-col':
      return `
        <div class="nl-twocol-wrap">
          <div class="nl-twocol-col">
            <label>Left Column</label>
            <textarea class="nl-block-field" data-field="leftText" rows="4">${esc(block.leftText||'')}</textarea>
          </div>
          <div class="nl-twocol-col">
            <label>Right Column</label>
            <textarea class="nl-block-field" data-field="rightText" rows="4">${esc(block.rightText||'')}</textarea>
          </div>
        </div>`;

    case 'video':
      return `
        <label class="nl-label">Video URL (YouTube or Vimeo)</label>
        <input type="url" class="nl-block-field" data-field="url" value="${esc(block.url||'')}" placeholder="https://www.youtube.com/watch?v=...">
        <label class="nl-label" style="margin-top:8px">Thumbnail Image URL (optional)</label>
        <input type="url" class="nl-block-field" data-field="thumbnailUrl" value="${esc(block.thumbnailUrl||'')}" placeholder="Auto-generated if left blank">`;

    case 'logo':
      return `
        ${block.src ? `<img src="${esc(block.src)}" class="nl-img-preview" alt="logo" style="max-width:${block.width||200}px">` : ''}
        <button class="nl-img-upload-btn" type="button" data-id="${block.id}">🏠 Upload logo image</button>
        <div class="nl-block-row" style="margin-top:8px">
          <div>
            <label class="nl-label">Alt text</label>
            <input type="text" class="nl-block-field" data-field="alt" value="${esc(block.alt||'')}">
          </div>
          <div>
            <label class="nl-label">Width (px)</label>
            <input type="number" class="nl-block-field" data-field="width" value="${block.width||200}" min="50" max="600">
          </div>
        </div>
        <div class="nl-block-row" style="margin-top:8px">
          <div>
            <label class="nl-label">Link URL</label>
            <input type="url" class="nl-block-field" data-field="link" value="${esc(block.link||'')}">
          </div>
          <div>
            <label class="nl-label">Align</label>
            <select class="nl-block-field" data-field="align">
              <option value="left"   ${block.align==='left'  ?'selected':''}>Left</option>
              <option value="center" ${block.align==='center'?'selected':''}>Center</option>
              <option value="right"  ${block.align==='right' ?'selected':''}>Right</option>
            </select>
          </div>
        </div>`;

    case 'article':
      return `
        <label class="nl-label">Title</label>
        <input type="text" class="nl-block-field" data-field="title" value="${esc(block.title||'')}">
        <label class="nl-label" style="margin-top:8px">Summary</label>
        <textarea class="nl-block-field" data-field="text" rows="3">${esc(block.text||'')}</textarea>
        ${block.imageUrl ? `<img src="${esc(block.imageUrl)}" class="nl-img-preview" alt="article" style="margin-top:8px">` : ''}
        <button class="nl-img-upload-btn" type="button" data-id="${block.id}" style="margin-top:8px">🖼️ Upload article image</button>
        <div class="nl-block-row" style="margin-top:8px">
          <div>
            <label class="nl-label">Link URL</label>
            <input type="url" class="nl-block-field" data-field="linkUrl" value="${esc(block.linkUrl||'')}">
          </div>
          <div>
            <label class="nl-label">Link Label</label>
            <input type="text" class="nl-block-field" data-field="linkLabel" value="${esc(block.linkLabel||'Read More')}">
          </div>
        </div>`;

    case 'social':
      return `
        <label class="nl-label">Align</label>
        <select class="nl-block-field" data-field="align" style="margin-bottom:8px">
          <option value="left"   ${block.align==='left'  ?'selected':''}>Left</option>
          <option value="center" ${block.align==='center'?'selected':''}>Center</option>
          <option value="right"  ${block.align==='right' ?'selected':''}>Right</option>
        </select>
        <label class="nl-label">Facebook URL</label>
        <input type="url" class="nl-block-field" data-field="facebook" value="${esc(block.facebook||'')}" placeholder="https://facebook.com/..." style="margin-bottom:6px">
        <label class="nl-label">Twitter / X URL</label>
        <input type="url" class="nl-block-field" data-field="twitter" value="${esc(block.twitter||'')}" placeholder="https://twitter.com/..." style="margin-bottom:6px">
        <label class="nl-label">Instagram URL</label>
        <input type="url" class="nl-block-field" data-field="instagram" value="${esc(block.instagram||'')}" placeholder="https://instagram.com/..." style="margin-bottom:6px">
        <label class="nl-label">Website URL</label>
        <input type="url" class="nl-block-field" data-field="website" value="${esc(block.website||'')}" placeholder="https://...">`;

    case 'signature':
      return `
        <label class="nl-label">Name</label>
        <input type="text" class="nl-block-field" data-field="name" value="${esc(block.name||'')}">
        <label class="nl-label" style="margin-top:8px">Title / Role</label>
        <input type="text" class="nl-block-field" data-field="title" value="${esc(block.title||'')}" placeholder="e.g. HOA Board President">
        <div class="nl-block-row" style="margin-top:8px">
          <div>
            <label class="nl-label">Email</label>
            <input type="email" class="nl-block-field" data-field="email" value="${esc(block.email||'')}">
          </div>
          <div>
            <label class="nl-label">Phone</label>
            <input type="text" class="nl-block-field" data-field="phone" value="${esc(block.phone||'')}">
          </div>
        </div>`;

    case 'spacer':
      return `
        <label class="nl-label">Height (px)</label>
        <input type="number" class="nl-block-field" data-field="height" value="${block.height||32}" min="8" max="200">`;

    case 'html':
      return `
        <label class="nl-label">Custom HTML</label>
        <textarea class="nl-block-field" data-field="code" rows="6" style="font-family:monospace;font-size:.82rem">${esc(block.code||'')}</textarea>`;

    default: return `<em>Unknown block type: ${block.type}</em>`;
  }
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bindBlockInputs(wrapper, block) {
  wrapper.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => updateBlock(block.id, el.dataset.field, el.value));
    el.addEventListener('change', () => updateBlock(block.id, el.dataset.field, el.value));
  });
  // Image upload — works for image, logo, and article blocks
  const uploadBtn = wrapper.querySelector('.nl-img-upload-btn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      const fieldName = block.type === 'article' ? 'imageUrl' : 'src';
      triggerImageUpload(block.id, fieldName);
    });
  }
}

// ── Image upload ──────────────────────────────
function triggerImageUpload(blockId, fieldName = 'src') {
  const input = document.getElementById('nlImgUpload');
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    fd.append('image', input.files[0]);
    try {
      const res = await fetch('/api/nl/images', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) {
        updateBlock(blockId, fieldName, data.url);
        renderBlocks();
        updatePreview();
        toast('Image uploaded.');
      }
    } catch { toast('Upload failed.', true); }
    input.value = '';
  };
  input.click();
}

// ── HTML generation ───────────────────────────
function buildHtml() {
  const subject = document.getElementById('nlSubject').value || 'Newsletter';
  const preview = document.getElementById('nlPreview').value || '';
  const blocksHtml = state.blocks.map(blockToHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(subject)}</title>
<style>
  body { margin:0; padding:0; background:#f4f6f8; font-family:Arial,Helvetica,sans-serif; -webkit-text-size-adjust:none; }
  .email-wrap { max-width:600px; margin:32px auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
  .email-footer { background:#2d6a4f; color:rgba(255,255,255,.8); text-align:center; padding:20px 24px; font-size:12px; line-height:1.6; }
  .email-footer a { color:rgba(255,255,255,.9); }
  img { max-width:100%; height:auto; }
  @media only screen and (max-width:600px) { .email-wrap { margin:0; border-radius:0; } }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preview)}</div>
<!-- Header banner -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#2d6a4f">
  <tr><td style="padding:24px;text-align:center;color:#fff;font-family:Arial,sans-serif">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.8;margin-bottom:4px">Glenridge Community HOA</div>
    <div style="font-size:22px;font-weight:700">${esc(subject)}</div>
  </td></tr>
</table>
<div class="email-wrap">
${blocksHtml}
<div class="email-footer">
  <p>You're receiving this email because you're a member of Glenridge Community HOA.</p>
  <p>To stop receiving newsletters, <a href="{{UNSUBSCRIBE_URL}}">unsubscribe here</a>.</p>
  <p style="margin-top:12px;opacity:.6">Glenridge Community HOA &bull; ${new Date().getFullYear()}</p>
</div>
</div>
</body>
</html>`;
}

function blockToHtml(block) {
  switch (block.type) {
    case 'header': {
      const sizes = { h1:'28px', h2:'22px', h3:'18px' };
      return `<div style="padding:24px 32px;text-align:${block.align||'center'}">
  <${block.level||'h2'} style="margin:0;color:${block.color||'#2d6a4f'};font-size:${sizes[block.level||'h2']};font-family:Arial,sans-serif">${block.text||''}</${block.level||'h2'}>
</div>`;
    }
    case 'text':
      return `<div style="padding:16px 32px;color:#333;font-size:15px;line-height:1.7;font-family:Arial,sans-serif">${block.text||''}</div>`;

    case 'image': {
      if (!block.src) return '';
      const img = `<img src="${block.src}" alt="${esc(block.alt||'')}" style="width:100%;display:block">`;
      return `<div style="padding:16px 32px">${block.link ? `<a href="${esc(block.link)}">${img}</a>` : img}</div>`;
    }
    case 'button': {
      const align = block.align==='left' ? 'left' : block.align==='right' ? 'right' : 'center';
      return `<div style="padding:16px 32px;text-align:${align}">
  <a href="${esc(block.url||'#')}" style="display:inline-block;background:${block.bgColor||'#2d6a4f'};color:${block.textColor||'#fff'};padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;font-family:Arial,sans-serif">${esc(block.label||'Click Here')}</a>
</div>`;
    }
    case 'divider':
      return `<div style="padding:8px 32px"><hr style="border:none;border-top:${block.height||1}px solid ${block.color||'#e0e0e0'};margin:0"></div>`;

    case 'two-col':
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:16px 32px">
  <tr>
    <td width="48%" style="vertical-align:top;padding-right:16px;color:#333;font-size:14px;line-height:1.6;font-family:Arial,sans-serif">${block.leftText||''}</td>
    <td width="4%"></td>
    <td width="48%" style="vertical-align:top;color:#333;font-size:14px;line-height:1.6;font-family:Arial,sans-serif">${block.rightText||''}</td>
  </tr>
</table>`;

    case 'video': {
      const videoUrl = block.url || '';
      let ytId = '';
      const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) ytId = ytMatch[1];
      const thumb = block.thumbnailUrl || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '');
      if (!thumb) return '';
      return `<div style="padding:16px 32px;text-align:center">
  <a href="${esc(videoUrl)}" target="_blank" style="display:inline-block;position:relative">
    <img src="${esc(thumb)}" alt="Video thumbnail" style="width:100%;max-width:560px;display:block;border-radius:6px">
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;background:rgba(0,0,0,.65);border-radius:50%;display:flex;align-items:center;justify-content:center">
      <div style="width:0;height:0;border-style:solid;border-width:12px 0 12px 20px;border-color:transparent transparent transparent #fff;margin-left:4px"></div>
    </div>
  </a>
</div>`;
    }

    case 'logo': {
      const align = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';
      if (!block.src) return '';
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt||'')}" style="width:${block.width||200}px;max-width:100%;display:inline-block">`;
      return `<div style="padding:20px 32px;text-align:${align}">${block.link ? `<a href="${esc(block.link)}">${img}</a>` : img}</div>`;
    }

    case 'article': {
      const imgHtml = block.imageUrl ? `<img src="${esc(block.imageUrl)}" alt="" style="width:100%;display:block;border-radius:6px;margin-bottom:12px">` : '';
      const linkHtml = block.linkUrl ? `<p style="margin:12px 0 0"><a href="${esc(block.linkUrl)}" style="color:#2d6a4f;font-weight:700;text-decoration:none">${esc(block.linkLabel||'Read More')} →</a></p>` : '';
      return `<div style="padding:16px 32px">
  ${imgHtml}
  <h3 style="margin:0 0 8px;color:#333;font-size:18px;font-family:Arial,sans-serif">${esc(block.title||'')}</h3>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:0;font-family:Arial,sans-serif">${block.text||''}</p>
  ${linkHtml}
</div>`;
    }

    case 'social': {
      const align = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';
      const links = [];
      if (block.facebook) links.push(`<a href="${esc(block.facebook)}" style="display:inline-block;margin:0 6px;color:#2d6a4f;font-size:14px;text-decoration:none;font-family:Arial,sans-serif">Facebook</a>`);
      if (block.twitter) links.push(`<a href="${esc(block.twitter)}" style="display:inline-block;margin:0 6px;color:#2d6a4f;font-size:14px;text-decoration:none;font-family:Arial,sans-serif">Twitter</a>`);
      if (block.instagram) links.push(`<a href="${esc(block.instagram)}" style="display:inline-block;margin:0 6px;color:#2d6a4f;font-size:14px;text-decoration:none;font-family:Arial,sans-serif">Instagram</a>`);
      if (block.website) links.push(`<a href="${esc(block.website)}" style="display:inline-block;margin:0 6px;color:#2d6a4f;font-size:14px;text-decoration:none;font-family:Arial,sans-serif">Website</a>`);
      if (!links.length) return '';
      return `<div style="padding:16px 32px;text-align:${align}">${links.join(' &bull; ')}</div>`;
    }

    case 'signature': {
      let html = `<div style="padding:20px 32px;font-family:Arial,sans-serif;font-size:14px;color:#333;border-top:1px solid #e0e0e0;margin:0 32px">`;
      if (block.name) html += `<div style="font-weight:700;font-size:16px;margin-bottom:2px">${esc(block.name)}</div>`;
      if (block.title) html += `<div style="color:#666;font-style:italic;margin-bottom:6px">${esc(block.title)}</div>`;
      const contacts = [];
      if (block.email) contacts.push(`<a href="mailto:${esc(block.email)}" style="color:#2d6a4f;text-decoration:none">${esc(block.email)}</a>`);
      if (block.phone) contacts.push(`<span>${esc(block.phone)}</span>`);
      if (contacts.length) html += `<div style="font-size:13px;color:#666">${contacts.join(' &bull; ')}</div>`;
      html += `</div>`;
      return html;
    }

    case 'spacer':
      return `<div style="height:${block.height||32}px"></div>`;

    case 'html':
      return `<div style="padding:16px 32px">${block.code||''}</div>`;

    default: return '';
  }
}

// ── Live Preview ──────────────────────────────
function updatePreview() {
  const frame = document.getElementById('nlPreviewFrame');
  const html = buildHtml()
    .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, '#unsubscribe')
    .replace(/\{\{FIRST_NAME\}\}/g, 'Neighbor');
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
}

// ── Analytics ─────────────────────────────────
async function openAnalytics(id, title) {
  document.getElementById('analyticsTitle').textContent = `Analytics: ${title || 'Newsletter'}`;
  const data = await apiFetch(`/api/nl/newsletters/${id}/analytics`);
  if (!data) { toast('Could not load analytics.', true); return; }
  document.getElementById('aDelivered').textContent  = data.delivered;
  document.getElementById('aOpens').textContent      = data.uniqueOpens;
  document.getElementById('aOpenRate').textContent   = data.openRate + '%';
  document.getElementById('aClicks').textContent     = data.uniqueClicks;
  document.getElementById('aClickRate').textContent  = data.clickRate + '%';
  const topEl = document.getElementById('aTopLinks');
  if (!data.topLinks || !data.topLinks.length) {
    topEl.innerHTML = '<em style="color:#888">No click data yet.</em>';
  } else {
    topEl.innerHTML = data.topLinks.map(l =>
      `<div class="nl-top-link-row"><span class="nl-top-link-url">${esc(l.url)}</span><span class="nl-top-link-count">${l.count} clicks</span></div>`
    ).join('');
  }
  state.currentNlId = id;
  showView('analytics');
}

// ── Subscribers ───────────────────────────────
async function loadSubscribers() {
  const tbody = document.getElementById('subsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">Loading...</td></tr>';
  const subs = await apiFetch('/api/nl/subscribers');
  if (!Array.isArray(subs)) { tbody.innerHTML = '<tr><td colspan="6">Error loading subscribers.</td></tr>'; return; }
  if (!subs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">No subscribers yet.</td></tr>'; return; }
  tbody.innerHTML = subs.map(s => `
    <tr>
      <td>${esc((s.first_name||'')+' '+(s.last_name||'')).trim() || '—'}</td>
      <td>${esc(s.email)}</td>
      <td><span class="nl-sub-status nl-sub-${s.status}">${s.status}</span></td>
      <td>${esc(s.source||'')}</td>
      <td>${s.subscribed_at ? new Date(s.subscribed_at).toLocaleDateString() : '—'}</td>
      <td>${s.status === 'active' ? `<button class="nl-list-item-btn delete" data-id="${s.id}" onclick="unsubscribeOne('${s.id}', this)">Remove</button>` : ''}</td>
    </tr>`).join('');
}

window.unsubscribeOne = async function(id, btn) {
  if (!confirm('Remove this subscriber?')) return;
  const d = await apiFetch(`/api/nl/subscribers/${id}`, { method: 'DELETE' });
  if (d && d.success) { loadSubscribers(); toast('Subscriber removed.'); } else { toast('Failed.', true); }
};

// ── Modals ────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function wireModals() {
  // Test modal
  document.getElementById('btnTestCancel').addEventListener('click',  () => closeModal('testModal'));
  document.getElementById('btnTestConfirm').addEventListener('click', async () => {
    const email = document.getElementById('testEmail').value.trim();
    if (!email) { toast('Enter an email address.', true); return; }
    if (!state.currentNlId) return;
    await saveDraft();
    const d = await apiFetch(`/api/nl/newsletters/${state.currentNlId}/test`, { method: 'POST', body: JSON.stringify({ email }) });
    closeModal('testModal');
    toast(d && d.success ? `Test sent to ${email}` + (d.note ? ' (logged)' : '') : 'Send failed.', !(d && d.success));
  });

  // Send modal
  document.getElementById('btnSendCancel').addEventListener('click',  () => closeModal('sendModal'));
  document.getElementById('btnSendConfirm').addEventListener('click', async () => {
    if (!state.currentNlId) return;
    await saveDraft();
    const d = await apiFetch(`/api/nl/newsletters/${state.currentNlId}/send`, { method: 'POST' });
    closeModal('sendModal');
    if (d && d.success) {
      toast(`Newsletter sent to ${d.sent} subscriber(s)!`);
      await loadNlList();
      openNl(state.currentNlId);
    } else {
      toast(d ? (d.error || 'Send failed.') : 'Send failed.', true);
    }
  });

  // Add subscriber modal
  document.getElementById('btnAddSub').addEventListener('click', () => openModal('addSubModal'));
  document.getElementById('btnAddSubCancel').addEventListener('click', () => closeModal('addSubModal'));
  document.getElementById('btnAddSubConfirm').addEventListener('click', async () => {
    const email = document.getElementById('addSubEmail').value.trim();
    const first = document.getElementById('addSubFirst').value.trim();
    const last  = document.getElementById('addSubLast').value.trim();
    if (!email) { toast('Email is required.', true); return; }
    const d = await apiFetch('/api/nl/subscribers', { method: 'POST', body: JSON.stringify({ email, first_name: first, last_name: last }) });
    if (d && d.success) {
      closeModal('addSubModal');
      document.getElementById('addSubEmail').value = '';
      document.getElementById('addSubFirst').value = '';
      document.getElementById('addSubLast').value  = '';
      toast('Subscriber added.');
      loadSubscribers();
    } else { toast(d ? (d.error || 'Failed.') : 'Failed.', true); }
  });

  // Sync button
  document.getElementById('btnSyncSubs').addEventListener('click', async () => {
    await apiFetch('/api/nl/subscribers');
    toast('Members synced.');
    loadSubscribers();
  });

  // Close modals on overlay click
  ['testModal','sendModal','addSubModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });
}
