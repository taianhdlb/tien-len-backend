// Bộ bài và thuật toán Phỏm (Tá Lả).
// Giá trị lá bài theo luật Phỏm: A=1, 2..10, J=11, Q=12, K=13. Sảnh không vòng K-A-2.

export const SUITS = [
  { symbol: '♠', color: 'black', rank: 1 },
  { symbol: '♣', color: 'black', rank: 2 },
  { symbol: '♦', color: 'red', rank: 3 },
  { symbol: '♥', color: 'red', rank: 4 }
];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((label) => ({
  label,
  value: Number(label) || (label === 'A' ? 1 : { J: 11, Q: 12, K: 13 }[label])
}));

export function createPhomDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({
        id: `${rank.label}-${suit.symbol}`,
        rankLabel: rank.label,
        rankValue: rank.value,
        suitSymbol: suit.symbol,
        suitColor: suit.color,
        suitRank: suit.rank
      });
    }
  }
  return deck;
}

export const sortPhom = (cards) =>
  [...cards].sort((a, b) => a.rankValue - b.rankValue || a.suitRank - b.suitRank);

export const cardName = (card) => `${card.rankLabel}${card.suitSymbol}`;

export const isRun = (cards) =>
  cards.length >= 3 &&
  cards.every((c) => c.suitSymbol === cards[0].suitSymbol) &&
  cards.every((c, i) => i === 0 || c.rankValue === cards[i - 1].rankValue + 1);

export const isSet = (cards) =>
  cards.length >= 3 && cards.length <= 4 && cards.every((c) => c.rankValue === cards[0].rankValue);

export function isValidPhom(rawCards) {
  if (!Array.isArray(rawCards) || rawCards.length < 3) return false;
  const cards = sortPhom(rawCards);
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return false;
  return isSet(cards) || isRun(cards);
}

export const phomType = (rawCards) => {
  const cards = sortPhom(rawCards);
  if (isSet(cards)) return 'SET';
  if (isRun(cards)) return 'RUN';
  return 'INVALID';
};

export const phomLabel = (rawCards) => (phomType(rawCards) === 'SET' ? 'Sám' : 'Sảnh');

// Mọi tập con hợp lệ của một tay bài (phỏm ngang 3-4 lá, sảnh từ 3 lá trở lên).
export function findMelds(cards) {
  const out = [];
  const byRank = new Map();
  const bySuit = new Map();
  for (const card of cards) {
    if (!byRank.has(card.rankValue)) byRank.set(card.rankValue, []);
    byRank.get(card.rankValue).push(card);
    if (!bySuit.has(card.suitSymbol)) bySuit.set(card.suitSymbol, []);
    bySuit.get(card.suitSymbol).push(card);
  }

  for (const group of byRank.values()) {
    if (group.length < 3) continue;
    if (group.length === 3) out.push(group);
    else for (let skip = 0; skip < group.length; skip++) out.push(group.filter((_, i) => i !== skip));
    if (group.length === 4) out.push(group);
  }

  for (const suit of bySuit.values()) {
    const sorted = sortPhom(suit);
    for (let start = 0; start < sorted.length; start++) {
      for (let end = start + 2; end < sorted.length; end++) {
        const window = sorted.slice(start, end + 1);
        if (window[window.length - 1].rankValue !== window[0].rankValue + window.length - 1) break;
        out.push(window);
      }
    }
  }

  return out;
}

// Bài nào còn thừa khi hạ/gửi tối ưu: tối đa hoá số điểm rút khỏi bài rác.
export function bestHand(cards) {
  const list = sortPhom(cards);
  const total = list.reduce((sum, c) => sum + c.rankValue, 0);
  const candidates = findMelds(list).map((meld) => meld.map((c) => c.id));
  const pointsOf = new Map(list.map((c) => [c.id, c.rankValue]));
  const memo = new Map();

  const solve = (usedKey) => {
    if (memo.has(usedKey)) return memo.get(usedKey);
    const used = new Set(usedKey ? usedKey.split(',') : []);
    const next = list.find((c) => !used.has(c.id));
    if (!next) {
      const result = { removed: 0, melds: [], leftovers: [] };
      memo.set(usedKey, result);
      return result;
    }

    const skip = solve([...used, next.id].join(','));
    let best = { removed: skip.removed, melds: skip.melds, leftovers: [next.id, ...skip.leftovers] };

    for (const meld of candidates) {
      if (!meld.includes(next.id) || meld.some((id) => used.has(id))) continue;
      const rest = solve([...used, ...meld].join(','));
      const removed = meld.reduce((sum, id) => sum + pointsOf.get(id), 0) + rest.removed;
      const better =
        removed > best.removed || (removed === best.removed && rest.leftovers.length < best.leftovers.length);
      if (better) {
        best = { removed, melds: [meld, ...rest.melds], leftovers: rest.leftovers };
      }
    }

    memo.set(usedKey, best);
    return best;
  };

  const best = solve('');
  const byId = new Map(list.map((c) => [c.id, c]));
  return {
    melds: best.melds.map((ids) => ids.map((id) => byId.get(id))),
    leftovers: best.leftovers.map((id) => byId.get(id)),
    score: total - best.removed
  };
}

export const scoreHand = (cards) => cards.reduce((sum, c) => sum + c.rankValue, 0);

export const isWinningHand = (cards) =>
  cards.length >= 3 && bestHand(cards).leftovers.length === 0;

// Những cách ăn lá bài vừa đánh: tập con của tay bài + lá đó thành phỏm hợp lệ.
export function eatOptions(hand, incoming) {
  if (!incoming) return [];
  const pool = [...hand, incoming];
  return findMelds(pool)
    .filter((meld) => meld.some((c) => c.id === incoming.id))
    .map((meld) => sortPhom(meld.filter((c) => c.id !== incoming.id)))
    .filter((meld) => meld.length >= 2);
}

export const canEat = (hand, incoming) => eatOptions(hand, incoming).length > 0;

// Gửi lá rác vào phỏm đã hạ của bất kỳ ai.
export function canSendTo(card, meld) {
  const cards = sortPhom(meld);
  if (cards.some((c) => c.id === card.id)) return false;
  if (isSet(cards)) return cards.length < 4 && cards[0].rankValue === card.rankValue;
  if (cards[0].suitSymbol !== card.suitSymbol) return false;
  const low = cards[0].rankValue;
  const high = cards[cards.length - 1].rankValue;
  return card.rankValue === low - 1 || card.rankValue === high + 1;
}
