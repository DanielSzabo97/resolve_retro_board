/* ═══════════════════════════════════════════════════════
   RETRO BOARD — lib.test.js
   Vitest unit tests for the pure helpers in lib.js.
   Run with:  npm test          (one-shot)
              npm run test:watch (watch mode)
   ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  COLUMNS,
  COL_LABELS,
  ROOM_WORDS,
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
  defaultDisplayName,
  getOrCreateDisplayName,
  formatParticipants,
} from './lib.js';

/* ─────────────────────────────────────────────────────
   constants
───────────────────────────────────────────────────── */
describe('constants', () => {
  it('defines exactly the four expected columns', () => {
    expect(COLUMNS).toEqual(['bad', 'sad', 'glad', 'action']);
  });

  it('provides a label for every column', () => {
    for (const col of COLUMNS) {
      expect(COL_LABELS[col]).toBeTypeOf('string');
      expect(COL_LABELS[col].length).toBeGreaterThan(0);
    }
  });

  it('ROOM_WORDS is non-empty and unique', () => {
    expect(ROOM_WORDS.length).toBeGreaterThan(0);
    expect(new Set(ROOM_WORDS).size).toBe(ROOM_WORDS.length);
  });
});

/* ─────────────────────────────────────────────────────
   uid
───────────────────────────────────────────────────── */
describe('uid', () => {
  it('produces a non-empty string', () => {
    const id = uid();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('produces different ids on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });

  it('is deterministic when clock + RNG are injected', () => {
    const now = () => 1_700_000_000_000;
    const rand = () => 0.123456;
    expect(uid(now, rand)).toBe(uid(now, rand));
  });
});

/* ─────────────────────────────────────────────────────
   generateRoomId
───────────────────────────────────────────────────── */
describe('generateRoomId', () => {
  it('matches the "word-word-NNNN" pattern', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRoomId()).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    }
  });

  it('uses ROOM_WORDS for the two word slots', () => {
    const id = generateRoomId();
    const [w1, w2] = id.split('-');
    expect(ROOM_WORDS).toContain(w1);
    expect(ROOM_WORDS).toContain(w2);
  });

  it('produces a 4-digit number between 1000 and 9999', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(generateRoomId().split('-')[2]);
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });

  it('is deterministic when the RNG is injected', () => {
    const seq = [0.1, 0.2, 0.3];
    const mkRng = () => { let i = 0; return () => seq[i++ % seq.length]; };
    expect(generateRoomId(mkRng())).toBe(generateRoomId(mkRng()));
  });
});

/* ─────────────────────────────────────────────────────
   parseRoomFromInput
───────────────────────────────────────────────────── */
describe('parseRoomFromInput', () => {
  it('returns null for empty / whitespace / non-strings', () => {
    expect(parseRoomFromInput('')).toBeNull();
    expect(parseRoomFromInput('   ')).toBeNull();
    expect(parseRoomFromInput(null)).toBeNull();
    expect(parseRoomFromInput(undefined)).toBeNull();
    expect(parseRoomFromInput(123)).toBeNull();
  });

  it('returns a bare room id unchanged', () => {
    expect(parseRoomFromInput('alpha-bravo-1234')).toBe('alpha-bravo-1234');
  });

  it('trims surrounding whitespace', () => {
    expect(parseRoomFromInput('  alpha-bravo-1234  ')).toBe('alpha-bravo-1234');
  });

  it('extracts the hash from a full URL', () => {
    expect(parseRoomFromInput('https://example.com/path/#alpha-bravo-1234'))
      .toBe('alpha-bravo-1234');
  });

  it('extracts the hash even without a host', () => {
    expect(parseRoomFromInput('#alpha-bravo-1234')).toBe('alpha-bravo-1234');
  });

  it('returns null when the URL has an empty hash', () => {
    expect(parseRoomFromInput('https://example.com/#')).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────
   escapeHtml
───────────────────────────────────────────────────── */
describe('escapeHtml', () => {
  it('escapes the five sensitive characters', () => {
    expect(escapeHtml(`<script>alert("xss & 'no'")</script>`))
      .toBe('&lt;script&gt;alert(&quot;xss &amp; &#39;no&#39;&quot;)&lt;/script&gt;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Hello world 123')).toBe('Hello world 123');
  });

  it('coerces non-strings to strings', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});

/* ─────────────────────────────────────────────────────
   cardsByColumn
───────────────────────────────────────────────────── */
describe('cardsByColumn', () => {
  const cards = [
    { id: 'a', col: 'bad',  createdAt: 30 },
    { id: 'b', col: 'glad', createdAt: 10 },
    { id: 'c', col: 'bad',  createdAt: 10 },
    { id: 'd', col: 'bad',  createdAt: 20 },
    { id: 'e', col: 'sad',  createdAt: 5 },
  ];

  it('filters to the requested column and sorts ascending by createdAt', () => {
    const ids = cardsByColumn(cards, 'bad').map(c => c.id);
    expect(ids).toEqual(['c', 'd', 'a']);
  });

  it('returns an empty array when no cards match', () => {
    expect(cardsByColumn(cards, 'action')).toEqual([]);
  });

  it('works with a Map-like (Y.Map) object that exposes forEach(value, key)', () => {
    const fakeYMap = {
      forEach(fn) { cards.forEach(c => fn(c, c.id)); },
    };
    const ids = cardsByColumn(fakeYMap, 'bad').map(c => c.id);
    expect(ids).toEqual(['c', 'd', 'a']);
  });

  it('treats missing createdAt as 0 and is stable enough', () => {
    const noTimes = [{ col: 'bad' }, { col: 'bad', createdAt: 1 }];
    const out = cardsByColumn(noTimes, 'bad');
    expect(out[0].createdAt).toBeUndefined();
    expect(out[1].createdAt).toBe(1);
  });

  it('handles undefined / non-iterable input', () => {
    expect(cardsByColumn(undefined, 'bad')).toEqual([]);
    expect(cardsByColumn(null, 'bad')).toEqual([]);
    expect(cardsByColumn(42, 'bad')).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────
   blurButtonState
───────────────────────────────────────────────────── */
describe('blurButtonState', () => {
  it('shows "Blur All" when blurAll is false', () => {
    expect(blurButtonState(false)).toEqual({ label: '🌫 Blur All', active: false });
  });

  it('shows "Unblur All" when blurAll is true', () => {
    expect(blurButtonState(true)).toEqual({ label: '👁 Unblur All', active: true });
  });
});

/* ─────────────────────────────────────────────────────
   classifyGiphyStatus
───────────────────────────────────────────────────── */
describe('classifyGiphyStatus', () => {
  it('returns "ok" for status 200', () => {
    expect(classifyGiphyStatus({ status: 200 })).toBe('ok');
  });

  it('returns "ok" for missing / malformed meta', () => {
    expect(classifyGiphyStatus(undefined)).toBe('ok');
    expect(classifyGiphyStatus(null)).toBe('ok');
    expect(classifyGiphyStatus({})).toBe('ok');
    expect(classifyGiphyStatus({ status: 'oops' })).toBe('ok');
  });

  it('returns "auth" for 401/403', () => {
    expect(classifyGiphyStatus({ status: 401 })).toBe('auth');
    expect(classifyGiphyStatus({ status: 403 })).toBe('auth');
  });

  it('returns "other" for any other non-200 numeric status', () => {
    expect(classifyGiphyStatus({ status: 500 })).toBe('other');
    expect(classifyGiphyStatus({ status: 429 })).toBe('other');
    expect(classifyGiphyStatus({ status: 404 })).toBe('other');
  });
});

/* ─────────────────────────────────────────────────────
   addCommentToCard / removeCommentFromCard
───────────────────────────────────────────────────── */
describe('comment helpers', () => {
  const baseCard = { id: 'card1', col: 'bad', text: 'meh', comments: [
    { id: 'c1', text: 'first',  author: 'Alice', createdAt: 1 },
    { id: 'c2', text: 'second', author: 'Bob',   createdAt: 2 },
  ]};

  it('addCommentToCard appends without mutating the input', () => {
    const before = JSON.parse(JSON.stringify(baseCard));
    const newComment = { id: 'c3', text: 'third', createdAt: 3 };
    const after = addCommentToCard(baseCard, newComment);
    expect(after).not.toBe(baseCard);
    expect(after.comments).toHaveLength(3);
    expect(after.comments[2]).toEqual(newComment);
    expect(baseCard).toEqual(before); // unchanged
  });

  it('addCommentToCard works on a card that has no comments array', () => {
    const card = { id: 'x', col: 'glad' };
    const after = addCommentToCard(card, { id: 'c1', text: 'hi' });
    expect(after.comments).toEqual([{ id: 'c1', text: 'hi' }]);
    expect(card.comments).toBeUndefined();
  });

  it('removeCommentFromCard drops the matching id only', () => {
    const after = removeCommentFromCard(baseCard, 'c1');
    expect(after.comments.map(c => c.id)).toEqual(['c2']);
  });

  it('removeCommentFromCard returns a card with empty comments when id not found', () => {
    const after = removeCommentFromCard(baseCard, 'nope');
    expect(after.comments).toHaveLength(2);
  });

  it('removeCommentFromCard tolerates a card without comments', () => {
    const after = removeCommentFromCard({ id: 'x' }, 'c1');
    expect(after.comments).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────
   buildExportMarkdown
───────────────────────────────────────────────────── */
describe('buildExportMarkdown', () => {
  const fixedDate = new Date('2026-06-12T10:00:00Z');

  it('produces the empty-state body when there are no action items', () => {
    const md = buildExportMarkdown([], 'alpha-bravo-1234', fixedDate);
    expect(md).toContain('# 📋 Retro Action Items');
    expect(md).toContain('**Room:** alpha-bravo-1234');
    expect(md).toContain('_No action items recorded._');
  });

  it('sorts items by vote count descending', () => {
    const cards = [
      { text: 'low',   votes: 1 },
      { text: 'high',  votes: 5 },
      { text: 'mid',   votes: 3 },
    ];
    const md = buildExportMarkdown(cards, 'room', fixedDate);
    const idxHigh = md.indexOf('high');
    const idxMid  = md.indexOf('mid');
    const idxLow  = md.indexOf('low');
    expect(idxHigh).toBeLessThan(idxMid);
    expect(idxMid).toBeLessThan(idxLow);
  });

  it('does not mutate the input array', () => {
    const cards = [{ text: 'a', votes: 1 }, { text: 'b', votes: 2 }];
    const snapshot = JSON.parse(JSON.stringify(cards));
    buildExportMarkdown(cards, 'r', fixedDate);
    expect(cards).toEqual(snapshot);
  });

  it('renders vote count suffix correctly (singular vs plural)', () => {
    const md = buildExportMarkdown(
      [
        { text: 'one',   votes: 1 },
        { text: 'three', votes: 3 },
        { text: 'zero',  votes: 0 },
      ],
      'r',
      fixedDate,
    );
    expect(md).toMatch(/one.*\*\(1 vote\)\*/);
    expect(md).toMatch(/three.*\*\(3 votes\)\*/);
    // 0-vote items should NOT have a vote suffix
    expect(md).not.toMatch(/zero.*vote/);
  });

  it('falls back to "(GIF card)" when text is empty', () => {
    const md = buildExportMarkdown([{ text: '', gif: 'x', votes: 0 }], 'r', fixedDate);
    expect(md).toContain('(GIF card)');
  });

  it('renders comments nested under their action item', () => {
    const md = buildExportMarkdown([
      {
        text: 'Improve standups',
        votes: 2,
        comments: [
          { author: 'Alice', text: 'Maybe 15 min?' },
          { author: '',      text: 'No name here' },
          { author: 'Bob',   text: '',  gif: 'https://giphy.com/x.gif' },
        ],
      },
    ], 'r', fixedDate);

    expect(md).toContain('💬 **Alice:** Maybe 15 min?');
    expect(md).toContain('💬 **Anonymous:** No name here');
    expect(md).toContain('💬 **Bob:** (GIF)');
    expect(md).toContain('![](https://giphy.com/x.gif)');
  });

  it('includes a footer line', () => {
    const md = buildExportMarkdown([], 'r', fixedDate);
    expect(md.trim().endsWith('*Exported from Retro Board*')).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────
   getOrCreateUserId
───────────────────────────────────────────────────── */
describe('getOrCreateUserId', () => {
  function fakeStorage() {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      _map: m,
    };
  }

  it('creates and persists a new id on first call', () => {
    const s = fakeStorage();
    const id = getOrCreateUserId(s, () => 'fresh-id');
    expect(id).toBe('fresh-id');
    expect(s.getItem('userId')).toBe('fresh-id');
  });

  it('returns the existing id on subsequent calls', () => {
    const s = fakeStorage();
    s.setItem('userId', 'persisted-123');
    const id = getOrCreateUserId(s, () => 'should-not-be-used');
    expect(id).toBe('persisted-123');
  });

  it('falls back to a generated id when storage is missing', () => {
    const id = getOrCreateUserId(null, () => 'no-storage');
    expect(id).toBe('no-storage');
  });

  it('is stable across calls when backed by storage', () => {
    const s = fakeStorage();
    const a = getOrCreateUserId(s);
    const b = getOrCreateUserId(s);
    expect(a).toBe(b);
  });
});

/* ─────────────────────────────────────────────────────
   classifyFacilitatorRole
───────────────────────────────────────────────────── */
describe('classifyFacilitatorRole', () => {
  it('returns "vacant" when facilitatorId is empty / null / undefined', () => {
    expect(classifyFacilitatorRole('',         'me')).toBe('vacant');
    expect(classifyFacilitatorRole(null,       'me')).toBe('vacant');
    expect(classifyFacilitatorRole(undefined,  'me')).toBe('vacant');
  });

  it('returns "self" when facilitatorId matches my id', () => {
    expect(classifyFacilitatorRole('me', 'me')).toBe('self');
  });

  it('returns "taken" when facilitatorId belongs to someone else', () => {
    expect(classifyFacilitatorRole('alice', 'bob')).toBe('taken');
  });
});

/* ─────────────────────────────────────────────────────
   currentFacilitator (the anti-steal derivation)
───────────────────────────────────────────────────── */
describe('currentFacilitator', () => {
  it('returns null for empty / missing / non-array input', () => {
    expect(currentFacilitator(undefined)).toBeNull();
    expect(currentFacilitator(null)).toBeNull();
    expect(currentFacilitator([])).toBeNull();
  });

  it('honors a single claim from a vacant state', () => {
    expect(currentFacilitator([
      { type: 'claim', userId: 'A' },
    ])).toBe('A');
  });

  it('honors release only from the current holder', () => {
    expect(currentFacilitator([
      { type: 'claim',   userId: 'A' },
      { type: 'release', userId: 'A' },
    ])).toBeNull();
  });

  it('IGNORES a claim while the seat is occupied (anti-steal)', () => {
    // Even though "claim B" appears AFTER "claim A", B does NOT take over —
    // because the seat was not vacant when B's claim was processed.
    expect(currentFacilitator([
      { type: 'claim', userId: 'A' },
      { type: 'claim', userId: 'B' },
    ])).toBe('A');
  });

  it('IGNORES a release by someone who is not the holder', () => {
    expect(currentFacilitator([
      { type: 'claim',   userId: 'A' },
      { type: 'release', userId: 'B' }, // not the holder, ignored
    ])).toBe('A');
  });

  it('handles a full claim → release → claim cycle', () => {
    expect(currentFacilitator([
      { type: 'claim',   userId: 'A' },
      { type: 'release', userId: 'A' },
      { type: 'claim',   userId: 'B' },
    ])).toBe('B');
  });

  it('still rejects a steal AFTER a proper handoff', () => {
    // The user-reported scenario: A → release A → B claims → A tries to re-claim.
    // A's late claim is processed when seat is occupied (by B) → no-op.
    expect(currentFacilitator([
      { type: 'claim',   userId: 'A' },
      { type: 'release', userId: 'A' },
      { type: 'claim',   userId: 'B' },
      { type: 'claim',   userId: 'A' }, // A's stale-view steal attempt
    ])).toBe('B');
  });

  it('concurrent claims: whichever Yjs orders first wins; the other is a no-op', () => {
    // Both peers thought the seat was vacant. Yjs merges them in SOME order.
    // Whichever ends up first wins; the other is dropped.
    expect(currentFacilitator([
      { type: 'claim', userId: 'A' },
      { type: 'claim', userId: 'B' },
    ])).toBe('A');

    expect(currentFacilitator([
      { type: 'claim', userId: 'B' },
      { type: 'claim', userId: 'A' },
    ])).toBe('B');
  });

  it('multiple release/claim cycles converge correctly', () => {
    expect(currentFacilitator([
      { type: 'claim',   userId: 'A' },
      { type: 'release', userId: 'A' },
      { type: 'claim',   userId: 'B' },
      { type: 'release', userId: 'B' },
      { type: 'claim',   userId: 'C' },
    ])).toBe('C');
  });

  it('ignores malformed events without crashing', () => {
    expect(currentFacilitator([
      null,
      undefined,
      'not an object',
      { type: 'claim' },                     // missing userId
      { type: 'claim', userId: '' },         // empty userId
      { type: 'unknown', userId: 'X' },      // bad type
      { type: 'claim', userId: 'A' },        // valid
    ])).toBe('A');
  });

  it('accepts Y.Array-like objects (anything with toArray)', () => {
    const fakeYArray = {
      toArray() { return [{ type: 'claim', userId: 'Z' }]; },
    };
    expect(currentFacilitator(fakeYArray)).toBe('Z');
  });
});

/* ─────────────────────────────────────────────────────
   defaultDisplayName / getOrCreateDisplayName
───────────────────────────────────────────────────── */
describe('display name helpers', () => {
  function fakeStorage() {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
    };
  }

  it('defaultDisplayName produces "Guest NNNN"', () => {
    expect(defaultDisplayName(() => 0)).toBe('Guest 1000');
    expect(defaultDisplayName(() => 0.9999)).toMatch(/^Guest \d{4}$/);
  });

  it('getOrCreateDisplayName creates and persists', () => {
    const s = fakeStorage();
    const a = getOrCreateDisplayName(s, () => 0);
    expect(a).toBe('Guest 1000');
    expect(s.getItem('displayName')).toBe('Guest 1000');
  });

  it('getOrCreateDisplayName returns existing value', () => {
    const s = fakeStorage();
    s.setItem('displayName', 'Alice');
    expect(getOrCreateDisplayName(s, () => 0)).toBe('Alice');
  });

  it('getOrCreateDisplayName falls back without storage', () => {
    expect(getOrCreateDisplayName(null, () => 0.5)).toMatch(/^Guest \d{4}$/);
  });
});

/* ─────────────────────────────────────────────────────
   formatParticipants
───────────────────────────────────────────────────── */
describe('formatParticipants', () => {
  it('returns [] for null/undefined input', () => {
    expect(formatParticipants(null, 'me', null)).toEqual([]);
    expect(formatParticipants(undefined, 'me', null)).toEqual([]);
  });

  it('always includes me even when awareness has no state yet', () => {
    const list = formatParticipants(new Map(), 'me', null);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: 'me', isMe: true, isFacilitator: false });
  });

  it('deduplicates multiple tabs of the same user', () => {
    const states = new Map([
      [1, { userId: 'A', displayName: 'Alice' }],
      [2, { userId: 'A', displayName: 'Alice (other tab)' }],
      [3, { userId: 'B', displayName: 'Bob' }],
    ]);
    const list = formatParticipants(states, 'A', null);
    expect(list.map(p => p.userId)).toEqual(['A', 'Bob' === 'Bob' ? 'B' : 'B']); // me first
    expect(list).toHaveLength(2);
  });

  it('pins me to the top, others sorted by display name', () => {
    const states = [
      [1, { userId: 'X', displayName: 'Zelda' }],
      [2, { userId: 'Y', displayName: 'Anne'  }],
      [3, { userId: 'me', displayName: 'I am me' }],
    ];
    const list = formatParticipants(states, 'me', null);
    expect(list.map(p => p.displayName)).toEqual(['I am me', 'Anne', 'Zelda']);
  });

  it('marks the facilitator', () => {
    const states = [
      [1, { userId: 'me',  displayName: 'Me' }],
      [2, { userId: 'fac', displayName: 'Boss' }],
    ];
    const list = formatParticipants(states, 'me', 'fac');
    const boss = list.find(p => p.userId === 'fac');
    expect(boss.isFacilitator).toBe(true);
    expect(list.find(p => p.userId === 'me').isFacilitator).toBe(false);
  });

  it('falls back to "Guest" when displayName is empty', () => {
    const states = [[1, { userId: 'X', displayName: '   ' }]];
    expect(formatParticipants(states, 'me', null)
      .find(p => p.userId === 'X').displayName).toBe('Guest');
  });

  it('skips awareness states with no userId', () => {
    const states = [
      [1, { online: true }],         // no userId
      [2, { userId: 'A', displayName: 'Alice' }],
    ];
    const list = formatParticipants(states, 'me', null);
    expect(list.map(p => p.userId).sort()).toEqual(['A', 'me']);
  });

  it('accepts Map, array-of-tuples, and plain object input', () => {
    const expected = [{ userId: 'A', displayName: 'Alice' }];
    const fromMap   = formatParticipants(new Map([[1, expected[0]]]), 'A', null);
    const fromArray = formatParticipants([[1, expected[0]]],          'A', null);
    const fromObj   = formatParticipants({ '1': expected[0] },         'A', null);
    expect(fromMap[0].displayName).toBe('Alice');
    expect(fromArray[0].displayName).toBe('Alice');
    expect(fromObj[0].displayName).toBe('Alice');
  });
});
