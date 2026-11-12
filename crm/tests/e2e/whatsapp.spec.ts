import { createHmac } from "node:crypto";
import http from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// WhatsApp 助手端對端測試：
//  - 用本地模擬伺服器代替 Claude API 同 WhatsApp Graph API（port 4010）
//  - app 要用以下環境變數啟動：ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=test
//    WHATSAPP_GRAPH_URL=http://127.0.0.1:4010/graph WHATSAPP_APP_SECRET=test-app-secret
//    WHATSAPP_PHONE_NUMBER_ID=123 WHATSAPP_TOKEN=test

const SECRET = "test-app-secret";
const AMY_PHONE = "85291110001";
const cred = (v: string | undefined) => {
  const [email, password] = (v ?? "").split(":");
  return { email, password };
};
const ADMIN = cred(process.env.E2E_ADMIN);
const A = cred(process.env.E2E_AGENT_A);
const B = cred(process.env.E2E_AGENT_B);
const stamp = Date.now().toString().slice(-5);
const NAME = `何生${stamp}`;

type Sent = { to: string; body: string };
const sent: Sent[] = [];
const aiRequests: Record<string, unknown>[] = [];
let server: http.Server;

function extraction(text: string) {
  const base = {
    client: { name: "", age: "", gender: "", occupation: "", marital: "" },
    fields: [] as { field: string; text: string }[],
    checks: [] as string[],
    stage: "",
    season: "",
    activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 },
    appointment: { slot: "", text: "" },
    date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
    summary: "整理咗",
  };
  const name = text.match(/何生\d+/)?.[0] ?? "";
  if (text.includes("補充")) {
    return { ...base, client: { ...base.client, name }, fields: [{ field: "form_fna.income", text: "80,000" }, { field: "form_rr.finance", text: "・月入 8 萬" }] };
  }
  if (text.includes("晨會")) return { ...base, activity: { ...base.activity, r: 1 } };
  return {
    ...base,
    client: { name, age: "40", gender: "M", occupation: "工程師", marital: "married" },
    fields: [{ field: "form_rr.family", text: "・已婚，兩個女" }],
    checks: ["rr_like_trust"],
    activity: { ...base.activity, a: 1, rr: 1 },
    appointment: { slot: "lunch", text: `${name} 中環` },
  };
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.url?.startsWith("/graph/")) {
        sent.push({ to: json.to, body: json.text?.body ?? "" });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end('{"messages":[{"id":"x"}]}');
      }
      if (req.url?.startsWith("/v1/messages")) {
        aiRequests.push(json);
        const user = String(json.messages?.[0]?.content ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: json.model,
            content: [{ type: "text", text: JSON.stringify(extraction(user)) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        );
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(4010, "127.0.0.1", r));
});
test.afterAll(() => server.close());

let msgSeq = 0;
async function sendWa(page: Page, from: string, text: string, opts: { id?: string; badSig?: boolean } = {}) {
  const id = opts.id ?? `wamid.${stamp}.${msgSeq++}`;
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body: text } }] } }] }],
  });
  const sig = "sha256=" + createHmac("sha256", opts.badSig ? "wrong" : SECRET).update(body).digest("hex");
  return page.request.post("/api/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
}

async function waitReply(to: string, contains: string) {
  await expect.poll(() => sent.filter((s) => s.to === to).map((s) => s.body).join("\n---\n"), { timeout: 15000 }).toContain(contains);
  return sent.filter((s) => s.to === to).at(-1)!.body;
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("電郵").fill(who.email);
  await page.getByLabel("密碼").fill(who.password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.serial("WhatsApp 助手", () => {
  test("主管幫員工 A 登記 WhatsApp 號碼", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/staff");
    page.once("dialog", (d) => d.accept("9111 0001"));
    await page.getByRole("row").filter({ hasText: A.email }).getByTitle(/設定 WhatsApp/).click();
    await expect(page.getByText(`已設定 WhatsApp：+${AMY_PHONE}`)).toBeVisible();
  });

  test("簽名唔啱會拒絕；未登記號碼會叫佢搵主管", async ({ page }) => {
    const bad = await sendWa(page, AMY_PHONE, "hi", { badSig: true });
    expect(bad.status()).toBe(401);
    const ok = await sendWa(page, "85290000000", "hi");
    expect(ok.status()).toBe(200);
    await waitReply("85290000000", "未登記");
  });

  test("講見客內容 → 整理 → 確認 → 寫入 app（新客＋活動分）", async ({ page }) => {
    await sendWa(page, AMY_PHONE, `今日同${NAME}食午餐，40歲工程師，已婚兩個女，好信任我`);
    const reply = await waitReply(AMY_PHONE, "幫你整理咗");
    expect(reply).toContain(`${NAME}（🆕 新客，40歲・男・工程師・已婚）`);
    expect(reply).toContain("【了解客戶・1) 家庭】");
    expect(reply).toContain("A+1、RR+1");

    // AI 請求用咗 structured outputs 同 fallback
    const req = aiRequests.at(-1)!;
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(req.fallbacks).toBe("default");

    // 未確認之前 app 入面冇呢個客
    await login(page, A);
    await page.goto("/board");
    await expect(page.getByText(NAME)).toHaveCount(0);
    await page.goto("/whatsapp");
    await expect(page.getByTestId("wa-draft").first()).toContainText("等你確認");

    await sendWa(page, AMY_PHONE, "確認");
    await waitReply(AMY_PHONE, `已儲存到「${NAME}」`);

    await page.goto("/board");
    await page.getByTestId("client-card").filter({ hasText: NAME }).click();
    await page.waitForURL(/\/clients\//);
    await expect(page.getByTestId("ready-box")).toContainText("簽單條件 1/8");
    await page.getByRole("tab", { name: "相約見面" }).click();
    await expect(page.getByLabel("家庭")).toHaveValue(/・已婚，兩個女/);
    await page.getByText(/^修改記錄/).click();
    await expect(page.getByText("WhatsApp").first()).toBeVisible();
  });

  test("補充同一個客 → 長文字加喺後面、數字直接更新", async ({ page }) => {
    await sendWa(page, AMY_PHONE, `補充：${NAME} 月入8萬`);
    const reply = await waitReply(AMY_PHONE, "【財務分析・收入（每月 HK$）】");
    expect(reply).toContain(`客戶：${NAME}`);
    expect(reply).not.toContain("新客");
    await sendWa(page, AMY_PHONE, "確認");
    await waitReply(AMY_PHONE, `已儲存到「${NAME}」`);

    await login(page, A);
    await page.goto("/board");
    await page.getByTestId("client-card").filter({ hasText: NAME }).click();
    await page.waitForURL(/\/clients\//);
    await page.getByRole("tab", { name: "深化跟進" }).click();
    await expect(page.getByLabel("收入（每月 HK$）")).toHaveValue("80000");
    await page.getByRole("tab", { name: "相約見面" }).click();
    await expect(page.getByLabel("家庭")).toHaveValue(/・已婚，兩個女/); // 舊內容仲喺度
    await expect(page.getByLabel("財務情況")).toHaveValue(/・月入 8 萬/);
  });

  test("取消唔會寫入；重送同一個訊息只處理一次", async ({ page }) => {
    const before = sent.filter((s) => s.to === AMY_PHONE).length;
    await sendWa(page, AMY_PHONE, "今日有晨會", { id: `dup-${stamp}` });
    await waitReply(AMY_PHONE, "R+1");
    await sendWa(page, AMY_PHONE, "今日有晨會", { id: `dup-${stamp}` });
    await page.waitForTimeout(1500);
    expect(sent.filter((s) => s.to === AMY_PHONE).length).toBe(before + 1);
    await sendWa(page, AMY_PHONE, "取消");
    await waitReply(AMY_PHONE, "已取消");
  });

  test("員工 B 睇唔到員工 A 嘅 WhatsApp 草稿", async () => {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await sb.auth.signInWithPassword(B);
    const { data } = await sb.from("wa_drafts").select("id, owner_id");
    const { data: me } = await sb.auth.getUser();
    expect(data!.every((d) => d.owner_id === me.user!.id)).toBe(true);
    const { error } = await sb.rpc("wa_save_client", { p_actor: me.user!.id, p_id: me.user!.id, p_patch: {}, p_create: false });
    expect(error).not.toBeNull();
  });
});
