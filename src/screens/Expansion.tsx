import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { isOfficer } from '../lib/roles';
import type { Resource, Stage } from '../lib/types';
import { Confirm, Modal, Page, num } from '../components/ui';

const pct = (have: number, goal: number) => (goal > 0 ? Math.min(100, (have / goal) * 100) : have > 0 ? 100 : 0);

function Bar({ have, goal }: { have: number; goal: number }) {
  const p = pct(have, goal);
  return <span className={`bar ${p >= 100 ? 'is-full' : ''}`} role="img" aria-label={`${Math.floor(p)} percent`}><span style={{ width: `${p}%` }} /></span>;
}

/** A stage's progress: the average of its resources, so one big number (gold) does not drown out the rest. */
const stagePct = (rs: { have: number; goal: number }[]) => (rs.length ? rs.reduce((s, r) => s + pct(r.have, r.goal), 0) / rs.length : 0);

function StageBar({ label, value }: { label: string; value: number }) {
  return (
    <div className={`stagebar ${value >= 100 ? 'is-full' : ''}`} role="img" aria-label={`${label}: ${Math.floor(value)} percent gathered`}>
      <span className="stagebar__track"><span style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="stagebar__pct">{Math.floor(value)}<small>%</small></span>
    </div>
  );
}

/** The "have" number. Officers type straight into it; it saves when they leave the field. */
function Have({ r, canEdit, onSave }: { r: Resource; canEdit: boolean; onSave: (id: string, have: number) => Promise<void> }) {
  const [text, setText] = useState(String(r.have)); const [state, setState] = useState<'' | 'saving' | 'error'>('');
  useEffect(() => setText(String(r.have)), [r.have]);
  if (!canEdit) return <span className="res__have">{num(r.have)}</span>;
  const commit = async () => {
    const v = Math.max(0, Math.round(Number(text.replace(/[^\d.]/g, '')) || 0));
    setText(String(v));
    if (v === r.have) return;
    setState('saving');
    try { await onSave(r.id, v); setState(''); } catch { setState('error'); }
  };
  return (
    <input className={`res__input ${state ? `is-${state}` : ''}`} type="text" inputMode="numeric" value={text} aria-label={`${r.name} gathered`}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

interface Draft { id?: string; name: string; unit: string; note: string; goal: string; in_total: boolean }

function StageEditor({ stage, resources, nextSort, onClose, onSaved }: {
  stage: Stage | null; resources: Resource[]; nextSort: number; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(stage?.title ?? ''); const [details, setDetails] = useState(stage?.details ?? '');
  const [rows, setRows] = useState<Draft[]>(resources.map((r) => ({ id: r.id, name: r.name, unit: r.unit, note: r.note, goal: String(r.goal), in_total: r.in_total })));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [removing, setRemoving] = useState(false);
  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      let stageId = stage?.id;
      if (stage) { const { error } = await supabase.from('expansion_stages').update({ title: title.trim(), details }).eq('id', stage.id); if (error) throw error; }
      else { const { data, error } = await supabase.from('expansion_stages').insert({ title: title.trim(), details, sort: nextSort }).select().single(); if (error) throw error; stageId = data.id; }
      const keep = new Set(rows.map((r) => r.id).filter(Boolean));
      const gone = resources.filter((r) => !keep.has(r.id)).map((r) => r.id);
      if (gone.length) { const { error } = await supabase.from('expansion_resources').delete().in('id', gone); if (error) throw error; }
      for (const [i, r] of rows.entries()) {
        if (!r.name.trim()) continue;
        const row = { name: r.name.trim(), unit: r.unit.trim(), note: r.note.trim(), goal: Math.max(0, Math.round(Number(r.goal) || 0)), in_total: r.in_total, sort: i + 1 };
        const { error } = r.id ? await supabase.from('expansion_resources').update(row).eq('id', r.id) : await supabase.from('expansion_resources').insert({ ...row, stage_id: stageId });
        if (error) throw error;
      }
      onSaved(); onClose();
    } catch (err) { setError((err as { message: string }).message); } finally { setBusy(false); }
  };

  if (removing && stage) {
    return (
      <Confirm title="Remove this stage" action="Remove stage" danger busy={busy} onClose={() => setRemoving(false)}
        onConfirm={async () => { setBusy(true); await supabase.from('expansion_stages').delete().eq('id', stage.id); onSaved(); onClose(); }}>
        <p>“{stage.title}” and its gathered counts will be removed.</p>
      </Confirm>
    );
  }
  return (
    <Modal title={stage ? 'Edit stage' : 'New stage'} onClose={onClose} wide>
      <form onSubmit={save}>
        <label className="field"><span>Stage name</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
        <label className="field"><span>Details</span><textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={4000} style={{ minHeight: 70 }} /></label>
        <span className="label">What it takes</span>
        <div className="resedit">
          {rows.map((r, i) => (
            <div className="resedit__row" key={r.id ?? `new-${i}`}>
              <input className="input" type="text" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Resource" aria-label="Resource" maxLength={60} />
              <input className="input" type="text" inputMode="numeric" value={r.goal} onChange={(e) => set(i, { goal: e.target.value.replace(/[^\d]/g, '') })} placeholder="Goal" aria-label="Goal" />
              <input className="input" type="text" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder="Unit" aria-label="Unit" maxLength={24} />
              <input className="input" type="text" value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note" aria-label="Note" maxLength={120} />
              <label className="check small" title="Count this resource in the grand total"><input type="checkbox" checked={r.in_total} onChange={(e) => set(i, { in_total: e.target.checked })} />In total</label>
              <button type="button" className="btn btn--small btn--ghost" aria-label={`Remove ${r.name || 'row'}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--small" onClick={() => setRows((rs) => [...rs, { name: '', unit: '', note: '', goal: '', in_total: true }])}>Add a resource</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          {stage && <button type="button" className="btn btn--danger" onClick={() => setRemoving(true)}>Remove stage</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--go" disabled={busy}>Save stage</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Expansion() {
  const { profile } = useAuth(); const officer = isOfficer(profile!.tags);
  const [stages, setStages] = useState<Stage[] | null>(null); const [resources, setResources] = useState<Resource[]>([]);
  const [editing, setEditing] = useState<Stage | 'new' | null>(null); const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([supabase.from('expansion_stages').select('*').order('sort'), supabase.from('expansion_resources').select('*').order('sort')]);
    if (s.error || r.error) return setError('Could not load the expansion goals. Check your connection and try again.');
    setError(''); setStages(s.data as Stage[]); setResources(r.data as Resource[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveHave = async (id: string, have: number) => {
    const { data, error } = await supabase.from('expansion_resources').update({ have }).eq('id', id).select();
    if (error || !data?.length) throw new Error('not saved');
    setResources((rs) => rs.map((r) => (r.id === id ? { ...r, have } : r)));
  };

  const totals = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; goal: number; have: number }>();
    for (const r of resources) {
      if (!r.in_total) continue;
      const t = map.get(r.name) ?? { name: r.name, unit: r.unit, goal: 0, have: 0 };
      t.goal += r.goal; t.have += r.have; map.set(r.name, t);
    }
    return [...map.values()];
  }, [resources]);
  const overall = stagePct(totals);

  return (
    <Page title="Expansion Goals" sub="What Largashbur needs, stage by stage" width="wide"
      bar={officer && <button className="btn btn--go" onClick={() => setEditing('new')}>Add a stage</button>}>
      {error && <p className="error" role="alert">{error}</p>}
      {!stages && !error && <p className="empty">Counting the stores…</p>}
      {stages && (
        <>
          {officer && <p className="hint stages__hint">Tap any gathered number to update it. It saves when you leave the field.</p>}
          <div className="stages">
            {stages.map((s) => {
              const rs = resources.filter((r) => r.stage_id === s.id);
              const done = rs.length > 0 && rs.every((r) => r.have >= r.goal);
              const gathered = stagePct(rs);
              return (
                <section key={s.id} className={`panel stage ${done ? 'is-done' : ''}`}>
                  <div className="panel__head">
                    <h2 className="panel__title">{s.title}</h2>
                    {done ? <span className="stage__done">Ready to build</span> : officer && <button className="btn btn--small" onClick={() => setEditing(s)}>Edit</button>}
                  </div>
                  <StageBar label={s.title} value={gathered} />
                  <div className="panel__body">
                    {s.details && <p className="muted" style={{ marginBottom: 10 }}>{s.details}</p>}
                    {rs.length === 0 && <p className="muted">Nothing listed yet.</p>}
                    {rs.map((r) => (
                      <div className="res" key={r.id}>
                        <div className="res__name">{r.name}{r.note && <small>{r.note}</small>}</div>
                        <div className="res__count"><Have r={r} canEdit={officer} onSave={saveHave} /><span className="res__goal">of {num(r.goal)}{r.unit ? ` ${r.unit}` : ''}</span></div>
                        <Bar have={r.have} goal={r.goal} />
                      </div>
                    ))}
                    {done && officer && <div className="row row--end" style={{ marginTop: 8 }}><button className="btn btn--small" onClick={() => setEditing(s)}>Edit</button></div>}
                  </div>
                </section>
              );
            })}
            <section className="panel stage stage--total">
              <div className="panel__head"><h2 className="panel__title">Total</h2></div>
              <StageBar label="Every stage together" value={overall} />
              <div className="panel__body">
                {totals.map((t) => (
                  <div className="res" key={t.name}>
                    <div className="res__name">{t.name}</div>
                    <div className="res__count"><span className="res__have">{num(t.have)}</span><span className="res__goal">of {num(t.goal)}{t.unit ? ` ${t.unit}` : ''}</span></div>
                    <Bar have={t.have} goal={t.goal} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
      {editing && <StageEditor stage={editing === 'new' ? null : editing} resources={editing === 'new' ? [] : resources.filter((r) => r.stage_id === editing.id)}
        nextSort={(stages?.length ?? 0) + 1} onClose={() => setEditing(null)} onSaved={load} />}
    </Page>
  );
}
