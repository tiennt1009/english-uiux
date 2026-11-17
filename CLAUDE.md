# EN UIUX — hướng dẫn cho Claude

App học tiếng Anh **một file HTML** (`index.html`, ~4450 dòng, không build) cho UI/UX designer người Việt, trình độ A1,
mục tiêu 6-12 tháng đủ đi làm/phỏng vấn. Người dùng học chủ yếu trên **Android Chrome**.
Lịch sử chi tiết, ghi chú kiến trúc, cạm bẫy: xem [HANDOFF.md](HANDOFF.md).

## Deploy
- Repo `github.com/tiennt1009/english-uiux` (public), nhánh `main`. Pages: `tiennt1009.github.io/english-uiux`.
- Deploy = `git push origin HEAD:main`; Pages cập nhật sau ~1 phút. Không có bước build.
- Trước khi push: `cd tests && npm install && npm test` (cần Chrome). Chỉ push khi PASS, không lỗi JS.

## Quy tắc bắt buộc — BẢO VỆ DỮ LIỆU HỌC (ưu tiên cao nhất)
- Tiến độ nằm ở localStorage `eng-ux-state` (+ Gist nếu bật đồng bộ). **Không đổi tên key này.**
- Không đổi cấu trúc `S` theo kiểu làm mất dữ liệu cũ. Chỉ **thêm** trường mới (mặc định trong `DEF` và/hoặc `migrate()`).
  Không xóa/đổi tên trường cũ khi chưa chuyển dữ liệu. Lưu ý `Object.assign(DEF, saved)` chỉ gộp nông.
- `migrate()` nhánh `S.vset!==2` **xóa từ trong `S.vocab` không có trong `VOCAB`** → khi sửa `VOCAB`, giữ nguyên mọi từ `w` đã có.
- Thứ tự `VOCAB` quyết định từ nào được mở (`vIdx()`, `S.vu`) → **chỉ thêm từ mới vào CUỐI `VMORE`**, không chèn giữa, không đổi thứ tự.
- Mỗi lần sửa `migrate()` / cấu trúc `S` / `VOCAB`: **đổi `APP_BUILD`** (hằng cạnh `BK=`) để máy tự `bakSave` trước khi chạy code mới.
- Không bao giờ hardcode hoặc xin API key trong chat/code. Key do người dùng dán ở tab Cài đặt (localStorage).

## Quy ước làm việc
- UI đơn giản, ngắn gọn, dễ hiểu; chữ ngắn; mỗi lần chỉ hiện 1 thứ.
- Mỗi chuỗi giao diện mới phải có mục trong từ điển `I18N` (có bản tiếng Anh). Chuỗi có số dùng `#` (xem `trLookup`).
- **KHÔNG chấm lỗi viết hoa và dấu câu** (đã có `capOk`, `addErr` chặn). Lời nhắc AI mới phải dùng `learnerCtx()` và `tagList()`.
- Tiếng Việt luôn có dấu trong mọi chuỗi và lời nhắc AI (`VIRULE`, `noDiaAny` tự retry nếu thiếu dấu).
- Trả lời người dùng bằng tiếng Việt, ngắn gọn; nói rõ cái gì đã test và cái gì CHƯA test (điện thoại thật, Gemini thật).
- Sau thay đổi lớn: cập nhật HANDOFF.md/CLAUDE.md rồi commit. Hỏi người dùng chỉ khi thật sự bị chặn.

## AI (đọc từ code, `call()` ~dòng 941)
**Chỉ còn Gemini** (đã bỏ kết nối Claude ngày 15/11/2026 theo yêu cầu người dùng; không thêm lại nếu chưa được hỏi):
- Key `eng-gemini-key` dán ở Cài đặt → chuỗi model `FALLBACK`/`FAST` (cuối là Gemma); model hết lượt bị `setSkip`.
- Khối script 1 xóa `eng-claude-key`, `eng-claude-model`, `eng-skip-claude` khỏi localStorage mỗi lần tải.
- Không có key: các bài có sẵn vẫn chạy; phần AI chấm/ra bài bị khóa.

## Cấu trúc code (một file, 3 khối `<script>`)
| Khối / chỗ | Nội dung |
|---|---|
| Script 1 (~927-1029) | Lớp AI: `call()` điều phối, `callOne` (Gemini), `sample`/`sample.json`; gán `window.claude={use}` (tiện ích giả lập "sample"; "dictation"/"tts" trả null) |
| Dữ liệu (~1033-1278) | `TAGS`, `SESS`, `VOCAB=[]` rồi `VMORE` (727 từ; `VMORE.forEach` push vào `VOCAB`), `IPA`, `STATIC_EX`, `PLACE`, `SCEN` (roleplay) |
| State (~1281-1325) | `DEF`, `S`, `APP_BUILD`, `bakSave`/`bakList`/`prog`, `migrate()`, `save()`/`flush()` |
| Đồng bộ (~1327-1371) | Gist riêng tư: `gapi`, `gistRef`, `pullSync()` (bên có `upd` mới hơn hoặc "giàu" hơn thắng), `syncOn` |
| Prompt helper (~1375-1440) | `learnerCtx()`, `tagList()`, `VIRULE`, `askJSON`/`askJSON0` (JSON, tự thêm field `_en`), `askText`, `aiErrMsg` |
| I18N (~1483-1598) | `LANG`, `I18N` (nhiều `Object.assign(I18N,…)`), `trTree`, `setLang` |
| Router (~1599-1640) | `route()`; hash: `#today #dashboard #lessons #settings #vocab #s-1-{1,2,4,5,6} #review #placement #notebook` |
| Màn hình | `renderTodayRest`, `renderSession` (theo `BODY`), `renderLessons`, `renderDashboard`, `renderVocab`, `renderWrite`, `renderProduct`, `startReview` |
| Từ vựng (~2830-2880) | `vIdx`/`vPool`/`vTopUp` (mở 6 từ/ngày, `VDAILY`), `dueCards`, `weekWords()` |
| Giọng nói (~3025-3110) | `recStart` → `srRun` (Web Speech), `myRecStart` (ghi âm nghe lại, **tắt trên Android**), `pronScore` |
| Roleplay | `renderScen`, `renderChat`, `rpTurn` (~3371) |
| Sổ tay | `openNb` (~4083): tab Từ đã lưu / Ghi chú / Lỗi / Lý thuyết |
| Boot (~4357) | `renderAll0()` rồi `boot()`; script 3 gắn nút Cài đặt (key Gemini, nhập/xuất dữ liệu) |

localStorage khác: `eng-gemini-key/model`, `eng-gist-token/id`, `eng-build`, `eng-bak-*` (tối đa 8), `eng-ux-lang`, `eng-ux-dirty`.

## Test
`tests/smoke.mjs` (Playwright-core + Chrome hệ thống, headless, 390px, Android UA). Gemini/GitHub là **mock** qua `context.route`.
Kiểm: tải không lỗi JS; 12 màn + sổ tay mở được; gọi Gemini mock, không còn gọi Anthropic, key Claude cũ bị dọn; dữ liệu cũ (`eng-ux-state`) còn nguyên và tự sao lưu khi `APP_BUILD` đổi; Gist sync (mock).
Cũng kiểm: `VOCAB` ≥720 từ, không trùng, 174 từ gốc (`tests/vocab-original.json`) còn đúng vị trí đầu danh sách; nút "Học lại từ đầu" (`restartAll`, sao lưu `-reset`, đặt `S.rst`, tuần 1 từ thứ 2 sau ngày mai).
KHÔNG kiểm: giọng nói thật, Gemini thật, GitHub thật, bố cục chi tiết, điện thoại thật.

## Giao diện (cập nhật 16/11/2026)
- Tab Hôm nay chỉ liệt kê 2 thẻ (Từ mới hôm nay → `#vocab`, buổi hôm nay → `#d-{dow}`); bấm vào mới vào màn học. `#d-N` là buổi học mở từ Hôm nay (`sess.back="today"`, màn "deep", không có bnav).
- Mọi nút hành động trong màn học (Tiếp, Bắt đầu, Câu trước...) nằm trong thanh cố định ở đáy: class `.abar` (hoặc `.exnav`/`.shnav`). JS bật `body.has-abar` để chừa chỗ cuối trang và đẩy nút Lý thuyết lên.
- Thanh đáy gọn: nghe chép = [ô chép][Kiểm tra]; nhại = [Tiếp]; Roleplay = [Nói] hoặc, khi bấm chip Nhập, [‹][ô nhập][↵][Nói]. Nút Nghe (`audioBtn`), chip Chậm/Gợi ý/Nhập nằm trong thẻ nội dung. Chữ ẩn: giữ nút "Giữ xem" mới hiện.
- Bàn phím + ô nhập trong thanh đáy: JS đặt `body.kbf`, `--kbb` (chiều cao bàn phím), `--abh` (chiều cao thanh) để thanh nằm trên bàn phím và trang cuộn tới cuối. KHÔNG ẩn header hay kéo giãn thẻ (người dùng không thích). Roleplay: tình huống là 1 ô tiêu đề (`#rp-scen-btn`) mở sheet chọn (`openScen`).
- Chấm câu tự do (`checkFree`) dùng tầng nhanh (`{fast:true}`), không còn ghi chú "model chính hết lượt".

## Từ vựng theo chủ đề (16/11/2026, `APP_BUILD` 2026-11-16-a)
- `VTOP` = 34 chủ đề (thứ tự = thứ tự học), mỗi từ thuộc 1 chủ đề (`c.tp`). 105 từ mới (màu sắc, khen/chê, thời tiết, email, khách hàng, phỏng vấn, dev/PM/QA, cảm xúc) đã thêm vào CUỐI `VMORE`. Tổng 1000 từ, 833 dùng được (bỏ lv 1).
- Mở từ: `S.vo` (từ đã mở nhưng chưa học) + `S.vtp` (chủ đề đang học); `vOpenN(k)` lấy hết chủ đề rồi sang chủ đề kế (từ dễ trước). `S.vu`/`vIdx` chỉ còn dùng cho migrate cũ. Pool = từ trong `S.vo` ∪ từ có trong `S.vocab`.
- Thêm từ mới: nhớ thêm tên từ vào một chủ đề trong `VTOP`, nếu không `tp=-1` (hiện nhãn nhóm cũ, không bao giờ được mở).

## Việc còn treo
- [x] 15/11/2026: từ mức Dễ (lv 1, 167 từ) bị ẩn khỏi pool (`vEasy`, `vPool`, `vLeft`, `vAdv`); đã thêm 168 từ Vừa/Khó vào cuối `VMORE` (tổng 895, dùng được 728; `APP_BUILD` 2026-11-15-b). Từ mới chưa có IPA, nên soát nghĩa/ví dụ.
- [x] Kho từ vựng đã thêm sẵn lên **727** từ (15/11/2026, 553 từ mới, chưa có IPA). Người dùng sẽ tự chỉnh độ dễ/khó sau; từ mới luôn thêm vào CUỐI `VMORE`. Nên soát lại nghĩa/ví dụ do AI soạn.
- [ ] Người dùng cần bấm **Cài đặt → "Học lại từ đầu"** (2 lần) trên điện thoại để đặt lại tiến độ, tuần 1 bắt đầu thứ 2 16/11/2026. Bản cũ nằm ở "Bản sao lưu tự động" (tối đa 8 bản).
- [ ] Chưa kiểm chứng: reset khi có 2 máy cùng bật Gist (logic `S.rst` trong `pullSync`, chỉ mới đọc code, chưa thử với GitHub thật).
- [ ] Bỏ giới hạn 8 từ ở buổi T6 (`weekWords()` có `.slice(0,8)`), đang chờ người dùng quyết mức cắt 30/12.
- [ ] Nút "Bận, chỉ có 10 phút" trên màn Hôm nay (chưa có trong code).
- [ ] Nếu roleplay ăn hết lượt model xịn: chuyển roleplay (`rpTurn`) sang tier nhẹ.
- [ ] Chưa kiểm chứng trên điện thoại thật: nhận diện giọng nói (Android đã bỏ ghi âm nghe lại), đồng bộ Gist với GitHub thật, chấm bài với AI thật.
- [ ] Dọn nhỏ: comment đầu script 1 còn nói "Gemini thay cho AI"; nhánh `!window.claude` trong `boot()` không bao giờ chạy vì `window.claude` (tên cũ của lớp giả lập) luôn được gán.
