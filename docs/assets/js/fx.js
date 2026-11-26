/* Fundo do hero: rede de nós piscando e pacotes de dados correndo pelos fios (clima de painel de vigilância).
 * Leve: poucos nós, pausa fora da tela/aba oculta, congela com "reduzir movimento". */
(function () {
  "use strict";
  var cv = document.getElementById("ipaFx");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var W = 0, H = 0, dpr = 1, nodes = [], packets = [], mouse = { x: -999, y: -999 };
  var running = false, visible = true, last = 0, t0 = performance.now();
  var LINK = 150;
  var RED = "255,59,71";

  function hex() { return "0x" + Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, "0"); }
  function size() {
    var r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.max(22, Math.min(W < 700 ? 34 : 64, Math.round(W * H / 24000)));
    nodes = [];
    for (var i = 0; i < n; i++) {
      nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
        r: 1.3 + Math.random() * 1.6, ph: Math.random() * 6.28, sp: .6 + Math.random() * 1.6,
        tag: Math.random() < .14 ? hex() : null, hot: Math.random() < .18
      });
    }
    packets = [];
  }
  function spawn() {
    if (packets.length > 9) return;
    var a = nodes[(Math.random() * nodes.length) | 0], best = null, bd = 1e9;
    nodes.forEach(function (b) {
      if (b === a) return;
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < LINK && d > 30 && Math.random() < .5 && d < bd) { bd = d; best = b; }
    });
    if (best) packets.push({ a: a, b: best, p: 0, v: .006 + Math.random() * .01 });
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 32) return; // ~30 quadros/s
    last = now;
    var t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    var i, j, a, b, d;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      a.x += a.vx; a.y += a.vy;
      if (a.x < -20) a.x = W + 20; else if (a.x > W + 20) a.x = -20;
      if (a.y < -20) a.y = H + 20; else if (a.y > H + 20) a.y = -20;
    }
    ctx.lineWidth = 1;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j]; d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK) {
          ctx.strokeStyle = "rgba(255,255,255," + ((1 - d / LINK) * .16).toFixed(3) + ")";
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
      if (d < 190) {
        ctx.strokeStyle = "rgba(" + RED + "," + ((1 - d / 190) * .55).toFixed(3) + ")";
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      var pulse = .5 + .5 * Math.sin(t * a.sp + a.ph);
      var on = a.hot ? (Math.sin(t * 2.2 + a.ph) > .55) : false;
      ctx.fillStyle = on ? "rgba(" + RED + ",1)" : "rgba(255,255,255," + (.25 + pulse * .45).toFixed(2) + ")";
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r + (on ? 1.2 : 0), 0, 6.283); ctx.fill();
      if (on) {
        ctx.strokeStyle = "rgba(" + RED + "," + (.6 - ((t * 1.5 + a.ph) % 1) * .6).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(a.x, a.y, 4 + ((t * 1.5 + a.ph) % 1) * 18, 0, 6.283); ctx.stroke();
        if (a.tag) {
          ctx.font = "600 10px 'Inter',sans-serif"; ctx.fillStyle = "rgba(255,255,255,.7)";
          ctx.fillText(a.tag, a.x + 10, a.y - 8);
          ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.strokeRect(a.x - 7, a.y - 7, 14, 14);
        }
      }
    }
    if (Math.random() < .12) spawn();
    for (i = packets.length - 1; i >= 0; i--) {
      var p = packets[i]; p.p += p.v;
      if (p.p >= 1) { packets.splice(i, 1); continue; }
      var x = p.a.x + (p.b.x - p.a.x) * p.p, y = p.a.y + (p.b.y - p.a.y) * p.p;
      ctx.fillStyle = "rgba(" + RED + ",.95)"; ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      ctx.fillStyle = "rgba(" + RED + ",.25)"; ctx.fillRect(x - 6, y - 6, 12, 12);
    }
  }
  function start() { if (running || reduce || !visible || document.hidden) return; running = true; last = 0; requestAnimationFrame(frame); }
  function stop() { running = false; }
  size();
  if (reduce) { // um quadro estático
    ctx.strokeStyle = "rgba(255,255,255,.1)";
    nodes.forEach(function (a, i) { var b = nodes[(i + 1) % nodes.length]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.283); ctx.fill(); });
  }
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(size, 200); });
  cv.parentNode.addEventListener("pointermove", function (e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
  cv.parentNode.addEventListener("pointerleave", function () { mouse.x = mouse.y = -999; });
  if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; visible ? start() : stop(); }).observe(cv);
  document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
  start();
})();
