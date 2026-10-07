import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAccommCalendarData, buildMonthlyData } from '../pages/vg/history/historyData.js';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ supabase: { from } }));
import { fetchHistoryRows } from '../lib/vg/historyApi.js';

describe('financial history', () => {
  it('maps Jan/Feb to the previous financial year and includes archive revenue in Farm Total', () => {
    const archive = [
      { financial_year: '2024-2025', month: 1, revenue: 117148.42 },
      { financial_year: '2024-2025', month: 2, revenue: 8495.95 },
      { financial_year: '2025-2026', month: 3, revenue: 67589.05 },
    ];
    const accommodation = buildAccommCalendarData(archive, 2025);
    expect(accommodation.slice(0, 3).map(m => m.revenue)).toEqual([117148.42, 8495.95, 67589.05]);
    const total = buildMonthlyData(2025, [], [], [], [], [], 'total', accommodation);
    expect(total[0]).toEqual({ name: 'Jan', revenue: 117148.42, costs: 0, profit: 117148.42 });
  });
  it('does not double-count synced bookings, preserves zero and uses live-only months', () => {
    const rows = buildAccommCalendarData([
      { financial_year: '2026-2027', month: 6, revenue: 1000 },
      { financial_year: '2026-2027', month: 7, revenue: 0 },
    ], 2026, [
      { check_in: '2026-06-01', total: 1000 }, { check_in: '2026-07-01', total: 200 },
      { check_in: '2026-08-01', total: 300 }, { check_in: '2026-08-20', total: 500 },
      { check_in: '2025-08-20', total: 900 },
    ]);
    expect(rows.slice(5, 9).map(m => m.revenue)).toEqual([1000, 0, 800, null]);
  });
  it('includes a live bull sale in Farm Total without counting it twice', () => {
    const rows = buildMonthlyData(2026, [{ date: '2026-09-30', units: 1, sell_price_actual: 13000 }], [], [], [], [], 'total', buildAccommCalendarData([], 2026));
    expect(rows[8].revenue).toBe(13000);
  });
});

describe('history database reads', () => {
  let query;
  beforeEach(() => {
    query = Object.fromEntries(['select','gte','lt','order','eq','in'].map(k => [k, vi.fn().mockReturnThis()]));
    query.range = vi.fn(); from.mockReturnValue(query);
  });
  it('filters the year before pagination and fetches beyond the first page', async () => {
    query.range.mockResolvedValueOnce({ data: Array.from({length:500},(_,id)=>({id})) })
      .mockResolvedValueOnce({ data: [{ id: 500 }] });
    expect(await fetchHistoryRows('sales', 2025)).toHaveLength(501);
    expect(query.gte).toHaveBeenCalledWith('date','2025-01-01');
    expect(query.lt).toHaveBeenCalledWith('date','2026-01-01');
    expect(query.range).toHaveBeenLastCalledWith(500,999);
  });
  it('does not convert failed or partially fetched requests into empty/successful history', async () => {
    query.range.mockResolvedValueOnce({ data: Array(500).fill({}) }).mockResolvedValueOnce({data:null,error:{message:'Unavailable'}});
    await expect(fetchHistoryRows('sales',2026)).rejects.toEqual({message:'Unavailable'});
  });
  it('requests both overlapping financial years', async () => {
    query.range.mockResolvedValue({data:[]});
    expect(await fetchHistoryRows('accommodation',2024)).toEqual([]);
    expect(query.in).toHaveBeenCalledWith('financial_year',['2023-2024','2024-2025']);
  });
});
