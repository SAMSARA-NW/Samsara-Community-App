import { supabase } from '../supabase.js';

const SOURCES = {
  sales: { table: 'vg_sales', select: '*, vg_products(name, category, pricing_type)', date: 'date' },
  expenses: { table: 'vg_expenses', select: '*', date: 'date' },
  bookings: { table: 'vg_bookings', select: 'id,check_in,check_out,total', date: 'check_in' },
  accommodation: { table: 'vg_accomm_sales_history', select: 'financial_year,month,revenue' },
  unitCosts: { table: 'vg_unit_costs', select: '*, vg_units(name)', date: 'date' },
  staffLogs: { table: 'vg_staff_logs', select: '*, vg_staff(name, daily_rate)' },
};

/** Read a complete, year-scoped dataset. Throw database errors so the UI can distinguish
 * a failed request from a genuinely empty year. Stable ordering prevents pagination gaps.
 */
export async function fetchHistoryRows(source, year) {
  const config = SOURCES[source];
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(config.table).select(config.select);
    if (config.date) {
      query = query.gte(config.date, `${year}-01-01`).lt(config.date, `${year + 1}-01-01`)
        .order(config.date).order('id');
    } else if (source === 'accommodation') {
      query = query.in('financial_year', [`${year - 1}-${year}`, `${year}-${year + 1}`])
        .order('financial_year').order('month');
    } else {
      query = query.eq('year', year).order('month').order('id');
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
