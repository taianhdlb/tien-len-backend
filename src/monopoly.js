export const MAX_PLAYERS = 4;
const MAX_LOGS = 100;
const CLASS_IDS = new Set([
  'fighter', 'rogue', 'wizard', 'cleric', 'paladin', 'barbarian', 'ranger', 'druid', 'warlock', 'sorcerer',
  'knight', 'rook', 'bishop', 'queen', 'king', 'tophat', 'car', 'battleship', 'thimble', 'pawn'
]);

export class GameError extends Error {}
const fail = (msg) => {
  throw new GameError(msg);
};

export function createRoom(id) {
  return { id, type: 'MONOPOLY', status: 'WAITING', version: 1, players: [], logs: [], logSeq: 0 };
}

function log(room, text, tone = 'info') {
  room.logSeq = (room.logSeq || 0) + 1;
  room.logs = [...(room.logs || []), { id: room.logSeq, text, tone }].slice(-MAX_LOGS);
}

const bump = (room) => {
  room.version = (room.version || 0) + 1;
};

const sanitizeName = (name, fallback) => String(name || '').trim().slice(0, 20) || fallback;

export function join(room, { playerId, name, classId }) {
  const cls = CLASS_IDS.has(classId) ? classId : 'fighter';
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    if (room.status !== 'PLAYING') {
      existing.left = false;
      existing.name = sanitizeName(name, existing.name);
      existing.classId = cls;
      bump(room);
    }
    return existing;
  }
  if (room.status === 'PLAYING') fail('Trận đấu đang diễn ra, hãy chờ trận sau!');
  if (room.players.filter((p) => !p.left).length >= MAX_PLAYERS) fail('Phòng đã đủ 4 chiến binh!');

  const player = {
    id: playerId,
    name: sanitizeName(name, `Chiến binh ${room.players.length + 1}`),
    classId: cls,
    connected: true,
    left: false
  };
  room.players.push(player);
  log(room, `${player.name} đã gia nhập đoàn thám hiểm.`, 'muted');
  bump(room);
  return player;
}

function activePlayers(room) {
  return room.players.filter((p) => !p.left && !p.bankrupt);
}

// Clients compute the next state with the shared engine; the server only checks who may submit it and keeps identity/presence fields authoritative.
export function applyState(room, senderId, next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.players)) fail('Dữ liệu không hợp lệ.');
  if (next.version !== room.version + 1) fail('Trạng thái đã cũ, đang đồng bộ lại...');

  const sender = room.players.find((p) => p.id === senderId);
  if (!sender || sender.left) fail('Bạn không ở trong phòng này.');

  if (room.status === 'PLAYING') {
    const current = room.players[room.currentTurn];
    const canSkip = current && (current.left || current.connected === false);
    if (current?.id !== senderId && !canSkip) fail('Chưa tới lượt của bạn!');
  } else {
    const host = room.players.find((p) => !p.left);
    if (host?.id !== senderId) fail('Chỉ chủ phòng mới có thể bắt đầu!');
    if (next.status !== 'PLAYING') fail('Dữ liệu không hợp lệ.');
  }

  const known = new Map(room.players.map((p) => [p.id, p]));
  if (next.players.some((p) => !known.has(p?.id))) fail('Dữ liệu người chơi không hợp lệ.');

  const merged = {
    ...next,
    id: room.id,
    type: 'MONOPOLY',
    players: next.players.map((p) => {
      const auth = known.get(p.id);
      return { ...p, name: auth.name, classId: auth.classId, connected: auth.connected, left: auth.left };
    })
  };
  Object.keys(room).forEach((k) => delete room[k]);
  Object.assign(room, merged);
}

// Presence changes do not bump the version so an in-flight move from the current player is not rejected.
export function setConnected(room, playerId, connected) {
  const p = room.players.find((x) => x.id === playerId);
  if (p) p.connected = connected;
}

export function leave(room, playerId) {
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return;
  const player = room.players[idx];

  if (room.status !== 'PLAYING') {
    room.players.splice(idx, 1);
    log(room, `${player.name} đã rời phòng.`, 'muted');
    bump(room);
    return;
  }

  player.left = true;
  player.connected = false;
  log(room, `${player.name} đã rời khỏi cuộc chinh phạt.`, 'danger');

  const alive = activePlayers(room);
  if (alive.length <= 1) {
    room.status = 'FINISHED';
    room.pending = null;
    room.winnerId = alive[0]?.id ?? null;
    room.winReason = 'LAST_STANDING';
    if (alive[0]) log(room, `${alive[0].name} là người trụ lại cuối cùng và giành chiến thắng!`, 'victory');
  }
  bump(room);
}
