// teacher.js - 老師端 Socket.io 邏輯

const socket = io();

let roomCode = null;
let totalStudents = 0;
let currentQuestion = 0;
let totalQuestions = 15;
let timerInterval = null;
let timerSeconds = 0;
let questionStartTime = null;

// ===== DOM 元素 =====
const screens = {
  create: document.getElementById('screen-create'),
  waiting: document.getElementById('screen-waiting'),
  playing: document.getElementById('screen-playing'),
  result: document.getElementById('screen-result'),
  ended: document.getElementById('screen-ended')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

// ===== 建立房間 =====
document.getElementById('btn-create-room').addEventListener('click', () => {
  document.getElementById('btn-create-room').disabled = true;
  document.getElementById('btn-create-room').textContent = '建立中...';
  socket.emit('createRoom', (res) => {
    if (res.success) {
      roomCode = res.roomCode;
      document.getElementById('room-code-text').textContent = roomCode;
      showScreen('waiting');
    } else {
      document.getElementById('btn-create-room').disabled = false;
      document.getElementById('btn-create-room').textContent = '🏠 建立新房間';
      alert('建立房間失敗，請重試');
    }
  });
});

// ===== 開始遊戲 =====
document.getElementById('btn-start-game').addEventListener('click', () => {
  if (totalStudents === 0) {
    showAlert('alert-area', '還沒有學生加入！', 'error');
    return;
  }
  socket.emit('startGame', (res) => {
    if (!res.success) {
      showAlert('alert-area', res.error || '無法開始遊戲', 'error');
    }
  });
});

// ===== 重新開始 =====
document.getElementById('btn-restart').addEventListener('click', () => {
  socket.emit('restartGame', (res) => {
    if (res.success) {
      resetGameState();
      showScreen('waiting');
    } else {
      alert(res.error || '重新開始失敗');
    }
  });
});

// ===== 返回首頁 =====
document.getElementById('btn-back-home').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// ===== 接收事件：學生加入 =====
socket.on('studentJoined', ({ studentId, name, studentList }) => {
  totalStudents = studentList.length;
  renderStudentList(studentList);
  document.getElementById('student-count').textContent = totalStudents;
  document.getElementById('btn-start-game').disabled = totalStudents === 0;
  showAlert('alert-area', `✅ ${name} 加入了！`, 'success');
  setTimeout(() => clearAlert('alert-area'), 2000);
});

// ===== 接收事件：學生離開 =====
socket.on('studentLeft', ({ studentId, name, studentList }) => {
  totalStudents = studentList.length;
  renderStudentList(studentList);
  document.getElementById('student-count').textContent = totalStudents;
  document.getElementById('btn-start-game').disabled = totalStudents === 0;
  showAlert('alert-area', `❌ ${name} 離開了`, 'error');
  setTimeout(() => clearAlert('alert-area'), 2000);
});

// ===== 接收事件：遊戲開始中（倒數後發題） =====
socket.on('gameStarting', ({ totalQuestions: tq }) => {
  totalQuestions = tq;
  showScreen('playing');
});

// ===== 接收事件：新題目開始（老師版含答案） =====
socket.on('questionStarted', ({ questionNumber, totalQuestions: tq, dividend, divisor, quotient, remainder, timeLimit, totalStudents: ts }) => {
  currentQuestion = questionNumber;
  totalStudents = ts;

  document.getElementById('q-current').textContent = `${questionNumber}/${tq}`;
  document.getElementById('q-number-label').textContent = `第 ${questionNumber} 題 / 共 ${tq} 題`;
  document.getElementById('q-text').textContent = `${dividend} ÷ ${divisor} = ？`;
  document.getElementById('q-answer').textContent = `✅ 答案：商 = ${quotient}，餘 = ${remainder}`;
  document.getElementById('q-answered').textContent = `0/${ts}`;
  document.getElementById('progress-count').textContent = `0/${ts}`;

  // 清空答題網格
  const grid = document.getElementById('answer-grid');
  grid.innerHTML = '';

  // 取得所有學生並初始化為等待中
  // 從排行榜資料建立格子（等待 studentAnswered 更新）
  // 先顯示 playing 畫面
  showScreen('playing');

  // 初始化格子（在 questionStarted 後學生列表會由 answer grid 管理）
  // 重置計時器
  startTimer(timeLimit);
  questionStartTime = Date.now();
});

// ===== 接收事件：有學生答題 =====
socket.on('studentAnswered', ({ studentId, name, isCorrect, points, timeSec, answeredCount, totalCount }) => {
  document.getElementById('q-answered').textContent = `${answeredCount}/${totalCount}`;
  document.getElementById('progress-count').textContent = `${answeredCount}/${totalCount}`;

  // 更新答題格子
  const grid = document.getElementById('answer-grid');
  let item = document.getElementById(`answer-${studentId}`);

  if (!item) {
    item = document.createElement('div');
    item.id = `answer-${studentId}`;
    item.className = 'answer-item';
    grid.appendChild(item);
  }

  if (isCorrect) {
    item.className = 'answer-item correct';
    item.innerHTML = `✅ ${name}`;
  } else {
    item.className = 'answer-item wrong';
    item.innerHTML = `❌ ${name}`;
  }
});

// ===== 接收事件：本題結果 =====
socket.on('questionResult', ({ questionNumber, dividend, divisor, correctQuotient, correctRemainder, leaderboard, answers }) => {
  stopTimer();

  // 更新未答的學生格子
  const grid = document.getElementById('answer-grid');
  leaderboard.forEach(student => {
    let item = document.getElementById(`answer-${student.id}`);
    if (!item) {
      item = document.createElement('div');
      item.id = `answer-${student.id}`;
      item.className = 'answer-item pending';
      item.innerHTML = `⏳ ${student.name}`;
      grid.appendChild(item);
    }
    if (!answers[student.id]) {
      item.className = 'answer-item pending';
      item.innerHTML = `⏳ ${student.name}`;
    }
  });

  // 等一下再顯示排行榜
  setTimeout(() => {
    document.getElementById('result-q-text').textContent = `${dividend} ÷ ${divisor} = ？`;
    document.getElementById('result-q-answer').textContent = `✅ 商 = ${correctQuotient}，餘 = ${correctRemainder}`;
    renderLeaderboard('teacher-leaderboard', leaderboard);
    showScreen('result');
  }, 1000);
});

// ===== 接收事件：遊戲結束 =====
socket.on('gameEnded', ({ leaderboard, totalQuestions: tq }) => {
  stopTimer();
  renderLeaderboard('final-leaderboard', leaderboard);
  renderReportTable(leaderboard, tq);
  showScreen('ended');
  launchConfetti();
});

// ===== 接收事件：遊戲重置 =====
socket.on('gameRestarted', ({ studentList }) => {
  resetGameState();
  totalStudents = studentList.length;
  renderStudentList(studentList);
  document.getElementById('student-count').textContent = totalStudents;
  document.getElementById('btn-start-game').disabled = totalStudents === 0;
  showScreen('waiting');
});

// ===== 計時器 =====
function startTimer(seconds) {
  stopTimer();
  timerSeconds = seconds;
  updateTimerDisplay(seconds, seconds);

  timerInterval = setInterval(() => {
    timerSeconds--;
    updateTimerDisplay(timerSeconds, seconds);
    if (timerSeconds <= 0) {
      stopTimer();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay(remaining, total) {
  const bar = document.getElementById('teacher-timer-bar');
  const text = document.getElementById('q-timer');
  const pct = Math.max(0, (remaining / total) * 100);

  bar.style.width = pct + '%';
  text.textContent = Math.max(0, remaining);

  if (remaining <= 5) {
    bar.classList.add('warning');
    text.style.color = 'var(--danger)';
  } else {
    bar.classList.remove('warning');
    text.style.color = '';
  }
}

// ===== 渲染學生列表 =====
function renderStudentList(studentList) {
  const ul = document.getElementById('student-list');
  if (studentList.length === 0) {
    ul.innerHTML = '<li class="student-item" style="color: var(--text-light); justify-content: center;">等待學生加入...</li>';
    return;
  }
  ul.innerHTML = studentList.map(s => `
    <li class="student-item">
      <div class="student-avatar">${s.name[0]}</div>
      <span>${s.name}</span>
    </li>
  `).join('');
}

// ===== 渲染排行榜 =====
function renderLeaderboard(elementId, leaderboard) {
  const ul = document.getElementById(elementId);
  ul.innerHTML = leaderboard.map((s, i) => `
    <li class="leaderboard-item rank-${i+1 <= 3 ? i+1 : 'other'}">
      <div class="rank-badge">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i+1}</div>
      <span class="leaderboard-name">${escapeHtml(s.name)}</span>
      <span class="leaderboard-score">${s.score} 分</span>
    </li>
  `).join('');
}

// ===== 渲染成績報表 =====
function renderReportTable(leaderboard, tq) {
  const thead = document.getElementById('report-thead');
  const tbody = document.getElementById('report-tbody');

  // 表頭
  let headHtml = '<tr><th>名次</th><th>姓名</th><th>總分</th>';
  for (let i = 1; i <= tq; i++) {
    headHtml += `<th>第${i}題</th>`;
  }
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  // 表格內容
  tbody.innerHTML = leaderboard.map((student, rank) => {
    let row = `<tr>
      <td>${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank+1}</td>
      <td style="font-weight:bold;">${escapeHtml(student.name)}</td>
      <td style="font-weight:bold; color: var(--primary);">${student.score}</td>`;

    for (let i = 0; i < tq; i++) {
      const ans = student.answers ? student.answers.find(a => a.questionIdx === i) : null;
      if (!ans || ans.noAnswer) {
        row += `<td class="cell-no-answer">⏳</td>`;
      } else if (ans.isCorrect) {
        if (ans.isLucky) {
          row += `<td class="cell-lucky" title="${ans.timeSec}秒">⭐×2</td>`;
        } else {
          row += `<td class="cell-correct" title="${ans.timeSec}秒">✅</td>`;
        }
      } else {
        row += `<td class="cell-wrong" title="${ans.timeSec}秒">❌</td>`;
      }
    }

    row += '</tr>';
    return row;
  }).join('');
}

// ===== 重置狀態 =====
function resetGameState() {
  currentQuestion = 0;
  stopTimer();
}

// ===== 工具函式 =====
function showAlert(containerId, msg, type) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function clearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '50';
  container.style.overflow = 'hidden';
  document.body.appendChild(container);

  const colors = ['#7c3aed', '#f59e0b', '#16a34a', '#dc2626', '#3b82f6', '#ec4899'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 10 + 6) + 'px';
    piece.style.height = (Math.random() * 10 + 6) + 'px';
    piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
    piece.style.animationDelay = Math.random() * 2 + 's';
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 5000);
}
