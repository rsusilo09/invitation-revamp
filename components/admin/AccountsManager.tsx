'use client';

import { useCallback, useEffect, useState } from 'react';
import { displayLogin, ROLE_LABEL, type AdminAccount, type AdminRole } from '@/lib/adminRoles';

function fmt(iso: string | null) {
  if (!iso) return 'belum pernah';
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AccountsManager({ role: myRole }: { role: AdminRole }) {
  const isOwner = myRole === 'owner';
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [me, setMe] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('helper');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/accounts', { cache: 'no-store' }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.ok) {
      setError(json?.message ?? 'Gagal memuat akun');
      return;
    }
    setError(null);
    setAccounts(json.accounts);
    setMe(json.me);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function suggestPassword() {
    const words = ['melati', 'mawar', 'anggrek', 'kenanga', 'teratai', 'cempaka'];
    const w = words[Math.floor(Math.random() * words.length)];
    setPassword(`${w}${Math.floor(1000 + Math.random() * 9000)}`);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const res = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password, role, name }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!json?.ok) {
      setNote({ ok: false, text: json?.message ?? 'Gagal membuat akun' });
      return;
    }
    setNote({
      ok: true,
      text: `Akun dibuat. Login: ${login.trim().toLowerCase()} · Password: ${password} — catat & berikan ke ${name || 'helper'}.`,
    });
    setLogin('');
    setName('');
    setPassword('');
    void load();
  }

  async function resetPassword(a: AdminAccount) {
    const pw = window.prompt(`Password baru untuk ${displayLogin(a.email)} (min. 8 karakter):`);
    if (!pw) return;
    const res = await fetch('/api/admin/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, password: pw }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    alert(json?.ok ? 'Password diganti.' : json?.message ?? 'Gagal mengganti password');
  }

  async function remove(a: AdminAccount) {
    if (!window.confirm(`Hapus akun ${displayLogin(a.email)}? Akun ini langsung tidak bisa masuk lagi.`)) return;
    const res = await fetch('/api/admin/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!json?.ok) alert(json?.message ?? 'Gagal menghapus akun');
    void load();
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className="ad-eyebrow">{isOwner ? 'Groom & bride' : 'PIC'}</div>
        <h1 className="ad-h1">Akun</h1>
        <p className="ad-muted" style={{ margin: '4px 0 0' }}>
          <b style={{ fontWeight: 500 }}>Helper</b> hanya bisa membuka Daftar tamu (tanpa ubah data), Scan check-in, dan
          Tamu walk-in. <b style={{ fontWeight: 500 }}>PIC</b> sama seperti helper, ditambah bisa membuat akun helper.{' '}
          <b style={{ fontWeight: 500 }}>Groom &amp; bride</b> bisa semua menu.
          {!isOwner && ' Menghapus akun dan mengganti password hanya bisa dilakukan groom & bride.'}
        </p>
      </div>

      {error && <div className="ad-note ad-note-bad">{error}</div>}

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Login</th>
              <th>Peran</th>
              <th className="ad-hide-sm">Terakhir masuk</th>
              {isOwner && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {accounts === null && !error && (
              <tr>
                <td colSpan={isOwner ? 4 : 3} className="ad-muted" style={{ textAlign: 'center', padding: 24 }}>
                  Memuat…
                </td>
              </tr>
            )}
            {accounts?.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="ad-code" style={{ letterSpacing: 0 }}>{displayLogin(a.email)}</div>
                  {a.name && <div className="ad-small ad-muted">{a.name}</div>}
                </td>
                <td>
                  <span className={`ad-pill ${a.role === 'owner' ? 'ad-pill-gold' : a.role === 'pic' ? 'ad-pill-ok' : 'ad-pill-mute'}`}>
                    {ROLE_LABEL[a.role]}
                  </span>
                  {a.id === me && <span className="ad-small ad-muted"> (kamu)</span>}
                </td>
                <td className="ad-hide-sm ad-small">{fmt(a.lastSignInAt)}</td>
                {isOwner && (
                <td>
                  <div className="ad-row-actions">
                    <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={() => resetPassword(a)}>
                      Ganti password
                    </button>
                    {a.id !== me && (
                      <button className="ad-btn ad-btn-ghost ad-btn-sm" style={{ color: 'var(--ad-bad)' }} onClick={() => remove(a)}>
                        Hapus
                      </button>
                    )}
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="ad-card" onSubmit={create} style={{ display: 'grid', gap: 12 }}>
        <h2 className="ad-h2">Buat akun baru</h2>
        <div className="ad-grid-2" style={{ gap: 12 }}>
          <div>
            <label className="ad-label" htmlFor="acc-login">Username (atau email)</label>
            <input
              id="acc-login"
              className="ad-input"
              required
              autoCapitalize="none"
              spellCheck={false}
              placeholder="meja1"
              value={login}
              onChange={(e) => setLogin(e.target.value.replace(/\s/g, ''))}
            />
          </div>
          <div>
            <label className="ad-label" htmlFor="acc-name">Nama pemakai (opsional)</label>
            <input id="acc-name" className="ad-input" placeholder="Tante Rina" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="ad-label" htmlFor="acc-pass">Password (min. 8 karakter)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="acc-pass"
                className="ad-input"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="ad-btn ad-btn-ghost ad-btn-sm" onClick={suggestPassword}>
                Buatkan
              </button>
            </div>
          </div>
          <div>
            <label className="ad-label" htmlFor="acc-role">Peran</label>
            <select
              id="acc-role"
              className="ad-input"
              value={role}
              disabled={!isOwner}
              onChange={(e) => setRole(e.target.value as AdminRole)}
            >
              <option value="helper">Helper (hari H)</option>
              {isOwner && <option value="pic">PIC (helper + bisa buat akun helper)</option>}
              {isOwner && <option value="owner">Groom &amp; bride (akses penuh)</option>}
            </select>
          </div>
        </div>
        <button className="ad-btn" type="submit" disabled={busy || !login || password.length < 8}>
          {busy ? 'Membuat…' : 'Buat akun'}
        </button>
        {note && <div className={`ad-note ${note.ok ? 'ad-note-ok' : 'ad-note-bad'}`} style={{ marginTop: 0 }}>{note.text}</div>}
        <p className="ad-small ad-muted" style={{ margin: 0 }}>
          Helper cukup login dengan username (mis. <span className="ad-code">meja1</span>) di halaman login admin.
          {isOwner ? 'Setelah acara selesai, hapus akun helper & PIC di atas.' : 'Akun yang kamu buat otomatis berperan Helper.'}
        </p>
      </form>
    </div>
  );
}
