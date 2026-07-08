(function () {
  'use strict';

  var canvas, ctx, particles, rafId, running;
  var COLORS = ['#08281F', '#123B2D', '#C6A15A', '#A9823B', '#D6C09A', '#E8DCC7', '#F4EFE6'];
  var SHAPES = ['rect', 'rect', 'rect', 'circle', 'heart'];

  function initCanvas() {
    canvas = document.getElementById('confetti-canvas');
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    resize();
    return true;
  }

  function resize() {
    if (!canvas || !canvas.parentElement) return;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function createParticle(w, h) {
    return {
      x: Math.random() * w,
      y: -12 - Math.random() * h * 0.25,
      w: 4 + Math.random() * 5,
      h: 5 + Math.random() * 7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - 0.5) * 2.2,
      vy: 1.8 + Math.random() * 2.8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.12,
      opacity: 0.65 + Math.random() * 0.35,
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)]
    };
  }

  function drawHeart(x, y, size, rot, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    var s = size * 0.45;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(0, 0, -s, 0, -s, s * 0.35);
    ctx.bezierCurveTo(-s, s * 0.75, 0, s, 0, s * 1.25);
    ctx.bezierCurveTo(0, s, s, s * 0.75, s, s * 0.35);
    ctx.bezierCurveTo(s, 0, 0, 0, 0, s * 0.35);
    ctx.fill();
    ctx.restore();
  }

  function drawParticle(p) {
    ctx.save();
    ctx.globalAlpha = p.opacity;

    if (p.shape === 'heart') {
      drawHeart(p.x, p.y, p.w, p.rot, p.color, p.opacity);
    } else if (p.shape === 'circle') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.w * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }

    ctx.restore();
  }

  function burst() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    if (!initCanvas()) return;
    stop();

    var w = canvas.width;
    var h = canvas.height;
    var count = Math.min(50, Math.max(28, Math.floor(w / 7)));
    particles = [];

    for (var i = 0; i < count; i++) {
      particles.push(createParticle(w, h));
    }

    running = true;
    var start = performance.now();
    var duration = 3000;

    function frame(now) {
      if (!running) return;

      ctx.clearRect(0, 0, w, h);
      var elapsed = now - start;
      var fadeStart = duration * 0.5;

      for (var j = particles.length - 1; j >= 0; j--) {
        var p = particles[j];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.rot += p.vr;

        if (elapsed > fadeStart) {
          p.opacity -= 0.016;
        }

        if (p.opacity <= 0 || p.y > h + 24) {
          particles.splice(j, 1);
          continue;
        }

        drawParticle(p);
      }

      if (elapsed < duration && particles.length > 0) {
        rafId = requestAnimationFrame(frame);
      } else {
        stop();
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    particles = [];
  }

  window.Confetti = {
    burst: burst,
    stop: stop,
    resize: resize
  };
})();
