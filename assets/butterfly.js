/* ============================================================
   나비 모션 키트 — JS로 움직이는 예제(04~08)가 같이 씀
   window.BF = { Butterfly, Flyer, loop, ...도우미 }

   Butterfly : 날갯짓·몸 들썩임·그림자를 매 프레임 그림
   Flyer     : 어디로 날아갈지 정함 (배회 / 목표 따라가기 / 도망)

   "팔랑팔랑" 공식
   1) 비대칭 날갯짓: 내려치기 40%, 올리기 60%
   2) 내려칠 때 몸이 떠오르고, 매 박자마다 세기가 랜덤 (0.6~1.4배)
   3) 매 박자마다 옆으로 툭 튀는 힘 → 지그재그 경로
   4) 가끔 날개를 편 채 활공 → 다시 빠르게 퍼덕
   5) 돌 때 몸을 기울임(bank), 높이가 바뀌면 그림자도 바뀜
   6) 날개는 빳빳한 판이 아니라 조각 10개가 이어진 사슬: 바깥 조각일수록
      늦게 따라와서 종이 넘기듯 휨 (flex 값으로 조절).
      ykob/sketch-threejs 의 butterfly 셰이더(MIT) 방식 — 몸에서 먼 점일수록
      늦게 따라오는 사인파, 느린 날갯짓 — 을 따름
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
  /** a 에서 b 로 가는 가장 짧은 각도 차 (라디안) */
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  /** 비대칭 날갯짓 각도. p: 0~1 박자 위치 */
  function flapAngle(p, up, down, split) {
    return p < split
      ? lerp(up, down, ease(p / split))
      : lerp(down, up, ease((p - split) / (1 - split)));
  }

  /** 날개 한 장을 이루는 조각 수 (butterfly.css 의 span 사슬과 맞춰야 함) */
  const SEG = 10;
  const chain = (n, i = 0) => (n ? '<span style="--i:' + i + '"><i></i>' + chain(n - 1, i + 1) + '</span>' : '');
  const wrap01 = (p) => ((p % 1) + 1) % 1;

  const MARKUP =
    '<div class="bf-plane"><div class="bf-shadow"></div><div class="bf-rig">' +
    '<div class="bf-wing bf-wing--l">' + chain(SEG) + '</div><div class="bf-wing bf-wing--r">' + chain(SEG) + '</div>' +
    '<div class="bf-body"></div></div></div>';

  class Butterfly {
    constructor(parent, opts = {}) {
      const el = document.createElement('div');
      el.className = 'bf';
      el.innerHTML = MARKUP;
      parent.appendChild(el);
      this.el = el;
      this.plane = el.querySelector('.bf-plane');
      this.shadow = el.querySelector('.bf-shadow');
      this.rig = el.querySelector('.bf-rig');
      this.segL = [...el.querySelectorAll('.bf-wing--l span')]; // 안쪽 → 바깥 순서
      this.segR = [...el.querySelectorAll('.bf-wing--r span')];
      this.bend = new Array(SEG - 1).fill(0);                   // 조각 사이 꺾임 각도(deg)
      Object.assign(this, {
        x: 0, y: 0,          // 화면 위치(px)
        heading: 0,          // 바라보는 방향(deg). 0 = 화면 위쪽
        bank: 0,             // 좌우 기울기(deg)
        pitch: 0,            // 앞뒤 기울기(deg). +면 머리가 들림
        alt: 40,             // 바닥에서 높이(px)
        scale: 1, hue: 0, tilt: 38,
        rate: 1.5,           // 초당 날갯짓 횟수 (느릴수록 팔랑팔랑, 빠르면 파닥파닥)
        up: 75, down: -15,   // 날개 최고·최저 각도
        split: 0.47,         // 한 박자 중 내려치기 비율. 0.5 = 완전 대칭 사인파
        bob: 7,              // 날갯짓마다 떠오르는 높이
        flex: 0.14,          // 날개 유연함: 날개 끝이 뿌리보다 늦는 정도(박자 비율). 0 = 빳빳한 판
        shadowShift: 0,      // 탑뷰용: 높이 1px당 그림자가 옆으로 밀리는 양 (빛 방향)
        glide: 0,            // 0~1, 1이면 날개 편 채 활공
        glideAngle: 16,
        rest: 0,             // 0~1, 1이면 앉아서 천천히 날개 접었다 폈다
        restSpeed: 1,
      }, opts);
      this.phase = Math.random();
      this.restPhase = Math.random() * TAU;
      this.bobAmp = 1;
      this.angle = this.up;
      this.lift = 0;
      this.onDownstroke = null;
      el.style.setProperty('--hue', this.hue + 'deg');
      this.setScale(this.scale);
    }

    setScale(s) {
      this.scale = s;
      this.plane.style.transform = `rotateX(${this.tilt}deg) scale(${s})`;
    }

    update(dt) {
      const flapping = (1 - this.glide) * (1 - this.rest);
      this.phase += dt * this.rate * flapping;
      if (this.phase >= 1) {
        this.phase %= 1;
        this.bobAmp = rand(0.6, 1.4);
        if (this.onDownstroke) this.onDownstroke(this);
      }
      const fa = flapAngle(this.phase, this.up, this.down, this.split);
      this.restPhase += dt * this.restSpeed * TAU / 2.8;
      const ra = 46 + 40 * Math.cos(this.restPhase); // 86°(접힘) ~ 6°(활짝)
      let a = lerp(fa, this.glideAngle, this.glide);
      a = lerp(a, ra, this.rest);
      this.angle = a;
      const push = (this.up - fa) / (this.up - this.down); // 0 = 위, 1 = 아래 끝
      this.lift = this.bob * this.bobAmp * push * flapping;
      // 날개 휨: 바깥 조각일수록 조금 전 박자의 각도를 따라감 → 내려칠 땐 끝이 위에, 올릴 땐 아래에 남음
      let prev = fa;
      for (let i = 1; i < SEG; i++) {
        const ai = flapAngle(wrap01(this.phase - this.flex * i / (SEG - 1)), this.up, this.down, this.split);
        this.bend[i - 1] = (ai - prev) * flapping + 1.0 * this.glide; // 활공 땐 끝이 살짝 들림
        prev = ai;
      }
    }

    render() {
      const a = this.angle;
      // 시점 기울기(tilt)·크기는 매 프레임 바꿀 수 있음
      this.plane.style.transform = `rotateX(${this.tilt.toFixed(2)}deg) scale(${this.scale})`;
      this.el.style.transform = `translate3d(${this.x.toFixed(2)}px, ${this.y.toFixed(2)}px, 0)`;
      this.rig.style.transform =
        `translateZ(${(this.alt + this.lift).toFixed(2)}px) rotateZ(${this.heading.toFixed(2)}deg) ` +
        `rotateX(${this.pitch.toFixed(2)}deg) rotateY(${this.bank.toFixed(2)}deg)`;
      // 왼쪽 날개는 CSS에서 좌우 반전돼 있어서 양쪽에 같은 값을 줌
      const root = `rotateY(${(-a).toFixed(2)}deg)`;
      this.segL[0].style.transform = root;
      this.segR[0].style.transform = root;
      for (let i = 1; i < SEG; i++) {
        const t = `rotateY(${(-this.bend[i - 1]).toFixed(2)}deg)`;
        this.segL[i].style.transform = t;
        this.segR[i].style.transform = t;
      }
      const spread = Math.max(0.18, Math.cos(a / RAD));
      const h = (this.alt + this.lift) * this.shadowShift;
      this.shadow.style.transform =
        `translate(${(h * 0.55).toFixed(2)}px, ${h.toFixed(2)}px) rotateZ(${this.heading.toFixed(2)}deg) scale(${spread.toFixed(3)}, 1)`;
      this.shadow.style.opacity = clamp(1.1 - this.alt / 140, 0.15, 1).toFixed(3);
    }
  }

  class Flyer {
    constructor(b, opts = {}) {
      this.b = b;
      Object.assign(this, {
        speed: 70,          // 평소 속도(px/s)
        maxSpeed: 170,
        turnRate: 3.4,      // 최대 회전 속도(rad/s)
        margin: 70,         // 가장자리에서 이만큼 들어오면 안쪽으로 돈다
        edges: true,
        arrive: 60,         // 목표 근처 반경: 이 안에서는 맴돌기
        altBase: 44, altRange: 20,
        glides: true,
      }, opts);
      this.theta = (b.heading - 90) / RAD;
      this.turn = 0;
      this.v = this.speed;
      this.target = null;
      this.flee = null;
      this.boost = 0;
      this.side = 0;
      this.glideT = 0;
      this.nextGlide = rand(2, 5);
      this.t = rand(0, 100);
      this.altOverride = null;
      this.lastTurn = 0;
      this.sideGoal = 0;
      b.onDownstroke = () => { this.sideGoal += rand(-1, 1) * 42; };   // 박자마다 옆으로 툭 (목표값만 바꾸고, 실제 값은 부드럽게 따라감)
    }

    step(dt, W, H) {
      const b = this.b;
      this.t += dt;
      // 1) 배회: 부드럽게 바뀌는 랜덤 회전
      this.turn += (rand(-1, 1) * 7 - this.turn * 1.6) * dt;
      let turn = this.turn;
      let targetSpeed = this.speed;
      let near = false;

      // 2) 목표 따라가기 (가까우면 맴돌기)
      if (this.target) {
        const dx = this.target.x - b.x, dy = this.target.y - b.y;
        const d = Math.hypot(dx, dy);
        const diff = angDiff(this.theta, Math.atan2(dy, dx));
        near = d < this.arrive;
        if (near) {
          turn = diff * 0.9 + this.turn * 1.2;
          targetSpeed = lerp(this.speed * 0.45, this.speed, d / this.arrive);
        } else {
          turn = diff * 2.8 + this.turn * 0.35;
          targetSpeed = Math.min(this.maxSpeed, this.speed + d * 0.45);
        }
      }

      // 3) 가장자리 피하기
      if (this.edges) {
        const m = this.margin;
        const edge = Math.max(0, (m - b.x) / m, (b.x - (W - m)) / m, (m - b.y) / m, (b.y - (H - m)) / m);
        if (edge > 0) turn += angDiff(this.theta, Math.atan2(H / 2 - b.y, W / 2 - b.x)) * edge * 4;
      }

      // 4) 도망 (포인터 근처)
      if (this.flee) {
        const dx = b.x - this.flee.x, dy = b.y - this.flee.y;
        const d = Math.hypot(dx, dy);
        if (d < this.flee.r) {
          const s = 1 - d / this.flee.r;
          turn += angDiff(this.theta, Math.atan2(dy, dx)) * 7 * s;
          this.boost = Math.max(this.boost, s);
        }
      }
      this.boost = Math.max(0, this.boost - dt * 0.7);

      turn = clamp(turn, -this.turnRate, this.turnRate);
      this.theta += turn * dt;
      this.lastTurn = turn;

      // 5) 가끔 활공
      if (this.glides) {
        if (this.glideT > 0) {
          this.glideT -= dt;
          if (this.glideT <= 0) { this.nextGlide = rand(2.5, 6); this.boost = Math.max(this.boost, 0.35); }
        } else if ((this.nextGlide -= dt) <= 0 && Math.abs(turn) < 1.2 && !near && this.boost < 0.2) {
          this.glideT = rand(0.35, 0.85);
        }
      }
      const gliding = this.glideT > 0;
      b.glide = lerp(b.glide, gliding ? 1 : 0, Math.min(1, dt * (gliding ? 7 : 12)));

      // 6) 속도·이동 (+ 박자마다 옆으로 툭)
      const want = targetSpeed * (1 + this.boost * 1.3);
      this.v = gliding ? this.v * (1 - dt * 0.25) : lerp(this.v, want, Math.min(1, dt * 2.2));
      this.sideGoal *= Math.exp(-dt * 6);
      this.side += (this.sideGoal - this.side) * Math.min(1, dt * 14);   // 한 프레임에 몸이 홱 돌지 않게
      const c = Math.cos(this.theta), s = Math.sin(this.theta);
      b.x += (c * this.v - s * this.side) * dt;
      b.y += (s * this.v + c * this.side) * dt;

      // 7) 자세: 방향·기울기·날갯짓 속도·높이
      b.heading = this.theta * RAD + 90 + this.side * 0.12;
      b.bank = lerp(b.bank, clamp(turn * 11, -32, 32), Math.min(1, dt * 6));
      b.rate = lerp(b.rate, 1.15 + this.v / 170 + this.boost * 2.4, Math.min(1, dt * 3));
      const altGoal = this.altOverride != null
        ? this.altOverride
        : this.altBase + this.altRange * Math.sin(this.t * 0.45) - (gliding ? 14 : 0);
      b.alt = lerp(b.alt, altGoal, Math.min(1, dt * 1.6));
    }
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

  global.BF = { Butterfly, Flyer, loop, SEG, clamp, lerp, rand, ease, angDiff, flapAngle, RAD, TAU };
})(window);
