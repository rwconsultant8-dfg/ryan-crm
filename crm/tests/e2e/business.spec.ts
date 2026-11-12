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
const NAME = `測試簽單${stamp}`;

async function login(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("電郵").fill(who.email);
  await page.getByLabel("密碼").fill(who.password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function drag(page: Page, cardText: string, targetStage: string) {
  await page.waitForLoadState("networkidle");
  const card = page.getByTestId("client-card").filter({ hasText: cardText });
  const target = page.locator(`[data-stage="${targetStage}"]`);
  await target.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
  // 喺目標欄可見部分嘅中間放手（太近畫面邊會觸發自動捲動）
  const vh = page.viewportSize()!.height;
  const top = Math.max(to.y, 120);
  const bottom = Math.min(to.y + to.height, vh - 120);
  await page.mouse.move(to.x + to.width / 2, (top + bottom) / 2, { steps: 15 });
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/seasons"));
  await page.mouse.up();
  await saved;
}

test.describe.serial("人脈網拖去已簽 ＋ 每月生意表", () => {
  test("人脈網：煲緊嘅客拖去「已簽」→ 加入本月生意表", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await login(page, A);
    await page.goto("/clients/new");
    await page.getByLabel("姓名 *").fill(NAME);
    await page.getByRole("button", { name: "建立客戶卡" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
    const clientId = page.url().split("/").pop()!;

    await page.goto("/seasons");
    await drag(page, NAME, "SUMMER");
    await expect(page.locator('[data-stage="SUMMER"]')).toContainText(NAME);

    page.once("dialog", (d) => d.accept()); // 未具備簽單條件，確認照簽
    await drag(page, NAME, "SIGNED_ZONE");
    await expect(page.locator('[data-stage="SIGNED_ZONE"]')).toContainText(NAME);
    await expect(page.getByTestId("board-notice")).toContainText(`「${NAME}」已簽`);
    await page.reload();
    await expect(page.locator('[data-stage="SIGNED_ZONE"]')).toContainText(NAME);
    await expect(page.locator('[data-stage="SUMMER"]')).not.toContainText(NAME);

    // 客戶卡階段已經變咗「已簽」
    await page.goto(`/clients/${clientId}`);
    await expect(page.getByLabel("階段")).toHaveValue("SIGNED");

    // 加入生意表
    await page.goto(`/business?add=${clientId}`);
    const row = page.getByTestId("biz-row").filter({ has: page.locator(`input[value="${NAME}"]`) });
    await expect(row).toContainText("已連客戶卡");
    await row.getByLabel(/產品/).fill("儲蓄計劃");
    await row.getByLabel(/AFYP/).fill("1.2萬");
    await row.getByLabel(/Revenue/).fill("9,000");
    await row.getByLabel(/佣金/).fill("3600");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByText("已儲存", { exact: true })).toBeVisible();

    await page.reload();
    const saved = page.getByTestId("biz-row").filter({ has: page.locator(`input[value="${NAME}"]`) });
    await expect(saved.getByLabel(/AFYP/)).toHaveValue("12000");
    await expect(saved.getByLabel(/產品/)).toHaveValue("儲蓄計劃");
    // 已入表嘅客唔會再出現喺「未入生意表」提示
    await expect(page.locator(".biz-suggest", { hasText: NAME })).toHaveCount(0);

    // 月目標
    await page.locator("details.biz-target").evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.getByLabel("AFYP（HK$）").fill("1");
    await page.getByLabel("AFYP（HK$）").fill("50000");
    await page.getByRole("button", { name: "儲存目標" }).click();
    await expect(page.getByText("已儲存目標")).toBeVisible();
    await expect(page.getByTestId("biz-AFYP")).toContainText("目標 $50,000");
  });

  test("由「已簽」拖返出去 = 撤回，階段改返深化跟進", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await login(page, A);
    await page.goto("/seasons");
    page.once("dialog", (d) => d.accept());
    await drag(page, NAME, "AUTUMN");
    await page.reload();
    await expect(page.locator('[data-stage="AUTUMN"]')).toContainText(NAME);
    await page.getByTestId("client-card").filter({ hasText: NAME }).click();
    await expect(page.getByLabel("階段")).toHaveValue("FOLLOWUP");
  });

  test("員工 B 睇唔到；主管總覽同生意表唯讀", async ({ page }) => {
    await login(page, B);
    await page.goto("/business");
    await expect(page.locator(`input[value="${NAME}"]`)).toHaveCount(0);
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await sb.auth.signInWithPassword(B);
    const { data: me } = await sb.auth.getUser();
    const { data } = await sb.from("business_cases").select("owner_id");
    expect(data!.every((r) => r.owner_id === me.user!.id)).toBe(true);

    await login(page, ADMIN);
    await page.goto("/admin");
    const amyRow = page.getByTestId("team-table").getByRole("row").filter({ hasText: "Amy" });
    await expect(amyRow.getByTestId("biz-cell")).toContainText("AFYP $");
    await expect(amyRow.getByTestId("biz-cell")).toContainText("／$50,000");
    await amyRow.getByTestId("biz-cell").click();
    await expect(page.getByText("唯讀")).toBeVisible();
    await expect(page.locator(`input[value="${NAME}"]`)).toBeDisabled();
    await expect(page.getByRole("button", { name: "儲存", exact: true })).toHaveCount(0);
  });
});
