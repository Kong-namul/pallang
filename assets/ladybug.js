/* ============================================================
   무당벌레 모션 키트 — examples/ladybug/*.html 이 같이 씀
   window.LB = { makeLadybug, loop, ...도우미 }

   makeLadybug(parent, opts) → 위에서 내려다본 무당벌레 하나 (SVG + 그림자)
     x, y      : 위치(px)
     heading   : 바라보는 방향(deg). 0 = 화면 위쪽, 시계 방향이 +
     size      : 몸길이(px)
     alt       : 바닥에서 높이 → 그림자가 멀어지고 몸이 살짝 커짐
     open      : 0~1. 딱지날개(겉날개) 벌림. 1을 살짝 넘겨도 됨(탁 튕기는 오버슈트)
     wings     : 0~1. 접혀 있던 속날개(막날개)를 펼침
     buzz      : 0~1. 속날개 떨림(잔상)
     tuck      : 0~1. 다리를 몸 밑으로 숨김 (죽은 척·비행)
     antFold   : 0~1. 더듬이를 접음
     look      : 머리만 좌우로 돌리는 각도(deg)
     alert     : 더듬이 움직임 빈도(0 = 얼어붙음, 1 = 평소, 3 = 바쁘게 더듬더듬)
     shade     : 0~1. 그림자 진하기

   walk(px)  : 움직인 거리만큼 다리를 굴림 → 속도와 발놀림이 항상 맞음
   update(dt): 더듬이·날개 떨림 갱신,  render(): 화면에 반영

   "종종걸음" 공식
   1) 삼각 보행(tripod): 앞·뒤 다리와 반대쪽 가운데 다리가 한 묶음, 두 묶음이 반 박자 어긋남
   2) 다리 한 박자 = 디딤 62%(천천히 뒤로) + 옮김 38%(휙 앞으로) → 비대칭
   3) 걸을 때 몸이 박자에 맞춰 좌우로 살짝 씰룩
   4) 등딱지 광택은 몸이 돌아도 화면의 빛 방향(왼쪽 위)에 고정 → 둥근 돔으로 읽힘
   5) 날 때: 딱지날개는 축(앞쪽 가운데)을 중심으로 벌어지며 폭이 줄고(원근),
      속날개는 뒤로 접힌 상태에서 옆으로 펴진 뒤 매 프레임 불규칙하게 쓸려 잔상을 만듦
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
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
      '.lb{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;will-change:transform}' +
      '.lb-shadow{position:absolute;left:-24px;top:-24px;width:48px;height:48px;border-radius:50%;' +
        'background:radial-gradient(closest-side,var(--shade,rgba(0,0,0,.26)) 45%,transparent)}' +
      '.lb-svg{position:absolute;left:-24px;top:-24px;width:48px;height:48px;overflow:visible;transform-origin:50% 50%}' +
      '.lb-leg path{fill:none;stroke:#1d1715;stroke-width:.9;stroke-linecap:round;stroke-linejoin:round}' +
      '.lb-ant path{fill:none;stroke:#1d1715;stroke-width:.55;stroke-linecap:round}' +
      '.lb-wing path{fill:rgba(252,244,222,.58);stroke:rgba(92,70,40,.55);stroke-width:.3;stroke-linejoin:round}' +
      '.lb-wing path.v{fill:none;stroke:rgba(92,70,40,.4);stroke-width:.25}' +
      '.lb-fan path{fill:rgba(255,250,235,.3)}';
    document.head.appendChild(st);
  }

  // ---- 모양: 머리가 위(-y). 오른쪽 기준, 왼쪽은 scale(-1,1)로 뒤집어 씀 ----
  const BLACK = '#1b1513';
  const ELY = 'M0 -6.7C4 -7.7 8.2 -6.7 9.7 -2.6C11.7 2.6 10.4 9.2 6 12.7C3.6 14.5 1.3 14.9 0 14.8Z';
  const HINGE = [0, -6.5];                         // 딱지날개 축
  const WING = 'M0 0C5 -4.4 15 -5.4 21 -2.4C23.4 -0.8 22.4 2.6 18 3.6C11 5 4 3.4 0 0Z';
  const WING_V = 'M0.6 0L19.5 -1.2M4 1.4L16 2.8M9 -0.6L12.5 3.6M5 -2.6L15 -4';
  const WROOT = [2.2, -4.6];                       // 속날개 뿌리
  const FAN = (() => {                             // 날개가 쓸고 지나가는 부채꼴(잔상)
    const r = 21.5, a0 = -34 / RAD, a1 = 30 / RAD;
    return `M0 0L${(r * Math.cos(a0)).toFixed(2)} ${(r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 0 1 ${(r * Math.cos(a1)).toFixed(2)} ${(r * Math.sin(a1)).toFixed(2)}Z`;
  })();
  // 다리: 붙는 곳, 모양, 앞뒤로 젓는 각도
  const LEGS = [
    { ax: 5.2, ay: -7.4, d: 'M0 0L3.8 -2.2L5.5 -5.3', swing: 15 },
    { ax: 7.2, ay: 1.2,  d: 'M0 0L5 0.4L7.3 2.7',     swing: 17 },
    { ax: 6.2, ay: 8.2,  d: 'M0 0L3.8 2.8L4.9 6.5',   swing: 15 },
  ];
  const side = (inner) => '<g>' + inner + '</g><g transform="scale(-1 1)">' + inner + '</g>';

  function markup(id, color) {
    const shadeGrad = (name) =>
      `<radialGradient id="${name}" gradientUnits="userSpaceOnUse" cx="-3" cy="0" r="17">` +
      '<stop offset="0" stop-color="#fff" stop-opacity=".36"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>' +
      '<stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".36"/></radialGradient>';
    const elytron = (g) =>
      `<g class="lb-ely"><path d="${ELY}" fill="${color}"/>` +
      `<path d="M0 -6.4C2.6 -6.1 2.8 -2.5 0 -2.1Z" fill="${BLACK}"/>` +                 // 가운데 점(반쪽)
      `<ellipse cx="2.9" cy="-5.5" rx="1.5" ry=".62" transform="rotate(-12 2.9 -5.5)" fill="#f8ead6"/>` +
      `<circle cx="6.4" cy="-1.3" r="1.9" fill="${BLACK}"/><ellipse cx="3.4" cy="4.7" rx="2.1" ry="2.3" fill="${BLACK}"/>` +
      `<circle cx="6" cy="8.9" r="1.5" fill="${BLACK}"/>` +
      `<path d="${ELY}" fill="url(#${g})" stroke="rgba(60,8,6,.55)" stroke-width=".35"/></g>`;
    const wing =
      `<g class="lb-fan"><path d="${FAN}"/></g>` +
      `<g class="lb-wing lb-ghost"><path d="${WING}"/></g>` +
      `<g class="lb-wing lb-main"><path d="${WING}"/><path class="v" d="${WING_V}"/></g>`;
    return (
      '<svg class="lb-svg" viewBox="-24 -24 48 48"><defs>' +
      shadeGrad('lbR' + id) + shadeGrad('lbL' + id) +
      `<radialGradient id="lbG${id}"><stop offset="0" stop-color="#fff" stop-opacity=".9"/>` +
      '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
      '<g class="lb-body">' +
        side(LEGS.map((l) => `<g class="lb-leg"><path d="${l.d}"/></g>`).join('')) +
        '<ellipse cx="0" cy="4" rx="6.9" ry="9.7" fill="#2b1c15"/>' +
        '<path d="M-5.7 0.4Q0 2 5.7 0.4M-6.4 4Q0 5.7 6.4 4M-5.7 7.6Q0 9.2 5.7 7.6M-3.9 10.9Q0 12.1 3.9 10.9" ' +
          'fill="none" stroke="#7a4424" stroke-width=".5" stroke-linecap="round"/>' +
        side(wing) +
        '<g class="lb-head">' +
          side('<g class="lb-ant"><path d="M0 0Q1.5 -2.1 3.3 -2.7"/><circle cx="3.3" cy="-2.7" r=".65" fill="' + BLACK + '"/></g>') +
          `<ellipse cx="0" cy="-12.9" rx="3.9" ry="2.7" fill="${BLACK}"/>` +
          '<circle cx="-1.75" cy="-13.9" r=".62" fill="#f4efe6"/><circle cx="1.75" cy="-13.9" r=".62" fill="#f4efe6"/>' +
        '</g>' +
        elytron('lbR' + id) + '<g transform="scale(-1 1)">' + elytron('lbL' + id) + '</g>' +
        `<path d="M-7.7 -5.5C-8.6 -9 -6 -12.1 0 -12.5C6 -12.1 8.6 -9 7.7 -5.5C4 -7.5 -4 -7.5 -7.7 -5.5Z" fill="${BLACK}"/>` +
        '<ellipse cx="-5.3" cy="-9.1" rx="2" ry="1.5" transform="rotate(-28 -5.3 -9.1)" fill="#f4efe6"/>' +
        '<ellipse cx="5.3" cy="-9.1" rx="2" ry="1.5" transform="rotate(28 5.3 -9.1)" fill="#f4efe6"/>' +
        `<ellipse class="lb-gloss2" rx="2.6" ry="1.1" fill="url(#lbG${id})" opacity=".35"/>` +
        `<ellipse class="lb-gloss" rx="3.8" ry="1.8" fill="url(#lbG${id})"/>` +
      '</g></svg>'
    );
  }

  /** 다리 한 박자: +1(앞) → -1(뒤) 천천히 디디고, 휙 앞으로 옮김 */
  function legSwing(p) {
    p -= Math.floor(p);
    return p < 0.62 ? lerp(1, -1, p / 0.62) : lerp(-1, 1, ease((p - 0.62) / 0.38));
  }
  function legLift(p) {
    p -= Math.floor(p);
    return p < 0.62 ? 0 : Math.sin(Math.PI * (p - 0.62) / 0.38);
  }

  function makeLadybug(parent, opts) {
    injectCSS();
    const id = ++uid;
    const o = Object.assign({ color: '#d9291b' }, opts);
    const el = document.createElement('div');
    el.className = 'lb';
    el.innerHTML = '<div class="lb-shadow"></div>' + markup(id, o.color);
    parent.appendChild(el);
    const all = (s) => Array.from(el.querySelectorAll(s));
    const shadow = el.querySelector('.lb-shadow');
    const svg = el.querySelector('.lb-svg');
    const legs = all('.lb-leg');           // [오른쪽 앞·가운데·뒤, 왼쪽 앞·가운데·뒤]
    const ely = all('.lb-ely');            // [오른쪽, 왼쪽]
    const fans = all('.lb-fan'), ghosts = all('.lb-ghost'), mains = all('.lb-main');
    const ants = all('.lb-ant');
    const head = el.querySelector('.lb-head');
    const gloss = el.querySelector('.lb-gloss'), gloss2 = el.querySelector('.lb-gloss2');
    const gR = el.querySelector('#lbR' + id), gL = el.querySelector('#lbL' + id);
    const ant = [{ v: 0, goal: 0, t: 0 }, { v: 0, goal: 0, t: 0.3 }];
    let ph = rand(0, TAU);
    let wingsShown = true;

    const lb = {
      el, x: 0, y: 0, heading: 0, size: 30, alt: 0,
      open: 0, wings: 0, buzz: 0, tuck: 0, antFold: 0, look: 0,
      alert: 1, shade: 1, gait: rand(0, 1), wag: 1,

      /** 움직인 거리(px)만큼 다리를 굴림. 뒤로 걸으면 음수 */
      walk(d) { this.gait += d / (0.62 * this.size); },
      /** 더듬이를 툭 */
      twitch(k) {
        for (const a of ant) { a.goal = rand(-26, 22) * (k || 1); a.t = rand(0.08, 0.3); }
      },
      update(dt) {
        for (const a of ant) {
          a.t -= dt * this.alert;
          if (a.t <= 0) { a.goal = rand(-20, 16); a.t = rand(0.12, 0.9); }
          a.v = damp(a.v, a.goal, 26, dt);
        }
        if (this.buzz > 0.01 && dt > 0) ph += rand(1.7, 2.9);   // 매 프레임 불규칙하게 → 잔상이 일정하지 않음
      },
      render() {
        const k = this.size / 26;
        const tuck = clamp(this.tuck, 0, 1);
        const h = this.heading + Math.sin(this.gait * TAU) * 2.2 * this.wag * (1 - tuck);
        el.style.transform = `translate3d(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px,0)`;
        svg.style.transform = `rotate(${h.toFixed(2)}deg) scale(${(k * (1 + this.alt * 0.004)).toFixed(4)})`;

        const sk = k * (1 + this.alt * 0.002);
        const open = Math.max(0, this.open);
        shadow.style.transform =
          `translate(${((1.5 + this.alt * 0.55) * k).toFixed(2)}px,${((2.5 + this.alt * 0.9) * k).toFixed(2)}px) ` +
          `rotate(${h.toFixed(1)}deg) scale(${((0.5 + 0.28 * Math.min(1, open)) * sk).toFixed(3)},${(0.6 * sk).toFixed(3)})`;
        shadow.style.opacity = (this.shade * clamp(1 - this.alt / 80, 0.12, 1)).toFixed(3);

        // 다리: 삼각 보행
        for (let i = 0; i < 6; i++) {
          const d = LEGS[i % 3];
          const p = this.gait + (((i % 3) === 1) !== (i >= 3) ? 0.5 : 0);
          const rot = -legSwing(p) * d.swing * (1 - tuck);
          const sc = lerp(1 + 0.1 * legLift(p), 0.3, tuck);
          legs[i].setAttribute('transform', `translate(${d.ax} ${d.ay}) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(3)})`);
        }

        // 머리·더듬이
        head.setAttribute('transform', `rotate(${this.look.toFixed(2)} 0 -9)`);
        const fold = clamp(this.antFold, 0, 1);
        for (let i = 0; i < 2; i++) {
          const a = lerp(ant[i].v, 78, fold);
          ants[i].setAttribute('transform', `translate(2.3 -14.5) rotate(${a.toFixed(2)}) scale(${(1 - 0.45 * fold).toFixed(3)})`);
        }

        // 딱지날개: 축을 중심으로 벌어지며 폭이 줄어듦(들려 올라간 원근)
        const et = `translate(${HINGE[0]} ${HINGE[1]}) rotate(${(-open * 64).toFixed(2)}) ` +
                   `scale(${(1 - 0.32 * Math.min(1.1, open)).toFixed(3)} 1) translate(${-HINGE[0]} ${-HINGE[1]})`;
        ely[0].setAttribute('transform', et);
        ely[1].setAttribute('transform', et);

        // 속날개
        const show = this.wings > 0.01;
        if (show !== wingsShown) {
          wingsShown = show;
          for (const g of [fans, ghosts, mains]) for (const n of g) n.style.display = show ? '' : 'none';
        }
        if (show) {
          const w = ease(this.wings), bz = clamp(this.buzz, 0, 1);
          const base = lerp(84, -8, w), len = lerp(0.4, 1.22, w);
          for (let i = 0; i < 2; i++) {
            const p = ph + i * 0.9;
            const a = base + 30 * bz * Math.sin(p);
            const chord = lerp(1, 0.45 + 0.55 * Math.abs(Math.cos(p)), bz);
            const root = `translate(${WROOT[0]} ${WROOT[1]})`;
            mains[i].setAttribute('transform', `${root} rotate(${a.toFixed(2)}) scale(${len.toFixed(3)} ${chord.toFixed(3)})`);
            mains[i].setAttribute('opacity', lerp(0.95, 0.55, bz).toFixed(2));
            ghosts[i].setAttribute('transform', `${root} rotate(${(base - 30 * bz * Math.sin(p * 1.31 + 1)).toFixed(2)}) scale(${len.toFixed(3)} ${(1 - 0.4 * bz).toFixed(3)})`);
            ghosts[i].setAttribute('opacity', (0.34 * bz).toFixed(2));
            fans[i].setAttribute('transform', `${root} rotate(${base.toFixed(2)}) scale(${len.toFixed(3)})`);
            fans[i].setAttribute('opacity', bz.toFixed(2));
          }
        }

        // 광택: 화면의 빛 방향(왼쪽 위)을 몸 좌표로 돌려 놓음
        const hr = h / RAD, c = Math.cos(hr), s = Math.sin(hr);
        const bx = -0.55 * c + -0.83 * s, by = 0.55 * s + -0.83 * c;
        const gx = bx * 5.4, gy = 3.4 + by * 5.6;
        gloss.setAttribute('transform', `translate(${gx.toFixed(2)} ${gy.toFixed(2)}) rotate(${(Math.atan2(by, bx) * RAD + 90).toFixed(1)})`);
        gloss.setAttribute('opacity', (0.62 * (1 - Math.min(1, open * 1.6))).toFixed(2));
        gloss2.setAttribute('transform', `translate(${(bx * 2.6).toFixed(2)} ${(-9.3 + by * 1.6).toFixed(2)}) rotate(${(Math.atan2(by, bx) * RAD + 90).toFixed(1)})`);
        gR.setAttribute('cx', (bx * 4.5).toFixed(2)); gR.setAttribute('cy', (3 + by * 4.5).toFixed(2));
        gL.setAttribute('cx', (-bx * 4.5).toFixed(2)); gL.setAttribute('cy', (3 + by * 4.5).toFixed(2));
      },
      remove() { el.remove(); },
    };
    delete o.color;
    Object.assign(lb, o);
    return lb;
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

  global.LB = { makeLadybug, loop, clamp, lerp, rand, ease, smooth, damp, angDiff, RAD, TAU };
})(window);
