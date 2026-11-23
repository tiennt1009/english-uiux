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
function mockText(prompt) {
  // lời nhắc JSON của app luôn kết thúc bằng "Return ONLY valid JSON"
  // Luyện đề: đề ngữ pháp giả để thử luồng AI → làm bài → chấm
  if (/PRACTICE SET \(grammar\)/.test(prompt)) {
    const items = Array.from({ length: 10 }, (_, i) => ({ type: 'mcq', q: `She ___ my PM ${i}.`, options: ['am', 'is', 'are'], answer: 'is', explain_vi: 'She đi với is.', tag: 'to-be-agreement' }));
    return JSON.stringify({ items });
  }
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
  ['#practice', 'v-practice', 'Luyện đề'],
  ['#practice/vocab', 'v-practice', 'Luyện đề: chọn độ khó'],
  ['#practice/grammar', 'v-practice', 'Luyện đề: ngữ pháp'],
];

async function visitAll(page, errors, label) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  for (const [hash, id, name] of ROUTES) {
    const before = errors.length;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(250);
    const r = await page.evaluate((id) => {
      /* #today mở thẳng buổi học nếu hôm nay có buổi (tuần 1) → coi #v-session là hợp lệ */
      const el = document.getElementById(id === 'v-today' && document.getElementById('v-today').classList.contains('hidden') ? 'v-session' : id);
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

  // 2) Có key Gemini giả: gọi Gemini; không còn kết nối Claude (key Claude cũ trong máy bị dọn, không gọi Anthropic)
  console.log('\n[2] Key Gemini giả (mock), không còn Claude');
  {
    calls.claude.length = 0; calls.gemini.length = 0;
    const { context, page, errors } = await newPage({ 'eng-claude-key': 'sk-ant-CU', 'eng-claude-model': 'x', 'eng-gemini-key': 'AIzaMOCK' });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => ['eng-claude-key', 'eng-claude-model', 'eng-skip-claude'].filter((k) => localStorage.getItem(k) !== null));
    if (!left.length) ok('Key Claude cũ trong máy đã được xóa'); else fail('Còn key Claude trong localStorage: ' + left.join(','));
    const hasCard = await page.evaluate(() => !!document.getElementById('cl-card') || /Kết nối Claude/.test(document.getElementById('v-settings').innerText));
    if (!hasCard) ok('Cài đặt không còn thẻ "Kết nối Claude"'); else fail('Cài đặt vẫn còn thẻ Claude');
    const t = await page.evaluate(async () => { const s = await window.claude.use('sample'); return (await s('Reply with exactly: OK')).text; });
    if (t.trim() === 'OK' && calls.gemini.length && !calls.claude.length) ok('Gọi Gemini, không gọi Anthropic'); else fail(`Sai: gemini=${calls.gemini.length} claude=${calls.claude.length}`);
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
    if (res.st && res.st.px && res.st.px.lv && Array.isArray(res.st.px.hist)) ok('Dữ liệu cũ (chưa có S.px) được thêm trường px, không mất gì'); else fail('Thiếu S.px sau migrate');
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

  // 5) Kho từ vựng: đủ số lượng, không trùng, giữ nguyên 174 từ gốc đúng thứ tự đầu danh sách
  console.log('\n[5] Kho từ vựng');
  {
    const orig = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vocab-original.json'), 'utf8'));
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    const v = await page.evaluate(() => ({ ws: VOCAB.map((c) => c.w), badShape: VOCAB.filter((c) => !c.w || !c.vi || !c.ex || !c.il || !['it', 'ui', 'work', 'daily', 'talk'].includes(c.cat) || ![1, 2, 3].includes(c.lv)).map((c) => c.w) }));
    const uniq = new Set(v.ws.map((w) => w.toLowerCase())).size;
    if (v.ws.length >= 720) ok('VOCAB có ' + v.ws.length + ' từ'); else fail('VOCAB chỉ có ' + v.ws.length + ' từ');
    if (uniq === v.ws.length) ok('Không có từ trùng'); else fail('Có từ trùng: ' + (v.ws.length - uniq));
    if (!v.badShape.length) ok('Mọi từ đủ trường (nghĩa, ví dụ, emoji, nhóm, độ khó)'); else fail('Từ thiếu trường: ' + v.badShape.slice(0, 5).join(', '));
    const moved = orig.filter((w, i) => v.ws[i] !== w);
    if (!moved.length) ok(orig.length + ' từ gốc còn nguyên đúng vị trí đầu danh sách'); else fail('Từ gốc bị đổi/xóa/dịch chỗ: ' + moved.slice(0, 5).join(', '));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 6) "Học lại từ đầu": sao lưu, xóa tiến độ, tuần 1 bắt đầu thứ 2 sau ngày mai, đẩy lên Gist (mock), không lỗi
  console.log('\n[6] Học lại từ đầu');
  {
    calls.github.length = 0;
    const words = ['deploy', 'backlog', 'stakeholder', 'affordance', 'overwhelmed', 'exhausted'];
    const vocab = {}; words.forEach((w) => { vocab[w] = { box: 2, due: '2026-11-20', first: '2026-11-09' }; });
    const old = { v: 3, vset: 2, start: '2026-11-09', weekStarts: { 1: '2026-11-09' }, act: {}, bm: ['deploy'], notes: [], rv: [], sessions: { 'w1-1': 1, 'w1-2': 1 }, errors: { article: { count: 3, ex: [] } }, vocab, history: [], rp: { scen: 'first', msgs: [] }, vu: 5, upd: Date.now() - 1000 };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(old), 'eng-build': APP_BUILD, 'eng-gist-token': 'ghp_MOCK' });
    await page.clock.install({ time: new Date('2026-11-15T12:00:00') }); // Chủ nhật
    await page.goto(BASE + '#settings/data', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.click('#restart-btn');
    const armed = await page.evaluate(() => document.getElementById('restart-btn').textContent);
    if (/lần nữa/i.test(armed)) ok('Bấm lần 1 chỉ hỏi xác nhận'); else fail('Nút không hỏi xác nhận: ' + armed);
    const mid = await page.evaluate(() => JSON.parse(localStorage.getItem('eng-ux-state')).vocab.deploy ? 'keep' : 'lost');
    if (mid === 'keep') ok('Chưa xóa gì sau lần bấm đầu'); else fail('Dữ liệu bị xóa ngay lần bấm đầu');
    calls.github.length = 0;
    await page.click('#restart-btn');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      st: JSON.parse(localStorage.getItem('eng-ux-state')),
      baks: Object.keys(localStorage).filter((k) => k.startsWith('eng-bak-')),
      od: overdue().length, msg: document.getElementById('restart-msg').textContent,
      oldBak: Object.keys(localStorage).filter((k) => k.endsWith('-reset')).map((k) => JSON.parse(localStorage.getItem(k)).vocab).map((x) => Object.keys(x).length),
    }));
    if (!Object.keys(r.st.vocab).length && !Object.keys(r.st.sessions).length && !Object.keys(r.st.errors).length) ok('Đã xóa từ, buổi học, lỗi'); else fail('Chưa xóa sạch: ' + JSON.stringify({ v: Object.keys(r.st.vocab).length, s: Object.keys(r.st.sessions).length }));
    if (r.st.start === '2026-11-16' && r.st.weekStarts[1] === '2026-11-16') ok('Tuần 1 bắt đầu thứ 2 16/11'); else fail('Ngày bắt đầu sai: ' + r.st.start);
    if (r.oldBak.length && r.oldBak[0] === words.length) ok('Bản sao lưu "reset" giữ đủ ' + words.length + ' từ cũ'); else fail('Không có bản sao lưu reset đúng: ' + JSON.stringify(r.oldBak));
    if (r.st.rst) ok('Có mốc rst để các máy khác không ghi đè lại'); else fail('Thiếu S.rst');
    if (r.od === 0) ok('Chủ nhật trước tuần mới: không có buổi "quá hạn"'); else fail('Còn ' + r.od + ' buổi quá hạn trước khi tuần bắt đầu');
    if (calls.github.some((c) => c.startsWith('PATCH'))) ok('Đã đẩy trạng thái trống lên Gist (mock)'); else fail('Không thấy PATCH Gist sau reset: ' + calls.github.join(','));
    if (/Đã xóa tiến độ/.test(r.msg)) ok('Hiện thông báo xong'); else fail('Thông báo: ' + r.msg);
    if (errors.length) fail('Reset gây lỗi JS: ' + errors.join(' || '));
    // sang thứ 2: buổi hôm nay là Ngữ pháp (dow 1), không quá hạn, dữ liệu không đổi
    await page.clock.setFixedTime(new Date('2026-11-16T09:00:00'));
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({ t: todayTarget(), od: overdue().length, start: S.start, vocabN: Object.keys(S.vocab).length }));
    if (m.t === 1 && m.od === 0 && m.start === '2026-11-16') ok('Thứ 2 16/11: hôm nay là buổi Ngữ pháp, không quá hạn'); else fail('Sáng thứ 2 sai: ' + JSON.stringify(m));
    if (errors.length) fail('Lỗi JS sau reset: ' + errors.join(' || '));
    await context.close();
  }

  // 7) Luyện đề: từ vựng + nghe chép chạy offline (không gọi Gemini), loại AI cần key, có key thì soạn đề → làm → chấm
  console.log('\n[7] Luyện đề');
  {
    const STUB_VOICE = () => { try { speechSynthesis.getVoices = () => [{ lang: 'en-US', name: 'Google US English' }]; } catch (e) {} };
    const doSet = async (page, type, lv) => { // làm hết đề: câu chọn thì chọn đúng/sai xen kẽ, câu gõ thì gõ đúng hoặc sai
      await page.evaluate((t) => { location.hash = '#practice/' + t; }, type);
      await page.waitForTimeout(150);
      await page.click(`#px-lv [data-lv="${lv}"]`);
      await page.click('#px-go');
      await page.waitForFunction(() => location.hash.endsWith('/run') && !px.busy, null, { timeout: 8000 });
      const n = await page.evaluate(() => px.set.qs.length);
      for (let i = 0; i < n; i++) {
        const q = await page.evaluate(() => { const s = px.set, q = s.qs[s.i]; return { f: q.f, ans: q.ans, k: q.opts ? q.opts.indexOf(q.ans) : -1, no: q.opts ? q.opts.length : 0 }; });
        if (q.f === 'mcq') await page.click(`[data-oi="${i % 3 === 2 ? (q.k + 1) % q.no : q.k}"]`);
        else { await page.fill('#px-in', i % 3 === 2 ? 'zzz qqq' : q.ans); await page.click('#px-chk'); }
        await page.click('#px-next');
      }
      return n;
    };
    // 7a) không key: từ vựng ở cả 3 mức + nghe chép chạy được, 0 lần gọi Gemini
    calls.gemini.length = 0;
    {
      const { context, page, errors } = await newPage();
      await context.addInitScript(STUB_VOICE);
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      errors.length = 0;
      for (const lv of [1, 2, 3]) {
        const n = await doSet(page, 'vocab', lv);
        const txt = await page.evaluate(() => document.getElementById('px-box').innerText);
        if (n >= 8 && /\/\d+/.test(txt) && /Đề mới/.test(txt)) ok(`Từ vựng mức ${lv}: làm hết ${n} câu, ra kết quả + nút Đề mới`); else fail(`Từ vựng mức ${lv}: kết quả lạ (n=${n}): ${txt.slice(0, 80)}`);
      }
      // đề mới: bộ câu khác bộ cũ
      const a = await page.evaluate(() => px.set.qs.map((q) => q.q).join('|'));
      await page.click('#px-new');
      await page.waitForFunction(() => !px.busy && px.set && !px.set.done, null, { timeout: 5000 });
      const b = await page.evaluate(() => px.set.qs.map((q) => q.q).join('|'));
      if (a !== b) ok('Bấm "Đề mới" ra bộ câu khác'); else fail('Đề mới giống hệt đề cũ');
      const n2 = await doSet(page, 'listen', 2);
      if (n2 >= 8) ok('Nghe chép (offline) làm hết ' + n2 + ' câu'); else fail('Nghe chép chỉ có ' + n2 + ' câu');
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem('eng-ux-state')).px);
      if (st.hist.length === 4 && st.lv.vocab === 3 && st.lv.listen === 2) ok('Lưu lịch sử 4 đề + độ khó từng loại vào S.px'); else fail('S.px sai: ' + JSON.stringify(st));
      // loại cần AI mà chưa có key: nút Bắt đầu bị khóa, có hướng dẫn
      await page.evaluate(() => { location.hash = '#practice/grammar'; });
      await page.waitForTimeout(200);
      const dis = await page.evaluate(() => ({ d: document.getElementById('px-go').disabled, t: document.getElementById('px-box').innerText }));
      if (dis.d && /API key/.test(dis.t)) ok('Loại AI khi chưa có key: khóa nút Bắt đầu + chỉ dẫn dán key'); else fail('Loại AI chưa có key không bị khóa');
      if (!calls.gemini.length) ok('Từ vựng/nghe chép không gọi Gemini lần nào'); else fail('Gọi Gemini ' + calls.gemini.length + ' lần ở loại offline');
      if (errors.length) fail('Luyện đề (offline) lỗi JS: ' + errors.join(' || ')); else ok('Luyện đề (offline) không lỗi JS');
      await context.close();
    }
    // 7b) có key (mock): ngữ pháp do AI soạn, làm xong, câu sai vào hồ sơ lỗi
    calls.gemini.length = 0;
    {
      const { context, page, errors } = await newPage({ 'eng-gemini-key': 'AIzaMOCK' });
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      errors.length = 0;
      const n = await doSet(page, 'grammar', 2);
      const r = await page.evaluate(() => ({ t: document.getElementById('px-box').innerText, tags: Object.keys(S.errors), rv: S.rv.length }));
      if (n === 10 && calls.gemini.length >= 1) ok('Ngữ pháp: AI (mock) soạn ' + n + ' câu và làm xong'); else fail(`Ngữ pháp: n=${n}, gemini=${calls.gemini.length}`);
      if (/7\/10/.test(r.t) && r.tags.includes('to-be-agreement') && r.rv >= 1) ok('Câu sai được ghi vào hồ sơ lỗi và hàng ôn'); else fail('Kết quả/hồ sơ lỗi sai: ' + r.t.slice(0, 60) + ' ' + r.tags + ' rv=' + r.rv);
      if (errors.length) fail('Luyện đề (AI) lỗi JS: ' + errors.join(' || ')); else ok('Luyện đề (AI) không lỗi JS');
      await context.close();
    }
  }

  // 8) Viết phần 3: đủ 5 câu đúng thì đạt dù chưa bấm "Kết thúc"; từ của phần 1-2 không tính là đã dùng ở phần 3
  console.log('\n[8] Viết phần 3');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#s-1-4', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const x = wrGet(), w = wrVocab(), ok = (t) => ({ txt: t, ok: true, tries: 1, tags: [], changes: [] });
      x.a.m = ['I am a ' + w[0] + ' and ' + w[1], '', ''];
      x.cs = []; wrPart = 3; wrI[3] = 0; renderWrite();
      const used0 = document.getElementById('wr-words').querySelectorAll('.chip.on').length;
      x.cs = ['hi', "i'm a " + w[0], "i'm from " + w[1] + ' ' + w[2], 'i like it', 'i am happy'].map(ok); x.cfin = false;
      return { used0, pass: wrStat().cPass };
    });
    if (r.used0 === 0) ok('Phần 3 chưa viết: không tô từ đã dùng ở phần 1-2'); else fail('Từ phần 1-2 bị tính vào phần 3: ' + r.used0);
    if (r.pass) ok('5 câu đúng, chưa bấm Kết thúc vẫn Đạt phần 3'); else fail('5 câu đúng mà vẫn Chưa đạt phần 3');
    if (errors.length) fail('Lỗi JS ở bài Viết: ' + errors.join(' || '));
    await context.close();
  }

  // 9) Mục tiêu 30 phút/ngày: đo thời gian học thật, hiện ở Hôm nay, gợi ý Luyện đề; dữ liệu cũ chưa có S.tm vẫn tải được
  console.log('\n[9] Mục tiêu 30 phút');
  {
    const old = { v: 3, vset: 2, start: '2026-11-09', weekStarts: { 1: '2026-11-09' }, act: {}, bm: [], notes: [], rv: [], sessions: {}, errors: {}, vocab: {}, history: [], rp: { scen: 'first', msgs: [] }, upd: Date.now() };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(old), 'eng-build': APP_BUILD, 'eng-gemini-key': 'AIzaMOCK' });
    await page.clock.install({ time: new Date('2026-11-18T10:00:00') }); // Thứ 4: không có buổi bắt buộc
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.mouse.click(10, 300);
    await page.clock.runFor(30000);
    const r = await page.evaluate(() => ({ tm: Math.round(S.tm[today()] || 0), goal: !!document.querySelector('#t-cards .daygoal'), sg: document.querySelectorAll('#t-cards a[href^="#practice/"]').length }));
    if (r.tm >= 15 && r.tm <= 25) ok('Đo thời gian học thật: ' + r.tm + ' giây (một lần chạm chỉ tính tối đa ~20 giây)'); else fail('Đo thời gian sai: ' + r.tm);
    if (r.goal) ok('Màn Hôm nay có thẻ mục tiêu 30 phút'); else fail('Thiếu thẻ mục tiêu ở Hôm nay');
    if (r.sg >= 2) ok('Ngày nghỉ gợi ý ' + r.sg + ' loại Luyện đề để lấp thời gian'); else fail('Không gợi ý Luyện đề (' + r.sg + ')');
    await page.clock.runFor(70000); // không thao tác: không tính thêm
    const t2 = await page.evaluate(() => Math.round(S.tm[today()]));
    if (t2 - r.tm <= 3) ok('Treo máy / không thao tác thì ngừng tính giờ'); else fail('Vẫn tính giờ khi không thao tác: ' + (t2 - r.tm));
    const st = await page.evaluate(() => document.querySelector('[data-goal-st]').textContent);
    if (/Tạm dừng/.test(st)) ok('Thẻ mục tiêu báo "Tạm dừng" khi không thao tác'); else fail('Trạng thái sai: ' + st);
    if (errors.length) fail('Mục tiêu 30 phút gây lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 10) Mỗi buổi có thêm đề Luyện đề bắt buộc: đề làm trong ngày được tính cho đúng buổi; chưa làm đủ thì buổi chưa xong
  console.log('\n[10] Luyện đề bắt buộc theo buổi');
  {
    const { context, page, errors } = await newPage({ 'eng-gemini-key': 'AIzaMOCK' });
    await page.clock.install({ time: new Date('2026-11-17T10:00:00') }); // Thứ 3 = buổi Nghe & nói
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const ex = () => tasksFor(2).filter((t) => t.link).map((t) => ({ k: t.go, d: t.d }));
      const before = ex(), sd = pxAttrib('listen');
      pxS().hist.unshift({ id: 1, d: today(), k: 'listen', lv: 1, n: 10, ok: 8, sd, wk: 1 });
      pxS().hist.unshift({ id: 3, d: today(), k: 'listen', lv: 1, n: 10, ok: 7, sd: pxAttrib('listen'), wk: 1 }); // đề Nghe chép thứ 2
      pxS().hist.unshift({ id: 2, d: today(), k: 'talk', lv: 1, n: 10, ok: 3, sd: pxAttrib('talk'), wk: 1 }); // điểm thấp: không tính
      return { before, sd, after: ex() };
    });
    if (r.before.length === 2 && r.before.every((t) => !t.d)) ok('Buổi Nghe & nói có 2 đề Luyện đề bắt buộc (chưa làm)'); else fail('Thiếu đề bắt buộc: ' + JSON.stringify(r.before));
    if (r.sd === 2) ok('Đề Nghe chép làm hôm nay được gắn vào buổi Thứ 3'); else fail('Gắn buổi sai: ' + r.sd);
    if (r.after.find((t) => t.k === 'practice/listen').d && !r.after.find((t) => t.k === 'practice/talk').d) ok('Đề đạt ≥60% được tính, đề điểm thấp thì chưa'); else fail('Tính đề sai: ' + JSON.stringify(r.after));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 11) Thẻ cụm câu ở mức 2 không bắt "đặt câu" bằng chính câu đang hiện: chuyển sang nghe rồi gõ, không hiện chữ tiếng Anh
  console.log('\n[11] Thẻ cụm câu mức 2');
  {
    const { context, page, errors } = await newPage({ 'eng-gemini-key': 'AIzaMOCK' });
    await context.addInitScript(() => { try { speechSynthesis.getVoices = () => [{ lang: 'en-US', name: 'Google US English' }]; } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const ph = VOCAB.find((c) => c.ph), w = VOCAB.find((c) => !c.ph && c.cat !== 'talk');
      S.vocab[ph.w] = { box: 2, due: '2020-01-01', first: today() }; S.vocab[w.w] = { box: 2, due: '2020-01-01', first: today() };
      return { phrase: cardMode(ph), word: cardMode(w), ph: ph.w };
    });
    if (r.phrase === 'listen') ok('Thẻ cụm câu mức 2 → nghe rồi gõ'); else fail('Thẻ cụm câu vẫn là: ' + r.phrase);
    if (r.word === 'use') ok('Thẻ từ đơn mức 2 vẫn là đặt câu'); else fail('Thẻ từ đơn đổi sai: ' + r.word);
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 12) Dùng từ vựng: 2 tab (Đặt câu / Kể chuyện); số từ cần dùng không vượt số từ có sẵn
  console.log('\n[12] Dùng từ vựng: 2 tab');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#s-1-5', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      S.vocab.deploy = { box: 1, due: '2030-01-01', first: today() }; S.vocab.backlog = { box: 1, due: '2030-01-01', first: today() };
      vuTab = 'sent'; renderVuse();
      const a = { c1: !document.getElementById('vu-card1').classList.contains('hidden'), c2: !document.getElementById('vu-card2').classList.contains('hidden') };
      document.querySelector('[data-vt="story"]').click();
      const b = { c1: !document.getElementById('vu-card1').classList.contains('hidden'), c2: !document.getElementById('vu-card2').classList.contains('hidden') };
      return { a, b, tabs: document.querySelectorAll('[data-vt]').length, need: storyNeed(), words: storyWords().length };
    });
    if (r.tabs === 2 && r.a.c1 && !r.a.c2 && !r.b.c1 && r.b.c2) ok('2 tab: mỗi lúc chỉ hiện 1 bài (Đặt câu / Kể chuyện)'); else fail('Tab sai: ' + JSON.stringify(r));
    if (r.need === Math.min(4, r.words) && r.need <= r.words) ok('Số từ cần dùng (' + r.need + ') không vượt số từ gợi ý (' + r.words + ')'); else fail('Cần ' + r.need + ' từ nhưng chỉ có ' + r.words);
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 13) Bài Viết: dữ liệu đã lưu giữ nguyên (3 tin / 2 UX / ≥4 câu); bộ mới tạo ra (tuần sau, Đổi đề) là 5 / 3 / 5
  console.log('\n[13] Bài Viết: số câu theo dữ liệu đã lưu');
  {
    const old = { v: 3, vset: 2, start: '2026-11-09', weekStarts: { 1: '2026-11-09' }, act: {}, bm: [], notes: [], rv: [], sessions: {}, errors: {}, vocab: {}, history: [], rp: { scen: 'first', msgs: [] },
      wr: { wk: 1, mi: [0, 1, 2], ci: 3, cw: 0, mw: true, ui: [0, 1], a: { m: ['a', 'b', 'c'], u: ['x', 'y'] }, rm: [null, null, null], ru: [null, null], cs: [], cdraft: '' }, upd: Date.now() };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(old), 'eng-build': APP_BUILD });
    await page.goto(BASE + '#s-1-4', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const st0 = wrStat(), t0 = tasksBase(4).map((t) => t.l);
      const nw = wrPick(), saved = S.wr; S.wr = nw;
      const st1 = wrStat(), t1 = tasksBase(4).map((t) => t.l), m = [0, 1, 2, 3, 4].map((i) => wrMsg(nw, i).m);
      S.wr = saved;
      return { st0: [st0.aT, st0.uT, st0.cMin, st0.aNeed], st1: [st1.aT, st1.uT, st1.cMin, st1.aNeed], t0, t1, m };
    });
    if (JSON.stringify(r.st0) === '[3,2,4,2]') ok('Dữ liệu đã lưu giữ 3 tin / 2 UX / ≥4 câu'); else fail('Dữ liệu cũ bị đổi: ' + JSON.stringify(r.st0));
    if (JSON.stringify(r.st1) === '[5,3,5,4]') ok('Bộ mới: 5 tin (đúng ≥4) / 3 UX / ≥5 câu'); else fail('Bộ mới sai: ' + JSON.stringify(r.st1));
    if (r.m.every((x) => x && x.length > 3)) ok('Cả 5 tin nhắn của bộ mới đều có nội dung'); else fail('Thiếu tin nhắn: ' + JSON.stringify(r.m));
    if (/Trả lời 5 tin/.test(r.t1[0]) && /Trả lời 3 tin/.test(r.t0[0])) ok('Nhãn việc theo số câu của từng bộ'); else fail('Nhãn việc sai: ' + r.t0[0] + ' / ' + r.t1[0]);
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 14) Sổ tay có tab Từ vựng: toàn bộ kho từ (đã học + chưa học), tìm kiếm, lọc
  console.log('\n[14] Sổ tay: tab Từ vựng');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#notebook', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.click('#nb-seg [data-t="vocab"]');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      S.vocab.deploy = { box: 2, due: '2030-01-01', first: today() }; renderNbVocab();
      const chips = [...document.querySelectorAll('#nb-vocab .chip')].map((x) => x.textContent), n0 = document.querySelectorAll('#nbv-list .vr').length;
      const q = document.getElementById('nbv-q'); q.value = 'deploy'; q.dispatchEvent(new Event('input'));
      const found = [...document.querySelectorAll('#nbv-list .vr b')].map((x) => x.textContent);
      q.value = ''; q.dispatchEvent(new Event('input')); document.querySelector('[data-f="learned"]').click();
      const learned = [...document.querySelectorAll('#nbv-list .vr b')].map((x) => x.textContent);
      return { chips, n0, found, learned, total: VOCAB.length };
    });
    if (r.chips[0] === 'Tất cả ' + r.total && r.total >= 720) ok('Tab Từ vựng liệt kê toàn bộ ' + r.total + ' từ (đã học lẫn chưa học)'); else fail('Số từ sai: ' + JSON.stringify(r.chips));
    if (r.n0 === 80) ok('Hiện 80 từ đầu, có nút Xem thêm'); else fail('Số dòng đầu: ' + r.n0);
    if (r.found.includes('deploy') && r.found.length <= 3) ok('Tìm kiếm theo từ tiếng Anh'); else fail('Tìm kiếm sai: ' + JSON.stringify(r.found));
    if (r.learned.length === 1 && r.learned[0] === 'deploy') ok('Lọc "Đã học" chỉ còn từ đã học'); else fail('Lọc đã học sai: ' + JSON.stringify(r.learned));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 15) Ô số tiến độ bấm được để xem lại câu đã làm (Đặt câu, Luyện đề)
  console.log('\n[15] Xem lại câu đã làm');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#s-1-5', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const v = vu8Get(); v.res[v.words[0]] = { ok: true, ans: 'a', right: 'a', why: '' }; v.res[v.words[1]] = { ok: false, ans: 'bad', right: 'good one', why: 'x' }; vuSt = 'ask'; renderVuse();
      const cur = document.querySelector('#vu-box .fc-wrow span').textContent;
      document.querySelector('[data-vw]:nth-child(2)').click();
      const rev = document.getElementById('vu-box').innerText.includes('good one');
      document.getElementById('vu-next').click();
      return { rev, back: document.querySelector('#vu-box .fc-wrow span').textContent === cur };
    });
    if (r.rev) ok('Đặt câu: bấm ô đã làm → xem lại câu và đáp án'); else fail('Không xem lại được câu đã làm');
    if (r.back) ok('Đặt câu: sau khi xem lại quay về từ đang làm'); else fail('Không quay về từ đang làm');
    await page.evaluate(() => { location.hash = '#practice/vocab'; });
    await page.waitForTimeout(200);
    await page.click('#px-go'); await page.waitForTimeout(300);
    for (let i = 0; i < 3; i++) { await page.click('[data-oi="0"]'); await page.click('#px-next'); }
    await page.click('[data-pj="1"]'); await page.waitForTimeout(150);
    const p2 = await page.evaluate(() => ({ i: px.set.i, fb: !!document.querySelector('#px-box .result') }));
    await page.click('[data-pj="8"]'); await page.waitForTimeout(100);
    const p3 = await page.evaluate(() => px.set.i);
    if (p2.i === 1 && p2.fb && p3 === 1) ok('Luyện đề: xem lại câu đã làm, ô chưa tới không bấm được'); else fail('Luyện đề xem lại sai: ' + JSON.stringify([p2, p3]));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 16) Lưu câu hỏi–đáp với AI (nút "?") vào Ghi chú để xem lại
  console.log('\n[16] Lưu hỏi đáp vào Ghi chú');
  {
    const { context, page, errors } = await newPage({ 'eng-gemini-key': 'AIzaMOCK' });
    await page.goto(BASE + '#practice', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('px-box').innerHTML = '<div id="t">' + svBtn({ w: 'I add', r: 'I adding', why: 'Sau suggest cần -ing', src: 'Test', q: 'q' }) + '</div>'; });
    await page.click('#t [data-qa]');
    await page.fill('#t .qa-in', 'những từ nào cần -ing?');
    await page.click('#t [data-qago]');
    await page.waitForSelector('#t .qa-a + .savebtn', { timeout: 5000 });
    await page.click('#t .qa-a + .savebtn');
    const n = await page.evaluate(() => S.notes[0]);
    if (n && n.ask === 'những từ nào cần -ing?' && n.why) ok('Bấm nút lưu dưới câu trả lời AI → vào Ghi chú (kèm câu hỏi)'); else fail('Ghi chú không lưu hỏi đáp: ' + JSON.stringify(n));
    await page.evaluate(() => { location.hash = '#notebook'; });
    await page.waitForTimeout(300);
    await page.click('#nb-seg [data-t="notes"]');
    const t = await page.evaluate(() => document.getElementById('nt-list').innerText);
    if (t.includes('những từ nào cần -ing?')) ok('Tab Ghi chú hiện lại câu hỏi và câu trả lời đã lưu'); else fail('Ghi chú không hiện: ' + t.slice(0, 80));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 17) Sổ tay → Lý thuyết → Tra cứu nhanh: loại từ và khái niệm ngữ pháp (trạng từ, giới từ, -ing hay to...)
  console.log('\n[17] Tra cứu loại từ');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#notebook', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.click('#nb-seg [data-t="theory"]');
    await page.waitForTimeout(300);
    const segs = await page.evaluate(() => [...document.querySelectorAll('#th-seg .chip')].map((x) => x.textContent));
    if (segs.join() === 'Cẩm nang,Sách giáo khoa') ok('Lý thuyết chia 2 tab: Cẩm nang | Sách giáo khoa'); else fail('Tab Lý thuyết sai: ' + segs);
    await page.click('#th-seg [data-th="ref"]');
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const n0 = document.querySelectorAll('#rf-list [data-rf]').length;
      const q = document.getElementById('rf-q'); q.value = 'trạng từ'; q.dispatchEvent(new Event('input'));
      const first = document.querySelector('#rf-list [data-rf] b').textContent;
      q.value = 'suggest'; q.dispatchEvent(new Event('input'));
      const sug = [...document.querySelectorAll('#rf-list [data-rf] b')].map((x) => x.textContent);
      const empties = []; for (let i = 0; i < REF.length; i++) { nbRef = i; renderNbTheory(); const t = document.getElementById('nb-theory').innerText; if (t.length < 400) empties.push(REF[i].k); }
      nbRef = null; renderNbTheory();
      return { n0, first, sug, empties, keys: REF.map((x) => x.k) };
    });
    if (r.n0 >= 14) ok('Tra cứu có ' + r.n0 + ' mục (loại từ, giới từ, trạng từ, -ing hay to, cụm động từ...)'); else fail('Thiếu mục tra cứu: ' + r.n0);
    if (/Trạng từ/.test(r.first)) ok('Gõ "trạng từ" → mục Trạng từ lên đầu'); else fail('Tìm trạng từ sai: ' + r.first);
    if (r.sug.some((t) => /-ing hay to/.test(t))) ok('Gõ "suggest" → ra mục "Sau động từ: -ing hay to?"'); else fail('Tìm suggest sai: ' + JSON.stringify(r.sug));
    if (!r.empties.length && ['adverb', 'preposition', 'ing-to'].every((k) => r.keys.includes(k))) ok('Mọi mục đều có nội dung và mở được'); else fail('Mục trống: ' + r.empties.join(','));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 18) Sổ tay: ô tìm trong "Từ đã lưu" và "Ghi chú"; xóa khi đang lọc vẫn xóa đúng mục
  console.log('\n[18] Tìm trong Từ đã lưu và Ghi chú');
  {
    const st = { v: 3, vset: 2, bm: [{ t: 'deploy', vi: 'triển khai' }, { t: 'backlog', vi: 'tồn đọng' }, { t: 'suggest', vi: 'gợi ý' }], notes: [{ k: 'a', r: '', why: 'Sau suggest cần -ing', ask: 'những từ nào cần ing' }, { k: 'b', r: 'I am a designer.', why: 'Cần có to be' }] };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(st), 'eng-build': APP_BUILD });
    await page.goto(BASE + '#notebook', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.click('#nb-seg [data-t="words"]');
    await page.fill('#bm-q', 'gợi ý');
    const w = await page.evaluate(() => [...document.querySelectorAll('#bm-list .bt')].map((x) => x.textContent));
    await page.fill('#bm-q', 'deploy'); await page.click('#bm-list [data-bdel]');
    const left = await page.evaluate(() => S.bm.map((b) => b.t));
    await page.click('#nb-seg [data-t="notes"]');
    await page.fill('#nt-q', 'to be');
    const n = await page.evaluate(() => document.querySelectorAll('#nt-list .bmrow').length);
    await page.fill('#nt-q', 'ing'); await page.click('#nt-list [data-ndel]');
    const keep = await page.evaluate(() => S.notes.map((x) => x.k));
    if (w.length === 1 && w[0] === 'suggest') ok('Từ đã lưu: tìm theo nghĩa tiếng Việt'); else fail('Tìm từ đã lưu sai: ' + JSON.stringify(w));
    if (left.join() === 'backlog,suggest') ok('Xóa khi đang lọc xóa đúng từ'); else fail('Xóa nhầm: ' + left);
    if (n === 1 && keep.join() === 'b') ok('Ghi chú: tìm trong nội dung và xóa đúng mục'); else fail('Ghi chú sai: ' + n + ' ' + keep);
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }

  // 19) Sổ tay có nút mở rộng: phủ kín màn hình nhưng vẫn là drawer; nhớ lựa chọn
  console.log('\n[19] Sổ tay mở rộng');
  {
    const { context, page, errors } = await newPage();
    await page.goto(BASE + '#notebook', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const m = () => page.evaluate(() => { const d = document.getElementById('nb-drawer'), r = d.getBoundingClientRect(); return { full: d.classList.contains('full'), h: Math.round(r.height), w: Math.round(r.width), vh: innerHeight, vw: innerWidth, drawer: d.classList.contains('on'), saved: localStorage.getItem('eng-nbfull') }; });
    const a = await m();
    await page.click('#nb-expand');
    const b2 = await m();
    if (!a.full && b2.full && b2.h >= b2.vh - 1 && b2.w >= b2.vw - 1 && b2.drawer) ok('Bấm mở rộng: sổ tay phủ kín màn hình (vẫn là drawer)'); else fail('Mở rộng sai: ' + JSON.stringify([a, b2]));
    if (b2.saved === '1') ok('Nhớ lựa chọn mở rộng'); else fail('Không lưu lựa chọn: ' + b2.saved);
    await page.click('#nb-expand');
    const c2 = await m();
    if (!c2.full && c2.h < c2.vh) ok('Bấm lần nữa: thu nhỏ lại'); else fail('Thu nhỏ sai: ' + JSON.stringify(c2));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }
  // 20) Tuần 2: tuần 1 xong 4/5 (bỏ Thứ 7) → Thứ 2 tự sang tuần 2, có buổi Ngữ pháp tuần 2, bộ bài tuần 1 được cất lại
  console.log('\n[20] Sang tuần 2');
  {
    const st = { v: 3, vset: 2, start: '2026-11-16', weekStarts: { 1: '2026-11-16' }, act: { '2026-11-16': 20 }, bm: [], notes: [], rv: [], vocab: {}, history: [], errors: {},
      sessions: { 'w1-1': '2026-11-16', 'w1-2': '2026-11-17', 'w1-4': '2026-11-19', 'w1-5': '2026-11-20' }, rp: { scen: 'first', msgs: [] },
      ex: { v: 4, src: 'static', items: [{ level: 1, type: 'mcq', q: 'I ___ a UI/UX designer.', options: ['am', 'is', 'are'], answer: 'am', explain: '', tag: 'to-be-agreement' }], answers: { 0: { ok: true, a: 'am' } } }, upd: Date.now() - 1000 };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(st), 'eng-build': APP_BUILD, 'eng-gemini-key': 'AIzaMOCK' });
    await page.clock.install({ time: new Date('2026-11-23T09:00:00') }); // Thứ 2 tuần sau
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => { const h = document.querySelector('#t-cards .hcard'); return { wk: curWeek(), href: h && h.getAttribute('href'), txt: h && h.textContent, bmc: [...document.querySelectorAll('.nb-link .bmc')].map((x) => x.textContent).join(''), ctx: learnerCtx() }; });
    if (t.wk === 2) ok('Đủ 4/5 buổi: Thứ 2 tự sang tuần 2'); else fail('Tuần hiện tại sai: ' + t.wk);
    if (t.href === '#d-1' && /What\/Where\/Who/.test(t.txt)) ok('Thẻ chính là buổi Ngữ pháp tuần 2'); else fail('Thẻ chính sai: ' + JSON.stringify([t.href, t.txt]));
    if (/Current week: 2/.test(t.ctx) && /Wh- questions/.test(t.ctx)) ok('Lời nhắc AI theo tuần 2'); else fail('learnerCtx chưa theo tuần 2');
    if (t.bmc === '') ok('Icon sổ tay không còn số đếm'); else fail('Icon sổ tay còn số: ' + t.bmc);
    await page.click('#t-cards .hcard');
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ v: !document.getElementById('v-session').classList.contains('hidden'), exwk: S.ex.wk, q0: S.ex.items[0].q, old: S.wkh && S.wkh[1] && S.wkh[1].ex && S.wkh[1].ex.answers[0] && S.wkh[1].ex.answers[0].a, done: !!S.sessions['w2-1'] }));
    if (g.v && g.exwk === 2 && /manager/.test(g.q0)) ok('Mở buổi: bộ bài ngữ pháp tuần 2'); else fail('Buổi ngữ pháp tuần 2 sai: ' + JSON.stringify(g));
    if (g.old === 'am') ok('Bộ bài tuần 1 được cất ở S.wkh[1], không mất'); else fail('Mất bộ bài tuần 1');
    if (!g.done) ok('Buổi tuần 2 chưa bị tính xong sẵn'); else fail('Buổi tuần 2 bị tính xong sẵn');
    await page.goto(BASE + '#lessons', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const l = await page.evaluate(() => ({ k: document.getElementById('ls-k').textContent, a: [...document.querySelectorAll('#lesson-list a.pnode')].map((x) => x.getAttribute('href')), place: document.getElementById('ls-place').innerHTML }));
    if (l.k === 'Tuần 2/24' && l.a.includes('#s-2-1') && l.a.includes('#s-2-6') && !l.place) ok('Bài học: lộ trình tuần 2, ẩn bài xếp tuần'); else fail('Bài học tuần 2 sai: ' + JSON.stringify(l));
    await page.goto(BASE + '#s-2-6', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const p = await page.evaluate(() => ({ v: !document.getElementById('b-product').classList.contains('hidden'), h: document.getElementById('p-h').textContent }));
    if (p.v && /công việc và team/.test(p.h)) ok('Sản phẩm tuần 2: giới thiệu công việc và team'); else fail('Sản phẩm tuần 2 sai: ' + JSON.stringify(p));
    if (errors.length) fail('Lỗi JS tuần 2: ' + errors.join(' || '));
    await context.close();
  }
  // 21) Giữ dữ liệu tuần 1 khi sang tuần 2: cất vào S.wkh[1], lấy lại phần bị bản cũ thay mất từ sao lưu, mở lại buổi tuần 1 làm tiếp
  console.log('\n[21] Giữ và mở lại dữ liệu tuần 1');
  {
    const ex1 = { v: 4, src: 'static', items: [{ level: 1, type: 'mcq', q: 'I ___ a UI/UX designer.', options: ['am', 'is', 'are'], answer: 'am', explain: '', tag: 'to-be-agreement' }, { level: 2, type: 'translate', q: 'Dịch: Tôi là designer.', answer: 'I am a designer.', accept: [], explain: '', tag: 'article' }], answers: { 0: { ok: true, a: 'am' } } };
    const wr1 = { wk: 1, mi: [0, 1, 2], ci: 0, a: { m: ['Hi Ben, yes I am.', '', ''], u: ['', '', ''] }, rm: [null, null, null], ru: [null, null, null], cs: [], cdraft: 'My team is small.' };
    // trạng thái hiện tại: bản cũ của app đã thay S.w và S.wr bằng bộ tuần 2 (mất dữ liệu tuần 1), chỉ còn trong bản sao lưu
    const st = { v: 3, vset: 2, start: '2026-11-16', weekStarts: { 1: '2026-11-16', 2: '2026-11-23' }, act: { '2026-11-16': 20 }, bm: [], notes: [], rv: [], vocab: {}, history: [], errors: {},
      sessions: { 'w1-1': '2026-11-16', 'w1-2': '2026-11-17', 'w1-4': '2026-11-19', 'w1-5': '2026-11-20' },
      w: { n: 2, vocabRated: 0, vocabCleared: false, rpTurns: 0, story: false, grammarSeen: false, burstStreak: 0, burstBest: 0, quickBest: 0 },
      ex: ex1, rp: { scen: 'first', msgs: [{ r: 'ai', t: 'Hi! Are you the new designer?' }, { r: 'me', t: 'Yes I am' }] },
      product: { text: 'Hi, I am Nam. I am a designer from Hue.', wk: 1, v: { score: 7, polished: 'Hi, I\'m Nam.', comments_vi: [] } },
      wr: { wk: 2, mi: [0, 1, 2], ci: 0, a: { m: ['', '', ''], u: ['', '', ''] }, rm: [null, null, null], ru: [null, null, null], cs: [] }, upd: Date.now() - 1000 };
    const bak = { ...st, w: { n: 1, vocabRated: 0, vocabCleared: false, rpTurns: 4, story: true, grammarSeen: true, burstStreak: 0, burstBest: 5, quickBest: 4 }, wr: wr1, weekStarts: { 1: '2026-11-16' } };
    const { context, page, errors } = await newPage({ 'eng-ux-state': JSON.stringify(st), 'eng-build': APP_BUILD, 'eng-bak-1763700000000-day': JSON.stringify(bak) });
    await page.clock.install({ time: new Date('2026-11-23T10:00:00') });
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const a = await page.evaluate(() => { const h = S.wkh[1] || {}; return { wk: curWeek(), hw: h.w && h.w.burstBest, hwr: h.wr && h.wr.a.m[0], hex: h.ex && h.ex.answers[0] && h.ex.answers[0].a, hrp: h.rp && h.rp.msgs.length, hp: h.product && h.product.text, live: { w: S.w && S.w.n, rp: S.rp.msgs.length, p: S.product, wr: S.wr && S.wr.wk } }; });
    if (a.wk === 2 && a.hex === 'am' && a.hrp === 2 && /Nam/.test(a.hp)) ok('Bài ngữ pháp, roleplay, sản phẩm tuần 1 được cất ở S.wkh[1]'); else fail('Cất tuần 1 sai: ' + JSON.stringify(a));
    if (a.hw === 5 && a.hwr === 'Hi Ben, yes I am.') ok('Lấy lại tiến độ + bài Viết tuần 1 từ bản sao lưu'); else fail('Không lấy lại được từ sao lưu: ' + JSON.stringify(a));
    if (a.live.rp === 0 && !a.live.p && (a.live.wr === 2 || a.live.wr == null)) ok('Tuần 2 bắt đầu sạch, không lẫn bài tuần 1'); else fail('Tuần 2 lẫn dữ liệu tuần 1: ' + JSON.stringify(a.live));
    await page.goto(BASE + '#lessons', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const l = await page.evaluate(() => [...document.querySelectorAll('#ls-past a.lrow')].map((x) => x.getAttribute('href')));
    if (l.includes('#s-1-6') && l.includes('#s-1-1')) ok('Bài học: "Tuần đã học" có link mở lại từng buổi tuần 1'); else fail('Thiếu link buổi tuần 1: ' + JSON.stringify(l));
    await page.goto(BASE + '#s-1-6', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const p = await page.evaluate(() => ({ wk: curWeek(), t: document.getElementById('p-text').value, h: document.getElementById('p-h').textContent, res: document.getElementById('p-result').textContent }));
    if (p.wk === 1 && /Nam/.test(p.t) && /tự giới thiệu/.test(p.h) && /7\/10/.test(p.res)) ok('Mở lại Sản phẩm tuần 1: còn bài đã viết và điểm'); else fail('Mở lại Sản phẩm tuần 1 sai: ' + JSON.stringify(p));
    await page.goto(BASE + '#s-1-1', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => ({ wk: curWeek(), q: S.ex.items[0].q, a: S.ex.answers[0] && S.ex.answers[0].a, seen: W().grammarSeen, bb: W().burstBest }));
    if (g.wk === 1 && /designer/.test(g.q) && g.a === 'am' && g.seen && g.bb === 5) ok('Mở lại Ngữ pháp tuần 1: còn đáp án và tiến độ'); else fail('Mở lại Ngữ pháp tuần 1 sai: ' + JSON.stringify(g));
    await page.goto(BASE + '#s-1-4', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ wk: S.wr && S.wr.wk, m: S.wr && S.wr.a.m[0], d: S.wr && S.wr.cdraft }));
    if (w.wk === 1 && w.m === 'Hi Ben, yes I am.' && w.d === 'My team is small.') ok('Mở lại Viết tuần 1: còn câu đã viết và bản nháp'); else fail('Mở lại Viết tuần 1 sai: ' + JSON.stringify(w));
    await page.reload({ waitUntil: 'load' }); // tải lại giữa chừng khi đang xem tuần cũ
    await page.waitForTimeout(500);
    await page.goto(BASE + '#today', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const b2 = await page.evaluate(() => ({ wk: curWeek(), w: W().n, ex: S.ex && S.ex.wk, h1ex: S.wkh[1].ex && S.wkh[1].ex.answers[0].a, h1wr: S.wkh[1].wr && S.wkh[1].wr.a.m[0], h1p: S.wkh[1].product && S.wkh[1].product.text, hero: document.querySelector('#t-cards .hcard').getAttribute('href'), saved: JSON.parse(localStorage.getItem('eng-ux-state')).wkh[1] ? 1 : 0 }));
    if (b2.wk === 2 && b2.w === 2 && b2.h1ex === 'am' && b2.h1wr === 'Hi Ben, yes I am.' && /Nam/.test(b2.h1p) && b2.hero === '#d-1' && b2.saved) ok('Về Hôm nay: lại là tuần 2, dữ liệu tuần 1 vẫn cất đủ (kể cả sau khi tải lại trang)'); else fail('Quay về tuần 2 sai: ' + JSON.stringify(b2));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
    await context.close();
  }
  // 22) Ngữ pháp - Khởi động: chạm là chấm; sai thì giấu đáp án đúng, nút chính "Vì sao?"; đúng thì nút chính "Tiếp"
  console.log('\n[22] Khởi động kiểu chạm là chấm');
  {
    const { context, page, errors } = await newPage();
    await page.clock.install({ time: new Date('2026-11-16T09:00:00') });
    await page.goto(BASE + '#s-1-1', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await page.evaluate(() => { closeDrawer(true); showLv(1); });
    await page.waitForTimeout(300);
    const st = () => page.evaluate(() => { const nav = document.querySelector('#ex-list .exnav.qa'); return {
      cls: [...document.querySelectorAll('#ex-list .qopt')].map((b) => b.className.replace(/opt qopt ?/, '').trim()),
      nav: nav ? nav.className : '', pri: nav && nav.querySelector('.btn.pri') ? nav.querySelector('.btn.pri').textContent : '', lnk: nav && nav.querySelector('.lnk') ? nav.querySelector('.lnk').textContent : '',
      fb: !!document.querySelector('#ex-list .fb'), vd: nav && nav.querySelector('.vd-t') ? nav.querySelector('.vd-t').textContent : '' }; });
    const q0 = await page.evaluate(() => { const it = S.ex.items[0]; return { ans: it.answer, opts: it.options }; });
    const wrongO = q0.opts.find((o) => o !== q0.ans);
    const before = await st();
    if (before.cls.length === 3 && !before.nav) ok('Câu chọn: 3 thẻ đáp án, chưa có thanh đáy (không cần nút Kiểm tra)'); else fail('Trước khi chọn sai: ' + JSON.stringify(before));
    await page.click(`#ex-list .qopt[data-o="${wrongO}"]`);
    const a = await st();
    if (a.cls.filter((c) => c === 'wrong').length === 1 && !a.cls.includes('right') && /vno/.test(a.nav) && /Vì sao/.test(a.pri) && /Tiếp/.test(a.lnk) && !a.fb && /Chưa đúng/.test(a.vd)) ok('Chọn sai: tô đỏ đáp án đã chọn, chưa lộ đáp án đúng, nút chính "Vì sao?"'); else fail('Chọn sai sai: ' + JSON.stringify(a));
    await page.click('#ex-why');
    const b = await st();
    if (b.cls.includes('right') && b.fb && /Tiếp|kết quả/.test(b.pri) && !b.lnk) ok('Bấm "Vì sao?": hiện đáp án đúng + giải thích, nút chính thành "Tiếp"'); else fail('Sau Vì sao sai: ' + JSON.stringify(b));
    await page.click('#ex-next');
    const q1 = await page.evaluate(() => S.ex.items[1].answer);
    await page.click(`#ex-list .qopt[data-o="${q1}"]`);
    const c = await st();
    if (c.cls.filter((x) => x === 'right').length === 1 && /vok/.test(c.nav) && /Tiếp/.test(c.pri) && /Giải thích/.test(c.lnk) && !c.fb) ok('Chọn đúng: tô xanh, nút chính "Tiếp" + link "Giải thích"'); else fail('Chọn đúng sai: ' + JSON.stringify(c));
    if (errors.length) fail('Lỗi JS: ' + errors.join(' || '));
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
