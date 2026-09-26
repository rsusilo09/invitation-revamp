'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SceneController, detectLayout, LAYOUT_SIZE, type Layout, type RefMap } from './SceneController';
import { WEDDING_DATA } from '@/lib/constants';

type Wish = { id: string; name: string; message: string; when: string };
type RsvpState = {
  status: 'hadir' | 'tidak_hadir' | null;
  guestCount: number | null;
  qrDataUrl: string | null;
  shortCode: string;
};

const DRESS_SWATCH: Record<string, string> = {
  white: '#FFFFFF',
  navy: '#1F2A44',
  maroon: '#6B1F2A',
};

// Frame 05's message-thread overlay content (2026-09-12, several passes —
// see the JSX comment where these render for the full layout rationale).
// Plain "skeleton text" placeholder bars (no words). Side sequence was a
// hand-picked pattern with occasional same-side runs of 2 ("bisa 2x kanan
// baru kiri atau sebaliknya"); changed to strict left/right alternation on
// 2026-09-19 ("buat jadi bergantian terus saja"). `widthPct` reproduces
// the concept mockup's own bar-width sequence (62/52/70/44/56/64%,
// cycled) — briefly widened ~25% on 2026-09-19, then reverted the same day
// once the user clarified "yang saya minta lebarkan bukan bubble textnya,
// tapi jarak muncul bubble text" (what they'd asked to widen was not the
// bubble itself but the SPACING between where successive bubbles appear —
// see the `rightFixed` step in SceneController.paint(), widened there
// instead). `SceneController.ts`'s `msgWidths` (used to clamp each
// bubble's fixed `right`% spawn point so it doesn't overflow the
// container) mirrors this exact sequence and must be kept in sync. Bumped
// from 9 to 16 entries so the thread keeps generating new messages across
// the WHOLE frame ("dari awal sampai akhir tidak berhenti") instead of
// finishing early and sitting static — older ones scroll up and fade out
// past the thread's top boundary instead of piling up forever (see
// SceneController.paint()'s reveal loop). `NMSG` in timeline.ts must match
// this array's length.
const MSG_BUBBLES: { side: 'left' | 'right'; widthPct: number }[] = [
  { side: 'left', widthPct: 62 },
  { side: 'right', widthPct: 52 },
  { side: 'left', widthPct: 70 },
  { side: 'right', widthPct: 44 },
  { side: 'left', widthPct: 56 },
  { side: 'right', widthPct: 64 },
  { side: 'left', widthPct: 62 },
  { side: 'right', widthPct: 52 },
  { side: 'left', widthPct: 70 },
  { side: 'right', widthPct: 44 },
  { side: 'left', widthPct: 56 },
  { side: 'right', widthPct: 64 },
  { side: 'left', widthPct: 62 },
  { side: 'right', widthPct: 52 },
  { side: 'left', widthPct: 70 },
  { side: 'right', widthPct: 44 },
];

export default function StoryboardStage({
  token,
  guestName,
  initialRsvp,
  initialWishes,
}: {
  token: string;
  guestName: string;
  initialRsvp: RsvpState;
  initialWishes: Wish[];
}) {
  const refs = useRef<RefMap>({});
  const controllerRef = useRef<SceneController | null>(null);
  const [, setPhase] = useState<'sealed' | 'opening' | 'playing'>('sealed');

  const [rsvp, setRsvp] = useState<RsvpState>(initialRsvp);
  const [showShortCode, setShowShortCode] = useState(false);
  const [reopenCount, setReopenCount] = useState('1');
  const [reopening, setReopening] = useState(false);

  const [formCount, setFormCount] = useState('1');
  const [formAttending, setFormAttending] = useState<'hadir' | 'tidak_hadir' | null>(null);
  const [formMessage, setFormMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rsvpNote, setRsvpNote] = useState('');

  // 2026-09-19: "saat undangan selesai isi form, jangan langsung diubah ke
  // qr code. biarkan qr code muncul saat undangan sudah isi attending dan
  // dibuka yang selanjutnya" — after a guest submits the form, don't
  // immediately swap the just-submitted form for the QR/short-code view;
  // show a plain thank-you confirmation instead, and only reveal the QR on
  // a later visit. This flag lives only in this render's client state
  // (never written to/read from `initialRsvp`), so it's true only for the
  // rest of THIS page load — a fresh open (a real "dibuka yang
  // selanjutnya") starts with `rsvp.status` already 'hadir' from the
  // server and `justSubmitted` back to its default `false`, so the QR/code
  // shows immediately as before.
  const [justSubmitted, setJustSubmitted] = useState(false);

  // 2026-09-19: "saya tidak melihat tombol untuk edit jumlah guest" — once
  // `rsvp.status` is 'hadir' there was no way to revise the guest count
  // afterward. Small inline edit affordance, reusing `submitRsvp('hadir', …)`
  // (the same call `handleReopenSubmit` already makes) rather than a new
  // endpoint.
  const [editingGuestCount, setEditingGuestCount] = useState(false);
  const [editCount, setEditCount] = useState('1');
  const [editingGuestSubmitting, setEditingGuestSubmitting] = useState(false);

  // 2026-09-19: "saya tidak melihat tombol ... mengisi wishes lagi" — the
  // Message field was only ever part of the one-time initial RSVP form,
  // which disappears for good once `rsvp.status` is set. A standalone
  // "write another wish" mini-form (rendered once `rsvp.status !== null`,
  // see below) lets a guest send more than one wish across separate visits.
  const [wishDraft, setWishDraft] = useState('');
  const [wishSubmitting, setWishSubmitting] = useState(false);
  const [wishNote, setWishNote] = useState('');

  const [wishes, setWishes] = useState<Wish[]>(initialWishes);

  // 2026-09-26 — responsive pass (see `Layout` in SceneController.ts).
  // `null` until measured on the client, so the server-rendered HTML never
  // flashes the wrong layout (the frame stays hidden until then).
  const [layoutState, setLayoutState] = useState<Layout | null>(null);
  const L: Layout = layoutState ?? 'portrait';
  const land = L === 'landscape';
  const size = LAYOUT_SIZE[L];
  useLayoutEffect(() => {
    const update = () => setLayoutState(detectLayout());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  // Right-half text column used by most landscape panels (desktop prototype:
  // left:960, 56/60px inner padding).
  const RIGHT_COL = { left: 960, right: 0, padding: '0 60px 0 56px', boxSizing: 'border-box' as const };
  // Left-half "scene" box: the 3D crack/monogram are centred here in landscape.
  const LEFT_HALF = { left: 0, width: 960 };

  // Callback-ref factory: collects DOM nodes into a plain object keyed by
  // the prototype's original data-k names, read imperatively by
  // SceneController (not by React render) — the standard callback-ref
  // pattern, not a render-time ref read.
  const bind = (key: string) => (el: HTMLElement | null) => {
    // eslint-disable-next-line react-hooks/refs
    if (el) refs.current[key] = el;
  };

  useEffect(() => {
    const controller = new SceneController(refs.current, { onPhaseChange: setPhase });
    controllerRef.current = controller;
    controller.mount();
    return () => controller.unmount();
  }, []);

  // Tell the controller once React has committed the new layout's DOM.
  useEffect(() => {
    if (layoutState) controllerRef.current?.setLayout(layoutState);
  }, [layoutState]);

  async function refreshRsvp() {
    const res = await fetch(`/api/rsvp?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.ok) {
      setRsvp({ status: data.status, guestCount: data.guestCount, qrDataUrl: data.qrDataUrl, shortCode: data.shortCode });
    }
  }

  async function submitRsvp(status: 'hadir' | 'tidak_hadir', guestCount?: number) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, status, guestCount }),
      });
      const data = await res.json();
      if (!data.ok) {
        setRsvpNote(data.message || 'Failed to submit');
        return false;
      }
      await refreshRsvp();
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWish(message: string) {
    if (!message.trim()) return;
    const res = await fetch('/api/wishes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, message: message.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setWishes((w) => [{ id: 'temp-' + Date.now(), name: guestName, message: message.trim(), when: 'just now' }, ...w]);
    }
  }

  async function handleFormSubmit() {
    if (!formAttending) {
      setRsvpNote('Please choose Attending or Not attending.');
      return;
    }
    const count = formAttending === 'hadir' ? Math.min(2, Math.max(1, parseInt(formCount, 10) || 1)) : undefined;
    const ok = await submitRsvp(formAttending, count);
    if (ok) {
      setRsvpNote('Thank you — your RSVP has been recorded.');
      setJustSubmitted(true);
      if (formMessage.trim()) {
        await submitWish(formMessage);
        setFormMessage('');
      }
    }
  }

  async function handleEditGuestCount() {
    setEditingGuestSubmitting(true);
    try {
      const ok = await submitRsvp('hadir', Math.min(2, Math.max(1, parseInt(editCount, 10) || 1)));
      if (ok) setEditingGuestCount(false);
    } finally {
      setEditingGuestSubmitting(false);
    }
  }

  async function handleWishSubmit() {
    if (!wishDraft.trim()) return;
    setWishSubmitting(true);
    try {
      await submitWish(wishDraft);
      setWishDraft('');
      setWishNote('Thank you for your wishes and prayers.');
    } finally {
      setWishSubmitting(false);
    }
  }

  async function handleReopenSubmit() {
    setReopening(true);
    try {
      await submitRsvp('hadir', Math.min(2, Math.max(1, parseInt(reopenCount, 10) || 1)));
    } finally {
      setReopening(false);
    }
  }

  const c = () => controllerRef.current!;

  return (
    <div
      ref={bind('stage')}
      style={{
        position: 'fixed',
        inset: 0,
        // 2026-09-26: was a dark "presentation stage" backdrop; now a paper
        // tone matching the canvas so the letterbox area (e.g. the sides on
        // a tablet held upright, which reuses the mobile canvas) blends in
        // instead of reading as black bars. Flips dark for the closing
        // frame from SceneController.paint().
        background: 'radial-gradient(circle at 50% 40%,#F4EEE3,#E2D6C1)',
        transition: 'background .8s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Jost',system-ui,sans-serif",
      }}
    >
      <div
        ref={bind('frame')}
        style={{
          position: 'relative',
          width: size.w,
          height: size.h,
          flex: 'none',
          background: '#EFE7DA',
          overflow: 'hidden',
          transformOrigin: 'center center',
          boxShadow: '0 30px 90px rgba(90,68,37,.22)',
          visibility: layoutState ? 'visible' : 'hidden',
        }}
      >
        <div ref={bind('canvasWrap')} style={{ position: 'absolute', inset: 0, background: '#EFE7DA' }} />

        {/*
          Frame 02–06 monogram watermark — built fresh from the concept doc
          (Storyboard Reunited.dc.html, frame 02 "Elemen 3D": "Monogram RE
          mulai hadir sebagai watermark tipis (±7%) di belakang isi dan
          bertahan sampai frame 06"), NOT ported from the prototype's
          Three.js canvas-texture mesh. That mesh (`monoBg`) turned out to be
          unreliable to iterate on in this environment (WebGL-canvas
          confusion, dev-server HMR not always picking up plain-.ts edits)
          and, even when it was confirmed via raw pixel reads to be
          compositing correctly, was effectively unverifiable by eye through
          normal screenshots. A plain DOM <img> of the same
          monogram-RE-transparent.svg asset the concept doc names sidesteps
          all of that: opacity here is real CSS, so what you see in a
          screenshot is exactly what's on screen, no WebGL round-trip needed.
          Opacity/visibility is driven imperatively from SceneController's
          paint() loop (this.r.monoWatermark), same as every other DOM
          overlay in this component — not React state.
        */}
        <div
          ref={bind('monoWatermark')}
          style={{
            position: 'absolute',
            ...(land ? { top: 0, bottom: 0, ...LEFT_HALF } : { inset: 0 }),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            opacity: 0,
            // 2026-09-19: raised ~100px per user request, so the frame
            // 02-06 backdrop watermark sits higher on screen (matching the
            // CIKARANG/3 years/SURABAYA/gapBg group's own -100px anchor
            // shift from the 2026-09-12 pass, and the frame-06 journeyRise
            // that raises that group ~100px further still).
            // Landscape: centred in the left-half scene, no raise needed.
            transform: land ? 'none' : 'translateY(-100px)',
          }}
        >
          <img
            src="/assets/monogram-RE-transparent.svg"
            alt=""
            style={{ width: '72%', display: 'block' }}
          />
        </div>

        {/*
          Frame 07 — Bersatu: the full monogram reveal. Rebuilt from the
          concept doc's own "Belum dibuat" note on this frame: "huruf R dan E
          saling geser serta bingkai, dotted ring, dan laurel yang menyusun
          diri satu per satu" (the ring, laurels, and R&E letters assemble
          themselves piece by piece, not just fade in as one flat image).
          The old `mono` Three.js mesh could only ever fade the whole
          monogram in as a single flat texture — no way to animate its
          sub-parts independently. An <object> embeds the SVG as a real
          nested document, so SceneController can reach into it (via
          `contentDocument`, once it fires `load`) and drive `#ring`,
          `#laurel-left`, `#laurel-right`, `#ampersand`, `#initials` and
          `#wordmark` as separate, independently-timed reveals — see
          `wireMonoReveal` / the `o7` block in `paint()`.
        */}
        {/* 2026-09-19: raised ~100px per user request, same as monoWatermark above. */}
        <div style={{ position: 'absolute', ...(land ? { top: 0, bottom: 0, ...LEFT_HALF } : { inset: 0 }), display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', transform: land ? 'none' : 'translateY(-100px)' }}>
          <object
            ref={bind('monoReveal') as unknown as React.Ref<HTMLObjectElement>}
            type="image/svg+xml"
            data="/assets/monogram-RE-transparent.svg"
            aria-label=""
            style={{ width: land ? '74%' : '74%', aspectRatio: '1 / 1', display: 'block', opacity: 0 }}
          />
        </div>

        {/*
          Frame 07 photo slot (2026-09-26). The concept doc left this frame
          "menunggu satu foto baru" after the original couple photo moved to
          frame 03. Uses photo-10 (the two of them standing side by side,
          hand in hand — "akhirnya berdiri berdampingan"), cropped to 3:4 as
          /photos/reunited-together.webp. Framed like the frame-03 cards.
          Sits in the scene area: below the shrunken monogram crest, above
          the frame-07 text (portrait) / centred in the left half
          (landscape). Opacity/transform driven from paint().
        */}
        <div
          ref={bind('photo7')}
          style={{
            position: 'absolute',
            ...(land ? { left: 270, width: 420, top: 300 } : { left: 270, width: 540, top: 430 }),
            padding: land ? 14 : 18,
            boxSizing: 'border-box',
            background: '#FDFAF3',
            border: '1px solid rgba(122,95,53,.3)',
            boxShadow: '0 26px 60px rgba(90,68,37,.28)',
            opacity: 0,
            pointerEvents: 'none',
            willChange: 'transform, opacity',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/photos/reunited-together.webp" alt="Reinaldo and Eunike, side by side" style={{ display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover' }} />
        </div>

        <div
          ref={bind('loading')}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            letterSpacing: '.3em',
            textTransform: 'uppercase',
            color: '#A08B62',
          }}
        >
          loading the 3D stage…
        </div>

        <div
          ref={bind('flash')}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: 'radial-gradient(circle at 50% 50%,#FFF8E8,rgba(255,248,232,0) 70%)',
            opacity: 0,
          }}
        />

        {/* Frame 02 — Opening verse */}
        <div ref={bind('tx2')} style={{ position: 'absolute', ...(land ? { left: 1016, right: 56, top: '26%' } : { left: 110, right: 110, top: '36%' }), textAlign: 'center', opacity: 0, willChange: 'transform' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 38, padding: '64px 56px', border: '1px solid rgba(122,95,53,.28)' }}>
            <div style={{ fontSize: 22, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Opening verse</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 46, lineHeight: 1.5, color: '#6B573A' }}>
              &ldquo;and the two will become one flesh. So they are no longer two, but one.&rdquo;
            </div>
            <div style={{ fontSize: 24, letterSpacing: '.28em', textTransform: 'uppercase', color: '#8A7248' }}>{WEDDING_DATA.verse.reference}</div>
          </div>
        </div>

        {/*
          Frame 03 — The Couple. Rebuilt fresh from the concept doc (frame 03
          "Elemen 3D": two name cards floating at different depths with
          parallax, one half-body photo beside each, joined by a large "&"
          between them — Reinaldo's photo on the right, Eunike's on the
          left), NOT ported from the prototype's Three.js canvas-texture
          cards (`cardR`/`cardE`/`amp`) — same reasoning as the frame 02
          monogram: plain DOM text renders crisper than a canvas-drawn
          texture and is trustworthy to verify in a screenshot. Both the name
          text and the photo sit in matching bordered card boxes (2026-09-12:
          the first pass left the text floating with no box, which read as a
          different design than the reference — this version boxes both
          sides so the two halves read as one joined card, like the
          original). Two rows (Reinaldo up top, Eunike below) each get their
          own ref so SceneController can drive their fade + a small
          depth-parallax drift independently, matching "dua kedalaman
          berbeda"; the ampersand between them gets its own ref too, fading
          in with the same `o3` timing (`o3 * 0.9`, same ratio the old `amp`
          mesh used).
        */}
        <div ref={bind('couple3')} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}>
          <div
            ref={bind('couple3Reinaldo')}
            style={{ position: 'absolute', ...(land ? { left: 1000, right: 60, top: '13%' } : { left: 60, right: 60, top: '20%' }), display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 26, willChange: 'transform' }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 14,
                textAlign: 'left',
                padding: '38px 42px',
                background: 'rgba(253,250,243,.92)',
                border: '1px solid rgba(122,95,53,.3)',
                boxShadow: '0 16px 34px rgba(90,68,37,.18)',
              }}
            >
              <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 66, color: '#5A4425', lineHeight: 1 }}>Reinaldo</span>
              <div style={{ width: 48, height: 1, background: '#B08D4C' }} />
              <span style={{ fontSize: 17, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8A7248' }}>Second Son of</span>
              <span style={{ fontSize: 17, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8A7248' }}>Ricky Susilo Family</span>
            </div>
            <div style={{ width: 230, aspectRatio: '0.82', flex: 'none', border: '1px solid rgba(122,95,53,.35)', boxShadow: '0 20px 46px rgba(90,68,37,.25)', overflow: 'hidden', background: '#EFE4CE' }}>
              <img src="/photos/couple-reinaldo.webp" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </div>

          <div ref={bind('couple3Amp')} style={{ position: 'absolute', ...(land ? { left: 960, right: 0, top: '42.5%' } : { left: 0, right: 0, top: '46%' }), textAlign: 'center' }}>
            <img src="/assets/ampersand-glyph.svg" alt="&" style={{ height: land ? 112 : 128, display: 'inline-block' }} />
          </div>

          <div
            ref={bind('couple3Eunike')}
            style={{ position: 'absolute', ...(land ? { left: 1000, right: 60, top: '59%' } : { left: 60, right: 60, top: '62%' }), display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: 26, willChange: 'transform' }}
          >
            <div style={{ width: 230, aspectRatio: '0.82', flex: 'none', border: '1px solid rgba(122,95,53,.35)', boxShadow: '0 20px 46px rgba(90,68,37,.25)', overflow: 'hidden', background: '#EFE4CE' }}>
              <img src="/photos/couple-eunike.webp" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 14,
                textAlign: 'left',
                padding: '38px 42px',
                background: 'rgba(253,250,243,.92)',
                border: '1px solid rgba(122,95,53,.3)',
                boxShadow: '0 16px 34px rgba(90,68,37,.18)',
              }}
            >
              <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 66, color: '#5A4425', lineHeight: 1 }}>Eunike Adabella</span>
              <div style={{ width: 48, height: 1, background: '#B08D4C' }} />
              <span style={{ fontSize: 17, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8A7248' }}>The Only Daughter of</span>
              <span style={{ fontSize: 17, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8A7248' }}>Sugianto Suwito Family</span>
            </div>
          </div>
        </div>

        {/*
          Frame 04 — Distance labels (CIKARANG / SURABAYA / "3 years").
          Rebuilt as DOM (was `labCik`/`labSby`/`lab3`, three more
          canvas-texture Three.js planes) for the same reliability reason as
          everywhere else in this pass. Vertical position is driven from
          SceneController using the same `gap` value that pushes the two
          paper pieces (`shA`/`shB`, left as Three.js — they're real 3D paper
          geometry with lighting, not text, so there's no reliability
          upside to porting them) apart, so the labels track the widening
          split exactly.
        */}
        {/*
          Frame 04 crack background (2026-09-12). The dark "rift" the two
          paper pieces pull apart to reveal used to be Three.js-only (a
          canvas-texture plane, `rift` in SceneController) — its color WAS
          made to shift over the frame (champagne → ink), but that shift
          turned out to be imperceptible on a real device even though it
          measured correctly via direct canvas pixel sampling here. Added
          this plain DOM band on top of it, driven by the same `gapPx`/
          `breathe` values, so the color change is real CSS and guaranteed
          visible in any browser — same reasoning as every other WebGL→DOM
          swap in this file. `rift`'s own color animation is left in place
          underneath (harmless, and still correct for anyone who *can* see
          WebGL color shifts); this is now the layer that actually sells it.
        */}
        {/*
          2026-09-12: the whole group below (gapBg + labCik/labSby/lab3) is
          anchored at `calc(50% - 100px)` instead of a plain `50%` — "yang
          component lain juga ikut naik ... bagian atas berkurang 100px,
          pita emas naik 100px, dan bagian bawah bertambah 100px". Shifting
          the shared anchor (rather than adding a one-off offset to each
          label, which was tried first and broke the group's own internal
          spacing) moves the band and all three labels up together by
          exactly 100px as one unit, shrinking the empty space above them
          and growing the space below by the same 100px, with their
          relative spacing to each other unchanged.
        */}
        <div
          ref={bind('gapBg')}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            // Landscape: centred on the 3D crack itself (no 100px raise — the
            // text column sits beside it, not above/below). Full width, like
            // the paper split underneath.
            top: land ? '50%' : 'calc(50% - 100px)',
            transform: 'translateY(-50%)',
            height: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />

        <div ref={bind('labCik')} style={{ position: 'absolute', ...(land ? LEFT_HALF : { left: 0, right: 0 }), top: land ? '50%' : 'calc(50% - 100px)', textAlign: 'center', fontSize: 32, letterSpacing: '.3em', textTransform: 'uppercase', color: '#8A6B3A', opacity: 0, willChange: 'transform' }}>
          Cikarang
        </div>
        <div ref={bind('labSby')} style={{ position: 'absolute', ...(land ? LEFT_HALF : { left: 0, right: 0 }), top: land ? '50%' : 'calc(50% - 100px)', textAlign: 'center', fontSize: 32, letterSpacing: '.3em', textTransform: 'uppercase', color: '#8A6B3A', opacity: 0, willChange: 'transform' }}>
          Surabaya
        </div>
        {/*
          "3 years" is meant to sit dead-center in the gapBg band — unlike
          labCik/labSby (which get a dynamic translateY from paint() to track
          the widening gap), this one has no JS-driven transform, so it needs
          its own static translateY(-50%) here or its top:'50%' only pins its
          top edge to center, leaving it visibly low (2026-09-12 fix).
        */}
        <div ref={bind('lab3')} style={{ position: 'absolute', ...(land ? LEFT_HALF : { left: 0, right: 0 }), top: land ? '50%' : 'calc(50% - 100px)', transform: 'translateY(-50%)', textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 42, color: '#5A4425', opacity: 0 }}>
          3 years
        </div>

        {/* Frame 04 — Distance (top text block) */}
        <div ref={bind('tx4')} style={{ position: 'absolute', ...(land ? { left: 1016, right: 56, top: '13%' } : { left: 120, right: 120, top: '7.5%' }), opacity: 0, willChange: 'transform' }}>
          <p style={{ margin: 0, fontFamily: "'Cormorant Garamond',serif", fontSize: 46, lineHeight: 1.45, color: '#5A4830' }}>
            They met in the same room, as two people who did not yet know each other.
          </p>
          <p style={{ margin: '30px 0 0', fontFamily: "'Cormorant Garamond',serif", fontSize: 46, lineHeight: 1.45, color: '#5A4830' }}>
            Then one of them had to leave — not by choice, but by circumstance.
          </p>
        </div>

        {/* Frame 05 — Messages */}
        <div ref={bind('tx5')} style={{ position: 'absolute', ...(land ? { left: 1016, right: 56, bottom: '12%' } : { left: 120, right: 120, bottom: '13%' }), opacity: 0, willChange: 'transform' }}>
          <p style={{ margin: 0, fontFamily: "'Cormorant Garamond',serif", fontSize: 42, lineHeight: 1.42, color: '#5A4830' }}>
            Distance did not pull them apart. Their conversations grew increasingly intense.
          </p>
          <p style={{ margin: '28px 0 0', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 38, lineHeight: 1.45, color: '#8A6B3A' }}>
            Enduring love is love that is continually chosen, even from a distance.
          </p>
        </div>

        {/*
          Frame 05 — message thread overlay, "smoke" pass (2026-09-12,
          refined once more the same day). Each bubble keeps the manga/
          comic speech-bubble look (rounded pill, small triangular tail on
          its speaker's corner, the mockup's original two colors — cream-
          bordered / solid `#B08D4C`-at-.85-opacity), confined to exactly
          the height of `gapBg` (the gold/dark band): this container
          (`msgThread`) is kept the same height as `gapBg` every frame in
          SceneController.paint(), and shares the same `top`/`transform`
          anchor, so bubbles never reach as far up as CIKARANG (above the
          band) or down to SURABAYA (below it) — that overlap can't recur,
          by construction. MOTION, clarified after two earlier guesses:
          each bubble rises straight up (bottom to top of the band) with a
          gentle rotation, but does NOT drift left/right during its own
          rise — instead each bubble gets its own FIXED `right`% spawn
          point, increasing by index ("yang awalnya menggunakan right:0,
          bubble text selanjutnya muncul dari right:5 dst") so the
          SEQUENCE of bubbles reads as shifting further left over time,
          not any single bubble sliding sideways. `right`/`transform`
          (translateY + rotate) are set once per bubble in `paint()`; only
          `width`/colors/tail stay static here. Layered on top of — not
          replacing — the 26 Three.js paper slips already crossing the gap
          (kept as-is; real 3D geometry/lighting, no reliability reason to
          touch it).
        */}
        <div
          ref={bind('msgThread')}
          style={{
            position: 'absolute',
            // Landscape: same 640px-wide thread, centred in the left-half scene.
            ...(land ? { left: 160, width: 640 } : { left: 220, right: 220 }),
            top: land ? '50%' : 'calc(50% - 100px)',
            transform: 'translateY(-50%)',
            height: 0, // driven every frame in SceneController.paint(), matched to gapBg's own height
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          {MSG_BUBBLES.map((b, i) => {
            const bg = b.side === 'left' ? '#FDFAF3' : 'rgba(176,141,76,.85)';
            return (
              <div
                key={i}
                ref={bind(`msg${i}`)}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: '0%', // fixed per-bubble spawn point, set once in paint() (a "staircase" across the sequence, not animated per-bubble)
                  width: `${b.widthPct}%`,
                  height: 28,
                  boxSizing: 'border-box',
                  borderRadius: 14,
                  background: bg,
                  border: b.side === 'left' ? '1px solid rgba(43,36,25,.14)' : 'none',
                  opacity: 0,
                  willChange: 'transform, opacity',
                }}
              >
                {/* Speech-bubble tail, pointing down toward the speaker's side */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: -6,
                    ...(b.side === 'left' ? { left: 10 } : { right: 10 }),
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: `7px solid ${bg}`,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/*
          Frame 06 — "The Journey" traveling light, rebuilt as plain DOM
          (2026-09-19). The original was a ported-as-is Three.js sphere +
          point light + trail plane — even after a pass that aligned its
          world-space position to labCik/labSby's real projected screen
          position, the user reported it still never actually appeared on
          their real device/browser at all ("Titiknya masih belum keluar.
          Buat ulang, jangan menggunakan yang dari prototipe"), matching
          this project's standing lesson that WebGL canvas content here
          isn't reliably visible on real browsers even when it measures
          correctly in this tool's own diagnostics (see the frame-04
          crack-color saga). Replaced with a plain glowing circle + trailing
          streak — real CSS opacity/transform, guaranteed to render.
          `journeyThread` shares gapBg/msgThread's exact anchor and is kept
          the same height (`bandH`) every frame in SceneController.paint(),
          so the light's travel is confined to exactly the same band BY
          CONSTRUCTION: top edge (0) sits just below CIKARANG, bottom edge
          (`bandH`) just above SURABAYA — no 3D-to-screen projection needed.
        */}
        <div
          ref={bind('journeyThread')}
          style={{
            position: 'absolute',
            ...(land ? LEFT_HALF : { left: 0, right: 0 }),
            top: land ? '50%' : 'calc(50% - 100px)',
            transform: 'translateY(-50%)',
            height: 0, // driven every frame in SceneController.paint(), matched to gapBg's own height
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <div
            ref={bind('journeyTrail')}
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: 3,
              height: 0, // grows with the dot's own progress, driven in paint()
              transform: 'translateX(-50%)',
              background: 'linear-gradient(to bottom, rgba(228,197,138,0) 0%, rgba(240,214,158,.85) 100%)',
              opacity: 0,
            }}
          />
          <div
            ref={bind('journeyDot')}
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: 22,
              height: 22,
              marginLeft: -11,
              marginTop: -11,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #FFFBF0 0%, #FFE3A5 55%, rgba(255,227,165,0) 78%)',
              boxShadow: '0 0 34px 12px rgba(255,221,150,.55), 0 0 12px 5px rgba(255,246,222,.95)',
              opacity: 0,
            }}
          />
        </div>

        {/* Frame 06 — The Journey */}
        <div ref={bind('tx6')} style={{ position: 'absolute', ...(land ? { left: 1016, right: 56, top: '60%' } : { left: 120, right: 120, top: '72%' }), opacity: 0, willChange: 'transform' }}>
          <p style={{ margin: 0, fontFamily: "'Cormorant Garamond',serif", fontSize: 46, lineHeight: 1.45, color: '#5A4830' }}>
            A month later, one of them decided not to simply wait.
          </p>
          <p style={{ margin: '30px 0 0', fontFamily: "'Cormorant Garamond',serif", fontSize: 54, lineHeight: 1.35, color: '#7A5F35' }}>He went to meet her.</p>
        </div>

        {/* Frame 07 — Reunited */}
        <div ref={bind('tx7')} style={{ position: 'absolute', ...(land ? { left: 1016, right: 56, top: '50%', marginTop: -260 } : { left: 120, right: 120, bottom: '13%' }), textAlign: 'center', opacity: 0, willChange: 'transform' }}>
          <p style={{ margin: 0, fontFamily: "'Cormorant Garamond',serif", fontSize: 54, lineHeight: 1.4, color: '#5A4830' }}>Now they are no longer apart.</p>
          <p style={{ margin: '30px 0 0', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 44, lineHeight: 1.5, color: '#8A6B3A' }}>
            Two people once strangers, once separated by distance, finally stand side by side.
          </p>
          <p style={{ margin: '34px 0 0', fontFamily: "'Cormorant Garamond',serif", fontSize: 46, lineHeight: 1.4, color: '#7A5F35' }}>Finally, here. Finally, REunited.</p>
          <div ref={bind('tx8')} style={{ marginTop: 40, fontSize: 22, letterSpacing: '.3em', textTransform: 'uppercase', color: 'rgba(122,95,53,.6)', opacity: 0 }}>
            event details ↓
          </div>
        </div>

        {/* Frame 08 — Holy Matrimony */}
        <div ref={bind('p08')} style={{ position: 'absolute', ...(land ? { ...RIGHT_COL, top: 60, bottom: 170, justifyContent: 'center', gap: 26 } : { left: 90, right: 90, top: '13%', gap: 40 }), display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0, willChange: 'transform' }}>
          <div style={{ fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Holy Matrimony</div>
          <div
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: land ? '34px 44px' : '56px 48px',
              background: 'rgba(253,250,243,.95)',
              border: '1px solid rgba(122,95,53,.26)',
              boxShadow: '0 30px 64px rgba(122,95,53,.2)',
            }}
          >
            <div style={{ fontSize: 28, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>Saturday</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 132 : 200, lineHeight: land ? 1.02 : 0.92, color: '#7A5F35' }}>19</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 46 : 58, lineHeight: 1.1, color: '#5A4830' }}>December 2026</div>
            <div
              style={{
                marginTop: 20,
                paddingTop: 24,
                borderTop: '1px solid rgba(122,95,53,.22)',
                alignSelf: 'stretch',
                textAlign: 'center',
                fontSize: 30,
                letterSpacing: '.26em',
                textTransform: 'uppercase',
                color: '#8A7248',
              }}
            >
              2.00 PM WIB
            </div>
          </div>
          <div style={{ alignSelf: 'stretch', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18 }}>
            {[
              ['cdD', 'days'],
              ['cdH', 'hours'],
              ['cdM', 'minutes'],
              ['cdS', 'seconds'],
            ].map(([key, label]) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: land ? 8 : 10, padding: land ? '16px 0' : '26px 0', border: '1px solid rgba(122,95,53,.22)' }}>
                <span ref={bind(key)} style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 56 : 74, lineHeight: 1, color: '#7A5F35' }}>
                  —
                </span>
                <span style={{ fontSize: land ? 22 : 20, letterSpacing: '.24em', textTransform: 'uppercase', color: '#A08B62' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Frame 09 — Venue */}
        <div ref={bind('p09')} style={{ position: 'absolute', ...(land ? { ...RIGHT_COL, top: 60, bottom: 170, justifyContent: 'center', gap: 24 } : { left: 90, right: 90, top: '15%', gap: 34 }), display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0, willChange: 'transform' }}>
          <div style={{ fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Venue</div>
          <div
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              gap: land ? 12 : 16,
              padding: land ? '32px 40px' : '48px 44px',
              background: 'rgba(253,250,243,.95)',
              border: '1px solid rgba(122,95,53,.26)',
              boxShadow: '0 30px 64px rgba(122,95,53,.2)',
            }}
          >
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 60 : 72, lineHeight: 1.05, color: '#7A5F35' }}>{WEDDING_DATA.venue.name}</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 38, lineHeight: 1.45, color: '#5A4830' }}>
              {WEDDING_DATA.venue.address || 'Address to follow'}
            </div>
          </div>
          {/* 2026-09-26: static map placeholder replaced with the custom
              illustrated venue map (1800x840 = 2x the 900x420 slot). */}
          <div
            style={{
              alignSelf: 'stretch',
              height: land ? 240 : 420,
              background: '#F2EADA',
              border: '1px solid rgba(122,95,53,.24)',
              overflow: 'hidden',
            }}
          >
            <img
              src="/assets/venue-map.webp"
              alt={`Map to ${WEDDING_DATA.venue.name}`}
              width={1800}
              height={840}
              decoding="async"
              draggable={false}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <button
            onClick={() => {
              c().onMaps();
              if (WEDDING_DATA.venue.mapsUrl) window.open(WEDDING_DATA.venue.mapsUrl, '_blank');
            }}
            style={{
              alignSelf: 'stretch',
              padding: land ? 20 : 30,
              border: '1px solid rgba(122,95,53,.5)',
              background: '#7A5F35',
              color: '#FDFAF3',
              fontFamily: "'Jost',sans-serif",
              fontSize: 26,
              letterSpacing: '.24em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Open in Google Maps
          </button>
          <span ref={bind('mapsNote')} style={{ fontSize: 20, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)', opacity: 0 }}>
            {WEDDING_DATA.venue.mapsUrl ? '' : 'map link to follow'}
          </span>
        </div>

        {/* Frame 10 — Dress Code */}
        <div ref={bind('p10')} style={{ position: 'absolute', ...(land ? { ...RIGHT_COL, top: 60, bottom: 170, justifyContent: 'center', gap: 30 } : { left: 90, right: 90, top: '24%', gap: 46 }), display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0, willChange: 'transform' }}>
          <div style={{ fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Dress Code</div>
          <p style={{ margin: 0, maxWidth: 840, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 56, lineHeight: 1.32, color: '#5A4830' }}>
            Any colour you like — <span style={{ fontStyle: 'italic', color: '#8A6B3A' }}>except these three.</span>
          </p>
          {/*
            2026-09-19: user flagged these three swatches need a visible
            strikethrough ("harusnya di coret, karna dresscodenya selain
            dari 3 warna itu" — dress code is any colour EXCEPT these
            three, so a plain solid circle reads as "wear this" rather
            than "avoid this"). Added a diagonal bar across each swatch
            (its own absolutely-positioned child, rotated -45deg, with a
            light halo so it stays legible over both the white and the
            dark swatches). Follow-up same day: the strike belongs on the
            SWATCH only, not the label text below it ("yang warna saja,
            untuk tulisan tidak perlu") — the line-through on the label
            span was removed. Strike color went through two iterations:
            first a generic muted red (`#B23B3B`, not from this project's
            palette at all), then `#2B2419` (Ink) to at least be in the
            documented brand palette — but the user then asked to match it
            to the "except these three" text's own accent color instead
            (`#8A6B3A`, the same span a few lines up), tying the strike
            visually to the word that already carries the "these are
            excluded" meaning, rather than to the palette's neutral dark
            ink. Final color: `#8A6B3A`.
          */}
          <div style={{ display: 'flex', gap: 44 }}>
            {WEDDING_DATA.dressCode.colors.map((label) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                <span
                  style={{
                    position: 'relative',
                    width: land ? 150 : 190,
                    height: land ? 150 : 190,
                    borderRadius: '50%',
                    background: DRESS_SWATCH[label.toLowerCase()] || '#CCCCCC',
                    border: '1px solid rgba(122,95,53,.35)',
                    display: 'block',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      width: '150%',
                      height: 6,
                      background: '#8A6B3A',
                      boxShadow: '0 0 0 3px rgba(253,250,243,.75)',
                      transform: 'translate(-50%, -50%) rotate(-45deg)',
                      borderRadius: 3,
                    }}
                  />
                </span>
                <span style={{ fontSize: 22, letterSpacing: '.2em', textTransform: 'uppercase', color: '#8A7248' }}>{label}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, maxWidth: 820, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 42, lineHeight: 1.45, color: '#8A6B3A' }}>
            {WEDDING_DATA.dressCode.colors.join(', ')} are reserved for the immediate family — beyond that, please wear whatever makes you comfortable.
          </p>
        </div>

        {/* Frame 11 — Gallery (trigger for scrapbook overlay) */}
        <div
          ref={bind('p11')}
          style={{ position: 'absolute', ...(land ? { ...RIGHT_COL, top: 60, bottom: 170 } : { left: 90, right: 90, top: 80, bottom: 200 }), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 44, opacity: 0, willChange: 'transform' }}
        >
          <div style={{ fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Gallery</div>
          <p style={{ margin: 0, maxWidth: 820, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 48, lineHeight: 1.4, color: '#5A4830' }}>
            The small pieces of our journey — from the first meeting to this very day — gathered into one album.
          </p>
          <button
            onClick={() => c().onScrapOpen()}
            style={{ whiteSpace: 'nowrap', padding: '34px 56px', border: '1px solid rgba(122,95,53,.5)', background: '#7A5F35', color: '#FDFAF3', fontFamily: "'Jost',sans-serif", fontSize: 28, letterSpacing: '.24em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            Open the Album
          </button>
        </div>

        {/* Frame 13 (data-k p12) — RSVP + Wishes */}
        {/*
          2026-09-19: this frame previously had its own outer scroll
          (data-scroll + overflowY:auto) in addition to the wishes list's
          own inner scroll below — two independent scrollable regions
          stacked inside each other, which the user flagged as confusing
          ("jangan sampe ada 2 scroll seperti sekarang"). Fixed by making
          this outer frame a plain fixed-height flex column (no scroll of
          its own — overflow:hidden so nothing can visually bleed past its
          bounds) and letting only the wishes list flex to fill whatever
          vertical space is left after the RSVP header/card/write-wish form
          take their natural height, via flex:'1 1 auto' + minHeight:0 on
          both this list's wrapper and the list itself (the minHeight:0 is
          required for a flex child to be allowed to shrink below its
          content size instead of pushing this frame taller than its fixed
          bottom:60 bound). Now there is exactly one scrollable region.
        */}
        <div
          ref={bind('p12')}
          style={{
            position: 'absolute',
            overflow: 'hidden',
            opacity: 0,
            willChange: 'transform',
            // 2026-09-26 landscape: two columns — RSVP/write-a-wish on the
            // left, the Wishes & Prayers wall on the right — instead of the
            // single tall column, which on a 1080-tall canvas would leave
            // the (only) scrollable wishes list just a sliver. Still exactly
            // one scroll region.
            ...(land
              ? { left: 200, right: 200, top: 56, bottom: 150, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 80 }
              : { left: 90, right: 90, top: '6%', bottom: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }),
          }}
        >
          {/* Portrait: `display:contents` so these children stay direct flex items of p12 exactly as before. */}
          <div style={land ? { minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 } : { display: 'contents' }}>
          <div style={{ flexShrink: 0, fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>RSVP</div>
          <p style={{ flexShrink: 0, margin: 0, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: land ? 38 : 42, lineHeight: 1.4, color: '#8A6B3A' }}>
            Your presence is the greatest gift we could ask for.
          </p>

          <div style={{ flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: land ? 14 : 26, padding: land ? '26px 32px' : '44px 40px', background: 'rgba(253,250,243,.95)', border: '1px solid rgba(122,95,53,.26)', boxShadow: '0 30px 64px rgba(122,95,53,.2)' }}>
            {rsvp.status === 'hadir' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
                {/*
                  2026-09-19: don't reveal the QR/short-code the instant the
                  form is submitted in THIS session ("jangan langsung diubah
                  ke qr code") — show a plain confirmation instead, and only
                  the guest's NEXT open of the invitation (a fresh page load,
                  where `justSubmitted` resets to its default `false`) shows
                  the QR, as originally requested ("biarkan qr code muncul
                  saat undangan sudah isi attending dan dibuka yang
                  selanjutnya").
                */}
                {justSubmitted ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '10px 0' }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 40, color: '#7A5F35', textAlign: 'center' }}>
                      Thank you — see you there!
                    </div>
                    <div style={{ fontSize: 18, letterSpacing: '.1em', color: 'rgba(122,95,53,.6)', textAlign: 'center', maxWidth: 460, lineHeight: 1.5 }}>
                      Your check-in QR code will be ready the next time you open this invitation.
                    </div>
                  </div>
                ) : (
                  <div
                    onDoubleClick={() => setShowShortCode((s) => !s)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}
                  >
                    {!showShortCode && rsvp.qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rsvp.qrDataUrl} alt="Your check-in QR code" style={{ width: land ? 200 : 260, height: land ? 200 : 260 }} />
                    ) : (
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 64, letterSpacing: '.08em', color: '#7A5F35' }}>{rsvp.shortCode}</div>
                    )}
                    <div style={{ fontSize: 20, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)' }}>double-tap to {showShortCode ? 'show QR' : 'show code'}</div>
                  </div>
                )}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, color: '#5A4830', textAlign: 'center' }}>
                  You&apos;ve confirmed attendance for {rsvp.guestCount} guest{(rsvp.guestCount ?? 1) > 1 ? 's' : ''}.
                </div>
                {/* 2026-09-19: "saya tidak melihat tombol untuk edit jumlah guest" */}
                {editingGuestCount ? (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', alignSelf: 'stretch' }}>
                    <input
                      type="number"
                      min={1}
                      max={2}
                      value={editCount}
                      onFocus={() => c().onFormFocus()}
                      onChange={(e) => setEditCount(e.target.value)}
                      style={{ flex: 1, padding: '18px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: 30, color: '#5A4830' }}
                    />
                    <button
                      disabled={editingGuestSubmitting}
                      onClick={handleEditGuestCount}
                      style={{ padding: '18px 22px', border: '1px solid rgba(122,95,53,.5)', background: '#7A5F35', color: '#FDFAF3', fontFamily: "'Jost',sans-serif", fontSize: 20, letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingGuestCount(false)}
                      style={{ padding: '18px 22px', border: '1px solid rgba(122,95,53,.3)', background: 'transparent', color: '#8A7248', fontFamily: "'Jost',sans-serif", fontSize: 20, letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditCount(String(rsvp.guestCount ?? 1));
                      setEditingGuestCount(true);
                    }}
                    style={{ padding: '16px 22px', border: '1px solid rgba(122,95,53,.35)', background: 'transparent', color: '#8A7248', fontFamily: "'Jost',sans-serif", fontSize: 18, letterSpacing: '.14em', textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    Edit number of guests
                  </button>
                )}
              </div>
            ) : rsvp.status === 'tidak_hadir' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, color: '#5A4830', textAlign: 'center' }}>
                  Thanks for letting us know you can&apos;t make it.
                </div>
                <button
                  onClick={() => setReopenCount('1')}
                  style={{ padding: 24, border: '1px solid rgba(122,95,53,.4)', background: '#FFFDF8', color: '#5A4830', fontFamily: "'Jost',sans-serif", fontSize: 24, letterSpacing: '.16em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  Turns out I can come?
                </button>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <input
                    type="number"
                    min={1}
                    max={2}
                    value={reopenCount}
                    onChange={(e) => setReopenCount(e.target.value)}
                    onFocus={() => c().onFormFocus()}
                    style={{ flex: 1, padding: land ? '14px 18px' : '22px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 36, color: '#5A4830' }}
                  />
                  <button
                    disabled={reopening}
                    onClick={handleReopenSubmit}
                    style={{ padding: 24, border: '1px solid rgba(122,95,53,.5)', background: '#7A5F35', color: '#FDFAF3', fontFamily: "'Jost',sans-serif", fontSize: 24, letterSpacing: '.16em', textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Name</span>
                  <input
                    readOnly
                    value={guestName}
                    style={{ padding: land ? '14px 18px' : '22px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 36, color: '#5A4830' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Number of guests</span>
                  <input
                    type="number"
                    min={1}
                    max={2}
                    value={formCount}
                    onFocus={() => c().onFormFocus()}
                    onChange={(e) => setFormCount(e.target.value)}
                    style={{ padding: land ? '14px 18px' : '22px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 36, color: '#5A4830' }}
                  />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Confirmation</span>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <button
                      onClick={() => {
                        c().onFormFocus();
                        setFormAttending('hadir');
                      }}
                      style={{
                        flex: 1,
                        padding: land ? 16 : 24,
                        border: formAttending === 'hadir' ? '1px solid #7A5F35' : '1px solid rgba(122,95,53,.4)',
                        background: formAttending === 'hadir' ? '#F1E7D3' : '#FFFDF8',
                        color: '#5A4830',
                        fontFamily: "'Jost',sans-serif",
                        fontSize: 24,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Attending
                    </button>
                    <button
                      onClick={() => {
                        c().onFormFocus();
                        setFormAttending('tidak_hadir');
                      }}
                      style={{
                        flex: 1,
                        padding: land ? 16 : 24,
                        border: formAttending === 'tidak_hadir' ? '1px solid #7A5F35' : '1px solid rgba(122,95,53,.4)',
                        background: formAttending === 'tidak_hadir' ? '#F1E7D3' : '#FFFDF8',
                        color: '#5A4830',
                        fontFamily: "'Jost',sans-serif",
                        fontSize: 24,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Not attending
                    </button>
                  </div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Message</span>
                  <textarea
                    value={formMessage}
                    onFocus={() => c().onFormFocus()}
                    onChange={(e) => setFormMessage(e.target.value)}
                    rows={land ? 2 : 3}
                    placeholder="Write your wishes and prayers"
                    style={{ padding: land ? '14px 18px' : '22px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 30 : 34, lineHeight: 1.4, color: '#5A4830', resize: 'none' }}
                  />
                </label>
                <button
                  disabled={submitting}
                  onClick={handleFormSubmit}
                  style={{ padding: land ? 20 : 30, border: '1px solid rgba(122,95,53,.5)', background: '#7A5F35', color: '#FDFAF3', fontFamily: "'Jost',sans-serif", fontSize: 26, letterSpacing: '.24em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  Send
                </button>
                {rsvpNote && <span style={{ textAlign: 'center', fontSize: 20, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)' }}>{rsvpNote}</span>}
              </>
            )}
          </div>

          {/*
            2026-09-19: "saya tidak melihat tombol untuk ... mengisi wishes
            lagi" — the Message field above only ever exists as part of the
            ONE-TIME initial RSVP form (the `else` branch just above, which
            is gone for good once `rsvp.status` is set). This standalone
            mini-form renders instead once `rsvp.status !== null` (either
            'hadir' or 'tidak_hadir'), so a guest can send more than one
            wish, including on a later visit. Reuses the same `submitWish`
            call the initial form itself uses.
          */}
          {rsvp.status !== null && (
            <div style={{ flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: land ? 12 : 20, padding: land ? '22px 32px' : '36px 40px', background: 'rgba(253,250,243,.95)', border: '1px solid rgba(122,95,53,.26)' }}>
              <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Write another wish</span>
              <textarea
                value={wishDraft}
                onFocus={() => c().onFormFocus()}
                onChange={(e) => setWishDraft(e.target.value)}
                rows={land ? 2 : 3}
                placeholder="Write your wishes and prayers"
                style={{ padding: land ? '14px 18px' : '22px 20px', border: '1px solid rgba(122,95,53,.3)', background: '#FFFDF8', fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 30 : 34, lineHeight: 1.4, color: '#5A4830', resize: 'none' }}
              />
              <button
                disabled={wishSubmitting || !wishDraft.trim()}
                onClick={handleWishSubmit}
                style={{ padding: land ? 16 : 26, border: '1px solid rgba(122,95,53,.5)', background: '#7A5F35', color: '#FDFAF3', fontFamily: "'Jost',sans-serif", fontSize: 22, letterSpacing: '.2em', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                Send
              </button>
              {wishNote && <span style={{ textAlign: 'center', fontSize: 18, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)' }}>{wishNote}</span>}
            </div>
          )}

          </div>

          <div style={{ flex: '1 1 auto', minHeight: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 22, marginTop: land ? 0 : 10 }}>
            <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 22, letterSpacing: '.3em', textTransform: 'uppercase', color: '#A08B62' }}>Wishes &amp; Prayers</div>
            <div data-scroll="1" style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 8 }}>
              {wishes.map((w) => (
                <div key={w.id} style={{ padding: '26px 30px', background: 'rgba(253,250,243,.9)', border: '1px solid rgba(122,95,53,.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 18 }}>
                    <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, color: '#5A4830' }}>{w.name}</span>
                    <span style={{ fontSize: 20, letterSpacing: '.18em', textTransform: 'uppercase', color: '#8A7248' }}>{w.when}</span>
                  </div>
                  <p style={{ margin: '10px 0 0', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 32, lineHeight: 1.4, color: '#8A6B3A' }}>{w.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Frame 12 (data-k p13) — Wedding Gift */}
        <div ref={bind('p13')} style={{ position: 'absolute', ...(land ? { ...RIGHT_COL, right: 90, top: 110, bottom: 130 } : { left: 90, right: 90, top: 80, bottom: 200 }), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30, opacity: 0, willChange: 'transform' }}>
          <div style={{ fontSize: 24, letterSpacing: '.34em', textTransform: 'uppercase', color: '#A08B62' }}>Wedding Gift</div>
          <p style={{ margin: 0, maxWidth: 800, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontSize: 42, lineHeight: 1.4, color: '#5A4830' }}>
            Your presence is truly what we cherish most. If you wish to share a gift, click this envelope.
          </p>
          <div ref={bind('envWrap')} style={{ alignSelf: 'stretch', flexShrink: 0, position: 'relative', height: land ? 300 : 400, transition: 'height .6s cubic-bezier(.22,1,.36,1)' }}>
            <button
              ref={bind('envBtn')}
              onClick={() => c().onEnv()}
              style={{
                position: 'absolute',
                // Landscape: a 560×300 envelope centred in the column (desktop prototype).
                ...(land ? { left: '50%', width: 560, marginLeft: -280 } : { left: 0, right: 0 }),
                top: 0,
                height: land ? 300 : 400,
                padding: 0,
                border: '1px solid rgba(122,95,53,.3)',
                background: 'linear-gradient(180deg,#FDFAF3,#F1E7D3)',
                boxShadow: '0 26px 58px rgba(122,95,53,.22)',
                cursor: 'pointer',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transformOrigin: 'center center',
                transition: 'opacity .5s ease,transform .6s cubic-bezier(.22,1,.36,1)',
              }}
            >
              <span
                ref={bind('envFlap')}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: land ? 150 : 210,
                  background: 'linear-gradient(180deg,#F6EEDC,#EADFC6)',
                  clipPath: 'polygon(0 0,100% 0,50% 100%)',
                  transformOrigin: 'top center',
                  transition: 'transform .7s cubic-bezier(.22,1,.36,1)',
                }}
              />
              <span
                ref={bind('envHint')}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 58, textAlign: 'center', fontSize: 24, letterSpacing: '.28em', textTransform: 'uppercase', color: '#8A7248', transition: 'opacity .4s ease' }}
              >
                touch to open
              </span>
            </button>
            <div
              ref={bind('envCard')}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                opacity: 0,
                transform: 'scale(.9)',
                transformOrigin: 'center center',
                transition: 'opacity .55s ease .25s,transform .7s cubic-bezier(.22,1,.36,1) .25s',
                pointerEvents: 'none',
              }}
            >
              {/* Landscape: bank accounts side by side (desktop prototype's 2-column grid). */}
              <div style={{ display: 'grid', gridTemplateColumns: land && WEDDING_DATA.bankAccounts.length > 1 ? '1fr 1fr' : '1fr', gap: 20 }}>
              {WEDDING_DATA.bankAccounts.map((acc, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: land ? 8 : 12, padding: land ? '26px 34px' : '36px 38px', background: 'rgba(253,250,243,.96)', border: '1px solid rgba(122,95,53,.26)', boxShadow: '0 24px 54px rgba(122,95,53,.18)' }}>
                  <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>{acc.bank || 'Bank'}</span>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: land ? 26 : 30, color: '#8A6B3A' }}>Account Number</span>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 44 : 60, lineHeight: 1.1, color: '#7A5F35', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{acc.accountNumber || '—'}</span>
                  <span style={{ marginTop: land ? 6 : 10, fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: land ? 26 : 30, color: '#8A6B3A' }}>Account Name</span>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 38, color: '#5A4830' }}>{acc.accountName || '—'}</span>
                </div>
              ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: land ? 8 : 12, padding: land ? '26px 34px' : '36px 38px', background: 'rgba(247,241,228,.96)', border: '1px solid rgba(122,95,53,.26)' }}>
                <span style={{ fontSize: 20, letterSpacing: '.22em', textTransform: 'uppercase', color: '#A08B62' }}>Send a Gift</span>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: land ? 26 : 30, color: '#8A6B3A' }}>Recipient</span>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 38, color: '#5A4830' }}>
                  {WEDDING_DATA.giftAddress.recipient || '—'} {WEDDING_DATA.giftAddress.phone ? `· ${WEDDING_DATA.giftAddress.phone}` : ''}
                </span>
                <span style={{ marginTop: land ? 6 : 10, fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: land ? 26 : 30, color: '#8A6B3A' }}>Address</span>
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: land ? 32 : 36, lineHeight: 1.4, color: '#5A4830' }}>{WEDDING_DATA.giftAddress.address || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Frame 14 — Closing */}
        <div ref={bind('p14')} style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 45%,#3A3122,#211B12 78%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, padding: '0 110px', boxSizing: 'border-box', opacity: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/monogram-RE-ivory.svg" alt="R&E monogram" style={{ width: land ? 340 : 420, display: 'block', opacity: 0.94 }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, fontFamily: "'Cormorant Garamond',serif", fontSize: 52, lineHeight: 1.35, color: '#EFE2C4', textAlign: 'center' }}>
            <span>Finally, here.</span>
            <span>Finally, together.</span>
            <span style={{ fontStyle: 'italic', color: '#D9BA80' }}>Finally, REunited.</span>
          </div>
          <div style={{ marginTop: 22, fontSize: 26, letterSpacing: '.34em', color: 'rgba(228,214,180,.75)' }}>{WEDDING_DATA.hashtag}</div>
        </div>

        {/* Frame 11 scrapbook overlay — full album, ported from
            Scrapbook/Galeri Popup Scrapbook Mobile.dc.html (2026-09-20).
            Pure DOM/CSS per this project's established DOM-over-WebGL
            pattern (the concept prototype itself has no WebGL at all).
            Sizes scaled up from the concept doc's 390px-wide preview to
            this app's actual 1080-wide design canvas (~2.77x). Backdrop
            tap-to-close mirrors the existing lightbox (`lb`)/mapsNote
            pattern already used elsewhere in this file; tapping inside the
            white card itself never closes it (stopPropagation) — only the
            header ✕ and footer "Close" buttons, or tapping the dark
            backdrop outside the card, close the overlay. Photo tap opens
            the existing lightbox (`lb`) in true fullscreen (onScrapCardClick
            -> onGalleryOpen), not a scale-in-place lift; the scroll-progress
            bar is driven imperatively from SceneController (onScrapScroll),
            matching this component's usual pattern of plain refs +
            imperative DOM writes rather than React state.
            15 photo slots filled with this project's existing sample/couple
            photos (photo-01..11.webp + couple-reinaldo/eunike.webp) —
            photo-04.webp and photo-05.webp are reused a second time to fill
            the 2 extra slots since only 13 source files exist on disk;
            final curated scrapbook photos still TBD per the project's
            "Not started" list; video slot renders a real YouTube embed once
            WEDDING_DATA.youtubeVideoId is filled in, placeholder until then. */}
        <div
          ref={bind('scrap')}
          onClick={() => c().onScrapClose()}
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,15,10,.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: land ? 0 : 90, boxSizing: 'border-box', opacity: 0, pointerEvents: 'none', cursor: 'pointer', transition: 'opacity .4s ease' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              // Landscape (2026-09-26): the album is a portrait scrapbook, so
              // on desktop it stays a centred column — the same 1400×1960
              // design as a tall card, scaled to .52 (~728×1020 on the
              // 1920×1080 canvas) rather than stretched edge to edge.
              ...(land
                ? { flex: 'none', width: 1400, height: 1960, transform: 'scale(.52)', transformOrigin: 'center center' }
                : { alignSelf: 'stretch', flex: 1 }),
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: '#FDFAF3',
              overflow: 'hidden',
              boxShadow: '0 60px 140px rgba(0,0,0,.5)',
              cursor: 'default',
            }}
          >
            {/* Header */}
            <div style={{ flex: 'none', position: 'relative', padding: '55px 55px 44px', borderBottom: '1px solid rgba(122,95,53,.18)', background: 'linear-gradient(#FFFDF7,#FBF6EA)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 32 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 72, lineHeight: 1, color: '#7A5F35' }}>Our Gallery</span>
                  <span style={{ fontSize: 24, letterSpacing: '.3em', textTransform: 'uppercase', color: '#A08B62' }}>15 photos · 1 video</span>
                </div>
                <button
                  onClick={() => c().onScrapClose()}
                  style={{ width: 122, height: 122, flex: 'none', border: '1px solid rgba(122,95,53,.4)', background: 'transparent', color: '#7A5F35', fontFamily: "'Jost',sans-serif", fontSize: 44, lineHeight: 1, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 6, background: 'rgba(122,95,53,.12)' }}>
                <div ref={bind('scrapBar')} style={{ width: '0%', height: '100%', background: '#B8935A', transition: 'width .1s linear' }} />
              </div>
            </div>

            {/* Scrollable album body */}
            <div
              ref={bind('scrapScroll')}
              data-scroll="1"
              onScroll={() => c().onScrapScroll()}
              onClick={(e) => c().onScrapCardClick(e.nativeEvent)}
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                WebkitOverflowScrolling: 'touch',
                background: 'linear-gradient(#FBF5E9,#F5EDDD)',
                maskImage: 'linear-gradient(to bottom,transparent 0,#000 90px,#000 calc(100% - 90px),transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom,transparent 0,#000 90px,#000 calc(100% - 90px),transparent 100%)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 144, padding: '144px 60px' }}>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 38 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 62, lineHeight: 1.4, color: '#8A6B3A', textAlign: 'center' }}>
                    Our Gallery<br />Reinaldo &amp; Eunike
                  </div>
                  <div style={{ width: 194, height: 2, background: 'rgba(122,95,53,.35)' }} />
                  <div style={{ fontSize: 24, letterSpacing: '.28em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)' }}>tap a photo to enlarge</div>
                </div>

                {/* Opening photo */}
                <div data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: '25px 25px 94px', background: '#FFFDF7', boxShadow: '0 32px 70px rgba(90,72,48,.18)', transform: 'rotate(-1.2deg)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                  <div style={{ position: 'absolute', left: -44, top: -25, width: 233, height: 55, background: 'rgba(226,205,160,.6)', transform: 'rotate(-8deg)' }} />
                  <div style={{ position: 'absolute', right: -39, top: -28, width: 205, height: 53, background: 'rgba(226,205,160,.55)', transform: 'rotate(7deg)' }} />
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/photos/photo-01.webp" alt="Our story begins" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                  </div>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 28, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 44, color: '#6B573A' }}>opening photo</div>
                </div>

                {/* Portrait pair */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 44, alignItems: 'start' }}>
                  {[
                    { src: '/photos/photo-02.webp', rot: 1.6, no: '02' },
                    { src: '/photos/photo-03.webp', rot: -2, no: '03' },
                  ].map((p) => (
                    <div key={p.no} data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: '22px 22px 72px', background: '#FFFDF7', boxShadow: '0 28px 60px rgba(90,72,48,.16)', transform: `rotate(${p.rot}deg)`, transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '3/4' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.src} alt="Portrait" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                      </div>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 22, textAlign: 'center', fontSize: 25, letterSpacing: '.26em', color: '#A08B62' }}>{p.no}</div>
                    </div>
                  ))}
                </div>

                {/* Collage */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 38, padding: '55px 44px', background: 'repeating-linear-gradient(135deg,#F2EADA 0 16px,#EFE6D2 16px 32px)', border: '1px solid rgba(122,95,53,.2)', boxShadow: '0 28px 66px rgba(90,72,48,.1)' }}>
                  <div style={{ fontSize: 25, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>collage</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gridTemplateRows: '266px 266px', gap: 28 }}>
                    <div data-photo style={{ position: 'relative', gridRow: 'span 2', minWidth: 0, minHeight: 0, height: '100%', padding: 17, background: '#FFFDF7', boxShadow: '0 22px 50px rgba(90,72,48,.16)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/photos/couple-reinaldo.webp" alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                      </div>
                    </div>
                    {['/photos/photo-04.webp', '/photos/photo-05.webp'].map((src) => (
                      <div key={src} data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: 17, background: '#FFFDF7', boxShadow: '0 22px 50px rgba(90,72,48,.16)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: 17, background: '#FFFDF7', boxShadow: '0 22px 50px rgba(90,72,48,.16)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '2/1' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/photos/photo-06.webp" alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                    </div>
                  </div>
                </div>

                {/* A favorite frame */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                    <span style={{ fontSize: 25, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>a favorite frame</span>
                    <span style={{ flex: 1, height: 2, background: 'rgba(122,95,53,.25)' }} />
                  </div>
                  <div data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: '28px 28px 89px', background: '#FFFDF7', boxShadow: '0 38px 84px rgba(90,72,48,.2)', transform: 'rotate(1.1deg)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/photos/couple-eunike.webp" alt="Our favorite" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 28, textAlign: 'center', fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 44, color: '#6B573A' }}>favorite</div>
                  </div>
                </div>

                {/* Instant frames */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                    <span style={{ fontSize: 25, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>instant frames</span>
                    <span style={{ flex: 1, height: 2, background: 'rgba(122,95,53,.25)' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 44, alignItems: 'start' }}>
                    {[
                      { src: '/photos/photo-07.webp', rot: -3, no: '09' },
                      { src: '/photos/photo-08.webp', rot: 2, no: '10' },
                      { src: '/photos/photo-04.webp', rot: -2.4, no: '11' },
                      { src: '/photos/photo-05.webp', rot: 1.8, no: '12' },
                    ].map((p) => (
                      <div key={p.no} data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: '22px 22px 83px', background: '#FFFEFA', boxShadow: '0 28px 60px rgba(90,72,48,.18)', transform: `rotate(${p.rot}deg)`, transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                        <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.src} alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                        </div>
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 25, textAlign: 'center', fontSize: 25, letterSpacing: '.26em', color: '#A08B62' }}>{p.no}</div>
                      </div>
                    ))}
                    <div data-photo style={{ position: 'relative', gridColumn: 'span 2', minWidth: 0, justifySelf: 'center', width: '62%', padding: '22px 22px 83px', background: '#FFFEFA', boxShadow: '0 28px 60px rgba(90,72,48,.18)', transform: 'rotate(-1.4deg)', transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/photos/photo-09.webp" alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                      </div>
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 25, textAlign: 'center', fontSize: 25, letterSpacing: '.26em', color: '#A08B62' }}>13</div>
                    </div>
                  </div>
                </div>

                {/* Landscape pair */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 50 }}>
                  {[
                    { src: '/photos/photo-10.webp', rot: -0.8 },
                    { src: '/photos/photo-11.webp', rot: 1 },
                  ].map((p) => (
                    <div key={p.src} data-photo style={{ position: 'relative', minWidth: 0, minHeight: 0, padding: 22, background: '#FFFDF7', boxShadow: '0 32px 70px rgba(90,72,48,.16)', transform: `rotate(${p.rot}deg)`, transition: 'transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s', cursor: 'zoom-in' }}>
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '3/2' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.src} alt="Together" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Video slot */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 38 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                    <span style={{ fontSize: 25, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>short video</span>
                    <span style={{ flex: 1, height: 2, background: 'rgba(122,95,53,.25)' }} />
                  </div>
                  {WEDDING_DATA.youtubeVideoId ? (
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', border: '1px solid rgba(122,95,53,.24)' }}>
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${WEDDING_DATA.youtubeVideoId}`}
                        title="Wedding video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                      />
                    </div>
                  ) : (
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: 'repeating-linear-gradient(135deg,#E8DEC8 0 14px,#F2EADA 14px 28px)', border: '1px solid rgba(122,95,53,.24)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
                      <div style={{ width: 144, height: 144, border: '1px solid rgba(122,95,53,.45)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A5F35', fontSize: 44 }}>▶</div>
                      <div style={{ fontSize: 25, letterSpacing: '.26em', textTransform: 'uppercase', color: '#8A7248', textAlign: 'center', lineHeight: 1.8 }}>~15s video slot<br />coming soon</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
                  <div style={{ width: 194, height: 2, background: 'rgba(122,95,53,.35)' }} />
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 78, color: '#7A5F35' }}>{WEDDING_DATA.hashtag}</div>
                  <div style={{ fontSize: 25, letterSpacing: '.28em', textTransform: 'uppercase', color: 'rgba(122,95,53,.55)' }}>December 19, 2026 · Surabaya</div>
                </div>

              </div>
            </div>

            {/* Footer */}
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 38, padding: '39px 55px', borderTop: '1px solid rgba(122,95,53,.18)', background: 'linear-gradient(#FBF6EA,#FFFDF7)' }}>
              <span ref={bind('scrapCounter')} style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 47, color: '#8A6B3A' }}>scroll to continue</span>
              <button
                onClick={() => c().onScrapClose()}
                style={{ flex: 'none', padding: '36px 72px', border: '1px solid rgba(122,95,53,.4)', background: 'transparent', color: '#7A5F35', fontFamily: "'Jost',sans-serif", fontSize: 31, letterSpacing: '.22em', textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>

        {/* Lightbox (photo viewer) */}
        <div
          ref={bind('lb')}
          onClick={() => c().onLbClose()}
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,15,10,.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, boxSizing: 'border-box', opacity: 0, pointerEvents: 'none', cursor: 'pointer', transition: 'opacity .35s ease' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={bind('lbImg') as unknown as React.Ref<HTMLImageElement>} src="/photos/photo-01.webp" alt="Gallery photo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', boxShadow: '0 40px 90px rgba(0,0,0,.6)' }} />
          <span style={{ position: 'absolute', bottom: 120, fontSize: 22, letterSpacing: '.3em', textTransform: 'uppercase', color: 'rgba(240,228,200,.7)' }}>touch to close</span>
        </div>

        {/* HUD */}
        <div
          ref={bind('hudRow')}
          style={{ position: 'absolute', left: 60, right: 60, bottom: 52, display: 'flex', alignItems: 'center', gap: 30, pointerEvents: 'none', opacity: 1, transition: 'opacity .25s ease' }}
        >
          <span ref={bind('hudNo')} style={{ fontSize: 24, letterSpacing: '.3em', color: 'rgba(90,72,48,.7)' }}>
            01 / 14
          </span>
          <div
            ref={bind('hudTrack')}
            onClick={(e) => c().onSeek(e.clientX)}
            title="Drag to pick a frame"
            style={{ flex: 1, height: 44, display: 'flex', alignItems: 'center', pointerEvents: 'auto', cursor: 'pointer' }}
          >
            <div ref={bind('hudTrackBg')} style={{ width: '100%', height: 2, background: 'rgba(122,95,53,.2)' }}>
              <div ref={bind('hudBar')} style={{ width: 0, height: '100%', background: '#B8935A' }} />
            </div>
          </div>
          <span ref={bind('hudFps')} style={{ display: 'none', fontSize: 24, letterSpacing: '.16em', color: 'rgba(90,72,48,.55)' }}>
            — fps
          </span>
          <span ref={bind('hudLab')} style={{ fontSize: 24, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(90,72,48,.7)' }}>
            Sealed
          </span>
        </div>

        <button
          ref={bind('pp')}
          onClick={() => c().onToggle()}
          style={{
            position: 'absolute',
            left: 60,
            bottom: 110,
            width: 96,
            height: 96,
            borderRadius: '50%',
            border: '1px solid rgba(122,95,53,.4)',
            background: 'rgba(253,250,243,.92)',
            color: '#7A5F35',
            fontFamily: "'Jost',sans-serif",
            fontSize: 32,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
            transition: 'opacity .25s ease',
          }}
        >
          ▶
        </button>

        <button
          ref={bind('resume')}
          onClick={() => c().onResume()}
          style={{
            position: 'absolute',
            ...(land ? { left: 196 } : { right: 60 }),
            bottom: 110,
            whiteSpace: 'nowrap',
            padding: '22px 34px',
            border: '1px solid rgba(122,95,53,.45)',
            background: 'rgba(253,250,243,.9)',
            color: '#7A5F35',
            fontFamily: "'Jost',sans-serif",
            fontSize: 24,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          resume autoplay
        </button>

        <button
          ref={bind('restart')}
          onClick={() => c().onRestart()}
          style={{
            position: 'absolute',
            ...(land ? { left: 196, transform: 'none' } : { left: '50%', transform: 'translateX(-50%)' }),
            bottom: 110,
            whiteSpace: 'nowrap',
            padding: '22px 34px',
            border: '1px solid rgba(122,95,53,.45)',
            background: 'rgba(253,250,243,.9)',
            color: '#7A5F35',
            fontFamily: "'Jost',sans-serif",
            fontSize: 24,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          start over
        </button>

        {/* Background music — enters after the seal opens, mutable via the corner icon (concept doc: "Dandelion — Ruth B." fades in after open, fades out at Closing). Sits under the gate like the play/pause button, so it's only visible once the gate has opened. */}
        <audio ref={bind('audio')} src={WEDDING_DATA.backgroundMusicUrl} loop preload="auto" style={{ display: 'none' }} />

        <button
          ref={bind('musicBtn')}
          onClick={() => c().onMusicToggle()}
          aria-label="Toggle background music"
          style={{
            position: 'absolute',
            right: 60,
            top: 60,
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: '1px solid rgba(122,95,53,.4)',
            background: 'rgba(253,250,243,.92)',
            color: '#7A5F35',
            fontFamily: "'Jost',sans-serif",
            fontSize: 24,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
            transition: 'opacity .25s ease',
          }}
        >
          <span style={{ position: 'relative', display: 'inline-block' }}>
            {'\u266A'}
            <span
              ref={bind('musicSlash')}
              style={{
                position: 'absolute',
                left: -11,
                top: '50%',
                width: 30,
                height: 1,
                background: '#7A5F35',
                transform: 'rotate(-45deg)',
                opacity: 0,
              }}
            />
          </span>
        </button>

        {/* Gate (frame 01) */}
        <div
          ref={bind('gate')}
          onClick={() => c().open()}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 50% 42%,#FDFAF3,#EDE3CE)',
            display: 'flex',
            // Landscape: title · seal · guest block side by side (desktop prototype).
            ...(land ? { flexDirection: 'row', gap: 56, padding: '0 60px', boxSizing: 'border-box' } : { flexDirection: 'column', gap: 70 }),
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            willChange: 'transform,opacity',
          }}
        >
          <div ref={bind('foldL')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50.2%', background: 'linear-gradient(90deg,#FBF6EC,#F1E7D3)', borderRight: '1px solid rgba(122,95,53,.16)', transformOrigin: 'left center', willChange: 'transform' }} />
          <div ref={bind('foldR')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50.2%', background: 'linear-gradient(270deg,#FBF6EC,#F1E7D3)', borderLeft: '1px solid rgba(122,95,53,.16)', transformOrigin: 'right center', willChange: 'transform' }} />

          <div style={{ position: 'relative', ...(land ? { flex: '1 1 0', minWidth: 0 } : {}), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <div style={{ fontSize: 23, letterSpacing: '.42em', textTransform: 'uppercase', color: '#A08B62', whiteSpace: 'nowrap' }}>The Wedding Of</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 104, lineHeight: 1, color: '#7A5F35' }}>REunited</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 40, color: '#8A6B3A' }}>Finally, Here</div>
          </div>

          <div
            ref={bind('sealDisc')}
            style={{
              position: 'relative',
              flex: '0 0 auto',
              width: 330,
              height: 330,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 36% 30%,#D9BA80,#B8935A 56%,#7A5F35)',
              boxShadow: '0 30px 70px rgba(122,95,53,.45),inset 0 -8px 20px rgba(122,95,53,.6),inset 0 8px 20px rgba(255,245,225,.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              willChange: 'transform',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/seal-RE-gold.svg" alt="R&E monogram seal" style={{ width: '82%', display: 'block', filter: 'brightness(.34) saturate(.3) drop-shadow(0 2px 0 rgba(255,245,225,.4))' }} />
          </div>

          <div style={{ position: 'relative', ...(land ? { flex: '1 1 0', minWidth: 0 } : {}), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 44, color: '#5A4830' }}>
              {WEDDING_DATA.couple.groom} &amp; {WEDDING_DATA.couple.bride}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginTop: 26, padding: '34px 56px', borderTop: '1px solid rgba(122,95,53,.22)', borderBottom: '1px solid rgba(122,95,53,.22)' }}>
              <div style={{ fontSize: 21, letterSpacing: '.32em', textTransform: 'uppercase', color: '#A08B62' }}>This invitation is presented to</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 66, lineHeight: 1.15, color: '#7A5F35' }}>{guestName}</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontStyle: 'italic', fontSize: 32, color: '#8A6B3A', textAlign: 'center' }}>It would be an honour to have you with us.</div>
              <div style={{ maxWidth: 720, fontSize: 25, lineHeight: 1.6, letterSpacing: '.04em', color: '#7A5F35', textAlign: 'center' }}>Should there be any error in the spelling of your name or title, we sincerely apologise.</div>
            </div>
            <div style={{ marginTop: 12, fontSize: 26, letterSpacing: '.4em', textTransform: 'uppercase', color: '#8A7248' }}>touch to open</div>
          </div>

          <div style={{ position: 'absolute', bottom: land ? 44 : 70, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 22, letterSpacing: '.26em', textTransform: 'uppercase', color: 'rgba(122,95,53,.45)' }}>WebGL · frames 01–14 · 90-second cut</div>
            <div style={{ fontSize: 20, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(122,95,53,.35)' }}>space = pause · ← → = scrub · R = restart</div>
          </div>
        </div>
      </div>
    </div>
  );
}
