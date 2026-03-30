// student.js - 學生端 Socket.io 邏輯

const socket = io();

// 狀態
let myName = '';
let myScore = 0;
let currentQ = 0;
let totalQ = 15;
let timerInterval = null;
let timerSeconds = 15;
let answered = false;
let submitted = false;

// 畫面切換
function showScreen(id) {
  document.querySelectorAll('[id^="screen-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// 工具：顯示提示
function showAlert(elId, msg, type = 'error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4000);
}

// 加入遊戲
document.getElementById('btn-join').addEventListener('click', joinGame);
document.getElementById('input-room-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

function joinGame() {
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  const name = document.getElementById('input-name').value.trim();
  if (!code || code.length !== 6) {
    showAlert('join-alert', '請輸入6位房間代碼！');
    return;
  }
  if (!name) {
    showAlert('join-alert', '請輸入你的名字！');
    return;
  }
  myName = name;
  socket.emit('joinRoom', { code, name });
}

// 答題送出
document.getElementById('btn-submit').addEventListener('click', submitAnswer);
document.getElementById('s-quotient').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('s-remainder').focus(); });
document.getElementById('s-remainder').addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(); });

function submitAnswer() {
  if (submitted) return;
  const qVal = document.getElementById('s-quotient').value.trim();
  const rVal = document.getElementById('s-remainder').value.trim();
  if (qVal === '' || rVal === '') {
    return;
  }
  const quotient = parseInt(qVal);
  const remainder = parseInt(rVal);
  if (isNaN(quotient) || isNaN(remainder)) return;

  submitted = true;
  document.getElementById('btn-submit').disabled = true;
  document.getElementById('submitted-msg').classList.remove('hidden');
  socket.emit('submitAnswer', { quotient, remainder });
}

// ======== Socket 事件 ========

// 加入成功
socket.on('joinSuccess', ({ students }) => {
  document.getElementById('waiting-name').textContent = `你好，${myName}！`;
  updateWaitingList(students);
  showScreen('screen-waiting');
});

// 加入失敗
socket.on('joinError', ({ message }) => {
  showAlert('join-alert', message);
});

// 有新同學加入
socket.on('studentJoined', ({ students }) => {
  updateWaitingList(students);
});

// 有同學離開
socket.on('studentLeft', ({ students }) => {
  updateWaitingList(students);
});

function updateWaitingList(students) {
  const ul = document.getElementById('waiting-student-list');
  ul.innerHTML = students.map((s, i) =>
    `<li class="leaderboard-item"><span class="rank">${i + 1}</span><span class="player-name">${s.name}</span></li>`
  ).join('');
}

// 遊戲即將開始（倒數）
socket.on('gameStarting', ({ countdown }) => {
  showScreen('screen-starting');
  let count = countdown;
  document.getElementById('countdown-num').textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(iv);
    } else {
      document.getElementById('countdown-num').textContent = count;
    }
  }, 1000);
});

// 新題目開始
socket.on('newQuestion', ({ questionNum, total, question }) => {
  currentQ = questionNum;
  totalQ = total;
  answered = false;
  submitted = false;

  // 重設畫面
  document.getElementById('s-question-num').textContent = `${questionNum}/${total}`;
  document.getElementById('s-my-score').textContent = myScore;
  document.getElementById('s-question-text').textContent =
    `${question.dividend} ÷ ${question.divisor} = ？`;
  document.getElementById('s-quotient').value = '';
  document.getElementById('s-remainder').value = '';
  document.getElementById('s-quotient').disabled = false;
  document.getElementById('s-remainder').disabled = false;
  document.getElementById('btn-submit').disabled = false;
  document.getElementById('submitted-msg').classList.add('hidden');

  // 計時條
  timerSeconds = 15;
  startTimer();

  showScreen('screen-question');
  document.getElementById('s-quotient').focus();
});

// 計時器
function startTimer() {
  clearInterval(timerInterval);
  const bar = document.getElementById('s-timer-bar');
  const text = document.getElementById('s-timer-text');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.classList.remove('timer-danger');

  let elapsed = 0;
  timerInterval = setInterval(() => {
    elapsed += 0.1;
    const pct = Math.max(0, ((15 - elapsed) / 15) * 100);
    bar.style.transition = 'width 0.1s linear';
    bar.style.width = pct + '%';
    text.textContent = Math.ceil(15 - elapsed);

    if (15 - elapsed <= 5) {
      bar.classList.add('timer-danger');
    }
    if (elapsed >= 15) {
      clearInterval(timerInterval);
      // 時間到：自動鎖定
      document.getElementById('s-quotient').disabled = true;
      document.getElementById('s-remainder').disabled = true;
      document.getElementById('btn-submit').disabled = true;
    }
  }, 100);
}

// 答題回饋（即時）
socket.on('answerFeedback', ({ correct, points, isLucky, newScore }) => {
  clearInterval(timerInterval);
  myScore = newScore;
  document.getElementById('s-my-score').textContent = myScore;

  // 鎖定輸入
  document.getElementById('s-quotient').disabled = true;
  document.getElementById('s-remainder').disabled = true;
  document.getElementById('btn-submit').disabled = true;

  showFeedback(correct, points, isLucky);
});

// 顯示動畫反饋
function showFeedback(correct, points, isLucky) {
  const overlay = document.getElementById('feedback-overlay');
  overlay.classList.remove('hidden', 'feedback-correct', 'feedback-wrong', 'feedback-lucky');

  if (isLucky) {
    overlay.classList.add('feedback-lucky');
    overlay.innerHTML = `<div class="feedback-text">⭐ 幸運雙倍！<br>+${points} 分</div>`;
    showSparkles();
  } else if (correct) {
    overlay.classList.add('feedback-correct');
    overlay.innerHTML = `<div class="feedback-text">✅ 答對了！<br>+${points} 分</div>`;
  } else {
    overlay.classList.add('feedback-wrong');
    overlay.innerHTML = `<div class="feedback-text">❌ 答錯了！<br>${points} 分</div>`;
  }

  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 1800);
}

// 幸運星星特效
function showSparkles() {
  const container = document.getElementById('lucky-sparkles');
  container.innerHTML = '';
  container.classList.remove('hidden');
  for (let i = 0; i < 12; i++) {
    const star = document.createElement('div');
    star.className = 'sparkle';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = (Math.random() * 0.5) + 's';
    star.textContent = ['⭐', '✨', '🌟'][Math.floor(Math.random() * 3)];
    container.appendChild(star);
  }
  setTimeout(() => container.classList.add('hidden'), 2000);
}

// 本題結果（所有人都答完或時間到）
socket.on('questionResult', ({ leaderboard, correctAnswer, myResult }) => {
  clearInterval(timerInterval);

  // 我的本題結果區塊
  const myResultEl = document.getElementById('my-answer-result');
  if (myResult) {
    if (myResult.isLucky) {
      myResultEl.style.background = '#fef3c7';
      myResultEl.innerHTML = `<p style="font-size:1.5rem; font-weight:bold; color:#92400e;">⭐ 幸運雙倍！+${myResult.points}分</p>
        <p style="color:#78350f;">正確答案：${correctAnswer.quotient} 餘 ${correctAnswer.remainder}</p>`;
    } else if (myResult.correct) {
      myResultEl.style.background = '#d1fae5';
      myResultEl.innerHTML = `<p style="font-size:1.5rem; font-weight:bold; color:#065f46;">✅ 答對了！+${myResult.points}分</p>
        <p style="color:#047857;">正確答案：${correctAnswer.quotient} 餘 ${correctAnswer.remainder}</p>`;
    } else if (myResult.answered) {
      myResultEl.style.background = '#fee2e2';
      myResultEl.innerHTML = `<p style="font-size:1.5rem; font-weight:bold; color:#991b1b;">❌ 答錯了！${myResult.points}分</p>
        <p style="color:#b91c1c;">正確答案：${correctAnswer.quotient} 餘 ${correctAnswer.remainder}</p>`;
    } else {
      myResultEl.style.background = '#f3f4f6';
      myResultEl.innerHTML = `<p style="font-size:1.3rem; color:#6b7280;">⏰ 時間到，未作答</p>
        <p style="color:#9ca3af;">正確答案：${correctAnswer.quotient} 餘 ${correctAnswer.remainder}</p>`;
    }
  }

  // 排行榜
  renderLeaderboard('s-leaderboard', leaderboard);
  showScreen('screen-question-result');
});

// 遊戲結束
socket.on('gameEnded', ({ leaderboard }) => {
  clearInterval(timerInterval);

  const myEntry = leaderboard.find(s => s.name === myName);
  const rank = myEntry ? myEntry.rank : '?';
  const score = myEntry ? myEntry.score : myScore;

  document.getElementById('s-final-score').textContent = `${score} 分`;
  document.getElementById('s-final-name').textContent = myName;

  let rankText = '';
  if (rank === 1) rankText = '🥇 第 1 名！太厲害了！';
  else if (rank === 2) rankText = '🥈 第 2 名！非常棒！';
  else if (rank === 3) rankText = '🥉 第 3 名！很好喔！';
  else rankText = `第 ${rank} 名，繼續加油！`;
  document.getElementById('s-final-rank').textContent = rankText;

  renderLeaderboard('s-final-leaderboard', leaderboard);

  // 第一名撒花
  if (rank === 1) showConfetti();

  showScreen('screen-ended');
});

// 房間關閉
socket.on('roomClosed', ({ reason }) => {
  clearInterval(timerInterval);
  document.getElementById('closed-reason').textContent = reason || '老師已離開遊戲';
  showScreen('screen-closed');
});

// 渲染排行榜
function renderLeaderboard(elId, leaderboard) {
  const ul = document.getElementById(elId);
  ul.innerHTML = leaderboard.map((s, i) => {
    const rank = i + 1;
    let badge = rank <= 3
      ? ['🥇', '🥈', '🥉'][rank - 1]
      : `${rank}`;
    let cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    const isSelf = s.name === myName ? 'style="font-weight:bold; background:#ede9fe;"' : '';
    return `<li class="leaderboard-item ${cls}" ${isSelf}>
      <span class="rank">${badge}</span>
      <span class="player-name">${s.name}${s.name === myName ? ' (我)' : ''}</span>
      <span class="player-score">${s.score} 分</span>
    </li>`;
  }).join('');
}

// 撒花特效（第一名）
function showConfetti() {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';
  container.classList.remove('hidden');
  const colors = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6'];
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (Math.random() * 2 + 1.5) + 's';
    piece.style.animationDelay = (Math.random() * 1) + 's';
    container.appendChild(piece);
  }
  setTimeout(() => container.classList.add('hidden'), 4000);
}
