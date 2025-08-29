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

  socket.emit(
    "rooms-update",
    Object.keys(rooms).map((roomId) => ({ roomId }))
  );

  socket.on("create-room", (roomId) => {
    console.log(`Create room request: ${roomId}`);
    if (!rooms[roomId]) {
      const initialBoard = createInitialBoard();
      console.log("Initial board created:", initialBoard[0][0]);

      rooms[roomId] = {
        board: initialBoard,
        players: {},
        spymasters: { blue: null, red: null },
        gameStatus: "playing",
        blackWordRevealed: false,
        currentTeam: "red",
      };

      io.emit(
        "rooms-update",
        Object.keys(rooms).map((id) => ({ roomId: id }))
      );
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

  socket.on("join-room", (roomId) => {
    console.log(`Join room request: ${roomId}`);
    if (rooms[roomId]) {
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
    } else {
      socket.emit("room-data", { message: "Room does not exist" });
    }
  });

  socket.on("reset-game", (roomId) => {
    const room = rooms[roomId];
    if (room) {
      const newBoard = createInitialBoard();

      room.board = newBoard;
      room.gameStatus = "playing";
      room.blackWordRevealed = false;
      room.currentTeam = "red";

      io.to(roomId).emit("room-data", {
        board: room.board,
        players: room.players,
        gameStatus: room.gameStatus,
        blackWordRevealed: room.blackWordRevealed,
        currentTeam: room.currentTeam,
        spymasters: room.spymasters,
      });
    }
  });

  socket.on("pass-turn", ({ roomId, newTurn }) => {
    const room = rooms[roomId];
    if (room) {
      room.currentTeam = newTurn;

      io.to(roomId).emit("room-data", {
        currentTeam: room.currentTeam,
      });
    }
  });

  socket.on("card-clicked", (data) => {
    socket.to(data.roomId).emit("card-clicked", data);
  });

  socket.on("update-board", (data) => {
    if (rooms[data.roomId]) {
      const room = rooms[data.roomId];
      room.board = data.board;
      room.gameStatus = data.gameStatus;
      room.blackWordRevealed = data.blackWordRevealed;
      room.currentTeam = data.currentTurn;

      io.to(data.roomId).emit("room-data", {
        board: room.board,
        players: room.players,
        gameStatus: room.gameStatus,
        blackWordRevealed: room.blackWordRevealed,
        currentTeam: room.currentTeam,
        spymasters: room.spymasters,
      });
    }
  });

  socket.on("game-won", ({ roomId, winnerTeam }) => {
    const room = rooms[roomId];
    if (room) {
      room.gameStatus = "finished";
      io.to(roomId).emit("game-won", { winnerTeam });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId] && rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit("room-data", {
          message: `Client ${socket.id} has left the room.`,
          players: rooms[roomId].players,
        });

        if (Object.keys(rooms[roomId].players).length === 0) {
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
    "red",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "black",
  ];
  const shuffledCategories = shuffleArray([...categories]);
  const uniqueWords = [...new Set(words)];
  const shuffledWords = shuffleArray([...uniqueWords]).slice(0, 25);

  const board = [];
  let redIndex = 0;
  let blueIndex = 0;

  for (let i = 0; i < 25; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;

    if (!board[row]) board[row] = [];

    const category = shuffledCategories[i];
    let imageIndex = 0;

    if (category === "red") {
      imageIndex = redIndex;
      redIndex = (redIndex + 1) % 9;
    } else if (category === "blue") {
      imageIndex = blueIndex;
      blueIndex = (blueIndex + 1) % 8;
    }

    board[row][col] = {
      word: shuffledWords[i],
      revealed: false,
      category: category,
      imageIndex: imageIndex,
    };
  }

  return board;
}

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
  const board = [];
  const categories = [
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "red",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "blue",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "neutral",
    "black",
  ];
  const shuffledCategories = shuffleArray([...categories]);
  const uniqueWords = [...new Set(words)];
  const shuffledWords = shuffleArray([...uniqueWords]).slice(0, 25);

  let redIndex = 0;
  let blueIndex = 0;

  for (let i = 0; i < 25; i++) {
    const row = Math.floor(i / 5);
    const col = i % 5;

    if (!board[row]) board[row] = [];

    const category = shuffledCategories[i];
    let imageIndex = 0;

    if (category === "red") {
      imageIndex = redIndex;
      redIndex = (redIndex + 1) % 9;
    } else if (category === "blue") {
      imageIndex = blueIndex;
      blueIndex = (blueIndex + 1) % 8;
    }

    board[row][col] = {
      word: shuffledWords[i],
      revealed: false,
      category: category,
      imageIndex: imageIndex,
    };
  }

  console.log("PRIMEIRO CARD CRIADO:", board[0][0]);
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
