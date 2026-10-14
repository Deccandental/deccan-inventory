'use client';

import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Field, PickOrNew, StatusBadge } from './ui';

// A protocol is a step-by-step card for mixing/applying a material (cement, bond, etch…),
// linked to the inventory items it uses. Stored in the `protocols` table; admins edit in-app.

const CAT_ORDER = [
  'Cementation',
  'Ceramic / Restoration Prep',
  'Bonding & Etch',
  'Composites',
  'Liners / Bases',
  'Temporaries',
  'Impressions & Tissue Mgmt',
  'Whitening',
  'Preventive',
  'Dentures / Perio Dressing',
  'Surgical / Grafts',
  'Misc Chairside',
];
const catRank = (c) => {
  const i = CAT_ORDER.indexOf(c);
  return i === -1 ? CAT_ORDER.length : i;
};

const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- Add protocol modal ----------
function AddProtocolModal({ groups, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from('protocols')
      .insert({ title: title.trim(), category: cat.trim() || null, steps: [], warnings: [], links: [], item_ids: [] })
      .select().single();
    if (error) {
      alert('Could not add protocol: ' + error.message + ' (has 06_protocols.sql been run in Supabase?)');
      setBusy(false);
      return;
    }
    onCreated(data);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add protocol</h2>
        <div className="form">
          <Field label="Title *" full>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Panavia V5 — cementing a crown" autoFocus />
          </Field>
          <Field label="Category" full>
            <PickOrNew noun="category" value={cat} options={groups} onChange={setCat} />
          </Field>
        </div>
        <div className="modal-actions">
          <div className="spacer" />
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Add protocol'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Detail / edit modal ----------
function ProtocolDetail({ proto, items, itemByCode, groups, isAdmin, autoEdit, onClose, onChanged, onGoToItem }) {
  const [draft, setDraft] = useState(autoEdit && isAdmin ? fromProto(proto) : null);
  const [saving, setSaving] = useState(false);
  const [addQ, setAddQ] = useState('');

  function fromProto(p) {
    return {
      title: p.title || '',
      category: p.category || '',
      purpose: p.purpose || '',
      steps: arr(p.steps).map((s) => String(s)),
      warnings: arr(p.warnings).map((s) => String(s)),
      notes: p.notes || '',
      links: arr(p.links).map((l) => ({ label: l?.label || '', url: l?.url || '' })),
      item_ids: arr(p.item_ids).map((s) => String(s)),
    };
  }

  const editing = !!draft;
  const data = editing
    ? draft
    : {
        title: proto.title, category: proto.category, purpose: proto.purpose,
        steps: arr(proto.steps), warnings: arr(proto.warnings), notes: proto.notes || '',
        links: arr(proto.links), item_ids: arr(proto.item_ids),
      };

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const setList = (key, fn) => setDraft((d) => ({ ...d, [key]: fn(d[key]) }));
  const moveIn = (key, idx, dir) => setList(key, (l) => {
    const j = idx + dir;
    if (j < 0 || j >= l.length) return l;
    const a = [...l];
    [a[idx], a[j]] = [a[j], a[idx]];
    return a;
  });

  const addResults = useMemo(() => {
    const q = addQ.trim().toLowerCase();
    if (!editing || !q) return [];
    const have = new Set(draft.item_ids);
    return items.filter((i) => !i.archived && !have.has(i.item_id) && (
      (i.name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.item_id || '').toLowerCase().includes(q))).slice(0, 8);
  }, [items, addQ, editing, draft]);

  function cancelEdit() {
    if (JSON.stringify(draft) !== JSON.stringify(fromProto(proto)) && !confirm('Discard your changes to this protocol?')) return;
    setDraft(null);
  }

  async function save() {
    if (!draft.title.trim()) { alert('Give the protocol a title.'); return; }
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      category: draft.category.trim() || null,
      purpose: draft.purpose.trim() || null,
      steps: draft.steps.map((s) => s.trim()).filter(Boolean),
      warnings: draft.warnings.map((s) => s.trim()).filter(Boolean),
      notes: draft.notes.trim() || null,
      links: draft.links.map((l) => ({ label: (l.label || '').trim(), url: (l.url || '').trim() })).filter((l) => l.url),
      item_ids: draft.item_ids,
    };
    const { error } = await supabase.from('protocols').update(payload).eq('id', proto.id);
    setSaving(false);
    if (error) { alert('Save failed: ' + error.message); return; }
    setDraft(null);
    onChanged();
  }

  async function del() {
    if (!confirm(`Delete the protocol "${proto.title}"?\nInventory items themselves are NOT affected.`)) return;
    const { error } = await supabase.from('protocols').delete().eq('id', proto.id);
    if (error) { alert(error.message); return; }
    onChanged();
    onClose();
  }

  const linkedItems = data.item_ids.map((id) => ({ id, item: itemByCode(id) }));

  return (
    <div className="modal-backdrop" onClick={editing ? undefined : onClose}>
      <div className="modal setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          {editing ? (
            <div className="setup-edit-head">
              <input className="setup-title-input" value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Title" />
              <PickOrNew key={proto.id + '-cat'} noun="category" value={draft.category} options={groups}
                onChange={(v) => patch({ category: v })} />
            </div>
          ) : (
            <div>
              <h2 style={{ margin: 0 }}>{proto.title}</h2>
              {proto.category && <div className="setup-group-tag">{proto.category}</div>}
            </div>
          )}
          <div className="setup-head-actions">
            {isAdmin && !editing && <button className="btn-secondary" onClick={() => setDraft(fromProto(proto))}>Edit</button>}
            {!editing && <button className="btn-secondary" onClick={onClose}>Close</button>}
          </div>
        </div>

        {/* Purpose */}
        {editing ? (
          <div className="field full proto-block">
            <span>What it&apos;s for (one line)</span>
            <input value={draft.purpose} onChange={(e) => patch({ purpose: e.target.value })} placeholder="e.g. Luting zirconia and e.max crowns" />
          </div>
        ) : (
          data.purpose && <p className="proto-purpose">{data.purpose}</p>
        )}

        {/* Steps */}
        <h3 className="setup-index-h">Steps</h3>
        {editing ? (
          <div className="proto-edit-list">
            {draft.steps.map((s, i) => (
              <div className="proto-edit-row" key={i}>
                <div className="setup-num">{i + 1}</div>
                <textarea rows={2} value={s} onChange={(e) => setList('steps', (l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
                <div className="proto-edit-tools">
                  <button className="btn-secondary sm" disabled={i === 0} onClick={() => moveIn('steps', i, -1)} title="Move up">↑</button>
                  <button className="btn-secondary sm" disabled={i === draft.steps.length - 1} onClick={() => moveIn('steps', i, 1)} title="Move down">↓</button>
                  <button className="btn-ghost sm danger" onClick={() => setList('steps', (l) => l.filter((_, j) => j !== i))} title="Remove">✕</button>
                </div>
              </div>
            ))}
            <button className="btn-secondary" onClick={() => setList('steps', (l) => [...l, ''])}>+ Add step</button>
          </div>
        ) : data.steps.length === 0 ? (
          <div className="empty setup-empty">No steps written yet.{isAdmin ? ' Tap Edit to add them.' : ''}</div>
        ) : (
          <div className="proto-steps">
            {data.steps.map((s, i) => (
              <div className="proto-step" key={i}>
                <div className="setup-num">{i + 1}</div>
                <div className="proto-step-text">{s}</div>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {(editing || data.warnings.length > 0) && <h3 className="setup-index-h">Watch out</h3>}
        {editing ? (
          <div className="proto-edit-list">
            {draft.warnings.map((s, i) => (
              <div className="proto-edit-row" key={i}>
                <div className="proto-warn-dot">⚠</div>
                <textarea rows={1} value={s} onChange={(e) => setList('warnings', (l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
                <div className="proto-edit-tools">
                  <button className="btn-ghost sm danger" onClick={() => setList('warnings', (l) => l.filter((_, j) => j !== i))} title="Remove">✕</button>
                </div>
              </div>
            ))}
            <button className="btn-secondary" onClick={() => setList('warnings', (l) => [...l, ''])}>+ Add warning</button>
          </div>
        ) : (
          data.warnings.length > 0 && (
            <div className="proto-warnings">
              {data.warnings.map((w, i) => <div className="proto-warning" key={i}>⚠ {w}</div>)}
            </div>
          )
        )}

        {/* Notes */}
        {(editing || data.notes) && <h3 className="setup-index-h">Notes</h3>}
        {editing ? (
          <textarea className="proto-notes-input" rows={2} value={draft.notes} placeholder="Anything else staff should know…"
            onChange={(e) => patch({ notes: e.target.value })} />
        ) : (
          data.notes && <p className="proto-notes">{data.notes}</p>
        )}

        {/* Links */}
        {(editing || data.links.length > 0) && <h3 className="setup-index-h">Product info &amp; instructions</h3>}
        {editing ? (
          <div className="proto-edit-list">
            {draft.links.map((l, i) => (
              <div className="proto-link-row" key={i}>
                <input className="proto-link-label" value={l.label} placeholder="Label (e.g. Product page)"
                  onChange={(e) => setList('links', (ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="proto-link-url" value={l.url} placeholder="https://…"
                  onChange={(e) => setList('links', (ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button className="btn-ghost sm danger" onClick={() => setList('links', (ls) => ls.filter((_, j) => j !== i))} title="Remove">✕</button>
              </div>
            ))}
            <button className="btn-secondary" onClick={() => setList('links', (ls) => [...ls, { label: '', url: '' }])}>+ Add link</button>
          </div>
        ) : (
          data.links.length > 0 && (
            <div className="proto-links">
              {data.links.map((l, i) => (
                <a className="btn-secondary sm proto-link" key={i} href={l.url} target="_blank" rel="noopener noreferrer">
                  🔗 {l.label || l.url}
                </a>
              ))}
            </div>
          )
        )}

        {/* Linked inventory items */}
        {(editing || linkedItems.length > 0) && <h3 className="setup-index-h">Products used (live stock)</h3>}
        {editing && (
          <div className="setup-picker">
            <input placeholder="Search inventory to link items…" value={addQ} onChange={(e) => setAddQ(e.target.value)} />
            {addQ.trim() && (addResults.length === 0
              ? <div className="add-none">No matches.</div>
              : addResults.map((it) => (
                <div className="add-row" key={it.id}>
                  <div className="add-info"><span className="idpill">{it.item_id}</span> {it.name}</div>
                  <button className="btn-primary sm" onClick={() => { setList('item_ids', (l) => [...l, it.item_id]); setAddQ(''); }}>Link</button>
                </div>
              )))}
          </div>
        )}
        {linkedItems.length > 0 && (
          <div className="setup-members">
            {linkedItems.map(({ id, item }) => item ? (
              <div className="setup-member" key={id}>
                <div className="row-thumb sm">{item.image_url ? <img src={item.image_url} alt="" /> : <span className="ph">▢</span>}</div>
                <div className="setup-member-name">{item.name} <span className="idpill">{item.item_id}</span></div>
                <div className="setup-member-qty"><b>{item.current_qty ?? 0}</b> <StatusBadge item={item} />{item.ordered_at && <span className="chip onorder">on order</span>}</div>
                {!editing && <button className="btn-secondary sm" onClick={() => onGoToItem(item)}>Open ›</button>}
                {editing && <button className="btn-ghost sm danger" title="Unlink from this protocol" onClick={() => setList('item_ids', (l) => l.filter((x) => x !== id))}>✕</button>}
              </div>
            ) : (
              <div className="setup-member" key={id}>
                <div className="setup-member-name"><span className="idpill">{id}</span> <span className="setup-missing">not in inventory</span></div>
                {editing && <button className="btn-ghost sm danger" onClick={() => setList('item_ids', (l) => l.filter((x) => x !== id))}>✕</button>}
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="modal-actions">
            <button className="btn-danger" onClick={del}>Delete protocol</button>
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
export default function ProtocolsView({ protocols, items, itemByCode, isAdmin, open, setOpen, onChanged, onGoToItem }) {
  const [catFilter, setCatFilter] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const groups = useMemo(
    () => Array.from(new Set(protocols.map((p) => p.category).filter(Boolean)))
      .sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b)),
    [protocols]
  );

  const shown = useMemo(() => {
    let list = protocols;
    if (catFilter) list = list.filter((p) => (p.category || 'Other') === catFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) => {
        if ((p.title || '').toLowerCase().includes(needle)) return true;
        if ((p.purpose || '').toLowerCase().includes(needle)) return true;
        return arr(p.item_ids).some((id) => {
          if (id.toLowerCase().includes(needle)) return true;
          const it = itemByCode(id);
          return it && (it.name || '').toLowerCase().includes(needle);
        });
      });
    }
    return list;
  }, [protocols, catFilter, q, itemByCode]);

  const byCat = useMemo(() => {
    const g = {};
    shown.forEach((p) => { (g[p.category || 'Other'] ||= []).push(p); });
    Object.values(g).forEach((a) => a.sort((x, y) => (x.sort_order ?? 999) - (y.sort_order ?? 999) || (x.title || '').localeCompare(y.title || '')));
    return Object.entries(g).sort((a, b) => catRank(a[0]) - catRank(b[0]) || a[0].localeCompare(b[0]));
  }, [shown]);

  const openProto = open ? protocols.find((p) => p.id === open.id) : null;

  return (
    <>
      <div className="order-toolbar">
        <div className="count">{protocols.length} protocol{protocols.length === 1 ? '' : 's'}</div>
        <div className="spacer" />
        {isAdmin && <button className="btn-primary" onClick={() => setAdding(true)}>+ Add protocol</button>}
      </div>

      <div className="proto-searchbar">
        <input className="search" placeholder="Search protocols, materials, or item IDs…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {groups.length > 0 && (
        <div className="setup-groupbar">
          <button className={!catFilter ? 'grpbtn on' : 'grpbtn'} onClick={() => setCatFilter('')}>All</button>
          {groups.map((g) => (
            <button key={g} className={catFilter === g ? 'grpbtn on' : 'grpbtn'} onClick={() => setCatFilter(g)}>{g}</button>
          ))}
        </div>
      )}

      {protocols.length === 0 ? (
        <div className="empty">
          No protocols yet.{isAdmin ? <> Tap <b>+ Add protocol</b> — or run <b>06_protocols.sql</b> in Supabase to load the starter manual.</> : ' An admin can add the first one.'}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">No protocols match your search.</div>
      ) : (
        byCat.map(([cat, list]) => (
          <div className="cat-group" key={cat}>
            <div className="cat-header setup-grouphead">{cat} <span className="cat-count">{list.length}</span></div>
            <div className="proto-list">
              {list.map((p) => {
                const nSteps = arr(p.steps).length;
                const nItems = arr(p.item_ids).length;
                return (
                  <div className="proto-row" key={p.id} onClick={() => setOpen({ id: p.id })}>
                    <div className="proto-row-main">
                      <div className="proto-row-title">{p.title}</div>
                      {p.purpose && <div className="proto-row-sub">{p.purpose}</div>}
                    </div>
                    <div className="proto-row-chips">
                      {nSteps > 0 && <span className="chip protochip">{nSteps} steps</span>}
                      {nItems > 0 && <span className="chip setchip">{nItems} item{nItems === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {adding && (
        <AddProtocolModal groups={groups.length ? groups : CAT_ORDER} onClose={() => setAdding(false)}
          onCreated={async (row) => { setAdding(false); await onChanged(); setOpen({ id: row.id, edit: true }); }} />
      )}

      {openProto && (
        <ProtocolDetail key={openProto.id} proto={openProto} items={items} itemByCode={itemByCode}
          groups={groups.length ? groups : CAT_ORDER} isAdmin={isAdmin} autoEdit={!!open.edit}
          onClose={() => setOpen(null)} onChanged={onChanged} onGoToItem={onGoToItem} />
      )}
    </>
  );
}
