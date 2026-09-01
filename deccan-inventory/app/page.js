'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const EMPTY = {
  item_id: '', name: '', category: '', sku: '', manufacturer: '', supplier: '',
  storage_location: '', current_qty: '', par_level: '', reorder_qty: '',
  expiration_date: '', order_link: '', unit_price: '', last_ordered: '', notes: '', image_url: '',
};

const CAT_COLORS = [
  ['#ffe8dd', '#b3441a'], ['#e4edff', '#2c4a8f'], ['#e6f6ea', '#1c6b2c'],
  ['#f3e8ff', '#6b2fae'], ['#fff4d6', '#8a6100'], ['#e2f5f5', '#0a5252'],
  ['#ffe4ee', '#9c1b4a'], ['#eceff1', '#455a64'], ['#e8f0d8', '#4a6b12'],
  ['#fde6e6', '#9c1b1b'], ['#e0f0ff', '#12608a'], ['#efe7de', '#6b4a2f'],
];
function catStyle(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = CAT_COLORS[h % CAT_COLORS.length];
  return { background: bg, color: fg };
}

function stockState(item) {
  if (item.par_level == null || item.par_level === '') return null;
  const qty = Number(item.current_qty ?? 0);
  const par = Number(item.par_level);
  if (qty <= 0) return 'out';
  if (qty <= par) return 'low';
  return 'ok';
}

function StatusBadge({ item }) {
  const s = stockState(item);
  if (!s) return null;
  if (s === 'out') return <span className="badge out">OUT</span>;
  if (s === 'low') return <span className="badge reorder">LOW</span>;
  return <span className="badge ok">OK</span>;
}

function Field({ label, children, full }) {
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
function PickOrNew({ value, options, onChange, noun }) {
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

async function safeStop(scanner) {
  if (!scanner) return;
  try {
    const state = typeof scanner.getState === 'function' ? scanner.getState() : null;
    if (state === 2 || state === 3) await scanner.stop();
  } catch (_) {}
  try { scanner.clear(); } catch (_) {}
}

// Resize + re-encode an image in the browser before upload.
// Falls back to the original file if anything goes wrong (e.g. HEIC that
// the canvas can't decode). Keeps stored photos small (~150-300 KB).
async function compressImage(file, maxDim = 1200, quality = 0.82) {
  try {
    if (!file.type || !file.type.startsWith('image/')) return file;
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });
    let w = img.width, h = img.height;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch (_) {
    return file;
  }
}

// mode: 'open' -> stop + onResult(code); 'add' -> keep running, call onAdd(code) per scan
function QRScanner({ mode, title, onResult, onAdd, onClose }) {
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const [flash, setFlash] = useState('');
  const scannerRef = useRef(null);
  const doneRef = useRef(false);
  const lastRef = useRef({ code: '', t: 0 });

  const handleCode = useCallback(async (raw) => {
    const code = (raw || '').trim();
    if (!code) return;
    if (mode === 'add') {
      const now = Date.now();
      if (lastRef.current.code === code && now - lastRef.current.t < 2500) return; // debounce repeats
      lastRef.current = { code, t: now };
      const label = await onAdd(code);
      setFlash(label);
      setTimeout(() => setFlash(''), 1800);
    } else {
      if (doneRef.current) return;
      doneRef.current = true;
      safeStop(scannerRef.current).finally(() => onResult(code));
    }
  }, [mode, onAdd, onResult]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new m.Html5Qrcode('qr-reader', { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => { if (!cancelled) handleCode(text); },
          () => {}
        );
        if (cancelled) safeStop(scanner);
      } catch (e) {
        if (!cancelled) setErr(e?.message || String(e) || 'Camera could not start.');
      }
    })();
    return () => { cancelled = true; safeStop(scannerRef.current); };
  }, [handleCode]);

  function submitManual() {
    const v = manual.trim();
    if (!v) return;
    if (mode === 'add') { handleCode(v); setManual(''); }
    else { safeStop(scannerRef.current).finally(() => onResult(v)); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title || (mode === 'add' ? 'Scan to add' : 'Scan a QR label')}</h2>
        <div id="qr-reader" />
        {flash && <p className="flash">{flash}</p>}
        {err
          ? <p className="error">Camera couldn&apos;t start on this device: {err}. Use the box below instead.</p>
          : <p className="hint">{mode === 'add'
              ? 'Scan each label to add it — keep going, then tap Done.'
              : 'Point the camera at a label\u2019s QR code — or type the ID below.'}</p>}
        <Field label="Or enter the Item ID" full>
          <input value={manual} placeholder="e.g. SUP-0007"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }} />
        </Field>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn-secondary" onClick={onClose}>{mode === 'add' ? 'Done' : 'Cancel'}</button>
          <button className="btn-primary" disabled={!manual.trim()} onClick={submitManual}>
            {mode === 'add' ? 'Add' : 'Go to item'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [orderList, setOrderList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('items'); // 'items' | 'order'
  const [search, setSearch] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fManufacturer, setFManufacturer] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [fLow, setFLow] = useState(false);
  const [sortBy, setSortBy] = useState('category');
  const [editing, setEditing] = useState(null);
  const [scanning, setScanning] = useState(null); // null | 'open' | 'add'
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sets, setSets] = useState([]);
  const [setRows, setSetRows] = useState([]);
  const [activeSet, setActiveSet] = useState(null);
  const [kitSearch, setKitSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase.from('items').select('*');
    if (error) { console.error(error); alert('Could not load items: ' + error.message); }
    setItems(data || []);
  }, []);

  const fetchOrderList = useCallback(async () => {
    const { data, error } = await supabase.from('order_list').select('*');
    if (error) { console.error(error); return; }
    setOrderList(data || []);
  }, []);

  const fetchSets = useCallback(async () => {
    const { data } = await supabase.from('sets').select('*').order('name');
    setSets(data || []);
  }, []);

  const fetchSetRows = useCallback(async () => {
    const { data } = await supabase.from('set_items').select('*');
    setSetRows(data || []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchItems(), fetchOrderList(), fetchSets(), fetchSetRows()]);
      setLoading(false);
    })();
  }, [fetchItems, fetchOrderList, fetchSets, fetchSetRows]);

  const itemByCode = useCallback(
    (code) => items.find((i) => (i.item_id || '').toLowerCase() === (code || '').toLowerCase()),
    [items]
  );
  const onList = useCallback(
    (itemId) => orderList.some((o) => o.item_id === itemId),
    [orderList]
  );

  const uniq = useCallback(
    (key) => Array.from(new Set(items.map((i) => i[key]).filter(Boolean))).sort(),
    [items]
  );
  const categories = useMemo(() => uniq('category'), [uniq]);
  const manufacturers = useMemo(() => uniq('manufacturer'), [uniq]);
  const suppliers = useMemo(() => uniq('supplier'), [uniq]);
  const lowCount = useMemo(
    () => items.filter((i) => !i.archived && ['low', 'out'].includes(stockState(i))).length,
    [items]
  );

  const visible = useMemo(() => {
    let list = items.filter((i) => (showArchived ? i.archived : !i.archived));
    if (fCategory) list = list.filter((i) => i.category === fCategory);
    if (fManufacturer) list = list.filter((i) => i.manufacturer === fManufacturer);
    if (fSupplier) list = list.filter((i) => i.supplier === fSupplier);
    if (fLow) list = list.filter((i) => { const s = stockState(i); return s === 'low' || s === 'out'; });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          (i.name || '').toLowerCase().includes(q) ||
          (i.sku || '').toLowerCase().includes(q) ||
          (i.item_id || '').toLowerCase().includes(q)
      );
    }
    const s = sortBy;
    list = [...list].sort((a, b) => {
      if (s === 'current_qty') return Number(a.current_qty ?? 0) - Number(b.current_qty ?? 0);
      if (s === 'updated_at') return new Date(b.updated_at) - new Date(a.updated_at);
      return String(a[s] || '').localeCompare(String(b[s] || ''));
    });
    return list;
  }, [items, showArchived, fCategory, fManufacturer, fSupplier, fLow, search, sortBy]);

  // order list joined with item details, sorted: unchecked first, then by supplier + name
  const orderRows = useMemo(() => {
    return orderList
      .map((o) => ({ ...o, item: itemByCode(o.item_id) }))
      .sort((a, b) => {
        if (a.ordered !== b.ordered) return a.ordered ? 1 : -1;
        const sa = (a.item?.supplier || '') + (a.item?.name || '');
        const sb = (b.item?.supplier || '') + (b.item?.name || '');
        return sa.localeCompare(sb);
      });
  }, [orderList, itemByCode]);

  const orderCount = orderList.length;

  const grouped = useMemo(() => {
    const g = {};
    visible.forEach((it) => { const c = it.category || 'Uncategorized'; (g[c] ||= []).push(it); });
    Object.values(g).forEach((arr) => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    return Object.entries(g).sort((a, b) => {
      if (a[0] === 'Uncategorized') return 1;
      if (b[0] === 'Uncategorized') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [visible]);

  function nextItemId() {
    let max = 0;
    items.forEach((i) => {
      const m = /^SUP-(\d+)$/.exec(i.item_id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'SUP-' + String(max + 1).padStart(4, '0');
  }

  function openAdd() { setEditing({ ...EMPTY, item_id: nextItemId() }); }
  function openEdit(item) {
    setEditing({ ...EMPTY, ...item, expiration_date: item.expiration_date || '', last_ordered: item.last_ordered || '' });
  }
  function closeModal() { setEditing(null); }

  function handleScan(text) {
    setScanning(null);
    const found = itemByCode((text || '').trim());
    if (found) openEdit(found);
    else alert('No item found for code: ' + text);
  }

  // ---- order list actions ----
  async function orderAddByCode(code) {
    const item = itemByCode(code);
    if (!item) return 'No item: ' + code;
    if (onList(item.item_id)) return 'Already on list: ' + item.item_id;
    const qty = item.reorder_qty ?? 1;
    const { error } = await supabase.from('order_list').insert({ item_id: item.item_id, qty });
    if (error) {
      if (error.code === '23505') return 'Already on list: ' + item.item_id;
      return 'Error: ' + error.message;
    }
    await fetchOrderList();
    return 'Added ' + item.item_id;
  }

  async function addItemToOrder(item) {
    const msg = await orderAddByCode(item.item_id);
    if (msg.startsWith('Error')) alert(msg);
  }

  async function toggleOrderForItem(item) {
    const existing = orderList.find((o) => o.item_id === item.item_id);
    if (existing) await removeFromOrder(existing.id);
    else await addItemToOrder(item);
  }

  async function removeFromOrder(entryId) {
    setOrderList((l) => l.filter((o) => o.id !== entryId));
    await supabase.from('order_list').delete().eq('id', entryId);
  }

  async function toggleOrdered(entry) {
    setOrderList((l) => l.map((o) => (o.id === entry.id ? { ...o, ordered: !o.ordered } : o)));
    const { error } = await supabase.from('order_list').update({ ordered: !entry.ordered }).eq('id', entry.id);
    if (error) fetchOrderList();
  }

  function changeQty(entryId, val) {
    setOrderList((l) => l.map((o) => (o.id === entryId ? { ...o, qty: val } : o)));
  }
  async function persistQty(entryId, val) {
    const qty = Math.max(0, parseInt(val || '0', 10) || 0);
    setOrderList((l) => l.map((o) => (o.id === entryId ? { ...o, qty } : o)));
    await supabase.from('order_list').update({ qty }).eq('id', entryId);
  }

  async function clearChecked() {
    const done = orderList.filter((o) => o.ordered).map((o) => o.id);
    if (done.length === 0) { alert('Nothing checked off yet.'); return; }
    if (!confirm(`Remove ${done.length} checked-off item(s) from the list?`)) return;
    setOrderList((l) => l.filter((o) => !o.ordered));
    await supabase.from('order_list').delete().in('id', done);
  }

  function printList() { window.print(); }

  // ---- item image + save ----
  async function uploadImage(file, itemId) {
    const out = await compressImage(file);
    const ext = out.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${itemId || 'new'}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('item-images').upload(path, out, { upsert: true, contentType: out.type || undefined });
    if (error) { alert('Image upload failed: ' + error.message); return null; }
    const { data } = supabase.storage.from('item-images').getPublicUrl(path);
    return data.publicUrl;
  }
  async function onPickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, editing.item_id);
      if (url) setEditing((prev) => ({ ...prev, image_url: url }));
    } catch (err) { alert('Image upload failed: ' + (err?.message || err)); }
    finally { setUploading(false); }
  }

  function patchItemLocal(id, patch) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  async function saveQty(item, qty) {
    const q = Math.max(0, Number.isFinite(qty) ? qty : 0);
    patchItemLocal(item.id, { current_qty: q });
    const { error } = await supabase.from('items').update({ current_qty: q }).eq('id', item.id);
    if (error) { alert('Could not update qty: ' + error.message); fetchItems(); }
  }
  function bumpQty(item, delta) {
    saveQty(item, Number(item.current_qty ?? 0) + delta);
  }

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const txt = (v) => (v === '' || v == null ? null : v);

  async function saveItem() {
    if (!editing.item_id.trim() || !editing.name.trim()) { alert('Item ID and Name are required.'); return; }
    setSaving(true);
    const payload = {
      item_id: editing.item_id.trim(), name: editing.name.trim(),
      category: txt(editing.category), sku: txt(editing.sku),
      manufacturer: txt(editing.manufacturer), supplier: txt(editing.supplier),
      storage_location: txt(editing.storage_location),
      current_qty: num(editing.current_qty) ?? 0, par_level: num(editing.par_level),
      reorder_qty: num(editing.reorder_qty), expiration_date: txt(editing.expiration_date),
      order_link: txt(editing.order_link), unit_price: num(editing.unit_price),
      last_ordered: txt(editing.last_ordered), notes: txt(editing.notes), image_url: txt(editing.image_url),
    };
    let error;
    if (editing.id) ({ error } = await supabase.from('items').update(payload).eq('id', editing.id));
    else ({ error } = await supabase.from('items').insert(payload));
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    closeModal();
    fetchItems();
  }

  async function archiveItem(item, archived) {
    const { error } = await supabase.from('items').update({ archived }).eq('id', item.id);
    if (error) { alert(error.message); return; }
    closeModal(); fetchItems();
  }
  async function deleteItem(item) {
    if (!confirm(`Permanently delete ${item.item_id} — ${item.name}?\nThis cannot be undone. (Consider Archive instead.)`)) return;
    const { error } = await supabase.from('items').delete().eq('id', item.id);
    if (error) { alert(error.message); return; }
    closeModal(); fetchItems(); fetchOrderList();
  }
  async function logout() { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; }

  const itemSetNames = useMemo(() => {
    const nameById = Object.fromEntries(sets.map((s) => [s.id, s.name]));
    const m = {};
    setRows.forEach((si) => { (m[si.item_id] ||= []).push(nameById[si.set_id]); });
    return m;
  }, [sets, setRows]);
  function countInSet(setId) { return setRows.filter((si) => si.set_id === setId).length; }

  async function createSetPrompt() {
    const name = prompt('Name this set (e.g. "Crown Bur Set")');
    if (!name || !name.trim()) return;
    const { data, error } = await supabase.from('sets').insert({ name: name.trim() }).select().single();
    if (error) { alert(error.message); return; }
    await fetchSets();
    if (data) setActiveSet(data.id);
  }
  async function renameSetPrompt(s) {
    const name = prompt('Rename set', s.name);
    if (!name || !name.trim()) return;
    await supabase.from('sets').update({ name: name.trim() }).eq('id', s.id);
    fetchSets();
  }
  async function deleteSetConfirm(s) {
    if (!confirm(`Delete the set "${s.name}"?\nThe items themselves are NOT deleted — only the grouping.`)) return;
    await supabase.from('sets').delete().eq('id', s.id);
    setActiveSet(null); fetchSets(); fetchSetRows();
  }
  async function addItemToSet(setId, item) {
    const { error } = await supabase.from('set_items').insert({ set_id: setId, item_id: item.item_id });
    if (error && error.code !== '23505') { alert(error.message); return; }
    fetchSetRows();
  }
  async function removeItemFromSet(setId, itemId) {
    setSetRows((l) => l.filter((si) => !(si.set_id === setId && si.item_id === itemId)));
    await supabase.from('set_items').delete().eq('set_id', setId).eq('item_id', itemId);
  }
  async function setAddByCode(code) {
    const item = itemByCode(code);
    if (!item) return 'No item: ' + code;
    if (setRows.some((si) => si.set_id === activeSet && si.item_id === item.item_id)) return 'Already in set: ' + item.item_id;
    const { error } = await supabase.from('set_items').insert({ set_id: activeSet, item_id: item.item_id });
    if (error && error.code !== '23505') return 'Error: ' + error.message;
    await fetchSetRows();
    return 'Added ' + item.item_id;
  }

  function itemRow(item, opts = {}) {
    const st = stockState(item);
    const otherSets = opts.setId ? (itemSetNames[item.item_id] || []).filter((nm) => nm !== opts.setName).length : 0;
    return (
      <div className={'item-row' + (st === 'out' ? ' out' : st === 'low' ? ' low' : '')} key={item.id} onClick={() => openEdit(item)}>
        <div className="row-thumb">
          {item.image_url ? <img src={item.image_url} alt={item.name} /> : <span className="ph">▢</span>}
        </div>
        <div className="row-main">
          <div className="row-name">{item.name}</div>
          <div className="row-sub">
            <span className="idpill">{item.item_id}</span>
            {item.category && <span className="chip" style={catStyle(item.category)}>{item.category}</span>}
            {otherSets > 0 && <span className="chip setchip">in {otherSets} other set{otherSets === 1 ? '' : 's'}</span>}
            {item.supplier && <span className="row-supplier">{item.supplier}</span>}
          </div>
        </div>
        <div className="row-right">
          <div className="qty-stepper" onClick={(e) => e.stopPropagation()}>
            <button className="qty-btn" onClick={() => bumpQty(item, -1)} aria-label="decrease">−</button>
            <input className="qty-input" type="number" min="0" value={item.current_qty ?? 0}
              onChange={(e) => patchItemLocal(item.id, { current_qty: e.target.value })}
              onBlur={(e) => saveQty(item, parseInt(e.target.value || '0', 10))} />
            <button className="qty-btn" onClick={() => bumpQty(item, 1)} aria-label="increase">+</button>
          </div>
          <div className="row-meta-line">
            {item.par_level != null && <span className="par-note">par {item.par_level}</span>}
            <StatusBadge item={item} />
          </div>
        </div>
        <button className={onList(item.item_id) ? 'row-add on' : 'row-add'}
          title={onList(item.item_id) ? 'On order list — tap to remove' : 'Add to order list'}
          onClick={(e) => { e.stopPropagation(); toggleOrderForItem(item); }}>{onList(item.item_id) ? '✓' : '+'}</button>
        {opts.setId && (
          <button className="row-remove" title="Remove from this set"
            onClick={(e) => { e.stopPropagation(); removeItemFromSet(opts.setId, item.item_id); }}>✕</button>
        )}
      </div>
    );
  }

  const today = new Date().toLocaleDateString();

  return (
    <div className="app">
      <header className="appheader">
        <div className="appheader-top">
          <img src="/deccan-logo.png" alt="Deccan Dental" className="logo" />
          <div className="hsearch">
            <select className="hsearch-cat" value={fCategory}
              onChange={(e) => { setFCategory(e.target.value); if (view !== 'items') setView('items'); }}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="hsearch-input" placeholder="Search items, SKU, or ID"
              value={search}
              onChange={(e) => { setSearch(e.target.value); if (e.target.value && view !== 'items') setView('items'); }} />
            <button className="hsearch-btn" aria-label="Search" onClick={() => setView('items')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
            </button>
          </div>
          <div className="top-actions">
            <button className="btn-scan" onClick={() => setScanning(view === 'order' ? 'order' : (view === 'sets' && activeSet) ? 'set' : 'open')}>Scan</button>
            <button className="btn-primary" onClick={openAdd}>+ Add</button>
            <button className="cart-btn" aria-label="Order list" onClick={() => { setView('order'); setActiveSet(null); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 12h11l2-8H6" /></svg>
              {orderCount > 0 && <span className="cart-count">{orderCount}</span>}
            </button>
            <button className="btn-ghost" onClick={() => setShowHelp(true)}>Help</button>
            <button className="btn-ghost" onClick={logout}>Log out</button>
          </div>
        </div>
      </header>

      <div className="navbar">
        <button className={view === 'items' ? 'navtab on' : 'navtab'} onClick={() => setView('items')}>Items</button>
        <button className={view === 'order' ? 'navtab on' : 'navtab'} onClick={() => { setView('order'); setActiveSet(null); }}>
          Order list{orderCount ? ` (${orderCount})` : ''}
        </button>
        <button className={view === 'sets' ? 'navtab on' : 'navtab'} onClick={() => { setView('sets'); setActiveSet(null); }}>
          Sets{sets.length ? ` (${sets.length})` : ''}
        </button>
        <div className="navbar-spacer" />
        {lowCount > 0 && (
          <button className={fLow ? 'navlow on' : 'navlow'} onClick={() => { setView('items'); setFLow((v) => !v); }}>
            ⚠ {lowCount} low / out
          </button>
        )}
      </div>

      {view === 'items' && (
        <>
          <div className="filterbar">
            <select value={fManufacturer} onChange={(e) => setFManufacturer(e.target.value)}>
              <option value="">All manufacturers</option>
              {manufacturers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}>
              <option value="">All suppliers</option>
              {suppliers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="item_id">Sort: Item ID</option>
              <option value="name">Sort: Name</option>
              <option value="category">Group by category</option>
              <option value="manufacturer">Sort: Manufacturer</option>
              <option value="supplier">Sort: Supplier</option>
              <option value="current_qty">Sort: Quantity (low first)</option>
              <option value="updated_at">Sort: Recently updated</option>
            </select>
            <label className="chk">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
            </label>
          </div>

          <div className="count">
            {loading ? 'Loading…' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}
          </div>

          {visible.length > 0 && (
            <div className="list-head">
              <span className="lh-item">Item</span>
              <span className="lh-spacer" />
              <span className="lh-stock">In stock</span>
              <span className="lh-addspace" />
            </div>
          )}

          {sortBy === 'category' ? (
            grouped.map(([cat, its]) => (
              <div className="cat-group" key={cat}>
                <div className="cat-header" style={cat === 'Uncategorized' ? undefined : catStyle(cat)}>
                  {cat} <span className="cat-count">{its.length}</span>
                </div>
                <div className="item-list">{its.map((item) => itemRow(item))}</div>
              </div>
            ))
          ) : (
            <div className="item-list">
              {visible.map((item) => itemRow(item))}
            </div>
          )}
        </>
      )}

      {view === 'order' && (
        <>
          <div className="order-toolbar">
            <div className="count">{orderCount} on the list</div>
            <div className="spacer" />
            <button className="btn-secondary" onClick={clearChecked}>Clear checked</button>
            <button className="btn-primary" onClick={printList}>Print</button>
          </div>

          {orderRows.length === 0 ? (
            <div className="empty">Nothing here yet. Tap <b>Scan to add</b>, or open any item and choose <b>Add to order list</b>.</div>
          ) : (
            <div className="order-rows">
              {orderRows.map((o) => (
                <div className={o.ordered ? 'order-row done' : 'order-row'} key={o.id}>
                  <input className="order-check" type="checkbox" checked={o.ordered}
                    onChange={() => toggleOrdered(o)} onClick={(e) => e.stopPropagation()} />
                  <div className="order-main" onClick={() => o.item && openEdit(o.item)}>
                    <div className="order-name">{o.item ? o.item.name : o.item_id}</div>
                    <div className="order-sub">{o.item_id}{o.item?.supplier ? ' · ' + o.item.supplier : ''}</div>
                  </div>
                  <input className="order-qty" type="number" min="0" value={o.qty ?? ''}
                    onChange={(e) => changeQty(o.id, e.target.value)}
                    onBlur={(e) => persistQty(o.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()} title="Quantity to order" />
                  <button className="order-x" title="Remove" onClick={() => removeFromOrder(o.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'sets' && !activeSet && (
        <>
          <div className="order-toolbar">
            <div className="count">{sets.length} set{sets.length === 1 ? '' : 's'}</div>
            <div className="spacer" />
            <button className="btn-primary" onClick={createSetPrompt}>+ New set</button>
          </div>
          {sets.length === 0 ? (
            <div className="empty">No sets yet. Create one (e.g. <b>Crown Bur Set</b>), then add items by search or scan.</div>
          ) : (
            <div className="set-list">
              {sets.map((s) => (
                <div className="set-row" key={s.id} onClick={() => setActiveSet(s.id)}>
                  <div className="set-name">{s.name}</div>
                  <div className="set-count">{countInSet(s.id)} item{countInSet(s.id) === 1 ? '' : 's'} ›</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === 'sets' && activeSet && (() => {
        const s = sets.find((x) => x.id === activeSet);
        if (!s) return null;
        const memberIds = setRows.filter((si) => si.set_id === activeSet).map((si) => si.item_id);
        const members = memberIds.map((id) => itemByCode(id)).filter(Boolean)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const query = kitSearch.trim().toLowerCase();
        const results = query
          ? items.filter((i) => !i.archived && (
              (i.name || '').toLowerCase().includes(query) ||
              (i.sku || '').toLowerCase().includes(query) ||
              (i.item_id || '').toLowerCase().includes(query))).slice(0, 12)
          : [];
        return (
          <>
            <div className="order-toolbar">
              <button className="btn-secondary" onClick={() => { setActiveSet(null); setKitSearch(''); }}>← Sets</button>
              <div className="set-title">{s.name}</div>
              <div className="spacer" />
              <button className="btn-ghost" onClick={() => renameSetPrompt(s)}>Rename</button>
              <button className="btn-danger" onClick={() => deleteSetConfirm(s)}>Delete set</button>
            </div>

            <div className="controls">
              <input className="search" placeholder="Search items to add…" value={kitSearch}
                onChange={(e) => setKitSearch(e.target.value)} />
              <button className="btn-scan" onClick={() => setScanning('set')}>Scan to add</button>
            </div>

            {query && (
              <div className="add-results">
                {results.length === 0 ? <div className="add-none">No matches.</div> : results.map((it) => {
                  const inSet = memberIds.includes(it.item_id);
                  return (
                    <div className="add-row" key={it.id}>
                      <div className="add-info"><span className="idpill">{it.item_id}</span> {it.name}</div>
                      <button className={inSet ? 'row-add on' : 'row-add'}
                        onClick={() => inSet ? removeItemFromSet(activeSet, it.item_id) : addItemToSet(activeSet, it)}>
                        {inSet ? '✓' : '+'}</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="count">{members.length} item{members.length === 1 ? '' : 's'} in this set</div>
            {members.length === 0 ? (
              <div className="empty">Empty set. Search above or tap <b>Scan to add</b> to put items in <b>{s.name}</b>.</div>
            ) : (
              <div className="item-list">
                {members.map((item) => itemRow(item, { setId: activeSet, setName: s.name }))}
              </div>
            )}
          </>
        );
      })()}

      {editing && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? 'Edit item' : 'Add item'}</h2>
            <div className="form">
              <div className="img-edit">
                {editing.image_url ? <img src={editing.image_url} alt="" /> : <div className="noimg big">No photo</div>}
                <div className="img-edit-actions">
                  <label className="btn-secondary file-btn">
                    {uploading ? 'Uploading…' : (editing.image_url ? 'Change photo' : 'Add photo')}
                    <input type="file" accept="image/*" capture="environment" onChange={onPickImage} hidden />
                  </label>
                  {editing.image_url && (
                    <button type="button" className="btn-ghost"
                      onClick={() => setEditing({ ...editing, image_url: null })}>Remove photo</button>
                  )}
                </div>
              </div>

              <Field label="Item ID *"><input value={editing.item_id} onChange={(e) => setEditing({ ...editing, item_id: e.target.value })} /></Field>
              <Field label="Name *"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Category">
                <PickOrNew key={(editing.id || 'new') + '-cat'} noun="category" value={editing.category || ''}
                  options={categories} onChange={(v) => setEditing({ ...editing, category: v })} />
              </Field>
              <Field label="SKU / Item #"><input value={editing.sku || ''} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></Field>
              <Field label="Manufacturer">
                <PickOrNew key={(editing.id || 'new') + '-man'} noun="manufacturer" value={editing.manufacturer || ''}
                  options={manufacturers} onChange={(v) => setEditing({ ...editing, manufacturer: v })} />
              </Field>
              <Field label="Supplier">
                <PickOrNew key={(editing.id || 'new') + '-sup'} noun="supplier" value={editing.supplier || ''}
                  options={suppliers} onChange={(v) => setEditing({ ...editing, supplier: v })} />
              </Field>
              <Field label="Storage location"><input value={editing.storage_location || ''} onChange={(e) => setEditing({ ...editing, storage_location: e.target.value })} /></Field>
              <Field label="Current qty"><input type="number" value={editing.current_qty ?? ''} onChange={(e) => setEditing({ ...editing, current_qty: e.target.value })} /></Field>
              <Field label="Par level"><input type="number" value={editing.par_level ?? ''} onChange={(e) => setEditing({ ...editing, par_level: e.target.value })} /></Field>
              <Field label="Reorder qty"><input type="number" value={editing.reorder_qty ?? ''} onChange={(e) => setEditing({ ...editing, reorder_qty: e.target.value })} /></Field>
              <Field label="Expiration date"><input type="date" value={editing.expiration_date || ''} onChange={(e) => setEditing({ ...editing, expiration_date: e.target.value })} /></Field>
              <Field label="Last ordered"><input type="date" value={editing.last_ordered || ''} onChange={(e) => setEditing({ ...editing, last_ordered: e.target.value })} /></Field>
              <Field label="Unit price"><input type="number" step="0.01" value={editing.unit_price ?? ''} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} /></Field>
              <Field label="Order link" full><input value={editing.order_link || ''} onChange={(e) => setEditing({ ...editing, order_link: e.target.value })} /></Field>
              <Field label="Notes" full><textarea value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            </div>

            <div className="modal-actions">
              {editing.id && (onList(editing.item_id)
                ? <button className="btn-secondary" onClick={() => { const o = orderList.find((x) => x.item_id === editing.item_id); if (o) removeFromOrder(o.id); }}>On order list ✓ — remove</button>
                : <button className="btn-primary" onClick={() => addItemToOrder(editing)}>+ Add to order list</button>)}
              <div className="spacer" />
              {editing.id && !editing.archived && <button className="btn-ghost" onClick={() => archiveItem(editing, true)}>Archive</button>}
              {editing.id && editing.archived && <button className="btn-ghost" onClick={() => archiveItem(editing, false)}>Unarchive</button>}
              {editing.id && <button className="btn-danger" onClick={() => deleteItem(editing)}>Delete</button>}
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={saveItem} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-head">
              <h2>How to use · FAQs</h2>
              <button className="btn-secondary" onClick={() => setShowHelp(false)}>Close</button>
            </div>
            <div className="help-body">
              <h3>The basics</h3>
              <p>The <b>Items</b> tab lists every supply. Search by name, SKU, or ID; narrow the list with the <b>Category / Manufacturer / Supplier</b> dropdowns; reorder it with <b>Sort</b>. Tap any item to see its photo and full details or to edit it.</p>
              <p>A coloured left edge and a <b>LOW</b> / <b>OUT</b> badge mean the stock is at or below that item&apos;s par level. Tap the red <b>&ldquo;N low / out&rdquo;</b> count at the top to show only those items.</p>

              <h3>Updating stock (the monthly count)</h3>
              <p>On each row use the <b>−</b> and <b>+</b> buttons to adjust the on-hand number, or tap the number and type it. It saves instantly, and the LOW/OUT flag updates as you go.</p>

              <h3>Building an order</h3>
              <p>Tap the round <b>+</b> on any item row to drop it onto the <b>Order list</b> (it turns into a green <b>✓</b>). Or open the Order list tab and use <b>Scan to add</b> to scan labels in quickly.</p>
              <p>On the Order list: tick each checkbox as you place the order, adjust the <b>Qty</b>, remove with <b>✕</b>, and <b>Print</b> for a paper order sheet. <b>Clear checked</b> removes the ones you&apos;ve already ordered.</p>

              <h3>Scanning</h3>
              <p><b>Scan QR</b> on the Items tab opens the scanned item. On the Order list or inside a Set, <b>Scan to add</b> drops scanned items straight in. The camera asks permission the first time — tap <b>Allow</b>. If it won&apos;t start, you can always type the Item ID in the box instead.</p>

              <h3>Sets (kits)</h3>
              <p>The <b>Sets</b> tab groups items into kits (e.g. &ldquo;Crown Bur Set&rdquo;). Open a set, then <b>search</b> or <b>Scan to add</b> to put items in, and <b>✕</b> to take them out. An item can live in several sets — its stock and details are shared, so a change anywhere updates it everywhere. A row shows <b>&ldquo;in N other sets&rdquo;</b> when it&apos;s shared.</p>

              <h3>Adding &amp; editing items</h3>
              <p><b>+ Add item</b> creates a new one. Category, Manufacturer, and Supplier are dropdowns — pick an existing value, or choose <b>➕ New…</b> to create one. <b>Add / change photo</b> uses the camera (photos are shrunk automatically, so they load fast and barely use storage).</p>
              <p><b>Par level</b> is the reorder threshold that drives the LOW/OUT flags. <b>Archive</b> hides an item but keeps it (tick <b>Archived</b> to view, then <b>Unarchive</b>); <b>Delete</b> is permanent — use Archive unless it was a mistake.</p>

              <h3>FAQs</h3>
              <div className="faq"><b>An item isn&apos;t flagged LOW even though it&apos;s low.</b><p>It needs a <b>Par level</b>. Open the item and set one — that&apos;s the number the on-hand count is compared against.</p></div>
              <div className="faq"><b>Archive vs Delete?</b><p>Archive hides the item but keeps its record; Delete removes it for good. Prefer Archive.</p></div>
              <div className="faq"><b>Can one item be in two sets?</b><p>Yes. It&apos;s the same item, so its stock and details stay in sync across every set and the main list.</p></div>
              <div className="faq"><b>How do I add a brand-new category or supplier?</b><p>In the item, open the dropdown and choose <b>➕ New…</b>, then type it.</p></div>
              <div className="faq"><b>What do the QR labels do?</b><p>Each label is that item&apos;s ID. Scanning it opens the item — or adds it, on the Order list or in a Set.</p></div>
              <div className="faq"><b>The camera won&apos;t scan.</b><p>Make sure you allowed camera access and you&apos;re on the app&apos;s https link. The type-the-ID box always works as a backup.</p></div>
              <div className="faq"><b>Do photos use a lot of space?</b><p>No — every photo is compressed automatically on upload, so you can add one per item without worry.</p></div>
            </div>
          </div>
        </div>
      )}

      {scanning && (
        <QRScanner
          mode={scanning === 'open' ? 'open' : 'add'}
          title={scanning === 'order' ? 'Scan to add to order list'
            : scanning === 'set' ? 'Scan to add to this set'
            : 'Scan a QR label'}
          onResult={handleScan}
          onAdd={scanning === 'set' ? setAddByCode : orderAddByCode}
          onClose={() => setScanning(null)} />
      )}

      {/* Print-only order sheet */}
      <div className="print-area">
        <h1>Deccan Dental — Order List</h1>
        <div className="print-date">{today}</div>
        <table>
          <thead>
            <tr><th className="pc"> </th><th>Item</th><th>SKU</th><th>Supplier</th><th className="pq">Qty</th></tr>
          </thead>
          <tbody>
            {orderRows.map((o) => (
              <tr key={o.id} className={o.ordered ? 'pdone' : ''}>
                <td className="pc">{o.ordered ? '☑' : '☐'}</td>
                <td>{o.item ? o.item.name : o.item_id}</td>
                <td>{o.item?.sku || ''}</td>
                <td>{o.item?.supplier || ''}</td>
                <td className="pq">{o.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
