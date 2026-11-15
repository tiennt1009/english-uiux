# HANDOFF — EN UIUX

Tài liệu chi tiết. Bản ngắn, có quy tắc bắt buộc: [CLAUDE.md](CLAUDE.md).
Nguồn: đọc `index.html` và `git log` (71 commit, 2026-11-12 → 2026-11-13) khi tiếp quản. **Không** có nhật ký chat cũ,
nên phần "vì sao" bên dưới chỉ suy ra từ code/commit; chỗ nào không chắc có ghi rõ.

## 1. Tổng quan
- Một file `index.html` (~555 KB), không framework, không build. Khối `<script>` thứ 1 = lớp AI, thứ 2 = ứng dụng, thứ 3 = nút Cài đặt.
- Kế hoạch học theo tuần (`WEEKS`, 14+ tuần, hiện chỉ tuần 1 có buổi học riêng: `s-1-N`). Mỗi tuần: T2 Ngữ pháp, T3 Nghe & nói,
  T5 Viết, T6 Dùng từ vựng, T7 Sản phẩm tuần; ngoài ra có "Từ mới hôm nay" (`#vocab`) hằng ngày.
- Bài có sẵn (`STATIC_EX`, `PLACE`, `BURST_STATIC`, 174 từ) chạy offline/không key; phần AI sinh bài, chấm bài, roleplay cần key.

## 2. AI: ai là mặc định?
Đọc `call()` (dòng ~941):
1. Có `eng-claude-key` và `eng-skip-claude` đã hết hạn → `claudeFirst()` (Claude). Tier `fast`/`quick` → `claude-haiku-5-5`; còn lại → `eng-claude-model` hoặc `claude-sonnet-5-5`. 5xx thử lại 1 lần.
2. Claude lỗi: `rate_limited` → bỏ qua Claude 90 s; `bad_key` → hiện banner "Key Claude không đúng…"; nếu không có key Gemini thì ném lỗi lên.
3. Gemini (`callOne`): danh sách `FALLBACK` (chất lượng) hoặc `FAST` (tier fast/quick), cuối là Gemma; model hết lượt bị `setSkip` (ngày: 3 giờ, phút: 90 s); nhớ model chạy được ở `eng-gemini-model`/`eng-fast-ok`.
4. Gọi qua `askJSON` (tự thêm yêu cầu field `_en` cho mọi field `_vi`, gộp thành `⟪vi‖en⟫` bằng `biMerge`, giao diện chọn ngôn ngữ) hoặc `askText`. Cả hai nối `VIRULE` và retry nếu phát hiện tiếng Việt không dấu.
- `window.claude={use}` luôn được gán (dòng ~1028) để code kiểu "chạy trong claude.ai" dùng chung. `use("sample")` trả hàm AI; `dictation`/`tts`/`db`/`user` trả `null`.
  Hệ quả: `dict` luôn `null` → nhận diện giọng dùng Web Speech của Chrome; nhánh `!window.claude` trong `boot()` là mã chết.
- API trình duyệt gọi thẳng: Anthropic cần header `anthropic-dangerous-direct-browser-access`. Key nằm trong localStorage (rủi ro đã chấp nhận: app cá nhân).

## 3. State & dữ liệu học
- `S` lưu ở `eng-ux-state`. Trường chính: `v, vset, start, weekStarts, act, w, bm, notes, rv, placement, sessions, errors, elog, vocab, vu, vday, vu8, vd, history, ex, own, rp, write, product, upd`.
- `S.vocab[w] = {box, due, first, …}` (hộp Leitner). `S.vu` = số từ đã "mở thêm" ngoài 20 từ đầu; `vIdx()` = max(20+vu, vị trí từ đã học cuối cùng) → **thứ tự `VOCAB` là một phần dữ liệu**.
- `migrate()` chạy khi tải, sau pull sync, sau khôi phục. Nhánh `vset!==2` xóa từ lạ khỏi `S.vocab` (chạy một lần vì đặt `vset=2`).
  Nhánh `v<3` đổi khóa buổi học (`w1-2` → `w1-5`…); đừng đổi lại ánh xạ này.
- Sao lưu: `bakSave(tag)` khi `eng-build !== APP_BUILD` ("update"), mỗi 20 giờ ("day"), trước sync/import/khôi phục; chỉ lưu nếu `prog(o)>=5`; giữ 8 bản. UI khôi phục ở Cài đặt (`renderBackups`).
- Sync Gist: `S.upd` là dấu thời gian sửa cuối; `pullSync` lấy bên mới hơn, riêng bên "giàu dữ liệu" (`prog`) không bị bên rỗng đè.

## 4. Giọng nói
- `recStart(btn,{live,done,short,target})` → `srRun()` dùng `SpeechRecognition`/`webkitSpeechRecognition`, `lang=en-US`, 5 phương án, `srPick` chọn phương án gần câu mẫu nhất (`pronScore`).
- Android: `continuous=false`, mỗi lượt 1 câu, tự mở lượt mới tới khi bấm Dừng (tối đa 90 s). **Không ghi âm nghe lại trên Android** (dùng chung track micro khiến recognizer nghe im lặng) — commit `9099dfa`.
- Desktop: `myRecStart()` ghi âm bằng MediaRecorder để nghe lại; `eng-no-myrec` tắt tính năng nếu lỗi.

## 5. Dòng thời gian (rút từ git log)
- 11-12: Gemini chain + Gemma dự phòng, skip model hết lượt; Nghe & nói (chép chính tả, nhại, roleplay, 11 tình huống); Viết 3 phần (37 chủ đề); từ vựng tuần xuyên suốt các buổi; chấm bỏ qua viết hoa/dấu câu; sổ tay (từ/ghi chú/lỗi); sao lưu tự động; đồng bộ Gist.
- 11-13: Giải thích sâu + câu hỏi tiếp; ép tiếng Việt có dấu; UX mỗi lần 1 thứ; huy hiệu Đúng/Sai; tra từ chạm 1/2 lần; bỏ tab lý thuyết/luyện, sách giáo khoa 24 chương trong sổ tay; **Claude-first** (`7b937f4`); sửa mic Android (`9099dfa`).

## 6. Cạm bẫy đã gặp khi đọc code
- `Object.assign(DEF_copy, saved)` là gộp nông: trường lồng nhau mới (vd `rp.x`) không tự có ở dữ liệu cũ → kiểm tra trong `migrate()` hoặc nơi dùng.
- `migrate()` được gọi lúc tải trang **trước** khi UI sẵn sàng; chỉ dùng hàm khai báo kiểu `function` (được hoist) hoặc đã định nghĩa phía trên.
- Chuỗi giao diện chưa có trong `I18N` vẫn hiện tiếng Việt khi chọn English (không lỗi, chỉ lệch ngôn ngữ). `trTree` dịch theo khuôn `#` cho số.
- Banner `showBanner()` và comment đầu script 1 vẫn nói "Gemini" dù Claude-first (chưa sửa).
- Việc kiểm Playwright dùng key giả (`sk-ant-MOCK`, `AIzaMOCK`) — không phải key thật.

## 7. Test
`cd tests && npm install && npm test`. Chrome hệ thống (tự tìm; hoặc `CHROME_PATH`). Server tĩnh nội bộ, mọi request ngoài bị chặn trừ 3 API mock.
Đã thử đột biến (chèn lỗi vào `renderDashboard`): test bắt được và báo FAIL.
Chưa phủ: luồng chấm bài chi tiết, giọng nói thật, bố cục từng màn, khả năng dùng trên điện thoại thật.

## 7b. Thay đổi 15/11/2026 (APP_BUILD `2026-11-15-a`)
- `VMORE` từ 174 → 727 từ (thêm vào cuối, 5 đợt soạn: ~140 + ~130 + ~125 + ~125 + ~65; lọc trùng bằng script, bỏ các cụm ghép gượng). Chưa có IPA cho từ mới (`IPA[w]` rỗng, giao diện đã chịu được).
- Nút **Học lại từ đầu** (Cài đặt → Dữ liệu): `restartAll()` gọi `bakSave("reset")`, đặt `S=DEF`, `S.start`/`weekStarts[1]` = thứ 2 của ngày mai, `S.rst=S.upd=now`, đẩy thẳng lên `dbRef`. Bấm 2 lần (hết hạn xác nhận sau 4 giây).
- `S.rst` (trường mới) là mốc reset: trong `pullSync`, bên có `rst` mới hơn không bị bên "giàu dữ liệu" đè (`richL`/`richR`), nhờ đó máy khác lấy trạng thái đã reset thay vì đẩy dữ liệu cũ lên lại.
- `overdue()` trả rỗng khi tuần hiện tại chưa bắt đầu (tránh hiện cả tuần "quá hạn" vào Chủ nhật trước tuần mới).
- Quy trình thêm từ: viết hàng `["từ","nghĩa","ví dụ","emoji","nhóm",độ khó,[đồng nghĩa]]`, thêm vào cuối `VMORE`, chạy `npm test` (kiểm trùng + 174 từ gốc).

## 8. Việc còn treo
Xem danh sách trong CLAUDE.md (nguồn chính). Ghi chú thêm:
- Thêm ~550 từ: nên chia 4 đợt ~150 từ; mỗi đợt chạy `npm test`, đổi `APP_BUILD`, kiểm tra không từ nào trùng `w` với từ cũ, và `vIdx()` vẫn hợp lý (`VDAILY=6` từ/ngày → 174 từ đủ ~25 ngày, 724 từ ~4 tháng).
- Quyết định 30/12 cho `weekWords()` đang chờ người dùng; `vu8Get()` chốt danh sách từ khi bắt đầu làm nên đổi giới hạn không ảnh hưởng tuần đã chốt.
