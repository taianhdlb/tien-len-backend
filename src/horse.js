export const MAX_PLAYERS = 4;
const MAX_LOGS = 120;

export class GameError extends Error {}

const fail = (message) => {
  throw new GameError(message);
};

const sanitizeName = (name, fallback) => String(name || '').trim().slice(0, 20) || fallback;
const bump = (room) => {
  room.version = (room.version || 0) + 1;
};

export function createRoom(id) {
  return {
    id,
    type: 'HORSE',
    status: 'WAITING',
    version: 1,
    players: [],
    logs: [],
    logSeq: 0,
    currentTurn: 0,
    dice: null,
    rollSeq: 0,
    pending: null,
    bonusRolls: 0,
    turnNumber: 1,
    winnerId: null,
    winReason: null,
    lastMove: null
  };
}

function log(room, text, tone = 'info') {
  room.logSeq = (room.logSeq || 0) + 1;
  room.logs = [...(room.logs || []), { id: room.logSeq, text, tone }].slice(-MAX_LOGS);
}

export function join(room, { playerId, name }) {
  const existing = room.players.find((player) => player.id === playerId);
  if (existing) {
    existing.connected = true;
    if (room.status !== 'PLAYING') {
      existing.left = false;
      existing.name = sanitizeName(name, existing.name);
      bump(room);
    }
    return existing;
  }

  if (room.status === 'PLAYING') fail('Trận đua đang diễn ra, hãy chờ ván sau!');
  if (room.players.filter((player) => !player.left).length >= MAX_PLAYERS) {
    fail('Phòng đã đủ 4 kỵ sĩ!');
  }

  const player = {
    id: playerId,
    name: sanitizeName(name, `Kỵ sĩ ${room.players.length + 1}`),
    classId: 'horse',
    connected: true,
    left: false
  };
  room.players.push(player);
  log(room, `${player.name} đã vào chuồng ngựa.`, 'muted');
  bump(room);
  return player;
}

const activePlayers = (room) => room.players.filter((player) => !player.left);

// Clients drive the shared engine; the server only authorizes the submitter and keeps identity/presence authoritative.
export function applyState(room, senderId, next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.players)) fail('Dữ liệu không hợp lệ.');
  if (next.version !== room.version + 1) fail('Trạng thái đã cũ, đang đồng bộ lại...');
  if (next.status === 'PLAYING' && (next.players.length < 2 || next.players.length > MAX_PLAYERS)) {
    fail('Số người chơi phải từ 2 đến 4.');
  }

  const sender = room.players.find((player) => player.id === senderId);
  if (!sender || sender.left) fail('Bạn không ở trong phòng này.');

  if (room.status === 'PLAYING') {
    const current = room.players[room.currentTurn];
    const canSkip = current && (current.left || current.connected === false);
    if (current?.id !== senderId && !canSkip) fail('Chưa tới lượt của bạn!');
  } else {
    const host = room.players.find((player) => !player.left);
    if (host?.id !== senderId) fail('Chỉ chủ phòng mới có thể bắt đầu!');
    if (next.status !== 'PLAYING') fail('Dữ liệu không hợp lệ.');
  }

  const known = new Map(room.players.map((player) => [player.id, player]));
  if (next.players.some((player) => !known.has(player?.id))) fail('Dữ liệu người chơi không hợp lệ.');

  const merged = {
    ...next,
    id: room.id,
    type: 'HORSE',
    players: next.players.map((player) => {
      const auth = known.get(player.id);
      return { ...player, name: auth.name, classId: auth.classId, connected: auth.connected, left: auth.left };
    })
  };
  Object.keys(room).forEach((key) => delete room[key]);
  Object.assign(room, merged);
}

// Presence updates do not bump the version so an in-flight roll is not rejected.
export function setConnected(room, playerId, connected) {
  const player = room.players.find((entry) => entry.id === playerId);
  if (player) player.connected = connected;
}

function nextActiveIndex(room) {
  for (let offset = 1; offset <= room.players.length; offset++) {
    const index = (room.currentTurn + offset) % room.players.length;
    if (!room.players[index].left) return index;
  }
  return room.currentTurn;
}

export function leave(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index < 0) return;
  const player = room.players[index];

  if (room.status !== 'PLAYING') {
    room.players.splice(index, 1);
    log(room, `${player.name} đã rời phòng.`, 'muted');
    bump(room);
    return;
  }

  player.left = true;
  player.connected = false;
  log(room, `${player.name} đã rời đường đua.`, 'danger');

  const alive = activePlayers(room);
  if (alive.length <= 1) {
    room.status = 'FINISHED';
    room.pending = null;
    room.winnerId = alive[0]?.id ?? null;
    room.winReason = 'LAST_STANDING';
    if (alive[0]) log(room, `${alive[0].name} là kỵ sĩ trụ lại cuối cùng và giành chiến thắng!`, 'victory');
    bump(room);
    return;
  }

  if (room.currentTurn === index) {
    room.currentTurn = nextActiveIndex(room);
    room.pending = null;
    room.dice = null;
    room.bonusRolls = 0;
    const next = room.players[room.currentTurn];
    if (next) log(room, `Lượt của ${next.name}.`, 'muted');
  }
  bump(room);
}
