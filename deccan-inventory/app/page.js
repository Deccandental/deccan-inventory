'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const EMPTY = {
  item_id: '', name: '', category: '', sku: '', manufacturer: '', supplier: '',
  storage_location: '', current_qty: '', par_level: '', reorder_qty: '',
  expiration_date: '', order_link: '', unit_price: '', last_ordered: '', notes: '', image_url: '',
};

function StatusBadge({ item }) {
  if (item.par_level == null || item.par_level === '') return null;
  const low = Number(item.current_qty ?? 0) <= Number(item.par_level);
  return <span className={low ? 'badge reorder' : 'badge ok'}>{low ? 'REORDER' : 'OK'}</span>;
}

function Field({ label, children, full }) {
  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function QRScanner({ onResult, onClose }) {
  useEffect(() => {
    let scanner;
    let active = true;
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      scanner = new Html5Qrcode('qr-reader');
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (text) => {
            if (!active) return;
            active = false;
            scanner.stop().then(() => onResult(text)).catch(() => onResult(text));
          },
          () => {}
        )
        .catch((e) => {
          console.error('Camera error', e);
          alert('Could not start the camera. Check camera permissions for this site.');
        });
    });
    return () => {
      active = false;
      if (scanner) scanner.stop().catch(() => {});
    };
  }, [onResult]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Scan a QR label</h2>
        <div id="qr-reader" />
        <p className="hint">Point the camera at a supply label&apos;s QR code.</p>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fManufacturer, setFManufacturer] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState('item_id');
  const [editing, setEditing] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('items').select('*');
    if (error) { console.error(error); alert('Could not load items: ' + error.message); }
    setItems(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const uniq = useCallback(
    (key) => Array.from(new Set(items.map((i) => i[key]).filter(Boolean))).sort(),
    [items]
  );
  const categories = useMemo(() => uniq('category'), [uniq]);
  const manufacturers = useMemo(() => uniq('manufacturer'), [uniq]);
  const suppliers = useMemo(() => uniq('supplier'), [uniq]);

  const visible = useMemo(() => {
    let list = items.filter((i) => (showArchived ? i.archived : !i.archived));
    if (fCategory) list = list.filter((i) => i.category === fCategory);
    if (fManufacturer) list = list.filter((i) => i.manufacturer === fManufacturer);
    if (fSupplier) list = list.filter((i) => i.supplier === fSupplier);
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
  }, [items, showArchived, fCategory, fManufacturer, fSupplier, search, sortBy]);

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
    setEditing({
      ...EMPTY, ...item,
      expiration_date: item.expiration_date || '',
      last_ordered: item.last_ordered || '',
    });
  }
  function closeModal() { setEditing(null); }

  function handleScan(text) {
    setScanning(false);
    const code = (text || '').trim();
    const found = items.find((i) => (i.item_id || '').toLowerCase() === code.toLowerCase());
    if (found) openEdit(found);
    else alert('No item found for code: ' + code);
  }

  async function uploadImage(file, itemId) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${itemId || 'new'}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('item-images').upload(path, file, { upsert: true });
    if (error) { alert('Image upload failed: ' + error.message); return null; }
    const { data } = supabase.storage.from('item-images').getPublicUrl(path);
    return data.publicUrl;
  }

  async function onPickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file, editing.item_id);
    setUploading(false);
    if (url) setEditing((prev) => ({ ...prev, image_url: url }));
  }

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const txt = (v) => (v === '' || v == null ? null : v);

  async function saveItem() {
    if (!editing.item_id.trim() || !editing.name.trim()) {
      alert('Item ID and Name are required.'); return;
    }
    setSaving(true);
    const payload = {
      item_id: editing.item_id.trim(),
      name: editing.name.trim(),
      category: txt(editing.category),
      sku: txt(editing.sku),
      manufacturer: txt(editing.manufacturer),
      supplier: txt(editing.supplier),
      storage_location: txt(editing.storage_location),
      current_qty: num(editing.current_qty) ?? 0,
      par_level: num(editing.par_level),
      reorder_qty: num(editing.reorder_qty),
      expiration_date: txt(editing.expiration_date),
      order_link: txt(editing.order_link),
      unit_price: num(editing.unit_price),
      last_ordered: txt(editing.last_ordered),
      notes: txt(editing.notes),
      image_url: txt(editing.image_url),
    };
    let error;
    if (editing.id) {
      ({ error } = await supabase.from('items').update(payload).eq('id', editing.id));
    } else {
      ({ error } = await supabase.from('items').insert(payload));
    }
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    closeModal();
    fetchItems();
  }

  async function archiveItem(item, archived) {
    const { error } = await supabase.from('items').update({ archived }).eq('id', item.id);
    if (error) { alert(error.message); return; }
    closeModal();
    fetchItems();
  }

  async function deleteItem(item) {
    if (!confirm(`Permanently delete ${item.item_id} — ${item.name}?\nThis cannot be undone. (Consider Archive instead.)`)) return;
    const { error } = await supabase.from('items').delete().eq('id', item.id);
    if (error) { alert(error.message); return; }
    closeModal();
    fetchItems();
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Deccan Dental — Inventory</div>
        <div className="top-actions">
          <button className="btn-scan" onClick={() => setScanning(true)}>Scan QR</button>
          <button className="btn-primary" onClick={openAdd}>+ Add item</button>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="controls">
        <input className="search" placeholder="Search name, SKU, or ID…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
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
          <option value="category">Sort: Category</option>
          <option value="manufacturer">Sort: Manufacturer</option>
          <option value="supplier">Sort: Supplier</option>
          <option value="current_qty">Sort: Quantity (low first)</option>
          <option value="updated_at">Sort: Recently updated</option>
        </select>
        <label className="chk">
          <input type="checkbox" checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)} /> Archived
        </label>
      </div>

      <div className="count">
        {loading ? 'Loading…' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}
      </div>

      <div className="grid">
        {visible.map((item) => (
          <div className="card" key={item.id} onClick={() => openEdit(item)}>
            <div className="thumb">
              {item.image_url
                ? <img src={item.image_url} alt={item.name} />
                : <div className="noimg">No photo</div>}
            </div>
            <div className="card-body">
              <div className="card-top">
                <span className="idpill">{item.item_id}</span>
                <StatusBadge item={item} />
              </div>
              <div className="name">{item.name}</div>
              <div className="meta">{item.category}</div>
              <div className="meta">
                Qty: {item.current_qty ?? 0}{item.par_level != null ? ` / par ${item.par_level}` : ''}
              </div>
              <div className="meta">{item.supplier}</div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? 'Edit item' : 'Add item'}</h2>
            <div className="form">
              <div className="img-edit">
                {editing.image_url
                  ? <img src={editing.image_url} alt="" />
                  : <div className="noimg big">No photo</div>}
                <label className="btn-secondary file-btn">
                  {uploading ? 'Uploading…' : 'Add / change photo'}
                  <input type="file" accept="image/*" capture="environment" onChange={onPickImage} hidden />
                </label>
              </div>

              <Field label="Item ID *">
                <input value={editing.item_id} onChange={(e) => setEditing({ ...editing, item_id: e.target.value })} />
              </Field>
              <Field label="Name *">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Category">
                <input list="cats" value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
              </Field>
              <Field label="SKU / Item #">
                <input value={editing.sku || ''} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} />
              </Field>
              <Field label="Manufacturer">
                <input list="mans" value={editing.manufacturer || ''} onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })} />
              </Field>
              <Field label="Supplier">
                <input list="sups" value={editing.supplier || ''} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} />
              </Field>
              <Field label="Storage location">
                <input value={editing.storage_location || ''} onChange={(e) => setEditing({ ...editing, storage_location: e.target.value })} />
              </Field>
              <Field label="Current qty">
                <input type="number" value={editing.current_qty ?? ''} onChange={(e) => setEditing({ ...editing, current_qty: e.target.value })} />
              </Field>
              <Field label="Par level">
                <input type="number" value={editing.par_level ?? ''} onChange={(e) => setEditing({ ...editing, par_level: e.target.value })} />
              </Field>
              <Field label="Reorder qty">
                <input type="number" value={editing.reorder_qty ?? ''} onChange={(e) => setEditing({ ...editing, reorder_qty: e.target.value })} />
              </Field>
              <Field label="Expiration date">
                <input type="date" value={editing.expiration_date || ''} onChange={(e) => setEditing({ ...editing, expiration_date: e.target.value })} />
              </Field>
              <Field label="Last ordered">
                <input type="date" value={editing.last_ordered || ''} onChange={(e) => setEditing({ ...editing, last_ordered: e.target.value })} />
              </Field>
              <Field label="Unit price">
                <input type="number" step="0.01" value={editing.unit_price ?? ''} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} />
              </Field>
              <Field label="Order link" full>
                <input value={editing.order_link || ''} onChange={(e) => setEditing({ ...editing, order_link: e.target.value })} />
              </Field>
              <Field label="Notes" full>
                <textarea value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </Field>
            </div>

            <div className="modal-actions">
              {editing.id && !editing.archived &&
                <button className="btn-ghost" onClick={() => archiveItem(editing, true)}>Archive</button>}
              {editing.id && editing.archived &&
                <button className="btn-ghost" onClick={() => archiveItem(editing, false)}>Unarchive</button>}
              {editing.id &&
                <button className="btn-danger" onClick={() => deleteItem(editing)}>Delete</button>}
              <div className="spacer" />
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={saveItem} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="mans">{manufacturers.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="sups">{suppliers.map((c) => <option key={c} value={c} />)}</datalist>

      {scanning && <QRScanner onResult={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}
