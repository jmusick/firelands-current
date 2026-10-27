// Public dates and times: always Eastern, in AP style. Workers run in UTC, so a bare
// toLocale* call shows the wrong hour, or the next day after 8 p.m. Eastern.
const ZONE = 'America/New_York';

// AP abbreviates these months; the runtime's ICU short names ("Sep", "Mar") differ.
const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

const easternParts = (ms: number) => {
  const found: Record<string, number> = {};
  for (const part of parts.formatToParts(new Date(ms))) if (part.type !== 'literal') found[part.type] = Number(part.value);
  return found as { year: number; month: number; day: number; hour: number; minute: number };
};

/** "Oct. 25, 2026" */
export const fmtStoryDate = (ms: number) => {
  const { year, month, day } = easternParts(ms);
  return `${AP_MONTHS[month - 1]} ${day}, ${year}`;
};

/** "Oct. 25, 2026, at 9:48 a.m."; "noon" and "midnight" stand in for 12 p.m. and 12 a.m. */
export const fmtStoryDateTime = (ms: number) => {
  const { hour, minute } = easternParts(ms);
  let time: string;
  if (minute === 0 && hour === 12) time = 'noon';
  else if (minute === 0 && hour === 0) time = 'midnight';
  else {
    const clock = `${hour % 12 || 12}${minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`}`;
    time = `${clock} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
  }
  return `${fmtStoryDate(ms)}, at ${time}`;
};

/** Value for a <time datetime> attribute. */
export const isoDateTime = (ms: number) => new Date(ms).toISOString();
