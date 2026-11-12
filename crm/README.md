# 跟客系統（第一版）

保險團隊準客戶跟進系統，用嚟取代紙本《Prospect Check List》。手機同電腦都用得，介面係繁體中文。

**已有：** 登入、權限、準客戶卡、客戶進度五欄看板、人脈網三欄、約會日曆（上午／中午／下午／晚上）、每月生意表、每日待辦及團隊 Review、Telegram 助手、主管總覽、員工帳戶管理、審計記錄。

### 2026-11-06 教練 File 中文檔名修復

- 已由實際 Telegram 畫面確認：身份綁定後卡在 File 保存，並非需要更新手機 app。
- 根因：自動文字紀錄使用中文檔名作 Storage object key；Storage 僅接受 ASCII key。新 object key 使用版本化 base64url 標籤，原始中文／emoji 檔名和內容仍保留在加密 envelope；列表解碼顯示原名。
- 保留舊 ASCII object key 的讀取與顯示，包含既有 coach-credentials.json，毋須重新保存 bot token。檔案路徑仍按身份分開，AAD 綁定完整路徑。
- 上傳失敗只記錄服務 code/status，不記錄 token、客戶文字或檔名。錯誤文字改為「客戶檔案未有改動」，避免被理解為 app 版本太舊。
- 測試涵蓋中文紀錄、emoji／百分號附件名、長檔名、舊憑證相容，以及完整教練文字→加密 File→草稿預覽→明確確認→自己 CRM 客戶寫入（mock backend），重複確認不重複寫入。

### 2026-11-06 主管詳細版／同事精簡版

- 同事主導航只顯示今日、客戶、日曆、我的 File；帳戶由頁頂姓名開啟，生意表及人脈網放在帳戶頁作次要入口。
- 同事每日任務使用清單，隱藏大型任務 hero、週完成環、里程碑及五個工作類別的空欄；保留日期、待辦／逾期／未安排、安排下一步及更新結果。
- 主管保留完整統計、員工明細、團隊 Review、同事更新及審計；首頁進入主管總覽。
- 使用者要求移除 app 內 Ryan 教練 Bot 入口及重播記錄頁，舊 `/telegram`、`/whatsapp` 轉回客戶看板；主管仍可看 `/updates`，此頁改為主管權限。
- 這是 app 畫面簡化，Telegram 教練 Bot 的文字／附件接收、各人 File、確認後 CRM 寫入及主管安全接駁設定保留；沒有刪除或停用真正 Telegram Bot。

### 2026-11-06 新進度分類及簡化教練接駁

- 使用者明確修正：以後不再用 RR、NR1、NR2、FNA、PC 區分客戶。所有公開階段為相約見面、深化跟進、落實方案、已簽單、已出單；主管總覽按五類合計，歷史記錄在讀取時合併，不刪除資料。
- 公開操作／Bot stage 改為 MEETING、FOLLOWUP、PROPOSAL、SIGNED、ISSUED；舊 enum 只在資料邊界相容，無須遷移。客戶表格整理為三個流程分頁，保留所有舊欄位的加密內容。
- 教練指定 @Ryan_main_bot。主管在 `/admin/bots` 一格安全輸入 BotFather token，先以 getMe 核對 bot，才加密保存及單獨註冊 webhook；不要求先設定或啟用 PA。
- Token 加密存放私人 storage `coach/settings/`，只有伺服器處理；員工 `/files` 永遠使用登入者 UUID，不能讀取設定區。設定表單限現時有效主管使用，不返回 token。
- AI 支援既有 Anthropic key，或 Vercel AI Gateway 的部署 OIDC 身份。註冊教練後會做不含客戶資料的最小 AI 連線測試；若 AI 仍未可用，明確顯示 Telegram 已接通但 AI 整理尚未可用。
- 真人 Bot 啟用仍須 Bot 擁有人從 BotFather 安全輸入實際 token；Bot username/網址不能代替授權金鑰。

### 2026-11-06 兩個獨立 Telegram Bots

- **Ryan PA Bot**：`/api/telegram/pa`，只接受 `TELEGRAM_PA_USER_ID` 的私人訊息，並核對此 ID 已綁定有效 CRM 帳戶；其他身份在讀取資料前被拒絕。可讀 Ryan 自己未來一週待辦、協助安排及草擬訊息、保存私人對話和附件；不自動修改客戶或發送第三方訊息。
- **Ryan 教練 Bot**：`/api/telegram`，同事各自以數字 ID 綁定 CRM 帳戶。文字更新先保存到自己的 File，再整理加密草稿，確認後只寫入該同事的 CRM 資料。照片／文件只保存，未自動當作客戶事實；有文字 caption 時可另行整理供確認。
- PA 與教練須使用不同 token 及 webhook secret。環境變數參照 `.env.example`；舊 `TELEGRAM_BOT_*` 僅作教練設定相容後備。
- 檔案使用既有 Supabase 的私人 `ryan-bot-files` bucket，首次獲授權儲存時建立；應用層 AES-GCM 加密，AAD 綁定完整 owner/object 路徑。教練 `coach/<profile_id>/`、PA `pa/<Ryan Telegram ID>/` 分開。原有 Linux team folders 沒有搬動或同步。
- App `/files` 只依登入者 profile ID 取回自己的教練 File；PA 私人檔案只可在 PA 以 `/files`、`/get` 取得。附件限制 10 MB。私人 PA 對話以追加檔案保存，最近六輪可作上下文，不進入同事更新草稿。
- 管理員 `/admin/bots` 顯示設定狀態，並提供「連接兩個 Bots」：驗證兩個真實 bot identity，檢查 Ryan 綁定後分別設定 webhook，再用 getWebhookInfo 核對。會拒絕接管既有 cloud_compute_bot。
- 尚須管理員安全輸入兩個 Bot 金鑰、webhook secrets、Ryan 數字 ID 及 AI 金鑰；未設定時接口明確顯示 configured:false，不能當作已啟用或已完成真人測試。

### 2026-11-06 Telegram 資料入口

- 新增 `/updates`「同事更新」三欄看板：待確認／已寫入／已取消。主管查看全隊，員工只查看自己；確認操作仍只限提交的員工。原文與整理結果沿用加密草稿保存。
- Telegram 私訊由數字 user ID 綁定 CRM 員工，主管在「員工帳戶」設定；不以電話或可修改的 @username 識別。
- 綁定儲存在 Supabase Auth 的管理員專用 app_metadata.telegram_user_id；每次收到訊息重新核對綁定及 active 狀態，重複綁定拒絕存取。現有客戶表及加密鑰匙不變，毋須資料庫遷移。
- 只接收已驗證 webhook 的私人訊息；整理成加密草稿後，員工回覆「確認」才寫入自己資料。重送以 telegram:update_id 去重；舊 WhatsApp 草稿不會由 Telegram 確認。
- 網站入口 `/telegram`；舊 `/whatsapp` 轉到新入口。兩個舊 WhatsApp API 入口回 410，停止以電話身份入資料。既有加密草稿／RPC 保留相容性。
- 啟用需要 production 環境變數 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_BOT_USERNAME`、`TELEGRAM_WEBHOOK_SECRET`，以及現有 AI 整理器的 `ANTHROPIC_API_KEY`。由管理員在 Vercel 設定秘密，勿貼到對話／Git。
- 使用 Bot API setWebhook 將 URL 設為 `https://ryan-crm-chi.vercel.app/api/telegram`，secret_token 設為上述 webhook secret，allowed_updates 為 `["message"]`。先用 getWebhookInfo 確認成功，再由員工 /start 取得 ID 並交主管綁定。
- 現有文件助手仍在其他主機輪詢；不要直接將同一 bot 改成 webhook，應使用獨立 bot 或先完成既有程式整合。
- 審計相容限制：沿用的舊 RPC 底層 via 仍寫 whatsapp；草稿已記錄真實 channel=telegram，助手頁顯示實際渠道。將來如需逐列渠道報告，須另做保留歷史的 RPC 遷移。

### 任務版與跟客整合（本機更新）

- 全頁改為深藍紫色任務工作區；每日任務顯示真實完成進度、每週里程碑與成功儲存後的完成回饋。沒有恢復 WARS 計分、虛構經驗值或排行榜。尊重減少動畫設定。
- 「約會日曆」統一改名「日曆」。所有導覽項目直接顯示，手機可換行，沒有「更多」選單。
- 新待辦可選擇自己負責的客戶及時間；關聯 ID、時間儲存在現有加密 info 中。日曆可連結客戶與指定見面時間，使用現有加密 appts metadata。毋須新增資料庫欄位。
- 首頁顯示今日約會、今日待辦、所有逾期待辦及未安排下一步的跟進中客戶。後兩項包含過往星期的未完成工作；已取消任務不計入完成進度。
- 看板顯示最早下一步（包括日曆安排），並按跟進日期排序；「人脈網」與「客戶進度」以客戶 stage 為共同來源。舊 NR1/FNA 細階段與所有表格保留，新拖拉會寫代表階段。
- 客戶頁新增跟進旅程：任務、約會及加密聯絡備註集中顯示。聯絡記錄使用 updated_at 條件，避免並行覆蓋；格式損壞時不覆蓋舊內容。
- 日曆約會只需寫一次，首頁與客戶頁直接讀取；邀約類任務亦在日曆顯示，不額外複製一份記錄。完成任務不會自動推進客戶階段。
- 驗證：16 項資料回歸測試通過；App 入口通過 esbuild 打包檢查（外部套件未打包）；該次檢查未包含完整 Next.js 建置及線上部署；最新部署狀態以實際 Vercel 記錄為準。
- `../preview/ryan-quest.html` 為可互動設計示範，所有人名與內容均為示例，並非線上資料或部署。

### 2026-11-05 介面簡化

- 「四季人脈」改為「人脈網」：相約見面 → 深化跟進 → 落實方案。已簽客戶獨立放在下方，可拖入／撤回、加入生意表。
- 沿用 `/seasons` 連結及資料庫欄位，毋須資料庫遷移。SPRING、WINTER、null 對應相約見面；AUTUMN 對應深化跟進；SUMMER 對應落實方案。舊記錄不刪除，新操作只寫入三個有效分類。
- 「我的看板」五欄：相約見面（RR／NR1）、深化跟進（NR2／FNA）、落實方案（PC）、已簽單、已出單。保留原有表格細階段，新拖拉寫入對應代表階段。
- 「活動分」改為「約會日曆」，取消活動次數輸入、總分、KPI 及主管分數。上午06:00–11:59、中午12:00–13:59、下午14:00–17:59、晚上18:00–翌日05:59；Telegram 講明鐘點或時段會自動歸位，只有時段時不會代填鐘點。儲存只更新加密約會，不改舊次數。
- WhatsApp 支援早餐約會，預覽不再顯示活動分，確認約會時亦不增加次數。
- PDCA 頁面及導覽入口停用，舊 `/pdca` 連結轉到約會日曆；保留歷史資料及審計記錄。
- 本機驗證：6 項回歸測試通過（歷史分類、五欄分組、早餐加密儲存與重新讀取、保留舊約會與活動次數、日期驗證、WhatsApp 不增加分數）。TypeScript／TSX 語法檢查通過。
- 部署限制：套件安裝因 npm DNS 解析失敗而受阻，尚未完成完整 TypeScript 檢查、production build 或瀏覽器驗證。連接的 GitHub 帳戶沒有此 repository 的 push 權限，線上版本未更新。
- 本機檢查：`node --experimental-vm-modules --test --test-isolation=none tests/regression/crm-simplification.test.mjs`。完整驗證仍使用下方既有 npm 指令。


技術：Next.js（放喺 GitHub，部署去 Vercel）＋ Supabase（資料同登入，用新加坡伺服器）。你部電腦唔使裝任何嘢。

---

## 一鍵部署（建議）

有 Supabase 同 Vercel 嘅 access token 就可以一句過搞掂下面第 1–8 步（開新加坡項目、建資料庫、驗證權限、部署、開 Ryan 帳戶）：

```bash
cd crm
SUPABASE_ACCESS_TOKEN=… VERCEL_TOKEN=… node scripts/deploy.mjs --admin-email ryan@你的公司.com
```

完成後網址、Ryan 臨時密碼同加密鑰匙會寫入 `crm/.deploy-output.json`（已 gitignore）。⚠️ 加密鑰匙要另外收好。

## 一次性設定（手動，大約 20 分鐘，全部喺瀏覽器做）

### 1. 開 Supabase 項目
1. 去 <https://supabase.com> 註冊，撳 **New project**。
2. **Region 揀 `Southeast Asia (Singapore)`**（Supabase 冇香港伺服器，新加坡係最近嘅）。
3. 設一個資料庫密碼，記低佢，收埋喺安全地方。

### 2. 建立資料庫
1. Supabase 左邊選單 → **SQL Editor** → **New query**。
2. 打開 GitHub 上面嘅 `crm/supabase/migrations/0001_init.sql`，全部複製，貼入去，撳 **Run**。見到 `Success` 就搞掂。
3. 再用同樣方法順序行 `0002_seasons.sql`（四季人脈）、`0003_activity_pdca.sql`（活動分＋PDCA）、`0004_whatsapp.sql`（Telegram 助手）同 `0005_business.sql`（每月生意表）。之後每次有新嘅 `00xx_….sql`，都係按編號順序行一次。

### 3. 熄咗「自己註冊」
Supabase → **Authentication** → **Sign In / Providers** → **Email**：
- 熄咗 **Allow new users to sign up**（帳戶只可以由 Ryan 開）
- 熄咗 **Confirm email**

### 4. 開 Ryan 嘅管理員帳戶
1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**，填 Ryan 嘅電郵同密碼，剔 **Auto Confirm User**。
2. 返去 **SQL Editor** 行下面呢句（換做 Ryan 嘅電郵）：
   ```sql
   update public.profiles set role = 'admin', full_name = 'Ryan' where email = 'ryan@你的公司.com';
   ```
   之後其他員工帳戶由 Ryan 喺系統入面「員工帳戶」頁自己開，唔使再入 Supabase。

### 5. 驗證權限（建議每次改資料庫之後都做）
**SQL Editor** → 貼入 `crm/supabase/tests/rls_check.sql` → **Run**。
- 見到紅色 error 寫住 **「✅ 全部 RLS 測試通過」** = 正常（呢個 error 係刻意嘅，用嚟還原測試資料，唔會留低任何嘢）。
- 見到 **「❌ FAIL: …」** = 有問題，唔好用住，搵開發者。

### 6. 產生加密鑰匙
客戶姓名、職業同所有表格內容都會加密先存入資料庫。需要一條 32 bytes 嘅鑰匙：
- Supabase **SQL Editor** 行：
  ```sql
  select encode(extensions.gen_random_bytes(32), 'base64') as key;
  ```
  複製出嚟嗰串（44 個字元，`=` 結尾）就係鑰匙。
- ⚠️ **呢條鑰匙一定要另外安全保存（例如密碼管理器）。遺失咗 = 所有客戶資料無法解密，冇得救。** 亦唔好俾任何人。

### 7. 部署去 Vercel
1. 去 <https://vercel.com> 用 GitHub 登入 → **Add New → Project** → 揀呢個 repo。
2. **Root Directory 設做 `crm`**（重要）。
3. **Environment Variables** 加以下 4 個（數值喺 Supabase → **Project Settings → API**）：

   | 名稱 | 數值 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key（保密！） |
   | `DATA_ENCRYPTION_KEY` | 第 6 步嘅鑰匙 |

4. 撳 **Deploy**。完成後 Vercel 會俾你一條網址，Ryan 用第 4 步嘅帳戶登入就用得。
5. （伺服器已經設定喺新加坡 `sin1` 運行，同資料庫同區，速度最快。）

### 8. 喺 Supabase 填返網址
Supabase → **Authentication → URL Configuration** → **Site URL** 填 Vercel 俾你嗰條網址。

---

## Telegram 助手

下屬用自己已綁定的 Telegram 私訊團隊 CRM bot。朝早可講「今日邀約 Mary，打算了解需要」，完成後講實際結果；詳細見客內容亦可獨立提交。助手先整理預覽，回覆「確認」才儲存，「取消」則放棄。只可處理自己負責的資料。

1. 管理員在 Vercel production 設定上方列出的 Telegram 及 AI 環境變數，再部署。
2. 使用 Telegram 官方 Bot API 的 setWebhook 註冊 `/api/telegram`，並設定 secret_token；用 getWebhookInfo 檢查結果。不要把正在其他主機輪詢的 bot 直接改成 webhook。
3. 下屬私訊 `/start`，將回覆的數字帳戶 ID 交主管。
4. 主管登入「員工帳戶」→ Telegram → 輸入該 ID。留空可解除綁定；停用員工會阻止助手存取。
5. 由實際員工發送一段測試內容，核對預覽後確認，再在 CRM 核對資料歸屬與儲存結果。

舊 WhatsApp API 已停用，原有加密歷史資料保留。Telegram 暫收文字；可用手機鍵盤語音輸入轉文字。

---

## 點用

| 角色 | 做到乜 |
|---|---|
| **員工** | 「約會日曆」記上午／中午／下午／晚上約會；「人脈網」將客拖去相約見面／深化跟進／落實方案（或者喺客戶頁用「人脈分類」選單揀），簽得就拖去最右「✍️ 已簽」，再撳「加入本月生意表」；「生意表」每月記客名、產品、AFYP、Revenue、佣金，同月目標比較（金額可以打 12000 或 1.2萬）；「客戶進度」睇自己啲客；「＋ 新增客戶」開卡；撳卡入去逐頁填 RR／NR1／NR2／FNA／PC；拖拉卡片轉階段（手機長按再拖，或者喺客戶頁用「階段」選單）。只可以睇、改自己嘅客。 |
| **Ryan（主管）** | 「主管總覽」睇全組：每人每個階段幾多客、邊個客具備簽單條件；每人約會日曆同本月 AFYP／佣金 vs 目標；撳員工名睇佢嘅看板、人脈網、約會日曆同生意表、撳客名睇詳情（唯讀）。「員工帳戶」開帳戶、停用／重新啟用、改名、重設密碼。「審計記錄」睇所有修改記錄。 |

**簽單條件：** RR 四格 ＋ NR2 四格全部剔晒，張卡自動變綠色「具備簽單條件」；未齊就顯示仲差邊幾格。

**停用員工：** 即時登入唔到、亦睇唔到任何客戶資料（就算佢部手機仲開住都冇用）。佢嘅客會保留，Ryan 仍然睇得到。

---

## 私隱保護（香港《個人資料（私隱）條例》）

- **加密：** 客戶姓名、年齡、性別、職業、婚姻狀況、所有表格內容，喺伺服器用 AES-256-GCM 加密後先存入資料庫；資料庫入面只係亂碼。傳輸用 HTTPS，Supabase 硬碟本身亦有加密。
- **權限控制（Row Level Security）：** 喺資料庫層面限制——員工淨係攞到自己嘅客；Ryan 只可以「睇」全部、唔可以改員工嘅客；未登入乜都攞唔到。就算有人繞過介面直接打 API 都一樣。
- **審計記錄：** 資料庫自動記低「邊個、幾時、改咗邊格」，包括階段變更前後；任何人（包括 Ryan）都改唔到、刪唔到。加密內容唔會抄入審計記錄。
- **唔收身份證號碼。**
- 冇開放自行註冊；帳戶只可由主管開設。

---

## 開發者資料

```
crm/
  app/                     Next.js 頁面（App Router）
    login/                 登入
    (app)/board/           員工看板
    (app)/clients/         新增客戶、客戶詳情、server actions
    (app)/admin/           主管總覽、員工看板、員工帳戶、審計記錄
    (app)/account/         改密碼
  components/              看板（@dnd-kit）、客戶表格、審計列表
  lib/stages.ts            五個階段表格欄位、簽單條件定義
  lib/crypto.ts            AES-256-GCM 欄位加密
  supabase/migrations/     資料庫結構 + RLS + 審計 trigger
  supabase/tests/          RLS 權限測試（可以直接喺 Supabase SQL Editor 行）
  tests/unit/              單元測試（vitest）
  tests/e2e/               端對端權限隔離測試（Playwright）
```

```bash
npm install
npm run lint        # TypeScript 檢查
npm test            # 單元測試
npx playwright test # 端對端（要測試用 Supabase + 行緊嘅 app，見 playwright.config.ts）
```

所有資料讀寫都喺伺服器用登入用戶嘅身份進行（受 RLS 限制）；`SUPABASE_SERVICE_ROLE_KEY` 只用喺「開／停員工帳戶」，而且一定先確認係管理員。

### Codex 教練整理（取代教練嘅 AI Gateway 呼叫）

`AI_MODE=codex` 將教練文字排入加密工作佇列；`CODEX_WORKER_TOKEN` 只授權
`/api/codex/jobs` 領取／回傳整理工作，唔係 CRM 登入，亦冇直接客戶寫入接口。
既有 `wa_drafts` 表以 `cancelled` 狀態保存獨立 `codex-job-v1` 密文封套，唔會被
當作可確認草稿；毋須遷移資料。員工 File 仍先保存原文。工作佇列唔包含其他客戶紀錄。

Vultr 上嘅 `scripts/codex-worker/worker.py` 只向 app 主動 HTTPS 輪詢，毋須開入站埠。
用獨立設定檔 `/root/telegram-ai/ryan-codex-worker.json`（0600）保存 app_url、token、codex_bin。
設定檔唔可以提交 Git 或放入部署檔案。Codex CLI 用既有 ChatGPT 登入，唔設定 API key；
使用仍受所屬帳戶／方案額度及條款限制，唔保證免費或無限用量，亦唔與目前 Codex 對話同步。
CLI 以新建臨時工作目錄、read-only sandbox、停用 shell／apps／plugins／hooks／多 agent／瀏覽器，
並用 output-schema 回傳 JSON。Worker 子程序唔收到工作佇列金鑰或 Supabase 憑證。

App 再驗證 schema、原 Telegram 身份仍有效、owner 同草稿版本；只回傳預覽。
同事明確確認後先走既有 owner-scoped RPC。過期 lease、重複回傳、綁定改變或舊結果一律拒絕；
投遞狀態不明時唔自動重播。Supervisor「檢查 AI」會排一份冇客戶資料嘅真實 Codex 檢查，
收到完成回條先顯示通過；只見到登入／設定唔當成服務可用。私人 PA 未啟用，維持原有獨立路由。

啟用：喺真正 Vultr 主機執行 `bash scripts/codex-worker/activate.sh`。
開發 sandbox 唔等於 Vultr systemd，未驗證 worker 常駐同真實 Telegram 往返前唔可以聲稱上線完成。

### 客戶資料歸位及手機版（2026-11-06）

年齡是文字型基本資料，支援確實、大概及範圍（55／50幾／約55／50-59），
不以50代表50幾，亦不從退休年齡、子女年齡推算客戶年齡。表單、顯示、Bot預覽、
Bot加密寫入及Bridge驗證共用 `lib/age.ts`；不需要資料遷移。
Codex指引加入逐類歸位、保留主語、事實與推論、貨幣與期間規則。
每個routing版本會自動排一份虛構健康檢查，驗證年齡／家庭／興趣／收入／退休目標；
health工作不會進入客戶草稿或寫入客戶。通過／失敗只記代碼訊息，不記客戶內容。
既有真實資料不會批量搬位或覆寫；已存錯的內容需按原文及身份逐筆核對。

720px或以下採用電話版：客戶分類選單一次顯示一欄；主管次要導覽收進更多功能；
表格分組、簽單條件及歷史按需要展開；空任務分類不佔畫面；週日期橫向捲動，
不壓縮成細字。主要字體16px、次要15px、控制項至少44px，所有內容仍可存取。
桌面保留完整看板及主管導覽，並共用高對比深色配色。

## Telegram research and document assistant

ZEST 團隊助手 can plan and execute bounded tools through the existing private Codex queue. The model produces validated tool arguments; server code performs the action and returns receipts on the next queue turn. The worker never receives bot tokens or Supabase credentials. Ordinary chat and tool jobs do not enter the customer-write flow. Each tool continuation rechecks the current active Telegram binding, consumes its lease before effects, and stops after six steps.

Supported tasks:

- Public web search and reading HTTPS pages, with actual source links in the answer. Prefer official, first-party product sources; unresolved versions, product names and languages require clarification.
- Download PDF, PPTX, DOCX, XLSX and common images (10 MB maximum), keep an encrypted private copy, and upload the bytes to the requesting Telegram account.
- Read PPTX text in slide order and edit specified text runs while retaining the original ZIP parts, styles, images and slide layout. This is text editing; layout redesign, embedded charts and `.ppt` conversion are not implemented. Users should check line wrapping in the delivered copy.
- Read DOCX text; inspect and fill existing XLSX cells as literal values without replacing formulas. Numeric values retain their numeric type, formula-like text stays literal, and Excel is asked to recalculate formulas on opening.
- Read PDFs and perform local traditional Chinese/English OCR on images or scanned PDFs (up to four scanned pages per request, 30 PDF pages total). OCR is probabilistic, especially handwriting and numbers; the result must be checked against the original.
- Fill standard PDF AcroForm fields using supplied values. Read back canonical field data and generate appearances, including Chinese text. Signed documents and XFA forms require an appropriate unsigned standard-form copy. Static scanned forms receive an OCR/field map or CSV, not an assertion that the source form was filled.
- Deliver text/CSV/Markdown outputs. `/get <fileKey>` retrieves an existing private file; `/files` opens the authenticated File area.

Form values are checked against the current message and the same owner's recent user messages. Missing values must be requested; do not invent client details or signatures. Tool outputs and web/file contents are untrusted reference data. Network reads pin a public IPv4 DNS record, recheck each redirect, reject local/metadata/private addresses and credentials, and bound response size and time. ZIP expansion, macro containers and target IDs are validated. Original documents remain unchanged.

`npm run build` downloads checksum-pinned OCR language packs and a Noto Sans TC font with `scripts/prepare-assistant-assets.mjs`; no new paid AI/API service is configured. Native OCR/PDF dependencies are bundled with the Codex jobs route. `ASSISTANT_RUNTIME_TEST=1 npx vitest run tests/unit/assistant-runtime.test.ts` exercises real OCR, Chinese PDF fill/readback and public web access in a network-enabled test environment.

Accuracy policy requires source checks for current and consequential information, distinguishes facts from suggestions, and rejects fabricated citation URLs. This reduces risk but is not a guarantee of correctness. The live `assistant-tools-v1` health probe checks tool planning without accessing customer data or sending a Telegram message; it does not replace a real staff send/receive test.

### Receipt reactions and research routing

Telegram receipt acknowledgements use a small native thumbs-up reaction (`setMessageReaction`, `is_big:false`) on the original message, retaining its Telegram message ID separately from the update ID. No standalone emoji message is sent. Complex work still gets one approximate processing-time notice.

Current product/research questions are routed to typed search/read actions before a chat answer is permitted. Prior conversation refusals do not override available tools. Comparisons mentioning FWD and Sun Life require official sources from both companies; supplied customer-update statements keep their existing CRM flow. Public PDF sources can be read directly through `open_url` without sending a reference file to the user. A synthetic comparison probe exercises search, official-page reading and a sourced answer under a prior-refusal history, without sending Telegram messages or changing customers.
