/* ═══════════════════════════════════════════════════════
   RETRO BOARD — app.js
   Real-time: Yjs + y-webrtc (peer-to-peer, no server)
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────
   IMPORTS — pure helpers live in lib.js so they can be
   unit-tested without a DOM/Yjs runtime.
───────────────────────────────────────────────────── */
import {
  COLUMNS,
  COL_LABELS,
  uid,
  generateRoomId,
  parseRoomFromInput,
  escapeHtml,
  cardsByColumn,
  blurButtonState,
  buildExportMarkdown,
  classifyGiphyStatus,
  addCommentToCard,
  removeCommentFromCard,
  getOrCreateUserId,
  classifyFacilitatorRole,
  currentFacilitator,
  getOrCreateDisplayName,
  formatParticipants,
} from './lib.js';

/* ─────────────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────────────── */
// Giphy API key (free, from https://developers.giphy.com/dashboard/).
// Safe to commit — it's a public client key with strict rate limits.
const GIPHY_API_KEY = 'nCKHSmRVv64eVvtVPFT6DfFeo3IJ7WKV';

/* ─────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────── */
let ydoc, provider, wsProvider, yCards, yMeta, yFacEvents;
let currentRoom = null;
// Stable, per-browser user identifier — survives page refreshes. This is
// what we store in yMeta.facilitatorId so refreshing doesn't lose the role.
const MY_USER_ID = getOrCreateUserId();
let myDisplayName = getOrCreateDisplayName();
// `isFacilitator` is now DERIVED from yMeta.facilitatorId === MY_USER_ID
// and is refreshed by refreshFacilitatorUI() whenever yMeta changes.
let isFacilitator = false;
// When true, the user expressed intent to claim facilitator (e.g. clicked
// "Create Room" or entered the passphrase) but we're still waiting for the
// initial sync from the websocket to know if the seat is already taken.
let pendingFacilitatorClaim = false;
let currentCol = null;       // which column the add-modal targets
let selectedGifUrl = null;   // gif chosen in picker
let editingCardId = null;    // null = adding new, string = editing existing
let myVotes = new Set();     // card IDs this peer has voted on (local only)
let commentsCardId = null;   // card currently shown in the comments modal
let selectedCommentGifUrl = null; // gif chosen for the comment-in-progress

/* ─────────────────────────────────────────────────────
   UTILS (DOM-bound)
───────────────────────────────────────────────────── */

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
   GLOBAL BLUR/UNBLUR ALL (facilitator-only, syncs to all peers)
───────────────────────────────────────────────────── */
const btnHideAllGlobal = $('btn-hide-all-global');
btnHideAllGlobal.addEventListener('click', () => {
  if (!isFacilitator) {
    toast('🚫 Only the facilitator can blur cards');
    return;
  }
  if (!yMeta) { toast('Not connected yet'); return; }
  // Global blur is a SINGLE room-wide flag. Rendering checks it at draw
  // time, so we never have to iterate yCards or re-write each entry — which
  // means we can't accidentally race with concurrent card additions on
  // other peers (the old "iterate-then-write" pattern could make a
  // freshly-added card disappear from the other peer's view).
  const blur = !(yMeta.get('blurAll') === true);
  ydoc.transact(() => yMeta.set('blurAll', blur));
  toast(blur ? '🌫 All cards blurred for everyone' : '👁 All cards revealed for everyone');
});

// Keep the button label/active state in sync with the actual mode.
// Also hide it entirely for non-facilitators — only the facilitator can blur.
function refreshHideAllButton() {
  if (!yMeta) return;
  btnHideAllGlobal.classList.toggle('hidden', !isFacilitator);
  const state = blurButtonState(yMeta.get('blurAll') === true);
  btnHideAllGlobal.classList.toggle('is-active', state.active);
  btnHideAllGlobal.textContent = state.label;
}

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
$('btn-new-room').addEventListener('click', () => {
  const roomId = generateRoomId();
  launchRoom(roomId, true);
});

$('btn-join-room').addEventListener('click', () => {
  const roomId = parseRoomFromInput($('join-room-input').value);
  if (!roomId) { toast('Please enter a valid room link or ID'); return; }
  launchRoom(roomId, false);
});

// Auto-join if URL already has a hash.
// Because app.js is loaded as a dynamic import from a module script,
// DOMContentLoaded may have already fired by the time we get here.
function autoJoinFromHash() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    // No need to pass facilitator intent — the role is derived from
    // yMeta.facilitatorId === MY_USER_ID and re-evaluated after sync.
    launchRoom(hash, false);
  }
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', autoJoinFromHash);
} else {
  autoJoinFromHash();
}

function launchRoom(roomId, claimFacilitator) {
  currentRoom = roomId;
  pendingFacilitatorClaim = !!claimFacilitator;

  // Update URL
  window.location.hash = roomId;

  // Show room ID in badge
  $('room-id-label').textContent = roomId;

  // Switch lobby → app
  $('lobby').classList.add('hidden');
  $('app').classList.remove('hidden');

  // Init Yjs — this also registers the yMeta observer that drives the
  // facilitator UI, and arranges to attempt the pending claim after sync.
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
  // Hard fail fast & loud if the Yjs library didn't load.
  if (typeof Y === 'undefined' || !Y || !Y.Doc) {
    const msg = 'Yjs library failed to load. If you opened index.html directly (file://), serve it through a local web server instead (e.g. `npx serve` or `python3 -m http.server`). ES modules do not work over file://.';
    console.error('[RetroBoard]', msg);
    toast('⚠ ' + msg, 10000);
    return;
  }

  ydoc = new Y.Doc();

  // We use a Y.Map keyed by cardId for easy updates
  yCards = ydoc.getMap('cards');
  yMeta  = ydoc.getMap('meta');   // { blurAll: bool }
  // Facilitator state is stored as a CRDT-safe event log so concurrent
  // claims can NEVER steal the role from the current holder. See
  // lib.js → currentFacilitator() for the replay rules.
  yFacEvents = ydoc.getArray('facilitatorEvents');

  // *** Register observers BEFORE any potentially-throwing network setup, ***
  // *** so local card adding always re-renders even if WebRTC fails.       ***
  yCards.observe(() => renderAllColumns());
  yMeta.observe(() => {
    // Blur state lives in yMeta — re-render so cards apply/remove the blur.
    refreshHideAllButton();
    renderAllColumns();
  });
  yFacEvents.observe(() => {
    refreshFacilitatorUI();
    renderParticipantsList();
  });

  renderAllColumns();
  refreshHideAllButton();
  refreshFacilitatorUI();

  // ── Transport #1: WebSocket (RELIABLE) ────────────────────────────────
  // demos.yjs.dev is the official public Yjs websocket broker. Acts as a
  // central server so peers don't need WebRTC signaling or NAT traversal.
  // This is what actually makes "share a link → join the same room" work
  // reliably, especially when the y-webrtc signaling server is down (as
  // signaling.yjs.dev frequently is in 2026).
  try {
    if (typeof WebsocketProvider === 'undefined') {
      throw new Error('WebsocketProvider is not defined (y-websocket failed to load)');
    }
    // IMPORTANT: room names on the public demo server are GLOBAL. Our
    // 3-word + 4-digit IDs are unique enough for retros, but we also
    // namespace them so we don't collide with other Yjs demos.
    const wsRoomName = 'retro-board::' + roomId;
    wsProvider = new WebsocketProvider('wss://demos.yjs.dev/ws', wsRoomName, ydoc);
    wsProvider.on('status', e => {
      console.log('[RetroBoard] websocket status:', e.status);
    });
    // Once the room's state has synced from the server, try to honor any
    // pending facilitator claim (e.g. user just clicked "Create Room").
    wsProvider.on('sync', synced => {
      if (synced) tryPendingFacilitatorClaim();
    });
    wsProvider.awareness.on('change', () => {
      updatePeerCount();
      renderParticipantsList();
    });
    wsProvider.awareness.setLocalState({
      online: true,
      userId: MY_USER_ID,
      displayName: myDisplayName,
    });
  } catch (err) {
    console.error('[RetroBoard] WebSocket init failed:', err);
    toast('⚠ Sync server unreachable: ' + err.message, 6000);
  }

  // ── Transport #2: WebRTC (FAST P2P, best-effort) ──────────────────────
  // Direct peer-to-peer for lower latency when signaling+NAT allow it.
  // Failure here is fine — the websocket above already syncs everyone.
  try {
    if (typeof WebrtcProvider === 'undefined') {
      throw new Error('WebrtcProvider is not defined (y-webrtc failed to load)');
    }
    provider = new WebrtcProvider(roomId, ydoc, {
      signaling: ['wss://signaling.yjs.dev'],
      maxConns: 20,
      filterBcConns: false,
    });
  } catch (err) {
    console.warn('[RetroBoard] WebRTC unavailable (websocket fallback in use):', err);
  }
}

function updatePeerCount() {
  // Prefer the websocket awareness (reliable, sees every peer in the room).
  // Fall back to the webrtc awareness if websocket failed.
  const aw = (wsProvider && wsProvider.awareness)
          || (provider && provider.awareness);
  if (!aw) { $('peer-count-num').textContent = '1'; return; }
  // Deduplicate by userId so multiple tabs from the same person don't
  // inflate the count.
  const ids = new Set();
  aw.getStates().forEach(s => { if (s && s.userId) ids.add(s.userId); });
  // Fallback: if no state has a userId yet (early sync), use raw state count.
  $('peer-count-num').textContent = ids.size || aw.getStates().size || 1;
}

/* ─────────────────────────────────────────────────────
   PARTICIPANTS MODAL
───────────────────────────────────────────────────── */
$('peer-count').addEventListener('click', () => {
  // Pre-fill the "your display name" input
  $('my-display-name-input').value = myDisplayName;
  renderParticipantsList();
  openModal('modal-participants');
  setTimeout(() => $('my-display-name-input').focus(), 100);
});

$('btn-save-display-name').addEventListener('click', saveDisplayName);
$('my-display-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveDisplayName();
});

function saveDisplayName() {
  const newName = $('my-display-name-input').value.trim();
  if (!newName) { toast('Please enter a name'); return; }
  myDisplayName = newName;
  localStorage.setItem('displayName', newName);
  if (wsProvider && wsProvider.awareness) {
    wsProvider.awareness.setLocalState({
      online: true,
      userId: MY_USER_ID,
      displayName: myDisplayName,
    });
  }
  renderParticipantsList();
  toast('✅ Display name updated');
}

function renderParticipantsList() {
  const listEl = $('participants-list');
  if (!listEl) return;
  const aw = (wsProvider && wsProvider.awareness)
          || (provider && provider.awareness);
  const states = aw ? aw.getStates() : null;
  const facilitatorId = currentFacilitator(yFacEvents);
  const participants = formatParticipants(states, MY_USER_ID, facilitatorId);

  listEl.innerHTML = '';
  participants.forEach(p => {
    const li = document.createElement('li');

    const avatar = document.createElement('span');
    avatar.className = 'participant-avatar';
    avatar.textContent = (p.displayName || '?').trim().charAt(0).toUpperCase();
    li.appendChild(avatar);

    const name = document.createElement('span');
    name.className = 'participant-name';
    name.textContent = p.displayName;
    li.appendChild(name);

    if (p.isFacilitator) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag facilitator';
      tag.textContent = '🎭 Facilitator';
      li.appendChild(tag);
    }
    if (p.isMe) {
      const tag = document.createElement('span');
      tag.className = 'participant-tag me';
      tag.textContent = 'You';
      li.appendChild(tag);
    }

    listEl.appendChild(li);
  });
}

/* ═══════════════════════════════════════════════════════
   FACILITATOR — single role per room.
   Stored as a Y.Array event log (claim/release events) so that the
   current holder is derived deterministically from the merged log on
   every peer. Concurrent claims while the seat is occupied are
   silently no-ops at derivation time — they cannot steal the role.
═══════════════════════════════════════════════════════ */
$('btn-facilitator').addEventListener('click', () => {
  if (isFacilitator) { toast('You are already the facilitator!'); return; }
  // Always re-read the latest state at click time.
  const holder = currentFacilitator(yFacEvents);
  if (holder !== null) {
    toast('🚫 This room already has a facilitator');
    return;
  }
  openModal('modal-facilitator');
  $('fac-passphrase-input').value = '';
  $('fac-error').classList.add('hidden');
  $('fac-taken-msg').classList.add('hidden');
  setTimeout(() => $('fac-passphrase-input').focus(), 100);
});

$('btn-fac-confirm').addEventListener('click', confirmFacilitator);
$('fac-passphrase-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmFacilitator();
});

function confirmFacilitator() {
  const pass = $('fac-passphrase-input').value;
  // The passphrase is the room ID itself — simple, no server needed
  if (pass !== currentRoom) {
    $('fac-error').classList.remove('hidden');
    return;
  }
  const holder = currentFacilitator(yFacEvents);
  if (holder !== null) {
    $('fac-error').classList.add('hidden');
    $('fac-taken-msg').classList.remove('hidden');
    return;
  }
  closeModal('modal-facilitator');
  pendingFacilitatorClaim = true;
  tryPendingFacilitatorClaim();
}

/**
 * Append a 'claim' event to the shared log. Even if our local view of
 * the log is stale (another claim is in flight), this is still safe:
 * the derivation function (currentFacilitator) replays the merged log
 * deterministically, and a 'claim' while the seat is occupied is a
 * no-op for everyone. We then verify after a sync round-trip.
 */
function tryPendingFacilitatorClaim() {
  if (!pendingFacilitatorClaim || !yFacEvents) return;

  // Don't even attempt while the websocket is still catching up.
  if (wsProvider && wsProvider.synced === false) {
    const onSync = synced => {
      if (synced) {
        try { wsProvider.off('sync', onSync); } catch (_) {}
        tryPendingFacilitatorClaim();
      }
    };
    wsProvider.on('sync', onSync);
    return;
  }

  pendingFacilitatorClaim = false;

  // Pre-check from our local view (best-effort UX feedback only).
  const localHolder = currentFacilitator(yFacEvents);
  if (localHolder === MY_USER_ID) return;
  if (localHolder !== null) {
    toast('🚫 This room already has a facilitator');
    return;
  }

  // Append the claim. If two peers do this concurrently, both events
  // land in the Y.Array; the first one (by Yjs merge order) wins.
  ydoc.transact(() => {
    yFacEvents.push([{ type: 'claim', userId: MY_USER_ID }]);
  });
  toast('🎭 Claiming facilitator role…');

  // Verify after a brief sync round-trip that our claim actually won.
  setTimeout(() => {
    if (!yFacEvents) return;
    const winner = currentFacilitator(yFacEvents);
    if (winner === MY_USER_ID) {
      toast('🎭 You are now the facilitator!');
    } else {
      toast('🚫 Another participant claimed the role first');
    }
    refreshFacilitatorUI();
  }, 1500);
}

$('btn-release-fac').addEventListener('click', () => {
  if (!isFacilitator) return;
  if (!confirm('Release the facilitator role? Another participant will be able to claim it.')) return;
  ydoc.transact(() => {
    yFacEvents.push([{ type: 'release', userId: MY_USER_ID }]);
  });
  toast('🔓 Facilitator role released');
});

/**
 * Reflect the current facilitator (derived from yFacEvents) in the UI.
 * Single source of truth — called by the yFacEvents observer.
 */
function refreshFacilitatorUI() {
  const holder = currentFacilitator(yFacEvents);
  const role = classifyFacilitatorRole(holder, MY_USER_ID);
  const wasFacilitator = isFacilitator;
  isFacilitator = (role === 'self');

  // Header button
  const btn = $('btn-facilitator');
  if (isFacilitator) {
    btn.textContent = '🎭 Facilitator ✓';
    btn.classList.add('btn-success');
    btn.classList.remove('is-taken');
    btn.removeAttribute('disabled');
    btn.title = 'You are the facilitator';
  } else if (role === 'taken') {
    btn.textContent = '🎭 Facilitator (taken)';
    btn.classList.remove('btn-success');
    btn.classList.add('is-taken');
    btn.setAttribute('disabled', '');
    btn.title = 'Another participant is currently the facilitator';
  } else {
    btn.textContent = '🎭 Facilitator';
    btn.classList.remove('btn-success');
    btn.classList.remove('is-taken');
    btn.removeAttribute('disabled');
    btn.title = 'Become facilitator';
  }

  // Facilitator bar + body class
  if (isFacilitator) {
    $('facilitator-bar').classList.remove('hidden');
    document.body.classList.add('is-facilitator');
  } else {
    $('facilitator-bar').classList.add('hidden');
    document.body.classList.remove('is-facilitator');
  }

  // Re-render cards in case facilitator-only affordances need to appear
  if (wasFacilitator !== isFacilitator) renderAllColumns();

  // Show/hide the global Blur All button — facilitator-only
  refreshHideAllButton();
}


/* ═══════════════════════════════════════════════════════
   ADD CARD MODAL
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.btn-add').forEach(btn => {
  btn.addEventListener('click', () => openAddModal(btn.dataset.col));
});

/* ─────────────────────────────────────────────────────
   CLEAR COLUMN — delete every card in a single column
───────────────────────────────────────────────────── */
document.querySelectorAll('.col-clear-btn').forEach(btn => {
  btn.addEventListener('click', () => clearColumn(btn.dataset.col));
});

function clearColumn(col) {
  if (!yCards) { toast('Not connected yet'); return; }
  // Collect card IDs for this column first (don't mutate while iterating)
  const ids = [];
  yCards.forEach((card, id) => {
    if (card.col === col) ids.push(id);
  });
  if (ids.length === 0) {
    toast(`${COL_LABELS[col] || col} is already empty`);
    return;
  }
  const label = COL_LABELS[col] || col;
  if (!confirm(`Delete all ${ids.length} card${ids.length === 1 ? '' : 's'} in "${label}"? This cannot be undone.`)) {
    return;
  }
  ydoc.transact(() => {
    ids.forEach(id => yCards.delete(id));
  });
  ids.forEach(id => myVotes.delete(id));
  toast(`🗑 Cleared ${ids.length} card${ids.length === 1 ? '' : 's'} from ${label}`);
}

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
    // New card — blur is now a single room-wide yMeta flag applied at
    // render time, so we don't need to set `hidden` on the card itself.
    const card = {
      id: uid(),
      col: currentCol,
      text: text,
      gif: selectedGifUrl || null,
      votes: 0,
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
  return searchGiphyInto(query, $('gif-results'), () => selectedGifUrl, (url, imgEl) => selectGif(url, imgEl));
}

/**
 * Generic Giphy search that renders results into an arbitrary container
 * and calls a callback when the user picks one.
 */
async function searchGiphyInto(query, resultsEl, getSelected, onPick) {
  resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px;">Searching…</p>';
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(query)}&limit=18&rating=g`;
    const res = await fetch(url);
    const data = await res.json();

    const kind = classifyGiphyStatus(data && data.meta);
    if (kind !== 'ok') {
      console.error('[Giphy] error response:', data && data.meta);
      const msg = (data && data.meta && data.meta.msg) || (data && data.meta && data.meta.status) || 'error';
      resultsEl.innerHTML = `<p style="color:#ff6b6b;font-size:13px;padding:8px;">Giphy error: ${msg}</p>`;
      return;
    }
    renderGifResultsInto(data.data || [], resultsEl, getSelected, onPick);
  } catch (err) {
    console.error('[Giphy] fetch failed:', err);
    resultsEl.innerHTML = '<p style="color:#ff6b6b;font-size:13px;padding:8px;">Failed to load GIFs. Check your connection.</p>';
  }
}


function renderGifResults(gifs) {
  renderGifResultsInto(gifs, $('gif-results'), () => selectedGifUrl, (url, imgEl) => selectGif(url, imgEl));
}

function renderGifResultsInto(gifs, resultsEl, getSelected, onPick) {
  if (!gifs.length) {
    resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px;">No GIFs found.</p>';
    return;
  }
  resultsEl.innerHTML = '';
  gifs.forEach(gif => {
    const img = document.createElement('img');
    img.src = gif.images.fixed_height_small.url;
    img.alt = gif.title;
    img.title = gif.title;
    if (getSelected() === gif.images.original.url) img.classList.add('selected');
    img.addEventListener('click', () => onPick(gif.images.original.url, img));
    resultsEl.appendChild(img);
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
  if (!yCards) return; // Yjs not ready yet — nothing to render
  COLUMNS.forEach(col => renderColumn(col));
  refreshOpenCommentsModal();
  refreshHideAllButton();
}

function renderColumn(col) {
  const list = $(`list-${col}`);
  const countEl = $(`count-${col}`);

  const cards = cardsByColumn(yCards, col);
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
  // Blur is a room-wide flag (yMeta.blurAll), not a per-card field.
  // Falling back to legacy card.hidden so cards from older versions still render correctly.
  const isBlurred = (yMeta && yMeta.get('blurAll') === true) || card.hidden === true;
  if (isBlurred) el.classList.add('hidden-card');

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

  // Comments button — shows count, opens comments modal
  const commentCount = (card.comments || []).length;
  const commentBtn = document.createElement('button');
  commentBtn.className = 'comment-btn' + (commentCount > 0 ? ' has-comments' : '');
  commentBtn.innerHTML = `<span>💬</span><span>${commentCount}</span>`;
  commentBtn.title = commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? 's' : ''}` : 'Add a comment';
  commentBtn.addEventListener('click', () => openCommentsModal(card.id));
  actions.appendChild(commentBtn);

  // Edit button (only card owner can edit — we track by client session; simpler: everyone can edit)
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-icon';
  editBtn.textContent = '✏️';
  editBtn.title = 'Edit card';
  editBtn.style.fontSize = '13px';
  editBtn.addEventListener('click', () => openAddModal(card.col, card.id));
  actions.appendChild(editBtn);

  // (Per-card blur button removed — use the global "🌫 Blur All" button in the header.)

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

function deleteCard(cardId) {
  if (!confirm('Delete this card?')) return;
  ydoc.transact(() => yCards.delete(cardId));
  myVotes.delete(cardId);
  toast('🗑 Card deleted');
}

/* ═══════════════════════════════════════════════════════
   COMMENTS
═══════════════════════════════════════════════════════ */
function openCommentsModal(cardId) {
  const card = yCards.get(cardId);
  if (!card) return;
  commentsCardId = cardId;

  // Card preview at top of modal
  const previewText = card.text ? card.text : '(GIF card)';
  $('comments-card-preview').innerHTML =
    `<strong>${COL_LABELS[card.col] || card.col}</strong> — ${escapeHtml(previewText)}`;

  // Restore author name if previously set
  const savedAuthor = localStorage.getItem('commentAuthor') || '';
  $('comment-author-input').value = savedAuthor;
  $('comment-text-input').value = '';

  // Reset the comment GIF picker
  selectedCommentGifUrl = null;
  $('comment-gif-preview').classList.add('hidden');
  $('comment-gif-preview-img').src = '';
  $('comment-gif-picker').classList.add('hidden');
  $('comment-gif-results').innerHTML = '';
  $('comment-gif-search-input').value = '';

  renderComments(card);
  openModal('modal-comments');
  setTimeout(() => $('comment-text-input').focus(), 100);
}

function renderComments(card) {
  const list = $('comments-list');
  list.innerHTML = '';
  const comments = (card.comments || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  comments.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comment-item';

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const left = document.createElement('span');
    const author = c.author && c.author.trim() ? c.author : 'Anonymous';
    const when = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
    left.innerHTML = `<span class="comment-author">${escapeHtml(author)}</span> · ${when}`;
    meta.appendChild(left);

    const del = document.createElement('button');
    del.className = 'comment-delete';
    del.textContent = '🗑';
    del.title = 'Delete comment';
    del.addEventListener('click', () => deleteComment(card.id, c.id));
    meta.appendChild(del);

    item.appendChild(meta);

    if (c.text) {
      const txt = document.createElement('p');
      txt.className = 'comment-text';
      txt.textContent = c.text;
      item.appendChild(txt);
    }
    if (c.gif) {
      const img = document.createElement('img');
      img.className = 'comment-gif';
      img.src = c.gif;
      img.alt = 'GIF';
      img.loading = 'lazy';
      item.appendChild(img);
    }

    list.appendChild(item);
  });
}

function addComment() {
  if (!commentsCardId) return;
  const card = yCards.get(commentsCardId);
  if (!card) return;

  const text = $('comment-text-input').value.trim();
  if (!text && !selectedCommentGifUrl) {
    toast('Write something or pick a GIF');
    return;
  }

  const author = $('comment-author-input').value.trim();
  if (author) localStorage.setItem('commentAuthor', author);

  const newComment = {
    id: uid(),
    text,
    gif: selectedCommentGifUrl || null,
    author,
    createdAt: Date.now(),
  };
  const updated = addCommentToCard(card, newComment);
  ydoc.transact(() => yCards.set(commentsCardId, updated));

  // Reset inputs
  $('comment-text-input').value = '';
  selectedCommentGifUrl = null;
  $('comment-gif-preview').classList.add('hidden');
  $('comment-gif-preview-img').src = '';

  renderComments(yCards.get(commentsCardId));
  toast('💬 Comment posted');
}

function deleteComment(cardId, commentId) {
  if (!confirm('Delete this comment?')) return;
  const card = yCards.get(cardId);
  if (!card) return;
  const updated = removeCommentFromCard(card, commentId);
  ydoc.transact(() => yCards.set(cardId, updated));
  if (commentsCardId === cardId) renderComments(updated);
}


// Wire up the comments modal
$('btn-add-comment').addEventListener('click', addComment);
$('comment-text-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment();
});

// --- Comment GIF picker ---------------------------------------------------
$('btn-comment-open-gif').addEventListener('click', () => {
  const picker = $('comment-gif-picker');
  picker.classList.toggle('hidden');
  if (!picker.classList.contains('hidden')) {
    $('comment-gif-search-input').focus();
    if (!$('comment-gif-results').innerHTML) searchCommentGiphy('reaction');
  }
});

$('btn-comment-gif-search').addEventListener('click', () => {
  searchCommentGiphy($('comment-gif-search-input').value.trim() || 'reaction');
});
$('comment-gif-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchCommentGiphy($('comment-gif-search-input').value.trim() || 'reaction');
  }
});

$('btn-comment-remove-gif').addEventListener('click', () => {
  selectedCommentGifUrl = null;
  $('comment-gif-preview').classList.add('hidden');
  $('comment-gif-preview-img').src = '';
});

function searchCommentGiphy(query) {
  return searchGiphyInto(
    query,
    $('comment-gif-results'),
    () => selectedCommentGifUrl,
    (url, imgEl) => selectCommentGif(url, imgEl)
  );
}

function selectCommentGif(url, imgEl) {
  selectedCommentGifUrl = url;
  document.querySelectorAll('#comment-gif-results img').forEach(i => i.classList.remove('selected'));
  imgEl.classList.add('selected');
  $('comment-gif-preview-img').src = url;
  $('comment-gif-preview').classList.remove('hidden');
  $('comment-gif-picker').classList.add('hidden');
  toast('🎞 GIF selected!');
}

// Keep the open comments modal live-synced when cards change remotely
function refreshOpenCommentsModal() {
  if (!commentsCardId) return;
  if ($('modal-comments').classList.contains('hidden')) return;
  const card = yCards.get(commentsCardId);
  if (card) renderComments(card);
}

/* ═══════════════════════════════════════════════════════
   EXPORT ACTION ITEMS
═══════════════════════════════════════════════════════ */
$('btn-export').addEventListener('click', () => {
  const actionCards = [];
  yCards.forEach(card => {
    if (card.col === 'action') actionCards.push(card);
  });
  $('export-text').value = buildExportMarkdown(actionCards, currentRoom);
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
