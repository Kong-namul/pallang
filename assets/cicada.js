/* ============================================================
   매미 그리기 도우미 — examples/cicada/*.html 이 같이 씀
   window.CI = { drawCicada, drawShell, paintTrunkScene, loop, ...도우미 }

   보는 방향: 나무줄기를 정면에서 봄 = 매미 등 쪽 (탑뷰와 같은 구도)
   좌표: 원점 = 가슴, 머리가 +x 방향, 몸 길이 약 60
   ============================================================ */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  // 색: 갓 나온 매미(연두빛 흰색) → 다 자란 매미(검은 갈색 + 초록 무늬)
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixRgb = (a, b, t, alpha = 1) => {
    const A = hexRgb(a), B = hexRgb(b);
    return `rgba(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))},${alpha})`;
  };
  const PALE = { body: '#d3e6c6', mark: '#eef6e4', eye: '#d69a8e', leg: '#c9ddbb', vein: '#b9d2bd' };
  const ADULT = { body: '#2d2b22', mark: '#76994a', eye: '#5c4832', leg: '#3b3527', vein: '#3a4a2c' };

  // 날개 한 장 (원점 = 날개 뿌리, +x 방향으로 뻗음, 바깥 가장자리 = -y)
  function wingPath(c, len, wid) {
    c.beginPath();
    c.moveTo(0, -1);
    c.bezierCurveTo(len * 0.26, -wid * 0.42, len * 0.66, -wid * 0.5, len, -wid * 0.22);
    c.bezierCurveTo(len * 1.06, -wid * 0.05, len * 1.04, wid * 0.24, len * 0.95, wid * 0.38);
    c.bezierCurveTo(len * 0.66, wid * 0.7, len * 0.3, wid * 0.62, 0, wid * 0.24);
    c.closePath();
  }
  function wingVeins(c, len, wid) {
    c.beginPath();
    c.moveTo(0, -1); c.bezierCurveTo(len * 0.26, -wid * 0.42, len * 0.66, -wid * 0.5, len, -wid * 0.22);   // 앞 가장자리 굵은 맥
    c.moveTo(len * 0.05, 0); c.lineTo(len * 0.42, -wid * 0.12); c.lineTo(len * 0.62, -wid * 0.38);
    c.moveTo(len * 0.42, -wid * 0.12); c.lineTo(len * 0.62, wid * 0.08); c.lineTo(len * 0.94, wid * 0.12);
    c.moveTo(len * 0.62, wid * 0.08); c.lineTo(len * 0.7, wid * 0.5);
    for (let i = 0; i < 6; i++) {   // 날개 끝 쪽 칸
      const t = 0.66 + i * 0.06;
      c.moveTo(len * t, -wid * (0.46 - i * 0.03)); c.lineTo(len * (t + 0.03), wid * (0.35 - i * 0.02));
    }
    c.stroke();
  }

  /**
   * p.open     0~1 날개 펼침 (0 = 지붕처럼 접음, 1 = 비행 자세)
   * p.flap     비행 중 날갯짓 위상(라디안), p.blur 0~1 이면 날개 잔상
   * p.pulse    0~1 울 때 배 떨림
   * p.legs     0 = 껍질·나무를 움켜쥠, 1 = 몸에 붙임(비행 중)
   * p.walk     걸을 때 다리 위상
   * p.age      0 = 갓 나온 흰 몸, 1 = 다 자란 색
   * p.wingSize 0.25~1 날개 크기 (허물 벗은 직후엔 쭈글쭈글 작음)
   */
  function drawCicada(c, p) {
    const age = p.age ?? 1, ws = p.wingSize ?? 1, open = p.open || 0, tuck = p.legs || 0;
    const body = mixRgb(PALE.body, ADULT.body, age), mark = mixRgb(PALE.mark, ADULT.mark, age);
    const leg = mixRgb(PALE.leg, ADULT.leg, age), vein = mixRgb(PALE.vein, ADULT.vein, age, lerp(0.9, 0.75, age));
    const wingFill = `rgba(${Math.round(lerp(244, 220, age))},${Math.round(lerp(250, 238, age))},${Math.round(lerp(242, 228, age))},${lerp(0.82, 0.24, age)})`;
    c.lineCap = 'round'; c.lineJoin = 'round';

    // 다리: 삼각 보행 (L1·R2·L3 ↔ R1·L2·R3)
    const LEGS = [[10, 6, 17, 13, 22, 14], [2, 7, 3, 15, -1, 18], [-5, 7, -8, 15, -13, 19]];
    const k = 1 - tuck * 0.6;
    LEGS.forEach((L, i) => {
      for (const s of [-1, 1]) {
        const ph = ((i + (s > 0 ? 1 : 0)) % 2) * Math.PI;
        const step = p.walk != null ? Math.sin(p.walk + ph) * 2.4 : 0;
        c.strokeStyle = leg; c.lineWidth = i === 0 ? 2.3 : 1.6;
        c.beginPath(); c.moveTo(L[0], L[1] * s);
        c.lineTo(L[2] + step * 0.5 - tuck * 3, L[3] * s * k);
        c.lineTo(L[4] + step - tuck * 6, L[5] * s * k);
        c.stroke();
      }
    });

    // 배 (날개 밑으로 비쳐 보임)
    const pr = 1 + 0.035 * (p.pulse || 0);
    c.fillStyle = body;
    c.beginPath(); c.ellipse(-15, 0, 15 * pr, 9 * (1 + 0.02 * (p.pulse || 0)), 0, 0, TAU); c.fill();
    c.strokeStyle = mark; c.lineWidth = 0.9; c.globalAlpha = 0.55 + 0.35 * (p.pulse || 0);
    for (let i = 0; i < 5; i++) { const x = -6 - i * 4.4; c.beginPath(); c.ellipse(x, 0, 1.6, 7.5 - i * 0.9, 0, -1.3, 1.3); c.stroke(); }
    c.globalAlpha = 1;

    // 날개: 뒷날개 → 앞날개. blur 면 위상이 다른 잔상을 겹쳐 그림
    const layers = p.blur ? [[0, 0.55], [2.4, 0.4], [4.2, 0.3]] : [[0, 1]];
    for (const [dph, alpha] of layers) {
      const swing = p.blur ? Math.sin((p.flap || 0) + dph) * 0.55 * p.blur : 0;
      for (const s of [-1, 1]) {
        for (const fore of [false, true]) {
          const spread = fore ? lerp(0.2, 1.35, open) + swing : lerp(0.32, 1.6, open) + swing * 0.8;
          const len = (fore ? 46 : 27) * ws, wid = (fore ? 14 : 11) * ws;
          c.save();
          c.translate(fore ? 2 : -1, (fore ? 4.5 : 4) * s);
          c.rotate(s * (Math.PI - spread));
          c.scale(1, s);
          c.globalAlpha = alpha;
          c.fillStyle = wingFill; wingPath(c, len, wid); c.fill();
          c.strokeStyle = vein; c.lineWidth = fore ? 0.9 : 0.7; wingVeins(c, len, wid);
          if (ws < 0.9) {   // 갓 나온 날개: 쭈글쭈글한 주름
            c.globalAlpha = alpha * (1 - ws) * 1.2; c.beginPath();
            for (let i = 1; i < 5; i++) { c.moveTo(len * i / 5, -wid * 0.4); c.quadraticCurveTo(len * (i / 5 + 0.05), 0, len * i / 5, wid * 0.4); }
            c.stroke();
          }
          c.restore();
        }
      }
    }
    c.globalAlpha = 1;

    // 가운뎃가슴 (W 무늬, 뒤쪽 X 돌기)
    c.fillStyle = body;
    c.beginPath(); c.moveTo(-6, -7); c.quadraticCurveTo(-9, 0, -6, 7); c.lineTo(9, 9.5); c.quadraticCurveTo(13, 0, 9, -9.5); c.closePath(); c.fill();
    c.strokeStyle = mark; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(7, -6); c.lineTo(2, -2.5); c.lineTo(5, 0); c.lineTo(2, 2.5); c.lineTo(7, 6); c.stroke();
    c.beginPath(); c.moveTo(-6, -2.6); c.lineTo(-2.4, 2.6); c.moveTo(-6, 2.6); c.lineTo(-2.4, -2.6); c.stroke();
    // 앞가슴 (넓은 깃)
    c.fillStyle = body;
    c.beginPath(); c.moveTo(9, -10); c.lineTo(9, 10); c.lineTo(16, 11.5); c.quadraticCurveTo(19.5, 0, 16, -11.5); c.closePath(); c.fill();
    c.strokeStyle = mark; c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(16, -11); c.quadraticCurveTo(19, 0, 16, 11); c.stroke();
    // 머리 · 큰 겹눈 · 홑눈
    c.fillStyle = body; c.beginPath(); c.ellipse(20.5, 0, 4, 8.6, 0, 0, TAU); c.fill();
    c.fillStyle = mixRgb(PALE.eye, ADULT.eye, age);
    for (const s of [-1, 1]) { c.beginPath(); c.arc(20, 9.6 * s, 3.1, 0, TAU); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (const s of [-1, 1]) { c.beginPath(); c.arc(20.8, 8.8 * s, 1, 0, TAU); c.fill(); }
    c.fillStyle = mixRgb('#e7b0a6', '#b8492f', age);
    for (const [x, y] of [[21.5, 0], [20.2, -1.7], [20.2, 1.7]]) { c.beginPath(); c.arc(x, y, 0.7, 0, TAU); c.fill(); }
  }

  /** 허물(애벌레 껍질). split 0~1 = 등이 갈라진 정도 */
  function drawShell(c, split) {
    const shell = 'rgba(160,118,64,0.92)', edge = 'rgba(96,66,30,0.9)';
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 움켜쥔 다리 (앞다리는 굵은 갈퀴)
    c.strokeStyle = edge;
    for (const s of [-1, 1]) {
      c.lineWidth = 3; c.beginPath(); c.moveTo(12, 6 * s); c.lineTo(20, 12 * s); c.lineTo(27, 11 * s); c.stroke();
      c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(2, 7 * s); c.lineTo(2, 16 * s); c.lineTo(-3, 19 * s); c.stroke();
      c.beginPath(); c.moveTo(-6, 7 * s); c.lineTo(-10, 16 * s); c.lineTo(-16, 19 * s); c.stroke();
    }
    c.fillStyle = shell; c.strokeStyle = edge; c.lineWidth = 1;
    c.beginPath(); c.ellipse(-12, 0, 18, 10.5, 0, 0, TAU); c.fill(); c.stroke();
    for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(-4 - i * 5, 0, 1.4, 9 - i, 0, -1.3, 1.3); c.stroke(); }
    c.beginPath(); c.ellipse(7, 0, 10, 10.5, 0, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(19, 0, 5, 8, 0, 0, TAU); c.fill(); c.stroke();
    // 날개 싹
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(-2, 8.5 * s, 9, 3, -0.25 * s, 0, TAU); c.fill(); c.stroke(); }
    // 등 갈라짐: 머리 뒤부터 가슴까지 벌어짐
    if (split > 0) {
      const w = split * 4.5, x0 = 18, x1 = lerp(14, -5, Math.min(1, split * 1.3));
      c.fillStyle = 'rgba(40,26,10,0.85)';
      c.beginPath(); c.moveTo(x0, 0); c.quadraticCurveTo((x0 + x1) / 2, -w, x1, 0); c.quadraticCurveTo((x0 + x1) / 2, w, x0, 0); c.fill();
    }
  }

  /** 나무줄기가 가운데 서 있는 배경. 줄기 x 범위를 돌려줌 */
  function paintTrunkScene(g, W, H, S) {
    const cs = getComputedStyle(document.documentElement);
    const top = cs.getPropertyValue('--sky-top').trim(), bot = cs.getPropertyValue('--sky-bot').trim(), leaf = cs.getPropertyValue('--leaf').trim();
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, top); bg.addColorStop(1, bot);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) {   // 뒤쪽 흐린 잎
      const x = rand(0, W), y = rand(0, H), r = rand(40, 110) * S;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, leaf); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.22; g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    const tw = clamp(W * 0.46, 150 * S, W * 0.9);
    const x0 = (W - tw) / 2, x1 = x0 + tw;
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, '#3e2f20'); gr.addColorStop(0.3, '#6b5337'); gr.addColorStop(0.55, '#7a6142'); gr.addColorStop(1, '#33271a');
    g.fillStyle = gr; g.fillRect(x0, 0, tw, H);
    g.lineCap = 'round';
    const n = Math.round((tw * H) / (700 * S));
    for (let i = 0; i < n; i++) {   // 세로 나무껍질 결
      const x = x0 + Math.random() * tw, y = rand(-40, H), len = rand(20, 80) * S;
      g.strokeStyle = Math.random() < 0.62 ? 'rgba(28,18,8,0.38)' : 'rgba(190,160,115,0.16)';
      g.lineWidth = rand(0.8, 2.6) * S;
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + rand(-3, 3) * S, y + len * 0.33, x + rand(-3, 3) * S, y + len * 0.66, x + rand(-2, 2) * S, y + len);
      g.stroke();
    }
    return { x0, x1 };
  }

  /** requestAnimationFrame 루프. fn(dt초) */
  function loop(fn) {
    let last = null;
    function frame(now) {
      const dt = last == null ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now; fn(dt); requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  global.CI = { drawCicada, drawShell, paintTrunkScene, loop, clamp, lerp, rand, easeOut, easeInOut, angDiff, TAU };
})(window);
