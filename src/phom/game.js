import { shuffle } from '../tienlen/cards.js';
import {
  createPhomDeck,
  sortPhom,
  isValidPhom,
  phomType,
  findMelds,
  bestHand,
  eatOptions,
  canSendTo,
  scoreHand,
  cardName
} from './cards.js';

export const MAX_PLAYERS = 4;
export const MAX_ROUNDS = 4;
export const BASE_HAND = 9;
export const BET = { WIN: 4, CHOT: 4, RANK_STEP: 1 };

const MAX_LOGS = 80;

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

const findIndex = (room, playerId) => room.players.findIndex((p) => p.id === playerId);
const inGame = (p) => !p.left;

function log(room, text, tone = 'info') {
  room.logSeq += 1;
  room.logs = [...room.logs, { id: room.logSeq, text, tone }].slice(-MAX_LOGS);
}

export function createRoom(id) {
  return {
    id,
    type: 'PHOM',
    status: 'WAITING',
    players: [],
    stock: [],
    turn: 0,
    round: 1,
    phase: 'IDLE',
    claim: null,
    turnCount: 0,
    meldSeq: 0,
    winnerId: null,
    lastWinnerId: null,
    fouls: [],
    results: null,
    logs: [],
    logSeq: 0
  };
}

export function join(room, { playerId, name }) {
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    existing.left = false;
    if (name && room.status !== 'PLAYING') existing.name = name;
    return existing;
  }
  if (room.status === 'PLAYING') fail('Ván Phỏm đang diễn ra, hãy chờ ván sau!');
  if (room.players.length >= MAX_PLAYERS) fail('Chiếu đã đủ 4 người!');
  const player = {
    id: playerId,
    name: name || `Người chơi ${room.players.length + 1}`,
    connected: true,
    left: false,
    hand: [],
    melds: [],
    discards: [],
    sends: [],
    ateFrom: {},
    firstMeld: null,
    chotFrom: null
  };
  room.players.push(player);
  log(room, `${player.name} đã vào chiếu.`, 'muted');
  return player;
}

export function start(room, playerId, rng = Math.random) {
  if (room.status === 'PLAYING') fail('Chiếu đang có ván, chờ hạ màn nhé!');
  room.players = room.players.filter(inGame);
  if (room.players[0]?.id !== playerId) fail('Chỉ chủ chiếu mới được chia bài!');
  if (room.players.length < 2) fail('Cần ít nhất 2 người để đánh Phỏm!');

  const deck = shuffle(createPhomDeck(), rng);
  const prevWinner = findIndex(room, room.lastWinnerId);
  const starter = prevWinner >= 0 ? prevWinner : 0;

  room.players.forEach((p, i) => {
    const size = BASE_HAND + (i === starter ? 1 : 0);
    p.hand = sortPhom(deck.splice(0, size));
    p.melds = [];
    p.discards = [];
    p.sends = [];
    p.ateFrom = {};
    p.firstMeld = null;
    p.chotFrom = null;
  });

  room.stock = deck;
  room.status = 'PLAYING';
  room.turn = starter;
  room.round = 1;
  room.turnCount = 0;
  room.meldSeq = 0;
  room.phase = 'ACTION';
  room.claim = null;
  room.winnerId = null;
  room.fouls = [];
  room.results = null;

  log(room, `Chia bài! ${room.players[starter].name} được đánh trước (10 lá).`, 'success');
}

function assertTurn(room, playerId) {
  if (room.status !== 'PLAYING') fail('Ván chưa bắt đầu.');
  const idx = findIndex(room, playerId);
  if (idx < 0) fail('Bạn không ngồi ở chiếu này.');
  if (room.turn !== idx) fail('Chưa tới lượt của bạn!');
  return idx;
}

const takeFromHand = (player, ids) => {
  const set = new Set(ids);
  const picked = [];
  const rest = [];
  for (const card of player.hand) (set.has(card.id) ? picked : rest).push(card);
  if (picked.length !== set.size) fail('Bài trên tay không có đủ lá bạn chọn.');
  player.hand = rest;
  return sortPhom(picked);
};

function addFoul(room, { payerId, playerId, amount, reason }) {
  room.fouls.push({ payerId, playerId, amount, reason });
}

function openClaim(room, player) {
  if (room.phase !== 'CLAIM') return;
  if (room.stock.length === 0 && !eatOptions(player.hand, room.claim?.card).length) room.phase = 'ACTION';
}

// Người kế tiếp được ăn lá vừa đánh hoặc bốc nọc, rồi hạ/gửi/đánh.
function draw(room, playerId) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'CLAIM') fail('Bạn không còn ở bước ăn/bốc.');
  const card = room.stock.pop();
  if (card) {
    player.hand = sortPhom([...player.hand, card]);
    log(room, `${player.name} bốc 1 lá từ nọc.`, 'muted');
  } else {
    log(room, `Nọc đã cạn — ${player.name} không bốc được.`, 'muted');
  }
  room.claim = null;
  room.phase = 'ACTION';
}

function eat(room, playerId, cardIds) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'CLAIM' || !room.claim) fail('Không có lá bài nào để ăn.');
  if (!Array.isArray(cardIds) || cardIds.length < 2) fail('Chọn tối thiểu 2 lá trên tay để ghép phỏm.');

  const incoming = room.claim.card;
  const wanted = new Set(cardIds);
  const option = eatOptions(player.hand, incoming).find((meld) => meld.length === wanted.size && meld.every((c) => wanted.has(c.id)));
  if (!option) fail('Không thể ăn lá này — không tạo thành phỏm hợp lệ.');

  const giver = room.players[findIndex(room, room.claim.playerId)];
  const cards = takeFromHand(player, cardIds);
  room.meldSeq += 1;
  player.melds.push({ id: room.meldSeq, cards: sortPhom([...cards, incoming]), eaten: true, from: giver.id });
  giver.discards.pop();

  const chain = (player.ateFrom[giver.id] = (player.ateFrom[giver.id] || 0) + 1);
  addFoul(room, { payerId: giver.id, playerId: player.id, amount: chain, reason: 'EAT' });
  if (room.claim.chot) {
    addFoul(room, { payerId: giver.id, playerId: player.id, amount: BET.CHOT, reason: 'CHOT' });
    player.chotFrom = giver.id;
  }

  log(
    room,
    `${player.name} ĂN ${cardName(incoming)} của ${giver.name} → ${phomType([...cards, incoming]) === 'SET' ? 'Sám' : 'Sảnh'} ${[...cards, incoming]
      .map(cardName)
      .join(' ')}${room.claim.chot ? ' (QUÂN CHỐT!)' : ''}`,
    room.claim.chot ? 'danger' : 'gold'
  );
  room.claim = null;
  room.phase = 'ACTION';
}

function meld(room, playerId, cardIds) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'ACTION') fail('Bạn phải ăn hoặc bốc đã.');
  if (!Array.isArray(cardIds) || cardIds.length < 3) fail('Phỏm cần tối thiểu 3 lá.');

  const cards = takeFromHand(player, cardIds);
  if (!isValidPhom(cards)) fail('Bộ bài không phải phỏm hợp lệ.');

  room.meldSeq += 1;
  player.melds.push({ id: room.meldSeq, cards, eaten: false, from: null });
  if (player.firstMeld === null) player.firstMeld = room.meldSeq;
  log(room, `${player.name} hạ ${phomType(cards) === 'SET' ? 'Sám' : 'Sảnh'}: ${cards.map(cardName).join(' ')}`, 'info');
}

function send(room, playerId, cardId, meldId) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'ACTION') fail('Bạn phải ăn hoặc bốc đã.');
  if (player.melds.length === 0) fail('Phải hạ được ít nhất 1 phỏm mới được gửi bài.');

  const target = room.players.find((p) => p.melds.some((m) => m.id === meldId));
  const phom = target?.melds.find((m) => m.id === meldId);
  if (!phom) fail('Phỏm đích không còn trên bàn.');
  if (!player.hand.some((c) => c.id === cardId)) fail('Bạn không giữ lá bài này.');
  const card = player.hand.find((c) => c.id === cardId);
  if (!canSendTo(card, phom.cards)) fail(`${cardName(card)} không gửi được vào phỏm đó.`);

  player.hand = player.hand.filter((c) => c.id !== cardId);
  phom.cards = sortPhom([...phom.cards, card]);
  player.sends.push({ cardId, meldId, ownerId: target.id });
  log(room, `${player.name} gửi ${cardName(card)} vào phỏm của ${target.name}.`, 'gold');
}

function declareWin(room, playerId) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'ACTION') fail('Bạn phải ăn hoặc bốc trước đã.');
  if (player.melds.length === 0 && player.hand.length < 3) fail('Chưa có phỏm nào để ù.');
  if (player.hand.length > 0 && bestHand(player.hand).leftovers.length > 0) fail('Bài chưa sạch rác — chưa thể ù.');

  while (player.hand.length) {
    const { melds } = bestHand(player.hand);
    if (!melds.length) break;
    room.meldSeq += 1;
    if (player.firstMeld === null) player.firstMeld = room.meldSeq;
    player.melds.push({ id: room.meldSeq, cards: melds[0], eaten: false, from: null });
    player.hand = player.hand.filter((c) => !melds[0].some((m) => m.id === c.id));
  }

  room.status = 'FINISHED';
  room.winnerId = player.id;
  room.lastWinnerId = player.id;
  log(room, `${player.name} Ù! Sạch bài tuyệt đối.`, 'victory');
  settle(room, { win: player });
}

function discard(room, playerId, cardId) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (room.phase !== 'ACTION') fail('Bạn phải ăn hoặc bốc đã.');
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) fail('Bạn không giữ lá bài này.');

  const n = room.players.filter(inGame).length;
  if (room.round === MAX_ROUNDS && findMelds(player.hand).length > 0) {
    fail('Vòng cuối: phải hạ hết phỏm trước khi đánh chốt.');
  }

  const isChot = room.turnCount + 1 === (MAX_ROUNDS - 1) * n;
  player.hand = player.hand.filter((c) => c.id !== cardId);
  player.discards.push({ card, round: room.round, chot: isChot });
  room.turnCount += 1;
  log(room, `${player.name} đánh ${cardName(card)}${isChot ? ' — QUÂN CHỐT' : ''}.`, isChot ? 'danger' : 'info');

  if (room.turnCount >= MAX_ROUNDS * n) {
    finishByPoints(room);
    return;
  }

  room.round = Math.floor(room.turnCount / n) + 1;
  room.turn = (room.turn + 1) % room.players.length;
  if (!inGame(room.players[room.turn])) {
    for (let i = 1; i < room.players.length; i++) {
      const next = (room.turn + i) % room.players.length;
      if (inGame(room.players[next])) {
        room.turn = next;
        break;
      }
    }
  }
  room.claim = { playerId: player.id, card, chot: isChot };
  room.phase = 'CLAIM';
  openClaim(room, room.players[room.turn]);
}

function settle(room, { win = null } = {}) {
  const players = room.players;
  const scored = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    score: p.id === win?.id ? 0 : scoreHand(p.hand),
    isMom: p.melds.length === 0,
    left: p.left,
    firstMeld: p.firstMeld ?? Number.MAX_SAFE_INTEGER,
    melds: p.melds.length,
    sent: p.sends.length
  }));

  // Móm về bét; bằng điểm thì người hạ trước xếp trên.
  scored.sort(
    (a, b) =>
      Number(a.left) - Number(b.left) ||
      Number(a.isMom) - Number(b.isMom) ||
      a.score - b.score ||
      a.firstMeld - b.firstMeld
  );
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const net = Object.fromEntries(players.map((p) => [p.id, 0]));
  const transfer = (payerId, receiverId, amount, reason) => {
    if (!amount || payerId === receiverId) return;
    net[payerId] -= amount;
    net[receiverId] += amount;
    room.fouls.push({ payerId, playerId: receiverId, amount, reason });
  };

  const denPlayerId = win
    ? (win.chotFrom ?? players.find((p) => (win.ateFrom[p.id] || 0) >= 3)?.id ?? null)
    : null;

  if (win) {
    const others = players.filter((p) => p.id !== win.id);
    if (denPlayerId) {
      // Người đền trả thay toàn bộ bàn cho người ù.
      transfer(denPlayerId, win.id, others.length * BET.WIN, 'DEN_WIN');
      const den = players.find((p) => p.id === denPlayerId);
      log(room, `${den?.name} đền Ù cho cả bàn (ăn ${others.length} lá × ${BET.WIN} cược)!`, 'danger');
    } else {
      for (const p of others) transfer(p.id, win.id, BET.WIN, 'WIN');
    }
  } else {
    const [first, ...rest] = scored;
    for (const row of rest) transfer(row.playerId, first.playerId, (row.rank - 1) * BET.RANK_STEP, 'RANK');
  }

  room.results = {
    type: win ? 'WIN' : 'POINTS',
    winnerId: win?.id ?? (scored[0]?.playerId ?? null),
    denPlayerId,
    rows: scored.map((row) => ({ ...row, net: net[row.playerId] }))
  };
  room.status = 'FINISHED';
}

function finishByPoints(room) {
  log(room, 'Hết 4 vòng — mở bài tính điểm.', 'gold');
  settle(room, {});
  room.lastWinnerId = room.results.winnerId;
}

export function act(room, playerId, action) {
  switch (action?.op) {
    case 'DRAW':
      return draw(room, playerId);
    case 'EAT':
      return eat(room, playerId, action.cards);
    case 'MELD':
      return meld(room, playerId, action.cards);
    case 'SEND':
      return send(room, playerId, action.card, action.meldId);
    case 'DISCARD':
      return discard(room, playerId, action.card);
    case 'WIN':
      return declareWin(room, playerId);
    default:
      fail('Thao tác không hợp lệ.');
  }
}

export function leave(room, playerId) {
  const idx = findIndex(room, playerId);
  if (idx < 0) return;
  const player = room.players[idx];

  if (room.status !== 'PLAYING') {
    room.players.splice(idx, 1);
    log(room, `${player.name} đã rời chiếu.`, 'muted');
    return;
  }

  player.left = true;
  player.connected = false;
  player.hand = [];
  log(room, `${player.name} bỏ chiếu giữa ván.`, 'danger');

  const remaining = room.players.filter(inGame);
  if (remaining.length < 2) {
    room.status = 'FINISHED';
    room.winnerId = remaining[0]?.id ?? null;
    room.lastWinnerId = room.winnerId;
    return;
  }
  finishByPoints(room);
}

export function setConnected(room, playerId, connected) {
  const p = room.players.find((x) => x.id === playerId);
  if (p) p.connected = connected;
}

function legalMoves(room, player) {
  if (room.status !== 'PLAYING' || !inGame(player)) return null;
  const legal = {
    phase: room.phase,
    round: room.round,
    canDraw: false,
    eatOptions: [],
    canMeld: [],
    canSend: [],
    canWin: false,
    discards: [],
    mustMeld: false,
    suggestion: []
  };
  if (room.phase === 'CLAIM') {
    legal.canDraw = true;
    if (room.claim) {
      legal.eatOptions = eatOptions(player.hand, room.claim.card).map((group) => ({
        cards: group.map((c) => c.id),
        phom: [...group, room.claim.card].map(cardName)
      }));
    }
    return legal;
  }
  if (room.phase !== 'ACTION') return legal;

  const best = bestHand(player.hand);
  legal.suggestion = best.melds.map((group) => group.map((c) => c.id));
  legal.canMeld = findMelds(player.hand).map((group) => group.map((c) => c.id));
  legal.canWin = (player.hand.length === 0 || best.leftovers.length === 0) && (player.melds.length > 0 || player.hand.length >= 3);

  if (player.melds.length > 0) {
    for (const card of player.hand) {
      for (const owner of room.players.filter(inGame)) {
        for (const phom of owner.melds) {
          if (canSendTo(card, phom.cards)) legal.canSend.push({ cardId: card.id, meldId: phom.id, ownerId: owner.id });
        }
      }
    }
  }

  const locked = room.round === MAX_ROUNDS && legal.canMeld.length > 0;
  legal.mustMeld = locked;
  if (!locked) legal.discards = player.hand.map((c) => c.id);
  return legal;
}

// Ẩn bài trên tay của người khác, chỉ lộ bài của chính người xem.
export function viewFor(room, playerId) {
  const { stock, logSeq: _logSeq, ...rest } = room;
  const meIndex = findIndex(room, playerId);
  const me = meIndex >= 0 ? room.players[meIndex] : null;
  return {
    ...rest,
    stockCount: stock.length,
    myTurn: room.status === 'PLAYING' && room.turn === meIndex,
    legal: me && room.turn === meIndex ? legalMoves(room, me) : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      left: p.left,
      cardCount: p.hand.length,
      melds: p.melds,
      discards: p.discards,
      sends: p.sends,
      ateFrom: p.ateFrom,
      hand: p.id === playerId ? p.hand : undefined
    }))
  };
}
