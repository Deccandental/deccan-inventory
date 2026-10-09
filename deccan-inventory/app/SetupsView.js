'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/image';
import { Field, PickOrNew, StatusBadge, stockState } from './ui';

const NUMS_KEY = 'dd_setup_show_numbers';
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const clamp = (n) => Math.min(100, Math.max(0, n));
const r2 = (n) => Math.round(n * 100) / 100;

async function uploadSetupPhoto(file) {
  const out = await compressImage(file, 1600, 0.82);
  const ext = out.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `setups/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('item-images').upload(path, out, { upsert: true, contentType: out.type || undefined });
  if (error) throw new Error(error.message);
  return supabase.storage.from('item-images').getPublicUrl(path).data.publicUrl;
}

function cleanPoints(points) {
  return points.map((p) => ({
    id: p.id,
    label: (p.label || '').trim(),
    x: p.x == null ? null : r2(p.x),
    y: p.y == null ? null : r2(p.y),
    item_id: p.item_id || null,
  }));
}

// ---------- Add set-up modal ----------
function AddSetupModal({ groups, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [group, setGroup] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function create() {
    if (!title.trim() || !file) return;
    setBusy(true);
    try {
      const image_url = await uploadSetupPhoto(file);
      const { data, error } = await supabase.from('setups')
        .insert({ title: title.trim(), group_name: group.trim() || null, image_url, points: [] })
        .select().single();
      if (error) throw new Error(error.message);
      onCreated(data);
    } catch (e) {
      alert('Could not add set-up: ' + (e?.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add set-up</h2>
        <div className="form">
          <Field label="Title *" full><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Operatory 1 — hygiene tray" autoFocus /></Field>
          <Field label="Group (optional)" full>
            <PickOrNew noun="group" value={group} options={groups} onChange={setGroup} />
          </Field>
          <div className="field full">
            <span>Photo *</span>
            <label className="btn-secondary file-btn setup-filebtn">
              {file ? 'Change photo' : 'Choose or take a photo'}
              <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            {preview && <img src={preview} alt="" className="setup-add-preview" />}
          </div>
        </div>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy || !title.trim() || !file}>
            {busy ? 'Uploading…' : 'Add set-up'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Detail / edit modal ----------
function SetupDetail({ setup, items, itemByCode, groups, isAdmin, initialNum, autoEdit, onClose, onChanged, onGoToItem }) {
  const [draft, setDraft] = useState(null); // null = viewing
  const [sel, setSel] = useState(null);
  const [placingId, setPlacingId] = useState(null);
  const [linkFor, setLinkFor] = useState(null);
  const [linkQ, setLinkQ] = useState('');
  const [showNums, setShowNums] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef(null);
  const dragRef = useRef(null);
  const lineRefs = useRef({});

  const editing = !!draft;
  const data = draft || setup;
  const points = data.points || [];

  useEffect(() => {
    try { if (localStorage.getItem(NUMS_KEY) === '0') setShowNums(false); } catch (_) {}
  }, []);
  function toggleNums(v) {
    setShowNums(v);
    try { localStorage.setItem(NUMS_KEY, v ? '1' : '0'); } catch (_) {}
  }

  // jump to a specific number when opened from an item
  useEffect(() => {
    if (initialNum && setup.points?.[initialNum - 1]) {
      const id = setup.points[initialNum - 1].id;
      setSel(id);
      setTimeout(() => lineRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 150);
    }
  }, [initialNum, setup.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (autoEdit && isAdmin) startEdit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setDraft({
      title: setup.title,
      group_name: setup.group_name || '',
      image_url: setup.image_url,
      points: (setup.points || []).map((p) => ({ ...p })),
    });
    setPlacingId(null); setLinkFor(null);
  }
  function cancelEdit() {
    if (JSON.stringify(cleanPoints(draft.points)) !== JSON.stringify(cleanPoints(setup.points || [])) ||
        draft.title !== setup.title || (draft.group_name || '') !== (setup.group_name || '') || draft.image_url !== setup.image_url) {
      if (!confirm('Discard your changes to this set-up?')) return;
    }
    setDraft(null); setPlacingId(null); setLinkFor(null);
  }

  const setPoints = (fn) => setDraft((d) => ({ ...d, points: fn(d.points) }));
  const patchPoint = (id, patch) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  function pctFromEvent(e) {
    const r = photoRef.current.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  }

  function onPhotoClick(e) {
    if (!editing) { setSel(null); return; }
    const { x, y } = pctFromEvent(e);
    if (placingId) {
      patchPoint(placingId, { x, y });
      setSel(placingId);
      setPlacingId(null);
      return;
    }
    const p = { id: uid(), label: '', x, y, item_id: null };
    setPoints((ps) => [...ps, p]);
    setSel(p.id);
    setTimeout(() => lineRefs.current[p.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  function dotDown(e, p) {
    if (!editing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: p.id };
    setSel(p.id);
  }
  function dotMove(e) {
    if (!dragRef.current) return;
    const { x, y } = pctFromEvent(e);
    patchPoint(dragRef.current.id, { x, y });
  }
  function dotUp(e) {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }
  function dotClick(e, p) {
    e.stopPropagation();
    setSel(p.id);
    lineRefs.current[p.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function move(idx, dir) {
    setPoints((ps) => {
      const j = idx + dir;
      if (j < 0 || j >= ps.length) return ps;
      const a = [...ps];
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  }
  function removeLine(id) {
    const p = points.find((x) => x.id === id);
    if (!confirm(`Remove line ${points.indexOf(p) + 1}${p?.label ? ' — ' + p.label : ''}? The numbers after it shift up.`)) return;
    setPoints((ps) => ps.filter((x) => x.id !== id));
    if (sel === id) setSel(null);
    if (placingId === id) setPlacingId(null);
  }
  function addLine() {
    const p = { id: uid(), label: '', x: null, y: null, item_id: null };
    setPoints((ps) => [...ps, p]);
    setSel(p.id);
  }
  function linkItem(pid, item) {
    const p = points.find((x) => x.id === pid);
    patchPoint(pid, { item_id: item.item_id, label: p && p.label.trim() ? p.label : item.name });
    setLinkFor(null); setLinkQ('');
  }

  async function changePhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoBusy(true);
    try {
      const url = await uploadSetupPhoto(f);
      setDraft((d) => ({ ...d, image_url: url }));
    } catch (err) { alert('Photo upload failed: ' + (err?.message || err)); }
    setPhotoBusy(false);
  }

  async function save() {
    if (!draft.title.trim()) { alert('Give the set-up a title.'); return; }
    setSaving(true);
    const { error } = await supabase.from('setups').update({
      title: draft.title.trim(),
      group_name: (draft.group_name || '').trim() || null,
      image_url: draft.image_url,
      points: cleanPoints(draft.points),
      updated_at: new Date().toISOString(),
    }).eq('id', setup.id);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    setDraft(null); setPlacingId(null); setLinkFor(null);
    onChanged();
  }
  async function del() {
    if (!confirm(`Delete the set-up "${setup.title}" and all its numbered dots?\nInventory items are NOT affected.`)) return;
    const { error } = await supabase.from('setups').delete().eq('id', setup.id);
    if (error) { alert(error.message); return; }
    onChanged();
    onClose();
  }

  const linkResults = useMemo(() => {
    const q = linkQ.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => !i.archived && (
      (i.name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.item_id || '').toLowerCase().includes(q))).slice(0, 8);
  }, [items, linkQ]);

  const dotsVisible = editing || showNums;

  return (
    <div className="modal-backdrop" onClick={editing ? undefined : onClose}>
      <div className="modal setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          {editing
            ? <div className="setup-edit-head">
                <input className="setup-title-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" />
                <PickOrNew key={setup.id + '-g'} noun="group" value={draft.group_name} options={groups}
                  onChange={(v) => setDraft((d) => ({ ...d, group_name: v }))} />
              </div>
            : <div>
                <h2 style={{ margin: 0 }}>{setup.title}</h2>
                {setup.group_name && <div className="setup-group-tag">{setup.group_name}</div>}
              </div>}
          <div className="setup-head-actions">
            {isAdmin && !editing && <button className="btn-secondary" onClick={startEdit}>Edit</button>}
            {!editing && <button className="btn-secondary" onClick={onClose}>Close</button>}
          </div>
        </div>

        {editing && (
          <div className="setup-banner">
            {placingId
              ? <>Tap the photo to place dot <b>{points.findIndex((p) => p.id === placingId) + 1}</b>. <button className="btn-ghost" onClick={() => setPlacingId(null)}>Cancel</button></>
              : <>Tap the photo to drop a numbered dot · drag a dot to move it.</>}
          </div>
        )}

        <div className={'setup-photo' + (editing ? ' editing' : '') + (placingId ? ' placing' : '')} ref={photoRef} onClick={onPhotoClick}>
          <img src={data.image_url} alt={data.title} draggable={false} />
          {dotsVisible && points.map((p, i) => (p.x == null || p.y == null) ? null : (
            <div key={p.id}
              className={'setup-dot' + (sel === p.id ? ' sel' : '') + (editing ? ' drag' : '') + (p.item_id ? ' linked' : '')}
              style={{ left: p.x + '%', top: p.y + '%' }}
              onPointerDown={(e) => dotDown(e, p)} onPointerMove={dotMove} onPointerUp={dotUp} onPointerCancel={dotUp}
              onClick={(e) => dotClick(e, p)}>{i + 1}</div>
          ))}
        </div>

        {!editing && (
          <label className="chk setup-numchk">
            <input type="checkbox" checked={showNums} onChange={(e) => toggleNums(e.target.checked)} /> Show numbers on photo
          </label>
        )}
        {editing && (
          <div className="setup-photo-actions">
            <label className="btn-secondary file-btn">
              {photoBusy ? 'Uploading…' : 'Change photo'}
              <input type="file" accept="image/*" hidden onChange={changePhoto} />
            </label>
          </div>
        )}

        <h3 className="setup-index-h">Index</h3>
        {points.length === 0 && (
          <div className="empty setup-empty">
            {editing ? 'No dots yet. Tap the photo to drop dot 1.' : 'Nothing numbered on this photo yet.'}
          </div>
        )}

        <div className="setup-index">
          {points.map((p, i) => {
            const item = p.item_id ? itemByCode(p.item_id) : null;
            const missing = p.item_id && !item;
            const unplaced = p.x == null || p.y == null;
            return (
              <div key={p.id} ref={(el) => { lineRefs.current[p.id] = el; }}
                className={'setup-line' + (sel === p.id ? ' sel' : '')}
                onClick={() => setSel(p.id)}>
                <div className={'setup-num' + (unplaced && editing ? ' unplaced' : '')}>{i + 1}</div>

                {editing ? (
                  <div className="setup-line-edit">
                    <input className="setup-label-input" value={p.label} placeholder="What is it?"
                      onChange={(e) => patchPoint(p.id, { label: e.target.value })} />
                    <div className="setup-line-tools">
                      <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); setPlacingId(p.id); setSel(p.id); }}>
                        {unplaced ? 'Place' : 'Move'}
                      </button>
                      <button className="btn-secondary sm" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }} title="Move up">↑</button>
                      <button className="btn-secondary sm" disabled={i === points.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }} title="Move down">↓</button>
                      <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); setLinkFor(linkFor === p.id ? null : p.id); setLinkQ(''); }}>
                        {p.item_id ? 'Change item' : 'Link item'}
                      </button>
                      {p.item_id && <button className="btn-ghost sm" onClick={(e) => { e.stopPropagation(); patchPoint(p.id, { item_id: null }); }}>Unlink</button>}
                      <button className="btn-ghost sm danger" onClick={(e) => { e.stopPropagation(); removeLine(p.id); }} title="Remove line">✕</button>
                    </div>
                    {p.item_id && (
                      <div className="setup-linked-note">
                        {item ? <>→ <b>{item.name}</b> <span className="idpill">{item.item_id}</span></> : <>→ {p.item_id} <span className="setup-missing">(item not found)</span></>}
                      </div>
                    )}
                    {linkFor === p.id && (
                      <div className="setup-picker" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus placeholder="Search inventory by name, SKU or ID…" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} />
                        {linkQ.trim() && (linkResults.length === 0
                          ? <div className="add-none">No matches.</div>
                          : linkResults.map((it) => (
                            <div className="add-row" key={it.id}>
                              <div className="add-info"><span className="idpill">{it.item_id}</span> {it.name}</div>
                              <button className="btn-primary sm" onClick={() => linkItem(p.id, it)}>Link</button>
                            </div>
                          )))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="setup-line-view">
                    <div className="setup-line-label">{p.label || item?.name || <span className="muted">(no label)</span>}</div>
                    {item && (
                      <div className="setup-item-card">
                        <div className="row-thumb sm">{item.image_url ? <img src={item.image_url} alt="" /> : <span className="ph">▢</span>}</div>
                        <div className="setup-item-main">
                          <div className="setup-item-name">{item.name} <span className="idpill">{item.item_id}</span></div>
                          <div className="setup-item-stock">
                            <b>{item.current_qty ?? 0}</b> in stock
                            {item.par_level != null && Number(item.par_level) > 0 && <span className="par-note"> · par {item.par_level}</span>}
                            {' '}<StatusBadge item={item} />
                            {item.ordered_at && <span className="chip onorder">on order</span>}
                          </div>
                        </div>
                        <button className="btn-secondary sm" onClick={(e) => { e.stopPropagation(); onGoToItem(item); }}>Open item ›</button>
                      </div>
                    )}
                    {missing && <div className="setup-missing">Linked item {p.item_id} was deleted or renamed.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="setup-addline">
            <button className="btn-secondary" onClick={addLine}>+ Add line</button>
            <span className="hint"> (adds a line with no dot — use Place to put it on the photo)</span>
          </div>
        )}

        {editing && (
          <div className="modal-actions">
            <button className="btn-danger" onClick={del}>Delete set-up</button>
            <div className="spacer" />
            <button className="btn-secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------
export default function SetupsView({ setups, items, itemByCode, isAdmin, open, setOpen, onChanged, onGoToItem }) {
  const [groupFilter, setGroupFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => Array.from(new Set(setups.map((s) => s.group_name).filter(Boolean))).sort(), [setups]);
  const hasUngrouped = setups.some((s) => !s.group_name);

  const shown = useMemo(() => setups.filter((s) => {
    if (!groupFilter) return true;
    if (groupFilter === '__none__') return !s.group_name;
    return s.group_name === groupFilter;
  }), [setups, groupFilter]);

  const byGroup = useMemo(() => {
    const g = {};
    shown.forEach((s) => { (g[s.group_name || 'Ungrouped'] ||= []).push(s); });
    Object.values(g).forEach((a) => a.sort((x, y) => x.title.localeCompare(y.title)));
    return Object.entries(g).sort((a, b) => {
      if (a[0] === 'Ungrouped') return 1;
      if (b[0] === 'Ungrouped') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [shown]);

  const openSetup = open ? setups.find((s) => s.id === open.id) : null;

  return (
    <>
      <div className="order-toolbar">
        <div className="count">{setups.length} set-up{setups.length === 1 ? '' : 's'}</div>
        <div className="spacer" />
        {isAdmin && <button className="btn-primary" onClick={() => setAdding(true)}>+ Add set-up</button>}
      </div>

      {(groups.length > 0 || hasUngrouped) && (
        <div className="setup-groupbar">
          <button className={!groupFilter ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter('')}>All</button>
          {groups.map((g) => (
            <button key={g} className={groupFilter === g ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter(g)}>{g}</button>
          ))}
          {hasUngrouped && groups.length > 0 && (
            <button className={groupFilter === '__none__' ? 'grpbtn on' : 'grpbtn'} onClick={() => setGroupFilter('__none__')}>Ungrouped</button>
          )}
        </div>
      )}

      {setups.length === 0 ? (
        <div className="empty">
          No set-ups yet.{isAdmin ? <> Tap <b>+ Add set-up</b> to add a photo, then number what&apos;s in it.</> : ' An admin can add the first one.'}
        </div>
      ) : (
        byGroup.map(([g, list]) => (
          <div className="cat-group" key={g}>
            <div className="cat-header setup-grouphead">{g} <span className="cat-count">{list.length}</span></div>
            <div className="setup-grid">
              {list.map((s) => {
                const linked = (s.points || []).filter((p) => p.item_id).length;
                return (
                  <div className="setup-card" key={s.id} onClick={() => setOpen({ id: s.id, num: null })}>
                    <div className="setup-card-img"><img src={s.image_url} alt={s.title} loading="lazy" /></div>
                    <div className="setup-card-body">
                      <div className="setup-card-title">{s.title}</div>
                      <div className="setup-card-sub">
                        {(s.points || []).length} numbered{linked ? ` · ${linked} linked` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {adding && (
        <AddSetupModal groups={groups} onClose={() => setAdding(false)}
          onCreated={async (row) => { setAdding(false); await onChanged(); setOpen({ id: row.id, num: null, edit: true }); }} />
      )}

      {openSetup && (
        <SetupDetail key={openSetup.id} setup={openSetup} items={items} itemByCode={itemByCode} groups={groups}
          isAdmin={isAdmin} initialNum={open.num} autoEdit={!!open.edit}
          onClose={() => setOpen(null)} onChanged={onChanged} onGoToItem={onGoToItem} />
      )}
    </>
  );
}
