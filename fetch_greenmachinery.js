/**
 * 洹몃┛以묎린留ㅻℓ?곸궗 ?꾨궓 留ㅻЪ ?섏쭛 ?ㅽ겕由쏀듃
 * - 移댄뀒怨좊━蹂꾨줈 4396200.com?먯꽌 留ㅻЪ???섏쭛?섍퀬
 * - 理쒓렐 2???대궡 ?깅줉???좉퇋 留ㅻЪ???꾪꽣留곹븯?? * - 以묐났 ?쒓굅(紐⑤뜽+?곗떇+媛寃?吏???깅줉??湲곗?, 理쒓렐 7?????숈씪 留ㅻЪ 1嫄대쭔 ?좎?)
 * - 移댁뭅?ㅽ넚 ?섏뿉寃?蹂대궡湲곕줈 ?꾩넚
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// KAKAO_ACCESS_TOKEN (PowerShell) ?먮뒗 KAKAO_TOKEN (GitHub Actions) ????吏??const ENV_TOKEN = process.env.KAKAO_ACCESS_TOKEN || process.env.KAKAO_TOKEN;
const TOKEN_FILE = path.join(__dirname, 'kakao_token.json');

// ??λ맂 ?좏겙 ?쎄린
function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      // ?섍꼍蹂???좏겙???뚯씪???좏겙怨??ㅻⅤ硫??섍꼍蹂???곗꽑 (?덈줈 諛쒓툒??寃쎌슦)
      if (ENV_TOKEN && data.access_token !== ENV_TOKEN) {
        console.log('?섍꼍蹂???좏겙???뚯씪 ?좏겙怨??ㅻ쫭?덈떎 - ?섍꼍蹂???좏겙?쇰줈 援먯껜?⑸땲??');
        return { access_token: ENV_TOKEN, expires_at: 0 };
      }
      return data;
    }
  } catch (e) {}
  return { access_token: ENV_TOKEN, expires_at: 0 };
}

// ?좏겙 ???function saveToken(access_token, expires_in) {
  const expires_at = Date.now() + (expires_in - 300) * 1000;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token, expires_at }), 'utf8');
  console.log('?좏겙 ????꾨즺');
}

// ?좏겙 媛?몄삤湲?async function getKakaoToken() {
  const token = loadToken();
  if (!token.access_token) {
    throw new Error('移댁뭅???좏겙???놁뒿?덈떎. ?섍꼍蹂??KAKAO_ACCESS_TOKEN???ㅼ젙?댁＜?몄슂.');
  }
  if (token.access_token && Date.now() < token.expires_at) {
    return token.access_token;
  }
  console.log('?좏겙 ?좏슚?쒓컙 ?뺤씤 - ?꾩옱 ?좏겙?쇰줈 ?쒕룄?⑸땲??');
  return token.access_token;
}

const CATEGORIES = [
  { code: '100100', label: '1.3?μ씠??,   syear: '2020', eyear: '2026' },
  { code: '100101', label: '1.0?μ씠??,   syear: '2023', eyear: '2026' },
  { code: '100102', label: '0.4~0.9??,   syear: '2018', eyear: '2026' },
  { code: '100103', label: '0.3?μ씠??,   syear: '2015', eyear: '2026' },
  { code: '100104', label: '誘몃땲援댁갑湲?,  syear: '2015', eyear: '2026' },
  { code: '100105', label: '??댁뼱??,    syear: '2015', eyear: '2026' },
];

const CONFIG = {
  url: 'https://www.4396200.com/sub8_1_s.html',
  limit: '70',
  region: '?꾨궓',
  alertDays: 7,
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
  console.log('移댁뭅??諛쒖넚 寃곌낵:', res.data);
}

function clockEmoji(hour) {
  const clocks = ['?븲','?븧','?븨','?븩','?븪','?븫','?븬','?븭','?븮','?븯','?븰','?븱'];
  return clocks[hour % 12];
}

const CAT_EMOJI = {
  '1.3?μ씠??: '?윥',
  '1.0?μ씠??: '?윧',
  '0.4~0.9??: '?윩',
  '0.3?μ씠??: '?윪',
  '誘몃땲援댁갑湲?: '?윦',
  '??댁뼱??:   '?윫',
};

async function sendKakao(items) {
  const now = new Date();
  const hour = now.getHours();
  const dateStr = `${now.getFullYear()-2000}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(hour).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const clock = clockEmoji(hour);

  if (items.length === 0) {
    await postKakao(`${clock} ${hour}???곣봺?곣봺?곣봺?곣봺??n[洹몃┛以묎린 ?꾨궓 留ㅻЪ]\n\n?좉퇋 留ㅻЪ ?놁쓬  ${dateStr}\n\n(湲곗? / 理쒓렐 ${CONFIG.alertDays}???대궡 / ?좉퇋 ?깅줉)`);
    return;
  }

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  await postKakao(`${clock} ${hour}???곣봺?곣봺?곣봺?곣봺??n[洹몃┛以묎린 ?꾨궓 留ㅻЪ]\n${dateStr} 쨌 珥?${items.length}嫄?);
  await new Promise(r => setTimeout(r, 400));

  for (const [cat, catItems] of Object.entries(grouped)) {
    const emoji = CAT_EMOJI[cat] || '??;
    await postKakao(`${emoji} ${cat} (${catItems.length}嫄?`);
    await new Promise(r => setTimeout(r, 400));

    const chunkSize = 4;
    for (let i = 0; i < catItems.length; i += chunkSize) {
      const batch = catItems.slice(i, i + chunkSize);
      const lines = batch.map(item =>
        `${emoji} ${item.maker} ${item.model}\n${item.year}??/ ${Number(item.price).toLocaleString()}留?n${item.writer} / ${item.regDate}`
      );
      await postKakao(lines.join('\n\n'));
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

async function main() {
  console.log('洹몃┛以묎린 ?꾨궓 留ㅻЪ ?섏쭛 ?쒖옉...');
  let allItems = [];

  for (const cat of CATEGORIES) {
    process.stdout.write(`  [${cat.label}] ?섏쭛 以?. `);
    try {
      const html = await fetchPage(cat.code, cat.syear, cat.eyear, 1);
      const items = parseItems(html, cat.label);
      allItems.push(...items);
      console.log(` ${items.length}嫄?);
    } catch (e) {
      console.log(` ?ㅻ쪟 : ${e.message}`);
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

  console.log(`\n?꾩껜 ?섏쭛 : ${allItems.length}嫄???理쒖쥌 ?뚮┝ ???: ${filtered.length}嫄?n`);

  if (filtered.length > 0) {
    let curCat = '';
    filtered.forEach(item => {
      if (item.cat !== curCat) { curCat = item.cat; console.log(`\n[${item.cat}]`); }
      console.log(`  ${item.maker} ${item.model} ${item.year}??${item.price}留?${item.region} ${item.regDate}`);
    });
  }

  console.log('\n移댁뭅?ㅽ넚 諛쒖넚 ?쒖옉...');
  await sendKakao(filtered);
  console.log('?꾨즺.');
}

main().catch(console.error);
