/* ============================================================
   풍뎅이 모션 키트 — examples/beetle/*.html 이 같이 씀
   window.BT = { makeBeetle, Gait, Spring, loop, ...도우미 }

   구조  .bt > .bt-plane(기울어진 바닥면) > .bt-shadow + .bt-rig(몸)
   .bt-rig 안의 부품은 전부 따로 떨어진 3D 요소 → 각각 돌려서 자세를 만든다
     다리 6개   : 기절(coxa) → 넓적다리(femur) → 종아리(tibia) → 발목마디(tarsus)
     배판·배    : 뒤집혔을 때 보이는 아랫면 / 딱지날개 밑 배
     뒷날개 2장 : 접힘(0) ↔ 펼침(1), 날갯짓 각도·앞뒤 휘젓기
     딱지날개 2장: 어깨 쪽 경첩을 축으로 들리며 벌어짐
     앞가슴등판·머리(+부채 모양 더듬이)
   좌표: 몸 기준 단위(px, scale 적용 전). 머리 = -y, 오른쪽 = +x, 위 = +z
   x, y 는 "바닥면" 좌표 — tilt 가 있으면 화면에선 y 가 cos(tilt) 만큼 눌려 보임
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
  const easeOutBack = (t, k = 1.8) => { t = clamp(t, 0, 1) - 1; return 1 + t * t * ((k + 1) * t + k); };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const f2 = (n) => n.toFixed(2);

  /** 부드러운 랜덤(-1~1). 서로 안 맞는 사인파 3개를 섞음 → 반복이 안 보임 */
  function makeNoise(freq = 1) {
    const f = [rand(0.8, 1.2) * freq, rand(1.9, 2.4) * freq, rand(3.3, 4.1) * freq];
    const p = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    return (t) => Math.sin(t * f[0] * TAU + p[0]) * 0.55 + Math.sin(t * f[1] * TAU + p[1]) * 0.3 + Math.sin(t * f[2] * TAU + p[2]) * 0.15;
  }

  /** 스프링: target 을 따라가며 출렁임. k 클수록 빠르고, c 작을수록 더 튐 */
  class Spring {
    constructor(x = 0, k = 120, c = 14) { this.x = x; this.v = 0; this.target = x; this.k = k; this.c = c; }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt / 0.006)), h = dt / n;
      for (let i = 0; i < n; i++) { this.v += (this.k * (this.target - this.x) - this.c * this.v) * h; this.x += this.v * h; }
      return this.x;
    }
  }

  /* ---------- 스타일 (한 번만 주입) ---------- */
  const CSS = `
.bt{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;pointer-events:none}
.bt div{position:absolute;left:0;top:0;transform-style:preserve-3d}
.bt svg{position:absolute;overflow:visible;display:block}
.bt .bt-shadow{left:-27px;top:-40px;width:54px;height:80px;border-radius:50%;transform-style:flat;
  background:radial-gradient(closest-side,var(--shade,rgba(0,0,0,.28)),transparent)}
.bt .bt-bone{border-radius:2px;transform-style:flat;background:linear-gradient(#8a6a34,#3a2a14 55%,#1e1508)}
.bt .bt-cox{border-radius:50%;background:radial-gradient(circle at 40% 35%,#6d5428,#241a0c)}
.bt .bt-tib1{border-radius:1px 3px 2px 1px;background:linear-gradient(#7a5c2c,#2c1f0d 60%)}
.bt .bt-tar{border-radius:1px;background:repeating-linear-gradient(90deg,#5e4522 0 2.2px,#1e1508 2.2px 2.8px)}
.bt .bt-claw{width:1.8px;height:2px;top:-1px;border:.5px solid #1e1508;border-left:0;border-radius:0 60% 60% 0;transform-style:flat}
.bt .bt-scape{border-radius:1px;transform-style:flat;background:linear-gradient(#6b4e24,#2c200e)}
.bt .bt-lam{width:4.4px;height:1.5px;top:-.75px;border-radius:50%;transform-style:flat;
  background:radial-gradient(ellipse at 40% 40%,#a7783c,#3c2a12)}
.bt .bt-fan{left:-56px;top:-19px;width:58px;height:42px;border-radius:50%;transform-style:flat;opacity:0;
  background:radial-gradient(ellipse at 100% 42%,rgba(238,230,208,.5),rgba(238,230,208,.16) 48%,transparent 70%)}
.bt .bt-fan.r{left:-2px;background:radial-gradient(ellipse at 0% 42%,rgba(238,230,208,.5),rgba(238,230,208,.16) 48%,transparent 70%)}
.bt .bt-wall{border-radius:4px;transform-style:flat}
`;
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return;
    cssDone = true;
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  let uid = 0;
  function mk(parent, cls, css) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (css) d.style.cssText = css;
    parent.appendChild(d);
    return d;
  }
  function svg(parent, w, h, x, y, inner) {
    parent.insertAdjacentHTML('beforeend',
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="left:${x}px;top:${y}px">${inner}</svg>`);
    return parent.lastElementChild;
  }

  /* ---------- 도안 (전부 SVG 코드로 그림) ---------- */
  // 딱지날개(왼쪽 기준, 안쪽 봉합선 = x 17). 오른쪽은 좌우 반전
  const ELY = 'M17 .2 L17 35.2 C15.6 36.8 13.2 36.9 10.8 35.6 C5.6 32.8 1.6 25.2 .9 15.5 C.5 9.6 1 4.4 3.4 1.9 C6.6 -.3 12.4 -.2 17 .2Z';
  function elytronSVG(id, right) {
    const g = right ? ' transform="translate(17 0) scale(-1 1)"' : '';
    return `<defs>
<linearGradient id="${id}a" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#123620"/><stop offset=".5" stop-color="#287233"/><stop offset="1" stop-color="#5aa848"/></linearGradient>
<linearGradient id="${id}b" x1="0" x2="0" y1="0" y2="1"><stop offset=".3" stop-color="#d4a640" stop-opacity="0"/><stop offset=".78" stop-color="#b98a30" stop-opacity=".4"/><stop offset="1" stop-color="#7e521a" stop-opacity=".7"/></linearGradient>
<radialGradient id="${id}c" cx=".55" cy=".15" r=".42"><stop offset="0" stop-color="#f2ffd8" stop-opacity="${right ? 0.4 : 0.85}"/><stop offset="1" stop-color="#f2ffd8" stop-opacity="0"/></radialGradient>
</defs><g${g}>
<path d="${ELY}" fill="url(#${id}a)"/><path d="${ELY}" fill="url(#${id}b)"/><path d="${ELY}" fill="url(#${id}c)"/>
<g fill="none" stroke="#0d2614" stroke-opacity=".3" stroke-width=".45">
<path d="M13.6 2 C13.6 14 13.8 26 13.4 34.4"/><path d="M10.2 1.4 C9.8 13 10.3 25 11 33.4"/><path d="M6.8 1.6 C5.8 11 6.4 22 8.2 31"/><path d="M3.6 3.6 C2.6 11 3 19 4.8 26"/></g>
<path d="M15.7 3 C15.9 13 15.7 25 14.9 33" fill="none" stroke="#f4ffe6" stroke-opacity="${right ? 0.3 : 0.5}" stroke-width=".9" stroke-linecap="round"/>
<path d="${ELY}" fill="none" stroke="#b48a34" stroke-opacity=".8" stroke-width=".6"/></g>`;
  }
  function pronotumSVG(id) {
    const P = 'M4 22.4 C1.2 18.5 .2 12 2.6 7 C5 2.6 10.5 .6 17 .6 C23.5 .6 29 2.6 31.4 7 C33.8 12 32.8 18.5 30 22.4 C25 23.6 9 23.6 4 22.4Z';
    return `<defs><radialGradient id="${id}p" cx=".4" cy=".3" r=".78"><stop offset="0" stop-color="#a6e070"/><stop offset=".32" stop-color="#3f9440"/><stop offset=".78" stop-color="#1a4824"/><stop offset="1" stop-color="#5e4a1a"/></radialGradient></defs>
<path d="${P}" fill="url(#${id}p)" stroke="#b48a34" stroke-opacity=".75" stroke-width=".6"/>
<ellipse cx="11" cy="7" rx="5.6" ry="2.1" transform="rotate(-18 11 7)" fill="#fff" opacity=".4"/>
<ellipse cx="24.5" cy="8" rx="3" ry="1.1" transform="rotate(16 24.5 8)" fill="#fff" opacity=".16"/>
<path d="M17 2.5 L17 21" stroke="#0d2614" stroke-opacity=".2" stroke-width=".5"/>`;
  }
  function headSVG(id) {
    return `<defs><radialGradient id="${id}h" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#76c052"/><stop offset=".55" stop-color="#25602c"/><stop offset="1" stop-color="#132c18"/></radialGradient></defs>
<path d="M3.2 15 C1.2 10.5 1.8 5 4.4 2.6 C7.4 .2 12.6 .2 15.6 2.6 C18.2 5 18.8 10.5 16.8 15Z" fill="url(#${id}h)" stroke="#9c7a2e" stroke-opacity=".6" stroke-width=".5"/>
<path d="M5.4 4.4 C8 2.8 12 2.8 14.6 4.4" fill="none" stroke="#0d2614" stroke-opacity=".35" stroke-width=".5"/>
<ellipse cx="2.7" cy="11.4" rx="2" ry="2.6" fill="#1b130a"/><ellipse cx="17.3" cy="11.4" rx="2" ry="2.6" fill="#1b130a"/>
<circle cx="2.2" cy="10.4" r=".7" fill="#fff" opacity=".55"/><circle cx="16.8" cy="10.4" r=".7" fill="#fff" opacity=".4"/>
<ellipse cx="8" cy="6" rx="3" ry="1.2" fill="#fff" opacity=".28"/>`;
  }
  function abdomenSVG() {
    let s = '<path d="M2 2 C1 12 3 24 8 30 C11 33 15 33 18 30 C23 24 25 12 24 2 C17 0 9 0 2 2Z" fill="#3c2d18"/>';
    for (let k = 0; k < 6; k++) {
      const y = 4 + k * 4.6, w = 11.6 - k * k * 0.22;
      s += `<path d="M${13 - w} ${y} Q13 ${y + 2.2} ${13 + w} ${y}" fill="none" stroke="#1c140a" stroke-width=".7"/>`;
      s += `<path d="M${13 - w + 1} ${y + 1.4} Q13 ${y + 3.2} ${13 + w - 1} ${y + 1.4}" fill="none" stroke="#7a5e34" stroke-opacity=".5" stroke-width=".6"/>`;
    }
    return s + '<ellipse cx="10" cy="8" rx="4" ry="2" fill="#fff" opacity=".1"/>';
  }
  function bellySVG(id) {
    // 아랫면: 머리 밑 → 앞가슴 → 가운데·뒷가슴 판 → 배 마디 5개. 옆쪽엔 옅은 털
    let s = `<defs><radialGradient id="${id}v" cx=".42" cy=".35" r=".8"><stop offset="0" stop-color="#4f6a34"/><stop offset=".6" stop-color="#26341a"/><stop offset="1" stop-color="#141c0d"/></radialGradient></defs>
<path d="M9 1.5 C11 -.3 19 -.3 21 1.5 C23 4 23 7 21 9 C19 10.5 11 10.5 9 9 C7 7 7 4 9 1.5Z" fill="#1e2814"/>
<path d="M12 1 L11 -2 M18 1 L19 -2" stroke="#3a2a14" stroke-width=".9"/>
<path d="M6 11 C10 9.5 20 9.5 24 11 L25 20 C20 22 10 22 5 20Z" fill="url(#${id}v)"/>
<path d="M3 21 C9 19 21 19 27 21 C29 27 28.5 33 27 36 C21 38 9 38 3 36 C1.5 33 1 27 3 21Z" fill="url(#${id}v)"/>
<path d="M15 21 L15 36" stroke="#0c1208" stroke-width=".5" opacity=".7"/>`;
    for (let k = 0; k < 5; k++) {
      const y = 38 + k * 5.2, w = 12.5 - k * 1.5;
      s += `<path d="M${15 - w} ${y} C${15 - w + 2} ${y + 4.6} ${15 + w - 2} ${y + 4.6} ${15 + w} ${y} C${15 + w - 3} ${y - 1} ${15 - w + 3} ${y - 1} ${15 - w} ${y}Z" fill="url(#${id}v)" stroke="#0c1208" stroke-width=".5"/>`;
    }
    for (let k = 0; k < 9; k++) {
      const y = 12 + k * 5.2, x = 3.6 + Math.abs(k - 4) * 0.5;
      s += `<circle cx="${x}" cy="${y}" r=".7" fill="#e6dcb8" opacity=".45"/><circle cx="${30 - x}" cy="${y + 1}" r=".7" fill="#e6dcb8" opacity=".45"/>`;
    }
    return s + '<ellipse cx="11" cy="26" rx="4" ry="2" fill="#fff" opacity=".12"/>';
  }
  function wingSVG(right) {
    const g = right ? ' transform="translate(52 0) scale(-1 1)"' : '';
    return `<g${g}><path d="M52 3 C40 .5 22 -.5 8 2.2 C2.5 3.4 0 6.2 1.2 9.4 C3 13.4 10 16 20 17.6 C32 19.4 44 16 52 9Z"
fill="rgba(226,216,190,.42)" stroke="rgba(110,80,40,.45)" stroke-width=".5"/>
<g fill="none" stroke="rgba(92,62,26,.6)" stroke-width=".55"><path d="M52 4 C38 2.4 22 2 9 3.6"/>
<path d="M50 6 C40 8 28 9.4 13 9.2"/><path d="M48 8.4 C40 12 30 14.4 21 15.6"/><path d="M31 9.6 C26 12 22 13 17 13.4"/></g>
<ellipse cx="21" cy="4" rx="3.4" ry="1.1" fill="rgba(110,70,30,.45)"/>
<path d="M26 2.6 C30 8 31 12 30 17" fill="none" stroke="rgba(255,255,255,.25)" stroke-width=".6"/></g>`;
  }

  /* ---------- 다리 정의 (오른쪽 기준; 왼쪽은 좌우 반전) ----------
     hip: 몸에 붙는 점, cox: 기절 방향(도, +는 뒤쪽), len: [기절, 넓적, 종아리, 발목]
     bend: 무릎이 접히는 방향, rest: 서 있을 때 발끝 위치, tar: 발목 꺾임 */
  const LEG_DEF = [
    { hip: [6, -13], cox: -38, len: [3.4, 10, 12, 8], bend: 1, rest: [20, -29], tar: -22 },
    { hip: [8, -1], cox: 6, len: [3.6, 11, 12.5, 9], bend: -1, rest: [27, 2], tar: 16 },
    { hip: [9, 7], cox: 34, len: [4, 12.5, 14.5, 10], bend: -1, rest: [23, 27], tar: 12 },
  ];
  const TRI = [0, 1, 0, 1, 0, 1]; // L1 L2 L3 R1 R2 R3 → (L1,R2,L3)=0, (R1,L2,R3)=1

  class Beetle {
    constructor(parent, opts = {}) {
      injectCSS();
      const id = 'bt' + (uid++) + '_';
      const el = mk(parent, 'bt');
      this.el = el;
      this.plane = mk(el, 'bt-plane');
      this.shadow = mk(this.plane, 'bt-shadow');
      this.rig = mk(this.plane, 'bt-rig');
      const rig = this.rig;

      // 다리 (몸 아래, z -2.6)
      this.legs = [];
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1, d = LEG_DEF[i % 3];
        const root = mk(rig, 'bt-leg');
        root.style.transform = `translate3d(${side * d.hip[0]}px,${d.hip[1]}px,-2.6px) scaleX(${side})`;
        const j0 = mk(root);
        mk(j0, 'bt-bone bt-cox', `width:${d.len[0] + 2}px;height:4.4px;top:-2.2px;left:-1px`);
        const j1 = mk(j0, '', `left:${d.len[0]}px`);
        mk(j1, 'bt-bone', `width:${d.len[1]}px;height:3.4px;top:-1.7px`);
        const j2 = mk(j1, '', `left:${d.len[1]}px`);
        mk(j2, 'bt-bone' + (i % 3 === 0 ? ' bt-tib1' : ''), `width:${d.len[2]}px;height:${i % 3 === 0 ? 3.2 : 2.6}px;top:${i % 3 === 0 ? -1.6 : -1.3}px`);
        const j3 = mk(j2, '', `left:${d.len[2] - 0.5}px`);
        mk(j3, 'bt-bone bt-tar', `width:${d.len[3]}px;height:1.5px;top:-.75px`);
        mk(j3, 'bt-claw', `left:${d.len[3] - 0.6}px`);
        const rest = { x: side * d.rest[0], y: d.rest[1] };
        this.legs.push({
          i, side, tri: TRI[i], root, j: [j0, j1, j2, j3],
          hip: { x: d.hip[0], y: d.hip[1] }, cox: d.cox, c: d.len[0], f: d.len[1], t: d.len[2],
          bend: d.bend, tarRest: d.tar, rest,
          foot: { x: rest.x, y: rest.y }, world: { x: 0, y: 0 },
          ik: true, lift: -16, fem: 0, tib: 0, tar: d.tar, swing: false,
        });
      }

      // 아랫면(배판)·배
      const belly = mk(rig);
      belly.style.transform = 'translateZ(-2px)';
      svg(belly, 30, 66, -15, -35, bellySVG(id));
      this.abdomen = mk(rig);
      svg(this.abdomen, 26, 33, -13, 0, abdomenSVG());

      // 뒷날개 + 날갯짓 잔상(fan)
      this.wing = []; this.fan = [];
      for (const s of [-1, 1]) {
        const fan = mk(rig, 'bt-fan' + (s > 0 ? ' r' : ''));
        const w = mk(rig);
        svg(w, 52, 24, s < 0 ? -52 : 0, -3, wingSVG(s > 0));
        this.wing.push(w); this.fan.push(fan);
      }
      this.wingSvg = this.wing.map((w) => w.firstElementChild);

      // 앞가슴등판 옆벽 (굴러갈 때 두께가 보이게)
      this.walls = [];
      for (const s of [-1, 1]) {
        const wall = mk(rig);
        wall.style.transform = `translate3d(${s * 14.4}px,-10px,4px) rotateY(90deg)`;
        this.walls.push(mk(wall, 'bt-wall', 'left:-4px;top:-6.5px;width:8px;height:13px;background:linear-gradient(90deg,#2f7034,#10280f)'));
      }
      // 딱지날개: 어깨(바깥 앞 모서리)가 경첩
      this.ely = [];
      for (const s of [-1, 1]) {
        const e = mk(rig);
        svg(e, 17, 37, s < 0 ? -1 : -16, -2, elytronSVG(id + (s < 0 ? 'L' : 'R'), s > 0));
        const wall = mk(e);
        wall.style.transform = `translate3d(${s * 0.4}px,17px,-4.5px) rotateY(90deg)`;
        this.walls.push(mk(wall, 'bt-wall', 'left:-4.5px;top:-13px;width:9px;height:26px;background:linear-gradient(90deg,#2c6a32,#0f2812)'));
        this.ely.push(e);
      }
      const scut = mk(rig);
      scut.style.transform = 'translateZ(8.3px)';
      svg(scut, 6, 7, -3, -2.4, '<path d="M0 0 L6 0 L3 6.6Z" fill="#2f7a36" stroke="#b48a34" stroke-opacity=".6" stroke-width=".5"/>');
      const pro = mk(rig);
      pro.style.transform = 'translateZ(8.2px)';
      svg(pro, 34, 24, -17, -24.5, pronotumSVG(id));

      // 머리 + 더듬이 (목을 축으로 살짝 돌 수 있음)
      this.head = mk(rig);
      svg(this.head, 20, 15, -10, -14, headSVG(id));
      this.antEl = [];
      for (const s of [-1, 1]) {
        const a = mk(this.head);
        mk(a, 'bt-scape', 'width:6.8px;height:1.2px;top:-.6px');
        const j = mk(a, '', 'left:6.6px');
        mk(j, 'bt-scape', 'width:2.4px;height:1.1px;top:-.55px');
        const lams = [];
        for (let k = 0; k < 3; k++) { const l = mk(j, '', 'left:2.1px'); mk(l, 'bt-lam'); lams.push(l); }
        this.antEl.push({ a, j, lams, s });
      }

      Object.assign(this, {
        x: 0, y: 0,          // 바닥면 위치(px)
        oy: 0,               // 바닥면이 기울어지는 기준 높이(화면 y). 바닥 그림과 맞출 때 씀
        tilt: 0,             // 시점 기울기(도). 0 = 바로 위에서
        scale: 1,
        heading: 0,          // 바라보는 방향(도). 0 = 화면 위
        alt: 4,              // 몸 높이 (4 = 다리로 서 있음)
        bob: 0,
        pitch: 0,            // + 머리 숙임, - 머리 듦
        roll: 0,             // 몸통 축 회전(도). 180 = 뒤집힘
        shift: 0,            // 구를 때 옆으로 밀리는 양
        sway: { x: 0, y: 0, h: 0 },
        headYaw: 0,
        headPull: 0,         // + 머리를 앞가슴 밑으로 움츠림
        open: [0, 0],        // 딱지날개 열림 0~1 (1 넘으면 튕김)
        wingU: [0, 0],       // 뒷날개 펼침 0~1
        wingElev: [0, 0],    // 날개 위아래(도)
        wingSweep: [0, 0],   // 날개 앞뒤(도)
        buzz: 0,             // 0~1 잔상 세기
        pump: 0,             // 배 늘였다 줄이기
        legShadow: false,    // 다리마다 그림자(들면 멀어짐). 3D 다리를 평면으로 눌러 그림
        ant: [{ a: -62, b: -16, fan: 0.35 }, { a: -62, b: -16, fan: 0.35 }],
      }, opts);
      this.render();
    }

    /** 바닥 좌표 → 몸 좌표 */
    toLocal(wx, wy) {
      const h = (this.heading + this.sway.h) / RAD, c = Math.cos(h), s = Math.sin(h);
      const dx = (wx - this.x) / this.scale - this.sway.x, dy = (wy - this.y) / this.scale - this.sway.y;
      return { x: c * dx + s * dy, y: -s * dx + c * dy };
    }
    /** 몸 좌표 → 바닥 좌표 */
    toWorld(lx, ly) {
      const h = (this.heading + this.sway.h) / RAD, c = Math.cos(h), s = Math.sin(h);
      return { x: this.x + this.scale * (this.sway.x + c * lx - s * ly), y: this.y + this.scale * (this.sway.y + s * lx + c * ly) };
    }
    /** 다리 역운동학: 발끝(몸 좌표)에 닿도록 넓적다리·종아리 각도 계산 */
    ik(L, x, y) {
      const fx = x * L.side, fy = y;
      const cr = L.cox / RAD;
      const bx = L.hip.x + Math.cos(cr) * L.c, by = L.hip.y + Math.sin(cr) * L.c;
      const dx = fx - bx, dy = fy - by;
      const d = clamp(Math.hypot(dx, dy), Math.abs(L.f - L.t) + 0.5, L.f + L.t - 0.05);
      const a = Math.atan2(dy, dx);
      const al = Math.acos(clamp((L.f * L.f + d * d - L.t * L.t) / (2 * L.f * d), -1, 1));
      const fem = a + L.bend * al;
      const kx = bx + Math.cos(fem) * L.f, ky = by + Math.sin(fem) * L.f;
      return { fem: fem * RAD, tib: Math.atan2(fy - ky, fx - kx) * RAD };
    }

    render() {
      const T = this.tilt / RAD, v = this.y - this.oy;
      this.el.style.transform = `translate3d(${f2(this.x)}px,${f2(this.oy + v * Math.cos(T))}px,${f2(v * Math.sin(T))}px)`;
      this.plane.style.transform = `rotateX(${f2(this.tilt)}deg) scale(${this.scale.toFixed(3)})`;
      const h = this.heading + this.sway.h;
      this.rig.style.transform =
        `translate3d(${f2(this.sway.x)}px,${f2(this.sway.y)}px,${f2(this.alt + this.bob)}px) rotateZ(${f2(h)}deg) ` +
        `translateX(${f2(this.shift)}px) rotateY(${f2(this.roll)}deg) rotateX(${f2(-this.pitch)}deg)`;

      // 그림자: 높이 뜰수록 오른쪽 아래로 멀어지고 커지고 흐려짐
      const up = Math.max(0, this.alt - 4);
      const hr = h / RAD;
      const sx = this.sway.x + Math.cos(hr) * this.shift + up * 0.32;
      const sy = this.sway.y + Math.sin(hr) * this.shift + up * 0.5;
      const wide = 1 + this.buzz * 0.35 * Math.max(this.wingU[0], this.wingU[1]);
      const sc = 1 + up * 0.006;
      const lng = 0.72 + 0.28 * Math.abs(Math.cos(this.pitch / RAD));
      this.shadow.style.transform = `translate(${f2(sx)}px,${f2(sy)}px) rotateZ(${f2(h)}deg) scale(${(sc * wide).toFixed(3)},${(sc * lng).toFixed(3)})`;
      this.shadow.style.opacity = clamp(1.05 - up / 110, 0.16, 1).toFixed(3);

      // 옆벽(몸 두께)은 옆으로 기울었을 때만 보이게 — 평소엔 원근 때문에 가장자리에 삐죽 보임
      const side = Math.abs(Math.sin(this.roll / RAD));
      const wallO = clamp((side - 0.2) * 2.5, 0, 1).toFixed(2);
      this.walls.forEach((w) => { w.style.opacity = wallO; });

      // 머리·배
      this.head.style.transform = `translate3d(0,${f2(-22 + this.headPull)}px,4px) rotateZ(${f2(this.headYaw)}deg)`;
      this.abdomen.style.transform = `translate3d(0,-1px,1px) scaleY(${(1 + this.pump * 0.09).toFixed(3)})`;

      // 딱지날개: 어깨 경첩을 축으로 안쪽 모서리가 들리고(rotateY), 꼬리가 바깥으로 벌어지고(rotateZ), 들림(rotateX)
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, o = this.open[i];
        this.ely[i].style.transform =
          `translate3d(${s * 16}px,-1px,${f2(8 + o * 2)}px) rotateZ(${f2(-s * 38 * o)}deg) rotateX(${f2(30 * o)}deg) rotateY(${f2(s * 42 * o)}deg)`;
      }
      // 뒷날개: 접힘 = 꼬리 쪽으로 눕고 작아짐. 펼침 = 옆으로 뻗음
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, u = clamp(this.wingU[i], 0, 1), e = ease(u);
        const rz = s * (92 * (1 - e) + 6 * e) - s * this.wingSweep[i] * e;
        const ry = -s * this.wingElev[i] * e;
        this.wing[i].style.transform =
          `translate3d(${s * 3.6}px,-1px,${f2(5.6 + e)}px) rotateZ(${f2(rz)}deg) rotateY(${f2(ry)}deg) scale(${f2(lerp(0.34, 1, e))},${f2(lerp(0.5, 1, e))})`;
        this.wingSvg[i].style.opacity = (1 - this.buzz * 0.45).toFixed(3);
        this.fan[i].style.transform = `translate3d(${s * 3.6}px,-1px,${f2(5.8 + e)}px) rotateZ(${f2(s * 6)}deg)`;
        this.fan[i].style.opacity = (this.buzz * e).toFixed(3);
      }

      // 더듬이 (a: 뿌리 각도, b: 곤봉 꺾임, fan: 곤봉 판 벌어짐)
      for (let i = 0; i < 2; i++) {
        const A = this.antEl[i], st = this.ant[i];
        A.a.style.transform = `translate3d(${A.s * 4.4}px,-12.4px,-.4px) scaleX(${A.s}) rotateZ(${f2(st.a)}deg)`;
        A.j.style.transform = `rotateZ(${f2(st.b)}deg)`;
        A.lams.forEach((l, k) => { l.style.transform = `rotateZ(${f2((k - 1) * (4 + st.fan * 16))}deg)`; });
      }

      // 다리
      for (const L of this.legs) {
        if (L.ik) { const r = this.ik(L, L.foot.x, L.foot.y); L.fem = r.fem; L.tib = r.tib; }
        L.j[0].style.transform = `rotateZ(${L.cox}deg)`;
        L.j[1].style.transform = `rotateZ(${f2(L.fem - L.cox)}deg) rotateY(${f2(-L.lift)}deg)`;
        L.j[2].style.transform = `rotateZ(${f2(L.tib - L.fem)}deg) rotateY(${f2(L.lift * 0.55)}deg)`;
        L.j[3].style.transform = `rotateZ(${f2(L.tar)}deg)`;
        if (this.legShadow) {
          // 빛은 왼쪽 위 → 그림자는 오른쪽 아래. 다리를 들수록 그림자가 멀어지고 흐려짐
          const k = 0.7 + Math.max(0, L.lift + 16) * 0.05;
          const c = Math.cos(hr), sn = Math.sin(hr);
          const lx = (c * 0.55 + sn * 0.8) * k * L.side, ly = (-sn * 0.55 + c * 0.8) * k;
          L.root.style.filter = `drop-shadow(${f2(lx)}px ${f2(ly)}px ${f2(0.4 + k * 0.4)}px rgba(20,30,20,${(0.42 - k * 0.06).toFixed(2)}))`;
        } else if (L.root.style.filter) L.root.style.filter = '';
      }
    }
  }

  /* ---------- 삼각 보행 (tripod gait) ----------
     L1·R2·L3 이 한 조, R1·L2·R3 이 한 조. 한 조가 딛고 미는 동안 다른 조는 들고 앞으로.
     디딘 발은 "바닥 좌표"에 고정 → 몸이 지나가며 다리가 자연히 뒤로 젖혀짐 (미끄러짐 없음)
     걸음 빈도 = 속도 / 보폭 → 빨리 걸으면 발도 빨라짐 */
  class Gait {
    constructor(b, opts = {}) {
      this.b = b;
      Object.assign(this, {
        stride: 13,       // 한 걸음 보폭(몸 단위)
        swing: 0.4,       // 한 주기 중 다리 든 시간 비율
        liftDeg: 30,      // 다리 드는 각도
        stanceLift: -16,  // 디딘 다리가 바닥을 누르는 각도
        minFreq: 1.3,     // 멈출 때 남은 발 정리 속도
        sway: 1,
        onPlant: null,    // (leg, worldPos) 발 디딜 때 호출
      }, opts);
      this.phase = Math.random();
      this.freq = 0;
      b.legs.forEach((L) => { L.off = L.tri * 0.5 + rand(-0.05, 0.05); });
      this.plantAll();
    }
    plantAll() {
      const b = this.b;
      b.legs.forEach((L) => {
        L.ik = true; L.swing = false; L.lift = this.stanceLift;
        L.foot = { x: L.rest.x, y: L.rest.y };
        L.world = b.toWorld(L.foot.x, L.foot.y);
      });
    }
    /** 지금 발 위치(몸 좌표 그대로)에서 바로 디딘 걸로 침 */
    plantHere() {
      const b = this.b;
      b.legs.forEach((L) => { L.ik = true; L.swing = false; L.world = b.toWorld(L.foot.x, L.foot.y); });
    }
    /** speed: 몸 단위/초(앞으로 +), omega: 도/초(시계방향 +) */
    step(dt, speed, omega) {
      const b = this.b;
      let err = 0, swinging = false;
      for (const L of b.legs) {
        if (L.swing) swinging = true;
        else { const p = b.toLocal(L.world.x, L.world.y); err = Math.max(err, Math.hypot(p.x - L.rest.x, p.y - L.rest.y)); }
      }
      let f = (Math.abs(speed) + Math.abs(omega / RAD) * 20) * (1 - this.swing) / this.stride;
      if (swinging || err > this.stride * 0.5) f = Math.max(f, this.minFreq);
      else if (f < 0.3) f = 0;
      this.freq = f === 0 ? 0 : lerp(this.freq, f, Math.min(1, dt * 8));
      this.phase = (this.phase + this.freq * dt) % 1;

      // 몸 흔들림: 조가 바뀔 때마다 좌우로 살짝 비틀림
      const k = clamp(this.freq / 2.2, 0, 1) * this.sway;
      const ph = this.phase * TAU;
      b.sway.h = lerp(b.sway.h, Math.sin(ph) * 2.2 * k, Math.min(1, dt * 12));
      b.sway.x = lerp(b.sway.x, Math.sin(ph + 0.7) * 0.9 * k, Math.min(1, dt * 12));
      b.bob = 0.45 * k * Math.cos(ph * 2);

      const Ts = (1 - this.swing) / Math.max(this.freq, 0.6);
      const reach = clamp(speed * Ts * 0.5, -this.stride * 0.55, this.stride * 0.55);
      const turn = clamp(omega * Ts * 0.5, -22, 22) / RAD;
      const c = Math.cos(turn), s = Math.sin(turn);
      for (const L of b.legs) {
        const p = (this.phase + L.off + 1) % 1;
        if (p < this.swing && this.freq > 0) {
          if (!L.swing) { L.swing = true; L.from = { x: L.foot.x, y: L.foot.y }; }
          const u = p / this.swing;
          const tx = c * L.rest.x - s * L.rest.y, ty = s * L.rest.x + c * L.rest.y - reach;
          const e = smooth(0, 1, u);
          L.foot.x = lerp(L.from.x, tx, e);
          L.foot.y = lerp(L.from.y, ty, e);
          L.lift = this.stanceLift + (this.liftDeg - this.stanceLift) * Math.pow(Math.sin(Math.PI * u), 0.8);
        } else {
          if (L.swing) {
            L.swing = false;
            L.world = b.toWorld(L.foot.x, L.foot.y);
            if (this.onPlant) this.onPlant(L, L.world);
          }
          const q = b.toLocal(L.world.x, L.world.y);
          L.foot.x = q.x; L.foot.y = q.y;
          L.lift = lerp(L.lift, this.stanceLift, Math.min(1, dt * 20));
        }
      }
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

  const makeBeetle = (parent, opts) => new Beetle(parent, opts);

  global.BT = {
    makeBeetle, Beetle, Gait, Spring, loop, makeNoise,
    clamp, lerp, rand, ease, easeOut, easeIn, easeOutBack, smooth, angDiff, RAD, TAU,
  };
})(window);
