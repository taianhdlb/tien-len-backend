const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = new Map();

// --- HÀM HỖ TRỢ TIẾN LÊN: TẠO VÀ XÀO BÀI ---
const suits = ['♠', '♣', '♦', '♥'];
const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
function getDeck() {
  let deck = [];
  for (let r = 0; r < ranks.length; r++) {
    for (let s = 0; s < suits.length; s++) {
      deck.push({ id: `${ranks[r]}${suits[s]}`, rank: ranks[r], suit: suits[s], rankValue: r, suitValue: s });
    }
  }
  return deck.sort(() => Math.random() - 0.5); // Xào bài ngẫu nhiên
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ==========================================
  //             1. TIẾN LÊN ONLINE
  // ==========================================
  
  // Vào phòng
  socket.on('join_room', ({ roomId, playerName }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { 
        id: roomId, type: 'TIEN_LEN', players: [], 
        status: 'WAITING', currentTurn: 0, 
        lastPlayed: null, passedPlayers: {} 
      });
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 4) return socket.emit('error_msg', 'Phòng đầy!');
    
    room.players.push({ id: socket.id, name: playerName || `P${room.players.length + 1}`, hand: [] });
    io.to(roomId).emit('room_updated', room);
  });

  // Chia bài & Bắt đầu game
  socket.on('start_game', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) return socket.emit('error_msg', 'Cần ít nhất 2 người để bắt đầu!');
    
    const deck = getDeck();
    room.players.forEach((p, idx) => {
      // Chia 13 lá và sắp xếp trên tay người chơi
      p.hand = deck.slice(idx * 13, (idx + 1) * 13).sort((a, b) => a.rankValue - b.rankValue || a.suitValue - b.suitValue);
    });
    
    room.status = 'PLAYING';
    room.mode = mode;
    room.currentTurn = 0; // Người vào đầu tiên đánh trước
    room.lastPlayed = null;
    room.passedPlayers = {};
    
    io.to(roomId).emit('game_started', room);
  });

  // Đánh bài
  socket.on('play_cards', ({ roomId, cards }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    const player = room.players[playerIdx];
    
    // Trừ bài trên tay
    player.hand = player.hand.filter(c => !cards.find(playedCard => playedCard.id === c.id));
    room.lastPlayed = { playerName: player.name, cards };
    
    // Kiểm tra nếu hết bài -> Thắng
    if (player.hand.length === 0) {
      room.status = 'WAITING';
      io.to(roomId).emit('game_over', { winnerName: player.name });
    }
    
    // Chuyển lượt cho người chưa bỏ lượt
    let nextTurn = (playerIdx + 1) % room.players.length;
    while (room.passedPlayers[nextTurn] && nextTurn !== playerIdx) {
      nextTurn = (nextTurn + 1) % room.players.length;
    }
    room.currentTurn = nextTurn;
    
    io.to(roomId).emit('state_changed', room);
  });

  // Bỏ lượt
  socket.on('pass_turn', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    room.passedPlayers[playerIdx] = true;
    
    // Chuyển lượt
    let nextTurn = (playerIdx + 1) % room.players.length;
    let passCount = 1;
    
    while (room.passedPlayers[nextTurn] && nextTurn !== playerIdx) {
      nextTurn = (nextTurn + 1) % room.players.length;
      passCount++;
    }
    
    // Nếu tất cả những người khác đều đã bỏ lượt -> Kết thúc vòng, xóa bàn
    if (passCount >= room.players.length) {
      room.passedPlayers = {};
      room.lastPlayed = null; 
    }
    
    room.currentTurn = nextTurn;
    io.to(roomId).emit('state_changed', room);
  });


  // ==========================================
  //             2. MONOPOLY D&D
  // ==========================================
  
  socket.on('monopoly_join', ({ roomId, playerName, classId }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId, type: 'MONOPOLY', players: [], properties: {}, 
        currentTurn: 0, status: 'WAITING', logs: ['Chào mừng đến Baldur\'s Gate!']
      });
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 4) return socket.emit('error_msg', 'Phòng đầy!');
    
    room.players.push({
      id: socket.id, name: playerName || `P${room.players.length + 1}`, classId: classId || 'fighter',
      gold: 200, position: 0, inJail: false, isBankrupt: false
    });
    io.to(roomId).emit('monopoly_updated', room);
  });

  socket.on('monopoly_action', ({ roomId, roomState }) => {
    if (rooms.has(roomId)) {
      rooms.set(roomId, roomState);
      io.to(roomId).emit('monopoly_updated', roomState);
    }
  });


  // ==========================================
  //             3. XỬ LÝ DISCONNECT
  // ==========================================
  
  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      room.players = room.players.filter(p => p.id !== socket.id);
      
      if (room.players.length === 0) {
        rooms.delete(roomId); // Xóa phòng nếu không còn ai
      } else {
        io.to(roomId).emit(room.type === 'MONOPOLY' ? 'monopoly_updated' : 'room_updated', room);
      }
    });
  });
});

server.listen(process.env.PORT || 4000, () => console.log('Server running on port 4000...'));