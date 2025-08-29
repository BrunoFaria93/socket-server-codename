const http = require("http");
const express = require("express");
const socketIo = require("socket.io");
const cors = require("cors");
const words = require("./words.json"); // Atualize o caminho para o seu arquivo words.json

const app = express();

app.get("/", (request, response) => {
  return response.send("Ping!");
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  headers: { "user-agent": "Google Chrome" },
  transports: ["websocket", "polling"],
});

app.use(
  cors({
    origin: "*",
  })
);

const rooms = {}; // Armazenar salas como objetos
const colors = ["#60a5fa", "#f87171", "#d1d5db", "#000000"]; // Cores diferentes para os jogadores

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Envia a lista de salas disponíveis ao conectar
  socket.emit(
    "rooms-update",
    Object.keys(rooms).map((roomId) => ({ roomId }))
  );

  // Manipula a criação de sala
  socket.on("create-room", (roomId) => {
    console.log(`Create room request: ${roomId}`);
    if (!rooms[roomId]) {
      rooms[roomId] = {
        board: createInitialBoard(),
        players: {},
        spymasters: { blue: null, red: null }, // Inicializa os Spymasters com valores nulos
        gameStatus: "playing",
        blackWordRevealed: false,
        currentTeam: "blue",
      };
      io.emit(
        "rooms-update",
        Object.keys(rooms).map((id) => ({ roomId: id }))
      );
      console.log(`Room created: ${roomId}`);
    }
    socket.join(roomId);
    const playerColor = assignPlayerColor(roomId);
    rooms[roomId].players[socket.id] = {
      color: playerColor,
      isSpymaster: false,
    };
    socket.emit("room-data", {
      roomId,
      message: "You joined the room!",
      board: rooms[roomId].board,
      playerColor,
      players: rooms[roomId].players,
      gameStatus: rooms[roomId].gameStatus,
      currentTeam: rooms[roomId].currentTeam,
      spymasters: rooms[roomId].spymasters,
    });
    socket.to(roomId).emit("room-data", {
      message: `Client ${socket.id} joined the room!`,
      board: rooms[roomId].board,
      players: rooms[roomId].players,
      gameStatus: rooms[roomId].gameStatus,
      currentTeam: rooms[roomId].currentTeam,
      spymasters: rooms[roomId].spymasters,
    });
  });
  socket.on("reset-board", (roomId, newBoard) => {
    // Envia o novo board para todos os jogadores na sala, exceto o que enviou
    socket.to(roomId).emit("reset-board", newBoard);

    // Se quiser enviar também para quem clicou no reset
    // io.in(roomId).emit('reset-board', newBoard);
  });
  // Manipula o ingresso na sala
  socket.on("join-room", (roomId) => {
    console.log(`Join room request: ${roomId}`);
    if (rooms[roomId]) {
      socket.join(roomId);
      console.log(`Client ${socket.id} joined room: ${roomId}`);
      const playerColor = assignPlayerColor(roomId);
      rooms[roomId].players[socket.id] = {
        color: playerColor,
        isSpymaster: false,
      };
      socket.emit("room-data", {
        roomId,
        message: "You joined the room!",
        board: rooms[roomId].board,
        playerColor,
        players: rooms[roomId].players,
        gameStatus: rooms[roomId].gameStatus,
        currentTeam: rooms[roomId].currentTeam,
        spymasters: rooms[roomId].spymasters,
      });
      socket.to(roomId).emit("room-data", {
        message: `Client ${socket.id} joined the room!`,
        board: rooms[roomId].board,
        players: rooms[roomId].players,
        gameStatus: rooms[roomId].gameStatus,
        currentTeam: rooms[roomId].currentTeam,
        spymasters: rooms[roomId].spymasters,
      });
    } else {
      console.log(`Room ${roomId} does not exist`);
      socket.emit("room-data", { message: "Room does not exist" });
    }
  });

  // Manipula o pedido para ser Spymaster
  socket.on("set-spymaster", ({ roomId, team }) => {
    const room = rooms[roomId];
    if (room) {
      if (!room.spymasters[team]) {
        room.spymasters[team] = socket.id;
        room.players[socket.id].isSpymaster = true;
        io.to(roomId).emit("room-data", {
          spymasters: room.spymasters,
          players: room.players,
          message: `Player ${socket.id} is now Spymaster for ${team}`,
        });
      } else {
        socket.emit("room-data", {
          message: "Spymaster already assigned for this team.",
        });
      }
    } else {
      socket.emit("room-data", { message: "Room does not exist" });
    }
  });
  socket.on("reset-game", (roomId) => {
    const room = rooms[roomId];
    if (room) {
      // Reseta completamente o estado da sala
      room.board = createInitialBoard();
      room.gameStatus = "playing";
      room.blackWordRevealed = false;
      room.currentTeam = "blue";

      // Notifica TODOS os jogadores na sala sobre o reset
      io.to(roomId).emit("room-data", {
        board: room.board,
        players: room.players,
        gameStatus: room.gameStatus,
        blackWordRevealed: room.blackWordRevealed,
        currentTeam: room.currentTeam,
      });

      console.log(`Game reset for room: ${roomId}`);
    } else {
      socket.emit("room-data", { message: "Room does not exist" });
    }
  });
  socket.on("card-clicked", (data) => {
    console.log("Card clicked event received on server:", data);
    socket.to(data.roomId).emit("card-clicked", data);
  });

  // Manipula a renúncia de Spymaster
  socket.on("resign-spymaster", (roomId) => {
    const room = rooms[roomId];
    if (room) {
      const player = room.players[socket.id];
      if (player && player.isSpymaster) {
        const team = Object.keys(room.spymasters).find(
          (team) => room.spymasters[team] === socket.id
        );
        if (team) {
          delete room.spymasters[team];
          player.isSpymaster = false;
          io.to(roomId).emit("room-data", {
            spymasters: room.spymasters,
            players: room.players,
          });
        }
      }
    }
  });

  // Manipula atualizações do tabuleiro
  socket.on("update-board", (data) => {
    console.log("Update board received from socket:", data);

    if (rooms[data.roomId]) {
      const room = rooms[data.roomId];
      room.board = data.board;
      room.gameStatus = data.gameStatus;
      room.blackWordRevealed = data.blackWordRevealed;
      room.currentTeam = data.currentTeam;

      io.to(data.roomId).emit("room-data", {
        board: room.board,
        players: room.players,
        gameStatus: room.gameStatus,
        blackWordRevealed: room.blackWordRevealed,
        currentTeam: room.currentTeam,
      });

      console.log(`Board updated and emitted to room: ${data.roomId}`);
    }
  });

  socket.on("cell-click", (data) => {
    const { roomId, row, col } = data;
    const room = rooms[roomId];
    if (!room) return;

    const cell = room.board[row][col];
    const player = room.players[socket.id];

    if (!player) return;

    if (!player.isSpymaster && cell.revealed) {
      return;
    }

    if (player.isSpymaster) {
      room.board = room.board.map((rowArr) =>
        rowArr.map((cell) => ({ ...cell, revealed: true }))
      );
    } else {
      const newBoard = room.board.map((rowArr, rowIndex) =>
        rowArr.map((cell, colIndex) =>
          rowIndex === row && colIndex === col
            ? { ...cell, revealed: true }
            : cell
        )
      );

      let gameStatus = room.gameStatus;
      let blackWordRevealed = room.blackWordRevealed;
      let currentTeam = room.currentTeam;

      if (cell.category === "black") {
        gameStatus = "lost";
        blackWordRevealed = true;
      } else if (cell.category !== currentTeam) {
        // Se clicou em carta que NÃO é da equipe atual, passa a vez
        currentTeam = currentTeam === "blue" ? "red" : "blue";
      }
      // Se clicou em carta da própria equipe, continua o turno

      room.board = newBoard;
      room.gameStatus = gameStatus;
      room.blackWordRevealed = blackWordRevealed;
      room.currentTeam = currentTeam;
    }

    io.to(roomId).emit("room-data", {
      board: room.board,
      players: room.players,
      gameStatus: room.gameStatus,
      blackWordRevealed: room.blackWordRevealed,
      currentTeam: room.currentTeam,
    });

    if (room.gameStatus === "lost") {
      io.to(roomId).emit("game-over", {
        message: "Game over! Black word revealed.",
      });
    }
  });
  // socket.on("reset-board", (roomId, newBoard, newStatus) => {
  //   io.to(roomId).emit("reset-board", newBoard, newStatus);
  // });
  // Manipula o pedido para deletar uma sala
  socket.on("delete-room", (roomId) => {
    console.log(`Delete room request: ${roomId}`);
    if (rooms[roomId]) {
      // Remove a sala
      delete rooms[roomId];
      io.emit(
        "rooms-update",
        Object.keys(rooms).map((id) => ({ roomId: id }))
      );
      console.log(`Room deleted: ${roomId}`);
      io.to(roomId).emit("room-deleted", {
        message: `Room ${roomId} has been deleted.`,
      });
    } else {
      socket.emit("room-data", { message: "Room does not exist" });
    }
  });

  // Limpa a sala quando o cliente desconecta
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    Object.keys(rooms).forEach((roomId) => {
      if (io.sockets.adapter.rooms.get(roomId)?.has(socket.id)) {
        const room = rooms[roomId];
        delete room.players[socket.id];
        io.to(roomId).emit("room-data", {
          message: `Client ${socket.id} has left the room.`,
          players: room.players,
        });

        // Se a sala estiver vazia, remova-a
        if (Object.keys(room.players).length === 0) {
          delete rooms[roomId];
          io.emit(
            "rooms-update",
            Object.keys(rooms).map((id) => ({ roomId: id }))
          );
        }
      }
    });
  });
});

function shuffleArray(array) {
  // Cria uma cópia do array para não alterar o original
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
function createInitialBoard() {
  const categories = [
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red", // 9 vermelhas
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue", // 8 azuis
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral", // 7 cinzas
    "black", // 1 preta
  ];

  const shuffledCategories = shuffleArray(categories);

  // Garantir que temos palavras únicas suficientes
  const uniqueWords = Array.from(new Set(words));
  if (uniqueWords.length < 25) {
    throw new Error("Não há palavras únicas suficientes");
  }

  const shuffledWords = shuffleArray(uniqueWords).slice(0, 25);

  // Gerar índices únicos para as imagens
  const redIndices = shuffleArray(Array.from({ length: 9 }, (_, i) => i));
  const blueIndices = shuffleArray(Array.from({ length: 8 }, (_, i) => i));

  let redIndexCounter = 0;
  let blueIndexCounter = 0;

  const board = Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, col) => {
      const index = row * 5 + col;
      const category = shuffledCategories[index];

      let imageIndex = 0;
      if (category === "red") {
        imageIndex = redIndices[redIndexCounter++];
      } else if (category === "blue") {
        imageIndex = blueIndices[blueIndexCounter++];
      }

      return {
        word: shuffledWords[index],
        revealed: false,
        category: category,
        imageIndex: imageIndex,
      };
    })
  );

  return board;
}

function determineCategory(row, col) {
  // Adicione sua lógica para determinar a categoria de cada palavra
  // Exemplo simplificado
  const categories = ["blue", "red", "neutral", "black"];
  return categories[Math.floor(Math.random() * categories.length)];
}

function assignPlayerColor(roomId) {
  const usedColors = Object.values(rooms[roomId].players).map(
    (player) => player.color
  );
  return colors.find((color) => !usedColors.includes(color)) || "#FFFFFF"; // Retorna cor padrão se todas as cores estiverem em uso
}

server.listen(4000, () => console.log("Server running"));
