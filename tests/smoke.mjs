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
    await page.goto(BASE + '#settings', { waitUntil: 'load' });
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
