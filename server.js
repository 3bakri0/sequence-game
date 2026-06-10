// ============================================================
// SEQUENCE GAME – Socket.io Server v3
// ============================================================
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── غرف نشطة ──────────────────────────────────────────────
const rooms = new Map();

function getRoomBySocket(sid) {
  for (const [code, room] of rooms) {
    if (room.players.includes(sid)) return { code, room };
  }
  return null;
}

// ── اتصال ──────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`✅ [${socket.id}] متصل`);

  // ── إنشاء غرفة ─────────────────────────────────────────
  socket.on('create-room', ({ code, np }) => {
    if (rooms.has(code)) {
      socket.emit('room-error', 'الغرفة موجودة بالفعل!');
      return;
    }
    rooms.set(code, {
      code, host: socket.id,
      players: [socket.id],
      np: parseInt(np),
      gameState: null,
      started: false
    });
    socket.join(code);
    socket.emit('room-created', { code, playerIndex: 0, np });
    console.log(`🏠 غرفة [${code}] أُنشئت | ${np} لاعبين`);
  });

  // ── الانضمام لغرفة ──────────────────────────────────────
  socket.on('join-room', ({ code }) => {
    const room = rooms.get(code);
    if (!room)                         { socket.emit('room-error', 'الغرفة غير موجودة!'); return; }
    if (room.started)                  { socket.emit('room-error', 'اللعبة بدأت بالفعل!'); return; }
    if (room.players.length >= room.np){ socket.emit('room-error', 'الغرفة ممتلئة!'); return; }

    room.players.push(socket.id);
    socket.join(code);
    const playerIndex = room.players.length - 1;

    socket.emit('room-joined', { code, playerIndex, np: room.np });

    io.to(room.host).emit('player-joined', {
      playerCount: room.players.length,
      np: room.np,
      newPlayerIndex: playerIndex
    });

    console.log(`🚪 [${socket.id}] انضم للغرفة [${code}] كلاعب ${playerIndex}`);

    if (room.players.length === room.np) {
      io.to(room.host).emit('all-players-joined');
      console.log(`🎯 الغرفة [${code}] اكتملت!`);
    }
  });

  // ── بدء اللعبة (المضيف فقط) ─────────────────────────────
  socket.on('start-game', ({ code, deck, hands, np }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;

    room.started  = true;
    room.gameState = { deck, hands };

    room.players.forEach((pid, index) => {
      io.to(pid).emit('game-init', { index, np, deck, hands });
    });
    console.log(`🎮 اللعبة بدأت في [${code}]`);
  });

  // ── مزامنة حركة وتحديث الأوراق أونلاين ─────────────────────────────────────────
  socket.on('game-sync', data => {
    const found = getRoomBySocket(socket.id);
    if (!found) return;

    // تحديث الأوراق والـ deck في السيرفر لتبقى متزامنة عند السحب والحرق
    if (data.hands && found.room.gameState) found.room.gameState.hands = data.hands;
    if (data.deck && found.room.gameState)  found.room.gameState.deck = data.deck;

    socket.to(found.code).emit('game-sync', data);
  });

  // ── رسالة دردشة سريعة ────────────────────────
  socket.on('chat', ({ code, msg }) => {
    const room = rooms.get(code);
    if (!room || !room.players.includes(socket.id)) return;
    const idx = room.players.indexOf(socket.id);
    io.to(code).emit('chat', { playerIndex: idx, msg });
  });

  // ── قطع الاتصال ─────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`❌ [${socket.id}] قطع الاتصال`);
    const found = getRoomBySocket(socket.id);
    if (!found) return;
    const { code, room } = found;
    const playerIndex = room.players.indexOf(socket.id);

    io.to(code).emit('player-disconnected', {
      playerIndex,
      wasHost: room.host === socket.id
    });

    if (room.host === socket.id) {
      rooms.delete(code);
      console.log(`🗑️ غرفة [${code}] حُذفت (المضيف انقطع)`);
    } else {
      room.players = room.players.filter(p => p !== socket.id);
    }
  });
});

// ── نظافة دورية ────────────────────────
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.players.length === 0) {
      rooms.delete(code);
      console.log(`🧹 غرفة [${code}] حُذفت (فارغة)`);
    }
  }
}, 60_000);

// ── تشغيل ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('═'.repeat(50));
  console.log('🃏  SEQUENCE GAME SERVER  v3.1');
  console.log('═'.repeat(50));
  console.log(`✅  يعمل على المنفذ ${PORT}`);
  console.log(`🌐  http://localhost:${PORT}`);
  console.log('═'.repeat(50));
});
module.exports = app;