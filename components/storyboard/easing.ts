// Small math/easing helpers ported 1:1 from the prototype (Prototipe 01-14
// WebGL 90s EN.dc.html) — deliberately not GSAP, per the project spec.

export const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const sg = (t: number, a: number, b: number) => cl((t - a) / (b - a), 0, 1);
export const ez = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const eo = (x: number) => 1 - Math.pow(1 - x, 3);
export const lp = (a: number, b: number, x: number) => a + (b - a) * x;

// Interpolates between two "#RRGGBB" hex colors, returning a "rgb(r,g,b)"
// CSS string — used to animate a plain CSS background color from paint()
// (2026-09-12, frame 04's crack background: a WebGL-only color change on
// the `rift` mesh turned out to be too subtle to notice on a real device,
// so the visible color shift moved to a DOM overlay driven by this).
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255,
    ag = (pa >> 8) & 255,
    ab = pa & 255;
  const br = (pb >> 16) & 255,
    bg = (pb >> 8) & 255,
    bb = pb & 255;
  const r = Math.round(lp(ar, br, t)),
    g = Math.round(lp(ag, bg, t)),
    bl = Math.round(lp(ab, bb, t));
  return `rgb(${r}, ${g}, ${bl})`;
}

type TextLine = {
  t: string;
  f: string; // CSS font shorthand
  c: string; // fill color
  lh: number; // line-height advance in px (0 = no advance after this line)
  sp?: number; // letter-spacing in px (per-char draw)
};

type TextTexOpt = {
  h?: number;
  bg?: string;
  border?: string;
  align?: 'left' | 'center' | 'right';
  pad?: number;
  top?: number;
};

/**
 * Renders text to a 2D canvas and wraps it in a THREE.CanvasTexture — used
 * for every label/card drawn onto a 3D plane in the scene (CIKARANG /
 * SURABAYA labels, "3 years", the couple name cards).
 */
export function textTex(T: typeof import('three'), lines: TextLine[], opt: TextTexOpt) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = opt.h || 512;
  const x = c.getContext('2d')!;
  if (opt.bg) {
    x.fillStyle = opt.bg;
    x.fillRect(0, 0, c.width, c.height);
  }
  if (opt.border) {
    x.strokeStyle = opt.border;
    x.lineWidth = 4;
    x.strokeRect(2, 2, c.width - 4, c.height - 4);
  }
  x.textAlign = opt.align || 'center';
  x.textBaseline = 'middle';
  let y = opt.top || c.height / 2;
  lines.forEach((l) => {
    x.font = l.f;
    x.fillStyle = l.c;
    if (l.sp) {
      const chars = l.t.split('');
      const wTot = chars.reduce((a, ch) => a + x.measureText(ch).width + l.sp!, -l.sp!);
      let cx = opt.align === 'left' ? opt.pad || 60 : c.width / 2 - wTot / 2;
      x.textAlign = 'left';
      chars.forEach((ch) => {
        x.fillText(ch, cx, y);
        cx += x.measureText(ch).width + l.sp!;
      });
      x.textAlign = opt.align || 'center';
    } else {
      x.fillText(l.t, opt.align === 'left' ? opt.pad || 60 : c.width / 2, y);
    }
    y += l.lh;
  });
  const tex = new T.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
