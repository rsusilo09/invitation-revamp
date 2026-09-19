/**
 * Single source of truth for every event-specific detail used across the
 * storyboard, scrapbook, RSVP flow, and admin dashboard. Components should
 * always import from here — never hardcode event details inline.
 */

export const WEDDING_DATA = {
  couple: {
    groom: 'Reinaldo',
    bride: 'Eunike Adabella',
    // From project notes — adjust/remove if not meant to be shown publicly.
    groomParents: 'Bpk. Ricky',
    brideParents: 'Alm. Bpk. Sugianto',
  },

  // Sat, 19 Dec 2026, 14:00 WIB
  date: '2026-12-19T14:00:00+07:00',

  venue: {
    name: 'GKI Residen Sudirman',
    address: 'Jl. Residen Sudirman No.14-16, Pacar Keling, Kec. Tambaksari, Surabaya, Jawa Timur 60131', // TODO: fill in full street address
    mapsUrl: 'https://maps.app.goo.gl/9Cvbp1vG14PNP2hq9?g_st=ac', // TODO: Google Maps share link
  },

  dressCode: {
    colors: ['White', 'Navy', 'Maroon'],
  },

  bankAccounts: [
    { bank: '', accountNumber: '', accountName: '' },
  ],

  giftAddress: {
    recipient: 'Reinaldo',
    phone: '087887602355',
    address: 'Jalan Wimbledon Raya A1/09',
  },

  youtubeVideoId: '', // TODO: unlisted YouTube video ID for the Gallery video slot

  backgroundMusicUrl: '/audio/music.mp3',

  // Extras referenced in the prototype/story notes — not in the original
  // spec's minimal field list, kept here so nothing is hardcoded elsewhere.
  verse: {
    reference: 'Mark 10:8',
    text: '', // TODO: fill in verse text if it should render on-page
  },
  hashtag: '#REunited',
} as const;

export type WeddingData = typeof WEDDING_DATA;
