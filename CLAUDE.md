# EN UIUX — hướng dẫn cho Claude

App học tiếng Anh **một file HTML** (`index.html`, ~4450 dòng, không build) cho UI/UX designer người Việt, trình độ A1,
mục tiêu 6-12 tháng đủ đi làm/phỏng vấn. Người dùng học chủ yếu trên **Android Chrome**.
Lịch sử chi tiết, ghi chú kiến trúc, cạm bẫy: xem [HANDOFF.md](HANDOFF.md).

## Deploy
- Repo `github.com/tiennt1009/english-uiux` (public), nhánh `main`. Pages: `tiennt1009.github.io/english-uiux`.
- Deploy = `git push origin HEAD:main`; Pages cập nhật sau ~1 phút. Không có bước build.
- Trước khi push: `cd tests && npm install && npm test` (cần Chrome). Chỉ push khi PASS, không lỗi JS.
- Từ 18/11/2026 người dùng đã cho phép **tự đẩy lên `main`** sau mỗi thay đổi (khi test PASS), không cần hỏi lại. Vẫn nói rõ trong câu trả lời là đã đẩy.

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
| Router | `route()`; hash: `#today #dashboard #lessons #settings #vocab #s-1-{1,2,4,5,6} #review #placement #notebook #practice #practice/<loại> #practice/<loại>/run` |
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
Mục [7]: Luyện đề (từ vựng 3 mức + nghe chép chạy offline không gọi Gemini, loại AI bị khóa khi chưa có key, ngữ pháp qua Gemini mock → làm hết đề → câu sai vào hồ sơ lỗi, lưu `S.px`). Dữ liệu cũ chưa có `S.px` vẫn tải được.
Cũng kiểm: `VOCAB` ≥720 từ, không trùng, 174 từ gốc (`tests/vocab-original.json`) còn đúng vị trí đầu danh sách; nút "Học lại từ đầu" (`restartAll`, sao lưu `-reset`, đặt `S.rst`, tuần 1 từ thứ 2 sau ngày mai).
KHÔNG kiểm: giọng nói thật, Gemini thật, GitHub thật, bố cục chi tiết, điện thoại thật.

## Giao diện (cập nhật 16/11/2026)
- Tab Hôm nay chỉ liệt kê 2 thẻ (Từ mới hôm nay → `#vocab`, buổi hôm nay → `#d-{dow}`); bấm vào mới vào màn học. `#d-N` là buổi học mở từ Hôm nay (`sess.back="today"`, màn "deep", không có bnav).
- Mọi nút hành động trong màn học (Tiếp, Bắt đầu, Câu trước...) nằm trong thanh cố định ở đáy: class `.abar` (hoặc `.exnav`/`.shnav`). JS bật `body.has-abar` để chừa chỗ cuối trang và đẩy nút Lý thuyết lên.
- Thanh đáy gọn: nghe chép = [ô chép][Kiểm tra]; nhại = [Tiếp]; Roleplay = [Nói] hoặc, khi bấm chip Nhập, [‹][ô nhập][↵][Nói]. Nút Nghe (`audioBtn`), chip Chậm/Gợi ý/Nhập nằm trong thẻ nội dung. Chữ ẩn: giữ nút "Giữ xem" mới hiện.
- Bàn phím + ô nhập trong thanh đáy: JS đặt `body.kbf`, `--kbb` (chiều cao bàn phím), `--abh` (chiều cao thanh) để thanh nằm trên bàn phím và trang cuộn tới cuối. KHÔNG ẩn header hay kéo giãn thẻ (người dùng không thích). Roleplay: tình huống là 1 ô tiêu đề (`#rp-scen-btn`) mở sheet chọn (`openScen`).
- Thanh tiến độ câu (`.exbar .bars i`, `.shbar i`, dùng ở ngữ pháp, nghe chép, dùng từ vựng, viết, luyện đề) là ô đánh số 1..n (số lấy bằng CSS counter, không đổi HTML): xám = chưa làm, xanh nhạt = đúng, đỏ nhạt = sai, vàng = chờ/gần đúng, đen = câu hiện tại. Màu phẳng, không gradient (style chung của app).
- Chấm câu tự do (`checkFree`) dùng tầng nhanh (`{fast:true}`), không còn ghi chú "model chính hết lượt".

## Từ vựng theo chủ đề (16/11/2026, `APP_BUILD` 2026-11-16-a)
- `VTOP` = 34 chủ đề (thứ tự = thứ tự học), mỗi từ thuộc 1 chủ đề (`c.tp`). 105 từ mới (màu sắc, khen/chê, thời tiết, email, khách hàng, phỏng vấn, dev/PM/QA, cảm xúc) đã thêm vào CUỐI `VMORE`. Tổng 1000 từ, 833 dùng được (bỏ lv 1).
- Mở từ: `S.vo` (từ đã mở nhưng chưa học) + `S.vtp` (chủ đề đang học); `vOpenN(k)` lấy hết chủ đề rồi sang chủ đề kế (từ dễ trước). `S.vu`/`vIdx` chỉ còn dùng cho migrate cũ. Pool = từ trong `S.vo` ∪ từ có trong `S.vocab`.
- Thêm từ mới: nhớ thêm tên từ vào một chủ đề trong `VTOP`, nếu không `tp=-1` (hiện nhãn nhóm cũ, không bao giờ được mở).

## Luyện đề (18/11/2026, `APP_BUILD` 2026-11-18-a)
- Tab thứ 4 ở thanh nav (`#practice`, mục "Luyện đề"): chọn loại → chọn độ khó Dễ/Vừa/Khó → làm 1 đề → "Đề mới" (cùng loại + mức), "Đổi độ khó", "Chọn loại khác". Gợi ý đổi mức khi đúng ≥80% / <40%.
- Mã nằm trong khối "Luyện đề" (script 2, ngay trước "free sentence grading"): `PXT` (6 loại), `PXD` (mô tả theo mức), `px` (trạng thái trong bộ nhớ), `pxBuild`, `pxGen*`, `pxAns`, `renderPractice`/`pxHome`/`pxSetup`/`pxRun`/`pxResult`. Thêm loại mới = thêm vào `PXT` + `PXD` + 1 nhánh trong `pxBuild`/`pxGenAI` (mỗi câu là `{f:"mcq"|"type"|"dict",lab,q,opts,ans,accept,why,tag,say,ctx,hint}`).
- Loại offline (không cần key): **Từ vựng** (soạn từ `VOCAB`, ưu tiên từ đã học/yếu; mức quyết định dạng câu: Dễ chọn nghĩa 3 lựa chọn → Vừa thêm chọn từ + điền chỗ trống → Khó tự gõ từ) và **Nghe chép** (câu ví dụ của `VOCAB`, mức = độ dài câu; cần giọng đọc `pxTtsOK()`). Loại AI: **Ngữ pháp** (phạm vi theo `WEEKS`: Dễ = tới tuần hiện tại, Vừa +1 tuần, Khó +2 tuần), **Dịch câu**, **Đọc hiểu**, **Tình huống**. Lời nhắc AI dùng `learnerCtx()` + dòng OVERRIDE (vì `learnerCtx()` ghi cứng "chỉ to be") + `tagList()`.
- Chấm: câu chọn chấm ngay; câu gõ so đáp án/`accept`; câu Dịch khác đáp án mẫu thì để "chờ" và chấm 1 lượt bằng AI khi xem kết quả (`pxGradePend`, chấm lại được nếu mất mạng). Ngữ pháp/Dịch sai → `addErr` (vào hồ sơ lỗi + hàng ôn). Từ vựng/Đọc hiểu/Tình huống sai KHÔNG đụng `S.vocab` hay `S.errors`.
- Dữ liệu: chỉ thêm `S.px={lv:{<loại>:1-3},hist:[{id,d,k,lv,n,ok}] (tối đa 40)}` (có trong `DEF` và `migrate()`). Đề đang làm KHÔNG lưu vào `S` (nằm ở `px.set`, mất khi tải lại trang). Mỗi đề +3 xp (`S.act`), mỗi câu +1/2 xp.
- Màn chọn độ khó (`pxSetup`): khối tiêu đề nền tối + 3 thẻ màu theo mức (`.px-lvc.l1/l2/l3`: xanh lá/cam/đỏ, icon 🌱🔥⚡, cột cường độ, "🏆 Cao nhất #/#", nhãn "Đề xuất" từ `pxRec()`), nút Bắt đầu đổi màu theo mức. Vẫn giữ `#px-lv [data-lv]` cho test.
- Mọi chuỗi mới đã có trong `I18N` (khối `Object.assign` cuối danh sách). Chuỗi động có tên mức (Dễ/Vừa/Khó) tách thành phần để `trCore` dịch được.

## Mục tiêu 30 phút mỗi ngày (19/11/2026, `APP_BUILD` 2026-11-19-a)
- Lý do: người dùng làm xong buổi học trong ~5 phút (nhãn "45/30 phút" ở `SESS` chỉ là ước tính), Thứ 4 và Chủ nhật không có buổi. Thay vì viết lại nội dung từng buổi, app **đo thời gian học thật** và lấp phần thiếu bằng Luyện đề.
- `S.tm={"YYYY-MM-DD":giây}` (mới, có trong `DEF`/`migrate()`, giữ 60 ngày). Bộ đếm (IIFE sau `xp()`): mỗi giây cộng nếu tab đang hiện, có chạm/gõ/cuộn trong 60 giây gần nhất, và không ở Dashboard/Cài đặt; lưu mỗi 20 giây (`save()`).
- `GOAL_MIN=30`, `goalHTML()` (class `.daygoal`, KHÔNG dùng `.goal` vì trùng CSS của Dashboard), `goalSync()` cập nhật tại chỗ. Hiện ở: đầu màn Hôm nay, đầu màn Luyện đề, màn kết quả Luyện đề.
- Màn Hôm nay: dưới các thẻ bắt buộc có "Luyện thêm cho đủ 30 phút" = 2 thẻ Luyện đề (3 thẻ vào ngày không có buổi), chọn bởi `pxSuggest()` (loại chưa làm hôm nay trước, rồi loại điểm thấp nhất; bỏ loại AI nếu chưa có key). Mỗi loại có `m` = số phút ước tính/đề trong `PXT`.
- **Đề Luyện đề bắt buộc theo buổi (19/11/2026)**: `PXREQ` = {dow:[[loại,số đề]]} (T2: 3 Ngữ pháp; T3: 2 Nghe chép + 1 Tình huống; T5: 2 Dịch câu + 1 Đọc hiểu; T6: 3 Từ vựng + 1 Đọc hiểu; T7: 2 Nghe chép + 1 Tình huống). `tasksFor(dow)` = `tasksBase(dow)` + `pxTasks(dow)` (việc có `link:true`, bấm vào đi tới `#practice/<loại>`). Đề tính cho buổi nào do `pxAttrib(loại)` quyết định lúc làm xong (ưu tiên buổi hôm nay chưa đủ đề loại đó), lưu `sd` (dow) + `wk` vào `S.px.hist`; đạt khi đúng ≥`PX_PASS`=60%. `pxRecord()` gọi `after()` nên buổi tự hoàn thành. Buổi T2 đã qua bài xếp tuần thì không thêm đề. Muốn đổi khối lượng: sửa `PXREQ`.
- Chưa làm: viết nội dung tay dài hơn cho từng buổi `SESS` (đang dùng Luyện đề thay); cho chọn số câu mỗi đề; hiện phút học trên Dashboard; buổi riêng cho Thứ 4/Chủ nhật (hiện chỉ có gợi ý Luyện đề).

## Nghĩa của cụm câu (19/11/2026, `APP_BUILD` 2026-11-19-b)
- 127 cụm câu (`cat:"talk"`, `ph:1`) dùng làm bài "nhớ lại" (xem nghĩa Việt, gõ cả câu tiếng Anh). Nghĩa tiếng Việt phải **sát cấu trúc câu tiếng Anh** để người học suy ra được (vd "Do you mind if I sit here?" = "Bạn có phiền không nếu tôi ngồi đây?", không phải "Tôi ngồi đây được không?") và **không trùng nhau** giữa các cụm. 39 cụm đã viết lại; câu đồng nghĩa được chấp nhận đáp án của nhau qua trường `alt` (cột 7 của hàng `VMORE`). Khi thêm cụm mới: viết nghĩa sát nghĩa, kiểm tra không trùng `vi` với cụm khác.

## Buổi Dùng từ vựng (T6) — 2 tab (20/11/2026)
- Bài Đặt câu luôn có **10 từ** (`weekWords()` = `vuPad(weekWords0(),10)`: từ đơn đã học trong tuần, thiếu thì đệm từ đã học khác → từ đã mở chưa học → từ chủ đề đang/sắp học); đạt khi đúng ≥75% (8/10). Sau khi xong mỗi phần có nút ở thanh đáy `#vu-nav` (`vuNext()`): Sang phần 2 → Sang Luyện đề (đề còn thiếu) → Về Hôm nay.
- `#b-vuse` có thanh tab `#vu-steps` (`vuTabs()`, biến `vuTab`): "1 · Đặt câu" (thẻ `#vu-card1`, từ = `weekWords()`, tối đa 8) và "2 · Kể chuyện" (thẻ `#vu-card2`). Mỗi lúc chỉ hiện 1 thẻ.
- Kể chuyện dùng `storyWords()` = `wkWords()` (tối đa 12 từ đơn đã học trong tuần, hiện bằng `wordChips`), số từ cần dùng `storyNeed()` = min(4, số từ có). Lý do: các chủ đề đầu (Xã giao, Hỏi lại...) toàn là cụm câu (`ph:1`) nên bị loại khỏi danh sách từ đơn; trước đây chỉ hiện 1 từ mà vẫn đòi 4.

## Tăng khối lượng các phần học (20/11/2026, `APP_BUILD` 2026-11-20-a)
- `S.vu8.v===2`: bản cũ (danh sách từ Đặt câu lưu từ trước, có thể chỉ 1 từ) bị đặt lại một lần để lấy 10 từ.
- Roleplay `RP_N` 6 → 10 lượt (nhãn việc/tiến độ đều dùng `RP_N`). Nghe chép & nhại: AI soạn 8 câu, cần nhại đạt `shNeed()` = min(6, số câu có) (trước là 4); bản mẫu `SH_BASE` có 6 câu nên cần 6/6.
- **Bài Viết (áp dụng cho bộ MỚI, dữ liệu đã học giữ nguyên)**: số câu lấy theo độ dài mảng đã lưu trong `S.wr` (`x.a.m.length` tin nhắn, `x.a.u.length` UX writing, `wrCMin(x)` = `x.cmin||4` câu bài chính). Bộ tạo mới (`wrPick()`: tuần mới hoặc bấm Đổi đề) dùng `WNM=5` tin (3 tin của tuần + 2 tin từ kho `WTOP` lưu ở `x.mx`), `WNU=3` UX writing, `WCMIN=5` câu. Ngưỡng đạt: tin đúng ≥ceil(2/3·số tin), UX đúng ≥ceil(0.75·số câu), bài chính ≥cmin câu và sai tối đa 1. Nhãn/tiến độ/việc đều lấy từ `wrStat()` (`aT, aNeed, uT, uNeed, cMin`), đừng gắn cứng số.
- **Ngữ pháp**: khi bấm "Tạo bộ bài mới", AI soạn 18 câu (6 khởi động + 12 dịch) thay vì 12; bộ đã lưu (`S.ex`) giữ nguyên. Ngưỡng đạt tính theo số câu thực tế (`l2Stats`).

## Sổ tay: tab Từ vựng (20/11/2026)
- Tab đầu của sổ tay (`#nb-vocab`, `renderNbVocab()`/`nbvList()`, trạng thái `nbvQ/nbvF/nbvN`): toàn bộ `VOCAB` (cả từ chưa học, cả mức Dễ và cụm câu), ô tìm theo từ hoặc nghĩa, lọc Tất cả/Đã học/Chưa học, hiện 80 dòng mỗi lần + "Xem thêm". Bấm dòng để xem ví dụ; từ đã học hiện độ nhớ, từ chưa học hiện "Chưa học". Chỉ đọc, không đổi `S`.

## Lưu hỏi đáp với AI vào Ghi chú (20/11/2026)
- Dưới mỗi câu trả lời của AI trong khung hỏi đáp (nút "?" của `svBtn`, `qaRender`) và trong "Giải thích kỹ hơn" của bài Viết (`wrDeepHTML`) có nút đánh dấu `qaSaveBtn(hỏi, đáp)`; dùng chung bộ xử lý `[data-sv]`, lưu vào `S.notes` dạng `{k, r:"", why:<câu trả lời>, ask:<câu hỏi>}` (trường `ask` mới, tùy chọn). Tab Ghi chú của sổ tay hiện dòng "Hỏi: …" trên câu trả lời. Câu trả lời lỗi (mất mạng, hết lượt) không có nút lưu.

## Việc còn treo
- [ ] Luyện đề: chưa thử trên điện thoại thật và với Gemini thật (chỉ test mock): chất lượng/độ đúng đáp án do AI soạn cần người dùng soát vài đề đầu; nếu thấy đáp án sai thì thêm nút "Báo AI chấm sai" (`flagBtn`) cho màn kết quả.
- [ ] Luyện đề: chưa có "Ôn lại câu sai của đề" riêng và chưa lưu đề dở khi tải lại trang (cố ý, để đơn giản).
- [x] 15/11/2026: từ mức Dễ (lv 1, 167 từ) bị ẩn khỏi pool (`vEasy`, `vPool`, `vLeft`, `vAdv`); đã thêm 168 từ Vừa/Khó vào cuối `VMORE` (tổng 895, dùng được 728; `APP_BUILD` 2026-11-15-b). Từ mới chưa có IPA, nên soát nghĩa/ví dụ.
- [x] Kho từ vựng đã thêm sẵn lên **727** từ (15/11/2026, 553 từ mới, chưa có IPA). Người dùng sẽ tự chỉnh độ dễ/khó sau; từ mới luôn thêm vào CUỐI `VMORE`. Nên soát lại nghĩa/ví dụ do AI soạn.
- [ ] Người dùng cần bấm **Cài đặt → "Học lại từ đầu"** (2 lần) trên điện thoại để đặt lại tiến độ, tuần 1 bắt đầu thứ 2 16/11/2026. Bản cũ nằm ở "Bản sao lưu tự động" (tối đa 8 bản).
- [ ] Chưa kiểm chứng: reset khi có 2 máy cùng bật Gist (logic `S.rst` trong `pullSync`, chỉ mới đọc code, chưa thử với GitHub thật).
- [ ] Bỏ giới hạn 8 từ ở buổi T6 (`weekWords()` có `.slice(0,8)`), đang chờ người dùng quyết mức cắt 30/12.
- [ ] Nút "Bận, chỉ có 10 phút" trên màn Hôm nay (chưa có trong code).
- [ ] Nếu roleplay ăn hết lượt model xịn: chuyển roleplay (`rpTurn`) sang tier nhẹ.
- [ ] Chưa kiểm chứng trên điện thoại thật: nhận diện giọng nói (Android đã bỏ ghi âm nghe lại), đồng bộ Gist với GitHub thật, chấm bài với AI thật.
- [ ] Dọn nhỏ: comment đầu script 1 còn nói "Gemini thay cho AI"; nhánh `!window.claude` trong `boot()` không bao giờ chạy vì `window.claude` (tên cũ của lớp giả lập) luôn được gán.
