import { MONTH_SHORT } from '../../../lib/vg/constants.js';

/** Map March–February archive years onto calendar months. Prefer recorded archive totals,
 * falling back to live bookings only for months with no archive row (never double-count).
 * A missing month remains null; an explicitly recorded zero stays zero.
 */
export function buildAccommCalendarData(histRows, year, bookings = []) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const fyStart = month <= 2 ? year - 1 : year;
    const row = (histRows || []).find(r => r.financial_year === `${fyStart}-${fyStart + 1}` && Number(r.month) === month);
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const monthlyBookings = (bookings || []).filter(b => b.check_in?.startsWith(prefix));
    const revenue = row ? Number(row.revenue) : monthlyBookings.length
      ? monthlyBookings.reduce((sum, b) => sum + Number(b.total || 0), 0) : null;
    return { name: MONTH_SHORT[i], revenue };
  });
}

/** Keep existing produce/cost calculations while sharing accommodation with Farm Total. */
export function buildMonthlyData(year, salesData, expensesData, bookingsData, unitCostsData, staffLogsData, category, accommData = []) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthStr = String(month).padStart(2, '0');
    const from = `${year}-${monthStr}-01`;
    const to = `${year}-${monthStr}-31`;

    const inMonth = (dateStr) => dateStr >= from && dateStr <= to;

    let revenue = 0;
    let costs = 0;

    if (category === 'accommodation') {
      // Note: accommodation revenue is handled separately via accomm history table
      revenue = 0;
      costs = (unitCostsData || []).filter(c => inMonth(c.date)).reduce((t, c) => t + c.amount, 0);
    } else if (category === 'staff') {
      const logs = (staffLogsData || []).filter(l => l.month === month);
      const staffCost = logs.reduce((t, l) => {
        if (l.total_cash_paid != null && l.total_cash_paid > 0) return t + (l.total_cash_paid || 0) + (l.staff_expenses || 0);
        return t + ((l.days_worked || 0) * (l.vg_staff?.daily_rate || 0)) + (l.bonus || 0) - (l.advance || 0);
      }, 0);
      const maintCost = (unitCostsData || []).filter(c => inMonth(c.date)).reduce((t, c) => t + c.amount, 0);
      costs = staffCost + maintCost;
      revenue = 0;
    } else if (category === 'total') {
      // Produce revenue (all categories)
      revenue += (salesData || []).filter(s => inMonth(s.date)).reduce((t, s) => t + s.sell_price_actual * s.units, 0);
      // The archive already includes synced bookings; use the shared monthly total once.
      revenue += accommData[i]?.revenue ?? 0;
      // All expenses
      costs += (expensesData || []).filter(e => inMonth(e.date)).reduce((t, e) => t + e.amount, 0);
      // Maintenance
      costs += (unitCostsData || []).filter(c => inMonth(c.date)).reduce((t, c) => t + c.amount, 0);
      // Staff
      const logs = (staffLogsData || []).filter(l => l.month === month);
      costs += logs.reduce((t, l) => {
        if (l.total_cash_paid != null && l.total_cash_paid > 0) return t + (l.total_cash_paid || 0) + (l.staff_expenses || 0);
        return t + ((l.days_worked || 0) * (l.vg_staff?.daily_rate || 0)) + (l.bonus || 0) - (l.advance || 0);
      }, 0);
    } else {
      // Produce category filter
      revenue = (salesData || []).filter(s => inMonth(s.date) && s.vg_products?.category === category).reduce((t, s) => t + s.sell_price_actual * s.units, 0);
      costs = (expensesData || []).filter(e => inMonth(e.date) && e.category === category).reduce((t, e) => t + e.amount, 0);
    }

    return { name: MONTH_SHORT[i], revenue, costs, profit: revenue - costs };
  });
}

