import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import * as mp from '../src/monopoly.js';
import { createGameServer } from '../src/app.js';

describe('monopoly state validation', () => {
  const lobby = () => {
    const room = mp.createRoom('R');
    mp.join(room, { playerId: 'a', name: 'A', classId: 'wizard' });
    mp.join(room, { playerId: 'b', name: 'B', classId: 'nope' });
    return room;
  };
  const started = () => {
    const room = lobby();
    mp.applyState(room, 'a', { ...room, status: 'PLAYING', currentTurn: 0, version: room.version + 1 });
    return room;
  };

  test('join sanitises class and bumps version', () => {
    const room = lobby();
    assert.equal(room.version, 3);
    assert.equal(room.players[1].classId, 'fighter');
  });

  test('only the host may start', () => {
    const room = lobby();
    assert.throws(() => mp.applyState(room, 'b', { ...room, status: 'PLAYING', version: room.version + 1 }), /chủ phòng/);
  });

  test('rejects stale versions and wrong turns', () => {
    const room = started();
    assert.throws(() => mp.applyState(room, 'a', { ...room, version: room.version }), /cũ/);
    assert.throws(() => mp.applyState(room, 'b', { ...room, version: room.version + 1 }), /lượt/);
    mp.applyState(room, 'a', { ...room, currentTurn: 1, version: room.version + 1 });
    assert.equal(room.currentTurn, 1);
  });

  test('keeps names and presence authoritative', () => {
    const room = started();
    mp.setConnected(room, 'b', false);
    const forged = structuredClone(room);
    forged.players[1].connected = true;
    forged.players[1].name = 'Hacker';
    forged.version += 1;
    mp.applyState(room, 'a', forged);
    assert.equal(room.players[1].connected, false);
    assert.equal(room.players[1].name, 'B');
  });

  test('rejects unknown players', () => {
    const room = started();
    const forged = structuredClone(room);
    forged.players.push({ id: 'z' });
    forged.version += 1;
    assert.throws(() => mp.applyState(room, 'a', forged), /không hợp lệ/);
  });

  test('others may act for a disconnected current player', () => {
    const room = started();
    mp.setConnected(room, 'a', false);
    mp.applyState(room, 'b', { ...room, currentTurn: 1, version: room.version + 1 });
    assert.equal(room.currentTurn, 1);
  });

  test('leaving mid-game declares the last standing winner', () => {
    const room = started();
    mp.leave(room, 'b');
    assert.equal(room.status, 'FINISHED');
    assert.equal(room.winnerId, 'a');
  });

  test('cannot join a running game', () => {
    const room = started();
    assert.throws(() => mp.join(room, { playerId: 'c', name: 'C' }), /đang diễn ra/);
  });
});

describe('socket server', () => {
  let srv;
  let url;
  const clients = [];

  before(async () => {
    srv = createGameServer({ graceMs: { WAITING: 50, PLAYING: 50 } });
    await new Promise((r) => srv.server.listen(0, r));
    url = `http://localhost:${srv.server.address().port}`;
  });

  after(async () => {
    clients.forEach((c) => c.close());
    srv.io.close();
    await new Promise((r) => srv.server.close(r));
  });

  const client = async () => {
    const c = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(c);
    await new Promise((r) => c.on('connect', r));
    return c;
  };
  const call = (c, event, payload) => new Promise((r) => c.emit(event, payload, r));
  const nextState = (c, event) => new Promise((r) => c.once(event, r));

  test('tien len deals private hands to each player', async () => {
    const a = await client();
    const b = await client();
    assert.deepEqual(await call(a, 'tienlen:join', { roomId: 'room1', playerId: 'a', name: 'A' }), { ok: true });
    assert.deepEqual(await call(b, 'tienlen:join', { roomId: 'ROOM1', playerId: 'b', name: 'B' }), { ok: true });

    const sa = nextState(a, 'tienlen:state');
    const sb = nextState(b, 'tienlen:state');
    assert.deepEqual(await call(a, 'tienlen:start', { mode: 'TLMN' }), { ok: true });
    const [va, vb] = await Promise.all([sa, sb]);
    assert.equal(va.players[0].hand.length, 13);
    assert.equal(va.players[1].hand, undefined);
    assert.equal(vb.players[1].hand.length, 13);
    assert.equal(vb.players[0].hand, undefined);

    const res = await call(b, 'tienlen:start', { mode: 'TLMN' });
    assert.equal(res.ok, false);
  });

  test('monopoly reconnect keeps the seat and grace timeout drops it', async () => {
    const a = await client();
    let b = await client();
    await call(a, 'monopoly:join', { roomId: 'm1', playerId: 'a', name: 'A' });
    await call(b, 'monopoly:join', { roomId: 'm1', playerId: 'b', name: 'B' });
    const room = srv.rooms.get('monopoly:M1');
    assert.equal(room.players.length, 2);

    b.close();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(room.players[1].connected, false);
    b = await client();
    await call(b, 'monopoly:join', { roomId: 'm1', playerId: 'b', name: 'B' });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.players.length, 2);
    assert.equal(room.players[1].connected, true);

    b.close();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(room.players.length, 1);
  });
});
