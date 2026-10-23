const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Cho phép mọi Frontend kết nối
    methods: ["GET", "POST"]
  }
});

// Lưu trữ danh sách phòng chơi trong bộ nhớ RAM
// Cấu trúc: { roomId: { players: [{id, name}], gameState: {} } }
const rooms = new Map();

// Khởi tạo bộ bài 52 lá
function createDeck() {
  const suits = [
    { symbol: '♠', color: 'black', rank: 1 },
    { symbol: '♣', color: 'black', rank: 2 },
    { symbol: '♦', color: 'red', rank: 3 },
    { symbol: '♥', color: 'red', rank: 4 }
  ];
  const ranks = [
    { label: '3', value: 3 }, { label: '4', value: 4 }, { label: '5', value: 5 },
    { label: '6', value: 6 }, { label: '7', value: 7 }, { label: '8', value: 8 },
    { label: '9', value: 9 }, { label: '10', value: 10 }, { label: 'J', value: 11 },
    { label: 'Q', value: 12 }, { label: 'K', value: 13 }, { label: 'A', value: 14 },
    { label: '2', value: 15 }
  ];
  const deck = [];
  for (const rank of ranks) {
    for (const suit of suits) {
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
  // Tráo bài (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', (socket) => {
  console.log(`Người chơi kết nối: ${socket.id}`);

  // 1. Tham gia phòng
  socket.on('join_room', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        players: [],
        status: 'WAITING', // WAITING | PLAYING
        mode: 'TLMN',
        lastPlayed: null,
        currentTurn: 0,
        passedPlayers: [false, false, false, false]
      });
    }

    const room = rooms.get(roomId);

    if (room.players.length >= 4) {
      socket.emit('error_msg', 'Phòng đã đầy (tối đa 4 người)!');
      return;
    }

    const player = {
      id: socket.id,
      name: playerName || `Người chơi ${room.players.length + 1}`,
      hand: []
    };

    room.players.push(player);
    io.to(roomId).emit('room_updated', room);
  });

  // 2. Bắt đầu ván bài (Chia bài)
  socket.on('start_game', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit('error_msg', 'Cần ít nhất 2 người để bắt đầu!');
      return;
    }

    const deck = createDeck();
    room.mode = mode || 'TLMN';
    room.status = 'PLAYING';
    room.lastPlayed = null;
    room.passedPlayers = new Array(room.players.length).fill(false);

    // Chia 13 lá cho mỗi người
    room.players.forEach((p, idx) => {
      p.hand = deck.slice(idx * 13, (idx + 1) * 13).sort((a, b) => a.totalValue - b.totalValue);
    });

    // Tìm người giữ 3♠ đi trước
    let firstTurn = 0;
    room.players.forEach((p, idx) => {
      if (p.hand.some(c => c.id === '3-♠')) firstTurn = idx;
    });
    room.currentTurn = firstTurn;

    io.to(roomId).emit('game_started', room);
  });

  // 3. Đánh bài
  socket.on('play_cards', ({ roomId, cards }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;

    // Cập nhật bài trên tay
    const player = room.players[playerIdx];
    player.hand = player.hand.filter(c => !cards.some(played => played.id === c.id));

    room.lastPlayed = { cards, playerIndex: playerIdx, playerName: player.name };

    // Kiểm tra thắng
    if (player.hand.length === 0) {
      io.to(roomId).emit('game_over', { winnerName: player.name });
      room.status = 'WAITING';
      return;
    }

    // Chuyển lượt
    let next = (playerIdx + 1) % room.players.length;
    while (room.passedPlayers[next]) {
      next = (next + 1) % room.players.length;
    }
    room.currentTurn = next;

    io.to(roomId).emit('state_changed', room);
  });

  // 4. Bỏ lượt
  socket.on('pass_turn', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;

    room.passedPlayers[playerIdx] = true;

    // Số người chưa bỏ lượt
    const activeCount = room.passedPlayers.filter(p => !p).length;

    if (activeCount === 1) {
      // Tìm người cuối cùng làm chủ bàn mới
      let winnerOfRound = room.passedPlayers.findIndex(p => !p);
      room.lastPlayed = null;
      room.passedPlayers = new Array(room.players.length).fill(false);
      room.currentTurn = winnerOfRound;
    } else {
      let next = (playerIdx + 1) % room.players.length;
      while (room.passedPlayers[next]) {
        next = (next + 1) % room.players.length;
      }
      room.currentTurn = next;
    }

    io.to(roomId).emit('state_changed', room);
  });

  // 5. Ngắt kết nối
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('room_updated', room);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server đang chạy ở port ${PORT}`);
});