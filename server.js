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
app.get('/', (req, res) => {
  res.status(200).send('🎮 SEQUENCE GAME SERVER is running successfully on Railway!');
});

// ── غرف نشطة ──────────────────────────────────────────────
const rooms = new Map();

function getRoomBySocket(sid) {
  for (const [code, room] of rooms) {
    if (room.players.includes(sid)) return { code, room };
  }
  return null;
}

// ── بناء ورق اللعبة (خلط عشوائي) ──────────────────────────
function buildDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck  = [];
  for (let i = 0; i < 2; i++)
    for (const s of suits)
      for (const r of ranks)
        deck.push(`${r}${s}`);
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
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
  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;

    // السيرفر يبني ويخلط الورق
    const deck = buildDeck();
    const sz   = room.np <= 2 ? 7 : 6;
    const hands = Array.from({ length: room.np }, () => deck.splice(0, sz));

    room.started   = true;
    room.gameState = { deck, hands };

    // كل لاعب يستقبل أوراقه فقط + عدد الـ deck
    room.players.forEach((pid, index) => {
      io.to(pid).emit('game-init', {
        index,
        np: room.np,
        hand: hands[index],
        deckCount: deck.length
      });
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

  // ── طلب سحب ورقة جديدة ──────────────────────────────────
  socket.on('draw-card', ({ code }) => {
    const room = rooms.get(code);
    if (!room || !room.gameState) return;
    const { deck, hands } = room.gameState;
    const pIdx = room.players.indexOf(socket.id);
    if (pIdx === -1) return;
    if (deck.length === 0) { socket.emit('no-cards'); return; }
    const card = deck.pop();
    hands[pIdx].push(card);
    socket.emit('card-drawn', { card, deckCount: deck.length });
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
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log('═'.repeat(50));
  console.log('🃏  SEQUENCE GAME SERVER  v3.1');
  console.log('═'.repeat(50));
  console.log(`✅  يعمل على ${HOST}:${PORT}`);
  console.log('🚀 Railway Deployment Ready');
  console.log('═'.repeat(50));
});