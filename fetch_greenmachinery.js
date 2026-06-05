/**
 * 그린중기매매상사 굴착기 매물 자동 수집 및 카카오톡 발송
 * GitHub Actions 환경용 (환경변수로 토큰 관리)
 * ★ 리프레시 토큰으로 액세스 토큰을 매 실행마다 자동 갱신
 * ★ 시각은 한국시각(KST)으로 표시
 */

const axios = require('axios');
const cheerio = require('cheerio');

const REST_API_KEY    = process.env.REST_API_KEY || '2c0f1aa6acf2b9f2e2eb50fbeac8a0f6';
const CLIENT_SECRET   = process.env.KAKAO_CLIENT_SECRET;
const REFRESH_TOKEN   = process.env.KAKAO_REFRESH_TOKEN;

let KAKAO_TOKEN = process.env.KAKAO_ACCESS_TOKEN;

if (!REFRESH_TOKEN) {
  console.error('KAKAO_REFRESH_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

async function refreshAccessToken() {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: REST_API_KEY,
      refresh_token: REFRESH_TOKEN,
    });
    if (CLIENT_SECRET) body.append('client_secret', CLIENT_SECRET);

    const res = await axios.post(
      'https://kauth.kakao.com/oauth/token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    KAKAO_TOKEN = res.data.access_token;
    console.log('액세스 토큰 갱신 성공');
    if (res.data.refresh_token) {
      console.log('※ 새 리프레시 토큰이 발급되었습니다. GitHub Secret을 갱신하세요:');
      console.log(res.data.refresh_token);
    }
  } catch (e) {
    console.error('토큰 갱신 실패:', e.response ? e.response.data : e.message);
    process.exit(1);
  }
}

const CATEGORIES = [
  { code: '100100', label: '1.3㎥이상',   syear: '2020', eyear: '2026' },
  { code: '100101', label: '1.0㎥이상',   syear: '2023', eyear: '2026' },
  { code: '100102', label: '0.4~0.9㎥',   syear: '2018', eyear: '2026' },
  { code: '100103', label: '0.3㎥이하',   syear: '2015', eyear: '2026' },
  { code: '100104', label: '미니굴착기',  syear: '2015', eyear: '2026' },
  { code: '100105', label: '타이어식',    syear: '2015', eyear: '2026' },
];

const CONFIG = {
  url: 'https://www.4396200.com/sub8_1_s.html',
  limit: '70',
  region: '전남',
  recentDays: 7,
};

function parseDate(str) {
  const [y, m, d] = str.trim().split('.');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

function isRecent(dateStr, days) {
  const diff = (new Date() - parseDate(dateStr)) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

async function fetchPage(cateCode, syear, eyear, page = 1) {
  const params = new URLSearchParams({
    cate_code: cateCode,
    limit: CONFIG.limit,
    syear,
    eyear,
    find4: 'area',
    search: CONFIG.region,
    page: String(page),
  });
  const res = await axios.post(CONFIG.url, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.4396200.com/sub8_1_s.html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    },
    timeout: 15000,
  });
  return res.data;
}

function parseItems(html, catLabel) {
  const $ = cheerio.load(html);
  const items = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 10) return;
    const makerCell = $(cells[3]).text().trim();
    const model     = $(cells[4]).text().trim();
    const yearRaw   = $(cells[5]).text().trim();
    const region    = $(cells[7]).text().trim();
    const price     = $(cells[8]).text().trim().replace(/[^0-9]/g, '');
    const writer    = $(cells[9]).text().trim();
    const regDate   = $(cells[10]).text().trim();
    if (!model || !regDate) return;
    const yearMatch = yearRaw.match(/^(\d{2})/);
    const year = yearMatch ? 2000 + parseInt(yearMatch[1]) : 0;
    items.push({ model, year, yearRaw, region, price, writer, regDate, maker: makerCell, cat: catLabel });
  });
  return items;
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.maker}-${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clockEmoji(hour) {
  const clocks = ['🕛','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚'];
  return clocks[hour % 12];
}

const CAT_EMOJI = {
  '1.3㎥이상': '🟥',
  '1.0㎥이상': '🟧',
  '0.4~0.9㎥': '🟨',
  '0.3㎥이하': '🟩',
  '미니굴착기': '🟦',
  '타이어식':   '🟪',
};

async function postKakao(text) {
  const template = JSON.stringify({
    object_type: 'text',
    text,
    link: { web_url: 'https://www.4396200.com' }
  });
  const res = await axios.post(
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    new URLSearchParams({ template_object: template }).toString(),
    { headers: { 'Authorization': `Bearer ${KAKAO_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  console.log('카카오톡 발송:', res.data);
}

async function sendKakao(items) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hour = now.getUTCHours();
  const dateStr = `${now.getUTCFullYear()-2000}.${String(now.getUTCMonth()+1).padStart(2,'0')}.${String(now.getUTCDate()).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  const clock = clockEmoji(hour);

  if (items.length === 0) {
    await postKakao(`${clock} ${hour}시 ━━━━━━━━━\n[그린중기 전남]\n${dateStr}\n\n조건에 맞는 매물이 없습니다.`);
    return;
  }

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  await postKakao(`${clock} ${hour}시 ━━━━━━━━━\n[그린중기 전남]\n${dateStr} · 총 ${items.length}건`);
  await new Promise(r => setTimeout(r, 400));

  for (const [cat, catItems] of Object.entries(grouped)) {
    const emoji = CAT_EMOJI[cat] || '▶';
    await postKakao(`${emoji} ${cat} (${catItems.length}건)`);
    await new Promise(r => setTimeout(r, 400));

    const chunkSize = 4;
    for (let i = 0; i < catItems.length; i += chunkSize) {
      const batch = catItems.slice(i, i + chunkSize);
      const lines = batch.map(item =>
        `${emoji} ${item.maker} ${item.model}\n${item.year}년 / ${Number(item.price).toLocaleString()}만\n${item.writer} / ${item.regDate}`
      );
      await postKakao(lines.join('\n\n'));
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

async function main() {
  await refreshAccessToken();

  console.log('그린중기 매물 수집 시작...\n');
  let allItems = [];

  for (const cat of CATEGORIES) {
    process.stdout.write(`  [${cat.label}] 수집 중..`);
    try {
      const html = await fetchPage(cat.code, cat.syear, cat.eyear, 1);
      const items = parseItems(html, cat.label);
      allItems.push(...items);
      console.log(` ${items.length}건`);
    } catch (e) {
      console.log(` 오류: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const recent = allItems.filter(item => {
    try { return isRecent(item.regDate, CONFIG.recentDays); }
    catch { return false; }
  });
  const deduped = deduplicate(recent);

  const catOrder = CATEGORIES.map(c => c.label);
  const makerOrder = ['두산', '현대', '볼보'];
  deduped.sort((a, b) => {
    const ci = catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat);
    if (ci !== 0) return ci;
    const mi = makerOrder.indexOf(a.maker) - makerOrder.indexOf(b.maker);
    if (mi !== 0) return mi;
    return parseDate(b.regDate) - parseDate(a.regDate);
  });

  console.log(`\n총 ${allItems.length}건 / 최근 ${CONFIG.recentDays}일 ${recent.length}건 / 중복제거: ${deduped.length}건\n`);

  console.log('\n카카오톡 발송 중...');
  await sendKakao(deduped);
  console.log('완료.');
}

main().catch(console.error);
