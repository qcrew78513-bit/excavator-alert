/**
 * 그린중기매매상사 굴착기 매물 자동 수집 및 카카오톡 발송 스크립트
 * 조건: 두산·현대·볼보 / 연식 제한 / 최근 7일
 * 토큰 자동 갱신 기능 포함
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 토큰 파일 경로 (스크립트와 같은 폴더)
const TOKEN_FILE = path.join(__dirname, 'kakao_token.json');

// REST API 키
const REST_API_KEY = '2c0f1aa6acf2b9f2e2eb50fbeac8a0f6';

// 토큰 파일 읽기/쓰기
function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveToken(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 액세스 토큰 갱신
async function refreshAccessToken(refreshToken) {
  console.log('액세스 토큰 갱신 중...');
  const res = await axios.post(
    'https://kauth.kakao.com/oauth/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: REST_API_KEY,
      refresh_token: refreshToken,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

// 유효한 액세스 토큰 가져오기 (5시간 경과 시 자동 갱신)
async function getValidToken() {
  let token = loadToken();

  if (!token) {
    // 최초 1회: 토큰 파일 생성
    token = {
      access_token: 'y2pgx4JB8qdx-PPf7_jhI_MPv3IyIyyNAAAAAQoNG5oAAAGei-4Fc-AsyCcGfplL',
      refresh_token: 'FduQIZ67y6qGzVw6Fik6q7On4jWorm9UAAAAAgoNG5oAAAGei-4Fb-AsyCcGfplL',
      saved_at: 0,
    };
  }

  const now = Date.now();
  const elapsed = (now - (token.saved_at || 0)) / 1000;

  // 5시간(18000초) 이상 경과 시 갱신
  if (elapsed > 18000) {
    try {
      const newData = await refreshAccessToken(token.refresh_token);
      token.access_token = newData.access_token;
      if (newData.refresh_token) {
        token.refresh_token = newData.refresh_token;
      }
      token.saved_at = now;
      saveToken(token);
      console.log('토큰 갱신 완료');
    } catch (e) {
      console.log('토큰 갱신 실패, 기존 토큰 사용:', e.message);
      // 갱신 실패해도 기존 토큰으로 계속 시도
      token.saved_at = now;
      saveToken(token);
    }
  }

  return token.access_token;
}

// 카테고리 설정
const CATEGORIES = [
  { code: '100100', label: '1.3㎥이상',  syear: '2020', eyear: '2026' },
  { code: '100101', label: '1.0㎥이상',  syear: '2023', eyear: '2026' },
  { code: '100102', label: '0.4~0.9㎥', syear: '2018', eyear: '2026' },
  { code: '100103', label: '0.3㎥이하',  syear: '2015', eyear: '2026' },
  { code: '100104', label: '미니굴착기', syear: '2015', eyear: '2026' },
  { code: '100105', label: '타이어식',   syear: '2015', eyear: '2026' },
];

const CONFIG = {
  url: 'https://www.4396200.com/sub8_1_s.html',
  limit: '70',
  region: '전남',
  makers: { '104': '두산', '102': '현대', '101': '볼보' },
  recentDays: 7,
};

// 날짜 파싱
function parseDate(str) {
  const [y, m, d] = str.trim().split('.');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}
function isRecent(dateStr, days) {
  const diff = (new Date() - parseDate(dateStr)) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

// 페이지 수집
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

// HTML 파싱
function parseItems(html, makerName, catLabel) {
  const $ = cheerio.load(html);
  const items = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 10) return;
    const makerCell = $(cells[3]).text().trim();
    const model   = $(cells[4]).text().trim();
    const yearRaw = $(cells[5]).text().trim();
    const region  = $(cells[7]).text().trim();
    const price   = $(cells[8]).text().trim().replace(/[^0-9]/g, '');
    const writer  = $(cells[9]).text().trim();
    const regDate = $(cells[10]).text().trim();
    if (!model || !regDate) return;
    const yearMatch = yearRaw.match(/^(\d{2})/);
    const year = yearMatch ? 2000 + parseInt(yearMatch[1]) : 0;
    const maker = makerCell || makerName;
    items.push({ model, year, yearRaw, region, price, writer, regDate, maker, cat: catLabel });
  });
  return items;
}

// 중복 제거
function deduplicate(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.maker}-${item.model}-${item.yearRaw}-${item.price}-${item.region}-${item.writer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 카카오톡 발송 (토큰 자동 갱신 포함)
async function postKakao(text) {
  const KAKAO_TOKEN = await getValidToken();
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

// 카카오톡 일괄 발송
async function sendKakao(items) {
  const now = new Date();
  const dateStr = `${now.getFullYear()-2000}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  if (items.length === 0) {
    await postKakao(`[그린중기 전남]\n${dateStr}\n\n조건에 맞는 매물이 없습니다.`);
    return;
  }

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  await postKakao(`[그린중기 전남] ${dateStr}\n총 ${items.length}건`);
  await new Promise(r => setTimeout(r, 400));

  for (const [cat, catItems] of Object.entries(grouped)) {
    await postKakao(`━━ ${cat} (${catItems.length}건) ━━`);
    await new Promise(r => setTimeout(r, 400));

    const chunkSize = 4;
    for (let i = 0; i < catItems.length; i += chunkSize) {
      const batch = catItems.slice(i, i + chunkSize);
      const lines = [];
      for (const item of batch) {
        lines.push(`${item.maker} ${item.model}\n${item.year}년 / ${Number(item.price).toLocaleString()}만\n${item.writer} / ${item.regDate}`);
      }
      await postKakao(lines.join('\n\n'));
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

// 메인
async function main() {
  console.log('그린중기 매물 수집 시작...\n');
  let allItems = [];

  for (const cat of CATEGORIES) {
    process.stdout.write(`  [${cat.label}] 수집 중..`);
    try {
      const html = await fetchPage(cat.code, cat.syear, cat.eyear, 1);
      const items = parseItems(html, '', cat.label);
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

  console.log(`\n총 ${allItems.length}건 수집 / 최근 ${CONFIG.recentDays}일 ${recent.length}건 / 중복제거: ${deduped.length}건\n`);

  if (deduped.length > 0) {
    let curCat = '', curMaker = '';
    deduped.forEach(item => {
      if (item.cat !== curCat) { curCat = item.cat; console.log(`\n[${item.cat}]`); curMaker = ''; }
      if (item.maker !== curMaker) { curMaker = item.maker; console.log(`  ── ${item.maker}`); }
      console.log(`  ${item.model} ${item.year}년 ${item.price}만 ${item.region} ${item.regDate}`);
    });
  }

  console.log('\n카카오톡 발송 중...');
  await sendKakao(deduped);
  console.log('완료.');
}

main().catch(console.error);
