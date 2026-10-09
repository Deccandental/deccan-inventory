'use client';

import { useState } from 'react';

export function stockState(item) {
  if (item.par_level == null || item.par_level === '') return null;
  const par = Number(item.par_level);
  if (par <= 0) return null; // par 0 = not needed / not tracked → never flag
  const qty = Number(item.current_qty ?? 0);
  if (qty <= 0) return 'out';
  if (qty <= par) return 'low';
  return 'ok';
}

export function StatusBadge({ item }) {
  const s = stockState(item);
  if (!s) return null;
  if (s === 'out') return <span className="badge out">OUT</span>;
  if (s === 'low') return <span className="badge reorder">LOW</span>;
  return <span className="badge ok">OK</span>;
}

export function Field({ label, children, full }) {
  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// Real dropdown of existing options + an explicit "New…" choice.
// Reliable on every device (native select), and only creates a new
// value when the user deliberately picks "New…".
export function PickOrNew({ value, options, onChange, noun }) {
  const NEW = '__new__';
  const [custom, setCustom] = useState(value !== '' && value != null && !options.includes(value));
  if (custom) {
    return (
      <div className="pick-new">
        <input autoFocus value={value || ''} placeholder={`New ${noun} name`}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-secondary pick-back"
          onClick={() => { onChange(''); setCustom(false); }}>List</button>
      </div>
    );
  }
  return (
    <select value={options.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === NEW) { onChange(''); setCustom(true); }
        else onChange(e.target.value);
      }}>
      <option value="">— Select —</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={NEW}>➕ New {noun}…</option>
    </select>
  );
}

export function fmtDate(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch (_) { return ''; }
}
