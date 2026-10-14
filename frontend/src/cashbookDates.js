export function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function dateWindow(period, customStart, customEnd, now = new Date()) {
  const localDate = localDateString;
  let start;
  let end = localDate(now);
  if (period === 'today') start = end;
  else if (period === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    start = end = localDate(yesterday);
  } else if (period === 'week') {
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    start = localDate(monday);
  } else if (period === 'custom') {
    start = customStart;
    end = customEnd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return null;
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
      throw new Error('Enter valid calendar dates for the custom range.');
    }
    if (start > end) throw new Error('Start date must be on or before the end date.');
  } else {
    start = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  if (!start || !end) return null;
  const startAt = new Date(`${start}T00:00:00`);
  const endAt = new Date(`${end}T00:00:00`);
  endAt.setDate(endAt.getDate() + 1);
  return { start: startAt.toISOString(), end: endAt.toISOString() };
}
