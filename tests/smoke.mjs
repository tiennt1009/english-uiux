// Smoke test cho index.html: Chrome headless, khung 390px, Gemini/Claude/GitHub đều là mock.
// Chạy: cd tests && npm install && npm test   (cần Chrome; hoặc đặt CHROME_PATH)
// Thoát mã 1 nếu có lỗi JS hoặc màn nào không mở được. KHÔNG gọi mạng thật, KHÔNG dùng key thật.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP_BUILD = (INDEX.match(/APP_BUILD="([^"]+)"/) || [])[1];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const fails = [], warns = [];
const fail = (m) => { fails.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);
const warn = (m) => { warns.push(m); console.log('  ! ' + m); };

// ---- server tĩnh nhỏ (giống GitHub Pages hơn file://) ----
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(INDEX); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---- mock mạng ----
const calls = { claude: [], gemini: [], github: [] };
let claudeMode = 'ok'; // ok | 401
function mockText(prompt) {
  // lời nhắc JSON của app luôn kết thúc bằng "Return ONLY valid JSON"
  return /Return ONLY valid JSON/.test(prompt) ? '{"ok":true,"items":[],"msgs":[]}' : 'OK';
}
async function installMocks(context) {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
    if (url.startsWith('https://api.anthropic.com/')) {
      calls.claude.push(body.model);
      if (claudeMode === '401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"invalid x-api-key"}}' });
      const p = (body.messages && body.messages[0] && body.messages[0].content) || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: mockText(p) }] }) });
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      calls.gemini.push(decodeURIComponent((url.match(/models\/([^:]+)/) || [])[1] || '?'));
      const p = body.contents && body.contents[0].parts[0].text || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: mockText(p) }] } }] }) });
    }
    if (url.startsWith('https://api.github.com/')) {
      calls.github.push(route.request().method() + ' ' + new URL(url).pathname);
      const m = route.request().method();
      const gist = { id: 'mockgist', files: {} };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m === 'GET' && /\/gists$|\/gists\?/.test(url) ? [] : gist) });
    }
    // mọi thứ ngoài (font, CDN...) đều chặn để test không phụ thuộc mạng
    return route.abort();
  });
}

const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome. Đặt biến CHROME_PATH trỏ tới chrome.exe rồi chạy lại.');
  process.exit(2);
}
const browser = await chromium.launch({ executablePath, headless: true });

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function newPage(storage = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA, locale: 'vi-VN' });
  await installMocks(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
  await page.addInitScript((st) => { // chạy trước script của app; chỉ đặt khi chưa có để reload không ghi đè
    try { if (!sessionStorage.getItem('__seeded')) { Object.entries(st).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('__seeded', '1'); } } catch {}
  }, storage);
  return { context, page, errors };
}

const ROUTES = [
  ['#today', 'v-today', 'Hôm nay'],
  ['#dashboard', 'v-dashboard', 'Dashboard'],
  ['#lessons', 'v-lessons', 'Bài học'],
  ['#settings', 'v-settings', 'Cài đặt'],
  ['#vocab', 'v-session', 'Từ mới hôm nay'],
  ['#s-1-1', 'v-session', 'Ngữ pháp (T2)'],
  ['#s-1-2', 'v-session', 'Nghe & nói (T3)'],
  ['#s-1-4', 'v-session', 'Viết (T5)'],
  ['#s-1-5', 'v-session', 'Dùng từ vựng (T6)'],
  ['#s-1-6', 'v-session', 'Sản phẩm tuần (T7)'],
  ['#review', 'v-review', 'Ôn lại câu sai'],
  ['#placement', 'v-placement', 'Bài xếp tuần'],
];

async function visitAll(page, errors, label) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  for (const [hash, id, name] of ROUTES) {
    const before = errors.length;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(250);
    const r = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const de = document.documentElement;
      return { shown: !!el && !el.classList.contains('hidden'), len: el ? el.innerText.trim().length : 0, over: de.scrollWidth - de.clientWidth };
    }, id);
    if (!r.shown) fail(`[${label}] ${hash} (${name}): #${id} không hiện`);
    else if (r.len < 5) fail(`[${label}] ${hash} (${name}): #${id} trống`);
    else ok(`[${label}] ${hash} ${name}`);
    if (r.over > 1) warn(`[${label}] ${hash}: tràn ngang ${r.over}px ở 390px`);
    if (errors.length > before) fail(`[${label}] ${hash}: lỗi JS: ${errors.slice(before).join(' || ')}`);
  }
  // sổ tay (drawer): mở từng tab
  for (const hash of ['#notebook', '#bookmarks']) {
    const before = errors.length;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => { const d = document.getElementById('nb-drawer'); return !!d && d.getAttribute('aria-hidden') !== 'true'; });
    if (!open) fail(`[${label}] ${hash}: sổ tay không mở`); else ok(`[${label}] ${hash} sổ tay mở`);
    if (errors.length > before) fail(`[${label}] ${hash}: lỗi JS: ${errors.slice(before).join(' || ')}`);
  }
  await page.evaluate(() => { location.hash = '#today'; });
}

try {
  // 1) Chưa có key: app tải được, mọi màn mở được
  console.log('\n[1] Không có key AI');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    if (errors.length) fail('Tải trang có lỗi JS: ' + errors.join(' || ')); else ok('Tải trang không lỗi JS');
    errors.length = 0;
    await visitAll(page, errors, 'no-key');
    // đổi ngôn ngữ giao diện sang EN rồi về VI
    const before = errors.length;
    await page.evaluate(() => { setLang('en'); });
    await page.waitForTimeout(300);
    const enSample = await page.evaluate(() => document.getElementById('bnav').innerText);
    if (!/Today/i.test(enSample)) warn('Chuyển EN: thanh dưới chưa thấy chữ "Today" (' + enSample.replace(/\s+/g, ' ').slice(0, 60) + ')');
    else ok('Chuyển giao diện sang English');
    await page.evaluate(() => { setLang('vi'); });
    if (errors.length > before) fail('setLang gây lỗi JS: ' + errors.slice(before).join(' || '));
    await context.close();
  }

  // 2) Có key giả cho Claude + Gemini: Claude phải được gọi TRƯỚC; Claude lỗi 401 thì rơi về Gemini
  console.log('\n[2] Key giả Claude + Gemini (mock)');
  {
    calls.claude.length = 0; calls.gemini.length = 0;
    const { context, page, errors } = await newPage({ 'eng-claude-key': 'sk-ant-MOCK', 'eng-gemini-key': 'AIzaMOCK' });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => window.__ctest());
    if (r && r.text === 'OK') ok('Claude mock trả lời qua __ctest'); else fail('__ctest không trả OK: ' + JSON.stringify(r));
    const t = await page.evaluate(async () => { const s = await window.claude.use('sample'); return (await s('Reply with exactly: OK')).text; });
    if (t.trim() === 'OK' && calls.claude.length && !calls.gemini.length) ok('Mặc định Claude-first: Claude được gọi, Gemini không');
    else fail(`Claude-first sai: claude=${calls.claude.length} gemini=${calls.gemini.length}`);
    // Claude 401 -> Gemini dự phòng
    claudeMode = '401';
    const t2 = await page.evaluate(async () => { const s = await window.claude.use('sample'); return (await s('Reply with exactly: OK')).text; });
    claudeMode = 'ok';
    if (t2.trim() === 'OK' && calls.gemini.length) ok('Claude 401 → rơi về Gemini'); else fail('Fallback Gemini không chạy: ' + JSON.stringify({ t2, gemini: calls.gemini }));
    // JSON qua askJSON
    const j = await page.evaluate(async () => { const v = await askJSON('Test. Return field note_vi.'); return typeof v; });
    if (j === 'object') ok('askJSON trả object'); else fail('askJSON trả ' + j);
    errors.length = 0;
    await visitAll(page, errors, 'keys');
    await context.close();
  }

  // 3) Dữ liệu cũ: giữ key eng-ux-state, giữ từ đã học, tự sao lưu khi APP_BUILD đổi
  console.log('\n[3] Bảo vệ dữ liệu học');
  {
    const words = ['deploy', 'backlog', 'stakeholder', 'affordance', 'overwhelmed', 'exhausted'];
    const vocab = {}; words.forEach((w, i) => { vocab[w] = { box: 1 + (i % 3), due: '2026-11-20', first: '2026-11-09' }; });
    const old = { v: 3, vset: 2, start: '2026-11-09', weekStarts: { 1: '2026-11-09' }, act: {}, bm: ['deploy'], notes: [], rv: [], sessions: { 'w1-1': { done: true }, 'w1-2': { done: true } }, errors: { article: { count: 3, ex: [{ w: 'I designer', r: 'I am a designer' }] } }, vocab, history: [], rp: { scen: 'first', msgs: [] }, vu: 5, upd: Date.now() };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(old), 'eng-build': 'build-cu-gia-lap' });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('eng-ux-state') || 'null');
      return { st, baks: Object.keys(localStorage).filter((k) => k.startsWith('eng-bak-')), build: localStorage.getItem('eng-build') };
    });
    const lost = words.filter((w) => !res.st || !res.st.vocab || !res.st.vocab[w]);
    if (lost.length) fail('Mất từ đã học sau khi tải: ' + lost.join(', ')); else ok('Giữ nguyên ' + words.length + ' từ đã học trong eng-ux-state');
    if (res.st && res.st.errors && res.st.errors.article && res.st.errors.article.count === 3) ok('Giữ hồ sơ lỗi cũ'); else fail('Hồ sơ lỗi cũ bị đổi/mất');
    if (res.st && res.st.sessions && res.st.sessions['w1-1']) ok('Giữ sessions cũ'); else fail('Sessions cũ bị mất');
    if (res.baks.some((k) => k.endsWith('-update'))) ok('APP_BUILD đổi → tự sao lưu (bakSave "update")'); else fail('Không thấy bản sao lưu "update" khi eng-build khác APP_BUILD');
    if (res.build === APP_BUILD) ok('eng-build được cập nhật = ' + APP_BUILD); else fail('eng-build không khớp APP_BUILD');
    if (errors.length) fail('Dữ liệu cũ gây lỗi JS: ' + errors.join(' || '));
    await visitAll(page, errors, 'old-state');
    await context.close();
  }

  // 4) Đồng bộ Gist (mock GitHub) không gây lỗi
  console.log('\n[4] Đồng bộ Gist (mock)');
  {
    calls.github.length = 0;
    const { context, page, errors } = await newPage({ 'eng-gist-token': 'ghp_MOCK' });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    if (calls.github.length) ok('Có gọi GitHub mock: ' + [...new Set(calls.github)].join(', ')); else warn('Không thấy gọi GitHub khi có token');
    if (errors.length) fail('Sync gây lỗi JS: ' + errors.join(' || ')); else ok('Sync không lỗi JS');
    await context.close();
  }
} catch (e) {
  fail('Test bị dừng giữa chừng: ' + (e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}

console.log(`\nAPP_BUILD=${APP_BUILD} · Chrome: ${executablePath}`);
console.log(`Kết quả: ${fails.length} lỗi, ${warns.length} cảnh báo`);
if (warns.length) console.log('Cảnh báo (không chặn):\n - ' + [...new Set(warns)].join('\n - '));
if (fails.length) { console.log('Lỗi:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('PASS');
