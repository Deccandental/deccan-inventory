'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

async function safeStop(scanner) {
  if (!scanner) return;
  try {
    const state = typeof scanner.getState === 'function' ? scanner.getState() : null;
    if (state === 2 || state === 3) await scanner.stop();
  } catch (_) {}
  try { scanner.clear(); } catch (_) {}
}

// mode: 'open' -> stop + onResult(code); 'add' -> keep running, call onAdd(code) per scan
function QRScanner({ mode, onResult, onAdd, onClose }) {
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
        <h2>{mode === 'add' ? 'Scan to add to order list' : 'Scan a QR label'}</h2>
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
  const [sortBy, setSortBy] = useState('item_id');
  const [editing, setEditing] = useState(null);
  const [scanning, setScanning] = useState(null); // null | 'open' | 'add'
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    (async () => { setLoading(true); await Promise.all([fetchItems(), fetchOrderList()]); setLoading(false); })();
  }, [fetchItems, fetchOrderList]);

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
    try {
      const url = await uploadImage(file, editing.item_id);
      if (url) setEditing((prev) => ({ ...prev, image_url: url }));
    } catch (err) { alert('Image upload failed: ' + (err?.message || err)); }
    finally { setUploading(false); }
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

  const today = new Date().toLocaleDateString();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Deccan Dental — Inventory</div>
        <div className="top-actions">
          {view === 'items'
            ? <button className="btn-scan" onClick={() => setScanning('open')}>Scan QR</button>
            : <button className="btn-scan" onClick={() => setScanning('add')}>Scan to add</button>}
          <button className="btn-primary" onClick={openAdd}>+ Add item</button>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="tabs">
        <button className={view === 'items' ? 'tab on' : 'tab'} onClick={() => setView('items')}>Items</button>
        <button className={view === 'order' ? 'tab on' : 'tab'} onClick={() => setView('order')}>
          Order list{orderCount ? ` (${orderCount})` : ''}
        </button>
      </div>

      {view === 'items' && (
        <>
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
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
            </label>
          </div>

          <div className="count">{loading ? 'Loading…' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}</div>

          <div className="grid">
            {visible.map((item) => (
              <div className="card" key={item.id} onClick={() => openEdit(item)}>
                <div className="thumb">
                  {item.image_url ? <img src={item.image_url} alt={item.name} /> : <div className="noimg">No photo</div>}
                </div>
                <div className="card-body">
                  <div className="card-top">
                    <span className="idpill">{item.item_id}</span>
                    <StatusBadge item={item} />
                  </div>
                  <div className="name">{item.name}</div>
                  <div className="meta">{item.category}</div>
                  <div className="meta">Qty: {item.current_qty ?? 0}{item.par_level != null ? ` / par ${item.par_level}` : ''}</div>
                  <div className="meta">{item.supplier}</div>
                </div>
              </div>
            ))}
          </div>
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

      {editing && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? 'Edit item' : 'Add item'}</h2>
            <div className="form">
              <div className="img-edit">
                {editing.image_url ? <img src={editing.image_url} alt="" /> : <div className="noimg big">No photo</div>}
                <label className="btn-secondary file-btn">
                  {uploading ? 'Uploading…' : 'Add / change photo'}
                  <input type="file" accept="image/*" capture="environment" onChange={onPickImage} hidden />
                </label>
              </div>

              <Field label="Item ID *"><input value={editing.item_id} onChange={(e) => setEditing({ ...editing, item_id: e.target.value })} /></Field>
              <Field label="Name *"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Category"><input list="cats" value={editing.category || ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
              <Field label="SKU / Item #"><input value={editing.sku || ''} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></Field>
              <Field label="Manufacturer"><input list="mans" value={editing.manufacturer || ''} onChange={(e) => setEditing({ ...editing, manufacturer: e.target.value })} /></Field>
              <Field label="Supplier"><input list="sups" value={editing.supplier || ''} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} /></Field>
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

      <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="mans">{manufacturers.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="sups">{suppliers.map((c) => <option key={c} value={c} />)}</datalist>

      {scanning && (
        <QRScanner mode={scanning} onResult={handleScan} onAdd={orderAddByCode} onClose={() => setScanning(null)} />
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
