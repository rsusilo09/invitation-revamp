import * as THREE from 'three';
import { cl, sg, ez, eo, lp, mixHex } from './easing';
import { FRAMES, TOTAL, TARGET, NSLIP, NMSG, RATE } from './timeline';

/**
 * Ported from the prototype's `Component extends DCLogic` class
 * (Prototipe 01-14 WebGL 90s EN.dc.html). This keeps the same imperative,
 * ref-driven, RAF-loop design — deliberately NOT React state — because the
 * whole point of the original is a single continuous 90s timeline driving
 * both a Three.js scene and DOM overlay opacity/transform every frame.
 * Re-rendering via React state on every tick would fight that design and
 * tank performance, so this class owns `t`/`phase`/`auto` itself and
 * mutates DOM/Three.js objects directly — exactly like the source.
 *
 * The React component (StoryboardStage.tsx) only supplies the DOM refs
 * (`RefMap`) and calls the public methods (open/nudge/pause/onSeek/...)
 * from event handlers; it does not re-render on every paint().
 */

export type RefMap = Record<string, HTMLElement>;

export type SceneControllerOptions = {
  photos?: [string, string]; // two photo URLs — currently unused; frame 03's photos are hardcoded <img> src in StoryboardStage.tsx
  onPhaseChange?: (phase: 'sealed' | 'opening' | 'playing') => void;
};

export class SceneController {
  r: RefMap;
  t = 0;
  phase: 'sealed' | 'opening' | 'playing' = 'sealed';
  auto = false;
  idle = 0;
  ready = false;
  fps = 0;
  debug = false;
  reduced = false;
  envOpen = false;
  scale = 1;

  private opts: SceneControllerOptions;
  private raf = 0;
  private last = 0;
  private fcount = 0;
  private ftime = 0;
  private wasDark = false;
  private errLogged = false;
  private drag = false;
  private moved = 0;
  private py = 0;
  private dTarget: EventTarget | null = null;

  private rn!: THREE.WebGLRenderer;
  private sc!: THREE.Scene;
  private cam!: THREE.PerspectiveCamera;
  private amb!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private shA!: THREE.Mesh;
  private shB!: THREE.Mesh;
  // Frame 04 crack background — was a single static gradient (see setup())
  // the whole frame through; paint() now tints it warm→cool as the crack
  // widens (2026-09-12, user feedback: "background masih sama, seharusnya
  // berubah warna"). Two reusable Color instances so paint() isn't
  // allocating one every frame.
  private rift!: THREE.Mesh;
  private riftWarm = new THREE.Color('#FFFFFF');
  private riftCool = new THREE.Color('#4A5568');
  private riftTint = new THREE.Color();
  private slips: THREE.Mesh[] = [];
  // Frame 07's full monogram reveal — an embedded SVG document (see the
  // `monoReveal` <object> in StoryboardStage.tsx) rather than a Three.js
  // mesh, so its ring/laurel/initials/wordmark sub-groups can be revealed
  // on independent staggered timings (the concept doc's "menyusun diri satu
  // per satu" note) instead of only ever fading in as one flat texture.
  // Populated once the <object> fires `load`; paint() no-ops on these until
  // then.
  private monoRevealParts: {
    ring?: SVGElement | null;
    laurelL?: SVGElement | null;
    laurelR?: SVGElement | null;
    amp?: SVGElement | null;
    initialR?: SVGElement | null;
    initialE?: SVGElement | null;
    wordmark?: SVGElement | null;
  } = {};

  private fit = () => {};
  private onWheel = (_e: WheelEvent) => {};
  private onDown = (_e: Event) => {};
  private onMove = (_e: Event) => {};
  private onUp = () => {};
  private onKey = (_e: KeyboardEvent) => {};
  private onVis = () => {};

  constructor(r: RefMap, opts: SceneControllerOptions = {}) {
    this.r = r;
    this.opts = opts;
  }

  private setPhase(p: 'sealed' | 'opening' | 'playing') {
    this.phase = p;
    this.opts.onPhaseChange?.(p);
  }

  // Wires the frame-07 `monoReveal` <object> (see StoryboardStage.tsx) once
  // its SVG document has actually loaded — <object> loads asynchronously and
  // independently of React's render, so this can fire well after mount().
  // Reaches into the embedded SVG's own DOM (`contentDocument`, same-origin
  // so this is allowed) to grab the named sub-groups the asset already has
  // (`#ring`, `#laurel-left`, `#laurel-right`, `#ampersand`, the two <path>
  // children of `#initials`, `#wordmark`) and starts each at opacity 0 —
  // paint() then drives them in on independent staggered timings so the
  // monogram visibly assembles piece by piece (concept doc: "ring, laurel,
  // dan huruf R&E menyusun diri satu per satu") instead of fading in as one
  // flat texture the way the old `mono` Three.js mesh could only ever do.
  private wireMonoReveal() {
    const obj = this.r.monoReveal as HTMLObjectElement | undefined;
    if (!obj) return;
    const grab = () => {
      const doc = obj.contentDocument;
      if (!doc) return;
      const parts = this.monoRevealParts;
      parts.ring = doc.getElementById('ring') as unknown as SVGElement | null;
      parts.laurelL = doc.getElementById('laurel-left') as unknown as SVGElement | null;
      parts.laurelR = doc.getElementById('laurel-right') as unknown as SVGElement | null;
      parts.amp = doc.getElementById('ampersand') as unknown as SVGElement | null;
      parts.wordmark = doc.getElementById('wordmark') as unknown as SVGElement | null;
      const initials = doc.getElementById('initials');
      const initialPaths = initials ? Array.from(initials.querySelectorAll('path')) : [];
      parts.initialR = (initialPaths[0] as unknown as SVGElement) ?? null;
      parts.initialE = (initialPaths[1] as unknown as SVGElement) ?? null;
      Object.values(parts).forEach((el) => {
        if (el) (el as SVGElement).style.opacity = '0';
      });
    };
    if (obj.contentDocument && obj.contentDocument.readyState === 'complete') grab();
    else obj.addEventListener('load', grab, { once: true });
  }

  mount() {
    try {
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.reduced = false;
    }
    this.debug = /debug/.test(location.search);
    if (this.debug) (window as unknown as { __stage?: unknown }).__stage = this;

    this.fit = () => {
      const st = this.r.stage,
        fr = this.r.frame;
      if (!st || !fr) return;
      this.scale = Math.min(st.clientWidth / 1080, st.clientHeight / 1920);
      fr.style.transform = 'scale(' + this.scale + ')';
      if (this.rn) this.rn.setPixelRatio(cl(this.scale * (window.devicePixelRatio || 1), 0.55, 1.6));
    };
    this.fit();
    window.addEventListener('resize', this.fit);
    this.bindInput();
    this.setup();
  }

  unmount() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.fit);
    window.removeEventListener('mousemove', this.onMove as EventListener);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('blur', this.onUp);
    window.removeEventListener('keydown', this.onKey as EventListener);
    document.removeEventListener('visibilitychange', this.onVis);
    if (this.rn) this.rn.dispose();
  }

  private scrollable(target: EventTarget | null, dy: number): boolean {
    let n = target as HTMLElement | null;
    while (n && n !== this.r.stage) {
      if (n.dataset && n.dataset.scroll) {
        const room = n.scrollHeight - n.clientHeight;
        if (room > 2) {
          if (dy > 0 && n.scrollTop < room - 1) return true;
          if (dy < 0 && n.scrollTop > 1) return true;
        }
      }
      n = n.parentElement;
    }
    return false;
  }

  private bindInput() {
    this.onWheel = (e: WheelEvent) => {
      if (this.scrollable(e.target, e.deltaY)) return;
      this.nudge(e.deltaY * 0.026);
      e.preventDefault();
    };
    this.onDown = (e: Event) => {
      const te = e as TouchEvent & MouseEvent;
      this.py = te.touches ? te.touches[0].clientY : te.clientY;
      this.drag = true;
      this.moved = 0;
      this.dTarget = e.target;
    };
    this.onMove = (e: Event) => {
      if (!this.drag) return;
      const te = e as TouchEvent & MouseEvent;
      const y = te.touches ? te.touches[0].clientY : te.clientY;
      const d = this.py - y;
      this.moved += Math.abs(d);
      this.py = y;
      if (this.scrollable(this.dTarget, d)) return;
      if (this.moved < 14) return;
      this.nudge(d * 0.05);
      e.preventDefault();
    };
    this.onUp = () => {
      this.drag = false;
      this.moved = 0;
    };
    this.onKey = (e: KeyboardEvent) => {
      // 2026-09-19: guests typing in the frame-13 RSVP/wishes form were
      // hitting these same global shortcuts by accident — space inside the
      // "Message" textarea toggled play/pause AND was swallowed (never
      // typed), and arrow keys inside the "Number of guests" field or the
      // textarea nudged/scrubbed the timeline instead of moving the
      // cursor/changing the number. User: "Pisahkan action saat undangan
      // sedang mengisi form dengan control undangan" (separate the action
      // while a guest is filling the form from the invitation's playback
      // controls). While an <input>/<textarea>/<select>/contentEditable
      // element has focus, let the keystroke through untouched — none of
      // the playback shortcuts below fire, and nothing is preventDefault()ed.
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      const activeEditable =
        activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' ||
        (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (activeEditable) return;
      const k = e.key;
      if (this.phase === 'sealed') {
        if (k === ' ' || k === 'Enter') {
          this.open();
          e.preventDefault();
        }
        return;
      }
      if (k === ' ') {
        this.auto = !this.auto;
        this.idle = 0;
        e.preventDefault();
      } else if (k === 'ArrowRight' || k === 'ArrowDown') {
        this.nudge(3);
        e.preventDefault();
      } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
        this.nudge(-3);
        e.preventDefault();
      } else if (k === 'r' || k === 'R') {
        this.t = 0;
        this.auto = true;
        this.idle = 0;
      }
    };
    window.addEventListener('keydown', this.onKey as EventListener);
    const st = this.r.stage;
    st.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
    st.addEventListener('touchstart', this.onDown as EventListener, { passive: true });
    st.addEventListener('touchmove', this.onMove as EventListener, { passive: false });
    st.addEventListener('touchend', this.onUp);
    st.addEventListener('mousedown', this.onDown as EventListener);
    window.addEventListener('blur', this.onUp);
    window.addEventListener('mousemove', this.onMove as EventListener);
    window.addEventListener('mouseup', this.onUp);
  }

  private async setup() {
    const T = THREE;
    try {
      await document.fonts.ready;
    } catch {
      /* ignore */
    }

    // preserveDrawingBuffer: true works around a known Chromium/Intel-GPU
    // compositing bug where a WebGL canvas inside a CSS-transformed (scaled)
    // ancestor draws correctly internally (confirmed via a raw toDataURL()
    // readback) but never actually composites onto the visible page — the
    // canvas area just shows through to whatever is behind it. Small GPU
    // memory cost, no visible downside for a scene this size.
    const rn = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    rn.setSize(1080, 1920, false);
    rn.setPixelRatio(cl(this.scale * (window.devicePixelRatio || 1), 0.55, 1.6));
    rn.shadowMap.enabled = true;
    rn.shadowMap.type = T.PCFSoftShadowMap;
    rn.toneMapping = T.ACESFilmicToneMapping;
    rn.toneMappingExposure = 1.05;
    const cv = rn.domElement;
    cv.style.cssText = 'width:1080px;height:1920px;display:block';
    this.r.canvasWrap.appendChild(cv);
    this.rn = rn;

    const sc = new T.Scene();
    sc.background = new T.Color('#100C08');
    sc.fog = new T.Fog('#140F0A', 22, 48);
    const cam = new T.PerspectiveCamera(38, 1080 / 1920, 0.1, 120);
    cam.position.set(0, 0, 12);
    this.sc = sc;
    this.cam = cam;

    const amb = new T.HemisphereLight('#FFF6E4', '#8A7248', 0.55);
    sc.add(amb);
    const key = new T.DirectionalLight('#FFF3DC', 2.1);
    key.position.set(-7, 9, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    sc.add(key);
    const rim = new T.DirectionalLight('#C9A66B', 0.5);
    rim.position.set(6, -4, 6);
    sc.add(rim);
    this.amb = amb;
    this.key = key;

    const back = new T.Mesh(new T.PlaneGeometry(70, 70), new T.MeshBasicMaterial({ color: '#1C1510' }));
    back.position.z = -9;
    sc.add(back);

    const riftCan = document.createElement('canvas');
    riftCan.width = 512;
    riftCan.height = 256;
    const rx = riftCan.getContext('2d')!;
    const rg = rx.createRadialGradient(256, 128, 8, 256, 128, 250);
    rg.addColorStop(0, '#7A5E2C');
    rg.addColorStop(0.26, '#4E3C22');
    rg.addColorStop(0.58, '#2A2015');
    rg.addColorStop(1, '#17110B');
    rx.fillStyle = rg;
    rx.fillRect(0, 0, 512, 256);
    const riftTex = new T.CanvasTexture(riftCan);
    riftTex.colorSpace = T.SRGBColorSpace;
    const rift = new T.Mesh(new T.PlaneGeometry(14, 6.4), new T.MeshBasicMaterial({ map: riftTex, toneMapped: false }));
    rift.position.z = -2.2;
    sc.add(rift);
    this.rift = rift;
    // Note: MeshBasicMaterial ignores lights/shadows entirely, so `rift`
    // itself can't visibly *receive* the papers' cast shadows — the shadow
    // falls across the papers' own facing edges instead (still visible,
    // still sells the separation) rather than onto the gradient behind them.

    const paperMat = new T.MeshStandardMaterial({ color: '#FBF6EC', roughness: 0.93, metalness: 0, side: T.DoubleSide });
    const warp = (g: THREE.PlaneGeometry) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i);
        p.setZ(i, Math.sin(x * 0.8) * 0.06 + Math.cos(y * 0.9) * 0.045);
      }
      g.computeVertexNormals();
      return g;
    };
    const mk = (cy: number) => {
      const m = new T.Mesh(warp(new T.PlaneGeometry(11, 6.6, 44, 26)), paperMat);
      m.position.set(0, cy, 0);
      m.receiveShadow = true;
      // Cast too (2026-09-12, addressing "halaman seperti terbagi 2" — the
      // two paper pieces need to read as physically separate objects, not
      // just a shared background with labels sliding on top): as they pull
      // apart, each now throws a real shadow across the crack instead of
      // just sitting there unshadowed, which sells the "torn into two
      // separate pieces" read a lot harder than the gap/color change alone.
      m.castShadow = true;
      sc.add(m);
      return m;
    };
    this.shA = mk(3.27);
    this.shB = mk(-3.27);

    // labCik/labSby/lab3 (frame 04 city labels) and cardR/cardE/amp (frame
    // 03 name cards) used to live here as canvas-texture Three.js planes —
    // rebuilt as plain DOM in StoryboardStage.tsx (`labCik`/`labSby`/`lab3`,
    // `couple3Reinaldo`/`couple3Eunike`) for the same reliability reasons as
    // the frame 02 monogram watermark. See the `gap`/`o3` blocks in paint()
    // below for how they're driven now.

    const slipGeo = new T.PlaneGeometry(0.74, 0.21, 6, 3);
    const slipTex = (accent: boolean) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 73;
      const x = c.getContext('2d')!;
      x.fillStyle = accent ? '#F2DFB6' : '#FDFAF3';
      x.fillRect(0, 0, 256, 73);
      x.strokeStyle = 'rgba(122,95,53,.28)';
      x.lineWidth = 2;
      x.strokeRect(1, 1, 254, 71);
      x.fillStyle = accent ? 'rgba(122,95,53,.42)' : 'rgba(122,95,53,.3)';
      x.fillRect(22, 26, 212, 5);
      x.fillRect(22, 44, 148, 5);
      const tx = new T.CanvasTexture(c);
      tx.anisotropy = 4;
      return tx;
    };
    const slipMaps = [slipTex(false), slipTex(true)];
    this.slips = [];
    for (let i = 0; i < NSLIP; i++) {
      const m = new T.Mesh(
        slipGeo,
        new T.MeshStandardMaterial({
          map: slipMaps[i % 3 === 1 ? 1 : 0],
          roughness: 0.88,
          transparent: true,
          opacity: 0,
          side: T.DoubleSide,
        })
      );
      m.castShadow = false;
      sc.add(m);
      this.slips.push(m);
    }

    // Frame 06's traveling light ("dot/light/trail") used to live here as a
    // Three.js sphere + point light + trail plane, ported as-is from the
    // prototype. Rebuilt entirely as plain DOM in 2026-09-19 (see the
    // `journeyDot`/`journeyTrail` JSX in StoryboardStage.tsx and the
    // `journeyThread` block in paint()) — after a first attempt to fix its
    // world-space alignment, the user reported it still never actually
    // rendered on their real device/browser at all (matching this project's
    // standing "WebGL canvas content here is not reliably visible on real
    // browsers" lesson from the frame-04 crack-color saga), and explicitly
    // asked for a from-scratch rebuild that doesn't reuse the prototype's
    // Three.js version. No Three.js objects needed for it any more.

    // Frame 07's full monogram reveal (`mono`) and frame 03's half-body
    // photos (`ph1`/`ph2`) used to live here too — both rebuilt as DOM (see
    // `monoReveal` <object> + `wireMonoReveal()` below, and the plain <img>
    // tags inside `couple3Reinaldo`/`couple3Eunike` in StoryboardStage.tsx).
    this.wireMonoReveal();

    this.r.loading.style.display = 'none';
    this.ready = true;
    this.last = performance.now();
    this.onVis = () => {
      this.last = performance.now();
      if (this.ready) {
        try {
          this.paint(this.last / 1000);
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener('visibilitychange', this.onVis);
    this.fcount = 0;
    this.ftime = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.ftime += dt;
      this.fcount++;
      if (this.ftime > 0.5) {
        this.fps = Math.round(this.fcount / this.ftime);
        this.fcount = 0;
        this.ftime = 0;
      }
      if (this.phase === 'playing') {
        if (this.auto) this.t = Math.min(TOTAL, this.t + dt * RATE);
        else this.idle += dt;
      }
      try {
        this.paint(now / 1000);
      } catch (err) {
        if (!this.errLogged) {
          this.errLogged = true;
          console.error('paint', err);
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.paint(0);
    this.raf = requestAnimationFrame(loop);
  }

  nudge(d: number) {
    if (this.phase !== 'playing') return;
    this.t = cl(this.t + d, 0, TOTAL);
    this.auto = false;
    this.idle = 0;
  }

  // --- Background music. Per the concept doc: enters right as the seal
  // opens (fade-in ~1.4s, tied to `t` in paint()), can be muted via the
  // corner icon, and fades out over the last ~4s of the Closing frame.
  // play() is called synchronously from open() — itself a direct onClick
  // handler — so it stays inside the browser's user-gesture window and
  // isn't blocked by autoplay policies.
  private startMusic() {
    const audio = this.r.audio as HTMLAudioElement | undefined;
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.volume = 0;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore — autoplay can still be blocked by some browsers */
    }
  }

  private stopMusic() {
    const audio = this.r.audio as HTMLAudioElement | undefined;
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  onMusicToggle = () => {
    const audio = this.r.audio as HTMLAudioElement | undefined;
    if (!audio) return;
    audio.muted = !audio.muted;
    const slash = this.r.musicSlash;
    if (slash) slash.style.opacity = audio.muted ? '1' : '0';
  };

  open() {
    if (this.phase !== 'sealed' || !this.ready) return;
    this.setPhase('opening');
    this.startMusic();
    const g = this.r.gate,
      L = this.r.foldL,
      R = this.r.foldR,
      S = this.r.sealDisc;
    if (this.reduced) {
      g.style.transition = 'opacity .45s ease';
      g.style.opacity = '0';
      setTimeout(() => {
        g.style.pointerEvents = 'none';
        this.setPhase('playing');
        this.t = 0;
        this.auto = true;
        this.idle = 0;
        this.last = performance.now();
      }, 460);
      return;
    }
    S.style.transition = 'transform .5s cubic-bezier(.3,1.6,.5,1), opacity .5s ease';
    S.style.transform = 'scale(1.16) rotate(-7deg)';
    setTimeout(() => {
      S.style.transform = 'scale(.7) rotate(4deg)';
      S.style.opacity = '0';
    }, 180);
    setTimeout(() => {
      L.style.transition = R.style.transition = 'transform 1s cubic-bezier(.22,1,.36,1)';
      L.style.transform = 'perspective(2200px) rotateY(-96deg)';
      R.style.transform = 'perspective(2200px) rotateY(96deg)';
      g.style.transition = 'transform 1.4s cubic-bezier(.22,1,.36,1), opacity 1.1s ease .3s';
      g.style.transform = 'scale(2.7)';
      g.style.opacity = '0';
    }, 420);
    setTimeout(() => {
      g.style.pointerEvents = 'none';
      this.setPhase('playing');
      this.t = 0;
      this.auto = true;
      this.idle = 0;
      this.last = performance.now();
      this.paint(0);
    }, 1820);
  }

  paint(clock: number) {
    const t = this.t,
      r = this.r;
    if (!this.ready) return;

    // 2.4 (up from 1.6 on 2026-09-12 — user reported the Cikarang/Surabaya
    // split "still has no animation"; the drift/crack was real but too
    // subtle to read as motion) — 50% more separation, so the crack and the
    // label drift it drives are both clearly visible over the frame's ~8s.
    let gap = 2.4 * ez(sg(t, 16.5, 30));
    gap *= 1 - ez(sg(t, 60.6, 63.2));
    this.shA.position.y = 3.27 + gap / 2;
    this.shB.position.y = -3.27 - gap / 2;
    const breathe = cl(gap / 2.4, 0, 1);
    this.shA.rotation.z = 0.006 * breathe * Math.sin(clock * 0.3);
    this.shB.rotation.z = -0.006 * breathe * Math.sin(clock * 0.34);
    // Tint the crack background warm→cool as it opens (2026-09-12 — see the
    // field comments above): at breathe=0 the rift shows its original warm
    // gradient unmodified (color multiplier of white), sliding toward a
    // slate-blue tint by breathe=1, so the gap's own color visibly shifts
    // over the frame instead of staying one fixed static gradient throughout.
    this.riftTint.copy(this.riftWarm).lerp(this.riftCool, ez(breathe));
    (this.rift.material as THREE.MeshBasicMaterial).color.copy(this.riftTint);

    let camY = -0.26 * ez(sg(t, 32, 44)) - 0.18 * ez(sg(t, 52, 60));
    let camRX = -0.07 * ez(sg(t, 32, 42));
    // 1.9 (up from 1.35, same 2026-09-12 pass): the concept doc calls frame
    // 04 out as "satu-satunya frame di mana kamera menjauh" (the only frame
    // where the camera pulls back) — worth making that retreat itself
    // clearly felt, not just inferred from the widening crack.
    let camZ = 12 - 0.45 * eo(sg(t, 7, 16)) + 1.9 * ez(sg(t, 16.5, 30)) - 0.6 * ez(sg(t, 50, 60));
    const settle = 1 - ez(sg(t, 60.5, 64.5));
    camY *= settle;
    camRX *= settle;
    camZ = lp(camZ, 11.5, ez(sg(t, 60.5, 64.5)));
    const info = sg(t, 78, 80);
    camZ += info * (0.55 * ez(sg(t, 79, 138)) + 0.06 * Math.sin(clock * 0.12));
    this.cam.position.set(Math.sin(clock * 0.16) * 0.03, camY + Math.sin(clock * 0.21) * 0.03, camZ);
    this.cam.rotation.x = camRX;

    const lum = 1 - 0.38 * ez(sg(t, 16.5, 21.5)) + 0.38 * ez(sg(t, 34, 46)) + 0.16 * ez(sg(t, 62, 68));
    const L = cl((lum - 0.6) / 0.58, 0, 1);
    this.rn.toneMappingExposure = lp(0.86, 1.16, L);
    this.key.intensity = lp(1.3, 2.3, L);
    this.amb.intensity = lp(0.4, 0.62, L);
    r.flash.style.opacity = (Math.sin(Math.PI * sg(t, 60.2, 62.4)) * 0.62).toFixed(3);

    // Frame 04 — Distance labels, rebuilt as DOM (`labCik`/`labSby`/`lab3` in
    // StoryboardStage.tsx) instead of canvas-texture planes. `gap` (computed
    // above, still driving the real 3D paper pieces shA/shB) is reused here
    // — scaled to screen px — so the labels track the widening split exactly
    // instead of needing their own copy of the split timing.
    const oCik = sg(t, 18, 20.5) - sg(t, 59.5, 61.5);
    r.labCik.style.opacity = oCik.toFixed(3);
    r.labSby.style.opacity = oCik.toFixed(3);
    const gapPx = gap * 130;
    // Base offset 70 (up from 40, 2026-09-12 — user said Cikarang/Surabaya
    // "masih terlalu dekat" even after the wider `gap`): this is the
    // distance from center the labels sit at BEFORE any crack-widening is
    // added, so raising it gives real breathing room from the moment they
    // fade in, on top of the growth `gapPx` already adds as the frame plays.
    // Cikarang gets an extra +20 (2026-09-12 follow-up: "naikkan sekitar
    // 20px") on top of that shared base — Surabaya's own offset is
    // untouched, so only Cikarang moved.
    // 2026-09-12 follow-up: tried raising all three labels another ~100px by
    // adding -100/+ -100 to this per-label offset alone ("sebelum bubble
    // mulai ... naikkan sekitar 100px") — but that moved Cikarang/Surabaya/
    // "3 years" without moving `gapBg` (the gold/dark band they sit inside),
    // so the group's internal spacing broke and Cikarang ended up
    // overlapping the message thread instead of clearing it. Reverted that
    // per-label -100 here; the 100px raise is now applied once, at the
    // shared anchor, via `gapBg`/`labCik`/`labSby`/`lab3`'s `top` in
    // StoryboardStage.tsx (`calc(50% - 100px)` instead of `50%`) — see the
    // 2026-09-12 "component lain juga ikut naik" note there — so the whole
    // group (band + all three labels) moves together and keeps its own
    // internal spacing intact.
    // Frame 06 entrance — continued group rise (2026-09-19): "saat masuk
    // [frame 6], buat bagian yang sama menjadi naik semua" — the whole
    // Cikarang/3-years/Surabaya/gapBg group (already anchored -100px higher
    // since the 2026-09-12 pass) rises a further ~100px right as frame 06
    // begins, so the group visibly ascends again just as the dot/light/trail
    // journey below starts traveling through this same band. Ramped in
    // starting at t=50.2 (right as the frame-05 message bubbles' own
    // `smokeGroupOut` fade finishes) rather than exactly at t=50, so the two
    // effects don't visually collide mid-fade. Holds steady afterward — no
    // need to ease back down, since the labels themselves fade to opacity 0
    // by t=61.5 anyway (see `oCik` above).
    const journeyRise = 100 * ez(sg(t, 50.2, 53));
    // Cikarang's extra offset (beyond the shared `70`) was `20` since the
    // 2026-09-12 "Cikarang repositioned" pass, which visually made the
    // CIKARANG→band gap noticeably NARROWER than the band→SURABAYA gap
    // (13.4px vs 27.2px on a representative browser, measured live via
    // getBoundingClientRect) rather than wider, because Cikarang's own text
    // box is anchored at its TOP edge (so the extra offset also has to
    // clear the box's own ~48px line-height before it reads as extra space
    // above the band) while Surabaya's box is anchored at its TOP edge too
    // but that top edge IS its near side to the band, needing no such
    // subtraction. Raised 20 → 48 (2026-09-19) to make the two gaps equal;
    // confirmed live post-fix (see the dated note above the group's overall
    // history) that both sides now measure the same distance from the
    // gold band.
    r.labCik.style.transform = `translateY(${(-70 - 48 - gapPx / 2 - journeyRise).toFixed(1)}px)`;
    r.labSby.style.transform = `translateY(${(70 + gapPx / 2 - journeyRise).toFixed(1)}px)`;
    r.lab3.style.opacity = (sg(t, 19.5, 22) - sg(t, 48.5, 50.5)).toFixed(3);
    // "3 years" previously only had a static translateY(-50%) in JSX (its
    // opacity/color are driven here, but nothing moved it) — now also needs
    // to track `journeyRise` like its two neighbors, so it rises with them
    // instead of staying anchored while Cikarang/Surabaya move.
    r.lab3.style.transform = `translateY(calc(-50% - ${journeyRise.toFixed(1)}px))`;

    // Crack background, plain DOM (2026-09-12 — see the JSX comment on
    // `gapBg`): a band the same height as the widening gap, colored by
    // mixing two actual brand colors (Champagne → Ink, the same "Ink" used
    // for the frame-03 ampersand) as `breathe` advances. Unlike the WebGL
    // `rift` tint above, this is guaranteed to actually be visible —
    // confirmed on the user's own machine that the WebGL-only version
    // wasn't reading as a color change at all.
    // 2026-09-12 follow-up: was a flat single color, which read as too flat/
    // plain ("warna background masih belum sesuai") — switched to a
    // vertical gradient (brighter center, darker top/bottom edges) so it
    // keeps the original rift texture's vignette feel while still visibly
    // shifting warm→dark as `breathe` advances. `lab3` ("3 years") now
    // tracks the same progress in the opposite direction (dark→light) so it
    // stays legible once the band goes dark instead of turning into dark
    // brown text on a near-black background.
    if (r.gapBg) {
      const p = ez(breathe);
      const edge = mixHex('#7A5E2C', '#17110B', p);
      const center = mixHex('#E8C88A', '#3A2E22', p);
      r.gapBg.style.height = `${Math.max(0, gapPx + 30).toFixed(1)}px`;
      r.gapBg.style.opacity = oCik.toFixed(3);
      r.gapBg.style.background = `linear-gradient(to bottom, ${edge} 0%, ${center} 50%, ${edge} 100%)`;
      // Rises with the rest of the group at the frame-06 entrance (2026-09-19
      // — see `journeyRise` above), same as labCik/labSby/lab3.
      r.gapBg.style.transform = `translateY(calc(-50% - ${journeyRise.toFixed(1)}px))`;
      r.lab3.style.color = mixHex('#5A4425', '#F3EAD3', p);
    }

    // Frame 03 — The Couple, rebuilt as DOM (`couple3`/`couple3Reinaldo`/
    // `couple3Eunike`/`couple3Amp` in StoryboardStage.tsx) instead of
    // canvas-texture name cards. Each row gets its own small drift/breathe
    // so the two rows read as sitting at "dua kedalaman berbeda" per the
    // concept doc, the same idea the old cardR/cardE parallax
    // position+rotation was going for. The ampersand between the two rows
    // fades with the same `o3` window at `* 0.9`, matching the ratio the old
    // `amp` mesh used.
    const o3 = sg(t, 7.4, 9.2) - sg(t, 15.2, 16.6);
    r.couple3.style.opacity = o3.toFixed(3);
    r.couple3.style.pointerEvents = o3 > 0.5 ? 'auto' : 'none';
    const driftR = lp(26, 0, eo(o3)) + Math.sin(clock * 0.5) * 2.5;
    const driftE = lp(-18, 0, eo(o3)) - Math.sin(clock * 0.44) * 2;
    r.couple3Reinaldo.style.transform = `translateY(${driftR.toFixed(1)}px)`;
    r.couple3Eunike.style.transform = `translateY(${driftE.toFixed(1)}px)`;
    if (r.couple3Amp) r.couple3Amp.style.opacity = (o3 * 0.9).toFixed(3);

    // Frame 05 — Messages: 26 paper slips crossing the gap (`NSLIP` already
    // matches the concept doc's "26 kertas kecil" exactly). Exponent tuned
    // down from 0.58 toward 0.4 so the per-slip start times (`ts`) bunch up
    // more tightly late in the window instead of spreading evenly — reads as
    // a flow that thickens until the gap is nearly closed with paper,
    // per the concept's "Belum dibuat: arus sepadat sampai celah nyaris
    // tertutup", rather than a steady trickle the whole time.
    const park = ez(sg(t, 50, 53));
    for (let i = 0; i < NSLIP; i++) {
      const m = this.slips[i];
      const ts = 32 + 15.2 * Math.pow(i / NSLIP, 0.4);
      const u = sg(t, ts, ts + 2.4);
      const side = i % 2 ? 1 : -1;
      const xs = ((i * 137) % 70 - 35) * 0.052;
      m.position.x = lp(xs, xs + side * 0.4, u) + park * side * 1.2;
      m.position.y = lp(-gap / 2 - 0.55, gap / 2 + 0.55, u);
      m.position.z = 0.3 + side * 0.12 + Math.sin(u * Math.PI) * 0.28;
      m.rotation.z = side * lp(0.2, -0.1, u);
      m.rotation.y = u * 1.6 * side;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.opacity = eo(cl(u / 0.22, 0, 1)) * (1 - ez(cl((u - 0.68) / 0.32, 0, 1))) * (1 - park);
      m.visible = mat.opacity > 0.004;
      m.castShadow = mat.opacity > 0.12;
    }

    // Frame 05 — message-thread DOM overlay (see StoryboardStage.tsx's
    // `MSG_BUBBLES`), "smoke" pass (2026-09-12): replaces the previous
    // continuous-rise/stacking mechanic (a fractional arrival count `K(t)`
    // driving row position, with a `MAX_ROW` top-boundary fade) entirely.
    // User feedback: the stacked thread's fixed position (`top:420` in
    // StoryboardStage.tsx) sat too close to — and at some `t`, overlapped —
    // `labCik` ("CIKARANG") above it; asked instead for each bubble to
    // "muncul seperti model asap" (appear like smoke): rise individually
    // from bottom to top while rotating slowly and drifting right-to-left,
    // explicitly bounded to start at the BOTTOM of `gapBg` (the gold/dark
    // band) and end at its TOP — i.e. travel exactly the band's own height,
    // never reaching as far up as CIKARANG (which sits above the band) or
    // as far down as SURABAYA (below it). `msgThread` (the bubbles'
    // container, see StoryboardStage.tsx) is kept the same height as
    // `gapBg` every frame (`bandH` below, identical formula) so this is
    // true by construction, not just by tuning numbers to fit.
    const bandH = Math.max(0, gapPx + 30);
    if (r.msgThread) {
      r.msgThread.style.height = `${bandH.toFixed(1)}px`;
      // Kept on the same shared anchor as gapBg (see `journeyRise` above) —
      // moot for visibility since all bubbles are long faded out by the time
      // this ramps in, but keeps the container geometrically consistent with
      // the band it's supposed to track.
      r.msgThread.style.transform = `translateY(calc(-50% - ${journeyRise.toFixed(1)}px))`;
    }
    // Safety fade for the whole group right at the frame-05→06 handoff, in
    // case any bubble is still mid-rise then (each also fades out on its
    // own well before that via `fadeOut` below, but this catches stragglers
    // from the tail end of the spread).
    const smokeGroupOut = 1 - ez(sg(t, 49.3, 50.2));
    // Mirrors StoryboardStage.tsx's `MSG_BUBBLES` widthPct sequence — needed
    // here only so each bubble's fixed `right`% spawn point below can be
    // clamped to its own width, keeping it inside `msgThread` instead of
    // overflowing past the container's left edge. Reverted to the
    // original 62/52/70/44/56/64% sequence on 2026-09-19 — widening this
    // (the bubble's own size) was a misread; what the user actually wanted
    // widened was the SPACING between bubbles' spawn points (`rightFixed`
    // below), not their width.
    const msgWidths = [62, 52, 70, 44, 56, 64, 62, 52, 70, 44, 56, 64, 62, 52, 70, 44];
    for (let i = 0; i < NMSG; i++) {
      const el = r[`msg${i}`];
      if (!el) continue;
      // Same continuous-generation spread as the previous pass (start times
      // bunched toward the end of the window, per the concept's "makin
      // cepat"), but each bubble now animates independently over its own
      // fixed-length rise (`dur`) instead of joining a shared stack.
      const tsi = 32 + 16 * Math.pow(i / (NMSG - 1), 0.6);
      const dur = 5;
      const p = ez(sg(t, tsi, tsi + dur)); // 0 = just born at the band's bottom, 1 = dispersed at its top
      const yTop = bandH * (1 - p); // bandH (band's bottom edge) → 0 (band's top edge)
      // 2026-09-12 follow-up: clarified what "berpindah ke kiri" actually
      // meant — NOT each bubble drifting left during its own rise (the
      // previous two passes' interpretation), but each SUCCESSIVE bubble
      // spawning at a further-left fixed spot than the last: "yang awalnya
      // menggunakan right:0, bubble text selanjutnya muncul dari right:5
      // dst". So each bubble now gets one fixed `right`% for its whole
      // life — a staircase across the sequence, not a per-bubble
      // animation — clamped by its own width (`w`/`maxRight`) so later
      // (further-right-offset) bubbles never overflow past the container's
      // left edge; once the step would exceed that, it holds at `maxRight`
      // rather than overflowing. Also brings back the rotation the
      // previous pass had removed ("rotasi pertahankan" — keep it) since
      // that removal turned out to be based on the same misread.
      // 2026-09-19: the per-bubble step widened from 5 to 12 — the user's
      // "buat lebih lebar" request was actually about this spacing between
      // successive bubbles' spawn points ("jarak muncul bubble text"), not
      // the bubbles' own width (see `msgWidths` above, reverted).
      const w = msgWidths[i % msgWidths.length];
      const maxRight = Math.max(2, 96 - w);
      const rightFixed = Math.min(i * 12, maxRight);
      const rotDir = i % 2 === 0 ? 1 : -1;
      const rot = rotDir * lp(0, 12, p);
      // Smoke-like fade: in over the first quarter of the rise, out over the
      // last 30% — dispersing near the top rather than just vanishing.
      const fadeIn = sg(t, tsi, tsi + dur * 0.25);
      const fadeOut = 1 - sg(t, tsi + dur * 0.7, tsi + dur);
      el.style.opacity = (fadeIn * fadeOut * smokeGroupOut).toFixed(3);
      el.style.right = `${rightFixed.toFixed(1)}%`;
      el.style.transform = `translateY(${yTop.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
    }

    // Frame 06 — traveling light, rebuilt entirely as plain DOM (2026-09-19).
    // The Three.js version (even after a pass that aligned its world-space
    // travel to labCik/labSby's real projected position — see the removed
    // `worldYForScreenY` helper this replaced) still never actually
    // rendered on the user's real device: "Titiknya masih belum keluar.
    // Buat ulang, jangan menggunakan yang dari prototipe" (the dot still
    // isn't showing up — rebuild it, don't reuse the one from the
    // prototype). This matches the project's standing lesson that WebGL
    // canvas content here isn't reliably visible on real browsers even when
    // it measures correctly in this tool's own diagnostics (the frame-04
    // crack-color saga). `journeyThread` (see the JSX in
    // StoryboardStage.tsx) shares gapBg/msgThread's exact anchor and is kept
    // the same height (`bandH`, already computed above) every frame, so the
    // light's travel is confined to exactly the same band BY CONSTRUCTION —
    // top edge (0) sits just below CIKARANG, bottom edge (bandH) just above
    // SURABAYA — with no 3D-to-screen projection needed at all, just plain
    // CSS transforms that are guaranteed to actually render.
    const tu = ez(sg(t, 52, 60.2));
    const dotO = sg(t, 51, 52.4) - sg(t, 60.2, 61);
    if (r.journeyThread) {
      r.journeyThread.style.height = `${bandH.toFixed(1)}px`;
      r.journeyThread.style.transform = `translateY(calc(-50% - ${journeyRise.toFixed(1)}px))`;
    }
    const dotY = bandH * tu; // 0 = band's top edge (below Cikarang), bandH = band's bottom edge (above Surabaya)
    if (r.journeyDot) {
      const dotScale = lp(1, 1.4, Math.sin(Math.PI * tu));
      r.journeyDot.style.opacity = dotO.toFixed(3);
      r.journeyDot.style.transform = `translateY(${dotY.toFixed(1)}px) scale(${dotScale.toFixed(2)})`;
    }
    if (r.journeyTrail) {
      r.journeyTrail.style.opacity = (dotO * 0.85).toFixed(3);
      r.journeyTrail.style.height = `${Math.max(1, dotY).toFixed(1)}px`;
    }

    const morph = cl(ez(sg(t, 62.5, 66.8)) - ez(sg(t, 77.8, 81.4)), 0, 1);
    // Frame 02–06 monogram watermark (rebuilt 2026-09-12 as a plain DOM
    // overlay — see the JSX comment on `monoWatermark` in StoryboardStage.tsx
    // for why this replaced the old Three.js `monoBg` canvas-texture mesh).
    // Ramp-in starts at t=0 rather than a few seconds in (the original
    // prototype's sg(t,2.4,5.5) left it at literal 0 opacity for the first
    // ~1.5s of frame 02, easy to miss if you weren't still looking a few
    // seconds in). Stays up almost the whole timeline, dipping to 0 only
    // during the frame-07 window (via `1 - morph`) so the full monogram
    // reveal there reads as its own moment, per the concept doc's "watermark
    // dari frame 02–06 menyatu ke monogram utuh [frame 07], lalu mengecil
    // kembali jadi watermark saat masuk frame 08".
    const bgLife = sg(t, 0, 2.5) * (1 - sg(t, 137.5, 139.5));
    const monoWatermark = this.r.monoWatermark;
    if (monoWatermark) {
      // 0.10 (lowered from 0.18 on 2026-09-12 per user feedback — the
      // watermark read as too strong behind the frame-03 cards once those
      // were enlarged): closer to the concept doc's literal "~7%" spec.
      // Real CSS opacity on a real DOM image, so (unlike the old WebGL mesh)
      // this number is exactly what actually shows on screen. Easy to retune.
      monoWatermark.style.opacity = String(0.1 * bgLife * (1 - morph));
    }

    // Frame 07 — Bersatu: full monogram assembly, rebuilt as DOM (see
    // `wireMonoReveal()` above and the `monoReveal` <object> in
    // StoryboardStage.tsx). `monoObjLife` gates the whole embedded SVG's
    // presence/fade for this window; each named sub-part then ramps in on
    // its own slightly-offset threshold inside that window so the ring,
    // laurels, initials, and wordmark visibly assemble one after another
    // (concept doc's "Belum dibuat" note: "menyusun diri satu per satu"),
    // rather than the old `mono` mesh's single flat fade-in.
    const monoFadeOut = 1 - sg(t, 77, 79.5);
    const monoObjLife = sg(t, 62.4, 63.4) * monoFadeOut;
    const monoRevealEl = r.monoReveal;
    if (monoRevealEl) monoRevealEl.style.opacity = monoObjLife.toFixed(3);
    const parts = this.monoRevealParts;
    if (parts.ring) parts.ring.style.opacity = eo(sg(t, 63, 65)).toFixed(3);
    if (parts.laurelL) parts.laurelL.style.opacity = eo(sg(t, 63.8, 65.8)).toFixed(3);
    if (parts.laurelR) parts.laurelR.style.opacity = eo(sg(t, 64.1, 66.1)).toFixed(3);
    if (parts.initialR) parts.initialR.style.opacity = eo(sg(t, 64.6, 66.4)).toFixed(3);
    if (parts.initialE) parts.initialE.style.opacity = eo(sg(t, 64.9, 66.7)).toFixed(3);
    if (parts.amp) parts.amp.style.opacity = eo(sg(t, 65.6, 67)).toFixed(3);
    if (parts.wordmark) parts.wordmark.style.opacity = eo(sg(t, 66.2, 67.7)).toFixed(3);

    // Frame 03's half-body photos (formerly `ph1`/`ph2` Three.js planes with
    // their own independent fade timing) are now plain <img> tags nested
    // inside `couple3Reinaldo`/`couple3Eunike` — they fade with their row
    // via `o3` above, so no separate driving code is needed here anymore.

    const oTx2 = cl(sg(t, 0.4, 2.2) - sg(t, 5.9, 7.1), 0, 1);
    r.tx2.style.opacity = oTx2.toFixed(3);
    r.tx2.style.pointerEvents = oTx2 > 0.5 ? 'auto' : 'none';
    this.fade(r.tx4, sg(t, 17.5, 19.8) - sg(t, 30.4, 32));
    this.fade(r.tx5, sg(t, 33, 35.4) - sg(t, 47.8, 50));
    this.fade(r.tx6, sg(t, 51, 53.2) - sg(t, 59.8, 61.2));
    this.fade(r.tx7, sg(t, 63.5, 66.2) - sg(t, 77, 79));
    r.tx8.style.opacity = (sg(t, 72, 75) * 0.9 * (1 - sg(t, 76.5, 78))).toFixed(3);

    this.fade(r.p08, sg(t, 77.5, 80) - sg(t, 86.5, 88.5));
    this.fade(r.p09, sg(t, 89, 91.4) - sg(t, 95.5, 97.5));
    this.fade(r.p10, sg(t, 98, 100.4) - sg(t, 104, 106));
    this.fade(r.p11, sg(t, 106.5, 109) - sg(t, 117.5, 119.5));
    this.fade(r.p13, sg(t, 120, 122.5) - sg(t, 125.5, 127));
    this.fade(r.p12, sg(t, 127.5, 130) - sg(t, 137, 139));
    const o14 = sg(t, 139.5, 143);
    r.p14.style.opacity = o14.toFixed(3);
    r.p14.style.pointerEvents = o14 > 0.5 ? 'auto' : 'none';

    if (t > 76.5) {
      const ms = Math.max(0, TARGET - Date.now());
      const s = Math.floor(ms / 1000);
      const pad = (v: number) => (v < 10 ? '0' : '') + v;
      r.cdD.textContent = String(Math.floor(s / 86400));
      r.cdH.textContent = pad(Math.floor(s / 3600) % 24);
      r.cdM.textContent = pad(Math.floor(s / 60) % 60);
      r.cdS.textContent = pad(s % 60);
    }

    const dark = o14 > 0.55;
    if (dark !== this.wasDark) {
      this.wasDark = dark;
      const ink = dark ? 'rgba(240,228,200,.75)' : 'rgba(90,72,48,.7)';
      r.hudNo.style.color = r.hudLab.style.color = ink;
      r.hudTrackBg.style.background = dark ? 'rgba(240,228,200,.22)' : 'rgba(122,95,53,.2)';
      r.hudBar.style.background = dark ? '#D9BA80' : '#B8935A';
      [r.pp, r.resume, r.restart].forEach((b) => {
        b.style.background = dark ? 'rgba(32,25,18,.85)' : 'rgba(253,250,243,.9)';
        b.style.color = dark ? '#EFE2C4' : '#7A5F35';
        b.style.borderColor = dark ? 'rgba(217,186,128,.5)' : 'rgba(122,95,53,.45)';
      });
    }

    const f = FRAMES.find((x) => t < x.b) || FRAMES[FRAMES.length - 1];
    r.hudNo.textContent = f.n + ' / 14';
    r.hudLab.textContent = f.lab;
    if (this.debug) {
      r.hudFps.style.display = 'block';
      r.hudFps.textContent = this.fps + ' fps';
    }
    r.hudBar.style.width = ((t / TOTAL) * 100).toFixed(2) + '%';

    const showResume = !this.auto && this.idle > 6 && t < TOTAL && this.phase === 'playing';
    r.resume.style.opacity = showResume ? '1' : '0';
    r.resume.style.pointerEvents = showResume ? 'auto' : 'none';
    r.pp.textContent = this.auto ? '❙❙' : '▶';
    const done = t >= TOTAL - 0.01 && this.phase === 'playing';
    r.restart.style.opacity = done ? '1' : '0';
    r.restart.style.pointerEvents = done ? 'auto' : 'none';

    // Music volume: fade in over ~1.4s of real time right after the seal
    // opens (t resets to 0 there), fade out over the last ~4s of the
    // Closing frame (concept doc: "musik fade-out 4 detik").
    const audio = r.audio as HTMLAudioElement | undefined;
    if (audio && this.phase === 'playing') {
      const fadeIn = eo(cl(t / (1.4 * RATE), 0, 1));
      const fadeOut = 1 - sg(t, TOTAL - 4 * RATE, TOTAL);
      audio.volume = cl(0.55 * fadeIn * fadeOut, 0, 1);
    }

    this.rn.render(this.sc, this.cam);
  }

  // (The old `worldYForScreenY` camera-projection helper that used to live
  // here — for aligning the Three.js dot/light/trail to the DOM labels —
  // was removed 2026-09-19 along with that whole Three.js element. See the
  // JSX comment on `journeyDot`/`journeyTrail` in StoryboardStage.tsx and
  // the `journeyThread` block in paint() for its DOM replacement, which
  // needs no projection math at all.)

  fade(el: HTMLElement, o: number) {
    const v = cl(o, 0, 1);
    el.style.opacity = v.toFixed(3);
    el.style.transform = 'translateY(' + lp(38, 0, eo(v)).toFixed(1) + 'px)';
    el.style.pointerEvents = v > 0.5 ? 'auto' : 'none';
  }

  pause() {
    this.auto = false;
    this.idle = 0;
  }

  // --- UI event handlers, called directly from React onClick/onWheel etc. ---

  onResume = () => {
    this.auto = true;
    this.idle = 0;
  };

  onSeek = (clientX: number) => {
    if (this.phase !== 'playing') return;
    const b = this.r.hudTrack.getBoundingClientRect();
    this.t = cl((clientX - b.left) / b.width, 0, 1) * TOTAL;
    this.auto = false;
    this.idle = 0;
    try {
      this.paint(performance.now() / 1000);
    } catch {
      /* ignore */
    }
  };

  onGalleryOpen = (src: string) => {
    this.pause();
    this.r.lbImg.setAttribute('src', src);
    this.r.lb.style.opacity = '1';
    this.r.lb.style.pointerEvents = 'auto';
  };

  onScrapOpen = () => {
    this.pause();
    this.r.scrap.style.opacity = '1';
    this.r.scrap.style.pointerEvents = 'auto';
  };

  onScrapClose = () => {
    this.r.scrap.style.opacity = '0';
    this.r.scrap.style.pointerEvents = 'none';
  };

  onLbClose = () => {
    this.r.lb.style.opacity = '0';
    this.r.lb.style.pointerEvents = 'none';
  };

  onMaps = () => {
    this.pause();
    this.r.mapsNote.style.opacity = '1';
  };

  onFormFocus = () => this.pause();

  onEnv = () => {
    this.pause();
    this.envOpen = !this.envOpen;
    const b = this.r.envBtn,
      c = this.r.envCard;
    this.r.envFlap.style.transform = this.envOpen ? 'rotateX(-172deg)' : '';
    this.r.envHint.style.opacity = this.envOpen ? '0' : '1';
    b.style.opacity = this.envOpen ? '0' : '1';
    b.style.transform = this.envOpen ? 'scale(1.06)' : '';
    b.style.pointerEvents = this.envOpen ? 'none' : 'auto';
    c.style.opacity = this.envOpen ? '1' : '0';
    c.style.transform = this.envOpen ? 'scale(1)' : 'scale(.9)';
    c.style.pointerEvents = this.envOpen ? 'auto' : 'none';
    this.r.envWrap.style.height = this.envOpen ? c.scrollHeight + 'px' : '400px';
  };

  onToggle = () => {
    if (this.phase === 'sealed') {
      this.open();
      return;
    }
    if (this.t >= TOTAL - 0.01) this.t = 0;
    this.auto = !this.auto;
    this.idle = 0;
  };

  onRestart = () => {
    this.stopMusic();
    this.t = 0;
    this.auto = true;
    this.idle = 0;
    this.envOpen = false;
    this.r.envFlap.style.transform = '';
    this.r.envHint.style.opacity = '1';
    this.r.envBtn.style.opacity = '1';
    this.r.envBtn.style.transform = '';
    this.r.envBtn.style.pointerEvents = 'auto';
    this.r.envCard.style.opacity = '0';
    this.r.envCard.style.transform = 'scale(.9)';
    this.r.envCard.style.pointerEvents = 'none';
    this.r.envWrap.style.height = '400px';
    this.r.lb.style.opacity = '0';
    this.r.lb.style.pointerEvents = 'none';
    this.r.scrap.style.opacity = '0';
    this.r.scrap.style.pointerEvents = 'none';
    this.r.mapsNote.style.opacity = '0';
    const g = this.r.gate,
      S = this.r.sealDisc,
      L = this.r.foldL,
      R = this.r.foldR;
    [g, S, L, R].forEach((e) => {
      e.style.transition = 'none';
      e.style.transform = '';
      e.style.opacity = '';
    });
    void g.offsetHeight;
    [g, S, L, R].forEach((e) => {
      e.style.transition = '';
    });
    g.style.pointerEvents = 'auto';
    this.setPhase('sealed');
  };
}
