'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminData, AdminGuest, AdminWish } from '@/lib/adminData';
import { WEDDING_DATA } from '@/lib/constants';
import { INVITED_BY_LABEL, type InvitedBy } from '@/lib/invitedBy';
import { normalizeWaNumber } from '@/lib/phone';
import type { AdminRole } from '@/lib/adminRoles';

type Tab = 'tamu' | 'blast' | 'ucapan' | 'import';
type Side = 'all' | InvitedBy | 'none';

const SIDES: { v: Side; label: string }[] = [
  { v: 'all', label: 'Semua pihak' },
  { v: 'groom', label: `Pihak ${INVITED_BY_LABEL.groom}` },
  { v: 'bride', label: `Pihak ${INVITED_BY_LABEL.bride}` },
  { v: 'none', label: 'Pihak belum diisi' },
];

function matchSide(g: AdminGuest, side: Side) {
  if (side === 'all') return true;
  if (side === 'none') return !g.invitedBy;
  return g.invitedBy === side;
}
type Filter = 'all' | 'hadir' | 'tidak_hadir' | 'belum' | 'checkin' | 'walkin';

const FILTERS: { v: Filter; label: string }[] = [
  { v: 'all', label: 'Semua tamu' },
  { v: 'hadir', label: 'RSVP hadir' },
  { v: 'tidak_hadir', label: 'RSVP tidak hadir' },
  { v: 'belum', label: 'Belum respon' },
  { v: 'checkin', label: 'Sudah check-in' },
  { v: 'walkin', label: 'Walk-in' },
];

const eventDate = new Date(WEDDING_DATA.date).toLocaleDateString('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function inviteLink(token: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/undangan/${token}`;
}

/** Default WhatsApp message for the blast — editable in the Blast tab.
 *  Placeholders: {nama}, {link}, {tanggal}, {kode}. */
const DEFAULT_TEMPLATE =
  `Halo {nama},\n\n` +
  `Dengan penuh sukacita kami mengundang Anda untuk hadir di hari pernikahan kami, ` +
  `${WEDDING_DATA.couple.groom} & ${WEDDING_DATA.couple.bride}, pada {tanggal}.\n\n` +
  `Undangan digital Anda (mohon konfirmasi kehadiran di dalamnya):\n{link}\n\n` +
  `Terima kasih 🤍\n#REunited`;

const TEMPLATE_KEY = 'reunited-admin-blast-template';

function renderMessage(template: string, g: AdminGuest) {
  return template
    .replace(/\{nama\}/g, g.name)
    .replace(/\{link\}/g, inviteLink(g.token))
    .replace(/\{tanggal\}/g, eventDate)
    .replace(/\{kode\}/g, g.shortCode);
}

type WaMode = 'app' | 'web';
const WA_MODE_KEY = 'reunited-admin-blast-wa-mode';

function waUrl(g: AdminGuest, template: string, mode: WaMode) {
  const phone = normalizeWaNumber(g.waNumber) ?? '';
  const text = encodeURIComponent(renderMessage(template, g));
  return mode === 'web'
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${text}`
    : `https://wa.me/${phone}?text=${text}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminDashboard({
  initial,
  loadError,
  role,
}: {
  initial: AdminData;
  loadError: string | null;
  role: AdminRole;
}) {
  const isOwner = role === 'owner';
  const [data, setData] = useState<AdminData>(initial);
  const [error, setError] = useState<string | null>(loadError);
  const [tab, setTab] = useState<Tab>('tamu');
  const [refreshing, setRefreshing] = useState(false);

  async function reload() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' });
      const json = await res.json();
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!json.ok) throw new Error(json.message);
      setData({ guests: json.guests, wishes: json.wishes });
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat data');
    } finally {
      setRefreshing(false);
    }
  }

  function patchGuest(id: string, partial: Partial<AdminGuest>) {
    setData((d) => ({ ...d, guests: d.guests.map((g) => (g.id === id ? { ...g, ...partial } : g)) }));
  }

  const stats = useMemo(() => {
    const invited = data.guests.filter((g) => !g.isWalkin);
    const hadir = invited.filter((g) => g.rsvpStatus === 'hadir');
    const checked = data.guests.filter((g) => g.checkedIn);
    return {
      invited: invited.length,
      hadir: hadir.length,
      hadirPax: hadir.reduce((s, g) => s + (g.guestCount ?? 0), 0),
      tidak: invited.filter((g) => g.rsvpStatus === 'tidak_hadir').length,
      belum: invited.filter((g) => !g.rsvpStatus).length,
      checked: checked.length,
      checkedPax: checked.reduce((s, g) => s + (g.guestCount ?? 0), 0),
      walkin: data.guests.filter((g) => g.isWalkin).length,
      wishes: data.wishes.length,
      wishesHidden: data.wishes.filter((w) => w.isHidden).length,
    };
  }, [data]);

  return (
    <main className="ad-main">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div className="ad-eyebrow">{eventDate}</div>
          <h1 className="ad-h1">{isOwner ? 'Dashboard' : 'Daftar tamu'}</h1>
        </div>
        <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={reload} disabled={refreshing}>
          {refreshing ? 'Memuat…' : '↻ Muat ulang'}
        </button>
      </div>

      {error && <div className="ad-note ad-note-bad">Gagal memuat data: {error}</div>}

      {isOwner ? (
        <div className="ad-stats">
          <Stat value={stats.invited} label="Tamu diundang" />
          <Stat value={stats.hadir} label={`RSVP hadir · ${stats.hadirPax} orang`} />
          <Stat value={stats.tidak} label="RSVP tidak hadir" />
          <Stat value={stats.belum} label="Belum respon" />
          <Stat value={stats.checked} label={`Sudah check-in · ${stats.checkedPax} orang`} />
          <Stat value={stats.walkin} label="Tamu walk-in" />
        </div>
      ) : (
        <div className="ad-stats">
          <Stat value={stats.hadir} label={`RSVP hadir · ${stats.hadirPax} orang`} />
          <Stat value={stats.checked} label={`Sudah check-in · ${stats.checkedPax} orang`} />
          <Stat value={stats.walkin} label="Tamu walk-in" />
        </div>
      )}

      {!isOwner && <GuestTable guests={data.guests} onPatched={patchGuest} readOnly />}

      {isOwner && (
      <>
      <div className="ad-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tamu'} onClick={() => setTab('tamu')}>
          Daftar tamu ({data.guests.length})
        </button>
        <button role="tab" aria-selected={tab === 'blast'} onClick={() => setTab('blast')}>
          Blast undangan
        </button>
        <button role="tab" aria-selected={tab === 'ucapan'} onClick={() => setTab('ucapan')}>
          Ucapan ({stats.wishes}
          {stats.wishesHidden ? ` · ${stats.wishesHidden} disembunyikan` : ''})
        </button>
        <button role="tab" aria-selected={tab === 'import'} onClick={() => setTab('import')}>
          Import / tambah tamu
        </button>
      </div>

      {tab === 'tamu' && <GuestTable guests={data.guests} onPatched={patchGuest} />}
      {tab === 'blast' && <BlastPanel guests={data.guests} onPatched={patchGuest} />}
      {tab === 'ucapan' && (
        <WishList
          wishes={data.wishes}
          onToggled={(id, isHidden) =>
            setData((d) => ({
              ...d,
              wishes: d.wishes.map((w) => (w.id === id ? { ...w, isHidden } : w)),
            }))
          }
        />
      )}
      {tab === 'import' && <ImportPanel onDone={reload} />}
      </>
      )}
    </main>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="ad-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/* ───────────────────────── Guest table ───────────────────────── */

function GuestTable({
  guests,
  onPatched,
  readOnly = false,
}: {
  guests: AdminGuest[];
  onPatched: (id: string, partial: Partial<AdminGuest>) => void;
  /** Helper view: no pihak editing, no links/export (they only need to look people up). */
  readOnly?: boolean;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState<string | null>(null);

  const dupEnvelopes = useMemo(() => {
    const seen = new Map<number, number>();
    guests.forEach((g) => {
      if (g.envelopeNumber !== null) seen.set(g.envelopeNumber, (seen.get(g.envelopeNumber) ?? 0) + 1);
    });
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [guests]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return guests
      .filter((g) => {
        if (filter === 'hadir' && g.rsvpStatus !== 'hadir') return false;
        if (filter === 'tidak_hadir' && g.rsvpStatus !== 'tidak_hadir') return false;
        if (filter === 'belum' && (g.rsvpStatus || g.isWalkin)) return false;
        if (filter === 'checkin' && !g.checkedIn) return false;
        if (filter === 'walkin' && !g.isWalkin) return false;
        if (!needle) return true;
        return (
          g.name.toLowerCase().includes(needle) ||
          g.shortCode.toLowerCase().includes(needle) ||
          String(g.envelopeNumber ?? '') === needle ||
          (g.waNumber ?? '').includes(needle)
        );
      })
      .sort((a, b) => {
        const ea = a.envelopeNumber ?? Number.MAX_SAFE_INTEGER;
        const eb = b.envelopeNumber ?? Number.MAX_SAFE_INTEGER;
        return ea - eb || a.name.localeCompare(b.name);
      });
  }, [guests, q, filter]);

  async function copyLink(g: AdminGuest) {
    try {
      await navigator.clipboard.writeText(inviteLink(g.token));
      setCopied(g.id);
      setTimeout(() => setCopied((c) => (c === g.id ? null : c)), 1500);
    } catch {
      window.prompt('Salin link ini:', inviteLink(g.token));
    }
  }

  function exportCsv() {
    const header = ['No. amplop', 'Nama', 'Pihak', 'Walk-in', 'RSVP', 'Jumlah', 'Check-in', 'Waktu check-in', 'Kode', 'WhatsApp', 'Undangan dikirim', 'Link undangan'];
    const lines = rows.map((g) =>
      [
        g.envelopeNumber ?? '',
        g.name,
        g.invitedBy ? INVITED_BY_LABEL[g.invitedBy] : '',
        g.isWalkin ? 'ya' : '',
        g.rsvpStatus === 'hadir' ? 'hadir' : g.rsvpStatus === 'tidak_hadir' ? 'tidak hadir' : 'belum',
        g.guestCount ?? '',
        g.checkedIn ? 'ya' : '',
        fmtTime(g.checkinTime),
        g.shortCode,
        g.waNumber ?? '',
        fmtTime(g.invitationSentAt),
        inviteLink(g.token),
      ]
        .map(csvCell)
        .join(',')
    );
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daftar-tamu-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section>
      <div className="ad-toolbar">
        <input
          className="ad-input"
          placeholder="Cari nama, kode, no. amplop, WA…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="ad-input ad-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => (
            <option key={f.v} value={f.v}>
              {f.label}
            </option>
          ))}
        </select>
        {!readOnly && (
          <button className="ad-btn ad-btn-ghost" onClick={exportCsv} disabled={rows.length === 0}>
            Ekspor CSV
          </button>
        )}
      </div>

      {dupEnvelopes.size > 0 && (
        <div className="ad-note ad-note-bad" style={{ marginTop: 0, marginBottom: 12 }}>
          Ada nomor amplop ganda: {[...dupEnvelopes].sort((a, b) => a - b).join(', ')}
        </div>
      )}

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Amplop</th>
              <th>Nama</th>
              <th>Pihak</th>
              <th>RSVP</th>
              <th>Check-in</th>
              <th className={readOnly ? undefined : 'ad-hide-sm'}>Kode</th>
              {!readOnly && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="ad-muted" style={{ textAlign: 'center', padding: 28 }}>
                  {guests.length === 0 ? 'Belum ada tamu — import daftar tamu di tab “Import / tambah tamu”.' : 'Tidak ada yang cocok.'}
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="num" style={dupEnvelopes.has(g.envelopeNumber ?? -1) ? { color: 'var(--ad-bad)' } : undefined}>
                  {g.envelopeNumber ?? <span className="ad-muted">—</span>}
                </td>
                <td>
                  <div>{g.name}</div>
                  {g.isWalkin && <span className="ad-pill ad-pill-gold">walk-in</span>}
                </td>
                <td>
                  {readOnly ? (
                    g.invitedBy ? INVITED_BY_LABEL[g.invitedBy] : <span className="ad-muted">—</span>
                  ) : (
                    <SideSelect guest={g} onPatched={onPatched} />
                  )}
                </td>
                <td>
                  {g.rsvpStatus === 'hadir' && <span className="ad-pill ad-pill-ok">Hadir · {g.guestCount ?? '?'}</span>}
                  {g.rsvpStatus === 'tidak_hadir' && <span className="ad-pill ad-pill-bad">Tidak hadir</span>}
                  {!g.rsvpStatus && <span className="ad-pill ad-pill-mute">Belum</span>}
                </td>
                <td>
                  {g.checkedIn ? (
                    <span className="ad-pill ad-pill-ok" title={fmtTime(g.checkinTime)}>
                      ✓ {fmtTime(g.checkinTime)}
                    </span>
                  ) : (
                    <span className="ad-muted">—</span>
                  )}
                </td>
                <td className={readOnly ? 'ad-code' : 'ad-hide-sm ad-code'}>{g.shortCode}</td>
                {!readOnly && (
                <td>
                  <div className="ad-row-actions">
                    <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => copyLink(g)}>
                      {copied === g.id ? 'Tersalin ✓' : 'Salin link'}
                    </button>
                    <a
                      className="ad-btn ad-btn-ghost ad-btn-sm"
                      href={`/undangan/${g.token}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Buka
                    </a>
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ad-small ad-muted" style={{ marginTop: 8 }}>
        Menampilkan {rows.length} dari {guests.length}.{' '}
        {readOnly
          ? 'Tamu lupa membawa QR? Ketik kodenya di halaman Scan Check-in.'
          : 'Nomor amplop diberikan otomatis dan tidak bisa diubah (900 ke atas untuk tamu walk-in). Kirim undangan lewat tab “Blast undangan”.'}
      </p>
    </section>
  );
}

function SideSelect({
  guest,
  onPatched,
}: {
  guest: AdminGuest;
  onPatched: (id: string, partial: Partial<AdminGuest>) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    const invitedBy = (value || null) as InvitedBy | null;
    const before = guest.invitedBy;
    onPatched(guest.id, { invitedBy });
    setBusy(true);
    const res = await fetch('/api/admin/guests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: guest.id, invitedBy }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!json?.ok) {
      onPatched(guest.id, { invitedBy: before });
      alert(json?.message ?? 'Gagal menyimpan');
    }
  }

  return (
    <select
      className="ad-input ad-select"
      style={{ padding: '5px 8px', fontSize: 13, color: guest.invitedBy ? undefined : 'var(--ad-muted)' }}
      value={guest.invitedBy ?? ''}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label={`Pihak yang mengundang ${guest.name}`}
    >
      <option value="">—</option>
      <option value="groom">{INVITED_BY_LABEL.groom}</option>
      <option value="bride">{INVITED_BY_LABEL.bride}</option>
    </select>
  );
}

/* ───────────────────────── Blast undangan ───────────────────────── */

type SentFilter = 'unsent' | 'sent' | 'all';

function BlastPanel({
  guests,
  onPatched,
}: {
  guests: AdminGuest[];
  onPatched: (id: string, partial: Partial<AdminGuest>) => void;
}) {
  const [side, setSide] = useState<Side>('all');
  const [sent, setSent] = useState<SentFilter>('unsent');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [copied, setCopied] = useState<string | null>(null);
  const [waMode, setWaMode] = useState<WaMode>('app');

  // Template + open-with choice are per-browser conveniences; the server doesn't need them.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TEMPLATE_KEY);
      if (saved) setTemplate(saved);
      const mode = window.localStorage.getItem(WA_MODE_KEY);
      if (mode === 'app' || mode === 'web') setWaMode(mode);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function saveWaMode(m: WaMode) {
    setWaMode(m);
    try {
      window.localStorage.setItem(WA_MODE_KEY, m);
    } catch {
      /* storage unavailable */
    }
  }

  function saveTemplate(v: string) {
    setTemplate(v);
    try {
      if (v === DEFAULT_TEMPLATE) window.localStorage.removeItem(TEMPLATE_KEY);
      else window.localStorage.setItem(TEMPLATE_KEY, v);
    } catch {
      /* storage unavailable */
    }
  }

  const invited = useMemo(() => guests.filter((g) => !g.isWalkin && matchSide(g, side)), [guests, side]);

  const rows = useMemo(
    () =>
      invited
        .filter((g) => (sent === 'all' ? true : sent === 'sent' ? !!g.invitationSentAt : !g.invitationSentAt))
        .sort((a, b) => (a.envelopeNumber ?? 1e9) - (b.envelopeNumber ?? 1e9) || a.name.localeCompare(b.name)),
    [invited, sent]
  );

  const withWa = rows.filter((g) => g.waNumber);
  const nextUp = rows.find((g) => g.waNumber && !g.invitationSentAt) ?? null;
  const counts = {
    total: invited.length,
    sent: invited.filter((g) => g.invitationSentAt).length,
    noWa: invited.filter((g) => !g.waNumber).length,
  };

  async function markSent(g: AdminGuest, value: boolean) {
    const before = g.invitationSentAt;
    onPatched(g.id, { invitationSentAt: value ? new Date().toISOString() : null });
    const res = await fetch('/api/admin/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.id, sent: value }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.ok) {
      onPatched(g.id, { invitationSentAt: before });
      alert(json?.message ?? 'Gagal menyimpan status kirim');
    } else if (json.sentAt !== undefined) {
      onPatched(g.id, { invitationSentAt: json.sentAt });
    }
  }

  function send(g: AdminGuest) {
    if (!g.waNumber) return;
    // Open WhatsApp synchronously inside the click so pop-up blockers allow it.
    // WhatsApp Web reuses one named tab so a blast doesn't pile up tabs.
    if (waMode === 'web') window.open(waUrl(g, template, 'web'), 'reunited-wa-web');
    else window.open(waUrl(g, template, 'app'), '_blank', 'noopener');
    void markSent(g, true);
  }

  async function copyLink(g: AdminGuest) {
    try {
      await navigator.clipboard.writeText(renderMessage(template, g));
      setCopied(g.id);
      setTimeout(() => setCopied((c) => (c === g.id ? null : c)), 1500);
    } catch {
      window.prompt('Salin pesan ini:', renderMessage(template, g));
    }
  }

  const preview = rows[0] ?? invited[0] ?? null;

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div className="ad-card">
        <div className="ad-toolbar" style={{ marginBottom: 8 }}>
          <select className="ad-input ad-select" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            {SIDES.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </select>
          <select className="ad-input ad-select" value={sent} onChange={(e) => setSent(e.target.value as SentFilter)}>
            <option value="unsent">Belum dikirim</option>
            <option value="sent">Sudah dikirim</option>
            <option value="all">Semua</option>
          </select>
          <select
            className="ad-input ad-select"
            value={waMode}
            onChange={(e) => saveWaMode(e.target.value as WaMode)}
            aria-label="Buka lewat"
          >
            <option value="app">Buka di aplikasi WhatsApp</option>
            <option value="web">Buka di WhatsApp Web</option>
          </select>
          <span className="ad-small ad-muted">
            {counts.total} tamu · {counts.sent} sudah dikirim · {counts.noWa} tanpa nomor WA
          </span>
        </div>

        {nextUp ? (
          <button className="ad-btn ad-btn-gold ad-btn-xl" style={{ fontSize: 18 }} onClick={() => send(nextUp)}>
            Kirim ke {nextUp.name} →
          </button>
        ) : (
          <div className="ad-note ad-note-ok" style={{ marginTop: 0 }}>
            {withWa.length === 0 && rows.length === 0
              ? 'Tidak ada tamu di filter ini.'
              : 'Semua tamu di filter ini yang punya nomor WA sudah dikirimi undangan.'}
          </div>
        )}
        <p className="ad-small ad-muted" style={{ margin: '10px 0 0' }}>
          Tiap klik membuka WhatsApp dengan pesan yang sudah terisi — tekan kirim di WhatsApp, lalu kembali ke sini
          untuk tamu berikutnya. Tamu otomatis ditandai “terkirim” saat WhatsApp dibuka. Kalau aplikasi WhatsApp di
          laptop terbuka tanpa masuk ke chat, pilih “WhatsApp Web”.
        </p>
      </div>

      <details className="ad-card">
        <summary style={{ cursor: 'pointer' }}>
          <b style={{ fontWeight: 500 }}>Pesan undangan</b>{' '}
          <span className="ad-small ad-muted">{template === DEFAULT_TEMPLATE ? '(bawaan)' : '(sudah diubah)'}</span>
        </summary>
        <p className="ad-small ad-muted">
          Gunakan <code>{'{nama}'}</code>, <code>{'{link}'}</code>, <code>{'{tanggal}'}</code>, <code>{'{kode}'}</code> —
          otomatis diganti untuk tiap tamu. Tersimpan di browser ini.
        </p>
        <textarea
          className="ad-input"
          rows={9}
          value={template}
          onChange={(e) => saveTemplate(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div className="ad-toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => saveTemplate(DEFAULT_TEMPLATE)} disabled={template === DEFAULT_TEMPLATE}>
            Kembalikan ke bawaan
          </button>
        </div>
        {preview && (
          <>
            <div className="ad-label" style={{ marginTop: 12 }}>Contoh untuk {preview.name}:</div>
            <div className="ad-input" style={{ whiteSpace: 'pre-wrap', background: 'var(--ad-bg)' }}>
              {renderMessage(template, preview)}
            </div>
          </>
        )}
      </details>

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Amplop</th>
              <th>Nama</th>
              <th>Pihak</th>
              <th className="ad-hide-sm">WhatsApp</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="ad-muted" style={{ textAlign: 'center', padding: 28 }}>
                  Tidak ada tamu di filter ini.
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.id} style={nextUp?.id === g.id ? { background: 'rgba(176,141,76,.08)' } : undefined}>
                <td className="num">{g.envelopeNumber ?? '—'}</td>
                <td>{g.name}</td>
                <td>{g.invitedBy ? INVITED_BY_LABEL[g.invitedBy] : <span className="ad-muted">—</span>}</td>
                <td className="ad-hide-sm num">{g.waNumber ?? <span className="ad-pill ad-pill-bad">tanpa WA</span>}</td>
                <td>
                  {g.invitationSentAt ? (
                    <span className="ad-pill ad-pill-ok">Terkirim · {fmtTime(g.invitationSentAt)}</span>
                  ) : (
                    <span className="ad-pill ad-pill-mute">Belum</span>
                  )}
                </td>
                <td>
                  <div className="ad-row-actions">
                    {g.waNumber && (
                      <button className="ad-btn ad-btn-sm" onClick={() => send(g)}>
                        {g.invitationSentAt ? 'Kirim ulang' : 'Kirim'}
                      </button>
                    )}
                    {!g.waNumber && (
                      <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => copyLink(g)}>
                        {copied === g.id ? 'Tersalin ✓' : 'Salin pesan'}
                      </button>
                    )}
                    {g.invitationSentAt ? (
                      <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => markSent(g, false)}>
                        Tandai belum
                      </button>
                    ) : (
                      !g.waNumber && (
                        <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => markSent(g, true)}>
                          Tandai terkirim
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────────────────── Wishes moderation ───────────────────────── */

function WishList({
  wishes,
  onToggled,
}: {
  wishes: AdminWish[];
  onToggled: (id: string, isHidden: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showHiddenOnly, setShowHiddenOnly] = useState(false);

  async function toggle(w: AdminWish) {
    setBusy(w.id);
    const res = await fetch('/api/admin/wishes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: w.id, isHidden: !w.isHidden }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(null);
    if (json?.ok) onToggled(w.id, !w.isHidden);
    else alert(json?.message ?? 'Gagal menyimpan');
  }

  const list = showHiddenOnly ? wishes.filter((w) => w.isHidden) : wishes;

  return (
    <section className="ad-card">
      <div className="ad-toolbar" style={{ justifyContent: 'space-between' }}>
        <span className="ad-small ad-muted">
          Ucapan yang disembunyikan tidak tampil di undangan, tapi tetap tersimpan.
        </span>
        <label className="ad-small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showHiddenOnly} onChange={(e) => setShowHiddenOnly(e.target.checked)} />
          Hanya yang disembunyikan
        </label>
      </div>
      {list.length === 0 && <p className="ad-muted">Belum ada ucapan.</p>}
      {list.map((w) => (
        <div key={w.id} className={`ad-wish${w.isHidden ? ' hidden' : ''}`}>
          <div className="ad-wish-body">
            <div>
              <b style={{ fontWeight: 500 }}>{w.guestName}</b>{' '}
              <span className="ad-small ad-muted">· {fmtTime(w.createdAt)}</span>{' '}
              {w.isHidden && <span className="ad-pill ad-pill-bad">disembunyikan</span>}
            </div>
            <p>{w.message}</p>
          </div>
          <button className="ad-btn ad-btn-ghost ad-btn-sm" disabled={busy === w.id} onClick={() => toggle(w)}>
            {w.isHidden ? 'Tampilkan' : 'Sembunyikan'}
          </button>
        </div>
      ))}
    </section>
  );
}

/* ───────────────────────── Import / add ───────────────────────── */

/** Live guard while typing: a leading 08 / +62 becomes 628 / 62 immediately. */
function toIntlPrefix(v: string) {
  const t = v.trimStart();
  if (t.startsWith('+62')) return t.slice(1);
  if (t.startsWith('0')) return '62' + t.slice(1);
  return t;
}

type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  total: number;
  results: { name: string; ok: boolean; skipped?: boolean; error?: string; envelopeNumber?: number }[];
};

function ImportPanel({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [addSide, setAddSide] = useState<InvitedBy | ''>('');
  const [addBusy, setAddBusy] = useState(false);
  const [addNote, setAddNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/guest-list/import', { method: 'POST', body: fd }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res || !json?.ok) {
      setErr(json?.message ?? 'Import gagal');
      return;
    }
    setResult(json);
    if (fileRef.current) fileRef.current.value = '';
    onDone();
  }

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    setAddNote(null);
    const res = await fetch('/api/admin/guests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, waNumber: wa, invitedBy: addSide || null }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setAddBusy(false);
    if (!json?.ok) {
      setAddNote({ ok: false, text: json?.message ?? 'Gagal menambah tamu' });
      return;
    }
    setAddNote({ ok: true, text: `${name} ditambahkan (amplop no. ${json.envelopeNumber}).` });
    setName('');
    setWa('');
    onDone();
  }

  return (
    <div className="ad-grid-2">
      <section className="ad-card">
        <h2 className="ad-h2">Import dari CSV / Excel</h2>
        <p className="ad-small ad-muted">
          Baris pertama berisi judul kolom. Wajib ada kolom <b>nama</b> (atau <b>name</b>); kolom <b>wa</b> /{' '}
          <b>whatsapp</b> / <b>hp</b> dan kolom <b>pihak</b> (isi Reinaldo atau Eunike) opsional. Tiap tamu otomatis mendapat link undangan, kode 6 huruf, dan nomor
          amplop berurutan. Nama yang sudah ada dilewati, jadi aman mengunggah ulang file yang sama.
        </p>
        <div className="ad-toolbar">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="ad-input" />
          <button className="ad-btn" onClick={upload} disabled={busy}>
            {busy ? 'Mengimpor…' : 'Import'}
          </button>
        </div>
        {err && <div className="ad-note ad-note-bad">{err}</div>}
        {result && (
          <div className="ad-note ad-note-ok">
            {result.imported} tamu ditambahkan
            {result.skipped ? `, ${result.skipped} dilewati (sudah ada)` : ''}
            {result.failed ? `, ${result.failed} gagal` : ''}.
            {result.failed > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.results
                  .filter((r) => !r.ok && !r.skipped)
                  .map((r, i) => (
                    <li key={i}>
                      {r.name}: {r.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="ad-card">
        <h2 className="ad-h2">Tambah satu tamu</h2>
        <form onSubmit={addOne} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div>
            <label className="ad-label" htmlFor="add-name">Nama (sesuai yang tampil di undangan)</label>
            <input id="add-name" className="ad-input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="ad-label" htmlFor="add-wa">Nomor WhatsApp (opsional)</label>
            <input
              id="add-wa"
              className="ad-input"
              inputMode="tel"
              placeholder="628…"
              value={wa}
              onChange={(e) => setWa(toIntlPrefix(e.target.value))}
            />
          </div>
          <div>
            <label className="ad-label" htmlFor="add-side">Diundang oleh</label>
            <select
              id="add-side"
              className="ad-input"
              value={addSide}
              onChange={(e) => setAddSide(e.target.value as InvitedBy | '')}
            >
              <option value="">— pilih —</option>
              <option value="groom">{INVITED_BY_LABEL.groom}</option>
              <option value="bride">{INVITED_BY_LABEL.bride}</option>
            </select>
          </div>
          <button className="ad-btn" type="submit" disabled={addBusy || !name.trim()}>
            {addBusy ? 'Menyimpan…' : 'Tambah tamu'}
          </button>
          {addNote && <div className={`ad-note ${addNote.ok ? 'ad-note-ok' : 'ad-note-bad'}`}>{addNote.text}</div>}
        </form>
      </section>
    </div>
  );
}
