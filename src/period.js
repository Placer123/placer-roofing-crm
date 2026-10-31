// Shared date-range logic for the dashboard's Week / Month / YTD filter.
// Dates are plain 'YYYY-MM-DD' strings (UTC-based), matching how dates are
// stored everywhere else in the app.

export const PERIODS = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'ytd', label: 'Year to Date' },
];

export function periodRange(period) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  if (period === 'week') {
    const day = now.getUTCDay(); // 0 = Sunday .. 6 = Saturday
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diffToMonday);
    return { start: monday.toISOString().slice(0, 10), end: todayStr };
  }

  if (period === 'ytd') {
    return { start: `${now.getUTCFullYear()}-01-01`, end: todayStr };
  }

  // default: month
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: first.toISOString().slice(0, 10), end: todayStr };
}
