# Scrapbook overlay (frame 11 gallery)

**Ported 2026-09-20** — no longer a separate component. Built directly
inline in `components/storyboard/StoryboardStage.tsx` (the `scrap` ref
block, right after the Lightbox) and driven by
`components/storyboard/SceneController.ts` (`onScrapOpen` / `onScrapClose`
/ `onScrapScroll` / `onScrapCardClick`), matching this
project's established pattern of one big StoryboardStage component with
all overlays as plain-DOM sibling blocks — not a standalone React
component tree, contrary to what this README originally sketched.

Ported from `../../Scrapbook/Galeri Popup Scrapbook Mobile.dc.html` (pure
DOM/CSS in the source prototype too — no WebGL involved, so no
DOM-vs-WebGL judgment call was needed here). Structure: header (title,
"15 photos · 1 video", ✕ close, scroll-progress bar) → scrollable album
body (`scrapScroll`, `data-scroll="1"`, picked up for free by the existing
`scrollable()` wheel/drag guard used elsewhere in this file) → footer
(scroll-progress counter text, "Close" button). Sizes scaled ~2.77x from
the concept doc's 390px-wide preview up to this app's actual 1080-wide
design canvas.

15 photo slots (opening / portrait pair / 4-photo collage / a favorite
frame / 5 instant frames / landscape pair) are filled with this project's
existing sample + couple photos (`photo-01..11.webp` +
`couple-reinaldo.webp` / `couple-eunike.webp`) — all 13 available images
are used, with `photo-04.webp` and `photo-05.webp` reused a second time
(2026-09-20 "15 photos" follow-up: the user asked to expand the album to
15 slots, but only 13 source files exist on disk, so 2 of the instant
frames intentionally repeat a photo already shown elsewhere in the album
as a placeholder) to fill out the 2 extra slots. Final curated scrapbook
photography is still open, per the project's "Not started" list (spec
eventually wants up to 15 curated specifically for this album, separate
from the storyboard's own gallery).

Video slot renders a real `youtube-nocookie.com` embed once
`WEDDING_DATA.youtubeVideoId` (lib/constants.ts) is filled in; until then
it shows the same "▶ / coming soon" placeholder the concept doc's own
mockup uses.

Tapping a photo card opens it fullscreen in the app's existing lightbox
(`onGalleryOpen`/`lb`/`lbImg`) — this replaced an earlier tap-to-lift-in-place
version (2026-09-20 follow-up) once the user clarified "expand" should show
the photo fully, not just scale it slightly where it sits. The lightbox JSX
block was moved to sit after the scrapbook block in `StoryboardStage.tsx`
so it stacks visually above the album (this file has no z-index anywhere —
stacking is by plain DOM order throughout).

While the album is open, a `scrapOpen` flag in `SceneController` fully
isolates wheel/touch-drag/keyboard input from the storyboard timeline
underneath it (2026-09-20 follow-up — scrolling inside the album was
initially also nudging the storyboard at scroll boundaries, the same
scroll-chaining behavior the frame-13 wishes list intentionally relies on,
but wrong for a true modal overlay like this one). Escape still closes the
album; every other playback shortcut is blocked while it's open.

While the album is open, the invitation's own HUD controls (play/pause,
resume-autoplay, start-over, seek bar) are also hidden and disabled via
the same `scrapOpen` flag (2026-09-20 follow-up — they were visually
showing through the album backdrop before this), and restored the moment
the album closes.

**Not yet live-verified in a real browser by Claude** — both the initial
port and the 2026-09-20 control-isolation/fullscreen follow-up ran
`tsc --noEmit -p .` clean, but neither had a live click-through from this
session: the remote shell used for device commands here tears down any
background process (including a `next dev` dev server) the instant each
individual command finishes, so a dev server can't be kept running across
the separate steps a live check needs. The user has been running their own
dev server to test directly and reporting issues back (that's how the
control-isolation and fullscreen-expand fixes above came about) — that
loop is the way to keep verifying this area; see the project's main status
doc for the fuller note.
