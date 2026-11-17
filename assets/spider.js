/* ============================================================
   거미 모션 키트 — 거미 예제(01~05)가 같이 씀
   window.SP = { Spider, Gait, Web, loop, fitCanvas, theme, ...도우미 }

   Spider : 위에서 본 거미를 캔버스에 그림 (머리가슴·배·더듬이다리·다리 8개)
            다리마다 '발끝 목표'만 주면 2-본 IK로 무릎을 풀어서 그림
            twist(몸 축 회전)를 주면 실에 매달려 빙글 도는 모습도 됨
   Gait   : 발을 바닥에 '심어 두고', 몸이 멀어지면 그 발만 호를 그리며 내딛음
            · 이웃 다리(같은 쪽 앞뒤 + 반대쪽 같은 번호)가 들려 있으면 기다림
              → 따로 박자를 안 줘도 저절로 4+4 교대 걸음이 됨
            · 속도만큼 앞을 예측해서 디딤 · 멈추면 한 발씩 자리 정리
            · override 로 특정 다리만 자세를 덮어쓸 수 있음 (움츠림·위협 자세)
   Web    : 둥근 거미줄 형상(틀·바퀴살·중심부·끈끈이 나선) + 처짐·흔들림·반짝임
            + 퉁기면 퍼져 나가는 진동
   ============================================================ */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOut = (t, p = 2.6) => 1 - Math.pow(1 - clamp(t, 0, 1), p);
  /** 프레임레이트와 무관한 지수 따라가기 계수 */
  const follow = (rate, dt) => 1 - Math.exp(-rate * dt);
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  /** 1D 값 노이즈 (-1~1). 다리가 '살아서' 꼼지락대는 데 씀 */
  function noise(x) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i), hash(i + 1), u) * 2 - 1;
  }

  // 그림자 방향: 빛이 왼쪽 위에서 옴 → 높이 1px 당 그림자가 이만큼 밀림
  const LX = 0.36, LY = 0.62;

  // ---------- 색 ----------
  function parseColor(str, fb) {
    str = (str || '').trim();
    let m;
    if ((m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
      let h = m[1];
      if (h.length === 3) h = h.replace(/./g, (c) => c + c);
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    if ((m = str.match(/rgba?\(([^)]+)\)/i))) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
    }
    return fb || [0, 0, 0, 1];
  }
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /** base.css 토큰을 읽어서 캔버스용 색으로. 다크모드면 거미도 밝은 갈색으로 */
  function theme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, fb) => parseColor(cs.getPropertyValue(n), fb);
    const dark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    return {
      dark,
      ink: v('--ink', [36, 48, 42, 1]),
      muted: v('--muted', [91, 107, 98, 1]),
      shade: v('--shade', [28, 48, 36, 0.26]),
      accent: v('--accent', [217, 99, 30, 1]),
      leaf: v('--leaf', [93, 155, 90, 1]),
      water: v('--water', [188, 219, 224, 1]),
      spider: dark
        ? { dark: [58, 42, 31], body: [116, 88, 64], mid: [156, 122, 88], pattern: [238, 214, 172],
            leg: [104, 80, 58], legLight: [190, 156, 114], eye: [10, 8, 8] }
        : { dark: [30, 21, 16], body: [70, 51, 38], mid: [116, 86, 61], pattern: [228, 198, 152],
            leg: [56, 41, 31], legLight: [148, 114, 82], eye: [8, 6, 6] },
    };
  }
  function onThemeChange(fn) {
    if (!global.matchMedia) return;
    const mq = global.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  }

  // ---------- 캔버스 ----------
  /** 화면 크기·devicePixelRatio 에 맞춰 캔버스를 다시 잡음. view.W/H 는 CSS px */
  function fitCanvas(cv, onResize) {
    const ctx = cv.getContext('2d');
    const view = { cv, ctx, W: 0, H: 0, dpr: 1 };
    function resize() {
      const W = cv.clientWidth || global.innerWidth, H = cv.clientHeight || global.innerHeight;
      const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
      view.W = W; view.H = H; view.dpr = dpr;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (onResize) onResize(view);
    }
    global.addEventListener('resize', resize);
    resize();
    view.resize = resize;
    return view;
  }

  /** requestAnimationFrame 루프. fn(dt초, t초) — 탭 전환 뒤 큰 dt 는 잘라냄 */
  function loop(fn) {
    let last = null;
    function frame(now) {
      const dt = last == null ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      fn(dt, now / 1000);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** 끝으로 갈수록 가늘어지는 마디 (양 끝 둥근 캡) */
  function taper(ctx, A, B, w0, w1) {
    const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1e-6;
    const nx = -dy / d, ny = dx / d, h0 = Math.max(0.35, w0 / 2), h1 = Math.max(0.3, w1 / 2);
    const an = Math.atan2(ny, nx);
    ctx.beginPath();
    ctx.moveTo(A[0] + nx * h0, A[1] + ny * h0);
    ctx.lineTo(B[0] + nx * h1, B[1] + ny * h1);
    ctx.arc(B[0], B[1], h1, an, an + Math.PI, true);
    ctx.lineTo(A[0] - nx * h0, A[1] - ny * h0);
    ctx.arc(A[0], A[1], h0, an + Math.PI, an, true);
    ctx.closePath();
    ctx.fill();
  }

  /** 앞·뒤 끝점과 두께로 화면 위 타원 구하기 (몸 축 회전 반영) */
  function ell(F, B, ry, rz, c, sn) {
    return {
      x: (F[0] + B[0]) / 2, y: (F[1] + B[1]) / 2,
      rx: Math.max(0.5, Math.hypot(F[0] - B[0], F[1] - B[1]) / 2),
      ry: Math.max(0.5, Math.hypot(ry * c, rz * sn)),
      ang: Math.atan2(F[1] - B[1], F[0] - B[0]),
    };
  }

  let LAYER = null;
  function layer(px) {
    if (!LAYER) { const cv = document.createElement('canvas'); LAYER = { cv, g: cv.getContext('2d') }; }
    if (LAYER.cv.width < px) { LAYER.cv.width = px; LAYER.cv.height = px; }
    return LAYER;
  }

  // ============================================================
  //  Spider
  //  로컬 좌표: +x = 머리 방향, +y = 오른쪽, +z = 등 쪽(위). 단위 = size(px)
  // ============================================================
  const PAIRS = [ // hip: 머리가슴 가장자리 각도, dir: 쉴 때 뻗는 방향, len: 다리 길이(몸 단위)
    { hip: 40, dir: 32, len: 2.1 },
    { hip: 74, dir: 72, len: 1.8 },
    { hip: 108, dir: 113, len: 1.62 },
    { hip: 140, dir: 152, len: 1.95 },
  ];
  const CEPH = { x: 0.06, rx: 0.36, ry: 0.3, rz: 0.2 };
  const PED = -0.28;                         // 배자루(머리가슴과 배 사이)
  const ABD = { d: 0.6, rx: 0.62, ry: 0.47, rz: 0.4 };
  const ABD_TIP = -(0.28 + 0.6 + 0.62);      // 실젖(배 끝) 위치 = -1.5
  const EYES = [[0.37, 0.045, 0.05], [0.345, 0.118, 0.032], [0.3, 0.068, 0.034], [0.284, 0.152, 0.03]];

  class Spider {
    constructor(o = {}) {
      Object.assign(this, {
        x: 0, y: 0, heading: 0, size: 16,
        twist: 0,          // 몸 축(앞뒤) 둘레 회전. 0 = 등이 보임, π = 배가 보임
        alt: 0.55,         // 바닥(벽)에서 떨어진 높이 (size 단위) → 그림자 거리
        shadow: true, shadowAlpha: 1, alpha: 1,
        reach: 0.62,       // 쉴 때 다리를 얼마나 펴는지 (다리 길이 대비)
        theme: null,
      }, o);
      this.abdA = 0; this.abdV = 0;   // 배 흔들림 (회전 반대쪽으로 늦게 따라옴)
      this.abdPush = 0;               // 배를 뒤로 내밀기(px) — 실 붙일 때
      this.breath = rand(0, TAU);
      this.palpGain = 1;              // 더듬이다리 까딱 빈도
      this.palpRaise = 0;             // 0~1, 더듬이다리 치켜들기 (위협)
      this.palps = [-1, 1].map((side) => ({ side, a: 0, goal: 0, t: rand(0.2, 1.5) }));
      this.legs = [];
      for (let p = 0; p < 4; p++) for (const side of [-1, 1]) {
        const P = PAIRS[p], h = P.hip * DEG;
        this.legs.push({
          pair: p, side, len: P.len, dir: P.dir * DEG,
          hx: CEPH.x + 0.27 * Math.cos(h), hy: side * 0.23 * Math.sin(h),
          a: P.len * 0.47, b: P.len * 0.53,
          sign: side * (p < 2 ? 1 : -1),   // 무릎이 바깥으로 굽는 쪽
          f: { x: 0, y: 0, z: 0 }, lift: 0, kz: 0.42,
        });
      }
      this.legs.forEach((l, i) => { const r = this.restLocal(i); l.f.x = r.x; l.f.y = r.y; });
    }

    /** i번 다리의 '편한' 발 위치 (로컬 px) */
    restLocal(i, spread = 1, reach = this.reach) {
      const l = this.legs[i], s = this.size, d = l.len * reach * s;
      return { x: l.hx * s + Math.cos(l.dir) * d, y: l.hy * s + l.side * Math.sin(l.dir) * d * spread };
    }
    toWorld(lx, ly) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
    }
    toLocal(wx, wy) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading), dx = wx - this.x, dy = wy - this.y;
      return [dx * c + dy * s, -dx * s + dy * c];
    }
    /** 로컬 3D 점 → 화면 [x, y, 깊이] (twist 반영) */
    project(lx, ly, lz) {
      const c = Math.cos(this.twist), sn = Math.sin(this.twist);
      const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
      const y2 = ly * c - lz * sn;
      return [this.x + lx * ch - y2 * sh, this.y + lx * sh + y2 * ch, ly * sn + lz * c];
    }
    /** 실젖(배 끝)의 화면 위치 */
    tipWorld() {
      const s = this.size, ca = Math.cos(this.abdA), sa = Math.sin(this.abdA);
      const d = -(ABD.d + ABD.rx) * s + this.abdPush;
      return this.project(PED * s + ca * d, sa * d, 0);
    }

    /** 배 흔들림·숨쉬기·더듬이다리 까딱. turn = 몸 회전 속도(rad/s) */
    update(dt, turn = 0) {
      const goal = clamp(-turn * 0.14, -0.42, 0.42);
      this.abdV += ((goal - this.abdA) * 60 - this.abdV * 9) * dt;
      this.abdA += this.abdV * dt;
      this.breath += dt * 1.6;
      for (const p of this.palps) {
        p.t -= dt * this.palpGain;
        if (p.t <= 0) {
          // 짧게 까딱 → 쉬기. 가끔 연달아 두 번
          if (p.goal !== 0 && Math.random() < 0.7) { p.goal = 0; p.t = rand(0.4, 2.2); }
          else { p.goal = rand(-0.4, 1); p.t = rand(0.08, 0.3); }
        }
        p.a += (p.goal - p.a) * follow(16, dt);
      }
    }

    /** 2-본 IK (코사인 법칙). 무릎은 실제로는 '위로' 솟으므로
        위에서 보면 옆으로 꺾인 양이 줄어 보임 → 옆 꺾임을 bend 비율만큼만 남기고 나머지는 높이(z)로 */
    _ik(l, s, bend = 0.4) {
      const hx = l.hx * s, hy = l.hy * s, a = l.a * s, b = l.b * s;
      const dx = l.f.x - hx, dy = l.f.y - hy, d = Math.hypot(dx, dy) || 1e-6;
      const dd = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
      const A = Math.acos(clamp((a * a + dd * dd - b * b) / (2 * a * dd), -1, 1));
      const along = Math.cos(A) * a, side = Math.sin(A) * a * l.sign;
      const ux = dx / d, uy = dy / d;
      return [hx + ux * along - uy * side * bend, hy + uy * along + ux * side * bend, Math.abs(side)];
    }

    draw(ctx, th) {
      th = th || this.theme || (this.theme = theme());
      const pal = th.spider, s = this.size;
      const c = Math.cos(this.twist), sn = Math.sin(this.twist);
      const P = (x, y, z) => this.project(x, y, z);

      // --- 다리: 발끝 목표 → IK 무릎 → 종아리는 살짝 휘게
      const legs = this.legs.map((l) => {
        const [kx, ky, kh] = this._ik(l, s);
        const hx = l.hx * s, hy = l.hy * s;
        const kz = Math.max(l.kz * s, kh * 0.7) + l.f.z * 0.55 + l.lift * 0.2 * s;
        const tx = l.f.x - kx, ty = l.f.y - ky, tl = Math.hypot(tx, ty) || 1;
        const bow = 0.07 * l.b * s;
        const mx = (kx + l.f.x) / 2 + l.sign * (-ty / tl) * bow, my = (ky + l.f.y) / 2 + l.sign * (tx / tl) * bow;
        return {
          l, H: P(hx, hy, 0), K: P(kx, ky, kz), M: P(mx, my, (kz + l.f.z) / 2 + 0.05 * s),
          F: P(l.f.x, l.f.y, l.f.z), depth: hy * sn,
        };
      });

      // --- 몸
      const ceF = P((CEPH.x + CEPH.rx) * s, 0, 0), ceB = P((CEPH.x - CEPH.rx) * s, 0, 0);
      const ca = Math.cos(this.abdA), sa = Math.sin(this.abdA), br = 1 + 0.02 * Math.sin(this.breath);
      const dd = -(ABD.d * s) + this.abdPush, acx = PED * s + ca * dd, acy = sa * dd, arx = ABD.rx * s * br;
      const abF = P(acx + ca * arx, acy + sa * arx, 0), abB = P(acx - ca * arx, acy - sa * arx, 0);
      const CE = ell(ceF, ceB, CEPH.ry * s, CEPH.rz * s, c, sn);
      const AB = ell(abF, abB, ABD.ry * s * br, ABD.rz * s * br, c, sn);

      if (this.shadow && this.alpha > 0.01) this._shadow(ctx, th, legs, [CE, AB]);

      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.lineCap = ctx.lineJoin = 'round';
      const front = [];
      for (const G of legs) { if (G.depth > 0.02 * s) front.push(G); else this._leg(ctx, G, pal, s); }

      // 배
      this._blob(ctx, AB, pal, 1);
      const dA = clamp(c * 1.6, 0, 1), vA = clamp(-c * 1.6, 0, 1);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(AB.x, AB.y, AB.rx, AB.ry, AB.ang, 0, TAU); ctx.clip();
      ctx.translate(AB.x, AB.y); ctx.rotate(AB.ang);
      {
        const rx = AB.rx, ry = ABD.ry * s * br, rz = ABD.rz * s * br;
        const Q = (u, v, side) => {
          const z = side * rz * Math.sqrt(Math.max(0, 1 - u * u - v * v));
          return [u * rx, v * ry * c - z * sn];
        };
        const path = (pts) => { ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); };
        if (dA > 0.01) {
          // 등 무늬: 잎 모양 띠(folium) + 갈매기 무늬 + 점
          const folW = (u) => 0.5 * Math.pow(Math.max(0, Math.sin(Math.PI * (0.88 - u) / 1.8)), 0.7) * (1 + 0.14 * Math.cos(u * 19));
          const pts = [];
          for (let k = 0; k <= 20; k++) { const u = 0.88 - (k / 20) * 1.8; pts.push(Q(u, folW(u), 1)); }
          for (let k = 20; k >= 0; k--) { const u = 0.88 - (k / 20) * 1.8; pts.push(Q(u, -folW(u), 1)); }
          ctx.globalAlpha = this.alpha * dA;
          path(pts); ctx.closePath(); ctx.fillStyle = rgba(pal.mid, 0.85); ctx.fill();
          ctx.fillStyle = rgba(pal.dark, 0.55);
          path([Q(0.8, 0, 1), Q(0.48, 0.09, 1), Q(0.18, 0, 1), Q(0.48, -0.09, 1)]); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = rgba(pal.pattern, 0.85); ctx.lineWidth = Math.max(0.6, 0.045 * s);
          for (const u of [0.04, -0.2, -0.42, -0.62, -0.78]) {
            const w = folW(u) * 0.78;
            path([Q(u + 0.1, -w, 1), Q(u, 0, 1), Q(u + 0.1, w, 1)]); ctx.stroke();
          }
          ctx.fillStyle = rgba(pal.pattern, 0.8);
          for (const [u, v] of [[0.42, 0.3], [0.17, 0.37], [-0.1, 0.31]]) for (const g of [-1, 1]) {
            const q = Q(u, g * v, 1); ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.5, 0.04 * s), 0, TAU); ctx.fill();
          }
        }
        if (vA > 0.01) {
          // 배 쪽: 밝은 판 + 책허파 + 실젖
          ctx.globalAlpha = this.alpha * vA;
          const pts = [];
          for (let k = 0; k <= 12; k++) { const u = 0.6 - (k / 12) * 1.35; pts.push(Q(u, 0.22 * Math.sin(Math.PI * k / 12), -1)); }
          for (let k = 12; k >= 0; k--) { const u = 0.6 - (k / 12) * 1.35; pts.push(Q(u, -0.22 * Math.sin(Math.PI * k / 12), -1)); }
          path(pts); ctx.closePath(); ctx.fillStyle = rgba(pal.mid, 0.6); ctx.fill();
          ctx.fillStyle = rgba(pal.pattern, 0.45);
          for (const g of [-1, 1]) { const q = Q(0.62, g * 0.33, -1); ctx.beginPath(); ctx.ellipse(q[0], q[1], 0.09 * s, 0.05 * s, 0, 0, TAU); ctx.fill(); }
          ctx.fillStyle = rgba(pal.legLight, 0.9);
          for (const g of [-1, 0, 1]) { const q = Q(-0.94, g * 0.07, -1); ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.5, 0.045 * s), 0, TAU); ctx.fill(); }
        }
      }
      ctx.restore();
      ctx.globalAlpha = this.alpha;
      this._rim(ctx, AB, pal, s);

      // 위턱(협각)
      ctx.fillStyle = rgba(pal.dark);
      for (const g of [-1, 1]) {
        const q = P(0.44 * s, g * 0.075 * s, 0.02 * s);
        ctx.beginPath(); ctx.ellipse(q[0], q[1], 0.085 * s, Math.max(0.5, 0.07 * s), CE.ang, 0, TAU); ctx.fill();
      }

      // 머리가슴
      this._blob(ctx, CE, pal, 1.12);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(CE.x, CE.y, CE.rx, CE.ry, CE.ang, 0, TAU); ctx.clip();
      ctx.translate(CE.x, CE.y); ctx.rotate(CE.ang);
      {
        const rx = CE.rx, ry = CEPH.ry * s, rz = CEPH.rz * s;
        const Q = (u, v, side) => {
          const z = side * rz * Math.sqrt(Math.max(0, 1 - u * u - v * v));
          return [u * rx, v * ry * c - z * sn];
        };
        if (dA > 0.01) {
          ctx.globalAlpha = this.alpha * dA;
          // 가운데 밝은 띠 + 가운데 홈(fovea) + 방사선
          ctx.fillStyle = rgba(pal.pattern, 0.28);
          ctx.beginPath();
          for (let k = 0; k <= 10; k++) { const u = 0.75 - (k / 10) * 1.6, q = Q(u, 0.2 * Math.sin(Math.PI * k / 10) + 0.05, 1); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
          for (let k = 10; k >= 0; k--) { const u = 0.75 - (k / 10) * 1.6, q = Q(u, -0.2 * Math.sin(Math.PI * k / 10) - 0.05, 1); ctx.lineTo(q[0], q[1]); }
          ctx.fill();
          ctx.strokeStyle = rgba(pal.dark, 0.4); ctx.lineWidth = Math.max(0.5, 0.03 * s);
          for (const g of [-1, 1]) for (const a of [0.7, 1.25, 1.85, 2.4]) {
            const p0 = Q(-0.25 + 0.22 * Math.cos(a), g * 0.22 * Math.sin(a), 1), p1 = Q(-0.25 + 0.8 * Math.cos(a), g * 0.8 * Math.sin(a), 1);
            ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
          }
          ctx.strokeStyle = rgba(pal.dark, 0.75); ctx.lineWidth = Math.max(0.6, 0.06 * s);
          const f0 = Q(-0.12, 0, 1), f1 = Q(-0.4, 0, 1);
          ctx.beginPath(); ctx.moveTo(f0[0], f0[1]); ctx.lineTo(f1[0], f1[1]); ctx.stroke();
        }
        if (vA > 0.01) {
          ctx.globalAlpha = this.alpha * vA;
          ctx.fillStyle = rgba(pal.mid, 0.8);
          const q = Q(-0.05, 0, -1);
          ctx.beginPath(); ctx.ellipse(q[0], q[1], rx * 0.55, Math.max(0.5, ry * 0.5 * Math.abs(c) + 0.1 * s), 0, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
      ctx.globalAlpha = this.alpha;
      this._rim(ctx, CE, pal, s);

      // 눈 8개 (앞가운데 두 개가 제일 큼)
      for (const [ex, ey, er] of EYES) for (const g of [-1, 1]) {
        const ez = CEPH.rz * s * 0.85, ly = g * ey * s;
        const d = ly * sn + ez * c;
        const va = clamp(d / (0.08 * s), 0, 1);
        if (va <= 0.01) continue;
        const q = P(ex * s, ly, ez), r = Math.max(0.6, er * s);
        ctx.globalAlpha = this.alpha * va;
        ctx.fillStyle = rgba(pal.eye);
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(q[0] - r * 0.3, q[1] - r * 0.35, Math.max(0.3, r * 0.35), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = this.alpha;

      // 더듬이다리
      ctx.fillStyle = rgba(mix(pal.leg, pal.legLight, 0.3));
      for (const p of this.palps) {
        const g = p.side, k = Math.max(p.a, this.palpRaise * 1.4);
        const b0 = [0.37 * s, g * 0.12 * s];
        const a1 = g * (0.36 + 0.5 * k), a2 = a1 - g * (0.55 + 0.35 * k);
        const j = [b0[0] + Math.cos(a1) * 0.2 * s, b0[1] + Math.sin(a1) * 0.2 * s];
        const t = [j[0] + Math.cos(a2) * 0.16 * s, j[1] + Math.sin(a2) * 0.16 * s];
        const zj = 0.08 * s + 0.15 * s * Math.max(0, k), zt = 0.04 * s + 0.25 * s * this.palpRaise;
        const B0 = P(b0[0], b0[1], 0.03 * s), J = P(j[0], j[1], zj), T = P(t[0], t[1], zt);
        taper(ctx, B0, J, 0.07 * s, 0.055 * s);
        taper(ctx, J, T, 0.055 * s, 0.08 * s);
      }
      for (const G of front) this._leg(ctx, G, pal, s);
      ctx.restore();
    }

    _blob(ctx, E, pal, lighten) {
      // 빛이 왼쪽 위 → 하이라이트를 그쪽으로
      const r = Math.min(E.rx, E.ry), hx = E.x - 0.5 * r * 0.5, hy = E.y - 0.86 * r * 0.5;
      const gr = ctx.createRadialGradient(hx, hy, r * 0.1, E.x, E.y, Math.max(E.rx, E.ry) * 1.08);
      gr.addColorStop(0, rgba(mix(pal.mid, pal.pattern, 0.12 * lighten)));
      gr.addColorStop(0.55, rgba(pal.body));
      gr.addColorStop(1, rgba(pal.dark));
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(E.x, E.y, E.rx, E.ry, E.ang, 0, TAU); ctx.fill();
    }
    _rim(ctx, E, pal, s) {
      ctx.strokeStyle = rgba(pal.dark, 0.6); ctx.lineWidth = Math.max(0.5, 0.035 * s);
      ctx.beginPath(); ctx.ellipse(E.x, E.y, E.rx, E.ry, E.ang, 0, TAU); ctx.stroke();
      const r = Math.min(E.rx, E.ry);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.ellipse(E.x - r * 0.22, E.y - r * 0.38, r * 0.32, r * 0.18, -0.5, 0, TAU); ctx.fill();
    }

    _leg(ctx, G, pal, s) {
      const l = G.l, up = clamp(l.lift, 0, 1);
      // 들린 다리는 살짝 밝게 (빛을 더 받음)
      const c1 = rgba(mix(pal.leg, pal.legLight, 0.12 + up * 0.3));
      const c2 = rgba(mix(pal.leg, pal.legLight, 0.38 + up * 0.3));
      ctx.fillStyle = c1;
      taper(ctx, G.H, G.K, 0.13 * s, 0.095 * s);
      ctx.fillStyle = c2;
      taper(ctx, G.K, G.M, 0.085 * s, 0.062 * s);
      taper(ctx, G.M, G.F, 0.062 * s, 0.032 * s);
      // 무릎 마디(밝게) · 종아리 띠무늬(어둡게)
      ctx.fillStyle = rgba(pal.legLight, 0.85);
      ctx.beginPath(); ctx.arc(G.K[0], G.K[1], Math.max(0.5, 0.055 * s), 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(pal.dark, 0.7);
      ctx.beginPath(); ctx.arc(G.M[0], G.M[1], Math.max(0.45, 0.036 * s), 0, TAU); ctx.fill();
      if (s >= 11) {
        // 잔털: 종아리를 따라 짧은 가시
        ctx.strokeStyle = rgba(pal.dark, 0.5); ctx.lineWidth = 0.6;
        for (const [A, B] of [[G.K, G.M], [G.M, G.F]]) {
          const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1;
          const nx = -dy / d, ny = dx / d;
          for (const t of [0.3, 0.62, 0.9]) {
            const px = A[0] + dx * t, py = A[1] + dy * t, g = t > 0.6 ? 1 : -1;
            ctx.beginPath(); ctx.moveTo(px, py);
            ctx.lineTo(px + nx * g * 0.11 * s + (dx / d) * 0.06 * s, py + ny * g * 0.11 * s + (dy / d) * 0.06 * s);
            ctx.stroke();
          }
        }
      }
    }

    _shadow(ctx, th, legs, blobs) {
      const s = this.size, alt = this.alt * s;
      const cx = this.x + alt * LX, cy = this.y + alt * LY, half = 3.4 * s;
      const dpr = Math.min(global.devicePixelRatio || 1, 2.5), px = Math.ceil(half * 2 * dpr);
      const L = layer(px), g = L.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, px, px);
      g.setTransform(dpr, 0, 0, dpr, (half - cx) * dpr, (half - cy) * dpr);
      g.fillStyle = g.strokeStyle = rgba(th.shade, 1);
      g.lineCap = g.lineJoin = 'round';
      g.lineWidth = Math.max(0.8, 0.09 * s);
      const o = (q) => [q[0] + (alt + q[2]) * LX, q[1] + (alt + q[2]) * LY];
      for (const G of legs) {
        const h = o(G.H), k = o(G.K), m = o(G.M), f = o(G.F);
        g.beginPath(); g.moveTo(h[0], h[1]); g.lineTo(k[0], k[1]); g.lineTo(m[0], m[1]); g.lineTo(f[0], f[1]); g.stroke();
      }
      for (const E of blobs) {
        g.beginPath(); g.ellipse(E.x + alt * LX, E.y + alt * LY, E.rx, E.ry, E.ang, 0, TAU); g.fill();
      }
      ctx.save();
      ctx.globalAlpha = th.shade[3] * this.shadowAlpha * this.alpha;
      if ('filter' in ctx) ctx.filter = `blur(${(0.4 + alt * 0.07).toFixed(1)}px)`;
      ctx.drawImage(L.cv, 0, 0, px, px, cx - half, cy - half, half * 2, half * 2);
      ctx.restore();
    }
  }

  // ============================================================
  //  Gait — 심어 둔 발 + 문턱 넘으면 한 발씩 내딛기
  // ============================================================
  class Gait {
    constructor(sp, o = {}) {
      this.sp = sp;
      Object.assign(this, {
        stepTime: 0.15,   // 천천히 걸을 때 한 걸음 시간(초)
        minStep: 0.055,   // 빨리 달릴 때 최소 걸음 시간
        threshold: 0.7,   // 발이 편한 자리에서 이만큼(size 단위) 벗어나면 내딛음
        maxLead: 0.42,    // 앞으로 예측해서 디딜 최대 거리 (threshold 보다 작아야 함)
        lead: 1.0,
        lift: 0.5,        // 발 드는 높이 (size 단위)
        spread: 1,
        snap: null,       // fn(x, y) → [x, y] | null : 디딜 곳을 실 위로 붙이기 등
        maxLifted: 4,
      }, o);
      const L = sp.legs;
      this.nb = L.map((l, i) => L.map((m, j) => j).filter((j) => j !== i &&
        ((L[j].side === l.side && Math.abs(L[j].pair - l.pair) === 1) || L[j].pair === l.pair)));
      this.feet = L.map(() => ({ x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 1, T: 0.1, on: false, lift: 0, ahead: 0 }));
      this.ow = L.map(() => 0);   // 다리별 자세 덮어쓰기 비율 0~1
      this.pose = null;            // fn(i) → {x, y, z} 로컬 — ow 와 함께 씀
      this.bob = 0; this.bobV = 0; this.idle = 0;
      this.vx = 0; this.vy = 0; this.omega = 0;
      this.onLand = null;
      this.reset();
    }
    /** i번 다리가 디딜 곳 (월드). ahead초 뒤를 예측 */
    target(i, ahead) {
      const sp = this.sp, s = sp.size, r = sp.restLocal(i, this.spread);
      const h = sp.heading + this.omega * ahead, ch = Math.cos(h), sh = Math.sin(h);
      let lx = this.vx * ahead, ly = this.vy * ahead;
      const m = Math.hypot(lx, ly), cap = this._lead || this.maxLead * s;
      if (m > cap) { lx *= cap / m; ly *= cap / m; }
      let x = sp.x + r.x * ch - r.y * sh + lx, y = sp.y + r.x * sh + r.y * ch + ly;
      if (this.snap) { const q = this.snap(x, y, i); if (q) { x = q[0]; y = q[1]; } }
      return [x, y];
    }
    reset() {
      this.feet.forEach((f, i) => { const q = this.target(i, 0); f.x = q[0]; f.y = q[1]; f.on = false; f.lift = 0; });
      this._write();
    }
    /** 지금 다리 모양(로컬 발 위치) 그대로 발을 심음 — 다른 모드에서 걷기로 넘어올 때 */
    plantFromLegs() {
      this.sp.legs.forEach((l, i) => {
        const q = this.sp.toWorld(l.f.x, l.f.y), f = this.feet[i];
        f.x = q[0]; f.y = q[1]; f.on = false; f.lift = 0;
      });
    }
    get lifted() { return this.feet.filter((f) => f.on).length; }

    update(dt, vx, vy, omega) {
      const sp = this.sp, s = sp.size, feet = this.feet;
      this.vx = vx; this.vy = vy; this.omega = omega;
      const speed = Math.hypot(vx, vy);
      const fast = clamp(speed / (s * 10), 0, 1);
      const thr = this.threshold * s * (1 + fast * 0.35);
      this._lead = this.maxLead * s * (1 + fast * 0.35);
      // 빠를수록 걸음 시간을 줄여야 '들린 시간 < 디딘 시간'이 유지됨
      const T = clamp(0.42 * (thr + this._lead) / Math.max(speed + Math.abs(omega) * 1.4 * s, 1e-3), this.minStep, this.stepTime);
      const ahead = T * this.lead;

      // 1) 들려 있는 발: 호를 그리며 목표로 (ease-out), 목표는 매 프레임 갱신
      let lifted = 0;
      feet.forEach((f, i) => {
        if (!f.on) return;
        f.t += dt / f.T;
        const q = this.target(i, f.ahead);
        f.tx = q[0]; f.ty = q[1];
        const k = clamp(f.t, 0, 1), e = easeOut(k, 2.2);
        // 몸 바깥쪽으로 살짝 부풀며 휘두름
        const ox = f.tx - sp.x, oy = f.ty - sp.y, od = Math.hypot(ox, oy) || 1;
        const bulge = Math.sin(Math.PI * k) * 0.12 * s;
        if (f.t >= 1) {
          f.on = false; f.x = f.tx; f.y = f.ty; f.lift = 0;
          this.bobV += 0.7 * s;  // 디딜 때 몸이 톡 튐
          if (this.onLand) this.onLand(i);
        } else {
          f.x = lerp(f.fx, f.tx, e) + (ox / od) * bulge;
          f.y = lerp(f.fy, f.ty, e) + (oy / od) * bulge;
          f.lift = Math.sin(Math.PI * Math.pow(k, 0.7));
          lifted++;
        }
      });

      // 2) 새로 내디딜 발 고르기: 많이 벗어난 순서대로, 이웃이 들려 있으면 양보
      const moving = speed > 0.25 * s || Math.abs(omega) > 0.15;
      this.idle = moving ? 0 : this.idle + dt;
      const cand = [];
      feet.forEach((f, i) => {
        if (f.on || this.ow[i] > 0.05) return;
        const q = this.target(i, 0);
        cand.push([Math.hypot(f.x - q[0], f.y - q[1]) / thr, i]);
      });
      cand.sort((a, b) => b[0] - a[0]);
      for (const [u, i] of cand) {
        if (lifted >= this.maxLifted) break;
        const settle = !moving && this.idle > 0.12 && u > 0.22 && lifted === 0;
        if (u < 1 && !settle) continue;
        if (this.nb[i].some((j) => feet[j].on && this.ow[j] < 0.05)) continue;
        const f = feet[i];
        f.on = true; f.t = 0; f.fx = f.x; f.fy = f.y;
        f.T = settle ? this.stepTime * 1.3 : T * rand(0.9, 1.12);
        f.ahead = settle ? 0 : ahead;
        lifted++;
        if (settle) break; // 멈췄을 땐 한 발씩 천천히 정리
      }

      // 3) 몸 들썩임: 들린 다리가 많을수록 살짝 가라앉음 + 디딜 때 튐
      const sag = -0.05 * s * lifted;
      this.bobV += ((sag - this.bob) * 160 - this.bobV * 15) * dt;
      this.bob += this.bobV * dt;
      this._write();
    }
    _write() {
      const sp = this.sp, s = sp.size;
      this.feet.forEach((f, i) => {
        const l = sp.legs[i], q = sp.toLocal(f.x, f.y);
        let x = q[0], y = q[1], z = f.lift * this.lift * s, lift = f.lift;
        const w = this.ow[i];
        if (w > 0 && this.pose) {
          const p = this.pose(i);
          x = lerp(x, p.x, w); y = lerp(y, p.y, w); z = lerp(z, p.z, w);
          lift = Math.max(lift, clamp(p.z / (0.7 * s), 0, 1) * w);
        }
        l.f.x = x; l.f.y = y; l.f.z = z; l.lift = lift;
      });
    }
  }

  // ============================================================
  //  Web — 둥근 거미줄
  //  segs: { a, b, type, prog(0~1 깔린 정도), ... }  type: moor/frame/radial/hub/spiral
  // ============================================================
  const SAG = { moor: 0.045, frame: 0.028, radial: 0.007, hub: 0.01, spiral: 0.03 };
  const SEG_A = { moor: 0.3, frame: 0.5, radial: 0.42, hub: 0.38, spiral: 0.34 };
  const SEG_W = { moor: 1, frame: 1.15, radial: 0.85, hub: 0.7, spiral: 0.75 };

  function rayPoly(cx, cy, dx, dy, F) {
    let best = Infinity;
    for (let k = 0; k < F.length; k++) {
      const p = F[k], q = F[(k + 1) % F.length], ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = p[0] - cx, wy = p[1] - cy;
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
    }
    return best;
  }

  class Web {
    /** o: { W, H, cx, cy, R, s(거미 크기), start:[x,y]|null } */
    constructor(o) {
      Object.assign(this, o);
      this.T = 0; this.sw = [0, 0]; this.sources = [];
      this.alpha = 1; this.moorAlpha = 1;
      this.waveSpeed = this.R * 2.1;
      this.waveK = TAU / (this.R * 0.2);
      this._build();
    }
    _seg(a, b, type) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
      const g = {
        a, b, type, len, prog: 0, ph: rand(0, TAU),
        ang: Math.atan2(b[1] - a[1], b[0] - a[0]),
        nx: -(b[1] - a[1]) / len, ny: (b[0] - a[0]) / len,
        wa: this.weight(a[0], a[1]), wb: this.weight(b[0], b[1]), drops: null, gl: 0,
      };
      if (type === 'spiral') {
        // 끈끈이 방울: 실을 따라 고르지 않게
        const gap = Math.max(2.6, this.s * 0.38), n = Math.floor(len / gap);
        g.drops = [];
        for (let k = 0; k < n; k++) g.drops.push([(k + 0.5 + rand(-0.25, 0.25)) / n, rand(0.45, 1) * clamp(this.s / 9, 0.75, 1.35)]);
      }
      this.segs.push(g);
      return this.segs.length - 1;
    }
    /** 흔들림 가중치: 중심 1 → 바깥 0 */
    weight(x, y) {
      const d = Math.hypot(x - this.cx, y - this.cy);
      return Math.pow(clamp(1 - d / (this.R * 1.3), 0, 1), 1.3);
    }
    _build() {
      const { W, H, cx, cy, R } = this;
      const C = [cx, cy];
      this.C = C;
      this.segs = [];
      // 1) 틀(frame): 중심을 둘러싼 5~6각형, 화면 안쪽으로
      const m = Math.random() < 0.5 ? 5 : 6, a0 = rand(0, TAU), F = [];
      for (let k = 0; k < m; k++) {
        const a = a0 + (k + rand(-0.22, 0.22)) * TAU / m, r = R * rand(0.96, 1.14);
        F.push([clamp(cx + Math.cos(a) * r, 10, W - 10), clamp(cy + Math.sin(a) * r, 10, H - 10)]);
      }
      this.F = F;
      // 2) 계류줄: 틀 꼭짓점에서 화면 밖으로
      this.moor = F.map((p) => {
        let dx = p[0] - cx, dy = p[1] - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const tx = dx > 0 ? (W + 40 - p[0]) / dx : dx < 0 ? (-40 - p[0]) / dx : Infinity;
        const ty = dy > 0 ? (H + 40 - p[1]) / dy : dy < 0 ? (-40 - p[1]) / dy : Infinity;
        const t = Math.min(tx, ty);
        const i = this._seg([p[0] + dx * t, p[1] + dy * t], p, 'moor');
        this.segs[i].prog = 1;   // 계류줄은 처음부터 있음
        return i;
      });
      this.frame = F.map((p, k) => this._seg(p, F[(k + 1) % m], 'frame'));
      // 3) 바퀴살: 첫 줄은 F0 → 중심. 나머지는 고르게
      const N = clamp(Math.round(R / 9), 12, 22);
      const phi0 = Math.atan2(F[0][1] - cy, F[0][0] - cx);
      this.N = N;
      this.rad = [];
      for (let j = 0; j < N; j++) {
        const ph = phi0 + (j + (j ? rand(-0.12, 0.12) : 0)) * TAU / N;
        let p;
        if (j === 0) p = F[0];
        else { const t = rayPoly(cx, cy, Math.cos(ph), Math.sin(ph), F); p = [cx + Math.cos(ph) * t, cy + Math.sin(ph) * t]; }
        this.rad.push({ ang: Math.atan2(p[1] - cy, p[0] - cx), p, len: Math.hypot(p[0] - cx, p[1] - cy), seg: -1 });
      }
      this.rad[0].seg = this._seg(F[0], C, 'radial');
      // 균형 잡히게: 이미 만든 줄들과 가장 먼 바퀴살부터
      const order = [], built = new Set([0]);
      while (built.size < N) {
        let best = -1, bd = -1;
        for (let j = 0; j < N; j++) {
          if (built.has(j)) continue;
          let md = Infinity;
          for (const b of built) { const d = Math.min(Math.abs(j - b), N - Math.abs(j - b)); if (d < md) md = d; }
          const sc = md + Math.random() * 0.5;
          if (sc > bd) { bd = sc; best = j; }
        }
        built.add(best); order.push(best);
      }
      for (const j of order) this.rad[j].seg = this._seg(C, this.rad[j].p, 'radial');
      this.radOrder = order;
      const at = (j, f) => { const r = this.rad[((j % N) + N) % N]; return [cx + (r.p[0] - cx) * f, cy + (r.p[1] - cy) * f]; };
      this.at = at;
      // 4) 중심부 나선 (바깥으로 2바퀴 남짓)
      const dir = Math.random() < 0.5 ? 1 : -1, jh = Math.floor(rand(0, N));
      this.hub = []; this.hubPts = [];
      const hubN = Math.round(N * 2.3);
      for (let n = 0; n <= hubN; n++) this.hubPts.push(at(jh + dir * n, 0.045 + (n / hubN) * 0.11));
      for (let n = 0; n < hubN; n++) this.hub.push(this._seg(this.hubPts[n], this.hubPts[n + 1], 'hub'));
      const jEnd = jh + dir * hubN;
      // 5) 끈끈이 나선: 바깥에서 안으로
      const avgR = this.rad.reduce((a, r) => a + r.len, 0) / N;
      const spacing = clamp(avgR * 0.058, 4.5, 17), fOut = 0.86, fIn = 0.3, df = spacing / avgR;
      this.spPts = [];
      for (let n = 0; ; n++) {
        const f = fOut - (n / N) * df;
        if (f < fIn) break;
        this.spPts.push(at(jEnd + dir * n, f));
      }
      this.spiral = [];
      for (let n = 0; n < this.spPts.length - 1; n++) this.spiral.push(this._seg(this.spPts[n], this.spPts[n + 1], 'spiral'));

      // 6) 짓는 순서(이동 목록) — 03 예제가 따라 걸음. speed 는 초당 '몸 크기' 배수
      const mv = [];
      const M = (a, b, lay, speed, pause, label, k = 0.7) => mv.push({ a, b, lay, speed: speed * rand(0.88, 1.12), pause, label, k });
      const start = this.start || this.segs[this.moor[0]].a;
      M(start, F[0], -1, 6, 0.4, '틀');
      for (let k = 0; k < m; k++) M(F[k], F[(k + 1) % m], this.frame[k], 5.5, rand(0.3, 0.55), '틀');
      M(F[0], C, this.rad[0].seg, 6.5, 0.5, '바퀴살');
      for (const j of order) {
        M(C, this.rad[j].p, this.rad[j].seg, 8, rand(0.38, 0.55), '바퀴살');
        M(this.rad[j].p, C, -1, 10, rand(0.12, 0.25), '바퀴살');
      }
      M(C, this.hubPts[0], -1, 4, 0.15, '중심부');
      this.hub.forEach((si, n) => M(this.hubPts[n], this.hubPts[n + 1], si, 5, 0.02, '중심부', 0.3));
      const hubEnd = this.hubPts[this.hubPts.length - 1];
      M(hubEnd, this.spPts[0], -1, 10, 0.4, '끈끈이 나선');
      this.spiral.forEach((si, n) => M(this.spPts[n], this.spPts[n + 1], si, 7.5, rand(0.03, 0.1), '끈끈이 나선', 0.35));
      M(this.spPts[this.spPts.length - 1], C, -1, 6, 0, '완성');
      this.moves = mv;
    }
    /** 다 지어진 상태로 */
    complete() { for (const g of this.segs) g.prog = 1; return this; }

    /** 바람 흔들림 + 진동 나이 먹이기 */
    update(dt) {
      this.T += dt;
      const T = this.T, A = this.R * 0.022;
      const gust = 0.55 + 0.45 * noise(T * 0.17 + 3);
      this.sw[0] = A * gust * (Math.sin(T * 0.83) + 0.45 * Math.sin(T * 2.1 + 1.3));
      this.sw[1] = A * gust * 0.55 * (Math.sin(T * 0.61 + 2) + 0.4 * Math.sin(T * 1.7));
      for (const S of this.sources) S.age += dt;
      this.sources = this.sources.filter((S) => S.age < 3);
    }
    /** (x,y)를 퉁김 → 실을 따라 퍼지는 진동 */
    pluck(x, y, amp) {
      this.sources.push({ x, y, age: 0, amp: amp == null ? this.s * 0.45 : amp, ph: rand(0, TAU) });
      if (this.sources.length > 8) this.sources.shift();
    }
    /** 이 지점의 실 진동 변위(px) */
    waveAt(x, y) {
      let v = 0;
      for (const S of this.sources) {
        const d = Math.hypot(x - S.x, y - S.y), front = this.waveSpeed * S.age;
        let env = d <= front ? Math.exp(-(front - d) / (this.R * 0.35)) : Math.exp(-Math.pow((d - front) / (this.R * 0.05), 2));
        env *= Math.exp(-S.age * 1.5) * Math.exp(-d / (this.R * 1.4));
        v += S.amp * env * Math.sin(d * this.waveK - S.age * 30 + S.ph);
      }
      return v;
    }
    /** 거미 몸을 같이 흔들 오프셋 */
    offset(x, y) {
      const w = this.weight(x, y), v = this.sources.length ? this.waveAt(x, y) * 0.5 : 0;
      return [this.sw[0] * w, this.sw[1] * w + v];
    }
    _pt(g, t, out) {
      const pr = g.prog;
      let x = g.a[0] + (g.b[0] - g.a[0]) * pr * t;
      let y = g.a[1] + (g.b[1] - g.a[1]) * pr * t + 4 * t * (1 - t) * SAG[g.type] * g.len * pr;
      const w = lerp(g.wa, lerp(g.wa, g.wb, pr), t);
      x += this.sw[0] * w; y += this.sw[1] * w;
      if (this._vib && g.type !== 'moor') {
        const v = this.waveAt(x, y) * Math.sin(Math.PI * t);
        x += g.nx * v; y += g.ny * v;
      }
      out[0] = x; out[1] = y;
      return out;
    }
    /** 발 디딜 곳을 가장 가까운 (깔린) 실 위로 */
    snap(x, y, r) {
      let best = null, bd = r * r;
      for (const g of this.segs) {
        if (g.prog <= 0.02 || (g.type === 'moor' && this.moorAlpha < 0.5)) continue;
        const ax = g.a[0], ay = g.a[1], dx = (g.b[0] - ax) * g.prog, dy = (g.b[1] - ay) * g.prog;
        const l2 = dx * dx + dy * dy || 1e-6;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
        const px = ax + dx * t, py = ay + dy * t + 4 * t * (1 - t) * SAG[g.type] * g.len * g.prog;
        const d2 = (px - x) * (px - x) + (py - y) * (py - y);
        if (d2 < bd) { bd = d2; best = [px, py]; }
      }
      return best;
    }

    draw(ctx, th) {
      const T = this.T, ink = th.ink, dark = th.dark;
      this._vib = this.sources.length > 0;
      // 빛 각도: 천천히 돌고, 흔들림에 따라 살짝 떨림 → 반짝임이 띠처럼 움직임
      const lightAng = 0.9 + 0.35 * Math.sin(T * 0.17) + (this.sw[0] / this.R) * 4;
      const pt = [0, 0];
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const glints = [];
      for (const g of this.segs) {
        if (g.prog <= 0) continue;
        const a = (g.type === 'moor' ? this.moorAlpha : 1) * this.alpha;
        if (a <= 0.003) continue;
        const n = clamp(Math.ceil((g.len * g.prog) / 14), 2, 16);
        ctx.beginPath();
        let vib = 0;
        for (let k = 0; k <= n; k++) {
          this._pt(g, k / n, pt);
          k ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]);
        }
        if (this._vib) { this._pt(g, 0.5, pt); vib = Math.abs(this.waveAt(pt[0], pt[1])) / Math.max(1, this.s * 0.3); }
        ctx.strokeStyle = rgba(ink, SEG_A[g.type] * a);
        ctx.lineWidth = SEG_W[g.type];
        ctx.stroke();
        let gl = Math.pow(Math.abs(Math.cos(g.ang - lightAng)), 22) * (0.72 + 0.28 * Math.sin(T * 2.3 + g.ph));
        gl = Math.min(1, gl + Math.min(0.7, vib * 0.6));
        g.gl = gl * a;
        if (g.gl > 0.03) glints.push(g);
      }
      // 반짝임: 무지갯빛 살짝 (실은 빛을 받으면 색이 갈라져 보임)
      for (const g of glints) {
        const n = clamp(Math.ceil((g.len * g.prog) / 14), 2, 16);
        ctx.beginPath();
        for (let k = 0; k <= n; k++) { this._pt(g, k / n, pt); k ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); }
        const hue = (200 + 140 * Math.sin(g.ph + T * 0.25)) % 360;
        ctx.strokeStyle = `hsla(${hue.toFixed(0)},${dark ? 70 : 65}%,${dark ? 82 : 48}%,${(g.gl * 0.85).toFixed(3)})`;
        ctx.lineWidth = SEG_W[g.type] * 1.35;
        ctx.stroke();
      }
      // 끈끈이 방울
      ctx.fillStyle = rgba(ink, 0.32 * this.alpha);
      ctx.beginPath();
      for (const si of this.spiral) {
        const g = this.segs[si];
        if (g.prog <= 0) continue;
        for (const [t, r] of g.drops) {
          if (t > g.prog) break;
          this._pt(g, t / g.prog, pt);
          ctx.moveTo(pt[0] + r, pt[1]); ctx.arc(pt[0], pt[1], r, 0, TAU);
        }
      }
      ctx.fill();
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.95)';
      for (const si of this.spiral) {
        const g = this.segs[si];
        if (g.prog <= 0 || g.gl < 0.08) continue;
        ctx.globalAlpha = Math.min(1, g.gl * 1.2);
        ctx.beginPath();
        for (const [t, r] of g.drops) {
          if (t > g.prog) break;
          this._pt(g, t / g.prog, pt);
          ctx.moveTo(pt[0] + r * 0.55, pt[1] - r * 0.3); ctx.arc(pt[0] - r * 0.2, pt[1] - r * 0.3, r * 0.55, 0, TAU);
        }
        ctx.fill();
      }
      ctx.restore();
    }
  }

  global.SP = {
    Spider, Gait, Web, loop, fitCanvas, theme, onThemeChange, taper,
    clamp, lerp, rand, ease, easeOut, follow, angDiff, noise, rgba, mix, parseColor,
    TAU, DEG, ABD_TIP, LX, LY,
  };
})(window);
