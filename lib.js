/* ═══════════════════════════════════════════════════════
   RETRO BOARD — lib.js
   Pure helpers extracted from app.js so they can be unit-tested
   without a DOM or Yjs runtime.
   ═══════════════════════════════════════════════════════ */

/** Constants shared between app.js and tests. */
export const COLUMNS = ['bad', 'sad', 'glad', 'action'];
export const COL_LABELS = {
  bad: '😞 Bad',
  sad: '😢 Sad',
  glad: '😊 Glad',
  action: '✅ Action Items',
};

/** Words used to build human-friendly room IDs. */
export const ROOM_WORDS = [
  'alpha','bravo','charlie','delta','echo','foxtrot','golf',
  'hotel','india','juliet','kilo','lima','mike','november',
  'oscar','papa','quebec','romeo','sierra','tango',
];

/**
 * Generate a short, unlikely-to-collide string identifier.
 * Combines a timestamp (base36) with random suffix.
 * @param {() => number} [now=Date.now] - injectable clock for tests
 * @param {() => number} [rand=Math.random] - injectable RNG for tests
 */
export function uid(now = Date.now, rand = Math.random) {
  return now().toString(36) + rand().toString(36).slice(2, 7);
}

/**
 * Build a three-word + 4-digit room ID, e.g. "alpha-bravo-1234".
 * @param {() => number} [rand=Math.random] - injectable RNG for tests
 */
export function generateRoomId(rand = Math.random) {
  const pick = () => ROOM_WORDS[Math.floor(rand() * ROOM_WORDS.length)];
  const digits = Math.floor(1000 + rand() * 9000);
  return `${pick()}-${pick()}-${digits}`;
}

/**
 * Extract a room ID from raw user input (URL with hash, bare ID, etc.).
 * Returns `null` when nothing usable can be parsed.
 */
export function parseRoomFromInput(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let roomId = trimmed;
  if (trimmed.includes('#')) roomId = trimmed.split('#').pop();
  roomId = roomId.trim();
  return roomId || null;
}

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Return cards from a Y.Map-like iterable filtered by column,
 * sorted by `createdAt` ascending (oldest first).
 * Accepts a Map, array of cards, or any object with `.forEach((card, id) => …)`.
 */
export function cardsByColumn(yMapOrArray, col) {
  const out = [];
  if (Array.isArray(yMapOrArray)) {
    for (const card of yMapOrArray) {
      if (card && card.col === col) out.push(card);
    }
  } else if (yMapOrArray && typeof yMapOrArray.forEach === 'function') {
    yMapOrArray.forEach((card /*, id*/) => {
      if (card && card.col === col) out.push(card);
    });
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return out;
}

/**
 * Compute the label/active state of the global "Blur All" button.
 * @param {boolean} blurAll - the persistent yMeta flag
 * @returns {{label: string, active: boolean}}
 */
export function blurButtonState(blurAll) {
  return blurAll
    ? { label: '👁 Unblur All', active: true }
    : { label: '🌫 Blur All',  active: false };
}

/**
 * Build the markdown export for the Action Items column.
 * @param {object[]} actionCards - already filtered to col === 'action'
 * @param {string} roomId
 * @param {Date} [date=new Date()]
 */
export function buildExportMarkdown(actionCards, roomId, date = new Date()) {
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const sorted = actionCards
    .slice()
    .sort((a, b) => (b.votes || 0) - (a.votes || 0));

  let md = `# 📋 Retro Action Items\n`;
  md    += `**Date:** ${dateStr}  \n`;
  md    += `**Room:** ${roomId}\n\n`;
  md    += `---\n\n`;

  if (sorted.length === 0) {
    md += '_No action items recorded._\n';
  } else {
    for (const card of sorted) {
      md += `- [ ] ${card.text || '(GIF card)'}`;
      if (card.votes) md += `  *(${card.votes} vote${card.votes !== 1 ? 's' : ''})*`;
      md += '\n';
      for (const c of (card.comments || [])) {
        const author = c.author && c.author.trim() ? c.author : 'Anonymous';
        const body = c.text || (c.gif ? '(GIF)' : '');
        md += `    - 💬 **${author}:** ${body}`;
        if (c.gif) md += `  \n        ![](${c.gif})`;
        md += '\n';
      }
    }
  }

  md += `\n---\n*Exported from Retro Board*\n`;
  return md;
}

/**
 * Interpret a Giphy `meta.status` response.
 * Returns one of: 'ok' | 'auth' | 'other'
 */
export function classifyGiphyStatus(meta) {
  if (!meta || typeof meta.status !== 'number') return 'ok';
  if (meta.status === 200) return 'ok';
  if (meta.status === 401 || meta.status === 403) return 'auth';
  return 'other';
}

/**
 * Add a comment immutably to a card's `comments` array.
 * Returns a new card object (does not mutate the input).
 */
export function addCommentToCard(card, comment) {
  return Object.assign({}, card, {
    comments: [...((card && card.comments) || []), comment],
  });
}

/**
 * Remove a comment by id from a card's `comments` array.
 * Returns a new card object (does not mutate the input).
 */
export function removeCommentFromCard(card, commentId) {
  return Object.assign({}, card, {
    comments: ((card && card.comments) || []).filter(c => c.id !== commentId),
  });
}

