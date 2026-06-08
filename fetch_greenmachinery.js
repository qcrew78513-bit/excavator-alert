process.stdout.setEncoding("utf8");
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const ENV_TOKEN = process.env.KAKAO_ACCESS_TOKEN || process.env.KAKAO_TOKEN;
const TOKEN_FILE = path.join(__dirname, 'kakao_token.json');

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (ENV_TOKEN && data.access_token !== ENV_TOKEN) {
        return { access_token: ENV_TOKEN, expires_at: 0 };
      }
      return data;
    }
  } catch (e) {}
  return { access_token: ENV_TOKEN, expires_at: 0 };
}

function saveToken(access_token, expires_in) {
  const expires_at = Date.now() + (expires_in - 300) * 1000;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token, expires_at }), 'utf8');
}

async function getKakaoToken() {
  const token = loadToken();
  if (!token.access_token) {
    throw new Error('KAKAO_ACCESS_TOKEN 없음');
  }
  return token.access_token;
}

const CATEGORIES = [
  { code: '100100', label: '1.3m이상', syear: '2020', eyear: '2026' },
  { code: '100101', label: '1.0m이상', syear: '2023', eyear: '2026' },
  { code: '100102', label: '0.4~0.9m', syear: '2018', eyear: '2026' },
  { code: '100103', label: '0.3m이하', syear: '2015', eyear: '2026' },
  { code: '100104', label: '미니굴착기', syear: '2015', eyear: '2026' },
  { code: '100105', label: '타이어식', syear: '2015', eyear: '2026' },
];

const CONFIG = {
  url: 'https://www.4396200.com/sub8_1_s.html',
  limit: '70',
  region: '전남',
  alertDays: 2,
  dedupDays: 7,
};

function parseDate(str) {
  const [y, m, d] = str.trim().split('.');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

function isWithinDays(dateStr, days) {
  try {
    const diff = (new Date() - parseDate(dateStr)) / (1000 * 60 * 60 * 24);
    return diff <= days;
  } catch { return false; }
}

async function fetchPage(cateCode, syear, eyear, page = 1) {
  const params = new URLSearchParams({
    cate_code: cateCode, limit: CONFIG.limit,
    syear, eyear, find4: 'area', search: CONFIG.region, page: String(page),
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
    const model = $(cells[4]).text().trim();
    const yearRaw = $(cells[5]).text().trim();
    const region = $(cells[7]).text().trim();
    const price = $(cells[8]).text().trim().replace(/[^0-9]/g, '');
    const writer = $(cells[9]).text().trim();
    const regDate = $(cells[10]).text().trim();
    if (!model || !regDate) return;
    const yearMatch = yearRaw.match(/^(\d{2})/);
    const year = yearMatch ? 2000 + parseInt(yearMatch[1]) : 0;
    items.push({ model, year, yearRaw, region, price, writer, regDate, maker: makerCell, cat: catLabel });
  });
  return items;
}

function deduplicate(items) {
  const countMap = new Map();
  for (const item of items) {
    const key = `${item.maker}-${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.maker}-${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return countMap.get(key) < 3;
  });
}

async function postKakao(text) {
  const kakaoToken = await getKakaoToken();
  const template = JSON.stringify({ object_type: 'text', text, link: { web_url: 'https://www.4396200.com' } });
  const res = await axios.post(
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    new URLSearchParams({ template_object: template }).toString(),
    { headers: { 'Authorization': `Bearer ${kakaoToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  saveToken(kakaoToken, 21600);
  console.log('카카오 발송:', res.data);
}

async function sendKakao(items) {
  const now = new Date();
  const hour = now.getHours();
  const dateStr = `${now.getFullYear()-2000}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  if (items.length === 0) {
    await postKakao(`[그린중기 전남 매물]\n\n신규 매물 없음  ${dateStr}\n\n(최근 ${CONFIG.alertDays}일 이내 / 신규 등록)`);
    return;
  }

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  await postKakao(`[그린중기 전남 매물]\n${dateStr} 총 ${items.length}건`);
  await new Promise(r => setTimeout(r, 400));

  for (const [cat, catItems] of Object.entries(grouped)) {
    await postKakao(`[${cat}] ${catItems.length}건`);
    await new Promise(r => setTimeout(r, 400));
    const chunkSize = 4;
    for (let i = 0; i < catItems.length; i += chunkSize) {
      const batch = catItems.slice(i, i + chunkSize);
      const lines = batch.map(item =>
        `${item.maker} ${item.model}\n${item.year}년 / ${Number(item.price).toLocaleString()}만\n${item.writer} / ${item.regDate}`
      );
      await postKakao(lines.join('\n\n'));
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

async function main() {
  console.log('그린중기 전남 매물 수집 시작...');
  let allItems = [];
  for (const cat of CATEGORIES) {
    try {
      const html = await fetchPage(cat.code, cat.syear, cat.eyear, 1);
      const items = parseItems(html, cat.label);
      allItems.push(...items);
      console.log(`[${cat.label}] ${items.length}건`);
    } catch (e) {
      console.log(`[${cat.label}] 오류: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const recent = allItems.filter(item => {
    try { return isWithinDays(item.regDate, CONFIG.alertDays); }
    catch { return false; }
  });
  const deduped = deduplicate(recent);

  console.log(`\n전체 ${allItems.length}건 / 최근 ${CONFIG.alertDays}일 ${recent.length}건 / 중복제거 ${deduped.length}건`);
  await sendKakao(deduped);
  console.log('완료.');
}

main().catch(console.error);

