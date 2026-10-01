import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://rasp.rea.ru';
const GROUP = process.env.GROUP || '15.27д-би01/25б';
const OUTPUT_ICS = process.env.OUTPUT || 'public/schedule.ics';
const DEBUG_DIR = 'public/debug';

const TIME_TO_SLOT = {
  '08:30': 1, '10:10': 2, '11:50': 3,
  '14:00': 4, '15:40': 5, '17:20': 6,
};

function hhmm(h, m) {
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function parseIcsDate(s) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

function icsUnfold(ics) {
  return ics.replace(/\r?\n[ \t]/g, '');
}

function parseVEvents(ics) {
  const text = icsUnfold(ics);
  const events = [];
  const blocks = text.split(/BEGIN:VEVENT/).slice(1);

  for (const b of blocks) {
    const block = b.split('END:VEVENT')[0];
    const get = re => {
      const m = block.match(re);
      return m ? m[1].trim() : '';
    };

    events.push({
      uid: get(/\nUID:(.+?)\r?\n/),
      dtstart: get(/\nDTSTART:(.+?)\r?\n/),
      dtend: get(/\nDTEND:(.+?)\r?\n/),
      summary: get(/\nSUMMARY:(.+?)\r?\n/),
      location: get(/\nLOCATION:(.+?)\r?\n/),
      description: get(/\nDESCRIPTION:(.+?)\r?\n/),
    });
  }

  return events;
}

function eventToDetailsKey(ev) {
  const d = parseIcsDate(ev.dtstart);
  if (!d) return null;

  const date = String(d.d).padStart(2, '0') + '.' +
    String(d.mo).padStart(2, '0') + '.' + d.y;
  const slot = TIME_TO_SLOT[hhmm(d.h, d.mi)];
  return slot ? { date, slot } : null;
}

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function shortenTeacher(full) {
  const clean = decodeHtml(full);
  const parts = clean.trim().split(/\s+/);
  if (parts.length < 2) return clean;

  const last = parts[0];
  const first = parts[1];
  const patronymic = parts[2];
  const f = first ? first[0] + '.' : '';
  const p = patronymic ? patronymic[0] + '.' : '';
  return (last + ' ' + f + p).trim();
}

function extractTeacher(html) {
  const m = html.match(/school<\/i>\s*([^<]+?)\s*<\/a>/i);
  if (m) return decodeHtml(m[1].trim()).replace(/\s+/g, ' ');

  const m2 = html.match(/<a[^>]*>\s*([^<]*[А-ЯЁ][^<]*)<\/a>/i);
  if (m2) return decodeHtml(m2[1].trim()).replace(/\s+/g, ' ');

  return null;
}

function extractDepartment(html) {
  const m =
    html.match(/\(([^)]*кафедр[^)]*)\)/i) ||
    html.match(/<br\s*\/?>\s*&emsp;&emsp;\s*\(([^)]+)\)/i);

  return m ? decodeHtml(m[1].trim()).replace(/\s+/g, ' ') : null;
}

function cleanSummaryEscaped(raw, groupPrefix) {
  const esc = groupPrefix.replace(/[.*+?^()|[\]\\$]/g, '\\$&');
  return raw.replace(new RegExp('^' + esc + '\\s*-\\s*'), '').trim();
}

function icsEscape(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldLine(line) {
  if (line.length <= 75) return line;

  const out = [];
  let i = 0;
  while (i < line.length) {
    const chunk = i === 0 ? line.slice(0, 75) : ' ' + line.slice(i, i + 74);
    out.push(chunk);
    i += i === 0 ? 75 : 74;
  }
  return out.join('\r\n');
}

function rebuildIcs(nativeIcs, enrichment, groupPrefix) {
  const text = icsUnfold(nativeIcs);
  const out = [];
  const lines = text.split(/\r?\n/);
  let inEvent = false;
  let cur = {};
  let buf = [];

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      buf = [line];
      continue;
    }

    if (line === 'END:VEVENT') {
      const key = cur.uid && enrichment.get(cur.uid);
      const teacher = key && key.teacher ? key.teacher : null;
      const dept = key && key.department ? key.department : null;
      const newBuf = [];

      for (const L of buf) {
        if (L.startsWith('SUMMARY:')) {
          const cleanedPlain = cleanSummaryEscaped(L.slice(8), groupPrefix);
          const summary = teacher
            ? cleanedPlain + ' · ' + shortenTeacher(teacher)
            : cleanedPlain;
          newBuf.push(foldLine('SUMMARY:' + icsEscape(summary)));
        } else if (L.startsWith('DESCRIPTION:')) {
          const originalEscaped = cleanSummaryEscaped(L.slice(12), groupPrefix);
          const additions = [];
          if (teacher) additions.push(icsEscape('Преподаватель: ' + decodeHtml(teacher)));
          if (dept) additions.push(icsEscape('Кафедра: ' + decodeHtml(dept)));
          const desc = [originalEscaped, ...additions].filter(Boolean).join('\\n');
          newBuf.push(foldLine('DESCRIPTION:' + desc));
        } else {
          newBuf.push(L);
        }
      }

      newBuf.push('END:VEVENT');
      out.push(...newBuf);
      inEvent = false;
      continue;
    }

    if (inEvent) {
      buf.push(line);
      const kv = line.match(/^([A-Z-]+):(.*)$/);
      if (kv && kv[1].toLowerCase() === 'uid') cur.uid = kv[2];
    } else {
      out.push(line);
    }
  }

  return out.join('\r\n');
}

function currentAcademicWeek(date = new Date()) {
  const year = date.getUTCMonth() >= 8
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1;

  const start = Date.UTC(year, 8, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  return 1 + Math.floor((today - start) / (7 * 24 * 60 * 60 * 1000));
}

async function reaFetch(url, options = {}) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'text/html, */*; q=0.01',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': BASE_URL + '/',
    ...(options.headers || {}),
  };

  delete headers['X-Requested-With'];

  if (!options.keepXRequestedWith) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();

  console.log('[http] ' + response.status + ' ' + response.statusText +
    ' ' + url + ' (' + text.length + ' bytes)');

  if (!response.ok) {
    throw new Error(
      'REA HTTP ' + response.status + ' for ' + url + ': ' + text.slice(0, 1000)
    );
  }

  return { response, text };
}

async function exportNativeIcsDirect(group) {
  const week = currentAcademicWeek();
  const encodedGroup = encodeURIComponent(group);

  console.log('[export] Direct REA API mode; skipping #search/#manual-search-btn');
  console.log('[export] group=' + group + ', academicWeek=' + week);

  try {
    const root = await fetch(BASE_URL + '/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    const rootText = await root.text();
    await fs.writeFile(path.join(DEBUG_DIR, 'rea-root-status.txt'),
      'status=' + root.status + '\nbytes=' + rootText.length + '\n', 'utf8');
    console.log('[http] REA root: ' + root.status + ' (' + rootText.length + ' bytes)');
  } catch (e) {
    await fs.writeFile(path.join(DEBUG_DIR, 'rea-root-error.txt'), String(e), 'utf8');
    throw e;
  }

  const exportUrl =
    BASE_URL + '/Schedule/ExportCalendar?key=' + encodedGroup +
    '&week=' + week + '&mode=all&mask=0';

  const exportResult = await reaFetch(exportUrl, {
    headers: {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Referer': BASE_URL + '/?q=' + encodedGroup,
    },
  });

  await fs.writeFile(
    path.join(DEBUG_DIR, 'export-calendar-response.txt'),
    exportResult.text,
    'utf8'
  );

  let data;
  try {
    data = JSON.parse(exportResult.text);
  } catch {
    throw new Error(
      'ExportCalendar returned non-JSON: ' + exportResult.text.slice(0, 2000)
    );
  }

  const fileId = data && data.fileId;
  if (!fileId) {
    throw new Error(
      'ExportCalendar did not return fileId: ' + exportResult.text.slice(0, 2000)
    );
  }

  console.log('[export] ExportCalendar returned fileId=' + fileId);

  const fileUrl = BASE_URL + '/Schedule/GetFile?id=' + encodeURIComponent(fileId);
  const fileResult = await reaFetch(fileUrl, {
    headers: {
      'Accept': 'text/calendar,text/plain,*/*;q=0.8',
      'Referer': BASE_URL + '/?q=' + encodedGroup,
    },
  });

  await fs.writeFile(
    path.join(DEBUG_DIR, 'native-direct.ics'),
    fileResult.text,
    'utf8'
  );

  if (!fileResult.text.includes('BEGIN:VCALENDAR')) {
    throw new Error(
      'GetFile did not return an ICS calendar: ' + fileResult.text.slice(0, 2000)
    );
  }

  console.log('[export] Native ICS downloaded directly: ' + fileResult.text.length + ' bytes');
  return fileResult.text;
}

async function fetchDetails(group, date, slot) {
  const url =
    BASE_URL + '/Schedule/GetDetails?selection=' +
    encodeURIComponent(group.toLowerCase()) +
    '&date=' + date + '&timeSlot=' + slot;

  return reaFetch(url, {
    headers: {
      'Accept': 'text/html, */*; q=0.01',
    },
  });
}

async function enrichEvents(events, groupLower) {
  const uniquePairs = new Map();

  for (const ev of events) {
    const k = eventToDetailsKey(ev);
    if (!k) continue;

    const sumKey = ev.summary.split(' - ').slice(-1)[0];
    const weekday = new Date(
      k.date.split('.').reverse().join('-') + 'T00:00:00Z'
    ).getUTCDay();

    const cKey = sumKey + '::' + k.slot + '::' + weekday;

    if (!uniquePairs.has(cKey)) {
      uniquePairs.set(cKey, { ...k, examples: [] });
    }
    uniquePairs.get(cKey).examples.push(ev.uid);
  }

  console.log(
    '[enrich] ' + events.length + ' events, ' + uniquePairs.size +
    ' unique (subject × slot × weekday) combinations'
  );

  const enrichment = new Map();
  let done = 0;
  let fail = 0;

  for (const [, info] of uniquePairs) {
    try {
      const result = await fetchDetails(groupLower, info.date, info.slot);

      if (result.response.status !== 200) {
        fail++;
        continue;
      }

      const teacher = extractTeacher(result.text);
      const department = extractDepartment(result.text);

      if (teacher) {
        for (const uid of info.examples) {
          enrichment.set(uid, { teacher, department });
        }
        done++;
      } else {
        fail++;
      }
    } catch (e) {
      console.warn(
        '[enrich] failed ' + info.date + '/' + info.slot + ': ' + e.message
      );
      fail++;
    }
  }

  console.log(
    '[enrich] teachers found for ' + done + '/' + uniquePairs.size +
    ' combos, ' + fail + ' without teacher'
  );
  console.log('[enrich] enriched ' + enrichment.size + ' events');

  return enrichment;
}

export async function exportIcs() {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUTPUT_ICS), { recursive: true });

  console.log('[scraper] REA direct API mode for group: ' + GROUP);

  // Do not use the REA browser search UI here. GitHub Actions can receive
  // REA's application-level "offline" state even while rasp.rea.ru itself
  // is reachable. In that state #manual-search-btn is hidden by design.
  const nativeIcs = await exportNativeIcsDirect(GROUP);

  const events = parseVEvents(nativeIcs);
  console.log('[scraper] Parsed ' + events.length + ' events from native ICS');

  if (events.length === 0) {
    throw new Error('REA returned an ICS calendar with 0 events');
  }

  const enrichment = await enrichEvents(events, GROUP.toLowerCase());
  const enriched = rebuildIcs(nativeIcs, enrichment, GROUP);

  await fs.writeFile(OUTPUT_ICS, enriched, 'utf8');

  const stat = await fs.stat(OUTPUT_ICS);
  console.log(
    '[scraper] ✓ Saved ' + OUTPUT_ICS + ' (' + stat.size +
    ' bytes), enriched=' + enrichment.size
  );

  return {
    outputPath: OUTPUT_ICS,
    size: stat.size,
    events: events.length,
    enriched: enrichment.size,
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  exportIcs()
    .then(r => console.log('DONE:', r))
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
