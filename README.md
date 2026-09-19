# Reunited — Wedding Invitation Web App

Next.js (App Router) + TypeScript + Tailwind + Supabase, scaffolded from
`PromptStartCodingUndanganReunited.md`. Design references live in the
sibling `Monogram/`, `Storybook/`, and `Scrapbook/` folders.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase project values
```

Apply `supabase/migrations/0001_init.sql` to your Supabase project (SQL
editor, or `supabase db push` if you use the CLI).

```bash
npm run dev
```

## Status

Scaffolded: project setup, DB migration, `/lib/supabase.ts`,
`/lib/constants.ts` (partially filled in), and the API routes (`rsvp`,
`wishes`, `checkin/validate`, `guest-list/import`).

Not yet built: the storyboard (14-frame Three.js cinematic, gate,
countdown, RSVP UI), the scrapbook overlay, and the admin dashboard UI —
see the READMEs under `components/*` for what each still needs.
