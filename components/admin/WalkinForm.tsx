'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

type Done = { name: string; guestCount: number; envelopeNumber: number };

export default function WalkinForm() {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/walkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), guestCount: count }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login?next=/admin/checkin/tambah-tamu';
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (!j.ok) {
        setError(j.message ?? 'Gagal menyimpan');
        return;
      }
      setDone({ name: j.name, guestCount: j.guestCount, envelopeNumber: j.envelopeNumber });
    } catch {
      setError('Tidak bisa terhubung ke server. Cek koneksi internet.');
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setDone(null);
    setName('');
    setCount(1);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  if (done) {
    return (
      <div>
        <div className="ad-result ad-result-ok" role="status" style={{ marginTop: 8 }}>
          <div className="ad-eyebrow" style={{ color: 'inherit' }}>✓ Tamu walk-in tercatat &amp; sudah check-in</div>
          <h3>{done.name}</h3>
          <div className="ad-result-meta">
            <div>
              <span>Jumlah</span>
              <b className="big">{done.guestCount}</b>
            </div>
            <div>
              <span>No. amplop</span>
              <b className="big">{done.envelopeNumber}</b>
            </div>
          </div>
          <p style={{ margin: '14px 0 0' }}>Tulis nomor amplop di atas pada amplop tamu.</p>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <button className="ad-btn ad-btn-xl" onClick={again}>
            Tambah tamu lain
          </button>
          <Link className="ad-btn ad-btn-ghost ad-btn-xl" href="/admin/checkin">
            Kembali ke scan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="ad-eyebrow">Penerima tamu</div>
      <h1 className="ad-h1">Tamu Walk-in</h1>
      <p className="ad-muted" style={{ marginTop: 4 }}>
        Untuk tamu yang datang tanpa undangan. Tamu langsung tercatat hadir dan mendapat nomor amplop.
      </p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 22, marginTop: 18 }}>
        <div>
          <label className="ad-label" htmlFor="walkin-name" style={{ fontSize: 16 }}>
            Nama tamu
          </label>
          <input
            ref={nameRef}
            id="walkin-name"
            className="ad-input ad-input-xl"
            autoComplete="off"
            autoCapitalize="words"
            required
            placeholder="Contoh: Bpk. Budi & Ibu"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <div className="ad-label" style={{ fontSize: 16 }}>Jumlah orang (maks. 2)</div>
          <div className="ad-stepper">
            <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="Kurangi" disabled={count <= 1}>
              −
            </button>
            <output aria-live="polite">{count}</output>
            <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setCount((c) => Math.min(2, c + 1))} aria-label="Tambah" disabled={count >= 2}>
              +
            </button>
          </div>
        </div>

        <button className="ad-btn ad-btn-xl ad-btn-gold" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Menyimpan…' : 'Simpan & check-in'}
        </button>
        {error && <div className="ad-note ad-note-bad" style={{ marginTop: 0 }}>{error}</div>}
      </form>

      <p className="ad-small ad-muted" style={{ textAlign: 'center', marginTop: 20 }}>
        <Link href="/admin/checkin" style={{ color: 'var(--ad-gold-deep)' }}>← Kembali ke scan QR</Link>
      </p>
    </div>
  );
}
