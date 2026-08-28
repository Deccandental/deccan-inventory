'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) { router.push('/'); router.refresh(); }
    else setError('Incorrect password');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Deccan Dental Inventory</h1>
        <p>Enter the practice password to continue.</p>
        <input type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" autoFocus />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
