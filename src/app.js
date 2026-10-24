import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import * as tienlen from './tienlen/game.js';
import * as monopoly from './monopoly.js';
import * as horse from './horse.js';

const GAMES = {
  tienlen: { module: tienlen, event: 'tienlen:state' },
  monopoly: { module: monopoly, event: 'monopoly:state' },
  horse: { module: horse, event: 'horse:state' }
};

const isGameError = (err) => Object.values(GAMES).some(({ module }) => err instanceof module.GameError);

const sanitizeRoomId = (raw) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 20);

const sanitizeId = (raw) => String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

export function createGameServer({ corsOrigin = '*', graceMs = { WAITING: 10_000, PLAYING: 60_000 } } = {}) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });

  const rooms = new Map();
  const owners = new Map();
  const timers = new Map();

  app.get('/', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

  const roomKey = (game, roomId) => `${game}:${roomId}`;
  const seatKey = (key, playerId) => `${key}|${playerId}`;

  function broadcast(key) {
    const room = rooms.get(key);
    if (!room) return;
    const game = key.split(':')[0];
    if (!GAMES[game]) return;
    if (!GAMES[game].module.viewFor) {
      io.to(key).emit(GAMES[game].event, room);
      return;
    }
    for (const socket of io.sockets.adapter.rooms.get(key) ?? []) {
      const s = io.sockets.sockets.get(socket);
      if (s) s.emit(GAMES[game].event, GAMES[game].module.viewFor(room, s.data.session?.playerId));
    }
  }

  function cleanupIfEmpty(key) {
    const room = rooms.get(key);
    if (room && !room.players.some((p) => p.connected && !p.left)) {
      rooms.delete(key);
      for (const seat of owners.keys()) {
        if (seat.startsWith(`${key}|`)) {
          owners.delete(seat);
          clearTimeout(timers.get(seat));
          timers.delete(seat);
        }
      }
    }
  }

  function dropSeat(key, playerId) {
    owners.delete(seatKey(key, playerId));
    const room = rooms.get(key);
    if (!room) return;
    GAMES[key.split(':')[0]].module.leave(room, playerId);
    cleanupIfEmpty(key);
    broadcast(key);
  }

  function detach(socket, { permanent }) {
    const session = socket.data.session;
    if (!session) return;
    socket.data.session = null;
    socket.leave(session.key);

    const seat = seatKey(session.key, session.playerId);
    if (owners.get(seat) !== socket.id) return;

    clearTimeout(timers.get(seat));
    timers.delete(seat);

    if (permanent) {
      dropSeat(session.key, session.playerId);
      return;
    }

    const room = rooms.get(session.key);
    if (!room) return;
    const { module } = GAMES[session.game];
    module.setConnected(room, session.playerId, false);
    broadcast(session.key);

    const delay = room.status === 'PLAYING' ? graceMs.PLAYING : graceMs.WAITING;
    timers.set(
      seat,
      setTimeout(() => {
        timers.delete(seat);
        const r = rooms.get(session.key);
        const p = r?.players.find((x) => x.id === session.playerId);
        if (p && !p.connected && owners.get(seat) === socket.id) dropSeat(session.key, session.playerId);
      }, delay)
    );
  }

  io.on('connection', (socket) => {
    const respond = (ack, fn) => {
      try {
        fn();
        ack?.({ ok: true });
      } catch (err) {
        if (!isGameError(err)) console.error(err);
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'Lỗi không xác định' });
      }
    };

    const withRoom = (game, fn) => {
      const fail = (message) => {
        throw new GAMES[game].module.GameError(message);
      };
      const session = socket.data.session;
      if (!session || session.game !== game) fail('Bạn chưa vào phòng.');
      const room = rooms.get(session.key);
      if (!room) fail('Phòng không còn tồn tại.');
      fn(room, session.playerId);
      broadcast(session.key);
    };

    const joinGame = (game, payload, ack) =>
      respond(ack, () => {
        const roomId = sanitizeRoomId(payload?.roomId);
        const playerId = sanitizeId(payload?.playerId);
        if (!roomId) throw new GAMES[game].module.GameError('Mã phòng không hợp lệ.');
        if (!playerId) throw new GAMES[game].module.GameError('Thiếu mã người chơi.');

        const key = roomKey(game, roomId);
        const { module } = GAMES[game];
        const room = rooms.get(key) ?? module.createRoom(roomId);
        module.join(room, { playerId, name: payload?.name, classId: payload?.classId });
        rooms.set(key, room);

        if (socket.data.session && socket.data.session.key !== key) detach(socket, { permanent: true });

        const seat = seatKey(key, playerId);
        const previous = owners.get(seat);
        if (previous && previous !== socket.id) {
          const old = io.sockets.sockets.get(previous);
          if (old) {
            old.data.session = null;
            old.leave(key);
            old.emit('session:replaced');
          }
        }
        clearTimeout(timers.get(seat));
        timers.delete(seat);
        owners.set(seat, socket.id);

        socket.data.session = { game, key, playerId };
        socket.join(key);
        broadcast(key);
      });

    socket.on('tienlen:join', (payload, ack) => joinGame('tienlen', payload, ack));
    socket.on('tienlen:start', (payload, ack) =>
      respond(ack, () => withRoom('tienlen', (room, pid) => tienlen.start(room, pid, payload?.mode)))
    );
    socket.on('tienlen:play', (payload, ack) =>
      respond(ack, () => withRoom('tienlen', (room, pid) => tienlen.play(room, pid, payload?.cardIds)))
    );
    socket.on('tienlen:pass', (_payload, ack) => respond(ack, () => withRoom('tienlen', (room, pid) => tienlen.pass(room, pid))));

    socket.on('monopoly:join', (payload, ack) => joinGame('monopoly', payload, ack));
    socket.on('monopoly:submit', (payload, ack) =>
      respond(ack, () => {
        try {
          withRoom('monopoly', (room, pid) => monopoly.applyState(room, pid, payload?.state));
        } catch (err) {
          const session = socket.data.session;
          if (session && rooms.has(session.key)) socket.emit('monopoly:state', rooms.get(session.key));
          throw err;
        }
      })
    );

    socket.on('horse:join', (payload, ack) => joinGame('horse', payload, ack));
    socket.on('horse:submit', (payload, ack) =>
      respond(ack, () => {
        try {
          withRoom('horse', (room, pid) => horse.applyState(room, pid, payload?.state));
        } catch (err) {
          const session = socket.data.session;
          if (session && rooms.has(session.key)) socket.emit('horse:state', rooms.get(session.key));
          throw err;
        }
      })
    );

    socket.on('room:leave', (_payload, ack) => respond(ack, () => detach(socket, { permanent: true })));
    socket.on('disconnect', () => detach(socket, { permanent: false }));
  });

  return { app, server, io, rooms };
}
