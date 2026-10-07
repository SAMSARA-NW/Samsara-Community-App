import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { supabase } from '../../../lib/supabase.js';
import { MONTH_SHORT } from '../../../lib/vg/constants.js';
import { formatDate, capitalize } from '../../../lib/vg/helpers.js';
import { useAuthSession } from '../../../hooks/useAuthSession.js';

// ─── Schema: vg_livestock_monthly ────────────────────────────────────────
// We use one row per (year, month, animal_type, category).
// For sheep: categories = ewes, rams, lambs
// Extra fields: births, deaths, slaughtered, sold, purchased, pregnant (via notes or new col)
// But the current table has: opening_count, births, deaths, slaughtered, sold, purchased, closing_count, notes
//
// To match the spreadsheet, we aggregate per-month across categories.
// Each row = one category in one month. The table view sums them.

const SHEEP_COLS = [
  { key: 'total', label: 'Total', computed: true, color: '#6b7f5e' },
  { key: 'ewe', label: 'Ewes', color: '#c2a66d' },
  { key: 'ram', label: 'Rams', color: '#8b6f47' },
  { key: 'ewe_lamb', label: 'Ewe Lambs', color: '#8fb88f' },
  { key: 'ram_lamb', label: 'Ram Lambs', color: '#9eba9e' },
  { key: 'births', label: 'Births', color: '#5a7a5a' },
  { key: 'pregnant', label: 'Pregnant', color: '#b89a6b' },
  { key: 'slaughtered', label: 'Slaughter', color: '#8b4a4a' },
  { key: 'deaths', label: 'Deaths', color: '#6b4a4a' },
  { key: 'sold', label: 'Sold', color: '#4a6b8b' },
];

const CATTLE_COLS = [
  { key: 'opening', label: 'Opening', computed: true, color: '#7a8f9e' },
  { key: 'total', label: 'Closing', computed: true, color: '#6b7f5e' },
  { key: 'cow', label: 'Cows', color: '#c2a66d' },
  { key: 'bull', label: 'Bulls', color: '#8b6f47' },
  { key: 'calf', label: 'Calves', color: '#8fb88f' },
  { key: 'births', label: 'Births', color: '#5a7a5a' },
  { key: 'slaughtered', label: 'Slaughter', color: '#8b4a4a' },
  { key: 'deaths', label: 'Deaths', color: '#6b4a4a' },
  { key: 'sold', label: 'Sold', color: '#4a6b8b' },
];

function emptyRow(m) {
  return { month: m, opening: 0, ewe: 0, ram: 0, lamb: 0, ewe_lamb: 0, ram_lamb: 0, cow: 0, bull: 0, calf: 0, births: 0, pregnant: 0, slaughtered: 0, deaths: 0, sold: 0 };
}

function aggregateYear(data) {
  // data = array of vg_livestock_monthly rows for a given year + animal_type
  const months = {};
  for (let m = 1; m <= 12; m++) months[m] = emptyRow(m);

  for (const row of (data || [])) {
    const m = row.month;
    if (!months[m]) months[m] = emptyRow(m);
    const cat = row.category; // 'ewe', 'ram', 'lamb', 'cow', 'bull', 'calf'
    months[m][cat] = row.closing_count || 0;
    months[m].opening += row.opening_count || 0;
    months[m].births += row.births || 0;
    months[m].slaughtered += row.slaughtered || 0;
    months[m].deaths += row.deaths || 0;
    months[m].sold += row.sold || 0;
    // Use notes field for pregnant count (stored as "pregnant:14")
    if (row.notes) {
      const pregMatch = row.notes.match(/pregnant:(\d+)/i);
      if (pregMatch) months[m].pregnant = Number(pregMatch[1]);
    }
  }
  return Object.values(months).sort((a, b) => a.month - b.month);
}

// ─── Inline Editable Cell ──────────────────────────────────────────────

function EditableCell({ value, onChange, disabled }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  if (disabled) {
    return <span className="text-[rgba(75,71,65,0.35)]">{value || '—'}</span>;
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className="cursor-pointer hover:bg-[rgba(122,112,94,0.08)] rounded px-1 py-0.5 transition-colors min-w-[28px] inline-block text-center"
      >
        {value || '—'}
      </span>
    );
  }

  return (
    <input
      type="number"
      min="0"
      autoFocus
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { setEditing(false); onChange(Number(local) || 0); }}
      onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onChange(Number(local) || 0); } if (e.key === 'Escape') { setEditing(false); setLocal(value); } }}
      className="w-14 bg-white border border-[rgba(107,127,94,0.4)] rounded px-1 py-0.5 text-center text-[0.8rem] outline-none"
    />
  );
}

// ─── Year Table ──────────────────────────────────────────────────────────

function YearTable({ animalType, year, rows, onSave, onEditEvent }) {
  const cols = animalType === 'sheep' ? SHEEP_COLS : CATTLE_COLS;
  const categories = animalType === 'sheep' ? ['ewe', 'ram', 'ewe_lamb', 'ram_lamb'] : ['cow', 'bull', 'calf'];

  function getTotal(row) {
    // Headcount totals only include the live animal categories shown in the table.
    // Informational event columns (and the legacy unsplit lamb field) are excluded.
    return categories.reduce((sum, category) => sum + (row[category] || 0), 0);
  }

  return (
    <div className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-[0.6rem] uppercase tracking-[0.12em] text-[rgba(75,71,65,0.5)] bg-[rgba(248,244,236,0.9)]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold border-b border-[rgba(122,112,94,0.12)] w-16">Month</th>
              {cols.map(col => (
                <th key={col.key} className="px-3 py-3 text-center font-semibold border-b border-[rgba(122,112,94,0.12)]">
                  <span style={{ color: col.color }}>{col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const total = getTotal(row);
              const hasData = total > 0 || row.births > 0;
              return (
                <tr key={row.month} className={`border-b border-[rgba(122,112,94,0.06)] ${hasData ? '' : 'opacity-50'} hover:bg-[rgba(122,112,94,0.03)]`}>
                  <td className="px-4 py-2.5 font-medium text-[0.78rem] text-[#2b2b2b]">{MONTH_SHORT[row.month - 1]}</td>
                  {cols.map(col => {
                    if (col.computed) {
                      return (
                        <td key={col.key} className="px-3 py-2.5 text-center">
                          <span className="font-semibold text-[#6b7f5e] text-[0.85rem] bg-[rgba(107,127,94,0.08)] rounded px-2 py-0.5">
                            {col.key === 'opening' ? row.opening : total}
                          </span>
                        </td>
                      );
                    }
                    const val = row[col.key] || 0;
                    return (
                      <td key={col.key} className="px-3 py-2.5 text-center text-[0.82rem]">
                        {animalType === 'cattle' && ['births', 'slaughtered', 'deaths', 'sold'].includes(col.key) ? (
                          <button className="bg-transparent p-1 shadow-none text-inherit" onClick={() => onEditEvent(row.month, col.key)} aria-label={`Edit ${col.label} for ${MONTH_SHORT[row.month - 1]}`}>
                            {val || '—'}
                          </button>
                        ) : <EditableCell value={val} onChange={(newVal) => onSave(row.month, col.key, newVal)} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Events belong to a sex/category, not automatically to cows. Edit each category
 * separately so a bull sale/birth preserves the cow count and the generated balance.
 */
function CattleEventEditor({ event, data, year, onClose, onSaved }) {
  const categories = ['cow', 'bull', 'calf'];
  const [category, setCategory] = useState(event.category);
  const existing = (data || []).find(r => r.month === event.month && r.category === category);
  const [value, setValue] = useState(existing?.[event.field] || 0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const labels = { cow: 'Cows', bull: 'Bulls', calf: 'Calves', births: 'Births', deaths: 'Deaths', slaughtered: 'Slaughter', sold: 'Sold' };
  async function save(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const row = { year, month: event.month, animal_type: 'cattle', category, [event.field]: Number(value) };
      const projected = { ...existing, [event.field]: Number(value) };
      const closing = (projected.opening_count || 0) + (projected.births || 0) + (projected.purchased || 0) - (projected.deaths || 0) - (projected.slaughtered || 0) - (projected.sold || 0);
      if (closing < 0) { setError('This event would make the closing count negative. Check the opening count first.'); return; }
      const result = existing
        ? await supabase.from('vg_livestock_monthly').update({ [event.field]: Number(value) }).eq('id', existing.id)
        : await supabase.from('vg_livestock_monthly').upsert(row, { onConflict: 'year,month,animal_type,category' });
      if (result.error) throw result.error;
      onSaved(); onClose();
    } catch { setError('Could not save the event. Please retry.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <form role="dialog" aria-modal="true" aria-label="Edit cattle event" onSubmit={save} className="bg-[#fffaf2] rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2>{labels[event.field]} · {MONTH_SHORT[event.month - 1]} {year}</h2>
        <label className="block">Category
          <select className="block w-full p-2" value={category} onChange={e => {
            setCategory(e.target.value);
            setValue((data || []).find(r => r.month === event.month && r.category === e.target.value)?.[event.field] || 0);
          }}>{categories.map(c => <option key={c} value={c}>{labels[c]}</option>)}</select>
        </label>
        <label className="block">Count for this category
          <input className="block w-full p-2" type="number" min="0" step="1" required value={value} onChange={e => setValue(e.target.value)} />
        </label>
        <p className="text-xs">This adjusts the selected category’s closing count. Sale revenue is recorded separately under Produce.</p>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-3"><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </div>
  );
}

// ─── Registry section (simplified) ────────────────────────────────────

function RegistrySection({ animalType }) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tag_id: '', name: '', category: '', birth_date: '', status: 'active', notes: '' });
  const qc = useQueryClient();

  const categories = animalType === 'sheep' ? ['ewe', 'ram', 'ewe_lamb', 'ram_lamb'] : ['cow', 'bull', 'calf'];

  const { data: animals } = useQuery({
    queryKey: ['vg', 'registry', animalType],
    queryFn: () => supabase.from('vg_livestock_registry').select('*').eq('animal_type', animalType).order('created_at', { ascending: false }).then(r => r.data || []),
    enabled: open,
  });

  async function saveAnimal(e) {
    e.preventDefault();
    const row = { ...form, animal_type: animalType };
    await supabase.from('vg_livestock_registry').insert(row);
    qc.invalidateQueries({ queryKey: ['vg', 'registry', animalType] });
    setShowForm(false);
    setForm({ tag_id: '', name: '', category: categories[0], birth_date: '', status: 'active', notes: '' });
  }

  return (
    <section className="mt-6">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 bg-transparent shadow-none text-[0.7rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.6)] hover:text-[rgba(43,43,43,0.8)] rounded-none px-0 py-0 hover:scale-100">
        <span>{open ? '▾' : '▸'}</span> Individual Registry
      </button>
      {open && (
        <div className="mt-3 rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(122,112,94,0.1)]">
            <p className="text-[0.68rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.5)]">{(animals || []).length} animals</p>
            <button onClick={() => { setForm(f => ({ ...f, category: categories[0] })); setShowForm(true); }} className="rounded-full px-4 py-1.5 text-[0.62rem] uppercase tracking-[0.1em] bg-[rgba(107,127,94,0.85)] text-white shadow-none hover:scale-100">+ Add</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[0.6rem] uppercase tracking-[0.12em] text-[rgba(75,71,65,0.5)] bg-[rgba(248,244,236,0.8)]">
                <tr>
                  {['Tag ID', 'Name', 'Category', 'Status', 'Notes'].map(h => (
                    <th key={h} className="px-4 py-2 text-left font-semibold border-b border-[rgba(122,112,94,0.1)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(animals || []).map((a, i) => (
                  <tr key={a.id} className="border-b border-[rgba(122,112,94,0.06)] hover:bg-[rgba(122,112,94,0.03)]">
                    <td className="px-4 py-2.5 text-[0.8rem] font-medium">{a.tag_id || '—'}</td>
                    <td className="px-4 py-2.5 text-[0.8rem]">{a.name || '—'}</td>
                    <td className="px-4 py-2.5 text-[0.8rem]">{capitalize(a.category)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.58rem] uppercase tracking-wide font-semibold ${a.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[0.8rem] text-[rgba(75,71,65,0.6)] max-w-[160px] truncate">{a.notes || '—'}</td>
                  </tr>
                ))}
                {!(animals || []).length && <tr><td colSpan={5} className="px-4 py-8 text-center text-[0.8rem] text-[rgba(75,71,65,0.4)]">No animals registered</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(44,42,37,0.4)] backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <form onSubmit={saveAnimal} className="bg-[rgba(255,252,247,0.98)] rounded-2xl border border-[rgba(122,112,94,0.2)] p-8 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-light">Add Animal</h2>
              <button type="button" onClick={() => setShowForm(false)} className="bg-transparent p-0 text-2xl text-[rgba(75,71,65,0.4)] shadow-none rounded-none hover:scale-100">×</button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[['Tag ID', 'tag_id'], ['Name', 'name']].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-[0.62rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.55)] mb-1">{label}</label>
                  <input type="text" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full bg-transparent border-0 border-b border-[rgba(122,112,94,0.3)] px-0 py-2 text-[0.85rem] outline-none" />
                </div>
              ))}
              <div>
                <label className="block text-[0.62rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.55)] mb-1">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-transparent border-0 border-b border-[rgba(122,112,94,0.3)] px-0 py-2 text-[0.85rem] outline-none">
                  {categories.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[0.62rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.55)] mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full bg-transparent border-0 border-b border-[rgba(122,112,94,0.3)] px-0 py-2 text-[0.85rem] outline-none">
                  {['active', 'sold', 'deceased', 'slaughtered'].map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
                </select>
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-[0.62rem] uppercase tracking-[0.14em] text-[rgba(75,71,65,0.55)] mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full bg-transparent border border-[rgba(122,112,94,0.2)] rounded-xl px-3 py-2 text-[0.85rem] outline-none resize-none" />
            </div>
            <button type="submit" className="w-full rounded-full py-3 text-[0.7rem] uppercase tracking-[0.14em] bg-[rgba(107,127,94,0.85)] text-white">Save</button>
          </form>
        </div>
      )}
    </section>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function VgAnimals() {
  const { data: session } = useAuthSession();
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [animalType, setAnimalType] = useState('sheep');
  const [eventEdit, setEventEdit] = useState(null);

  const { data: rawData } = useQuery({
    queryKey: ['vg', 'livestock', animalType, year],
    queryFn: () => supabase.from('vg_livestock_monthly')
      .select('*')
      .eq('animal_type', animalType)
      .eq('year', year)
      .then(r => r.data || []),
  });

  const rows = useMemo(() => aggregateYear(rawData), [rawData]);
  const categories = animalType === 'sheep' ? ['ewe', 'ram', 'ewe_lamb', 'ram_lamb'] : ['cow', 'bull', 'calf'];
  const cols = animalType === 'sheep' ? SHEEP_COLS : CATTLE_COLS;

  // Save a cell edit
  const handleSave = useCallback(async (month, field, value) => {
    const userId = session?.user?.id;

    // Determine which category row(s) to update
    if (categories.includes(field)) {
      // It's a category count (ewe/ram/lamb/cow/bull/calf) — update closing_count via opening_count
      // We store the value as opening_count since closing_count is generated
      const existing = (rawData || []).find(r => r.month === month && r.category === field);
      if (existing) {
        await supabase.from('vg_livestock_monthly').update({ opening_count: value - (existing.births || 0) - (existing.purchased || 0) + (existing.deaths || 0) + (existing.slaughtered || 0) + (existing.sold || 0) }).eq('id', existing.id);
      } else {
        await supabase.from('vg_livestock_monthly').upsert({
          year, month, animal_type: animalType, category: field,
          opening_count: value, births: 0, deaths: 0, slaughtered: 0, sold: 0, purchased: 0,
          created_by: userId,
        }, { onConflict: 'year,month,animal_type,category' });
      }
    } else if (['births', 'deaths', 'slaughtered', 'sold'].includes(field)) {
      // These are per-category fields. We store them on the first category row or a special one.
      // Use the first category as the "aggregate" row for these fields
      const primaryCat = categories[0];
      const existing = (rawData || []).find(r => r.month === month && r.category === primaryCat);
      if (existing) {
        await supabase.from('vg_livestock_monthly').update({ [field]: value }).eq('id', existing.id);
      } else {
        await supabase.from('vg_livestock_monthly').upsert({
          year, month, animal_type: animalType, category: primaryCat,
          opening_count: 0, births: 0, deaths: 0, slaughtered: 0, sold: 0, purchased: 0,
          [field]: value,
          created_by: userId,
        }, { onConflict: 'year,month,animal_type,category' });
      }
    } else if (field === 'pregnant') {
      // Store in notes field of first category
      const primaryCat = categories[0];
      const existing = (rawData || []).find(r => r.month === month && r.category === primaryCat);
      const notes = `pregnant:${value}`;
      if (existing) {
        await supabase.from('vg_livestock_monthly').update({ notes }).eq('id', existing.id);
      } else {
        await supabase.from('vg_livestock_monthly').upsert({
          year, month, animal_type: animalType, category: primaryCat,
          opening_count: 0, births: 0, deaths: 0, slaughtered: 0, sold: 0, purchased: 0,
          notes, created_by: userId,
        }, { onConflict: 'year,month,animal_type,category' });
      }
    }
    qc.invalidateQueries({ queryKey: ['vg', 'livestock', animalType, year] });
  }, [rawData, year, animalType, categories, session, qc]);

  // Chart data — only months with data
  const chartData = rows.filter(r => {
    const total = categories.reduce((s, c) => s + (r[c] || 0), 0);
    return total > 0;
  }).map(r => ({
    name: MONTH_SHORT[r.month - 1],
    Total: categories.reduce((s, c) => s + (r[c] || 0), 0),
    Ewes: r.ewe || r.cow || 0,
    Rams: r.ram || r.bull || 0,
    Lambs: (r.lamb || 0) + (r.ewe_lamb || 0) + (r.ram_lamb || 0) || r.calf || 0,
    Births: r.births || 0,
    Pregnant: r.pregnant || 0,
    Slaughter: r.slaughtered || 0,
    Deaths: r.deaths || 0,
    Sold: r.sold || 0,
  }));

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-[rgba(122,112,94,0.12)] bg-[rgba(255,252,247,0.8)] backdrop-blur-sm px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-1">VrischGewagt</p>
            <h1 className="text-xl font-light text-[#2b2b2b] tracking-wide">Animals</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setYear(y => y - 1)} className="rounded-lg px-3 py-1.5 text-sm bg-transparent text-[rgba(75,71,65,0.6)] hover:bg-[rgba(122,112,94,0.1)] shadow-none hover:scale-100">←</button>
            <span className="text-[0.9rem] font-light text-[#2b2b2b] w-16 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="rounded-lg px-3 py-1.5 text-sm bg-transparent text-[rgba(75,71,65,0.6)] hover:bg-[rgba(122,112,94,0.1)] shadow-none hover:scale-100">→</button>
          </div>
        </div>
        <div className="flex gap-2">
          {['sheep', 'cattle'].map(t => (
            <button key={t} onClick={() => setAnimalType(t)}
              className={`rounded-full px-4 py-1.5 text-[0.68rem] uppercase tracking-[0.12em] transition-all shadow-none hover:scale-100 ${
                animalType === t ? 'bg-[rgba(122,112,94,0.18)] text-[rgba(43,43,43,0.9)]' : 'bg-transparent text-[rgba(75,71,65,0.5)] hover:bg-[rgba(122,112,94,0.08)]'
              }`}>{t === 'sheep' ? '🐑 Sheep' : '🐄 Cattle'}</button>
          ))}
        </div>
      </div>

      <div className="p-6 max-w-6xl space-y-8">
        {/* Year table */}
        <section>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-4">
            {animalType === 'sheep' ? '🐑' : '🐄'} {capitalize(animalType)} — {year} · Click any cell to edit
          </p>
          <YearTable animalType={animalType} year={year} rows={rows} onSave={handleSave} onEditEvent={(month, field) => {
            const recorded = (rawData || []).find(r => r.month === month && r[field] > 0);
            setEventEdit({ month, field, category: recorded?.category || 'cow' });
          }} />
          {animalType === 'cattle' && <p className="text-xs mt-3 text-[rgba(75,71,65,0.6)]">Opening + births + purchases − deaths − slaughter − sold = closing. Current month shows the latest recorded count.</p>}
          {eventEdit && <CattleEventEditor event={eventEdit} data={rawData} year={year} onClose={() => setEventEdit(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['vg', 'livestock', animalType, year] })} />}
        </section>

        {/* Line chart — total headcount trend */}
        {chartData.length > 0 && (
          <section>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-4">Total Headcount — Month to Month</p>
            <div className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(122,112,94,0.1)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(122,112,94,0.2)', borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em' }} />
                    <Line type="monotone" dataKey="Total" stroke="#6b7f5e" strokeWidth={2.5} dot={{ r: 4, fill: '#6b7f5e' }} />
                    <Line name={animalType === 'cattle' ? 'Cows' : 'Ewes'} type="monotone" dataKey="Ewes" stroke="#c2a66d" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                    <Line name={animalType === 'cattle' ? 'Bulls' : 'Rams'} type="monotone" dataKey="Rams" stroke="#8b6f47" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                    {chartData.some(d => d.Lambs > 0) && <Line name={animalType === 'cattle' ? 'Calves' : 'Lambs'} type="monotone" dataKey="Lambs" stroke="#8fb88f" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />}
                    {chartData.some(d => d.Pregnant > 0) && <Line type="monotone" dataKey="Pregnant" stroke="#b89a6b" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="2 3" />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}

        {/* Bar chart — events (births, slaughter, deaths, sold) */}
        {chartData.length > 0 && (
          <section>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-4">Events — Births · Slaughter · Deaths · Sold</p>
            <div className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(122,112,94,0.12)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                    <Tooltip contentStyle={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(122,112,94,0.2)', borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em' }} />
                    <Bar dataKey="Births" fill="#5a7a5a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Slaughter" fill="#8b4a4a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Deaths" fill="#6b4a4a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Sold" fill="#4a6b8b" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}

        {/* Registry */}
        <RegistrySection animalType={animalType} />
      </div>
    </div>
  );
}
