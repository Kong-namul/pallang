/* ============================================================
   나방 모션 키트 — examples/moth/*.html 이 같이 씀 (탑뷰, moth.css 필요)
   window.MO = { makeMoth, Moth, Flit, Perch, loop, ...도우미 }

   Moth  : 날개·몸·더듬이·그림자를 매 프레임 그림 (DOM + 3D transform)
   Flit  : 파닥파닥 불규칙하게 나는 경로 (예제가 steer 만 정해 줌)
   Perch : 앉아 쉬기 ↔ 튀어 오르기 ↔ 내려앉아 자리 고르기

   "나방다움" 공식
   1) 날갯짓은 나비보다 빠르고(초당 6~9번) 얕게(위 52° ↔ 아래 -20°). 매 박자마다
      빠르기·세기가 랜덤 → 일정한 박자가 안 느껴짐
   2) 날개는 나비 키트와 같은 사슬(조각 10개, flex 0.14): 바깥 조각이 늦게 따라와 부드럽게 휨
   3) 쉴 때: 앞날개를 뒤로 젖혀(fold) 뒷날개·배를 덮는 삼각 지붕. 접을 땐 뒷날개 먼저,
      펼 땐 앞날개 먼저. open 을 올리면 앞날개만 앞으로 젖혀 뒷날개 눈알 무늬를 번쩍 보임
   4) shiver: 접은 채 파르르 떪 (19Hz + 30Hz 를 섞어 불규칙하게, 날개 끝이 더 떪)
   5) 더듬이·배는 스프링으로 한 박자 늦게 따라옴. 돌 때 바깥 날개를 더 크게 침(asym)
   6) 빛: setLight/addLight 로 빛 쪽 날개를 더 밝게, 그림자는 빛 반대쪽으로
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  /** 살짝 지나쳤다 돌아오는 ease-out */
  const easeOutBack = (t, s = 1.6) => { t = clamp(t, 0, 1) - 1; return t * t * ((s + 1) * t + s) + 1; };
  /** 프레임 속도와 무관하게 goal 로 다가감 */
  const approach = (v, goal, rate, dt) => goal + (v - goal) * Math.exp(-rate * dt);
  /** a 에서 b 로 가는 가장 짧은 각도 차 (라디안) */
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  /** 같은 것, 도(deg) 단위 */
  const degDiff = (a, b) => {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };
  /** 부드럽게 흔들리는 값 (-1~1). 안 맞는 주파수 3개를 섞어 반복이 안 보이게 */
  function noise(speed = 1) {
    const f = [rand(0.6, 0.9), rand(1.3, 1.9), rand(2.6, 3.7)].map((v) => v * speed);
    const p = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    return (t) => Math.sin(t * f[0] + p[0]) * 0.55 + Math.sin(t * f[1] + p[1]) * 0.3 + Math.sin(t * f[2] + p[2]) * 0.15;
  }
  /** 감쇠 스프링. s = { x, v } */
  function spring(s, goal, w, z, dt) {
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      s.v += (w * w * (goal - s.x) - 2 * z * w * s.v) * h;
      s.x += s.v * h;
    }
    return s.x;
  }
  /** 비대칭 날갯짓 각도. p: 0~1 박자 위치 (0 = 맨 위) */
  function flapAngle(p, up, down, split) {
    return p < split
      ? lerp(up, down, ease(p / split))
      : lerp(down, up, ease((p - split) / (1 - split)));
  }
  const wrap01 = (p) => ((p % 1) + 1) % 1;

  /* ---------- 날개·몸 그림 (SVG 를 코드로 만들어 data URI 로) ---------- */
  const TONES = {
    umber: { base: '#8d7157', dark: '#523d2d', pale: '#cdb492', line: '#35261b', hind: '#d9a05c', hindEdge: '#4f2f1e', iris: '#86a9bd', body: '#6a5442', fur: '#a48c6f' },
    ash:   { base: '#8e8c86', dark: '#4c4c4f', pale: '#d6d3ca', line: '#2c2c30', hind: '#cf8f78', hindEdge: '#43282b', iris: '#93b3c2', body: '#67655f', fur: '#b3afa5' },
    moss:  { base: '#84805f', dark: '#48472f', pale: '#cbc79d', line: '#2d2d1f', hind: '#dcb863', hindEdge: '#4a3a1c', iris: '#7fa7a0', body: '#646145', fur: '#a9a47d' },
    clay:  { base: '#a17c64', dark: '#5f4132', pale: '#dfc4a6', line: '#3b271d', hind: '#e3a877', hindEdge: '#55301f', iris: '#8aa6c4', body: '#7a5a47', fur: '#bb9d82' },
  };
  const FORE = 'M0 23C9 15 27 6 46.5 2.2C48.6 1.8 49.8 3 49.6 5.2C49 11 48 16 46 21.5C43.6 28.5 40 35 35.5 40.6C34.5 41.8 33.2 42 31.8 41.4C21 38 10 34 0 30.5Z';
  const HIND = 'M0 5C9 2.5 23 2.5 32.5 7C36.5 12.5 35.5 23 29 30C23 35.5 14 35 9 29C6 24.5 5 18 4.5 12C3.5 9 1.5 6.5 0 5Z';
  const uri = (w, h, body) =>
    'url("data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w * 4 + '" height="' + h * 4 + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>') + '")';
  /** 늘 같은 무늬가 나오는 난수 */
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const f1 = (v) => v.toFixed(1);

  function foreArt(c) {
    const r = seeded(7);
    let specks = '';
    for (let i = 0; i < 34; i++) {
      specks += '<circle cx="' + f1(4 + r() * 44) + '" cy="' + f1(3 + r() * 38) + '" r="' + f1(0.25 + r() * 0.4) + '" fill="' + (r() < 0.55 ? c.line : c.pale) + '" opacity="' + f1(0.25 + r() * 0.3) + '"/>';
    }
    const veins = [[47, 4], [48.5, 11], [46, 20], [41.5, 30], [35, 39]].map((p) => 'M2 26Q' + f1(p[0] * 0.5) + ' ' + f1(lerp(26, p[1], 0.42)) + ' ' + p[0] + ' ' + p[1]).join('');
    const dots = [[47.7, 6.5], [47.2, 11.5], [46, 16.8], [44.2, 22], [42, 27], [39.4, 31.8], [36.6, 36.4]].map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r=".75"/>').join('');
    const am = 'M12 11q3.2 4 .6 7.4q-2.6 3.6 .4 7.2q2.6 3.4-.4 7q-1 2-.6 6';                  // 안쪽 물결 띠
    const pm = 'M31.5 2q5.4 6.5 3.2 12.4q-2.6 5-1 9.4q1.4 5-3 9.4q-3 3-4 9';                  // 바깥 물결 띠
    const st = 'M40.5 1q4.2 8.4 1.6 16.6q-2.6 8-8 14.2q-2 3-3.6 10';                           // 가장자리 밝은 띠
    return uri(50, 46,
      '<defs><clipPath id="c"><path d="' + FORE + '"/></clipPath>' +
      '<linearGradient id="g" x1="0" y1=".62" x2="1" y2=".3"><stop offset="0" stop-color="' + c.dark + '"/><stop offset=".2" stop-color="' + c.base + '"/>' +
      '<stop offset=".7" stop-color="' + c.pale + '" stop-opacity=".0"/><stop offset="1" stop-color="' + c.dark + '" stop-opacity=".35"/></linearGradient></defs>' +
      '<path d="' + FORE + '" fill="' + c.base + '"/><path d="' + FORE + '" fill="url(#g)"/>' +
      '<g clip-path="url(#c)" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 6Q17.5 22 12 40L27.5 46Q34 24 32 0Z" fill="' + c.dark + '" opacity=".3"/>' +
      '<path d="M41 0Q46 12 40 26Q36 36 31 44L40 46L52 20L50 0Z" fill="' + c.pale + '" opacity=".22"/>' +
      '<path d="' + veins + '" stroke="' + c.line + '" stroke-width=".35" opacity=".3"/>' +
      specks +
      '<path d="' + am + '" stroke="' + c.pale + '" stroke-width="2.4" opacity=".5"/><path d="' + am + '" stroke="' + c.line + '" stroke-width=".85"/>' +
      '<path d="' + pm + '" stroke="' + c.pale + '" stroke-width="2.6" opacity=".5"/><path d="' + pm + '" stroke="' + c.line + '" stroke-width=".9"/>' +
      '<path d="' + st + '" stroke="' + c.pale + '" stroke-width="1.3" opacity=".6" stroke-dasharray="2.4 1.3"/>' +
      '<g fill="' + c.line + '" opacity=".75">' + dots + '</g>' +
      // 앞날개 눈알 무늬(작고 수수하게) + 작은 고리 무늬
      '<ellipse cx="25.5" cy="16.5" rx="3.5" ry="4.4" transform="rotate(-18 25.5 16.5)" fill="' + c.line + '" stroke="' + c.pale + '" stroke-width=".95"/>' +
      '<ellipse cx="25.9" cy="16.2" rx="1.25" ry="1.9" transform="rotate(-18 25.9 16.2)" fill="' + c.pale + '" opacity=".85"/>' +
      '<circle cx="17.6" cy="20.6" r="1.7" fill="' + c.base + '" stroke="' + c.pale + '" stroke-width=".6"/>' +
      '</g>' +
      '<path d="' + FORE + '" fill="none" stroke="' + c.line + '" stroke-width=".7" opacity=".55"/>');
  }
  function hindArt(c) {
    const veins = [[33, 9], [34, 19], [28, 29], [18, 33]].map((p) => 'M2 7Q' + f1(p[0] * 0.55) + ' ' + f1(lerp(7, p[1], 0.4)) + ' ' + p[0] + ' ' + p[1]).join('');
    return uri(36, 36,
      '<defs><clipPath id="c"><path d="' + HIND + '"/></clipPath>' +
      '<radialGradient id="g" cx="0" cy=".2" r=".75"><stop offset="0" stop-color="' + c.body + '"/><stop offset=".45" stop-color="' + c.hind + '"/><stop offset="1" stop-color="' + c.hind + '"/></radialGradient></defs>' +
      '<path d="' + HIND + '" fill="url(#g)"/>' +
      '<g clip-path="url(#c)" fill="none" stroke-linecap="round">' +
      '<path d="' + veins + '" stroke="' + c.hindEdge + '" stroke-width=".35" opacity=".35"/>' +
      '<path d="M31.4 8C34.6 14 33.4 22.6 27.8 28.2C23 32.6 15 32.4 10 27" stroke="' + c.hindEdge + '" stroke-width="3.4" opacity=".82"/>' +
      '<path d="M33.6 8C37 14 36 24 29.6 30.4C24 35.4 14 35 8.6 29" stroke="' + c.pale + '" stroke-width="1.1" opacity=".7"/>' +
      // 눈알 무늬: 밝은 테 → 검은 고리 → 푸른 홍채 → 검은 눈동자 → 흰 반짝임
      '<circle cx="20" cy="19.5" r="7.3" fill="' + c.pale + '" opacity=".55"/>' +
      '<circle cx="20" cy="19.5" r="6.3" fill="#17120f"/>' +
      '<circle cx="20" cy="19.5" r="4.5" fill="' + c.iris + '"/>' +
      '<circle cx="20.6" cy="20" r="2.5" fill="#0e0b0a"/>' +
      '<circle cx="18.7" cy="17.9" r=".95" fill="#fff" opacity=".9"/>' +
      '</g>' +
      '<path d="' + HIND + '" fill="none" stroke="' + c.hindEdge + '" stroke-width=".6" opacity=".5"/>');
  }
  function thoraxArt(c) {
    const r = seeded(21);
    let fur = '';
    for (let i = 0; i < 46; i++) {                       // 가슴 둘레 털: 뒤로 빗은 듯 살짝 기울임
      const a = (i / 46) * TAU + r() * 0.1, k0 = 0.66 + r() * 0.12, k1 = 1.0 + r() * 0.14;
      const x0 = 8 + Math.cos(a) * 6.1 * k0, y0 = 12 + Math.sin(a) * 6.8 * k0;
      const x1 = 8 + Math.cos(a) * 6.1 * k1, y1 = 12 + Math.sin(a) * 6.8 * k1 + 0.9;
      fur += 'M' + f1(x0) + ' ' + f1(y0) + 'L' + f1(x1) + ' ' + f1(y1);
    }
    let tuft = '';
    for (let i = 0; i < 16; i++) { const x = 3.6 + r() * 8.8, y = 7.5 + r() * 8; tuft += 'M' + f1(x) + ' ' + f1(y) + 'l' + f1(r() * 0.8 - 0.4) + ' ' + f1(1.6 + r() * 1.2); }
    return uri(16, 20,
      '<ellipse cx="8" cy="3.7" rx="3.3" ry="2.9" fill="' + c.body + '"/>' +
      '<circle cx="4.9" cy="3.9" r="1.55" fill="#15100c"/><circle cx="11.1" cy="3.9" r="1.55" fill="#15100c"/>' +
      '<circle cx="4.5" cy="3.4" r=".45" fill="#fff" opacity=".55"/><circle cx="10.7" cy="3.4" r=".45" fill="#fff" opacity=".55"/>' +
      '<ellipse cx="8" cy="12" rx="6.1" ry="6.8" fill="' + c.body + '"/>' +
      '<path d="' + fur + '" stroke="' + c.fur + '" stroke-width=".75" stroke-linecap="round" fill="none" opacity=".9"/>' +
      '<ellipse cx="8" cy="6.9" rx="4.9" ry="1.9" fill="' + c.fur + '"/>' +
      '<path d="' + tuft + '" stroke="' + c.pale + '" stroke-width=".5" stroke-linecap="round" fill="none" opacity=".5"/>' +
      '<path d="M8 8.5V17" stroke="' + c.line + '" stroke-width=".5" opacity=".35"/>');
  }
  function abdomenArt(c) {
    const r = seeded(33);
    let segs = '', fur = '';
    [6, 10, 13.8, 17.4, 20.6].forEach((y) => { const w = 3.9 - Math.max(0, y - 9) * 0.16; segs += 'M' + f1(5 - w) + ' ' + y + 'Q5 ' + f1(y + 1.7) + ' ' + f1(5 + w) + ' ' + y; });
    for (let i = 0; i < 22; i++) {
      const y = 2 + r() * 20, w = 3.9 - Math.max(0, y - 9) * 0.17, sgn = i % 2 ? 1 : -1;
      fur += 'M' + f1(5 + sgn * (w - 0.6)) + ' ' + f1(y) + 'l' + f1(sgn * 1.1) + ' ' + f1(1 + r());
    }
    return uri(10, 26,
      '<path d="M1.2 2C.4 8 1 17 3.4 23.4C4.2 25.6 5.8 25.6 6.6 23.4C9 17 9.6 8 8.8 2Z" fill="' + c.fur + '"/>' +
      '<path d="M1.2 2C.4 8 1 17 3.4 23.4C4.2 25.6 5.8 25.6 6.6 23.4C9 17 9.6 8 8.8 2Z" fill="' + c.body + '" opacity=".45"/>' +
      '<path d="' + segs + '" stroke="' + c.line + '" stroke-width=".7" fill="none" opacity=".5"/>' +
      '<path d="' + fur + 'M4 24l-.6 1.8M5 24.4v1.6M6 24l.6 1.8" stroke="' + c.fur + '" stroke-width=".6" stroke-linecap="round" fill="none"/>');
  }
  function antennaArt(c) {
    let barbs = '';
    for (let i = 0; i < 13; i++) {                       // 깃털 더듬이: 가운데 줄기 + 양옆 빗살
      const t = i / 12, y = 21 - t * 19.5, x = 4 - 0.5 * Math.sin(t * 2) + 1.7 * t * t;
      const L = 0.5 + 2.6 * Math.sin(Math.PI * (0.12 + 0.82 * t));
      barbs += 'M' + f1(x) + ' ' + f1(y) + 'l' + f1(-L) + ' ' + f1(-L * 0.55) + 'M' + f1(x) + ' ' + f1(y) + 'l' + f1(L) + ' ' + f1(-L * 0.55);
    }
    return uri(8, 22,
      '<path d="' + barbs + '" stroke="' + c.fur + '" stroke-width=".5" stroke-linecap="round" fill="none"/>' +
      '<path d="M4 22C3.5 15 3.8 8 5.6 1.4" stroke="' + c.body + '" stroke-width=".85" stroke-linecap="round" fill="none"/>');
  }
  const artCache = {};
  function artFor(tone) {
    if (!artCache[tone]) {
      const c = TONES[tone] || TONES.umber;
      artCache[tone] = { fore: foreArt(c), hind: hindArt(c), thx: thoraxArt(c), abd: abdomenArt(c), ant: antennaArt(c) };
    }
    return artCache[tone];
  }

  /* ---------- 날개 사슬 ---------- */
  const SEG = 10;   // 앞날개 조각 수 (moth.css 의 5px × 10)
  const SEGH = 6;   // 뒷날개 조각 수 (6px × 6)
  const chain = (n, i = 0) => (n ? '<span style="--i:' + i + '"><i></i>' + chain(n - 1, i + 1) + '</span>' : '');
  const MARKUP =
    '<div class="mo-plane"><div class="mo-shadow"></div><div class="mo-rig">' +
    '<div class="mo-wing mo-wing--h mo-l">' + chain(SEGH) + '</div><div class="mo-wing mo-wing--h mo-r">' + chain(SEGH) + '</div>' +
    '<div class="mo-abd"></div>' +
    '<div class="mo-wing mo-wing--f mo-r">' + chain(SEG) + '</div><div class="mo-wing mo-wing--f mo-l">' + chain(SEG) + '</div>' +
    '<div class="mo-thx"></div><div class="mo-ant"></div><div class="mo-ant"></div>' +
    '</div></div>';

  // 자세 상수 (deg). sweep = 날개를 뿌리 중심으로 뒤로 젖힌 각
  const SW_F_FLY = 4, SW_F_REST = 78;      // 앞날개: 날 때 / 쉴 때
  const SW_H_FLY = 8, SW_H_REST = 62;      // 뒷날개
  const REST_F = 9, REST_H = 3, FLAT = 5;  // 쉴 때 날개 기울기, 날개를 편 채 멈춘 각

  class Moth {
    constructor(parent, opts = {}) {
      const el = document.createElement('div');
      el.className = 'mo';
      el.innerHTML = MARKUP;
      parent.appendChild(el);
      this.el = el;
      const q = (s) => el.querySelector(s), qa = (s) => [...el.querySelectorAll(s)];
      this.plane = q('.mo-plane'); this.shadow = q('.mo-shadow'); this.rig = q('.mo-rig');
      this.wF = [q('.mo-wing--f.mo-l'), q('.mo-wing--f.mo-r')];       // [왼쪽, 오른쪽]
      this.wH = [q('.mo-wing--h.mo-l'), q('.mo-wing--h.mo-r')];
      this.sF = [qa('.mo-wing--f.mo-l span'), qa('.mo-wing--f.mo-r span')];   // 안쪽 → 바깥
      this.sH = [qa('.mo-wing--h.mo-l span'), qa('.mo-wing--h.mo-r span')];
      this.abdEl = q('.mo-abd'); this.antEl = qa('.mo-ant');
      Object.assign(this, {
        x: 0, y: 0,            // 화면 위치(px)
        heading: 0,            // 머리가 향하는 쪽(deg). 0 = 화면 위
        bank: 0, pitch: 0,     // 좌우·앞뒤 기울기(deg)
        alt: 1.5,              // 바닥(벽)에서 높이(px)
        scale: 1, tilt: 0,     // tilt 0 = 탑뷰
        tone: 'umber',         // 'umber' | 'ash' | 'moss' | 'clay'
        fold: 1,               // 0 = 펴고 날갯짓, 1 = 접어 쉼(삼각 지붕)
        open: 0,               // 0~1 쉬는 중에 앞날개를 젖혀 뒷날개 눈알 무늬를 보임
        shiver: 0,             // 0~1 파르르 떨림
        rate: 7,               // 초당 날갯짓 횟수
        up: 52, down: -20,     // 날개 최고·최저 각도 (나비 75/-15 보다 얕음)
        split: 0.44,           // 한 박자 중 내려치기 비율
        flex: 0.14,            // 날개 유연함 (나비 키트와 같은 값)
        ampK: 1,               // 날갯짓 세기 배율
        asym: 0,               // -1~1 좌우 세기 차 (돌 때 바깥 날개를 더 크게)
        bob: 3,                // 내려칠 때 떠오르는 높이
        shadowShift: 0.7,      // 높이 1px 당 그림자가 밀리는 양
        sunX: 0.5, sunY: 0.87, // 그림자가 밀리는 방향 (빛 반대쪽 단위 벡터)
        shadowAlpha: 1,
        antAim: 0,             // 0~1 더듬이를 앞으로 세움 (경계)
      }, opts);
      this.phase = Math.random();
      this.beatK = 1; this.amp = 1; this.lift = 0;
      this.t = rand(0, 100);
      this.lit = [1, 1, 1];                          // 왼날개, 오른날개, 몸
      this.onBeat = null;
      this._ant = [{ x: 40, v: 0 }, { x: 40, v: 0 }];
      this._tw = [0, 0]; this._twT = rand(0.5, 2);
      this._abd = { x: 0, v: 0 };
      this._ph = this.heading;
      this._aF = [0, 0]; this._aH = [0, 0]; this._swF = 0; this._swH = 0; this._sq = 1;
      this._bF = [new Array(SEG).fill(0), new Array(SEG).fill(0)];
      this._bH = [new Array(SEGH).fill(0), new Array(SEGH).fill(0)];
      this._jit = 0; this._cache = new Map(); this._litKey = '';
      this.setTone(this.tone);
    }

    setTone(tone) {
      this.tone = tone;
      const a = artFor(tone), s = this.el.style;
      s.setProperty('--mo-fore', a.fore); s.setProperty('--mo-hind', a.hind);
      s.setProperty('--mo-thx', a.thx); s.setProperty('--mo-abd', a.abd); s.setProperty('--mo-ant', a.ant);
    }

    /** 빛 계산 시작: 어디서나 고르게 받는 밝기 */
    setLight(ambient = 1) { this.lit[0] = this.lit[1] = this.lit[2] = ambient; }
    /** 화면 좌표 (lx, ly) 의 빛을 더함. 빛 쪽 날개가 더 밝아짐. reach = 밝기가 절반으로 줄어드는 거리 */
    addLight(lx, ly, power = 1, reach = 160) {
      const dx = lx - this.x, dy = ly - this.y, d = Math.hypot(dx, dy) || 1;
      const fall = power / (1 + (d / reach) * (d / reach));
      const h = this.heading / RAD;
      const side = clamp(((dx * Math.cos(h) + dy * Math.sin(h)) / d) * 1.5, -1, 1);   // +1 = 빛이 오른쪽
      this.lit[0] += fall * (0.55 - 0.45 * side);
      this.lit[1] += fall * (0.55 + 0.45 * side);
      this.lit[2] += fall * 0.6;
      return fall;
    }
    /** 포인터가 몸에 닿았나 (r = 여유 px) */
    hit(px, py, r = 0) {
      const h = this.heading / RAD, cx = this.x - Math.sin(h) * 8 * this.scale, cy = this.y + Math.cos(h) * 8 * this.scale;   // 접은 날개 삼각형의 가운데
      return Math.hypot(px - cx, py - cy) < 26 * this.scale + r;
    }

    update(dt) {
      this.t += dt;
      const t = this.t, fly = clamp(1 - this.fold, 0, 1);
      if (fly > 0.02) this.phase += dt * this.rate * this.beatK;
      if (this.phase >= 1) {
        this.phase %= 1;
        this.beatK = rand(0.78, 1.3);                              // 박자마다 빠르기가 다름
        this.amp = rand(0.6, 1.12) * (Math.random() < 0.1 ? 0.5 : 1);   // 가끔 헛날갯짓
        if (this.onBeat) this.onBeat(this);
      }
      const mid = (this.up + this.down) / 2, p = this.phase;
      const ang = (ph, k) => mid + (flapAngle(ph, this.up, this.down, this.split) - mid) * k;
      // 파르르: 19Hz + 30Hz
      const sh = this.shiver;
      const tr = sh > 0.001 ? (Math.sin(t * 119) * 0.6 + Math.sin(t * 187 + 1.3) * 0.4) * sh : 0;
      const tr2 = sh > 0.001 ? Math.sin(t * 151 + 0.7) * sh : 0;
      this._jit = tr2;
      // 접기: 뒷날개 먼저 접히고 앞날개가 나중에 덮음. open 은 앞날개를 더 많이 젖힘
      const fF = ease(this.fold * 1.35 - 0.35) * (1 - 0.9 * this.open);
      const fH = ease(this.fold * 1.35) * (1 - 0.86 * this.open);
      const stroke = -6 * Math.sin(TAU * p) * fly;                 // 내려칠 땐 날개가 앞으로, 올릴 땐 뒤로
      this._swF = lerp(SW_F_FLY + stroke, SW_F_REST, fF) + tr * 2.2;
      this._swH = lerp(SW_H_FLY + stroke * 0.6, SW_H_REST, fH) + tr * 1.5;
      this._sq = lerp(1, 0.5, fH);                                 // 뒷날개는 부채처럼 접힘
      for (let s = 0; s < 2; s++) {
        const k = this.amp * this.ampK * (1 + (s ? -1 : 1) * this.asym);
        const fa = FLAT + (ang(p, k) - FLAT) * fly;
        this._aF[s] = lerp(fa, REST_F, fF) + tr * 7 + (s ? 1 : -1) * tr2 * 1.5;
        this._aH[s] = lerp(fa - 5, REST_H, fH) + tr * 5;
        // 날개 휨: 바깥 조각일수록 조금 전 박자의 각도를 따라감
        let prev = ang(p, k);
        const bF = this._bF[s], bH = this._bH[s];
        for (let i = 1; i < SEG; i++) {
          const ai = ang(wrap01(p - this.flex * i / (SEG - 1)), k);
          bF[i] = (ai - prev) * fly + tr2 * 1.1 * (i / SEG);      // 떨 땐 날개 끝이 더 떪
          prev = ai;
        }
        prev = ang(p, k);
        for (let i = 1; i < SEGH; i++) {
          const ai = ang(wrap01(p - this.flex * (i * 6) / 45), k);
          bH[i] = (ai - prev) * fly + tr2 * 0.8 * (i / SEGH);
          prev = ai;
        }
      }
      const push = (this.up - flapAngle(p, this.up, this.down, this.split)) / (this.up - this.down);
      this.lift = this.bob * this.amp * push * fly;
      // 배: 몸이 돌면 반대쪽으로 늦게 따라옴
      const yaw = dt > 0 ? clamp(degDiff(this._ph, this.heading) / dt, -700, 700) : 0;
      this._ph = this.heading;
      spring(this._abd, clamp(-yaw * 0.035, -20, 20) + tr * 2, 26, 0.38, dt);
      // 더듬이: 날 땐 앞으로 벌리고, 쉴 땐 뒤로 눕히고, 경계하면 세움. 가끔 한쪽만 까딱
      if ((this._twT -= dt) <= 0) { this._twT = rand(0.5, 3); this._tw[Math.random() < 0.5 ? 0 : 1] = rand(-16, 14); }
      const alert = Math.max(this.antAim, sh, this.open);
      const base = lerp(lerp(30, 56, this.fold), 15, alert);
      for (let i = 0; i < 2; i++) {
        this._tw[i] *= Math.exp(-dt * 2.2);
        spring(this._ant[i], base + this._tw[i] + (i ? 1 : -1) * yaw * 0.02 + tr2 * 3, 30, 0.34, dt);
      }
    }

    _set(el, v) { if (this._cache.get(el) !== v) { this._cache.set(el, v); el.style.transform = v; } }

    render() {
      const f2 = (v) => v.toFixed(2);
      this._set(this.plane, `rotateX(${f2(this.tilt)}deg) scale(${this.scale.toFixed(3)})`);
      this._set(this.el, `translate3d(${f2(this.x)}px, ${f2(this.y)}px, 0)`);
      const h = this.heading + this._jit * 0.7;
      this._set(this.rig, `translateZ(${f2(this.alt + this.lift)}px) rotateZ(${f2(h)}deg) rotateX(${f2(this.pitch)}deg) rotateY(${f2(this.bank)}deg)`);
      for (let s = 0; s < 2; s++) {
        const mir = s ? '' : 'scaleX(-1) ';                        // 왼쪽 날개 = 오른쪽 날개의 반전
        this._set(this.wF[s], `${mir}translateZ(${s ? 0.8 : 1.1}px) rotateY(${f2(-this._aF[s])}deg) rotateZ(${f2(this._swF)}deg)`);
        this._set(this.wH[s], `${mir}rotateY(${f2(-this._aH[s])}deg) rotateZ(${f2(this._swH)}deg) scaleY(${this._sq.toFixed(3)})`);
        for (let i = 1; i < SEG; i++) this._set(this.sF[s][i], `rotateY(${f2(-this._bF[s][i])}deg)`);
        for (let i = 1; i < SEGH; i++) this._set(this.sH[s][i], `rotateY(${f2(-this._bH[s][i])}deg)`);
      }
      this._set(this.abdEl, `translateZ(0.4px) rotateZ(${f2(this._abd.x)}deg)`);
      this._set(this.antEl[0], `translate3d(-2.2px, 0, 5.2px) rotateZ(${f2(-this._ant[0].x)}deg) scaleX(-1)`);
      this._set(this.antEl[1], `translate3d(2.2px, 0, 5.2px) rotateZ(${f2(this._ant[1].x)}deg)`);
      // 밝기 (0.02 단위로만 바꿔서 다시 그리는 횟수를 줄임)
      const q = (v) => (Math.round(clamp(v, 0.1, 2.4) * 50) / 50).toFixed(2);
      const key = q(this.lit[0]) + q(this.lit[1]) + q(this.lit[2]);
      if (key !== this._litKey) {
        this._litKey = key;
        const st = this.el.style;
        st.setProperty('--lit-l', q(this.lit[0])); st.setProperty('--lit-r', q(this.lit[1])); st.setProperty('--lit-b', q(this.lit[2]));
      }
      // 그림자: 날 땐 넓고 흐리게, 앉으면 몸 바로 밑에 작고 진하게
      const fly = clamp(1 - this.fold, 0, 1);
      const spread = Math.max(0.3, Math.cos((this._aF[0] + this._aF[1]) * 0.5 / RAD));
      const sx = lerp(0.6, spread, fly) * (1 - 0.3 * this.open * this.fold) + 0.38 * this.open * this.fold;
      const hh = (this.alt + this.lift) * this.shadowShift + 1.5;
      this._set(this.shadow,
        `translate(${f2(hh * this.sunX)}px, ${f2(hh * this.sunY)}px) rotateZ(${f2(h)}deg) translateY(${f2(lerp(13, 0, fly))}px) scale(${sx.toFixed(3)}, ${lerp(0.92, 0.85, fly).toFixed(3)})`);
      const op = clamp(1.05 - this.alt / 110, 0.12, 1) * this.shadowAlpha;
      if (Math.abs(op - (this._op || 0)) > 0.01) { this._op = op; this.shadow.style.opacity = op.toFixed(2); }
    }
  }

  /**
   * 파닥파닥 불규칙 비행. step(dt, steer, speedGoal) 을 매 프레임 부름.
   *   steer     : 예제가 원하는 회전(rad/s). 여기에 흔들림·급회전(jink)이 더해짐
   *   speedGoal : 목표 속도(px/s). 박자마다 0.7~1.35배로 출렁임
   */
  class Flit {
    constructor(m, opts = {}) {
      this.m = m;
      Object.assign(this, {
        speed: 120, turnMax: 9,
        wobble: 2.4,          // 구불거림 세기(rad/s)
        jink: 1,              // 급회전 빈도·세기 배율 (0 이면 없음)
        kick: 55,             // 박자마다 옆으로 툭 튀는 힘
        altBase: 28, altRange: 9, alt: null,   // alt 를 숫자로 두면 그 높이를 따라감
        rateBase: 6.5,
      }, opts);
      this.theta = (m.heading - 90) / RAD;   // 나아가는 방향(rad). 0 = 화면 오른쪽
      this.v = 0; this.side = 0; this.sideGoal = 0; this.surge = 1; this.altKick = 0;
      this.t = rand(0, 60); this.n1 = noise(1.7); this.n2 = noise(0.45);
      this.jinkT = rand(0.2, 0.8); this.jinkV = 0; this.jinkLeft = 0; this.lastTurn = 0;
      m.onBeat = () => {
        this.sideGoal += rand(-1, 1) * this.kick;
        this.surge = rand(0.7, 1.35);
        this.altKick = rand(-1, 1);
      };
    }
    step(dt, steer = 0, speedGoal = this.speed) {
      const m = this.m;
      this.t += dt;
      let turn = steer + this.n1(this.t) * this.wobble;
      if (this.jink > 0 && (this.jinkT -= dt) <= 0) {              // 갑자기 홱 꺾기
        this.jinkT = rand(0.3, 1.0) / Math.max(0.3, this.jink);
        this.jinkV = (Math.random() < 0.5 ? -1 : 1) * rand(5, 11) * Math.min(1.5, this.jink);
        this.jinkLeft = rand(0.07, 0.15);
      }
      if (this.jinkLeft > 0) { this.jinkLeft -= dt; turn += this.jinkV; }
      turn = clamp(turn, -this.turnMax, this.turnMax);
      this.theta += turn * dt; this.lastTurn = turn;
      this.v += (speedGoal * this.surge - this.v) * Math.min(1, dt * 5);
      this.sideGoal *= Math.exp(-dt * 7);
      this.side += (this.sideGoal - this.side) * Math.min(1, dt * 16);
      const c = Math.cos(this.theta), s = Math.sin(this.theta);
      m.x += (c * this.v - s * this.side) * dt;
      m.y += (s * this.v + c * this.side) * dt;
      // 자세: 몸은 진행 방향을 조금 늦게 따라가고, 도는 쪽으로 기울고, 바깥 날개를 더 크게 침
      m.heading += degDiff(m.heading, this.theta * RAD + 90 + this.side * 0.2) * Math.min(1, dt * 16);
      m.bank += (clamp(turn * 5, -34, 34) - m.bank) * Math.min(1, dt * 9);
      m.asym += (clamp(turn * 0.045, -0.35, 0.35) - m.asym) * Math.min(1, dt * 10);
      m.rate += (this.rateBase + clamp(this.v / this.speed, 0, 2.4) * 1.7 - m.rate) * Math.min(1, dt * 4);   // 빠를수록 더 자주 침
      const altGoal = this.alt != null ? this.alt : this.altBase + this.altRange * this.n2(this.t);
      m.alt += (altGoal + this.altKick * 4 - m.alt) * Math.min(1, dt * 5);
    }
    /** 화면 가장자리에 가까우면 안쪽으로 도는 steer 값 */
    edge(W, H, margin = 40) {
      const m = this.m;
      const e = Math.max(0, (margin - m.x) / margin, (m.x - (W - margin)) / margin, (margin - m.y) / margin, (m.y - (H - margin)) / margin);
      return e > 0 ? angDiff(this.theta, Math.atan2(H / 2 - m.y, W / 2 - m.x)) * Math.min(2.5, e) * 5 : 0;
    }
  }

  /**
   * 앉아 쉬기 ↔ 날기. 상태: rest → crouch(움찔) → burst(튀어 오름) → fly → approach → land → settle(자리 고르기) → rest
   *   takeoff(fromX, fromY, power) : (fromX, fromY) 반대쪽으로 튀어 오름
   *   pick()  : 내려앉을 자리 { x, y, heading } 를 돌려주는 함수 (null 이면 더 날아다님)
   *   steer() : 나는 동안 더할 회전값을 돌려주는 함수 (예: 빛 쪽으로 끌림)
   */
  class Perch {
    constructor(m, flit, opts = {}) {
      this.m = m; this.f = flit;
      Object.assign(this, { S: 1, speed: flit.speed, margin: null, pick: null, steer: null, onLand: null, onTakeoff: null, flyMin: 1.6, flyMax: 3.6 }, opts);
      this.state = 'rest'; this.t = 0; this.spot = null; this.power = 1; this.flyFor = 2;
      this.from = null; this.adj = []; this.base = null;
    }
    get resting() { return this.state === 'rest' || this.state === 'settle'; }
    takeoff(fromX, fromY, power = 1) {
      if (!this.resting) return false;
      const m = this.m;
      let a = Math.atan2(m.y - fromY, m.x - fromX);
      if (!isFinite(a) || (fromX === m.x && fromY === m.y)) a = (m.heading - 90) / RAD;
      this.f.theta = a + rand(-0.7, 0.7);
      this.f.v = 0; this.f.side = this.f.sideGoal = 0;
      this.power = power; this.state = 'crouch'; this.t = 0; this.spot = null;
      this.flyFor = rand(this.flyMin, this.flyMax);
      if (this.onTakeoff) this.onTakeoff(this);
      return true;
    }
    step(dt, W, H) {
      const m = this.m, f = this.f, S = this.S, mg = this.margin == null ? 40 * S + 14 : this.margin;   // S = 화면 크기 배율, mg = 가장자리 여유
      this.t += dt;
      const t = this.t;
      switch (this.state) {
        case 'rest':
          m.fold = approach(m.fold, 1, 9, dt); m.alt = approach(m.alt, 1.5, 10, dt);
          m.bank = approach(m.bank, 0, 10, dt); m.pitch = approach(m.pitch, 0, 10, dt); m.asym = 0;
          break;
        case 'crouch':                                             // 예비동작: 몸을 붙이고 날개를 반쯤 엶
          m.fold = lerp(1, 0.4, easeOutCubic(t / 0.08)); m.shiver = Math.max(m.shiver, 0.8);
          m.alt = approach(m.alt, 0.5, 30, dt);
          if (t > 0.08) { this.state = 'burst'; this.t = 0; f.v = this.speed * 2.2 * S * this.power; m.rate = 10; m.shiver = 0; m.open = 0; }
          break;
        case 'burst': {                                            // 0.45초: 홱홱 꺾이며 튀어 오름
          m.fold = approach(m.fold, 0, 34, dt); m.shiver = 0;
          f.jink = 3; f.wobble = 5; f.alt = Math.min(34, 5 + t * 95);
          m.pitch = approach(m.pitch, 22, 12, dt);
          f.step(dt, f.edge(W, H, mg), lerp(this.speed * 2.1 * this.power, this.speed, t / 0.45) * S);
          if (t > 0.45) { this.state = 'fly'; this.t = 0; }
          break;
        }
        case 'fly': {
          m.fold = approach(m.fold, 0, 20, dt);
          f.jink = 1.3; f.wobble = 3; f.alt = null;
          m.pitch = approach(m.pitch, 8, 5, dt);
          f.step(dt, f.edge(W, H, mg) + (this.steer ? this.steer(this) : 0), this.speed * S);
          if (t > this.flyFor && this.pick) {
            const sp = this.pick(this);
            if (sp) { this.spot = sp; this.state = 'approach'; this.t = 0; }
          }
          break;
        }
        case 'approach': {                                         // 가까워질수록 낮고 느리게
          const sp = this.spot, dx = sp.x - m.x, dy = sp.y - m.y, d = Math.hypot(dx, dy);
          f.jink = 0.5; f.wobble = 1.6; f.alt = clamp(4 + d * 0.22, 4, 32);
          m.pitch = approach(m.pitch, 14, 5, dt);
          f.step(dt, angDiff(f.theta, Math.atan2(dy, dx)) * 6.5, clamp(d * 2.4, 45 * S, this.speed * S));
          if (d < 14 * S + 5 || t > 4.5) {
            this.from = { x: m.x, y: m.y, alt: m.alt, h: m.heading };
            this.land = { h: m.heading + degDiff(m.heading, sp.heading == null ? m.heading : sp.heading) };
            this.state = 'land'; this.t = 0;
          }
          break;
        }
        case 'land': {                                             // 0.38초: 날개를 크게 쳐 속도를 죽이며 내려앉음
          const k = Math.min(1, t / 0.38), e = easeOutCubic(k), sp = this.spot, fr = this.from;
          m.x = lerp(fr.x, sp.x, e); m.y = lerp(fr.y, sp.y, e);
          m.alt = lerp(fr.alt, 1.5, ease(k));
          m.heading = lerp(fr.h, this.land.h, ease(k));
          m.rate = lerp(8.5, 6, k); m.fold = approach(m.fold, 0, 20, dt);
          m.bank = approach(m.bank, 0, 12, dt); m.pitch = approach(m.pitch, 20, 8, dt); m.asym = approach(m.asym, 0, 10, dt);
          if (k >= 1) {
            // 자리 고르기 두 번: 처음엔 크게, 다음엔 작게 (반대쪽으로)
            const sgn = Math.random() < 0.5 ? -1 : 1;
            this.adj = [
              { at: rand(0.5, 0.72), dh: sgn * rand(7, 14), fwd: rand(2, 4.5) * S, dip: 0.24 },
              { at: rand(1.25, 1.6), dh: -sgn * rand(3, 6), fwd: rand(0.4, 1.4) * S, dip: 0.1 },
            ];
            this.base = { x: m.x, y: m.y, h: m.heading };
            this.done = this.adj[1].at + rand(0.5, 0.8);
            this.state = 'settle'; this.t = 0;
            if (this.onLand) this.onLand(this);
          }
          break;
        }
        case 'settle': {                                           // 날개를 두 단계로 접으며 몸을 고쳐 앉음
          let fold = 0.7 * ease((t - 0.14) / 0.3) + 0.3 * ease((t - 0.9) / 0.5);
          let h = this.base.h, x = this.base.x, y = this.base.y;
          for (const a of this.adj) {
            const e = easeOutCubic((t - a.at) / 0.16);
            h += a.dh * e;
            const hr = h / RAD;
            x += Math.sin(hr) * a.fwd * e; y -= Math.cos(hr) * a.fwd * e;
            fold -= a.dip * Math.sin(Math.PI * clamp((t - a.at) / 0.34, 0, 1));   // 고쳐 앉을 때 날개가 살짝 들림
          }
          m.heading = h; m.x = x; m.y = y; m.fold = clamp(fold, 0, 1);
          m.alt = 1.5 + 2.6 * Math.exp(-t * 9) * Math.abs(Math.sin(t * 22));       // 닿는 순간 살짝 통
          m.ampK = lerp(0.45, 1, clamp(1 - t / 0.5, 0, 1));
          m.bank = approach(m.bank, 0, 14, dt); m.pitch = approach(m.pitch, 0, 9, dt); m.asym = 0;
          if (t > this.done) { this.state = 'rest'; this.t = 0; m.ampK = 1; m.fold = 1; }
          break;
        }
      }
    }
  }

  /** 나방 하나를 parent 안에 만듦 */
  function makeMoth(parent, opts) { return new Moth(parent, opts); }

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

  global.MO = {
    makeMoth, Moth, Flit, Perch, loop, TONES, SEG, SEGH,
    clamp, lerp, rand, ease, easeOutCubic, easeOutBack, approach, angDiff, degDiff, noise, spring, flapAngle, RAD, TAU,
  };
})(window);
