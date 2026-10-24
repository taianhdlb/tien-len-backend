import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import * as horse from '../src/horse.js';
import { createGameServer } from '../src/app.js';

function lobby(count = 2) {
  const room = horse.createRoom('R');
  for (let index = 0; index < count; index++) {
    horse.join(room, { playerId: `p${index + 1}`, name: `Người ${index + 1}` });
  }
  return room;
}

function playingState(room) {
  const next = structuredClone(room);
  next.status = 'PLAYING';
  next.version = room.version + 1;
  next.players = next.players.map((player, index) => ({
    ...player,
    color: ['RED', 'BLUE', 'GREEN', 'YELLOW'][index],
    horses: Array.from({ length: 4 }, (_, slot) => ({ id: `${player.id}-h${slot + 1}`, status: 'YARD', pos: -1, slot }))
  }));
  return next;
}

function started(count = 2) {
  const room = lobby(count);
  horse.applyState(room, 'p1', playingState(room));
  return room;
}

describe('horse room validation', () => {
  test('joins up to four players and forces the horse class', () => {
    const room = lobby(4);
    assert.equal(room.players.length, 4);
    assert.equal(room.version, 5);
    assert.equal(room.players[0].classId, 'horse');
    assert.throws(() => horse.join(room, { playerId: 'p5', name: 'E' }), /đủ 4/);
  });

  test('only the host may start, and 2–4 players are required', () => {
    const room = lobby(2);
    assert.throws(() => horse.applyState(room, 'p2', playingState(room)), /chủ phòng/);
    const one = lobby(1);
    const next = playingState(one);
    assert.throws(() => horse.applyState(one, 'p1', next), /2 đến 4/);
  });

  test('rejects stale versions and wrong turns', () => {
    const room = started(2);
    assert.throws(() => horse.applyState(room, 'p1', { ...room, version: room.version }), /cũ/);
    assert.throws(() => horse.applyState(room, 'p2', { ...room, version: room.version + 1 }), /lượt/);
    horse.applyState(room, 'p1', { ...room, currentTurn: 1, version: room.version + 1 });
    assert.equal(room.currentTurn, 1);
  });

  test('keeps names and presence authoritative', () => {
    const room = started(2);
    horse.setConnected(room, 'p2', false);
    const forged = structuredClone(room);
    forged.players[1].connected = true;
    forged.players[1].name = 'Hacker';
    forged.version += 1;
    horse.applyState(room, 'p1', forged);
    assert.equal(room.players[1].connected, false);
    assert.equal(room.players[1].name, 'Người 2');
  });

  test('others may act when the current player is disconnected', () => {
    const room = started(2);
    horse.setConnected(room, 'p1', false);
    horse.applyState(room, 'p2', { ...room, currentTurn: 1, version: room.version + 1 });
    assert.equal(room.currentTurn, 1);
  });

  test('leaving mid-game advances a stalled turn or declares the winner', () => {
    const three = started(3);
    horse.leave(three, 'p1');
    assert.equal(three.currentTurn, 1);
    assert.equal(three.players[0].left, true);

    const two = started(2);
    horse.leave(two, 'p2');
    assert.equal(two.status, 'FINISHED');
    assert.equal(two.winnerId, 'p1');
    assert.equal(two.winReason, 'LAST_STANDING');
  });
});

describe('horse socket server', () => {
  let srv;
  let url;
  const clients = [];

  before(async () => {
    srv = createGameServer({ graceMs: { WAITING: 50, PLAYING: 50 } });
    await new Promise((resolve) => srv.server.listen(0, resolve));
    url = `http://localhost:${srv.server.address().port}`;
  });

  after(async () => {
    clients.forEach((client) => client.close());
    srv.io.close();
    await new Promise((resolve) => srv.server.close(resolve));
  });

  const client = async () => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await new Promise((resolve) => socket.on('connect', resolve));
    return socket;
  };
  const call = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const nextState = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

  test('joins, starts and broadcasts the shared state', async () => {
    const a = await client();
    const b = await client();
    assert.deepEqual(await call(a, 'horse:join', { roomId: 'h1', playerId: 'a', name: 'A' }), { ok: true });
    assert.deepEqual(await call(b, 'horse:join', { roomId: 'h1', playerId: 'b', name: 'B' }), { ok: true });

    const room = srv.rooms.get('horse:H1');
    const state = nextState(b, 'horse:state');
    assert.deepEqual(await call(a, 'horse:submit', { state: playingState(room) }), { ok: true });
    const broadcast = await state;
    assert.equal(broadcast.status, 'PLAYING');
    assert.equal(broadcast.players.length, 2);
    assert.equal(broadcast.type, 'HORSE');

    const rejected = await call(b, 'horse:submit', { state: { ...broadcast, version: broadcast.version } });
    assert.equal(rejected.ok, false);
  });
});
