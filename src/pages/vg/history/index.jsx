import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { fetchHistoryRows } from '../../../lib/vg/historyApi.js';

import { formatCurrency } from '../../../lib/vg/helpers.js';
import { useIsAdmin } from '../hooks/useCurrentMember.js';
import { MONTH_SHORT } from '../../../lib/vg/constants.js';
import { buildAccommCalendarData, buildMonthlyData } from './historyData.js';

const PRODUCE_COLORS = { olive_oil: '#6b7f5e', olives: '#8b9e6b', meat: '#c2a66d', other: '#9e8b6b' };
const PRODUCE_KEYS = ['olive_oil','olives','meat','other'];
const PRODUCE_LABELS = { olive_oil: 'Olive Oil', olives: 'Olives', meat: 'Meat', other: 'Other' };

const ALL_SECTIONS = [
  { key: 'total', title: 'Farm Total', showRevenue: true },
  { key: 'farm_produce', title: 'Farm Produce', special: 'produce' },
  { key: 'accommodation', title: 'Accommodation', special: 'accommodation' },
  { key: 'staff', title: 'Costs (Staff + Maintenance)', showRevenue: false },
];

export default function VgHistory() {
  const isAdmin = useIsAdmin();
  const [year, setYear] = useState(new Date().getFullYear());

  const [sectionOrder, setSectionOrder] = useState(ALL_SECTIONS.map(s => s.key));
  const [collapsed, setCollapsed] = useState({});
  const [visibleProduce, setVisibleProduce] = useState(Object.fromEntries(PRODUCE_KEYS.map(k => [k, true])));

  function moveUp(idx) {
    if (idx === 0) return;
    setSectionOrder(o => { const a = [...o]; [a[idx-1], a[idx]] = [a[idx], a[idx-1]]; return a; });
  }
  function moveDown(idx) {
    setSectionOrder(o => { if (idx >= o.length-1) return o; const a = [...o]; [a[idx], a[idx+1]] = [a[idx+1], a[idx]]; return a; });
  }
  function toggleCollapse(key) {
    setCollapsed(c => ({ ...c, [key]: !c[key] }));
  }

  // Filter the chosen year on the server and paginate; never turn a failed read into zeros.
  const salesQuery = useQuery({
    queryKey: ['vg', 'history', 'sales', year],
    queryFn: () => fetchHistoryRows('sales', year), enabled: isAdmin,
  });
  const expensesQuery = useQuery({
    queryKey: ['vg', 'history', 'expenses', year],
    queryFn: () => fetchHistoryRows('expenses', year), enabled: isAdmin,
  });
  const bookingsQuery = useQuery({
    queryKey: ['vg', 'history', 'bookings', year],
    queryFn: () => fetchHistoryRows('bookings', year), enabled: isAdmin,
  });
  const accommQuery = useQuery({
    queryKey: ['vg', 'history', 'accomm_hist', year],
    queryFn: () => fetchHistoryRows('accommodation', year), enabled: isAdmin,
  });
  const unitCostsQuery = useQuery({
    queryKey: ['vg', 'history', 'unitCosts', year],
    queryFn: () => fetchHistoryRows('unitCosts', year), enabled: isAdmin,
  });
  const staffLogsQuery = useQuery({
    queryKey: ['vg', 'history', 'staffLogs', year],
    queryFn: () => fetchHistoryRows('staffLogs', year), enabled: isAdmin,
  });
  const sales = salesQuery.data;
  const expenses = expensesQuery.data;
  const unitCosts = unitCostsQuery.data;
  const staffLogs = staffLogsQuery.data;
  const accommData = buildAccommCalendarData(accommQuery.data, year, bookingsQuery.data);
  const sectionQueries = {
    total: [salesQuery, expensesQuery, bookingsQuery, accommQuery, unitCostsQuery, staffLogsQuery],
    farm_produce: [salesQuery],
    accommodation: [accommQuery, bookingsQuery],
    staff: [staffLogsQuery, unitCostsQuery],
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen">
        <div className="border-b border-[rgba(122,112,94,0.12)] bg-[rgba(255,252,247,0.8)] backdrop-blur-sm px-6 py-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-1">VrischGewagt</p>
          <h1 className="text-xl font-light text-[#2b2b2b] tracking-wide">History</h1>
        </div>
        <div className="p-6">
          <p className="text-[0.85rem] text-[rgba(75,71,65,0.5)] italic">Financial history is restricted to administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-[rgba(122,112,94,0.12)] bg-[rgba(255,252,247,0.8)] backdrop-blur-sm px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(75,71,65,0.45)] mb-1">VrischGewagt</p>
            <h1 className="text-xl font-light text-[#2b2b2b] tracking-wide">History</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setYear(y => y - 1)} className="rounded-lg px-3 py-1.5 text-sm bg-transparent text-[rgba(75,71,65,0.6)] hover:bg-[rgba(122,112,94,0.1)] shadow-none hover:scale-100">←</button>
            <span className="text-[0.9rem] font-light text-[#2b2b2b] w-16 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="rounded-lg px-3 py-1.5 text-sm bg-transparent text-[rgba(75,71,65,0.6)] hover:bg-[rgba(122,112,94,0.1)] shadow-none hover:scale-100">→</button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl space-y-5">
        {sectionOrder.map((key, idx) => {
          const section = ALL_SECTIONS.find(s => s.key === key);
          if (!section) return null;
          const isCollapsed = !!collapsed[key];
          const queries = sectionQueries[key];
          const failed = queries.some(q => q.isError);
          const loading = queries.some(q => q.isPending);
          const hasData = key === 'accommodation' ? accommData.some(m => m.revenue !== null)
            : key === 'total' ? accommData.some(m => m.revenue !== null) || [sales, expenses, unitCosts, staffLogs].some(rows => rows?.length)
            : queries.some(q => q.data?.length);
          if (failed || loading || !hasData) {
            return (
              <div key={key} className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(75,71,65,0.6)] font-semibold mb-4">{section.title}</p>
                <p role={failed ? 'alert' : 'status'} className="text-sm text-[rgba(75,71,65,0.6)]">
                  {failed ? 'Could not load history. Please retry.' : loading ? 'Loading history…' : `No records for ${year}.`}
                </p>
                {failed && <button onClick={() => queries.forEach(q => q.refetch())} className="mt-3 text-sm">Retry</button>}
              </div>
            );
          }


          if (section.special === 'produce') {
            const produceChartData = Array.from({ length: 12 }, (_, i) => {
              const month = i + 1;
              const monthStr = String(month).padStart(2, '0');
              const from = `${year}-${monthStr}-01`;
              const to = `${year}-${monthStr}-31`;
              const inMonth = (dateStr) => dateStr >= from && dateStr <= to;
              const entry = { name: MONTH_SHORT[i] };
              for (const cat of PRODUCE_KEYS) {
                entry[cat] = (sales || []).filter(s => inMonth(s.date) && s.vg_products?.category === cat).reduce((t, s) => t + s.sell_price_actual * s.units, 0);
              }
              return entry;
            });

            return (
              <div key={key} className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => toggleCollapse(key)} className="text-[0.75rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.5)] hover:scale-100 mr-1">{isCollapsed ? '▶' : '▼'}</button>
                  <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(75,71,65,0.6)] font-semibold flex-1">{section.title}</p>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↑</button>
                    <button onClick={() => moveDown(idx)} disabled={idx === sectionOrder.length-1} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↓</button>
                  </div>
                </div>
                {!isCollapsed && (
                  <>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {PRODUCE_KEYS.map(cat => {
                        const on = visibleProduce[cat];
                        return (
                          <button key={cat} onClick={() => setVisibleProduce(v => ({ ...v, [cat]: !v[cat] }))}
                            className={`rounded-full px-3 py-1 text-[0.62rem] uppercase tracking-[0.1em] transition-all shadow-none hover:scale-100 ${on ? 'text-white' : 'text-[rgba(75,71,65,0.5)] bg-transparent border border-[rgba(122,112,94,0.2)]'}`}
                            style={on ? { background: PRODUCE_COLORS[cat] } : {}}>
                            {PRODUCE_LABELS[cat]}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={produceChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(122,112,94,0.12)" />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} tickFormatter={v => v >= 1000 ? `R${(v/1000).toFixed(0)}k` : `R${v}`} />
                          <Tooltip contentStyle={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(122,112,94,0.2)', borderRadius: 12, fontSize: 12 }} formatter={v => formatCurrency(v)} />
                          <Legend wrapperStyle={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                          {PRODUCE_KEYS.filter(cat => visibleProduce[cat]).map(cat => (
                            <Line key={cat} type="monotone" dataKey={cat} stroke={PRODUCE_COLORS[cat]} strokeWidth={2} dot={false} name={PRODUCE_LABELS[cat]} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </div>
            );
          }

          // Accommodation section — uses vg_accomm_sales_history
          if (section.special === 'accommodation') {
            return (
              <div key={key} className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => toggleCollapse(key)} className="text-[0.75rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.5)] hover:scale-100 mr-1">{isCollapsed ? '▶' : '▼'}</button>
                  <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(75,71,65,0.6)] font-semibold flex-1">{section.title}</p>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↑</button>
                    <button onClick={() => moveDown(idx)} disabled={idx === sectionOrder.length-1} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↓</button>
                  </div>
                </div>
                {!isCollapsed && (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={accommData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(122,112,94,0.12)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} tickFormatter={v => v >= 1000 ? `R${(v/1000).toFixed(0)}k` : `R${v}`} />
                        <Tooltip contentStyle={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(122,112,94,0.2)', borderRadius: 12, fontSize: 12 }} formatter={v => formatCurrency(v)} />
                        <Legend wrapperStyle={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                        <Line type="monotone" dataKey="revenue" stroke="#7a8f9e" strokeWidth={2} dot={false} name="Revenue" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            );
          }

          // Standard section
          const data = buildMonthlyData(year, sales, expenses, bookingsQuery.data, unitCosts, staffLogs, section.key, accommData);
          return (
            <div key={key} className="rounded-2xl border border-[rgba(122,112,94,0.2)] bg-[rgba(255,252,247,0.95)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => toggleCollapse(key)} className="text-[0.75rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.5)] hover:scale-100 mr-1">{isCollapsed ? '▶' : '▼'}</button>
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(75,71,65,0.6)] font-semibold flex-1">{section.title}</p>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↑</button>
                  <button onClick={() => moveDown(idx)} disabled={idx === sectionOrder.length-1} className="text-[0.6rem] bg-transparent p-0 shadow-none text-[rgba(75,71,65,0.4)] hover:scale-100 disabled:opacity-20 leading-none">↓</button>
                </div>
              </div>
              {!isCollapsed && (
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(122,112,94,0.12)" />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'rgba(75,71,65,0.5)' }} tickFormatter={v => v >= 1000 ? `R${(v/1000).toFixed(0)}k` : `R${v}`} />
                      <Tooltip contentStyle={{ background: 'rgba(255,252,247,0.97)', border: '1px solid rgba(122,112,94,0.2)', borderRadius: 12, fontSize: 12 }} formatter={v => formatCurrency(v)} />
                      <Legend wrapperStyle={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }} onClick={e => {}} />
                      {section.showRevenue && <Line type="monotone" dataKey="revenue" stroke="#6b7f5e" strokeWidth={2} dot={false} name="Revenue" />}
                      <Line type="monotone" dataKey="costs" stroke="#c2a66d" strokeWidth={2} dot={false} name="Costs" />
                      {section.showRevenue && <Line type="monotone" dataKey="profit" stroke="#2b2b2b" strokeWidth={2} dot={false} strokeDasharray="4 2" name="Profit" />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
