import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/guest-list/import
 * multipart/form-data with a single `file` field — .csv or .xlsx.
 * Expects a `name` column (case-insensitive); an optional `wa_number`
 * column is also read if present. Every row gets a fresh unique_token
 * and short_code generated here (never trust client-supplied values).
 */

function generateShortCode(): string {
  // 6-char, uppercase alphanumeric, unambiguous-ish (no 0/O/1/I confusion
  // could be added later if check-in staff report misreads).
  return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ ok: false, message: 'No file uploaded' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'File kosong atau format tidak dikenali' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const results: { name: string; ok: boolean; error?: string }[] = [];

  for (const row of rows) {
    const nameKey = Object.keys(row).find((k) => k.trim().toLowerCase() === 'name');
    const waKey = Object.keys(row).find((k) => k.trim().toLowerCase().replace(/[^a-z]/g, '') === 'wanumber');
    const name = nameKey ? String(row[nameKey]).trim() : '';

    if (!name) {
      results.push({ name: '(kosong)', ok: false, error: 'Nama kosong, baris dilewati' });
      continue;
    }

    const waNumber = waKey ? String(row[waKey]).trim() || null : null;

    // Retry on short_code collision — the column is UNIQUE, so a duplicate
    // insert fails with 23505 and we just regenerate and try again.
    let inserted = false;
    let lastError: string | undefined;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { error } = await supabase.from('guest_list').insert({
        name,
        unique_token: randomUUID(),
        short_code: generateShortCode(),
        wa_number: waNumber,
        is_walkin: false,
      });
      if (!error) {
        inserted = true;
      } else if (error.code === '23505') {
        lastError = error.message; // collision — loop and retry with new codes
      } else {
        lastError = error.message;
        break; // non-collision error, stop retrying this row
      }
    }

    results.push({ name, ok: inserted, error: inserted ? undefined : lastError });
  }

  const successCount = results.filter((r) => r.ok).length;

  return NextResponse.json({
    ok: true,
    imported: successCount,
    total: rows.length,
    results,
  });
}
