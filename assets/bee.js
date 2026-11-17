/* ============================================================
   꿀벌 모션 키트 — examples/bee/*.html 이 같이 씀
   window.BE = { makeBee, loop, ...도우미 }

   makeBee(parent, opts) → 위에서 내려다본 꿀벌 하나 (SVG + 그림자)
     x, y      : 바닥 기준 위치(px)
     heading   : 바라보는 방향(deg). 0 = 화면 위쪽
     alt       : 바닥에서 높이(px) → 그림자가 멀어지고 몸이 살짝 커짐
     fly       : 0~1. 0 = 날개 접고 앉음, 1 = 최대로 윙윙
     bank      : -1~1. 돌 때 몸 기울기 (안쪽 날개가 짧아 보임)
     bend      : 배(복부)를 옆으로 꺾는 각도(deg) — 8자 춤의 엉덩이 흔들기
     pollen    : 0~1. 뒷다리 꽃가루 덩어리 크기

   "윙윙" 공식
   1) 벌 날갯짓(초당 200회)은 화면에 못 그림 → 매 프레임 불규칙한 위상으로
      날개를 앞뒤로 쓸고, 시위(폭)를 접었다 폈다(원근 축소) + 반대 위상 잔상
   2) 날개는 수평으로 앞뒤로 쓸어 줌 (벌·파리는 위아래가 아니라 수평 스트로크)
   3) 바닥에서 움직이면 이동 거리만큼 다리가 삼각 보행(tripod)으로 걸음
   4) 더듬이는 따로 놀며 가끔 툭 움직임
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  /** 프레임 속도와 무관한 부드러운 따라가기. k가 클수록 빠름 */
  const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
  /** a 에서 b 로 가는 가장 짧은 각도 차 (라디안) */
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  let uid = 0;
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return;
    cssDone = true;
    const st = document.createElement('style');
    st.textContent =
      '.be{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;will-change:transform}' +
      '.be-shadow{position:absolute;left:0;top:0;border-radius:50%;background:var(--shade,rgba(0,0,0,.25));transform-origin:50% 50%}' +
      '.be-svg{position:absolute;left:0;top:0;width:48px;height:48px;overflow:visible;transform-origin:50% 50%}';
    document.head.appendChild(st);
  }

  // ---- 모양 (오른쪽 기준, 왼쪽은 scale(-1,1)로 뒤집어 씀) ----
  const WING_F = 'M0 0C4 -3.6 13 -4.6 17 -2.2C19.2 -0.6 17.4 2.6 12 2.9C7 3.1 3 2.1 0 0Z';
  const WING_H = 'M0 0C3 -1.6 9 -2.2 11.6 -0.2C12.8 1.4 10.2 3.6 6 3.4C3 3.1 1 1.6 0 0Z';
  const VEIN_F = 'M0.5 0L15 -1.6M3 0.8L11.5 2.2M7 -0.6L9.5 2.4';
  const VEIN_H = 'M0.5 0.2L10.5 0.6M4 0.6L7 2.8';
  const ABDOMEN = 'M0 -1C6.6 -1 7.1 6 6.1 11C5.1 15.6 2.1 18.2 0 19.2C-2.1 18.2 -5.1 15.6 -6.1 11C-7.1 6 -6.6 -1 0 -1Z';
  // 다리: 붙는 곳(ax, ay), 모양, 날 때 접는 각도, 삼각 보행 그룹
  const LEGS = [
    { ax: 2.6, ay: -7.8, d: 'M0 0L4 -2.4L6.6 -6.6', tuck: 42, g: 0 },
    { ax: 3.4, ay: -5.0, d: 'M0 0L5.2 0.3L8.8 3.2', tuck: 58, g: 1 },
    { ax: 3.0, ay: -2.4, d: 'M0 0L4.6 4.6L5.8 11.2', tuck: 24, g: 0 },
  ];
  // 날개: 붙는 곳, 접힘 각도, 날 때 가운데 각도, 쓸어주는 폭, 위상 지연
  const WINGS = [
    { path: WING_F, vein: VEIN_F, bx: 2.2, by: -7.0, fold: 99, mid: 4, amp: 48, lag: 0 },
    { path: WING_H, vein: VEIN_H, bx: 2.4, by: -4.2, fold: 93, mid: 26, amp: 38, lag: 0.45 },
  ];

  function markup(id) {
    let legs = '';
    [1, -1].forEach((side) => {
      LEGS.forEach((L, i) => {
        legs += `<g transform="scale(${side},1)"><g class="be-leg" transform="translate(${L.ax} ${L.ay})">` +
          `<path d="${L.d}" fill="none" stroke="#2b1d12" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>` +
          (i === 2 ? '<circle class="be-pollen" cx="5.2" cy="7.4" r="0" fill="#f2a93b" stroke="#d98a1c" stroke-width="0.4"/>' : '') +
          '</g></g>';
      });
    });
    let wings = '';
    let ghosts = '';
    [1, -1].forEach((side) => {
      WINGS.forEach((w) => {
        ghosts += `<g transform="scale(${side},1)"><g transform="translate(${w.bx} ${w.by})"><g class="be-ghost">` +
          `<path d="${w.path}" fill="rgba(225,236,250,0.55)"/></g></g></g>`;
        wings += `<g transform="scale(${side},1)"><g transform="translate(${w.bx} ${w.by})"><g class="be-wing">` +
          `<path d="${w.path}" fill="rgba(226,237,250,0.5)" stroke="rgba(60,70,90,0.45)" stroke-width="0.45"/>` +
          `<path d="${w.vein}" fill="none" stroke="rgba(60,70,90,0.35)" stroke-width="0.35"/></g></g></g>`;
      });
    });
    let antennae = '';
    [1, -1].forEach((side) => {
      antennae += `<g transform="scale(${side},1)"><g class="be-ant" transform="translate(1.3 -15.4)">` +
        '<path d="M0 0L1 -3.6L3.4 -6.3" fill="none" stroke="#24180f" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></g></g>';
    });
    return `<defs>
  <clipPath id="${id}-ab"><path d="${ABDOMEN}"/></clipPath>
  <radialGradient id="${id}-th" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#d9aa62"/><stop offset="1" stop-color="#6b4521"/></radialGradient>
  <radialGradient id="${id}-hl" cx="35%" cy="30%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<g class="be-legs">${legs}</g>
<g class="be-abd">
  <path d="${ABDOMEN}" fill="#e6b13c"/>
  <g clip-path="url(#${id}-ab)">
    <rect x="-8" y="-1" width="16" height="3.4" fill="#f3d27a"/>
    <rect x="-8" y="4.4" width="16" height="2.7" fill="#3b2615"/>
    <rect x="-8" y="9.2" width="16" height="2.7" fill="#3b2615"/>
    <rect x="-8" y="13.8" width="16" height="2.4" fill="#3b2615"/>
    <rect x="-8" y="17.4" width="16" height="3" fill="#3b2615"/>
    <ellipse cx="-1.6" cy="6" rx="5" ry="9" fill="url(#${id}-hl)"/>
  </g>
  <path d="${ABDOMEN}" fill="none" stroke="#5a3b1a" stroke-width="0.9" stroke-dasharray="0.35 0.85" stroke-linecap="round"/>
  <path d="M0 19L0 20.6" stroke="#24180f" stroke-width="0.6" stroke-linecap="round"/>
</g>
<circle cx="0" cy="-5.2" r="6.9" fill="none" stroke="#c99248" stroke-width="1.5" stroke-dasharray="0.4 0.75" stroke-linecap="round" opacity="0.85"/>
<circle cx="0" cy="-5.2" r="6.1" fill="url(#${id}-th)"/>
<ellipse cx="-1.6" cy="-7" rx="2.4" ry="1.7" fill="#fff" opacity="0.18"/>
${antennae}
<ellipse cx="0" cy="-12.8" rx="4.5" ry="3.6" fill="#3a2919"/>
<ellipse cx="-3.3" cy="-12.9" rx="1.5" ry="2.6" fill="#1a120b"/>
<ellipse cx="3.3" cy="-12.9" rx="1.5" ry="2.6" fill="#1a120b"/>
<circle cx="-3.6" cy="-13.8" r="0.5" fill="#fff" opacity="0.6"/>
<circle cx="3" cy="-13.8" r="0.5" fill="#fff" opacity="0.6"/>
<g class="be-ghosts">${ghosts}</g>
<g class="be-wings">${wings}</g>`;
  }

  class Bee {
    constructor(parent, opts = {}) {
      injectCSS();
      const id = 'be' + (++uid);
      const el = document.createElement('div');
      el.className = 'be';
      el.innerHTML = '<div class="be-shadow"></div>' +
        `<svg class="be-svg" viewBox="-24 -24 48 48" aria-hidden="true">${markup(id)}</svg>`;
      parent.appendChild(el);
      this.el = el;
      this.shadow = el.querySelector('.be-shadow');
      this.svg = el.querySelector('.be-svg');
      this.abd = el.querySelector('.be-abd');
      this.legs = [...el.querySelectorAll('.be-leg')];
      this.pollenEls = [...el.querySelectorAll('.be-pollen')];
      this.wings = [...el.querySelectorAll('.be-wing')];
      this.ghosts = [...el.querySelectorAll('.be-ghost')];
      this.wingGroup = el.querySelector('.be-wings');
      this.ghostGroup = el.querySelector('.be-ghosts');
      this.ants = [...el.querySelectorAll('.be-ant')];
      Object.assign(this, {
        x: 0, y: 0, heading: 0, alt: 0, bank: 0, bend: 0,
        fly: 1,            // 0~1
        wingHz: 26,        // 화면용 날갯짓 속도 (실제 벌보다 훨씬 느리게, 위상은 매 프레임 흔듦)
        scale: 1, pollen: 0,
        antenna: 0,        // 더듬이를 앞으로 모으는 정도(deg). 무언가를 볼 때 +
      }, opts);
      this.ph = Math.random() * TAU;
      this.gait = Math.random();
      this.t = rand(0, 100);
      this.px = this.x; this.py = this.y;
      this.antKick = 0; this.nextAntKick = rand(0.6, 2.5); this.antSide = 1;
      this.applyScale();
    }

    applyScale() {
      this._s = this.scale;
      this.shadow.style.width = (11 * this.scale).toFixed(1) + 'px';
      this.shadow.style.height = (25 * this.scale).toFixed(1) + 'px';
    }

    update(dt) {
      this.t += dt;
      const f = this.fly;
      // 날개 위상: 일정한 속도 + 매 프레임 약간의 흔들림 → 스트로브처럼 규칙적으로 안 보임
      if (f > 0.01) this.ph += dt * this.wingHz * TAU * (0.4 + 0.6 * f) + rand(-0.6, 0.6);
      // 바닥에서 이동한 거리만큼 걸음
      const moved = Math.hypot(this.x - this.px, this.y - this.py);
      this.px = this.x; this.py = this.y;
      const ground = clamp(1 - this.alt / 8, 0, 1);
      this.gait += (moved / (5.2 * this.scale)) * ground;
      // 더듬이 툭
      this.nextAntKick -= dt;
      if (this.nextAntKick <= 0) {
        this.nextAntKick = rand(0.5, 2.8);
        this.antKick = 1; this.antSide = Math.random() < 0.5 ? -1 : 1;
      }
      this.antKick = Math.max(0, this.antKick - dt * 5);
    }

    render() {
      if (this._s !== this.scale) this.applyScale();
      const f = this.fly;
      const s = this.scale * (1 + this.alt * 0.0035);
      const sx = 1 - 0.2 * Math.min(1, Math.abs(this.bank));
      this.el.style.transform = `translate3d(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px,0)`;
      this.svg.style.transform =
        `translate(-50%,-50%) rotate(${this.heading.toFixed(2)}deg) scale(${(s * sx).toFixed(4)},${s.toFixed(4)})`;

      // 그림자: 높을수록 멀고 흐리고 옅게. 날 때는 날개 잔상만큼 넓게
      const a = this.alt;
      const dx = (1.2 + a * 0.5) * 1, dy = (2 + a * 0.75);
      const spread = 1 + 1.5 * f * clamp(a / 18, 0, 1);
      this.shadow.style.transform =
        `translate(-50%,-50%) translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${this.heading.toFixed(1)}deg) scale(${spread.toFixed(3)},${(1 + a * 0.004).toFixed(3)})`;
      this.shadow.style.opacity = clamp(0.95 - a / 100, 0.18, 0.95).toFixed(3);
      this.shadow.style.filter = `blur(${(0.6 * this.scale + a * 0.06).toFixed(2)}px)`;

      // 날개
      const bank = this.bank;
      this.wings.forEach((w, i) => {
        const side = i < 2 ? 1 : -1;
        const W = WINGS[i % 2];
        const p = this.ph + W.lag;
        const sw = Math.sin(p);
        const ang = lerp(W.fold, W.mid + W.amp * sw, f);
        const chord = lerp(1, 0.35 + 0.65 * Math.abs(Math.cos(p)), f);
        const span = lerp(1, 0.86 + 0.14 * Math.abs(sw), f) * (1 - 0.35 * Math.max(0, side * bank));
        w.setAttribute('transform', `rotate(${ang.toFixed(1)}) scale(${span.toFixed(3)},${chord.toFixed(3)})`);
        const g = this.ghosts[i];
        const ang2 = lerp(W.fold, W.mid - W.amp * sw * 0.85, f);
        g.setAttribute('transform', `rotate(${ang2.toFixed(1)}) scale(${span.toFixed(3)},${(chord * 0.8).toFixed(3)})`);
      });
      this.wingGroup.setAttribute('opacity', lerp(0.95, 0.62, f).toFixed(3));
      this.ghostGroup.setAttribute('opacity', (f * 0.38).toFixed(3));

      // 다리: 삼각 보행 + 날 때 접기
      const walkAmt = clamp(1 - f * 1.5, 0, 1);
      this.legs.forEach((el, i) => {
        const side = i < 3 ? 1 : -1;
        const L = LEGS[i % 3];
        const grp = side > 0 ? L.g : 1 - L.g;
        const swing = Math.sin(this.gait * TAU + grp * Math.PI) * 13 * walkAmt;
        el.setAttribute('transform', `translate(${L.ax} ${L.ay}) rotate(${(swing + L.tuck * f).toFixed(1)})`);
      });
      const pr = (2.3 * this.pollen).toFixed(2);
      this.pollenEls.forEach((c) => c.setAttribute('r', pr));

      // 배 꺾기
      this.abd.setAttribute('transform', `rotate(${this.bend.toFixed(2)} 0 -1)`);

      // 더듬이: 느린 흔들림 + 가끔 툭
      const t = this.t;
      this.ants.forEach((el, i) => {
        const side = i === 0 ? 1 : -1;
        const k = this.antKick * this.antKick * (this.antSide === side ? 22 : 6);
        const wob = 7 * Math.sin(t * 1.9 + i * 2.1) + 4 * Math.sin(t * 4.7 + i);
        el.setAttribute('transform', `translate(1.3 -15.4) rotate(${(wob - k - this.antenna).toFixed(1)})`);
      });
    }

    remove() { this.el.remove(); }
  }

  function makeBee(parent, opts) { return new Bee(parent, opts); }

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

  global.BE = { makeBee, Bee, loop, clamp, lerp, rand, ease, damp, angDiff, RAD, TAU };
})(window);
