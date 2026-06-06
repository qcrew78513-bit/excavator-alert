/**
 * 그린중기매매상사 전남 매물 수집 스크립트
 * - 카테고리별로 4396200.com에서 매물을 수집하고
 * - 최근 2일 이내 등록된 신규 매물을 필터링하여
 * - 중복 제거(모델+연식+가격+지역+등록인 기준, 최근 7일 내 동일 매물 1건만 유지)
 * - 카카오톡 나에게 보내기로 전송
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// KAKAO_ACCESS_TOKEN (PowerShell) 또는 KAKAO_TOKEN (GitHub Actions) 둘 다 지원
const ENV_TOKEN = process.env.KAKAO_ACCESS_TOKEN || process.env.KAKAO_TOKEN;
const TOKEN_FILE = path.join(__dirname, 'kakao_token.json');

// 저장된 토큰 읽기
function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      // 환경변수 토큰이 파일의 토큰과 다르면 환경변수 우선 (새로 발급한 경우)
      if (ENV_TOKEN && data.access_token !== ENV_TOKEN) {
        console.log('환경변수 토큰이 파일 토큰과 다릅니다 - 환경변수 토큰으로 교체합니다.');
        return { access_token: ENV_TOKEN, expires_at: 0 };
      }
      return data;
    }
  } catch (e) {}
  return { access_token: ENV_TOKEN, expires_at: 0 };
}

// 토큰 저장
function saveToken(access_token, expires_in) {
  const expires_at = Date.now() + (expires_in - 300) * 1000;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token, expires_at }), 'utf8');
  console.log('토큰 저장 완료');
}

// 토큰 가져오기
async function getKakaoToken() {
  const token = loadToken();
  if (!token.access_token) {
    throw new Error('카카오 토큰이 없습니다. 환경변수 KAKAO_ACCESS_TOKEN을 설정해주세요.');
  }
  if (token.access_token && Date.now() < token.expires_at) {
    return token.access_token;
  }
  console.log('토큰 유효시간 확인 - 현재 토큰으로 시도합니다.');
  return token.access_token;
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
  alertDays: 2,
  dedupDays: 7,
};

function parseDate(str) {
  const [y, m, d] = str.trim().split('.');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

function dateDiffDays(dateStr) {
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = parseDate(dateStr);
  return Math.floor((todayOnly - target) / (1000 * 60 * 60 * 24));
}

function isWithinDays(dateStr, days) {
  try { return dateDiffDays(dateStr) <= days; }
  catch { return false; }
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

function filterItems(allItems) {
  const within7 = allItems.filter(item => isWithinDays(item.regDate, CONFIG.dedupDays));
  const countMap = {};
  for (const item of within7) {
    const key = `${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    countMap[key] = (countMap[key] || 0) + 1;
  }
  const result = within7.filter(item => {
    if (!isWithinDays(item.regDate, CONFIG.alertDays)) return false;
    const key = `${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    return countMap[key] === 1;
  });
  const seen = new Set();
  return result.filter(item => {
    const key = `${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function postKakao(text) {
  const kakaoToken = await getKakaoToken();
  const template = JSON.stringify({
    object_type: 'text',
    text,
    link: { web_url: 'https://www.4396200.com' }
  });
  const res = await axios.post(
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    new URLSearchParams({ template_object: template }).toString(),
    { headers: { 'Authorization': `Bearer ${kakaoToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  saveToken(kakaoToken, 21600);
  console.log('카카오 발송 결과:', res.data);
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

async function sendKakao(items) {
  const now = new Date();
  const hour = now.getHours();
  const dateStr = `${now.getFullYear()-2000}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const clock = clockEmoji(hour);

  if (items.length === 0) {
    await postKakao(`${clock} ${hour}시 ━━━━━━━━━\n[그린중기 전남 매물]\n\n신규 매물 없음  ${dateStr}\n\n(기준 / 최근 ${CONFIG.alertDays}일 이내 / 신규 등록)`);
    return;
  }

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  await postKakao(`${clock} ${hour}시 ━━━━━━━━━\n[그린중기 전남 매물]\n${dateStr} · 총 ${items.length}건`);
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
  console.log('그린중기 전남 매물 수집 시작...');
  let allItems = [];

  for (const cat of CATEGORIES) {
    process.stdout.write(`  [${cat.label}] 수집 중.. `);
    try {
      const html = await fetchPage(cat.code, cat.syear, cat.eyear, 1);
      const items = parseItems(html, cat.label);
      allItems.push(...items);
      console.log(` ${items.length}건`);
    } catch (e) {
      console.log(` 오류 : ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const filtered = filterItems(allItems);

  const catOrder = CATEGORIES.map(c => c.label);
  filtered.sort((a, b) => {
    const ci = catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat);
    if (ci !== 0) return ci;
    return parseDate(b.regDate) - parseDate(a.regDate);
  });

  console.log(`\n전체 수집 : ${allItems.length}건 → 최종 알림 대상 : ${filtered.length}건\n`);

  if (filtered.length > 0) {
    let curCat = '';
    filtered.forEach(item => {
      if (item.cat !== curCat) { curCat = item.cat; console.log(`\n[${item.cat}]`); }
      console.log(`  ${item.maker} ${item.model} ${item.year}년 ${item.price}만 ${item.region} ${item.regDate}`);
    });
  }

  console.log('\n카카오톡 발송 시작...');
  await sendKakao(filtered);
  console.log('완료.');
}

main().catch(console.error);
