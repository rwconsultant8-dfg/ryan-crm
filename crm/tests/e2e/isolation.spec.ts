import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const cred = (v: string | undefined) => {
  const [email, password] = (v ?? "").split(":");
  return { email, password };
};
const ADMIN = cred(process.env.E2E_ADMIN);
const A = cred(process.env.E2E_AGENT_A);
const B = cred(process.env.E2E_AGENT_B);
const stamp = Date.now().toString().slice(-5);
const CLIENT_1 = `測試陳大文${stamp}`;
const CLIENT_2 = `測試李小美${stamp}`;
const WEEK = "2025-01-06"; // 固定用一個過去星期，唔受其他測試（例如 WhatsApp）影響

async function login(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("電郵").fill(who.email);
  await page.getByLabel("密碼").fill(who.password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function apiAs(who: { email: string; password: string }) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await sb.auth.signInWithPassword(who);
  if (error) throw error;
  return sb;
}

let client1Url = "";
let client1Id = "";

test.describe.serial("權限隔離", () => {
  test("員工 A 開客、填 RR／NR2、自動標具備簽單條件", async ({ page }) => {
    await login(page, A);
    await expect(page).toHaveURL(/\/board/);

    await page.goto("/clients/new");
    await page.getByLabel("姓名 *").fill(CLIENT_1);
    await page.getByLabel("年齡").fill("35");
    await page.getByLabel("性別").selectOption("M");
    await page.getByLabel("職業").fill("會計師");
    await page.getByLabel("婚姻狀況").selectOption("married");
    await page.getByRole("button", { name: "建立客戶卡" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
    client1Url = new URL(page.url()).pathname;
    client1Id = client1Url.split("/").pop()!;

    await expect(page.getByTestId("ready-box")).toContainText("仲差 8 格");

    await expect(page.getByRole("tab", { name: "Fact Finding", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("家庭").fill("已婚，一個仔讀小學");
    await page.getByLabel("職業", { exact: true }).fill("資深會計師");
    for (const l of ["客人喜歡和信任你", "客人有穩定收入或淨資產", "客人與你有交情／共同經歷", "了解到客人的現況與目標"]) {
      await page.getByLabel(l).check();
    }
    await page.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByText("已儲存")).toBeVisible();
    await expect(page.getByTestId("ready-box")).toContainText("仲差 4 格");

    await page.getByRole("tab", { name: "Needs", exact: true }).click();
    for (const l of ["確認客人的需要", "預演計劃相關內容", "確立客人預算金額", "確定下次會面時間"]) {
      await page.getByLabel(l, { exact: true }).check();
    }
    await page.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByText("已儲存")).toBeVisible();
    await expect(page.getByTestId("ready-box")).toContainText("具備簽單條件");

    await page.reload();
    await expect(page.getByRole("tab", { name: "Fact Finding", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("職業", { exact: true })).toHaveValue("資深會計師");
    await expect(page.getByLabel("家庭")).toHaveValue("已婚，一個仔讀小學");

    await page.goto("/clients/new");
    await page.getByLabel("姓名 *").fill(CLIENT_2);
    await page.getByRole("button", { name: "建立客戶卡" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);

    await page.goto("/board");
    const card = page.getByTestId("client-card").filter({ hasText: CLIENT_1 });
    await expect(card).toContainText("具備簽單條件");
    await expect(page.locator('[data-stage="MEETING"]')).toContainText(CLIENT_1);
  });

  test("員工 A 拖拉卡片轉階段", async ({ page }) => {
    await login(page, A);
    await page.goto("/board");
    const card = page.getByTestId("client-card").filter({ hasText: CLIENT_2 });
    const target = page.locator('[data-stage="FOLLOWUP"]');
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/board"));
    await page.mouse.up();
    await expect(target).toContainText(CLIENT_2);
    await saved;
    await page.reload();
    await expect(page.locator('[data-stage="FOLLOWUP"]')).toContainText(CLIENT_2);
  });

  test("員工 A 喺人脈網拖拉客人", async ({ page }) => {
    await login(page, A);
    await page.goto("/seasons");
    await expect(page.locator('[data-stage="NONE"]')).toContainText(CLIENT_1);
    const card = page.getByTestId("client-card").filter({ hasText: CLIENT_1 });
    const target = page.locator('[data-stage="SUMMER"]');
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + 100, { steps: 15 });
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/seasons"));
    await page.mouse.up();
    await expect(target).toContainText(CLIENT_1);
    await saved;
    await page.reload();
    await expect(page.locator('[data-stage="SUMMER"]')).toContainText(CLIENT_1);
    // 客戶頁顯示同一個季節，亦可以用選單改
    await page.getByTestId("client-card").filter({ hasText: CLIENT_2 }).click();
    await page.waitForURL(/\/clients\//);
    await page.getByLabel("人脈分類").selectOption("AUTUMN");
    await expect(page.getByText("已更新人脈分類")).toBeVisible();
    await page.goto("/seasons");
    await expect(page.locator('[data-stage="AUTUMN"]')).toContainText(CLIENT_2);
  });

  test("員工 B 睇唔到、攞唔到、改唔到員工 A 嘅客", async ({ page }) => {
    await login(page, B);
    await page.goto("/board");
    await expect(page.getByText(CLIENT_1)).toHaveCount(0);
    await expect(page.getByText(CLIENT_2)).toHaveCount(0);

    // 直接打網址
    await page.goto(client1Url);
    await expect(page.getByRole("heading", { name: "搵唔到" })).toBeVisible();
    await expect(page.getByText(CLIENT_1)).toHaveCount(0);

    // 主管頁
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/board/);

    // 繞過介面直接打 API
    const sb = await apiAs(B);
    const { data: rows } = await sb.from("clients").select("id, owner_id");
    expect(rows!.every((r) => r.owner_id !== undefined && r.id !== client1Id)).toBe(true);
    const { data: one } = await sb.from("clients").select("*").eq("id", client1Id);
    expect(one).toEqual([]);
    const { data: upd } = await sb.from("clients").update({ stage: "ISSUED" }).eq("id", client1Id).select("id");
    expect(upd).toEqual([]);
    const { data: seas } = await sb.from("clients").update({ season: "WINTER" }).eq("id", client1Id).select("id");
    expect(seas).toEqual([]);
    await page.goto("/seasons");
    await expect(page.getByText(CLIENT_1)).toHaveCount(0);
    const { data: del } = await sb.from("clients").delete().eq("id", client1Id).select("id");
    expect(del).toEqual([]);
    const { data: audit } = await sb.from("audit_log").select("id").eq("record_id", client1Id);
    expect(audit).toEqual([]);
    const { data: people } = await sb.from("profiles").select("email");
    expect(people!.map((p) => p.email)).toEqual([B.email]);
  });

  test("主管睇到全組，但只係唯讀", async ({ page }) => {
    await login(page, ADMIN);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("team-table")).toBeVisible();
    await page.getByRole("link", { name: CLIENT_1 }).click();
    await expect(page.getByText("唯讀模式")).toBeVisible();
    await expect(page.getByLabel("姓名 *")).toBeDisabled();
    await expect(page.getByRole("button", { name: "儲存" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Fact Finding", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("家庭")).toHaveValue("已婚，一個仔讀小學");
    await page.getByText(/^修改記錄/).click();
    await expect(page.getByText("了解客戶・1) 家庭").first()).toBeVisible(); // 修改記錄

    const sb = await apiAs(ADMIN);
    const { data: upd } = await sb.from("clients").update({ stage: "ISSUED" }).eq("id", client1Id).select("id");
    expect(upd).toEqual([]);

    // 主管睇員工 A 嘅四季（唯讀，拖唔到）
    const { data: me } = await sb.auth.getUser();
    const { data: amy } = await sb.from("clients").select("owner_id").eq("id", client1Id).single();
    expect(amy!.owner_id).not.toBe(me.user!.id);
    await page.goto(`/seasons?agent=${amy!.owner_id}`);
    await expect(page.getByText("唯讀")).toBeVisible();
    await expect(page.locator('[data-stage="SUMMER"]')).toContainText(CLIENT_1);

    await page.goto("/admin/audit");
    await expect(page.getByText(`客戶：${CLIENT_1}`).first()).toBeVisible();
  });

  test("活動分：員工 A 記活動、自動計分、 appointment加密儲存", async ({ page }) => {
    await login(page, A);
    await page.goto(`/activity?week=${WEEK}`);
    await page.getByLabel("星期一 A", { exact: true }).fill("3");
    await page.getByLabel("星期一 N", { exact: true }).fill("1");
    await page.getByLabel("星期一 午餐 appointment").fill(`${CLIENT_1} 中環`);
    await expect(page.getByTestId("week-summary").getByTestId("kpi")).toContainText("11 分 · 紅");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByText("已儲存")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("星期一 A", { exact: true })).toHaveValue("3");
    await expect(page.getByLabel("星期一 N", { exact: true })).toHaveValue("1");
    await expect(page.getByLabel("星期一 午餐 appointment")).toHaveValue(`${CLIENT_1} 中環`);
    await expect(page.getByTestId("week-summary").getByTestId("kpi")).toContainText("11 分 · 紅");

    // PDCA：嗰週分數自動帶入，寫焦點
    await page.goto("/pdca?year=2025&q=1");
    const thisWeek = page.locator("tbody tr").filter({ has: page.getByTestId("kpi").filter({ hasText: "11 分" }) });
    await expect(thisWeek).toHaveCount(1);
    await thisWeek.locator('textarea[aria-label$="宣告焦點"]').fill(`開口${stamp}個人`);
    await page.getByRole("button", { name: "儲存 PDCA 焦點" }).click();
    await expect(page.getByText("已儲存")).toBeVisible();
    await page.getByLabel("O 目標").fill(`全年目標${stamp}`);
    await page.getByRole("button", { name: "儲存 OKR" }).click();
    await expect(page.getByText("已儲存").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("textarea").filter({ hasText: `開口${stamp}個人` })).toHaveCount(1);
    await expect(page.getByLabel("O 目標")).toHaveValue(`全年目標${stamp}`);
  });

  test("活動分／PDCA：員工 B 睇唔到員工 A；主管可以唯讀睇 A 嘅活動分", async ({ page }) => {
    await login(page, B);
    await page.goto(`/activity?week=${WEEK}`);
    await expect(page.getByLabel("星期一 午餐 appointment")).not.toHaveValue(`${CLIENT_1} 中環`);
    await page.goto("/pdca?year=2025&q=1");
    await expect(page.locator("textarea").filter({ hasText: `開口${stamp}個人` })).toHaveCount(0);
    const sb = await apiAs(B);
    const { data: me } = await sb.auth.getUser();
    for (const t of ["activity_days", "pdca_weeks", "okrs"]) {
      const { data } = await sb.from(t).select("owner_id");
      expect(data!.every((r) => r.owner_id === me.user!.id)).toBe(true);
    }

    await login(page, ADMIN);
    await page.goto("/admin");
    const amyRow = page.getByTestId("team-table").getByRole("row").filter({ hasText: "Amy" });
    await expect(amyRow.getByTestId("kpi")).toContainText("分");
    await amyRow.getByTestId("kpi").click();
    await expect(page.getByText("唯讀")).toBeVisible();
    await page.goto(page.url() + `&week=${WEEK}`);
    await expect(page.getByTestId("week-summary").getByTestId("kpi")).toContainText("11 分 · 紅");
    await expect(page.getByLabel("星期一 A", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "儲存", exact: true })).toHaveCount(0);
  });

  test("主管停用員工 B 後，B 登入唔到、API 都攞唔到資料", async ({ page }) => {
    const sbB = await apiAs(B); // 停用前已登入嘅 session
    await login(page, ADMIN);
    await page.goto("/admin/staff");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("row").filter({ hasText: B.email }).getByRole("button", { name: "停用" }).click();
    await expect(page.getByText("已停用（即時")).toBeVisible();

    const { data } = await sbB.from("clients").select("id");
    expect(data).toEqual([]);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("電郵").fill(B.email);
    await page.getByLabel("密碼").fill(B.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByText("電郵或密碼唔啱，或者帳戶已停用")).toBeVisible();

    // 還原
    await login(page, ADMIN);
    await page.goto("/admin/staff");
    await page.getByRole("row").filter({ hasText: B.email }).getByRole("button", { name: "重新啟用" }).click();
    await expect(page.getByText("已重新啟用")).toBeVisible();
  });
});
