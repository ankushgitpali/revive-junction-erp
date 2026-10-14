function localCalendarDate(value) {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

export function matchesPnlPeriod(dateValue, timeFilter, now = new Date()) {
  const date = localCalendarDate(dateValue);
  if (!date) return false;
  const selectedMonth = monthIndex(now);
  const eventMonth = monthIndex(date);

  if (timeFilter === 'current_month') return eventMonth === selectedMonth;
  if (timeFilter === 'last_month') return eventMonth === selectedMonth - 1;
  if (timeFilter === 'last_3') return eventMonth >= selectedMonth - 2 && eventMonth <= selectedMonth;
  if (timeFilter === 'last_6') return eventMonth >= selectedMonth - 5 && eventMonth <= selectedMonth;
  if (timeFilter === 'full_year') return date.getFullYear() === now.getFullYear();
  return true;
}

export function pnlPeriodLabel(timeFilter) {
  return {
    current_month: 'Current Month',
    last_month: 'Last Month',
    last_3: 'Last 3 Months',
    last_6: 'Last 6 Months',
    full_year: 'Full Year',
  }[timeFilter] || 'All Time';
}
