'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import type { AdminGuest } from '@/lib/adminData';

type Result =
  | { kind: 'ok'; name: string; count: number | null; envelope: number | null }
  | { kind: 'already'; name: string; count: number | null; envelope: number | null; time: string | null }
  | { kind: 'not_attending'; token: string; name: string; message: string; envelope: number | null }
  | { kind: 'not_found'; message: string }
  | { kind: 'error'; message: string };

const READER_ID = 'ad-qr-reader';

function fmtClock(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export default function CheckinScanner() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const [camState, setCamState] = useState<'off' | 'starting' | 'on' | 'paused'>('off');
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [forceCount, setForceCount] = useState(1);
  const [tally, setTally] = useState<{ guests: number; pax: number } | null>(null);

  const loadTally = useCallback(async () => {
    const res = await fetch('/api/admin/overview', { cache: 'no-store' }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.ok) return;
    const checked = (json.guests as AdminGuest[]).filter((g) => g.checkedIn);
    setTally({ guests: checked.length, pax: checked.reduce((s, g) => s + (g.guestCount ?? 0), 0) });
  }, []);

  useEffect(() => {
    // Initial fetch of the running tally; state updates happen after the await.
    void loadTally();
  }, [loadTally]);

  const submit = useCallback(
    async (token: string, opts?: { force?: boolean; guestCount?: number }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await fetch('/api/checkin/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, ...opts }),
        });
        if (res.status === 401) {
          window.location.href = '/admin/login?next=/admin/checkin';
          return;
        }
        const j = await res.json().catch(() => ({}));
        if (j.ok) {
          setResult({ kind: 'ok', name: j.guestName, count: j.guestCount, envelope: j.envelopeNumber });
          buzz(120);
          void loadTally();
        } else if (j.reason === 'already_checked_in') {
          setResult({
            kind: 'already',
            name: j.guestName,
            count: j.guestCount ?? null,
            envelope: j.envelopeNumber ?? null,
            time: j.checkinTime,
          });
          buzz([80, 60, 80]);
        } else if (j.reason === 'not_attending') {
          setForceCount(1);
          setResult({
            kind: 'not_attending',
            token,
            name: j.guestName,
            message: j.message,
            envelope: j.envelopeNumber ?? null,
          });
          buzz([80, 60, 80]);
        } else if (j.reason === 'not_found') {
          setResult({ kind: 'not_found', message: j.message ?? 'Tamu tidak terdaftar' });
          buzz([200, 80, 200]);
        } else {
          setResult({ kind: 'error', message: j.message ?? 'Terjadi kesalahan' });
        }
      } catch {
        setResult({ kind: 'error', message: 'Tidak bisa terhubung ke server. Cek koneksi internet.' });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [loadTally]
  );

  const pauseCam = useCallback(() => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      s.pause(true);
      setCamState('paused');
    } catch {
      /* already paused */
    }
  }, []);

  const onDecoded = useCallback(
    (text: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (text === lastRef.current.text && now - lastRef.current.at < 4000) return;
      lastRef.current = { text, at: now };
      pauseCam();
      void submit(text);
    },
    [pauseCam, submit]
  );

  async function startCam() {
    setCamError(null);
    setCamState('starting');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!scannerRef.current) scannerRef.current = new Html5Qrcode(READER_ID, { verbose: false });
      await scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } },
        onDecoded,
        () => {}
      );
      setCamState('on');
    } catch (e) {
      setCamState('off');
      const msg = String((e as Error)?.message ?? e);
      setCamError(
        /secure|https|getUserMedia|undefined/i.test(msg)
          ? 'Kamera hanya bisa dipakai lewat HTTPS (atau localhost). Gunakan kode manual di bawah.'
          : /permission|notallowed|denied/i.test(msg)
            ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu coba lagi.'
            : `Kamera tidak bisa dibuka: ${msg}`
      );
    }
  }

  async function stopCam() {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.stop();
    } catch {
      /* not running */
    }
    setCamState('off');
  }

  function next() {
    setResult(null);
    setCode('');
    const s = scannerRef.current;
    if (s && camState === 'paused') {
      try {
        s.resume();
        setCamState('on');
      } catch {
        /* ignore */
      }
    }
  }

  // Successful scans clear themselves so the queue keeps moving.
  useEffect(() => {
    if (result?.kind !== 'ok') return;
    const t = setTimeout(next, 4500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Stop the camera when leaving the page.
  useEffect(() => {
    return () => {
      const s = scannerRef.current;
      scannerRef.current = null;
      if (!s) return;
      // stop() throws synchronously if the camera was never started, so guard both ways.
      const clear = () => {
        try {
          s.clear();
        } catch {
          /* ignore */
        }
      };
      try {
        s.stop().then(clear, clear);
      } catch {
        clear();
      }
    };
  }, []);

  function onManual(e: React.FormEvent) {
    e.preventDefault();
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return;
    pauseCam();
    void submit(c);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="ad-eyebrow">Penerima tamu</div>
          <h1 className="ad-h1">Scan Check-in</h1>
        </div>
        {tally && (
          <div style={{ textAlign: 'right' }}>
            <div className="ad-serif" style={{ fontSize: 28, lineHeight: 1 }}>{tally.guests}</div>
            <div className="ad-small ad-muted">check-in · {tally.pax} org</div>
          </div>
        )}
      </div>

      <div className="ad-scan-box">
        <div id={READER_ID} style={{ width: '100%', height: '100%' }} />
        {camState !== 'on' && (
          <div className="ad-scan-idle" style={camState === 'paused' ? { background: 'rgba(0,0,0,.55)' } : undefined}>
            {camState === 'off' && (
              <>
                <div style={{ fontSize: 15, opacity: 0.85 }}>Arahkan kamera ke QR code di undangan tamu</div>
                <button className="ad-btn ad-btn-gold" style={{ padding: '14px 26px', fontSize: 17 }} onClick={startCam}>
                  Nyalakan kamera
                </button>
              </>
            )}
            {camState === 'starting' && <div>Membuka kamera…</div>}
            {camState === 'paused' && busy && <div>Memeriksa…</div>}
          </div>
        )}
      </div>
      {camError && <div className="ad-note ad-note-bad">{camError}</div>}
      {camState === 'on' && (
        <div style={{ textAlign: 'right', marginTop: 6 }}>
          <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={stopCam}>
            Matikan kamera
          </button>
        </div>
      )}

      {result && <ResultCard result={result} busy={busy} forceCount={forceCount} setForceCount={setForceCount}
        onForce={() => result.kind === 'not_attending' && submit(result.token, { force: true, guestCount: forceCount })}
        onNext={next} />}

      <form onSubmit={onManual} className="ad-card" style={{ marginTop: 16 }}>
        <label className="ad-label" htmlFor="ad-code">
          QR tidak terbaca? Ketik kode 6 angka di bawah QR tamu
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="ad-code"
            className="ad-input ad-input-xl ad-code"
            style={{ letterSpacing: '.3em', textAlign: 'center' }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="go"
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button className="ad-btn" type="submit" disabled={busy || code.length !== 6} style={{ borderRadius: 14 }}>
            Cek
          </button>
        </div>
      </form>

      <p className="ad-small ad-muted" style={{ textAlign: 'center', marginTop: 16 }}>
        Tamu tidak punya undangan?{' '}
        <Link href="/admin/checkin/tambah-tamu" style={{ color: 'var(--ad-gold-deep)' }}>
          Tambah tamu walk-in →
        </Link>
      </p>
    </div>
  );
}

function ResultCard({
  result,
  busy,
  forceCount,
  setForceCount,
  onForce,
  onNext,
}: {
  result: Result;
  busy: boolean;
  forceCount: number;
  setForceCount: (n: number) => void;
  onForce: () => void;
  onNext: () => void;
}) {
  if (result.kind === 'ok' || result.kind === 'already') {
    const ok = result.kind === 'ok';
    return (
      <div className={`ad-result ${ok ? 'ad-result-ok' : 'ad-result-warn'}`} role="status">
        <div className="ad-eyebrow" style={{ color: 'inherit' }}>
          {ok ? '✓ Berhasil check-in' : `Sudah check-in${result.kind === 'already' && result.time ? ` pukul ${fmtClock(result.time)}` : ''}`}
        </div>
        <h3>{result.name}</h3>
        <div className="ad-result-meta">
          <div>
            <span>Jumlah</span>
            <b className="big">{result.count ?? '–'}</b>
          </div>
          <div>
            <span>No. amplop</span>
            <b className="big">{result.envelope ?? '–'}</b>
          </div>
        </div>
        <button className="ad-btn" style={{ marginTop: 16 }} onClick={onNext}>
          Scan berikutnya
        </button>
      </div>
    );
  }

  if (result.kind === 'not_attending') {
    return (
      <div className="ad-result ad-result-warn" role="alert">
        <div className="ad-eyebrow" style={{ color: 'inherit' }}>{result.message}</div>
        <h3>{result.name}</h3>
        <p style={{ margin: '6px 0 14px' }}>Tamu terdaftar tapi tidak konfirmasi hadir. Tetap check-in?</p>
        <div className="ad-stepper" style={{ maxWidth: 320, margin: '0 auto' }}>
          <button className="ad-btn ad-btn-ghost" onClick={() => setForceCount(Math.max(1, forceCount - 1))} aria-label="Kurangi">−</button>
          <output aria-label="Jumlah orang">{forceCount}</output>
          <button className="ad-btn ad-btn-ghost" onClick={() => setForceCount(Math.min(10, forceCount + 1))} aria-label="Tambah">+</button>
        </div>
        <div className="ad-small" style={{ marginTop: 4 }}>orang yang datang</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <button className="ad-btn" onClick={onForce} disabled={busy}>
            {busy ? 'Menyimpan…' : 'Ya, check-in'}
          </button>
          <button className="ad-btn ad-btn-ghost" onClick={onNext}>
            Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-result ad-result-bad" role="alert">
      <h3>{result.kind === 'not_found' ? 'Tidak terdaftar' : 'Gagal'}</h3>
      <p style={{ margin: '4px 0 14px' }}>{result.message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {result.kind === 'not_found' && (
          <Link className="ad-btn" href="/admin/checkin/tambah-tamu">
            Tambah sebagai walk-in
          </Link>
        )}
        <button className="ad-btn ad-btn-ghost" onClick={onNext}>
          Coba lagi
        </button>
      </div>
    </div>
  );
}
