import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAdminApi } from '@/lib/adminAuth';
import { nextEnvelopeNumber, normalizeWaNumber } from '@/lib/adminData';
import { parseInvitedBy } from '@/lib/invitedBy';
import { generateShortCode, generateToken } from '@/lib/guestCodes';

/**
 * POST /api/guest-list/import  (admin only)
 * multipart/form-data with a single `file` field — .csv or .xlsx.
 * Needs a name column (`name` or `nama`, case-insensitive); an optional
 * WhatsApp column (`wa_number`, `wa`, `whatsapp`, `no wa`, `hp`, `phone`…) is
 * read too, and an optional side column (`invited_by`, `pihak`, `undangan dari`…)
 * with values like Reinaldo / Eunike (or groom / bride, pria / wanita). Every row gets a fresh unique_token + short_code (never trust
 * client-supplied values) and the next envelope number below the walk-in
 * range. Names already in the list are skipped, so re-uploading the same
 * sheet after adding a few rows is safe.
 */

const NAME_KEYS = ['name', 'nama', 'namatamu'];
const SIDE_KEYS = ['invitedby', 'pihak', 'undangandari', 'dari', 'tamudari', 'side', 'mempelai'];
const WA_KEYS = ['wanumber', 'wa', 'whatsapp', 'nowa', 'nomorwa', 'nohp', 'hp', 'phone', 'telepon', 'notelp'];
const norm = (k: string) => k.trim().toLowerCase().replace(/[^a-z]/g, '');

export async function POST(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ ok: false, message: 'Tidak ada file yang diunggah' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, unknown>[] = [];
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch {
    return NextResponse.json({ ok: false, message: 'File tidak bisa dibaca' }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'File kosong atau format tidak dikenali' }, { status: 400 });
  }

  const keys = Object.keys(rows[0]);
  const nameKey = keys.find((k) => NAME_KEYS.includes(norm(k)));
  const waKey = keys.find((k) => WA_KEYS.includes(norm(k)));
  const sideKey = keys.find((k) => SIDE_KEYS.includes(norm(k)));
  if (!nameKey) {
    return NextResponse.json(
      { ok: false, message: 'Kolom nama tidak ditemukan — beri judul kolom "name" atau "nama"' },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: existingRows } = await supabase.from('guest_list').select('name').limit(5000);
  const existing = new Set((existingRows ?? []).map((r) => String(r.name).trim().toLowerCase()));

  let envelope = await nextEnvelopeNumber(supabase, false);
  const results: { name: string; ok: boolean; skipped?: boolean; error?: string; envelopeNumber?: number }[] = [];

  for (const row of rows) {
    const name = String(row[nameKey] ?? '').trim();
    if (!name) continue; // blank line — ignore silently

    if (existing.has(name.toLowerCase())) {
      results.push({ name, ok: false, skipped: true, error: 'Sudah ada di daftar' });
      continue;
    }

    const waNumber = waKey ? normalizeWaNumber(row[waKey]) : null;

    let inserted = false;
    let lastError: string | undefined;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { error } = await supabase.from('guest_list').insert({
        name,
        unique_token: generateToken(),
        short_code: generateShortCode(),
        envelope_number: envelope,
        wa_number: waNumber,
        invited_by: sideKey ? parseInvitedBy(row[sideKey]) : null,
        is_walkin: false,
      });
      if (!error) {
        inserted = true;
      } else if (error.code === '23505') {
        // short_code or envelope collision — refresh the envelope and retry
        lastError = error.message;
        envelope = await nextEnvelopeNumber(supabase, false);
      } else {
        lastError = error.message;
        break;
      }
    }

    if (inserted) {
      existing.add(name.toLowerCase());
      results.push({ name, ok: true, envelopeNumber: envelope });
      envelope += 1;
    } else {
      results.push({ name, ok: false, error: lastError });
    }
  }

  return NextResponse.json({
    ok: true,
    imported: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    total: results.length,
    results,
  });
}
