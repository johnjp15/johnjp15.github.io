// The 78 unique facts of the 1–12 times tables (3×7 and 7×3 are the same fact),
// plus the boss for each table and a memory trick for every fact.

export const MAX = 12;
/** Correct in under this many ms = recalled from memory, not worked out. */
export const FAST_MS = 3000;

export const FACTS = [];
for (let a = 1; a <= MAX; a++) for (let b = a; b <= MAX; b++) FACTS.push({ a, b, key: `${a}x${b}` });
export const TOTAL = FACTS.length; // 78

const BY_KEY = new Map(FACTS.map(f => [f.key, f]));
export const keyOf = (a, b) => (a <= b ? `${a}x${b}` : `${b}x${a}`);
export const factOf = (a, b) => BY_KEY.get(keyOf(a, b));

// Kids usually know these tables first, so new facts are introduced in this order.
export const TABLE_ORDER = [1, 10, 2, 5, 11, 3, 4, 9, 6, 12, 8, 7];
const RANK = Object.fromEntries(TABLE_ORDER.map((t, i) => [t, i]));

/** A fact is as easy as its easier factor: 2×7 is easy because doubling is easy. */
export function difficulty(f) {
  const lo = Math.min(RANK[f.a], RANK[f.b]);
  const hi = Math.max(RANK[f.a], RANK[f.b]);
  return lo * 12 + hi;
}

export const inTable = (f, t) => f.a === t || f.b === t;
export const tableFacts = t => FACTS.filter(f => inTable(f, t));

export const BOSSES = {
  1: { emoji: '🐌', name: 'Sluggo the Snail', taunt: 'Nobody beats a snail… slowly.' },
  2: { emoji: '🦀', name: 'Double-Claw Crab', taunt: 'Two claws, twice the trouble!' },
  3: { emoji: '🦕', name: 'Tri-Dino', taunt: 'Rawr × 3!' },
  4: { emoji: '🐢', name: 'Four-Foot Turtle', taunt: 'My shell is unbreakable!' },
  5: { emoji: '🦈', name: 'High-Five Shark', taunt: 'Gimme five… teeth!' },
  6: { emoji: '🐝', name: 'Hex Bee', taunt: 'Bzzz… six sides of sting!' },
  7: { emoji: '👻', name: 'Spooky Seven', taunt: 'Sevens are the scariest… boo!' },
  8: { emoji: '🐙', name: 'Octo-Crusher', taunt: 'Eight arms. Zero mercy.' },
  9: { emoji: '🦊', name: 'Nine-Tail Fox', taunt: 'Try to catch all nine tails!' },
  10: { emoji: '🤖', name: 'Deca-Bot', taunt: 'BEEP. COMPUTING YOUR DEFEAT.' },
  11: { emoji: '👽', name: 'Alien Eleven', taunt: 'Take me to your times tables.' },
  12: { emoji: '🐲', name: 'The Dozen Dragon', taunt: 'I am the final boss of numbers!' },
};

const SPECIAL = {
  '3x4': '1, 2, 3, 4 → 12 = 3 × 4 🔢',
  '4x6': '6 × 4 = 24, shut the door! 🚪',
  '6x6': '6 × 6 = 36, pick up sticks! 🥢',
  '6x7': '6 × 7 = 42 — the answer to everything! 🌌',
  '6x8': '6 and 8 went on a date, got home at 48! 💕',
  '7x7': '7 × 7 = 49, feeling fine! 😎',
  '7x8': '5, 6, 7, 8 → 56 = 7 × 8 🔢',
  '8x8': 'I ate and I ate and got sick on the floor: 8 × 8 = 64! 🤢',
  '11x11': '11 × 11 = 121 — the same forwards and backwards!',
  '11x12': '11 × 12 = 120 + 12 = 132',
  '12x12': '12 × 12 = 144. There\'s even a word for 144: a "gross"! 🤓',
};

// Which factor's trick to use when both have one: easiest trick first.
const TRICK_ORDER = [1, 10, 11, 2, 5, 9, 4, 12, 3, 6, 8, 7];

function rule(t, o) {
  const p = t * o;
  switch (t) {
    case 1: return `Anything × 1 stays the same, so the answer is ${o}`;
    case 10: return `× 10? Just stick a zero on the end: ${o} → ${p}`;
    case 11: return o <= 9 ? `× 11 (up to 9): write the number twice → ${o}${o}` : null;
    case 2: return `× 2 means double it: ${o} + ${o} = ${p}`;
    case 5: return `× 5 is half of × 10: half of ${o * 10} is ${p}`;
    case 9: return o <= 10
      ? `9s trick: the first digit is one less than ${o} (${o - 1}), and the digits add up to 9 → ${p}`
      : `9 × ${o} = 10 × ${o} − ${o} = ${o * 10} − ${o} = ${p}`;
    case 4: return `× 4 = double, then double again: ${o} → ${o * 2} → ${p}`;
    case 12: return `× 12 = × 10 plus × 2: ${o * 10} + ${o * 2} = ${p}`;
    case 3: return `× 3 = double it, then add one more: ${o * 2} + ${o} = ${p}`;
    case 6: return o % 2 === 0 && o <= 8
      ? `6 × an even number ends in that number: 6 × ${o} = ${p}`
      : `× 6 = × 5 plus one more: ${o * 5} + ${o} = ${p}`;
    case 8: return `× 8 = double, double, double: ${o} → ${o * 2} → ${o * 4} → ${p}`;
    case 7: return `7 × ${o} = 5 × ${o} + 2 × ${o} = ${o * 5} + ${o * 2} = ${p}`;
    default: return null;
  }
}

export function trickFor(a, b) {
  const special = SPECIAL[keyOf(a, b)];
  if (special) return special;
  for (const t of TRICK_ORDER) {
    if (t !== a && t !== b) continue;
    const r = rule(t, t === a ? b : a);
    if (r) return r;
  }
  return null;
}
