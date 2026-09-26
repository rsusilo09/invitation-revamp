'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Login gagal');
        setBusy(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Tidak bisa terhubung ke server');
      setBusy(false);
    }
  }

  return (
    <form className="ad-card" onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
      <div>
        <label className="ad-label" htmlFor="ad-email">Username atau email</label>
        <input
          id="ad-email"
          className="ad-input"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="ad-label" htmlFor="ad-pass">Password</label>
        <input
          id="ad-pass"
          className="ad-input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button className="ad-btn" type="submit" disabled={busy}>
        {busy ? 'Memeriksa…' : 'Masuk'}
      </button>
      {error && <div className="ad-note ad-note-bad" style={{ marginTop: 0 }}>{error}</div>}
    </form>
  );
}
