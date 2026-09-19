import { WEDDING_DATA } from '@/lib/constants';

// The 90-second cut is one linear timeline from t=0..TOTAL, with each frame
// occupying a range on it. FRAMES lists the breakpoint each frame *ends* at
// (the HUD frame number/label switches once `t` passes it) — ported as-is
// from the prototype.
export const FRAMES = [
  { n: '02', lab: 'Opening verse', b: 7 },
  { n: '03', lab: 'The Couple', b: 16 },
  { n: '04', lab: 'Distance', b: 32 },
  { n: '05', lab: 'Messages', b: 50 },
  { n: '06', lab: 'The Journey', b: 62 },
  { n: '07', lab: 'Reunited', b: 77 },
  { n: '08', lab: 'Details', b: 88.5 },
  { n: '09', lab: 'Venue', b: 97.5 },
  { n: '10', lab: 'Dress Code', b: 106 },
  { n: '11', lab: 'Gallery', b: 119.5 },
  { n: '12', lab: 'Wedding Gift', b: 127 },
  { n: '13', lab: 'RSVP', b: 139 },
  { n: '14', lab: 'Closing', b: 148 },
] as const;

export const TOTAL = 148;
export const TARGET = new Date(WEDDING_DATA.date).getTime();
export const NSLIP = 26;
// Frame 05's DOM message-thread overlay (see StoryboardStage.tsx's
// `MSG_BUBBLES`) — must match that array's length. Bumped 9→16 so the
// thread keeps generating new bubbles across the whole frame instead of
// finishing early and sitting idle.
export const NMSG = 16;
export const RATE = TOTAL / 90;
