import { createDeck, shuffle, sortCards, detectCombo, canBeat, COMBO_LABELS } from './cards.js';

export const MAX_PLAYERS = 4;
export const HAND_SIZE = 13;
const MAX_LOGS = 60;

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

export function createRoom(id) {
  return {
    id,
    type: 'TIEN_LEN',
    status: 'WAITING',
    mode: 'TLMN',
    players: [],
    currentTurn: 0,
    lastPlayed: null,
    passed: {},
    winnerId: null,
    lastWinnerId: null,
    logs: [],
    logSeq: 0
  };
}

function log(room, text, tone = 'info') {
  room.logSeq += 1;
  room.logs = [...room.logs, { id: room.logSeq, text, tone }].slice(-MAX_LOGS);
}

const findIndex = (room, playerId) => room.players.findIndex((p) => p.id === playerId);
const inGame = (p) => !p.left;

export function join(room, { playerId, name }) {
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    existing.left = false;
    if (name && room.status !== 'PLAYING') existing.name = name;
    return existing;
  }
  if (room.status === 'PLAYING') fail('Ván đấu đang diễn ra, hãy chờ ván sau!');
  if (room.players.length >= MAX_PLAYERS) fail('Phòng đã đủ 4 người!');
  const player = { id: playerId, name: name || `Người chơi ${room.players.length + 1}`, hand: [], connected: true, left: false };
  room.players.push(player);
  log(room, `${player.name} đã vào phòng.`, 'muted');
  return player;
}

export function start(room, playerId, mode, rng = Math.random) {
  if (room.status === 'PLAYING') fail('Ván đấu đang diễn ra.');
  room.players = room.players.filter(inGame);
  if (room.players[0]?.id !== playerId) fail('Chỉ chủ phòng mới có thể chia bài!');
  if (room.players.length < 2) fail('Cần ít nhất 2 người để bắt đầu!');

  const deck = shuffle(createDeck(), rng);
  room.players.forEach((p, i) => {
    p.hand = sortCards(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE));
  });

  room.mode = mode === 'TLMB' ? 'TLMB' : 'TLMN';
  room.status = 'PLAYING';
  room.lastPlayed = null;
  room.passed = {};
  room.winnerId = null;

  const prevWinner = findIndex(room, room.lastWinnerId);
  if (prevWinner >= 0) {
    room.currentTurn = prevWinner;
  } else {
    let best = 0;
    room.players.forEach((p, i) => {
      if (p.hand[0].totalValue < room.players[best].hand[0].totalValue) best = i;
    });
    room.currentTurn = best;
  }

  const modeName = room.mode === 'TLMB' ? 'Miền Bắc' : 'Miền Nam';
  log(room, `Ván mới (${modeName}) bắt đầu! ${room.players[room.currentTurn].name} đánh trước.`, 'success');
}

function newRound(room) {
  room.lastPlayed = null;
  room.passed = {};
}

// Moves the turn to the next player still in the round; if it returns to the last player who played, they win the round.
function advance(room, fromIdx) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n;
    const p = room.players[idx];
    if (!inGame(p) || room.passed[p.id]) continue;
    if (room.lastPlayed?.playerId === p.id) {
      newRound(room);
      log(room, `Mọi người bỏ lượt — ${p.name} giành vòng và được đánh tự do.`, 'muted');
    }
    room.currentTurn = idx;
    return;
  }
  newRound(room);
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n;
    if (inGame(room.players[idx])) {
      room.currentTurn = idx;
      return;
    }
  }
}

function assertTurn(room, playerId) {
  if (room.status !== 'PLAYING') fail('Ván đấu chưa bắt đầu.');
  const idx = findIndex(room, playerId);
  if (idx < 0) fail('Bạn không ở trong phòng này.');
  if (room.currentTurn !== idx) fail('Chưa tới lượt của bạn!');
  return idx;
}

export function play(room, playerId, cardIds) {
  const idx = assertTurn(room, playerId);
  const player = room.players[idx];
  if (!Array.isArray(cardIds) || cardIds.length === 0) fail('Bạn chưa chọn lá bài nào.');
  if (new Set(cardIds).size !== cardIds.length) fail('Lá bài bị trùng.');

  const cards = cardIds.map((id) => player.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) fail('Bạn không có những lá bài này.');
  if (!canBeat(cards, room.lastPlayed, room.mode)) {
    fail(room.lastPlayed ? 'Bộ bài không chặn được bài trên bàn!' : 'Bộ bài không hợp lệ!');
  }

  const combo = detectCombo(cards, room.mode);
  const chopped = room.lastPlayed && room.lastPlayed.combo.type !== combo.type;
  player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  room.lastPlayed = { playerId, playerName: player.name, cards: sortCards(cards), combo };
  log(
    room,
    `${player.name} ${chopped ? 'CHẶT bằng' : 'đánh'} ${COMBO_LABELS[combo.type]}: ${room.lastPlayed.cards.map((c) => c.rankLabel + c.suitSymbol).join(' ')}`,
    chopped ? 'danger' : 'info'
  );

  if (player.hand.length === 0) {
    finish(room, player);
    return;
  }
  advance(room, idx);
}

export function pass(room, playerId) {
  const idx = assertTurn(room, playerId);
  if (!room.lastPlayed) fail('Bạn đang được đánh tự do, không thể bỏ lượt.');
  room.passed[playerId] = true;
  log(room, `${room.players[idx].name} bỏ lượt.`, 'muted');
  advance(room, idx);
}

function finish(room, winner) {
  room.status = 'FINISHED';
  room.winnerId = winner.id;
  room.lastWinnerId = winner.id;
  log(room, `${winner.name} đã hết bài và chiến thắng!`, 'victory');
}

// Permanently removes a player: dropped from the lobby, or marked left mid-game.
export function leave(room, playerId) {
  const idx = findIndex(room, playerId);
  if (idx < 0) return;
  const player = room.players[idx];

  if (room.status !== 'PLAYING') {
    room.players.splice(idx, 1);
    log(room, `${player.name} đã rời phòng.`, 'muted');
    return;
  }

  player.left = true;
  player.connected = false;
  player.hand = [];
  log(room, `${player.name} đã rời ván đấu.`, 'danger');

  const remaining = room.players.filter(inGame);
  if (remaining.length === 1) {
    finish(room, remaining[0]);
  } else if (remaining.length === 0) {
    room.status = 'FINISHED';
  } else if (room.currentTurn === idx) {
    advance(room, idx);
  }
}

export function setConnected(room, playerId, connected) {
  const p = room.players.find((x) => x.id === playerId);
  if (p) p.connected = connected;
}

// Per-player snapshot that hides opponents' hands.
export function viewFor(room, playerId) {
  const { logSeq: _logSeq, lastWinnerId: _lastWinnerId, ...rest } = room;
  return {
    ...rest,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      left: p.left,
      cardCount: p.hand.length,
      hand: p.id === playerId ? p.hand : undefined
    }))
  };
}
