// Foreign guests must be reported within 3 working days of arrival.

function easterSunday(year) {
  // Anonymous Gregorian algorithm
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function czechHolidays(year) {
  const fixed = ["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"];
  const easter = easterSunday(year).getTime();
  const day = 86400000;
  return new Set([
    ...fixed.map((md) => `${year}-${md}`),
    iso(new Date(easter - 2 * day)), // Good Friday
    iso(new Date(easter + 1 * day)), // Easter Monday
  ]);
}

export function isWorkingDay(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !czechHolidays(d.getUTCFullYear()).has(isoDate);
}

export function reportDeadline(arrivalIso, workingDays = 3) {
  const d = new Date(arrivalIso + "T00:00:00Z");
  let left = workingDays;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(iso(d))) left--;
  }
  return iso(d);
}
