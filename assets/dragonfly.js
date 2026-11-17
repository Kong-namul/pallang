/* ============================================================
   잠자리 모션 키트 — examples/dragonfly/*.html 이 같이 씀
   window.DF = { makeDragonfly, loop, ...도우미 }

   위에서 내려다본 잠자리를 인라인 SVG로 직접 그림 (외부 이미지 없음)
     .df(위치) > .df-shadow(그림자) + .df-rig(방향·기울기·깊이)
                  .df-rig > 날개 4장(+잔상) · 배 2마디 · 가슴/머리

   "잠자리다움" 공식
   1) 앞날개·뒷날개가 따로 움직임: 뒷날개가 위상을 앞섬
      (정지비행 ≈ 180° 반대 위상, 전진비행 ≈ 50~90°)
   2) 내려치기가 올리기보다 빠름 + 박자마다 진폭이 살짝 다름
   3) 실제 날갯짓(~30Hz)은 60fps에서 깜빡임(에일리어싱)이 되므로
      화면용 박자는 maxVisualRate 로 묶고, 잔상(ghost)으로 '빠름'을 표현
   4) 날개는 rotateY + perspective 로 원근 단축 → 올라온 날개 끝이 커짐
   5) 배(꼬리)는 관성으로 회전을 한 박자 늦게 따라옴 (스프링)
   6) 높이(alt) → 그림자 거리·옅기, 몸 크기(가까울수록 큼)
   ============================================================ */
(function (global) {
  'use strict';
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOutQuart = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t, 0, 1)));
  const easeInQuad = (t) => clamp(t, 0, 1) * clamp(t, 0, 1);
  /** 살짝 지나쳤다 돌아오는 ease-out. s 가 클수록 많이 넘침 */
  const easeOutBack = (t, s = 1.4) => {
    t = clamp(t, 0, 1) - 1;
    return t * t * ((s + 1) * t + s) + 1;
  };
  /** a 에서 b 로 가는 가장 짧은 각도 차 (도) */
  const angDiffDeg = (a, b) => {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };
  /** 부드럽게 흔들리는 값 (-1~1). 서로 안 맞는 주파수 3개를 섞어 반복이 안 보이게 */
  function wobble(speed = 1) {
    const f = [rand(0.6, 0.9), rand(1.3, 1.9), rand(2.6, 3.7)].map((v) => v * speed);
    const p = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
    return (t) => (Math.sin(t * f[0] + p[0]) * 0.55 + Math.sin(t * f[1] + p[1]) * 0.3 + Math.sin(t * f[2] + p[2]) * 0.15);
  }
  /** 비대칭 날갯짓 파형. p: 박자 위치(0~1), 0 = 위 끝(+1), split = 아래 끝(-1) */
  function strokeWave(p, split) {
    p -= Math.floor(p);
    return p < split
      ? Math.cos(Math.PI * p / split)
      : -Math.cos(Math.PI * (p - split) / (1 - split));
  }
  /** 고정 시드 난수 (날개맥 무늬가 매번 같게) */
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 공용 스타일 (한 번만 주입) ---------- */
  const STYLE =
    '.df{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;' +
    '--df-mem:rgba(228,241,245,.30);--df-edge:rgba(36,56,62,.55);--df-vein:rgba(36,56,62,.30);--df-ghost:rgba(222,238,243,.20)}' +
    '@media (prefers-color-scheme: dark){.df{--df-mem:rgba(196,222,232,.15);--df-edge:rgba(206,230,238,.55);' +
    '--df-vein:rgba(206,230,238,.28);--df-ghost:rgba(196,222,232,.10)}}' +
    '.df div{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}' +
    '.df svg{position:absolute;left:0;top:0;overflow:visible;display:block}' +
    '.df-w{will-change:transform}';
  function injectStyle() {
    if (document.getElementById('df-style')) return;
    const st = document.createElement('style');
    st.id = 'df-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  /* ---------- 기하: 단위 = 잠자리 1마리 기준 (몸길이 ≈ 110) ----------
     원점 = 가슴 가운데(날개 뿌리 근처), 머리 = -y 방향 */
  const GEO = {
    fore: { L: 60, c: 12, lead: 0.42, root: 0.28, bump: 0, shift: 0.12, rootX: 2.5, rootY: -17, sweep: -3, seed: 11 },
    hind: { L: 56, c: 13.5, lead: 0.36, root: 0.4, bump: 0.42, shift: 0.05, rootX: 2.5, rootY: -6, sweep: 11, seed: 23 },
  };
  const ABD1 = 34;   // 배 앞쪽 마디(S1~S5) 길이
  const ABD2 = 36;   // 배 뒤쪽 마디(S6~S10 + 꼬리끝) 길이

  /** 날개 폭 (u: 뿌리 0 → 끝 1) */
  function wingWidth(s, u) {
    const rootR = s.root + (1 - s.root) * Math.sin(Math.min(1, u / 0.3) * Math.PI / 2);
    const bump = 1 + s.bump * Math.exp(-Math.pow((u - 0.17) / 0.14, 2)); // 뒷날개 뿌리쪽 넓은 부분
    const t = Math.max(0, (u - 0.7) / 0.3);
    return s.c * rootR * bump * Math.sqrt(Math.max(0, 1 - t * t));        // 끝은 둥글게
  }
  /** u 위치에서 앞 가장자리 y, 뒷 가장자리 y */
  function wingEdges(s, u) {
    const w = wingWidth(s, u);
    const m = -s.c * (s.shift + 0.08 * u);
    return [m - w * s.lead, m + w * (1 - s.lead)];
  }
  const f2 = (v) => +v.toFixed(2);
  /** 점들을 Catmull-Rom 곡선으로 부드럽게 잇는 path */
  function smoothPath(pts, closed) {
    const n = pts.length;
    let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`;
    const P = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      d += `C${f2(p1[0] + (p2[0] - p0[0]) / 6)},${f2(p1[1] + (p2[1] - p0[1]) / 6)} ` +
           `${f2(p2[0] - (p3[0] - p1[0]) / 6)},${f2(p2[1] - (p3[1] - p1[1]) / 6)} ${f2(p2[0])},${f2(p2[1])}`;
    }
    return d + (closed ? 'Z' : '');
  }
  function wingOutline(s) {
    const N = 26, lead = [], trail = [];
    for (let i = 0; i <= N; i++) {
      const u = Math.sin((i / N) * Math.PI / 2);     // 끝쪽에 점을 촘촘히
      const [a, b] = wingEdges(s, u);
      lead.push([u * s.L, a]);
      if (i < N) trail.push([u * s.L, b]);
    }
    return smoothPath(lead.concat(trail.reverse()), true);
  }
  /** 날개맥: 세로맥(뿌리→끝으로 퍼짐) + 가로맥(그물) */
  function wingVeins(s, kind) {
    const rnd = seeded(s.seed);
    const longs = kind === 'fore'
      ? [[0.05, 9], [0.12, 6], [0.24, 3.3], [0.4, 2.1], [0.58, 1.5], [0.78, 1.05]]
      : [[0.04, 9], [0.1, 6], [0.2, 3.4], [0.33, 2.2], [0.48, 1.5], [0.64, 1.0], [0.8, 0.75]];
    const fAt = (v, u) => v[0] + (1 - v[0]) * Math.pow(u, v[1]);
    const pt = (u, f) => { const [a, b] = wingEdges(s, u); return [u * s.L, a + (b - a) * f]; };
    let long = '';
    for (const v of longs) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const u = 0.02 + (i / 20) * 0.97;
        if (fAt(v, u) > 0.97) break;
        pts.push(pt(u, fAt(v, u)));
      }
      if (pts.length > 2) long += smoothPath(pts, false);
    }
    let cross = '';
    const bands = [[0, () => 0]].concat(longs.map((v) => [0, (u) => fAt(v, u)]));
    bands.push([0, () => 1]);
    for (let k = 0; k < bands.length - 1; k++) {
      const fa = bands[k][1], fb = bands[k + 1][1];
      let u = 0.05 + rnd() * 0.03;
      const step = 0.024 + k * 0.002;
      while (u < 0.97) {
        const A = fa(u), B = Math.min(0.995, fb(u));
        if (B - A > 0.015) {
          const p = pt(u, A), q = pt(u + (rnd() - 0.5) * 0.012, B);
          cross += `M${f2(p[0])},${f2(p[1])}L${f2(q[0])},${f2(q[1])}`;
        }
        u += step * (0.7 + rnd() * 0.6);
      }
    }
    // 연문(pterostigma): 날개 끝 앞쪽의 진한 점
    const a0 = pt(0.8, 0), a1 = pt(0.875, 0), b1 = pt(0.875, 0.11), b0 = pt(0.8, 0.1);
    const stigma = `M${f2(a0[0])},${f2(a0[1])}L${f2(a1[0])},${f2(a1[1])}L${f2(b1[0])},${f2(b1[1])}L${f2(b0[0])},${f2(b0[1])}Z`;
    return { long, cross, stigma };
  }

  let uid = 0;
  const unit = (k) => `width="${k}" height="${k}" viewBox="0 0 1 1"`;

  function wingSVG(kind, k, hue) {
    const s = GEO[kind];
    const id = 'df' + (++uid);
    const out = wingOutline(s);
    const v = wingVeins(s, kind);
    const sw = (w) => f2(Math.max(w, 0.32 / k));    // 작게 그려도 맥이 사라지지 않게
    return `<svg ${unit(k)} aria-hidden="true"><defs>` +
      `<linearGradient id="${id}b" x1="0" x2="1"><stop offset="0" stop-color="hsl(${hue + 18} 80% 52%)" stop-opacity=".42"/>` +
      `<stop offset=".16" stop-color="hsl(${hue + 18} 80% 52%)" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset=".15" stop-color="#fff" stop-opacity="0"/>` +
      `<stop offset=".45" stop-color="#fff" stop-opacity=".9"/><stop offset=".75" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${out}" style="fill:var(--df-mem)"/>` +
      `<path d="${out}" fill="url(#${id}b)"/>` +
      `<path d="${v.cross}" fill="none" style="stroke:var(--df-vein)" stroke-width="${sw(0.2)}"/>` +
      `<path d="${v.long}" fill="none" style="stroke:var(--df-edge)" stroke-width="${sw(0.3)}" stroke-opacity=".8"/>` +
      `<path d="${out}" fill="none" style="stroke:var(--df-edge)" stroke-width="${sw(0.42)}"/>` +
      `<path d="${v.stigma}" fill="hsl(${hue} 45% 26%)"/>` +
      `<path class="df-glint" d="${out}" fill="url(#${id}g)" opacity="0"/></svg>`;
  }
  function ghostSVG(kind, k) {
    const out = wingOutline(GEO[kind]);
    return `<svg ${unit(k)} aria-hidden="true"><path d="${out}" style="fill:var(--df-ghost);stroke:var(--df-vein)" stroke-width="${f2(Math.max(0.3, 0.3 / k))}"/></svg>`;
  }

  /** 배(복부) 한 토막: 길이 len, 반폭 함수 hw(v), 마디 경계 rings */
  function abdomenSVG(k, hue, len, hw, rings, id, tip) {
    const L = [], R = [];
    for (let i = 0; i <= 24; i++) {
      const v = (i / 24) * len;
      L.push([-hw(v), v]); R.push([hw(v), v]);
    }
    const body = smoothPath(L.concat(R.reverse()), true);
    let ringD = '';
    for (const r of rings) {
      const w = hw(r) * 0.96;
      ringD += `M${f2(-w)},${f2(r - 0.5)}Q0,${f2(r + 0.9)} ${f2(w)},${f2(r - 0.5)}`;
    }
    const cerci = tip
      ? `<path d="M-0.9,${len - 1}L-1.8,${len + 4.2}M0.9,${len - 1}L1.8,${len + 4.2}" stroke="hsl(${hue} 40% 20%)" stroke-width="0.9" stroke-linecap="round"/>`
      : '';
    return `<svg ${unit(k)} aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1">` +
      `<stop offset="0" stop-color="hsl(${hue} 62% 24%)"/><stop offset=".3" stop-color="hsl(${hue} 74% 44%)"/>` +
      `<stop offset=".48" stop-color="hsl(${hue + 6} 88% 62%)"/><stop offset=".7" stop-color="hsl(${hue} 74% 42%)"/>` +
      `<stop offset="1" stop-color="hsl(${hue} 62% 22%)"/></linearGradient></defs>` + cerci +
      `<path d="${body}" fill="url(#${id})"/>` +
      `<path d="${ringD}" fill="none" stroke="hsl(${hue} 55% 18%)" stroke-width="0.55" stroke-opacity=".75"/>` +
      `<path d="M0,1L0,${len - 1}" stroke="hsl(${hue} 55% 20%)" stroke-width="0.35" stroke-opacity=".5"/></svg>`;
  }

  function headThoraxSVG(k, hue) {
    const id = 'df' + (++uid);
    const th = hue + 22;
    return `<svg ${unit(k)} aria-hidden="true"><defs>` +
      `<radialGradient id="${id}t" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="hsl(${th} 55% 58%)"/>` +
      `<stop offset=".55" stop-color="hsl(${th} 48% 38%)"/><stop offset="1" stop-color="hsl(${th} 45% 20%)"/></radialGradient>` +
      `</defs>` +
      // 접은 다리 (가슴 옆으로 살짝 보임)
      `<path d="M-5,-19L-8.6,-15.5M5,-19L8.6,-15.5M-5.5,-14L-9.2,-10M5.5,-14L9.2,-10M-5,-9L-8.4,-4.5M5,-9L8.4,-4.5" ` +
      `stroke="hsl(${hue} 30% 16%)" stroke-width="0.8" stroke-linecap="round" opacity=".7"/>` +
      `<ellipse cx="0" cy="-24" rx="3.6" ry="2.2" fill="hsl(${th} 40% 26%)"/>` +
      `<ellipse cx="0" cy="-12" rx="7" ry="12.2" fill="url(#${id}t)"/>` +
      `<path d="M-3.4,-21Q-4.6,-12 -3,-2M3.4,-21Q4.6,-12 3,-2" fill="none" stroke="hsl(${th} 50% 16%)" stroke-width="1.1" stroke-opacity=".7"/>` +
      `<path d="M0,-22.5L0,-2" stroke="hsl(${th} 40% 18%)" stroke-width=".5" stroke-opacity=".6"/>` +
      `</svg>`;
  }
  /** 머리(겹눈 + 이마). 목(0,-25)을 축으로 따로 돌릴 수 있게 분리 */
  function headSVG(k, hue) {
    const id = 'df' + (++uid);
    return `<svg ${unit(k)} aria-hidden="true"><defs>` +
      `<radialGradient id="${id}e" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="hsl(${hue} 70% 56%)"/>` +
      `<stop offset=".6" stop-color="hsl(${hue} 60% 34%)"/><stop offset="1" stop-color="hsl(${hue} 55% 18%)"/></radialGradient></defs>` +
      `<ellipse cx="0" cy="-26.6" rx="4.4" ry="2.4" fill="hsl(${hue + 30} 60% 62%)"/>` +
      `<ellipse cx="-5.4" cy="-31.4" rx="6" ry="5.6" fill="url(#${id}e)"/>` +
      `<ellipse cx="5.4" cy="-31.4" rx="6" ry="5.6" fill="url(#${id}e)"/>` +
      `<path d="M0,-36.4L0,-27.6" stroke="hsl(${hue} 55% 14%)" stroke-width=".5"/>` +
      `<ellipse cx="-7" cy="-34" rx="1.6" ry="1.1" fill="#fff" opacity=".55"/>` +
      `<ellipse cx="3.6" cy="-34.3" rx="1.1" ry=".8" fill="#fff" opacity=".4"/></svg>`;
  }

  function shadowSVG(k) {
    const id = 'df' + (++uid);
    return `<svg ${unit(k)} aria-hidden="true"><defs><filter id="${id}" filterUnits="userSpaceOnUse" x="-90" y="-60" width="180" height="150">` +
      `<feGaussianBlur stdDeviation="${f2(Math.max(1.6, 1 / k))}"/></filter></defs>` +
      `<g style="fill:var(--shade)" filter="url(#${id})"><ellipse cx="0" cy="-31" rx="10" ry="6"/><ellipse cx="0" cy="-12" rx="6.5" ry="12"/>` +
      `<ellipse cx="0" cy="34" rx="3" ry="36"/>` +
      `<g class="df-sw" opacity=".75"><ellipse cx="31" cy="-19" rx="30" ry="5.5" transform="rotate(-3 31 -19)"/>` +
      `<ellipse cx="-31" cy="-19" rx="30" ry="5.5" transform="rotate(3 -31 -19)"/>` +
      `<ellipse cx="28" cy="-3" rx="27" ry="7.5" transform="rotate(11 28 -3)"/>` +
      `<ellipse cx="-28" cy="-3" rx="27" ry="7.5" transform="rotate(-11 -28 -3)"/></g></g></svg>`;
  }

  /* ---------- 잠자리 ---------- */
  class Dragonfly {
    constructor(parent, opts = {}) {
      injectStyle();
      Object.assign(this, {
        x: 0, y: 0,          // 화면 위치(px) = 가슴 가운데
        heading: 0,          // 바라보는 방향(deg). 0 = 화면 위쪽, 시계방향 +
        bank: 0,             // 좌우 기울기(deg). + = 오른쪽 날개가 아래로
        pitch: 0,            // 앞뒤 기울기(deg). + = 머리 숙임
        alt: 36,             // 바닥(수면)에서 높이(px)
        size: 1,             // 1 = 몸길이 약 110px
        hue: 8,              // 8 = 고추잠자리 빨강, 200 근처 = 파란 잠자리
        rate: 28,            // 실제 날갯짓 횟수(Hz)
        maxVisualRate: 14,   // 화면에 그릴 때의 최대 박자 (에일리어싱 방지)
        phaseOffset: 90,     // 뒷날개가 앞서는 위상(도)
        amp: 32, bias: 6,    // 날개 각도 = bias ± amp
        hindAmp: 1.08,       // 뒷날개 진폭 배율
        split: 0.44,         // 내려치기 비율 (0.5보다 작을수록 빠른 내려치기)
        jitter: 0.12,        // 박자마다 진폭이 흔들리는 정도
        blur: null,          // 0~1 잔상 세기. null 이면 rate 로 자동
        abdBend: 0,          // 배를 옆으로 굽히는 각도(deg)
        abdDip: 0,           // 0~1, 배 끝을 아래로 내림 (위에서 보면 짧아짐)
        abdLag: 0.03,        // 회전할 때 배가 늦게 따라오는 정도
        headYaw: 0,          // 머리만 좌우로 돌리기(deg)
        foreSweep: 0,        // 날개를 앞(-)/뒤(+)로 젖히기(deg). 앉아 쉴 때 앞으로 숙임
        hindSweep: 0,
        manual: false,       // true 면 foreAngle/hindAngle 을 직접 넣음
      }, opts);
      this.phase = Math.random();
      this.ampCur = 1;
      this.ampTarget = 1;
      this.foreAngle = this.bias;
      this.hindAngle = this.bias;
      this.foreGhost = this.bias;
      this.hindGhost = this.bias;
      this.bend = 0; this.bendV = 0;
      this.prevHeading = this.heading;
      this.yawRate = 0;
      this.onBeat = null;    // 박자(내려치기 시작)마다 호출

      const el = document.createElement('div');
      el.className = 'df';
      el.innerHTML =
        '<div class="df-shadow"></div><div class="df-rig">' +
        '<div class="df-w df-hg"></div><div class="df-w df-hg"></div><div class="df-w df-h"></div><div class="df-w df-h"></div>' +
        '<div class="df-w df-fg"></div><div class="df-w df-fg"></div><div class="df-w df-f"></div><div class="df-w df-f"></div>' +
        '<div class="df-a1"><div class="df-a2"></div></div><div class="df-ht"></div><div class="df-hd"></div></div>';
      parent.appendChild(el);
      this.el = el;
      this.shadow = el.querySelector('.df-shadow');
      this.rig = el.querySelector('.df-rig');
      const q = (c) => Array.from(el.querySelectorAll(c));
      this.wings = { fore: q('.df-f'), hind: q('.df-h'), foreGhost: q('.df-fg'), hindGhost: q('.df-hg') }; // [왼, 오]
      this.abd1 = el.querySelector('.df-a1');
      this.abd2 = el.querySelector('.df-a2');
      this.thorax = el.querySelector('.df-ht');
      this.head = el.querySelector('.df-hd');
      this.setSize(this.size);
    }

    /** 크기 바꾸기 — SVG를 그 크기로 다시 그려서 확대해도 선명함 (리사이즈 때만 호출) */
    setSize(k) {
      this.size = k;
      const h = this.hue;
      const w = this.wings;
      w.fore.forEach((e) => { e.innerHTML = wingSVG('fore', k, h); });
      w.hind.forEach((e) => { e.innerHTML = wingSVG('hind', k, h); });
      w.foreGhost.forEach((e) => { e.innerHTML = ghostSVG('fore', k); });
      w.hindGhost.forEach((e) => { e.innerHTML = ghostSVG('hind', k); });
      this.glints = w.fore.concat(w.hind).map((e) => e.querySelector('.df-glint'));
      const hw1 = (v) => 4.1 - 1.3 * (v / ABD1) + 1.1 * Math.exp(-Math.pow((v - 7) / 5, 2));
      const hw2 = (v) => 2.8 + 0.35 * Math.exp(-Math.pow((v - 20) / 7, 2)) - 0.9 * Math.pow(v / ABD2, 3);
      // a1 안의 svg 는 첫 자식으로 넣어야 a2 가 그 위에 그려짐
      const a1svg = this.abd1.querySelector(':scope > svg');
      if (a1svg) a1svg.remove();
      this.abd1.insertAdjacentHTML('afterbegin', abdomenSVG(k, h, ABD1 + 1, hw1, [3, 9, 17, 25.5], 'df' + (++uid), false));
      this.abd2.innerHTML = abdomenSVG(k, h, ABD2, hw2, [8, 16, 23, 28.5, 32.5], 'df' + (++uid), true);
      this.thorax.innerHTML = headThoraxSVG(k, h);
      this.head.innerHTML = headSVG(k, h);
      this.shadow.innerHTML = shadowSVG(k);
      this.shadowWings = this.shadow.querySelector('.df-sw');
    }

    /** 날개 각도 계산 (manual 이면 건너뜀). dt: 초 */
    update(dt) {
      // 회전 속도 → 배의 관성(스프링: 살짝 넘쳤다 돌아옴)
      if (dt > 0) {
        const yr = angDiffDeg(this.prevHeading, this.heading) / dt;
        this.yawRate = lerp(this.yawRate, yr, Math.min(1, dt * 20));
      }
      this.prevHeading = this.heading;
      const goal = this.abdBend + clamp(-this.yawRate * this.abdLag, -18, 18);
      this.bendV += ((goal - this.bend) * 160 - this.bendV * 13) * dt;
      this.bend += this.bendV * dt;

      if (this.manual) return;
      const vr = Math.min(this.rate, this.maxVisualRate);
      this.phase += dt * vr;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.ampTarget = rand(1 - this.jitter, 1 + this.jitter * 0.6);
        if (this.onBeat) this.onBeat(this);
      }
      this.ampCur = lerp(this.ampCur, this.ampTarget, Math.min(1, dt * vr * 3));
      const off = this.phaseOffset / 360;
      const A = this.amp * this.ampCur;
      const lag = 0.22;
      this.foreAngle = this.bias + A * strokeWave(this.phase, this.split);
      this.hindAngle = this.bias + A * this.hindAmp * strokeWave(this.phase + off, this.split);
      this.foreGhost = this.bias + A * strokeWave(this.phase - lag, this.split);
      this.hindGhost = this.bias + A * this.hindAmp * strokeWave(this.phase + off - lag, this.split);
    }

    /** 전체 크기 배율 (높을수록 카메라에 가까워 살짝 큼) */
    depthScale() { return 1 + this.alt * 0.0022; }

    /** 배 끝의 화면 좌표 (물 찍기 파문 위치 등에 사용) */
    tipPoint() {
      const k = this.size * this.depthScale();
      const b1 = this.bend * 0.4 / RAD, b2 = this.bend / RAD;
      const sy = 1 - this.abdDip * 0.35;
      let lx = -Math.sin(b1) * ABD1 * sy, ly = Math.cos(b1) * ABD1 * sy;
      lx += -Math.sin(b2) * (ABD2 + 4) * sy; ly += Math.cos(b2) * (ABD2 + 4) * sy;
      const h = this.heading / RAD;
      return { x: this.x + (lx * Math.cos(h) - ly * Math.sin(h)) * k, y: this.y + (lx * Math.sin(h) + ly * Math.cos(h)) * k };
    }

    render() {
      const k = this.size, F = (v) => v.toFixed(2);
      const blur = this.blur == null ? clamp((this.rate - 9) / 12, 0, 1) : this.blur;
      this.el.style.transform = `translate3d(${F(this.x)}px,${F(this.y)}px,0)`;
      const ds = this.depthScale();
      this.rig.style.transform =
        `perspective(${F(900 * k)}px) rotate(${F(this.heading)}deg) rotateX(${F(this.pitch)}deg) rotateY(${F(this.bank)}deg) scale(${ds.toFixed(4)})`;

      // 날개: 뿌리 위치로 옮기고 → (왼쪽은 거울) → 뒤로 젖힘(sweep) → 원근 → 위아래 회전
      const P = F(300 * k);
      const place = (els, g, a, op, sweepAdd) => {
        for (let i = 0; i < 2; i++) {
          const sx = i === 0 ? -1 : 1;
          els[i].style.transform =
            `translate(${F(sx * g.rootX * k)}px,${F(g.rootY * k)}px) scaleX(${sx}) rotate(${F(g.sweep + sweepAdd)}deg) perspective(${P}px) rotateY(${F(-a)}deg)`;
          if (op != null) els[i].style.opacity = op;
        }
      };
      const w = this.wings;
      const ghostOp = blur > 0.02 ? (blur * 0.55).toFixed(3) : '0';
      place(w.fore, GEO.fore, this.foreAngle, (1 - blur * 0.3).toFixed(3), this.foreSweep);
      place(w.hind, GEO.hind, this.hindAngle, (1 - blur * 0.3).toFixed(3), this.hindSweep);
      place(w.foreGhost, GEO.fore, this.foreGhost, ghostOp, this.foreSweep);
      place(w.hindGhost, GEO.hind, this.hindGhost, ghostOp, this.hindSweep);
      this.head.style.transform = `translate(0,${F(-25 * k)}px) rotate(${F(this.headYaw)}deg) translate(0,${F(25 * k)}px)`;

      // 반짝임: 빛(왼쪽 위)을 향해 기운 날개면만 번쩍
      const hr = this.heading / RAD;
      const lx = -0.62 * Math.cos(hr) - 0.62 * Math.sin(hr) - Math.sin(this.bank / RAD) * 0.5;
      const angs = [this.foreAngle, this.foreAngle, this.hindAngle, this.hindAngle];
      for (let i = 0; i < 4; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const g = clamp(side * Math.sin(angs[i] / RAD) * lx * 2.2, 0, 1);
        this.glints[i].setAttribute('opacity', (g * 0.5 * (1 - blur * 0.5)).toFixed(3));
      }

      // 배: 두 토막으로 나눠 굽힘 → 곡선처럼 휨
      const sy = (1 - this.abdDip * 0.35).toFixed(3);
      this.abd1.style.transform = `translate(0,${F(-0.5 * k)}px) rotate(${F(this.bend * 0.4)}deg) scaleY(${sy})`;
      this.abd2.style.transform = `translate(0,${F(ABD1 * k)}px) rotate(${F(this.bend * 0.6)}deg)`;

      // 그림자: 높을수록 멀리(오른쪽 아래), 옅게, 날개는 펼친 정도만큼
      const ox = this.alt * 0.42, oy = this.alt * 0.7;
      this.shadow.style.transform =
        `translate(${F(ox)}px,${F(oy)}px) rotate(${F(this.heading)}deg) scale(${(1 + this.alt * 0.0012).toFixed(4)})`;
      this.shadow.style.opacity = clamp(1 - this.alt / 150, 0.2, 0.95).toFixed(3);
      const spread = (Math.cos(this.foreAngle / RAD) + Math.cos(this.hindAngle / RAD)) / 2;
      const cb = Math.cos(this.bank / RAD);
      this.shadowWings.setAttribute('transform', `scale(${(lerp(spread, 0.9, blur * 0.6) * cb).toFixed(3)},1)`);
    }

    remove() { this.el.remove(); }
  }

  function makeDragonfly(parent, opts) { return new Dragonfly(parent, opts); }

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

  global.DF = {
    makeDragonfly, Dragonfly, loop, GEO,
    clamp, lerp, rand, ease, easeOutQuart, easeOutExpo, easeInQuad, easeOutBack,
    angDiffDeg, wobble, strokeWave, RAD, TAU,
  };
})(window);
