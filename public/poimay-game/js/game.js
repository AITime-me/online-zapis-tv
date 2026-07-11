(function () {
  'use strict';

  var GAME_DURATION = 25;
  var SPAWN_INTERVAL = 650;

  var GOOD_ITEMS = [
    { label: 'уход', points: 10 },
    { label: 'массаж', points: 10 },
    { label: 'сияние', points: 10 },
    { label: 'релакс', points: 10 },
    { label: 'увлажнение', points: 10 },
    { label: 'тонус', points: 10 },
    { label: 'час для себя', points: 15 }
  ];

  var BAD_ITEMS = [
    { label: 'стресс', points: -10 },
    { label: 'недосып', points: -10 },
    { label: 'усталость', points: -10 },
    { label: 'отёки', points: -10 },
    { label: 'дедлайн', points: -10 },
    { label: 'запишусь потом', points: -15 },
    { label: 'нет времени', points: -15 }
  ];

  var RESULTS = {
    faceCare: {
      direction: 'Уход для лица',
      explanation: 'В сообщениях студии разберёмся, что сейчас актуальнее для кожи: увлажнение, гладкость, более ровный тон или восстановление — и подскажем, с чего лучше начать.',
      phraseKey: 'уход для лица'
    },
    faceMassage: {
      direction: 'Массаж лица',
      explanation: 'В сообщениях студии разберёмся, что сейчас актуальнее: расслабление, отёчность, тонус или регулярный уход — и подскажем, с чего лучше начать.',
      phraseKey: 'массаж лица'
    },
    recovery: {
      direction: 'Массаж восстановления',
      explanation: 'В сообщениях студии разберёмся, что сейчас просит внимания: шея и плечи, спина, ноги, общее напряжение или ощущение тяжести — и подскажем, с чего лучше начать.',
      phraseKey: 'массаж восстановления'
    },
    toneCare: {
      direction: 'Уход для тонуса кожи',
      explanation: 'В сообщениях студии разберёмся, что сейчас актуальнее для кожи: тонус, гладкость, плотность, увлажнение или более ровная текстура — и подскажем, с чего лучше начать.',
      phraseKey: 'уход для тонуса кожи'
    }
  };

  var canvas, ctx, timerEl, scoreEl, popupEl;
  var canvasAbortController = null;
  var animationId = null;
  var lastSpawn = 0;
  var lastFrame = 0;
  var timeLeft = GAME_DURATION;
  var score = 0;
  var catches = { good: {}, bad: {} };
  var items = [];
  var player = { x: 0, y: 0, width: 72, height: 56 };
  var gameWidth = 0;
  var gameHeight = 0;
  var running = false;
  var onComplete = null;

  function init() {
    if (canvasAbortController) {
      canvasAbortController.abort();
    }
    canvasAbortController = new AbortController();
    var signal = canvasAbortController.signal;

    canvas = document.getElementById('game-canvas');
    if (!canvas) {
      throw new Error('game-canvas not found');
    }

    ctx = canvas.getContext('2d');
    timerEl = document.getElementById('game-timer');
    scoreEl = document.getElementById('game-score');
    popupEl = document.getElementById('score-popup');

    if (!ctx || !timerEl || !scoreEl || !popupEl) {
      throw new Error('game HUD elements not found');
    }

    canvas.addEventListener('touchstart', onTouch, { passive: false, signal: signal });
    canvas.addEventListener('touchmove', onTouch, { passive: false, signal: signal });
    canvas.addEventListener('mousemove', onMouseMove, { signal: signal });
  }

  function destroy() {
    stop();
    if (canvasAbortController) {
      canvasAbortController.abort();
      canvasAbortController = null;
    }
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    gameWidth = rect.width;
    gameHeight = rect.height;
    canvas.width = gameWidth * dpr;
    canvas.height = gameHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.y = gameHeight - player.height - 24;
    if (player.x === 0) {
      player.x = gameWidth / 2 - player.width / 2;
    }
  }

  function resetState() {
    timeLeft = GAME_DURATION;
    score = 0;
    catches = { good: {}, bad: {} };
    items = [];
    lastSpawn = 0;
    lastFrame = 0;
    timerEl.textContent = GAME_DURATION;
    scoreEl.textContent = '0';
  }

  function start(callback) {
    onComplete = callback;
    resetState();
    resize();
    running = true;
    animationId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function onTouch(e) {
    e.preventDefault();
    var touch = e.touches[0];
    movePlayer(touch.clientX);
  }

  function onMouseMove(e) {
    if (!running) return;
    movePlayer(e.clientX);
  }

  function movePlayer(clientX) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left - player.width / 2;
    player.x = Math.max(8, Math.min(gameWidth - player.width - 8, x));
  }

  function spawnItem(now) {
    var isGood = Math.random() < 0.62;
    var pool = isGood ? GOOD_ITEMS : BAD_ITEMS;
    var item = pool[Math.floor(Math.random() * pool.length)];
    var fontSize = item.label.length > 12 ? 11 : 13;

    items.push({
      label: item.label,
      points: item.points,
      isGood: isGood,
      x: 16 + Math.random() * (gameWidth - 120),
      y: -40,
      width: Math.max(80, item.label.length * 8 + 24),
      height: 32,
      speed: 64 + Math.random() * 40,
      fontSize: fontSize
    });
    lastSpawn = now;
  }

  function showPopup(text, isNegative) {
    popupEl.textContent = text;
    popupEl.classList.remove('score-popup--show', 'score-popup--negative');
    if (isNegative) popupEl.classList.add('score-popup--negative');
    void popupEl.offsetWidth;
    popupEl.classList.add('score-popup--show');
    popupEl.setAttribute('aria-hidden', 'false');

    setTimeout(function () {
      popupEl.classList.remove('score-popup--show');
      popupEl.setAttribute('aria-hidden', 'true');
    }, 450);
  }

  function recordCatch(item) {
    var bucket = item.isGood ? catches.good : catches.bad;
    bucket[item.label] = (bucket[item.label] || 0) + 1;
    score += item.points;
    scoreEl.textContent = score;
    showPopup(item.points > 0 ? '+' + item.points : String(item.points), item.points < 0);
  }

  function checkCollision(item) {
    var px = player.x;
    var py = player.y;
    return (
      item.x < px + player.width &&
      item.x + item.width > px &&
      item.y + item.height > py &&
      item.y < py + player.height
    );
  }

  function drawHourglass(x, y, w, h) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);

    ctx.fillStyle = 'rgba(198, 161, 90, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2 + 4, h / 2 + 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#123B2D';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#E8DCC7';

    ctx.beginPath();
    ctx.moveTo(-w * 0.28, -h * 0.38);
    ctx.lineTo(w * 0.28, -h * 0.38);
    ctx.lineTo(0, 0);
    ctx.lineTo(-w * 0.28, h * 0.38);
    ctx.lineTo(w * 0.28, h * 0.38);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#C6A15A';
    ctx.beginPath();
    ctx.moveTo(-w * 0.12, -h * 0.05);
    ctx.lineTo(w * 0.12, -h * 0.05);
    ctx.lineTo(0, h * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawItem(item) {
    ctx.save();
    ctx.font = '600 ' + item.fontSize + 'px Manrope, sans-serif';
    var textWidth = ctx.measureText(item.label).width;
    var padX = 12;
    var boxW = textWidth + padX * 2;
    item.width = boxW;

    if (item.isGood) {
      ctx.fillStyle = 'rgba(244, 239, 230, 0.95)';
      ctx.strokeStyle = 'rgba(18, 59, 45, 0.35)';
    } else {
      ctx.fillStyle = 'rgba(232, 220, 199, 0.92)';
      ctx.strokeStyle = 'rgba(169, 130, 59, 0.45)';
    }

    ctx.lineWidth = 1.5;
    roundRect(ctx, item.x, item.y, boxW, item.height, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = item.isGood ? '#123B2D' : '#827466';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, item.x + boxW / 2, item.y + item.height / 2);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawBackground() {
    var grad = ctx.createLinearGradient(0, 0, 0, gameHeight);
    grad.addColorStop(0, '#F7F7F2');
    grad.addColorStop(0.6, '#E8DCC7');
    grad.addColorStop(1, '#D6C09A');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, gameWidth, gameHeight);

    ctx.fillStyle = 'rgba(198, 161, 90, 0.08)';
    for (var i = 0; i < 5; i++) {
      var sx = (gameWidth / 5) * i + 20;
      ctx.beginPath();
      ctx.arc(sx, gameHeight * 0.3 + i * 15, 30 + i * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop(timestamp) {
    if (!running) return;

    if (!lastFrame) lastFrame = timestamp;
    var delta = (timestamp - lastFrame) / 1000;
    lastFrame = timestamp;

    if (lastSpawn === 0) lastSpawn = timestamp;
    if (timestamp - lastSpawn >= SPAWN_INTERVAL) {
      spawnItem(timestamp);
    }

    timeLeft -= delta;
    if (timeLeft <= 0) {
      timeLeft = 0;
      timerEl.textContent = '0';
      stop();
      if (onComplete) {
        onComplete(getResult());
      }
      return;
    }

    timerEl.textContent = Math.ceil(timeLeft);

    drawBackground();

    for (var i = items.length - 1; i >= 0; i--) {
      var item = items[i];
      item.y += item.speed * delta;

      if (checkCollision(item)) {
        recordCatch(item);
        items.splice(i, 1);
        continue;
      }

      if (item.y > gameHeight + 20) {
        items.splice(i, 1);
        continue;
      }

      drawItem(item);
    }

    drawHourglass(player.x, player.y, player.width, player.height);

    animationId = requestAnimationFrame(loop);
  }

  function countCatches(obj) {
    return Object.values(obj).reduce(function (sum, n) { return sum + n; }, 0);
  }

  function getResult() {
    var g = catches.good;
    var b = catches.bad;
    var negativeCount = countCatches(b);
    var totalGood = countCatches(g);
    var LOW_GOOD_THRESHOLD = 4;

    // faceCare: уход, сияние, увлажнение
    var faceCareScore = (g['уход'] || 0) + (g['сияние'] || 0) + (g['увлажнение'] || 0);

    // faceMassage: массаж, уход, тонус
    var faceMassageScore = (g['массаж'] || 0) + (g['уход'] || 0) + (g['тонус'] || 0);

    // toneCare: сияние, увлажнение, тонус, уход
    var toneCareScore =
      (g['сияние'] || 0) + (g['увлажнение'] || 0) + (g['тонус'] || 0) + (g['уход'] || 0);

    // recovery: релакс, час для себя + усталость, стресс, недосып (ограниченный вклад bad)
    var badRecoveryContribution = Math.min(
      2,
      (b['усталость'] || 0) * 0.4 + (b['стресс'] || 0) * 0.4 + (b['недосып'] || 0) * 0.4
    );
    var recoveryScore =
      (g['релакс'] || 0) +
      (g['час для себя'] || 0) * 1.2 +
      badRecoveryContribution;

    if (score >= 70) {
      toneCareScore += 2;
    } else if (score >= 35 && score < 70) {
      faceCareScore += 1.5;
    }

    // Бонус recovery только при выраженном негативе (не от 1–2 случайных bad)
    var recoveryAdjusted = recoveryScore;
    if (negativeCount >= 5 && totalGood <= LOW_GOOD_THRESHOLD) {
      recoveryAdjusted = recoveryScore * 1.1;
    } else if (negativeCount === 4) {
      recoveryAdjusted = recoveryScore * 1.05;
    }

    var scores = [
      { key: 'faceCare', value: faceCareScore },
      { key: 'faceMassage', value: faceMassageScore },
      { key: 'recovery', value: recoveryAdjusted },
      { key: 'toneCare', value: toneCareScore }
    ];

    scores.sort(function (a, b) { return b.value - a.value; });

    var forcedRecovery =
      (negativeCount >= 5 && totalGood <= LOW_GOOD_THRESHOLD + 2) ||
      (negativeCount >= 3 && totalGood <= LOW_GOOD_THRESHOLD);

    var chosenKey;
    if (forcedRecovery) {
      chosenKey = 'recovery';
    } else if (totalGood === 0 && negativeCount === 0) {
      chosenKey = 'faceCare';
    } else {
      chosenKey = scores[0].key;
    }

    return buildResult(chosenKey);
  }

  function buildResult(key) {
    var data = RESULTS[key];
    return {
      key: key,
      direction: data.direction,
      explanation: data.explanation,
      phrase: 'Игра: ' + data.phraseKey + ' + подарок уход для рук',
      score: score,
      catches: JSON.parse(JSON.stringify(catches))
    };
  }

  window.Game = {
    init: init,
    start: start,
    stop: stop,
    resize: resize,
    destroy: destroy
  };
})();
