export const SUITS = [
  { symbol: '♠', color: 'black', rank: 1 },
  { symbol: '♣', color: 'black', rank: 2 },
  { symbol: '♦', color: 'red', rank: 3 },
  { symbol: '♥', color: 'red', rank: 4 }
];

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'].map((label, i) => ({
  label,
  value: i + 3
}));

export const TWO = 15;

export function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({
        id: `${rank.label}-${suit.symbol}`,
        rankLabel: rank.label,
        rankValue: rank.value,
        suitSymbol: suit.symbol,
        suitColor: suit.color,
        suitRank: suit.rank,
        totalValue: rank.value * 4 + suit.rank
      });
    }
  }
  return deck;
}

export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const sortCards = (cards) => [...cards].sort((a, b) => a.totalValue - b.totalValue);

export const COMBO = {
  INVALID: 'INVALID',
  SINGLE: 'SINGLE',
  PAIR: 'PAIR',
  TRIPLE: 'TRIPLE',
  FOUR_OF_A_KIND: 'FOUR_OF_A_KIND',
  STRAIGHT: 'STRAIGHT',
  THREE_PAIRS_SERIES: 'THREE_PAIRS_SERIES',
  FOUR_PAIRS_SERIES: 'FOUR_PAIRS_SERIES'
};

export const COMBO_LABELS = {
  SINGLE: 'Rác',
  PAIR: 'Đôi',
  TRIPLE: 'Sám cô',
  FOUR_OF_A_KIND: 'Tứ quý',
  STRAIGHT: 'Sảnh',
  THREE_PAIRS_SERIES: '3 đôi thông',
  FOUR_PAIRS_SERIES: '4 đôi thông'
};

const sameRank = (cards) => cards.every((c) => c.rankValue === cards[0].rankValue);

function isPairsSeries(cards, numPairs) {
  if (cards.length !== numPairs * 2) return false;
  for (let i = 0; i < numPairs; i++) {
    const a = cards[i * 2];
    const b = cards[i * 2 + 1];
    if (a.rankValue !== b.rankValue || a.rankValue === TWO) return false;
    if (i > 0 && a.rankValue !== cards[(i - 1) * 2].rankValue + 1) return false;
  }
  return true;
}

export function detectCombo(rawCards, mode = 'TLMN') {
  if (!rawCards?.length) return { type: COMBO.INVALID };
  const cards = sortCards(rawCards);
  const len = cards.length;
  const highest = cards[len - 1];
  const result = (type) => ({ type, highest, count: len });

  if (len === 1) return result(COMBO.SINGLE);
  if (len === 2 && sameRank(cards)) {
    if (mode === 'TLMB' && cards[0].suitColor !== cards[1].suitColor) return { type: COMBO.INVALID };
    return result(COMBO.PAIR);
  }
  if (len === 3 && sameRank(cards)) return result(COMBO.TRIPLE);
  if (len === 4 && sameRank(cards)) return result(COMBO.FOUR_OF_A_KIND);

  if (len >= 3 && !cards.some((c) => c.rankValue === TWO)) {
    const isSequence = cards.every((c, i) => i === 0 || c.rankValue === cards[i - 1].rankValue + 1);
    if (isSequence) {
      if (mode === 'TLMB' && !cards.every((c) => c.suitSymbol === cards[0].suitSymbol)) {
        return { type: COMBO.INVALID };
      }
      return result(COMBO.STRAIGHT);
    }
  }

  if (mode === 'TLMN') {
    if (len === 6 && isPairsSeries(cards, 3)) return result(COMBO.THREE_PAIRS_SERIES);
    if (len === 8 && isPairsSeries(cards, 4)) return result(COMBO.FOUR_PAIRS_SERIES);
  }

  return { type: COMBO.INVALID };
}

function canChop(next, prev, mode) {
  const isTwo = prev.highest.rankValue === TWO;
  if (mode === 'TLMN') {
    if (prev.type === COMBO.SINGLE && isTwo) {
      return [COMBO.THREE_PAIRS_SERIES, COMBO.FOUR_OF_A_KIND, COMBO.FOUR_PAIRS_SERIES].includes(next.type);
    }
    if (prev.type === COMBO.PAIR && isTwo) {
      return [COMBO.FOUR_OF_A_KIND, COMBO.FOUR_PAIRS_SERIES].includes(next.type);
    }
    if (prev.type === COMBO.THREE_PAIRS_SERIES) {
      return [COMBO.FOUR_OF_A_KIND, COMBO.FOUR_PAIRS_SERIES].includes(next.type);
    }
    if (prev.type === COMBO.FOUR_OF_A_KIND) return next.type === COMBO.FOUR_PAIRS_SERIES;
  }
  if (mode === 'TLMB' && prev.type === COMBO.SINGLE && isTwo) return next.type === COMBO.FOUR_OF_A_KIND;
  return false;
}

export function canBeat(cards, lastPlayed, mode = 'TLMN') {
  const next = detectCombo(cards, mode);
  if (next.type === COMBO.INVALID) return false;
  if (!lastPlayed?.combo) return true;

  const prev = lastPlayed.combo;
  if (canChop(next, prev, mode)) return true;
  if (next.type !== prev.type || next.count !== prev.count) return false;

  if (mode === 'TLMB' && next.type === COMBO.SINGLE) {
    const involvesTwo = prev.highest.rankValue === TWO || next.highest.rankValue === TWO;
    if (!involvesTwo && next.highest.suitSymbol !== prev.highest.suitSymbol) return false;
  }

  return next.highest.totalValue > prev.highest.totalValue;
}
