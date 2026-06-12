/* ═══════════════════════════════════════════════════════
   RETRO BOARD — app.js
   Real-time: Yjs + y-webrtc (peer-to-peer, no server)
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────────────── */
const GIPHY_API_KEY = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L59'; // Public Giphy beta key
const COLUMNS = ['bad', 'sad', 'glad', 'action'];
const COL_LABELS = { bad: '😞 Bad', sad: '😢 Sad', glad: '😊 Glad', action: '✅ Action Items' };

/* ─────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────── */
let ydoc, provider, yCards, yMeta;
let currentRoom = null;
let isFacilitator = false;
let currentCol = null;       // which column the add-modal targets
let selectedGifUrl = null;   // gif chosen in picker
let editingCardId = null;    // null = adding new, string = editing existing
let myVotes = new Set();     // card IDs this peer has voted on (local only)

/* ─────────────────────────────────────────────────────
   UTILS
───────────────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

function $(id) { return document.getElementById(id); }

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

/* ─────────────────────────────────────────────────────
   THEME TOGGLE
───────────────────────────────────────────────────── */
const btnTheme = $('btn-toggle-theme');
btnTheme.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark');
  document.body.classList.toggle('light', !isDark);
  btnTheme.textContent = isDark ? '☀️' : '🌙';
});

/* ─────────────────────────────────────────────────────
   MODAL CLOSE — generic close buttons
───────────────────────────────────────────────────── */
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modal));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* ═══════════════════════════════════════════════════════
   LOBBY / ROOM
═══════════════════════════════════════════════════════ */
function generateRoomId() {
  const words = ['alpha','bravo','charlie','delta','echo','foxtrot','golf',
                 'hotel','india','juliet','kilo','lima','mike','november',
                 'oscar','papa','quebec','romeo','sierra','tango'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

$('btn-new-room').addEventListener('click', () => {
  const roomId = generateRoomId();
  launchRoom(roomId, true);
});

$('btn-join-room').addEventListener('click', () => {
  const raw = $('join-room-input').value.trim();
  if (!raw) { toast('Please enter a room link or ID'); return; }
  // accept full URL or just the hash/id
  let roomId = raw;
  if (raw.includes('#')) roomId = raw.split('#').pop();
  if (!roomId) { toast('Invalid room link'); return; }
  launchRoom(roomId, false);
});

// Auto-join if URL already has a hash
window.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash.slice(1);
  if (hash) launchRoom(hash, false);
});

function launchRoom(roomId, isFac) {
  currentRoom = roomId;
  isFacilitator = isFac;

  // Update URL
  window.location.hash = roomId;

  // Show room ID in badge
  $('room-id-label').textContent = roomId;

  // Switch lobby → app
  $('lobby').classList.add('hidden');
  $('app').classList.remove('hidden');

  // Facilitator UI
  if (isFacilitator) activateFacilitator();

  // Init Yjs
  initYjs(roomId);
}

/* ─────────────────────────────────────────────────────
   ROOM BADGE — copy link
───────────────────────────────────────────────────── */
$('room-badge').addEventListener('click', () => {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => toast('📋 Room link copied!'));
});

/* ═══════════════════════════════════════════════════════
   Yjs + WebRTC
═══════════════════════════════════════════════════════ */
function initYjs(roomId) {
  ydoc = new Y.Doc();

  // yCards: Y.Array of card objects (plain JS objects stored as Y.Map entries)
  // We use a Y.Map keyed by cardId for easy updates
  yCards = ydoc.getMap('cards');
  yMeta  = ydoc.getMap('meta');   // { votesVisible: bool }

  // Default meta
  if (!yMeta.has('votesVisible')) {
    ydoc.transact(() => yMeta.set('votesVisible', true));
  }

  // WebRTC provider — connects peers in the same room
  provider = new WebrtcProvider(roomId, ydoc, {
    signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com'],
    maxConns: 20,
    filterBcConns: false,
  });

  // Peer count
  provider.awareness.on('change', updatePeerCount);
  provider.awareness.setLocalState({ online: true });

  // Observe card changes → re-render
  yCards.observe(() => renderAllColumns());

  // Observe meta changes
  yMeta.observe(() => applyVoteVisibility());

  renderAllColumns();
}

function updatePeerCount() {
  const states = provider.awareness.getStates();
  $('peer-count-num').textContent = states.size;
}

/* ═══════════════════════════════════════════════════════
   FACILITATOR
═══════════════════════════════════════════════════════ */
$('btn-facilitator').addEventListener('click', () => {
  if (isFacilitator) { toast('You are already the facilitator!'); return; }
  openModal('modal-facilitator');
  $('fac-passphrase-input').value = '';
  $('fac-error').classList.add('hidden');
  setTimeout(() => $('fac-passphrase-input').focus(), 100);
});

$('btn-fac-confirm').addEventListener('click', confirmFacilitator);
$('fac-passphrase-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmFacilitator();
});

function confirmFacilitator() {
  const pass = $('fac-passphrase-input').value;
  // The passphrase is the room ID itself — simple, no server needed
  if (pass === currentRoom) {
    closeModal('modal-facilitator');
    isFacilitator = true;
    activateFacilitator();
    toast('🎭 You are now the facilitator!');
  } else {
    $('fac-error').classList.remove('hidden');
  }
}

function activateFacilitator() {
  $('facilitator-bar').classList.remove('hidden');
  document.body.classList.add('is-facilitator');
  $('btn-facilitator').textContent = '🎭 Facilitator ✓';
  $('btn-facilitator').classList.add('btn-success');
  renderAllColumns();
}

// Facilitator controls
$('btn-hide-all').addEventListener('click', () => {
  if (!isFacilitator) return;
  ydoc.transact(() => {
    yCards.forEach((card, id) => {
      const updated = Object.assign({}, card, { hidden: true });
      yCards.set(id, updated);
    });
  });
  toast('👁 All cards hidden');
});

$('btn-reveal-all').addEventListener('click', () => {
  if (!isFacilitator) return;
  ydoc.transact(() => {
    yCards.forEach((card, id) => {
      const updated = Object.assign({}, card, { hidden: false });
      yCards.set(id, updated);
    });
  });
  toast('👁 All cards revealed');
});

$('btn-reveal-votes').addEventListener('click', () => {
  if (!isFacilitator) return;
  const current = yMeta.get('votesVisible');
  ydoc.transact(() => yMeta.set('votesVisible', !current));
  toast(current ? '🗳 Vote counts hidden' : '🗳 Vote counts visible');
});

function applyVoteVisibility() {
  const visible = yMeta.get('votesVisible') !== false;
  COLUMNS.forEach(col => {
    const list = $(`list-${col}`);
    if (visible) list.classList.remove('votes-hidden');
    else          list.classList.add('votes-hidden');
  });
}

/* ═══════════════════════════════════════════════════════
   ADD CARD MODAL
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.btn-add').forEach(btn => {
  btn.addEventListener('click', () => openAddModal(btn.dataset.col));
});

function openAddModal(col, cardId = null) {
  currentCol = col;
  editingCardId = cardId;
  selectedGifUrl = null;

  const isEdit = cardId !== null;
  $('modal-add-title').textContent = isEdit ? `Edit Card — ${COL_LABELS[col]}` : `Add Card — ${COL_LABELS[col]}`;
  $('btn-submit-card').textContent = isEdit ? 'Save Changes' : 'Add Card';

  if (isEdit) {
    const card = yCards.get(cardId);
    $('card-text-input').value = card.text || '';
    if (card.gif) {
      selectedGifUrl = card.gif;
      $('gif-preview-img').src = card.gif;
      $('gif-preview').classList.remove('hidden');
    } else {
      $('gif-preview').classList.add('hidden');
    }
  } else {
    $('card-text-input').value = '';
    $('gif-preview').classList.add('hidden');
  }

  $('gif-picker').classList.add('hidden');
  $('gif-results').innerHTML = '';
  $('gif-search-input').value = '';
  updateCharCount();
  openModal('modal-add');
  setTimeout(() => $('card-text-input').focus(), 100);
}

$('card-text-input').addEventListener('input', updateCharCount);
function updateCharCount() {
  $('char-count').textContent = $('card-text-input').value.length;
}

$('btn-submit-card').addEventListener('click', submitCard);
$('card-text-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitCard();
});

function submitCard() {
  const text = $('card-text-input').value.trim();
  if (!text && !selectedGifUrl) { toast('Please write something or pick a GIF'); return; }

  if (editingCardId) {
    // Edit existing
    const existing = yCards.get(editingCardId);
    const updated = Object.assign({}, existing, {
      text: text,
      gif: selectedGifUrl || null,
    });
    ydoc.transact(() => yCards.set(editingCardId, updated));
    toast('✏️ Card updated');
  } else {
    // New card
    const card = {
      id: uid(),
      col: currentCol,
      text: text,
      gif: selectedGifUrl || null,
      votes: 0,
      hidden: false,
      createdAt: Date.now(),
    };
    ydoc.transact(() => yCards.set(card.id, card));
    toast('✅ Card added');
  }

  closeModal('modal-add');
  selectedGifUrl = null;
  editingCardId = null;
}

/* ═══════════════════════════════════════════════════════
   GIF PICKER
═══════════════════════════════════════════════════════ */
$('btn-open-gif').addEventListener('click', () => {
  $('gif-picker').classList.toggle('hidden');
  if (!$('gif-picker').classList.contains('hidden')) {
    $('gif-search-input').focus();
    // Load trending if empty
    if (!$('gif-results').innerHTML) searchGiphy('retro meeting');
  }
});

$('btn-gif-search').addEventListener('click', () => searchGiphy($('gif-search-input').value.trim() || 'retro'));
$('gif-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchGiphy($('gif-search-input').value.trim() || 'retro');
});

async function searchGiphy(query) {
  $('gif-results').innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px;">Searching…</p>';
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=18&rating=g`;
    const res = await fetch(url);
    const data = await res.json();
    renderGifResults(data.data || []);
  } catch (err) {
    $('gif-results').innerHTML = '<p style="color:#ff6b6b;font-size:13px;padding:8px;">Failed to load GIFs. Check your connection.</p>';
  }
}

function renderGifResults(gifs) {
  if (!gifs.length) {
    $('gif-results').innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px;">No GIFs found.</p>';
    return;
  }
  $('gif-results').innerHTML = '';
  gifs.forEach(gif => {
    const img = document.createElement('img');
    img.src = gif.images.fixed_height_small.url;
    img.alt = gif.title;
    img.title = gif.title;
    if (selectedGifUrl === gif.images.original.url) img.classList.add('selected');
    img.addEventListener('click', () => selectGif(gif.images.original.url, img));
    $('gif-results').appendChild(img);
  });
}

function selectGif(url, imgEl) {
  selectedGifUrl = url;
  document.querySelectorAll('.gif-grid img').forEach(i => i.classList.remove('selected'));
  imgEl.classList.add('selected');
  $('gif-preview-img').src = url;
  $('gif-preview').classList.remove('hidden');
  $('gif-picker').classList.add('hidden');
  toast('🎞 GIF selected!');
}

$('btn-remove-gif').addEventListener('click', () => {
  selectedGifUrl = null;
  $('gif-preview').classList.add('hidden');
  $('gif-preview-img').src = '';
});

/* ═══════════════════════════════════════════════════════
   RENDER CARDS
═══════════════════════════════════════════════════════ */
function renderAllColumns() {
  COLUMNS.forEach(col => renderColumn(col));
  applyVoteVisibility();
}

function renderColumn(col) {
  const list = $(`list-${col}`);
  const countEl = $(`count-${col}`);

  // Gather cards for this column, sorted by createdAt
  const cards = [];
  yCards.forEach((card) => {
    if (card.col === col) cards.push(card);
  });
  cards.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  countEl.textContent = cards.length;

  // Diff: only update what changed to avoid flicker
  list.innerHTML = '';
  cards.forEach(card => {
    list.appendChild(createCardEl(card));
  });
}

function createCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  if (card.hidden) el.classList.add('hidden-card');

  // Text
  const textEl = document.createElement('p');
  textEl.className = 'card-text';
  textEl.textContent = card.text || '';
  el.appendChild(textEl);

  // GIF
  if (card.gif) {
    const img = document.createElement('img');
    img.className = 'card-gif';
    img.src = card.gif;
    img.alt = 'GIF';
    img.loading = 'lazy';
    el.appendChild(img);
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  // Vote button
  const voted = myVotes.has(card.id);
  const voteBtn = document.createElement('button');
  voteBtn.className = `vote-btn${voted ? ' voted' : ''}`;
  voteBtn.innerHTML = `<span>👍</span><span class="vote-count">${card.votes || 0}</span>`;
  voteBtn.title = voted ? 'Remove vote' : 'Vote';
  voteBtn.addEventListener('click', () => toggleVote(card.id));
  footer.appendChild(voteBtn);

  // Actions (right side)
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  // Edit button (only card owner can edit — we track by client session; simpler: everyone can edit)
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-icon';
  editBtn.textContent = '✏️';
  editBtn.title = 'Edit card';
  editBtn.style.fontSize = '13px';
  editBtn.addEventListener('click', () => openAddModal(card.col, card.id));
  actions.appendChild(editBtn);

  // Hide/unhide (facilitator only)
  if (isFacilitator) {
    const hideBtn = document.createElement('button');
    hideBtn.className = 'hide-toggle-btn';
    hideBtn.textContent = card.hidden ? '👁' : '🙈';
    hideBtn.title = card.hidden ? 'Reveal card' : 'Hide card';
    hideBtn.addEventListener('click', () => toggleCardHidden(card.id, !card.hidden));
    actions.appendChild(hideBtn);
  }

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Delete card';
  deleteBtn.addEventListener('click', () => deleteCard(card.id));
  actions.appendChild(deleteBtn);

  footer.appendChild(actions);
  el.appendChild(footer);

  return el;
}

/* ─────────────────────────────────────────────────────
   CARD ACTIONS
───────────────────────────────────────────────────── */
function toggleVote(cardId) {
  const card = yCards.get(cardId);
  if (!card) return;
  const alreadyVoted = myVotes.has(cardId);
  if (alreadyVoted) {
    myVotes.delete(cardId);
    const updated = Object.assign({}, card, { votes: Math.max(0, (card.votes || 0) - 1) });
    ydoc.transact(() => yCards.set(cardId, updated));
  } else {
    myVotes.add(cardId);
    const updated = Object.assign({}, card, { votes: (card.votes || 0) + 1 });
    ydoc.transact(() => yCards.set(cardId, updated));
  }
}

function toggleCardHidden(cardId, hide) {
  if (!isFacilitator) return;
  const card = yCards.get(cardId);
  if (!card) return;
  const updated = Object.assign({}, card, { hidden: hide });
  ydoc.transact(() => yCards.set(cardId, updated));
}

function deleteCard(cardId) {
  if (!confirm('Delete this card?')) return;
  ydoc.transact(() => yCards.delete(cardId));
  myVotes.delete(cardId);
  toast('🗑 Card deleted');
}

/* ═══════════════════════════════════════════════════════
   EXPORT ACTION ITEMS
═══════════════════════════════════════════════════════ */
$('btn-export').addEventListener('click', () => {
  const actionCards = [];
  yCards.forEach(card => {
    if (card.col === 'action') actionCards.push(card);
  });
  actionCards.sort((a, b) => (b.votes || 0) - (a.votes || 0));

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let md = `# 📋 Retro Action Items\n`;
  md    += `**Date:** ${date}  \n`;
  md    += `**Room:** ${currentRoom}\n\n`;
  md    += `---\n\n`;

  if (actionCards.length === 0) {
    md += '_No action items recorded._\n';
  } else {
    actionCards.forEach((card, i) => {
      md += `- [ ] ${card.text || '(GIF card)'}`;
      if (card.votes) md += `  *(${card.votes} vote${card.votes !== 1 ? 's' : ''})*`;
      md += '\n';
    });
  }

  md += `\n---\n*Exported from Retro Board*\n`;

  $('export-text').value = md;
  openModal('modal-export');
});

$('btn-copy-export').addEventListener('click', () => {
  navigator.clipboard.writeText($('export-text').value)
    .then(() => toast('📋 Copied to clipboard!'));
});

$('btn-download-export').addEventListener('click', () => {
  const blob = new Blob([$('export-text').value], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `retro-action-items-${currentRoom}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('⬇ Downloaded!');
});
