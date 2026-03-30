const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 房間資料結構
const rooms = {}; // roomCode -> roomData

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateQuestion() {
  const divisor = Math.floor(Math.random() * 8) + 2;
  const is3digit = Math.random() > 0.4;
  const dividend = is3digit
    ? Math.floor(Math.random() * 900) + 100
    : Math.floor(Math.random() * 81) + 12;
  return {
    dividend,
    divisor,
    quotient: Math.floor(dividend / divisor),
    remainder: dividend % divisor
  };
}

function calcScore(timeSec, isCorrect) {
  if (!isCorrect) return { points: -20, isLucky: false };
  let base = timeSec <= 3 ? 100 : timeSec <= 6 ? 80 : timeSec <= 10 ? 60 : timeSec <= 15 ? 40 : 20;
  const isLucky = timeSec > 5 && Math.random() < 0.20;
  return { points: isLucky ? base * 2 : base, isLucky };
}

const TOTAL_QUESTIONS = 15;
const QUESTION_TIME = 15; // seconds

io.on('connection', (socket) => {
  console.log(`連線: ${socket.id}`);

  // 老師建立房間
  socket.on('createRoom', (callback) => {
    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);

    rooms[code] = {
      code,
      teacherSocketId: socket.id,
      students: {}, // socketId -> { name, score, answers: [] }
      status: 'waiting', // waiting, playing, ended
      currentQuestion: 0,
      questions: [],
      questionAnswers: {}, // socketId -> { quotient, remainder, timeSec }
      questionTimer: null
    };

    socket.join(code);
    socket.roomCode = code;
    socket.isTeacher = true;

    console.log(`老師建立房間: ${code}`);
    if (callback) callback({ success: true, roomCode: code });
  });

  // 學生加入房間
  socket.on('joinRoom', ({ roomCode, name }, callback) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      if (callback) callback({ success: false, error: '找不到此房間代碼，請確認後再試！' });
      return;
    }
    if (room.status !== 'waiting') {
      if (callback) callback({ success: false, error: '遊戲已經開始，無法加入！' });
      return;
    }
    if (!name || name.trim() === '') {
      if (callback) callback({ success: false, error: '請輸入你的名字！' });
      return;
    }

    const trimmedName = name.trim().substring(0, 20);

    // 檢查名字是否重複
    const nameExists = Object.values(room.students).some(s => s.name === trimmedName);
    if (nameExists) {
      if (callback) callback({ success: false, error: '這個名字已經有人使用了，請換一個！' });
      return;
    }

    room.students[socket.id] = {
      name: trimmedName,
      score: 0,
      answers: []
    };

    socket.join(code);
    socket.roomCode = code;
    socket.isTeacher = false;
    socket.studentName = trimmedName;

    const studentList = Object.entries(room.students).map(([id, s]) => ({
      id,
      name: s.name,
      score: s.score
    }));

    // 通知老師
    io.to(room.teacherSocketId).emit('studentJoined', {
      studentId: socket.id,
      name: trimmedName,
      studentList
    });

    console.log(`學生 ${trimmedName} 加入房間 ${code}`);
    if (callback) callback({ success: true, roomCode: code, name: trimmedName, studentList });
  });

  // 老師開始遊戲
  socket.on('startGame', (callback) => {
    const code = socket.roomCode;
    const room = rooms[code];

    if (!room || room.teacherSocketId !== socket.id) {
      if (callback) callback({ success: false, error: '無效操作' });
      return;
    }
    if (Object.keys(room.students).length === 0) {
      if (callback) callback({ success: false, error: '還沒有學生加入！' });
      return;
    }

    room.status = 'playing';
    room.currentQuestion = 0;
    room.questions = [];
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      room.questions.push(generateQuestion());
    }

    // 重置所有學生分數
    for (const sid of Object.keys(room.students)) {
      room.students[sid].score = 0;
      room.students[sid].answers = [];
    }

    // 通知所有學生遊戲即將開始
    io.to(code).emit('gameStarting', { totalQuestions: TOTAL_QUESTIONS });

    if (callback) callback({ success: true });

    // 3秒後發第一題
    setTimeout(() => {
      sendNextQuestion(code);
    }, 3000);
  });

  // 老師重新開始遊戲
  socket.on('restartGame', (callback) => {
    const code = socket.roomCode;
    const room = rooms[code];

    if (!room || room.teacherSocketId !== socket.id) {
      if (callback) callback({ success: false, error: '無效操作' });
      return;
    }

    // 清除計時器
    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = null;
    }

    room.status = 'waiting';
    room.currentQuestion = 0;
    room.questions = [];
    room.questionAnswers = {};

    for (const sid of Object.keys(room.students)) {
      room.students[sid].score = 0;
      room.students[sid].answers = [];
    }

    // 通知所有人回到等待畫面
    const studentList = Object.entries(room.students).map(([id, s]) => ({
      id,
      name: s.name,
      score: s.score
    }));
    io.to(code).emit('gameRestarted', { studentList });

    if (callback) callback({ success: true });
  });

  // 學生提交答案
  socket.on('submitAnswer', ({ quotient, remainder }, callback) => {
    const code = socket.roomCode;
    const room = rooms[code];

    if (!room || room.status !== 'playing') return;
    if (!room.students[socket.id]) return;

    const qIdx = room.currentQuestion - 1;
    if (qIdx < 0 || qIdx >= room.questions.length) return;

    // 已答過
    if (room.questionAnswers[socket.id]) {
      if (callback) callback({ success: false, error: '已經提交過答案' });
      return;
    }

    const now = Date.now();
    const elapsed = (now - room.questionStartTime) / 1000;
    const timeSec = Math.min(elapsed, QUESTION_TIME);

    const question = room.questions[qIdx];
    const isCorrect = (parseInt(quotient) === question.quotient && parseInt(remainder) === question.remainder);
    const { points, isLucky } = calcScore(timeSec, isCorrect);

    room.questionAnswers[socket.id] = {
      quotient: parseInt(quotient),
      remainder: parseInt(remainder),
      timeSec,
      isCorrect,
      points,
      isLucky
    };

    // 更新分數（最低0分）
    const student = room.students[socket.id];
    student.score = Math.max(0, student.score + points);
    student.answers.push({
      questionIdx: qIdx,
      dividend: question.dividend,
      divisor: question.divisor,
      correctQuotient: question.quotient,
      correctRemainder: question.remainder,
      studentQuotient: parseInt(quotient),
      studentRemainder: parseInt(remainder),
      isCorrect,
      points,
      isLucky,
      timeSec: timeSec.toFixed(2)
    });

    // 回傳答題反饋給學生
    socket.emit('answerFeedback', {
      isCorrect,
      points,
      isLucky,
      totalScore: student.score,
      correctQuotient: question.quotient,
      correctRemainder: question.remainder,
      timeSec: timeSec.toFixed(2)
    });

    // 通知老師有學生答題
    const answeredCount = Object.keys(room.questionAnswers).length;
    const totalCount = Object.keys(room.students).length;

    io.to(room.teacherSocketId).emit('studentAnswered', {
      studentId: socket.id,
      name: student.name,
      isCorrect,
      points,
      timeSec: timeSec.toFixed(2),
      answeredCount,
      totalCount
    });

    if (callback) callback({ success: true });

    // 全部人都答完了就結束本題
    if (answeredCount >= totalCount) {
      if (room.questionTimer) {
        clearTimeout(room.questionTimer);
        room.questionTimer = null;
      }
      endQuestion(code);
    }
  });

  // 斷線處理
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (socket.isTeacher) {
      // 老師斷線，通知所有人
      io.to(code).emit('roomClosed', { reason: '老師已離開，房間關閉' });
      if (room.questionTimer) clearTimeout(room.questionTimer);
      delete rooms[code];
      console.log(`老師離開，房間 ${code} 已關閉`);
    } else {
      // 學生斷線
      if (room.students[socket.id]) {
        const name = room.students[socket.id].name;
        delete room.students[socket.id];

        const studentList = Object.entries(room.students).map(([id, s]) => ({
          id,
          name: s.name,
          score: s.score
        }));

        io.to(room.teacherSocketId).emit('studentLeft', {
          studentId: socket.id,
          name,
          studentList
        });

        console.log(`學生 ${name} 離開房間 ${code}`);

        // 如果遊戲中，檢查是否所有人都答完
        if (room.status === 'playing' && room.questionAnswers) {
          const answeredCount = Object.keys(room.questionAnswers).filter(id => room.students[id] || id === socket.id).length;
          const totalCount = Object.keys(room.students).length;
          if (totalCount > 0 && Object.keys(room.questionAnswers).length >= totalCount) {
            if (room.questionTimer) {
              clearTimeout(room.questionTimer);
              room.questionTimer = null;
            }
            endQuestion(code);
          }
        }
      }
    }
  });
});

function sendNextQuestion(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;

  room.questionAnswers = {};
  room.currentQuestion++;

  if (room.currentQuestion > TOTAL_QUESTIONS) {
    endGame(code);
    return;
  }

  const qIdx = room.currentQuestion - 1;
  const question = room.questions[qIdx];
  room.questionStartTime = Date.now();

  // 發題目給所有人（不含正確答案）
  io.to(code).emit('newQuestion', {
    questionNumber: room.currentQuestion,
    totalQuestions: TOTAL_QUESTIONS,
    dividend: question.dividend,
    divisor: question.divisor,
    timeLimit: QUESTION_TIME
  });

  // 老師額外收到答案（顯示在後台）
  io.to(room.teacherSocketId).emit('questionStarted', {
    questionNumber: room.currentQuestion,
    totalQuestions: TOTAL_QUESTIONS,
    dividend: question.dividend,
    divisor: question.divisor,
    quotient: question.quotient,
    remainder: question.remainder,
    timeLimit: QUESTION_TIME,
    totalStudents: Object.keys(room.students).length
  });

  // 15秒後自動結束本題
  room.questionTimer = setTimeout(() => {
    room.questionTimer = null;
    endQuestion(code);
  }, QUESTION_TIME * 1000 + 500); // 多給500ms緩衝
}

function endQuestion(code) {
  const room = rooms[code];
  if (!room || room.status !== 'playing') return;

  const qIdx = room.currentQuestion - 1;
  const question = room.questions[qIdx];

  // 建立排行榜
  const leaderboard = Object.entries(room.students)
    .map(([id, s]) => ({
      id,
      name: s.name,
      score: s.score,
      answered: !!room.questionAnswers[id],
      isCorrect: room.questionAnswers[id]?.isCorrect || false
    }))
    .sort((a, b) => b.score - a.score);

  // 未答題的學生記錄
  for (const sid of Object.keys(room.students)) {
    if (!room.questionAnswers[sid]) {
      room.students[sid].answers.push({
        questionIdx: qIdx,
        dividend: question.dividend,
        divisor: question.divisor,
        correctQuotient: question.quotient,
        correctRemainder: question.remainder,
        studentQuotient: null,
        studentRemainder: null,
        isCorrect: false,
        points: 0,
        isLucky: false,
        timeSec: null,
        noAnswer: true
      });
    }
  }

  // 通知所有人本題結果
  io.to(code).emit('questionResult', {
    questionNumber: room.currentQuestion,
    dividend: question.dividend,
    divisor: question.divisor,
    correctQuotient: question.quotient,
    correctRemainder: question.remainder,
    leaderboard,
    answers: room.questionAnswers
  });

  // 3秒後發下一題
  setTimeout(() => {
    sendNextQuestion(code);
  }, 4000);
}

function endGame(code) {
  const room = rooms[code];
  if (!room) return;

  room.status = 'ended';

  const finalLeaderboard = Object.entries(room.students)
    .map(([id, s]) => ({
      id,
      name: s.name,
      score: s.score,
      answers: s.answers
    }))
    .sort((a, b) => b.score - a.score);

  io.to(code).emit('gameEnded', {
    leaderboard: finalLeaderboard,
    totalQuestions: TOTAL_QUESTIONS
  });

  console.log(`房間 ${code} 遊戲結束`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`除法對戰遊戲伺服器啟動：http://0.0.0.0:${PORT}`);
});
