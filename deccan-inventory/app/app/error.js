'use client';

export default function Error({ error, reset }) {
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 640, margin: '40px auto' }}>
      <h2 style={{ color: '#9c1b1b' }}>Something went wrong.</h2>
      <p style={{ color: '#555' }}>{error?.message || 'An unexpected error occurred.'}</p>
      <div style={{ marginTop: 16 }}>
        <button onClick={() => reset()}
          style={{ padding: '10px 16px', border: 'none', borderRadius: 8, background: '#0f6e6e', color: '#fff', cursor: 'pointer' }}>
          Try again
        </button>
        <button onClick={() => (window.location.href = '/')}
          style={{ padding: '10px 16px', marginLeft: 8, borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
          Back to list
        </button>
      </div>
    </div>
  );
}
