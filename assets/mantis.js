/* ============================================================
   사마귀 모션 키트 — examples/mantis/*.html 이 같이 씀
   window.MT = { Mantis, makeWind, drawFly, loop, ...도우미 }

   옆에서 본 사마귀를 canvas 2D 로 직접 그림 (외부 이미지 없음).
   관절 각도만 바꾸면 포즈가 바뀌는 "리그" 방식:

     몸통     x, y(가운데가슴 위치) · pitch(몸 축 기울기) · neck(앞가슴을 얼마나 세웠나)
     머리     gaze — 화면 기준 시선 각도. 몸이 흔들려도 머리는 이 각도를 지킴(눈높이 고정)
     앞다리   arms[0=가까운 쪽, 1=먼 쪽] = { coxa, femur, tibia }
              coxa  : 앞가슴에서 밑마디가 내려온 각
              femur : 밑마디↔넓적다리 사이 각 (0 = 완전히 접힘, π = 일자)
              tibia : 넓적다리↔종아리(낫) 사이 각 (0 = 접힘, π = 일자)
     걷는 다리 feet[0..3] = 화면 좌표의 발 위치. 무릎은 IK 로 자동 계산
              → 발은 붙어 있고 몸만 흔들리는 "풀잎 흔들림"이 그냥 나옴
     fan      0~1. 위협 자세: 겉날개를 들고 속날개를 부채처럼 펼침

   "사마귀다움" 공식
   1) 몸 흔들림은 발을 고정한 채 몸통만 앞뒤로 — 머리(시선)는 따로 안정화
   2) 고개는 부드럽게 따라가지 않고 '툭, 툭' 끊어서 돌림(saccade)은 예제 쪽에서
   3) 더듬이·배는 스프링으로 한 박자 늦게 따라옴(follow-through)
   4) 낚아채기: 0.07초 만에 뻗고(IK 로 목표에 정확히), 접을 땐 훨씬 느리게
   ============================================================ */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInCubic = (t) => Math.pow(clamp(t, 0, 1), 3);
  const easeInOutCubic = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  /** 살짝 지나쳤다 돌아오는 ease-out */
  const easeOutBack = (t, s = 1.5) => { t = clamp(t, 0, 1) - 1; return t * t * ((s + 1) * t + s) + 1; };
  /** 프레임 속도와 무관하게 goal 로 다가감. rate 가 클수록 빠름 */
  const approach = (v, goal, rate, dt) => goal + (v - goal) * Math.exp(-rate * dt);
  /** a 에서 b 로 가는 가장 짧은 각도 차 (라디안) */
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  /** 부드럽게 흔들리는 값 (-1~1). 안 맞는 주파수 3개를 섞어 반복이 안 보이게 */
  function wobble(speed = 1) {
    const f = [rand(0.6, 0.9), rand(1.3, 1.9), rand(2.6, 3.7)].map((v) => v * speed);
    const p = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    return (t) => Math.sin(t * f[0] + p[0]) * 0.55 + Math.sin(t * f[1] + p[1]) * 0.3 + Math.sin(t * f[2] + p[2]) * 0.15;
  }
  /** 감쇠 스프링. s = { x, v }. w = 빠르기, z = 감쇠(1 미만이면 출렁임) */
  function spring(s, goal, w, z, dt) {
    const n = 2, h = dt / n;
    for (let i = 0; i < n; i++) {
      s.v += (w * w * (goal - s.x) - 2 * z * w * s.v) * h;
      s.x += s.v * h;
    }
    return s.x;
  }

  /**
   * 바람. step(dt) 를 매 프레임 부르면
   *   gust  : 0~1 돌풍 세기 (천천히 오르내림)
   *   sway  : -1~1 흔들림 (돌풍이 셀수록 크고 조금 빨라짐, 잔잔할 땐 calm 만큼만)
   *   vel   : sway 의 변화 속도 (+ 면 앞으로 쏠리는 중)
   */
  function makeWind(opts = {}) {
    const n1 = wobble(1), n2 = wobble(2.3);
    const w = Object.assign({ freq: 0.7, calm: 0.16, bias: 0.5, t: rand(0, 60), phase: rand(0, TAU), gust: 0.5, sway: 0, vel: 0 }, opts);
    w.step = (dt) => {
      w.t += dt;
      const g = clamp(w.bias + 0.62 * n1(w.t) + 0.24 * n2(w.t), 0, 1);
      w.gust = approach(w.gust, g * g * (3 - 2 * g), 2.2, dt);
      w.phase += dt * TAU * w.freq * (0.82 + 0.36 * w.gust + 0.12 * n2(w.t * 1.7));
      const prev = w.sway;
      w.sway = Math.sin(w.phase) * (w.calm + (1 - w.calm) * w.gust);
      w.vel = dt > 0 ? (w.sway - prev) / dt : 0;
    };
    return w;
  }

  /* ---------- 치수 (단위: 사마귀 몸길이 ≈ 200) ---------- */
  const G = {
    pro: 58,                              // 앞가슴(긴 목)
    abd: 92,                              // 배
    coxa: 30, femur: 42, tibia: 31, tarsus: 11,   // 낫 앞다리
    legF: 42, legT: 52, legTa: 10,        // 걷는 다리
  };
  /** 앞다리 포즈 모음 */
  const POSE = {
    pray:   { coxa: 2.12, femur: 0.74, tibia: 0.30 },   // 기도 자세
    cock:   { coxa: 2.32, femur: 0.56, tibia: 0.62 },   // 치기 직전: 더 당기고 낫을 살짝 엶
    open:   { coxa: 1.25, femur: 2.45, tibia: 2.30 },   // 쭉 뻗음
    threat: { coxa: 0.55, femur: 2.05, tibia: 1.25 },   // 위협: 위로 번쩍
  };
  const FAR = { coxa: 0.16, femur: -0.10, tibia: 0.06 };   // 먼 쪽 앞다리는 살짝 어긋나게
  const mixPose = (a, b, k) => ({ coxa: lerp(a.coxa, b.coxa, k), femur: lerp(a.femur, b.femur, k), tibia: lerp(a.tibia, b.tibia, k) });

  const COLORS = {
    body: '#86bf5e', belly: '#c6dd93', wing: '#6ea94e', vein: '#4d873c',
    limb: '#79b254', arm: '#8fc766', far: '#557f40', spine: '#42702e',
    eye: '#dcebae', pupil: '#1f2e1b', mouth: '#5b7f3b', line: 'rgba(30,62,26,.42)',
    fanIn: '#5a2a6e', fanMid: '#d2547e', fanOut: '#f6c66a', mark: '#f2b431',
  };

  /* ---------- 그리기 도우미 ---------- */
  /** 양 끝 굵기가 다른 캡슐 */
  function seg(ctx, ax, ay, bx, by, wa, wb) {
    const ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang), ny = Math.cos(ang);
    ctx.beginPath();
    ctx.moveTo(ax + nx * wa, ay + ny * wa);
    ctx.lineTo(bx + nx * wb, by + ny * wb);
    ctx.arc(bx, by, wb, ang + Math.PI / 2, ang - Math.PI / 2, true);
    ctx.lineTo(ax - nx * wa, ay - ny * wa);
    ctx.arc(ax, ay, wa, ang - Math.PI / 2, ang + Math.PI / 2, true);
    ctx.closePath();
    ctx.fill();
  }
  /** 점들을 부드럽게 잇는 닫힌 도형 (점 = 조절점, 곡선은 중점을 지남) */
  function blob(ctx, pts) {
    const n = pts.length;
    const mid = (i) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
    const m0 = mid(n - 1);
    ctx.beginPath();
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(i);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.closePath();
  }
  /** 두 마디 IK. 엉덩이(hx,hy) → 발(fx,fy), 무릎은 (ux,uy) 방향 쪽으로 꺾임 */
  function ik2(hx, hy, fx, fy, a, b, ux, uy) {
    let dx = fx - hx, dy = fy - hy;
    let d = Math.hypot(dx, dy) || 0.001;
    const dd = clamp(d, Math.abs(a - b) + 0.5, a + b - 0.5);
    dx /= d; dy /= d;
    const along = (a * a + dd * dd - b * b) / (2 * dd);
    const off = Math.sqrt(Math.max(0, a * a - along * along));
    let px = -dy, py = dx;
    if (px * ux + py * uy < 0) { px = -px; py = -py; }
    return [hx + dx * along + px * off, hy + dy * along + py * off, hx + dx * dd, hy + dy * dd];
  }

  class Mantis {
    constructor(opts = {}) {
      Object.assign(this, {
        x: 0, y: 0,          // 가운데가슴(걷는 다리 붙는 곳) 화면 위치
        size: 1,             // 1 = 몸길이 약 200px
        dir: 1,              // 1 = 오른쪽을 봄, -1 = 왼쪽
        pitch: -0.05,        // 몸 축 기울기(rad). 음수 = 머리 쪽이 들림
        neck: 0.85,          // 앞가슴을 몸 축에서 세운 각
        gaze: 0.2,           // 시선(얼굴이 향하는 쪽) 각도. 0 = 수평 앞, + = 아래
        abd: 0.14,           // 배 끝이 처진 각
        mouth: 0,            // 0~1 턱 벌림 (씹기)
        fan: 0,              // 0~1 위협 날개 펼침
        mark: 0,             // 0~1 앞다리 안쪽 경고 무늬
        focus: null,         // { x, y } 바라보는 화면 좌표 → 눈 속 검은 점이 그쪽으로
        stepRate: 1,         // 걸음 진행 속도 배율 (0 = 발을 든 채 얼어붙음)
      }, opts);
      this.colors = Object.assign({}, COLORS, opts.colors);
      this.arms = [Object.assign({}, POSE.pray), mixPose(POSE.pray, POSE.pray, 0)];
      this.setArms(POSE.pray);
      this.feet = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, a: 0, lift: 0, step: null }));   // 0 가운데-가까운쪽, 1 가운데-먼쪽, 2 뒤-가까운쪽, 3 뒤-먼쪽
      this.ant = [{ x: this.gaze - 1.2, v: 0 }, { x: this.gaze - 1.5, v: 0 }];
      this.antAim = 0;       // 더듬이를 앞으로 모으는 정도 (0~1)
      this.abdS = { x: this.abd, v: 0 };
      this.t = rand(0, 100);
      this.onStep = null;
      this.R = { arms: [{}, {}], legs: [{}, {}, {}, {}], gaze: this.gaze, P: 0 };
      this.J = { head: { x: 0, y: 0 }, eye: { x: 0, y: 0 }, mouth: { x: 0, y: 0 }, armRoot: { x: 0, y: 0 },
                 elbow: [{}, {}], wrist: [{}, {}], tip: [{}, {}], grip: [{}, {}], tail: { x: 0, y: 0 } };
      this._prev = null;
      this._twitchT = rand(0.5, 2);
      this._twitch = [0, 0];
    }

    /** 두 앞다리에 같은 포즈를 줌 (먼 쪽은 살짝 어긋나게) */
    setArms(pose, far = 1) {
      const a = this.arms;
      a[0].coxa = pose.coxa; a[0].femur = pose.femur; a[0].tibia = pose.tibia;
      a[1].coxa = pose.coxa + FAR.coxa * far; a[1].femur = pose.femur + FAR.femur * far; a[1].tibia = pose.tibia + FAR.tibia * far;
    }
    toWorld(rx, ry) { return { x: this.x + this.dir * this.size * rx, y: this.y + this.size * ry }; }
    toRig(wx, wy) { return [(wx - this.x) / (this.dir * this.size), (wy - this.y) / this.size]; }

    /** 화면 좌표를 바라보는 시선 각도 */
    lookAngle(wx, wy) {
      const p = this.toRig(wx, wy), h = this.R.hj || [60, -50];
      return Math.atan2(p[1] - h[1], p[0] - h[0]);
    }
    /** 앞다리 뿌리에서 본 목표의 각도와 거리(단위) — 사정거리 판정용 */
    aimFrom(wx, wy) {
      const p = this.toRig(wx, wy), r = this.R.ar || [50, -40];
      return { ang: Math.atan2(p[1] - r[1], p[0] - r[0]), dist: Math.hypot(p[0] - r[0], p[1] - r[1]) };
    }
    /** 손목(넓적다리 끝)이 화면 좌표 (wx, wy) 에 닿는 { coxa, femur } 를 IK 로 구함 */
    reach(wx, wy) {
      const p = this.toRig(wx, wy), r = this.R.ar || [50, -40], P = this.R.P;
      const k = ik2(r[0], r[1], p[0], p[1], G.coxa, G.femur, 0, 1);    // 팔꿈치는 아래쪽
      const C = Math.atan2(k[1] - r[1], k[0] - r[0]);
      const F = Math.atan2(k[3] - k[1], k[2] - k[0]);
      let fem = (F - C - Math.PI) % TAU;
      if (fem < 0) fem += TAU;
      return { coxa: angDiff(P, C), femur: fem };
    }

    /** 발 i 를 화면 좌표로 한 걸음 옮김. 천천히 들고 → 옮기고 → 목표 위에서 잠깐 머뭇 → 살며시 내려놓음 */
    step(i, wx, wy, o = {}) {
      const f = this.feet[i];
      f.step = { sx: f.x, sy: f.y, tx: wx, ty: wy, k: 0, dur: o.dur || 0.6, lift: o.lift == null ? 12 : o.lift, a: o.a };
    }
    stepping() { return this.feet.some((f) => f.step); }

    update(dt) {
      this.t += dt;
      // 걸음
      for (let i = 0; i < 4; i++) {
        const f = this.feet[i], st = f.step;
        if (!st) continue;
        st.k = Math.min(1, st.k + dt * this.stepRate / st.dur);
        const k = st.k;
        const hx = ease(k / 0.8);                                   // 옮기기는 80% 지점에서 끝
        const up = k < 0.26 ? easeOutCubic(k / 0.26)
                 : k < 0.8 ? 1 - 0.2 * (k - 0.26) / 0.54
                 : 0.8 * (1 - ease((k - 0.8) / 0.2));               // 마지막 20%: 살며시 내려놓기
        f.lift = up;
        f.x = lerp(st.sx, st.tx, hx);
        f.y = lerp(st.sy, st.ty, hx) - up * st.lift * this.size;
        if (st.a != null) f.a = st.a;
        if (k >= 1) { f.x = st.tx; f.y = st.ty; f.lift = 0; f.step = null; if (this.onStep) this.onStep(i); }
      }
      // 몸이 움직인 속도 (몸 축 방향·회전) → 배와 더듬이가 늦게 따라옴
      let vAx = 0, vPitch = 0;
      if (this._prev && dt > 0) {
        const c = Math.cos(this.pitch), s = Math.sin(this.pitch);
        const dx = (this.x - this._prev.x) * this.dir / this.size, dy = (this.y - this._prev.y) / this.size;
        vAx = (dx * c + dy * s) / dt;
        vPitch = (this.pitch - this._prev.pitch) / dt;
      }
      this._prev = { x: this.x, y: this.y, pitch: this.pitch };
      spring(this.abdS, this.abd + clamp(vAx * 0.0016, -0.3, 0.3) - clamp(vPitch * 0.25, -0.2, 0.2), 11, 0.3, dt);
      // 더듬이: 가끔 툭 움직임 + 스프링
      if ((this._twitchT -= dt) <= 0) {
        this._twitchT = rand(0.4, 2.6);
        this._twitch[Math.random() < 0.5 ? 0 : 1] = rand(-0.35, 0.35);
      }
      const g = this.R.gaze;
      for (let i = 0; i < 2; i++) {
        this._twitch[i] *= Math.exp(-dt * 1.4);
        const base = lerp(-1.25 - i * 0.3, -0.35 - i * 0.1, this.antAim);
        const goal = g + base + this._twitch[i] * (1 - this.antAim) - clamp(vAx * 0.004, -0.6, 0.6);
        spring(this.ant[i], goal, 15, 0.33, dt);
      }
    }

    /** 관절 위치 계산. R = 리그 좌표(오른쪽을 본 기준, 단위), J = 화면 좌표 */
    solve() {
      const R = this.R, p = this.pitch, P = p - this.neck;
      const ax = Math.cos(p), ay = Math.sin(p);      // 몸 축(앞)
      const ux = ay, uy = -ax;                       // 등 쪽
      const at = (u, v) => [ax * u + ux * v, ay * u + uy * v];
      R.P = P; R.ax = ax; R.ay = ay;
      R.hipM = at(13, -4); R.hipH = at(-8, -4);
      R.pb = at(20, 1);                              // 앞가슴 뿌리
      R.ab = at(-12, 1);                             // 배 뿌리
      R.tb = at(-15, 1.5);                           // 가슴 뒤끝
      const pc = Math.cos(P), ps = Math.sin(P);
      R.hj = [R.pb[0] + pc * G.pro, R.pb[1] + ps * G.pro];                      // 목 관절
      R.ar = [R.pb[0] + pc * G.pro * 0.8 - ps * 3, R.pb[1] + ps * G.pro * 0.8 + pc * 3];   // 앞다리 뿌리
      // 고개는 앞가슴 기준으로 돌 수 있는 범위 안에서만
      const g = P + clamp(angDiff(P, this.gaze), 0.1, 2.35);
      R.gaze = g;
      const gc = Math.cos(g), gs = Math.sin(g);
      const hd = (x, y) => [R.hj[0] + gc * x - gs * y, R.hj[1] + gs * x + gc * y];
      R.eye = hd(7.5, -4.5); R.mouth = hd(5.5, 10); R.antBase = hd(6.5, -9.5);
      // 눈 속 검은 점(가짜 눈동자)
      if (this.focus) {
        const f = this.toRig(this.focus.x, this.focus.y);
        const e = angDiff(g, Math.atan2(f[1] - R.eye[1], f[0] - R.eye[0]));
        R.pupil = [1.9 * Math.cos(clamp(e, -1.5, 1.5)), 3.6 * Math.sin(clamp(e, -1.5, 1.5))];
      } else R.pupil = [1.6, 0.6];
      // 앞다리 (FK)
      for (let i = 0; i < 2; i++) {
        const a = this.arms[i], A = R.arms[i];
        A.rx = R.ar[0] - i * 1.5; A.ry = R.ar[1] - i * 1;
        A.C = P + a.coxa;
        A.ex = A.rx + Math.cos(A.C) * G.coxa; A.ey = A.ry + Math.sin(A.C) * G.coxa;
        A.F = A.C + Math.PI + a.femur;
        A.wx = A.ex + Math.cos(A.F) * G.femur; A.wy = A.ey + Math.sin(A.F) * G.femur;
        A.T = A.F + Math.PI - a.tibia;
        A.tx = A.wx + Math.cos(A.T) * G.tibia; A.ty = A.wy + Math.sin(A.T) * G.tibia;
      }
      // 걷는 다리 (IK)
      for (let i = 0; i < 4; i++) {
        const f = this.feet[i], L = R.legs[i], hip = i < 2 ? R.hipM : R.hipH;
        const ft = this.toRig(f.x, f.y);
        const k = ik2(hip[0], hip[1], ft[0], ft[1], G.legF, G.legT, ux, uy);
        L.hx = hip[0]; L.hy = hip[1]; L.kx = k[0]; L.ky = k[1]; L.fx = k[2]; L.fy = k[3];
        L.ta = (this.dir === 1 ? f.a : Math.PI - f.a) + f.lift * 0.75;
      }
      // 화면 좌표
      const J = this.J, set = (o, r) => { o.x = this.x + this.dir * this.size * r[0]; o.y = this.y + this.size * r[1]; };
      set(J.head, R.hj); set(J.eye, R.eye); set(J.mouth, R.mouth); set(J.armRoot, R.ar);
      for (let i = 0; i < 2; i++) {
        const A = R.arms[i];
        set(J.elbow[i], [A.ex, A.ey]); set(J.wrist[i], [A.wx, A.wy]); set(J.tip[i], [A.tx, A.ty]);
        // 먹이를 쥐는 곳: 넓적다리 끝 쪽, 가시가 난 면
        set(J.grip[i], [lerp(A.ex, A.wx, 0.74) - Math.sin(A.F) * 4, lerp(A.ey, A.wy, 0.74) + Math.cos(A.F) * 4]);
      }
      const td = p + Math.PI - this.abdS.x;
      set(J.tail, [R.ab[0] + Math.cos(td) * G.abd, R.ab[1] + Math.sin(td) * G.abd]);
      return J;
    }

    draw(ctx) {
      this.solve();
      const R = this.R;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(this.dir * this.size, this.size);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      this._leg(ctx, 1, true); this._leg(ctx, 3, true);
      if (this.fan > 0.01) this._fan(ctx, true);
      this._arm(ctx, 1, true);
      this._abdomen(ctx);
      if (this.fan > 0.01) this._fan(ctx, false);
      this._wingCover(ctx);
      this._thorax(ctx);
      this._leg(ctx, 2, false); this._leg(ctx, 0, false);
      this._head(ctx);
      this._arm(ctx, 0, false);
      ctx.restore();
      void R;
    }

    _leg(ctx, i, far) {
      const L = this.R.legs[i], c = this.colors;
      ctx.fillStyle = far ? c.far : c.limb;
      seg(ctx, L.hx, L.hy, L.kx, L.ky, 2.7, 1.9);
      seg(ctx, L.kx, L.ky, L.fx, L.fy, 1.8, 1.1);
      seg(ctx, L.fx, L.fy, L.fx + Math.cos(L.ta) * G.legTa, L.fy + Math.sin(L.ta) * G.legTa, 1.0, 0.6);
    }

    _arm(ctx, i, far) {
      const A = this.R.arms[i], c = this.colors;
      const fill = far ? c.far : c.arm;
      ctx.fillStyle = fill;
      seg(ctx, A.rx, A.ry, A.ex, A.ey, 3.6, 2.9);
      if (this.mark > 0.01 && !far) {                       // 위협할 때 보이는 안쪽 경고 무늬
        ctx.save();
        ctx.globalAlpha = this.mark;
        ctx.fillStyle = c.pupil;
        ctx.beginPath(); ctx.arc(lerp(A.rx, A.ex, 0.42), lerp(A.ry, A.ey, 0.42), 2.6, 0, TAU); ctx.fill();
        ctx.fillStyle = c.mark;
        ctx.beginPath(); ctx.arc(lerp(A.rx, A.ex, 0.42), lerp(A.ry, A.ey, 0.42), 1.3, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.fillStyle = fill;
      }
      // 종아리(낫) — 넓적다리보다 먼저 그려 접혔을 때 뒤로 들어가게
      ctx.save();
      ctx.translate(A.wx, A.wy); ctx.rotate(A.T);
      const L2 = G.tibia;
      ctx.fillStyle = far ? c.far : c.limb;
      ctx.beginPath();
      ctx.moveTo(0, -2.1);
      ctx.lineTo(L2 - 2, -1.1);
      ctx.quadraticCurveTo(L2 + 4, -0.6, L2 + 2.6, 5.2);    // 끝 갈고리
      ctx.quadraticCurveTo(L2 + 1.4, 1.6, L2 - 3, 1.5);
      ctx.lineTo(0, 2.1);
      ctx.arc(0, 0, 2.1, Math.PI / 2, -Math.PI / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = far ? c.far : c.spine;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const x = L2 * (0.2 + 0.15 * k);
        ctx.moveTo(x - 1, 1.5); ctx.lineTo(x + 1.3, 1.5); ctx.lineTo(x + 1.6, 4.0);
      }
      ctx.fill();
      // 발목마디
      ctx.fillStyle = far ? c.far : c.limb;
      seg(ctx, L2 - 1, -0.6, L2 - 1 + Math.cos(-0.9) * G.tarsus, -0.6 + Math.sin(-0.9) * G.tarsus, 0.9, 0.5);
      ctx.restore();
      // 넓적다리 — 가운데가 통통한 방추형 + 가시
      ctx.save();
      ctx.translate(A.ex, A.ey); ctx.rotate(A.F);
      const L = G.femur;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, -2.7);
      ctx.quadraticCurveTo(L * 0.4, -6.4, L, -2.3);
      ctx.arc(L, 0, 2.3, -Math.PI / 2, Math.PI / 2);
      ctx.quadraticCurveTo(L * 0.45, 5.4, 0, 2.7);
      ctx.arc(0, 0, 2.7, Math.PI / 2, -Math.PI / 2);
      ctx.closePath(); ctx.fill();
      if (!far) { ctx.strokeStyle = c.line; ctx.lineWidth = 0.7; ctx.stroke(); }
      ctx.fillStyle = far ? c.far : c.spine;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const x = L * (0.3 + 0.11 * k), y = 3.6 - Math.abs(k - 2) * 0.25;
        ctx.moveTo(x - 1.2, y - 0.5); ctx.lineTo(x + 1.4, y - 0.5); ctx.lineTo(x + 1.5, y + 3.1);
      }
      ctx.fill();
      ctx.restore();
    }

    _abdomen(ctx) {
      const R = this.R, c = this.colors, L = G.abd;
      const b = 1 + 0.04 * Math.sin(this.t * 2.1);          // 숨쉬기
      ctx.save();
      ctx.translate(R.ab[0], R.ab[1]);
      ctx.rotate(this.pitch + Math.PI - this.abdS.x);       // 이 안에서는 +x = 꼬리 쪽, +y = 등 쪽
      ctx.beginPath();
      ctx.moveTo(-4, 5.5);
      ctx.bezierCurveTo(L * 0.3, 8, L * 0.7, 6, L, 0.5);
      ctx.bezierCurveTo(L * 0.82, -9 * b, L * 0.5, -17 * b, L * 0.18, -13 * b);
      ctx.quadraticCurveTo(2, -9, -4, -5);
      ctx.closePath();
      ctx.fillStyle = c.belly; ctx.fill();
      ctx.strokeStyle = c.line; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.beginPath();
      for (let x = 17; x < L - 6; x += 12.5) { ctx.moveTo(x + 2, 6); ctx.quadraticCurveTo(x - 3, -6, x - 1, -20); }
      ctx.lineWidth = 0.7; ctx.stroke();
      ctx.restore();
      ctx.restore();
    }

    /** 겉날개(배 위에 포개진 잎 모양). fan 이 커지면 위로 들림 */
    _wingCover(ctx) {
      const R = this.R, c = this.colors, L = G.abd;
      ctx.save();
      ctx.translate(R.ab[0], R.ab[1]);
      ctx.rotate(this.pitch + Math.PI - this.abdS.x);
      ctx.translate(-6, 4); ctx.rotate(this.fan * 0.95); ctx.translate(6, -4);
      ctx.beginPath();
      ctx.moveTo(-10, 4);
      ctx.bezierCurveTo(L * 0.2, 12, L * 0.7, 10, L + 7, 1.5);
      ctx.bezierCurveTo(L * 0.75, -3.5, L * 0.4, -5, 0, -1.5);
      ctx.quadraticCurveTo(-8, 0, -10, 4);
      ctx.closePath();
      ctx.fillStyle = c.wing; ctx.fill();
      ctx.strokeStyle = c.line; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, 3); ctx.quadraticCurveTo(L * 0.5, 5.5, L + 3, 1.6);
      ctx.moveTo(L * 0.2, 5.6); ctx.quadraticCurveTo(L * 0.45, 2, L * 0.7, 0.4);
      ctx.strokeStyle = c.vein; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
    }

    /** 속날개 부채 (위협 자세의 색 번쩍임) */
    _fan(ctx, far) {
      const R = this.R, c = this.colors, L = G.abd, f = this.fan;
      const a0 = 0.06, a1 = (far ? 1.2 : 0.92) * f;
      if (a1 - a0 < 0.03) return;
      const rad = L * (far ? 0.86 : 0.93);
      ctx.save();
      ctx.translate(R.ab[0], R.ab[1]);
      ctx.rotate(this.pitch + Math.PI - this.abdS.x);
      ctx.translate(-6, 4);
      ctx.globalAlpha = clamp(f * 3, 0, 1) * (far ? 0.75 : 1);
      const n = 9;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i <= n; i++) {                         // 가장자리가 물결치는 부채꼴
        const a = lerp(a0, a1, i / n);
        const r = rad * (0.9 + 0.1 * Math.sin((i / n) * Math.PI));
        if (i === 0) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else {
          const am = lerp(a0, a1, (i - 0.5) / n);
          ctx.quadraticCurveTo(Math.cos(am) * r * 1.045, Math.sin(am) * r * 1.045, Math.cos(a) * r, Math.sin(a) * r);
        }
      }
      ctx.closePath();
      const gr = ctx.createRadialGradient(0, 0, rad * 0.08, 0, 0, rad);
      gr.addColorStop(0, c.fanIn); gr.addColorStop(0.5, c.fanMid); gr.addColorStop(0.8, c.fanOut); gr.addColorStop(0.86, c.fanIn); gr.addColorStop(1, c.fanMid);
      ctx.fillStyle = gr; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = lerp(a0, a1, i / n);
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * rad * 0.9, Math.sin(a) * rad * 0.9);
      }
      ctx.strokeStyle = 'rgba(40,12,50,.4)'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.restore();
    }

    _thorax(ctx) {
      const R = this.R, c = this.colors;
      ctx.fillStyle = c.body;
      seg(ctx, R.tb[0], R.tb[1], R.pb[0], R.pb[1], 7.6, 6.4);
      // 앞가슴: 뿌리는 굵고 가운데는 가늘고, 앞다리 붙는 곳에서 다시 넓어짐
      ctx.save();
      ctx.translate(R.pb[0], R.pb[1]); ctx.rotate(R.P);
      const L = G.pro;
      blob(ctx, [[-4, -6.2], [L * 0.3, -4.0], [L * 0.62, -3.6], [L * 0.82, -5.0], [L + 1, -3.4], [L + 2.5, 0],
                 [L + 1, 3.2], [L * 0.82, 5.6], [L * 0.6, 3.8], [L * 0.3, 4.4], [-4, 6.4], [-7, 0]]);
      ctx.fill();
      ctx.strokeStyle = c.line; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
    }

    _head(ctx) {
      const R = this.R, c = this.colors;
      // 더듬이
      ctx.strokeStyle = c.spine; ctx.lineWidth = 0.75;
      for (let i = 1; i >= 0; i--) {
        const b0 = R.gaze - 1.15 - i * 0.22, a = this.ant[i].x;
        const cx = R.antBase[0] + Math.cos(b0) * 20, cy = R.antBase[1] + Math.sin(b0) * 20;
        ctx.globalAlpha = i ? 0.6 : 1;
        ctx.beginPath();
        ctx.moveTo(R.antBase[0], R.antBase[1]);
        ctx.quadraticCurveTo(cx, cy, cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(R.hj[0], R.hj[1]); ctx.rotate(R.gaze);
      // 턱
      ctx.fillStyle = c.mouth;
      ctx.save(); ctx.translate(5, 9); ctx.rotate(0.25 + this.mouth * 0.55);
      ctx.beginPath(); ctx.moveTo(-1.5, -1); ctx.lineTo(2.4, -0.4); ctx.lineTo(0.6, 4.6); ctx.closePath(); ctx.fill();
      ctx.restore();
      // 세모난 얼굴
      blob(ctx, [[-4.5, -8], [4, -11.5], [11.5, -9], [12.5, -1.5], [8.2, 6.5], [5.2, 12.2], [1.5, 9], [-3.5, 3.5], [-5.5, -2]]);
      ctx.fillStyle = c.body; ctx.fill();
      ctx.strokeStyle = c.line; ctx.lineWidth = 0.8; ctx.stroke();
      // 겹눈 + 가짜 눈동자
      ctx.beginPath(); ctx.ellipse(7.5, -4.5, 4.5, 6.1, -0.32, 0, TAU);
      ctx.fillStyle = c.eye; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(7.5 + R.pupil[0], -4.5 + R.pupil[1], 1.35, 0, TAU);
      ctx.fillStyle = c.pupil; ctx.fill();
      ctx.restore();
    }
  }

  /**
   * 작은 파리. f = { x, y, size, dir, tilt, buzz(0~1 날갯짓), perched(다리 그림),
   *                  groom(앞다리 비비기 위상), lift(0~1 몸 세움), flip(-1~1 방향 전환), alpha }
   */
  function drawFly(ctx, f) {
    const s = f.size || 1;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(s * (f.flip == null ? (f.dir || 1) : f.flip), s);
    ctx.rotate(f.tilt || 0);
    ctx.globalAlpha *= f.alpha == null ? 1 : f.alpha;
    ctx.lineCap = 'round';
    const lift = f.lift || 0, by = f.perched ? -5.2 - lift * 1.6 : 0;
    if (f.perched) {                                             // 다리 (땅 = y 0)
      ctx.strokeStyle = '#23262c'; ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(-1, by + 2); ctx.lineTo(-4.4, by + 2.6); ctx.lineTo(-6, 0);
      ctx.moveTo(1.2, by + 2.2); ctx.lineTo(0.4, by + 3.4 - lift); ctx.lineTo(1.2, 0);
      const g = f.groom == null ? null : f.groom;
      if (g == null) { ctx.moveTo(3.6, by + 2); ctx.lineTo(6.4, by + 3); ctx.lineTo(7.4, 0); }
      else {                                                     // 앞다리 두 개를 비빔
        ctx.moveTo(3.8, by + 1.8); ctx.lineTo(7.2, by + 2.4); ctx.lineTo(9 + Math.sin(g) * 1.1, by + 4 + Math.cos(g) * 0.5);
        ctx.moveTo(3.8, by + 1.8); ctx.lineTo(7.0, by + 3.0); ctx.lineTo(9 - Math.sin(g) * 1.1, by + 4.2 - Math.cos(g) * 0.5);
      }
      ctx.stroke();
    }
    ctx.translate(0, by);
    ctx.rotate(-lift * 0.22);
    ctx.fillStyle = '#343a45';
    ctx.beginPath(); ctx.ellipse(-3.2, 0.3, 4.8, 3.1, 0.08, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a2e37';
    ctx.beginPath(); ctx.arc(2.4, -0.4, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(6.2, 0, 2.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#a8432c';
    ctx.beginPath(); ctx.ellipse(6.9, -0.5, 1.5, 1.9, 0.2, 0, TAU); ctx.fill();
    const buzz = f.buzz || 0;
    if (buzz > 0.05) {                                           // 날갯짓 잔상
      const k = 0.7 + 0.3 * Math.sin((f.t || 0) * 190);
      ctx.fillStyle = 'rgba(214,230,240,' + (0.34 * buzz).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(-0.5, -5.2, 7.2 * k, 4.6, -0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-2.2, -3.6, 6.6, 3.4 * k, 0.5, 0, TAU); ctx.fill();
    }
    if (buzz < 0.95) {                                           // 접은 날개
      ctx.globalAlpha *= 1 - buzz;
      ctx.fillStyle = 'rgba(220,234,242,.62)';
      ctx.strokeStyle = 'rgba(60,70,84,.5)'; ctx.lineWidth = 0.35;
      ctx.beginPath(); ctx.ellipse(-3.4, -2.2 - lift * 1.4, 6.6, 2.1, 0.1 - lift * 0.35, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /** requestAnimationFrame 루프. fn(dt초, t초) */
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

  global.MT = {
    Mantis, makeWind, drawFly, loop, POSE, G, mixPose, seg, blob, ik2,
    clamp, lerp, rand, ease, easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack,
    approach, spring, angDiff, wobble, TAU,
  };
})(window);
