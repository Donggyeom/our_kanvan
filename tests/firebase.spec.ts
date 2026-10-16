import { test, expect, type Page } from "@playwright/test";
async function register(page: Page, name: string, email: string) {
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이름", { exact: true }).fill(name);
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
}
async function prompt(page: Page, text: string, action: () => Promise<void>) {
  page.once("dialog", (d) => d.accept(text));
  await action();
}
test("two authenticated browsers: invite, realtime, stale edit, reconnect and revoked board access", async ({
  browser,
}) => {
  const a = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await a.newPage(),
    member = await b.newPage();
  const suffix = Date.now();
  const email = `browser-member-${suffix}@example.com`;
  try {
    await admin.goto("http://127.0.0.1:5174");
    await register(
      admin,
      "브라우저 관리자",
      `browser-admin-${suffix}@example.com`,
    );
    await prompt(admin, "브라우저 검증 팀", () =>
      admin.getByRole("button", { name: "새 워크스페이스 만들기" }).click(),
    );
    await expect(
      admin.getByRole("button", { name: "프로젝트 추가" }),
    ).toBeVisible();
    await admin.getByRole("button", { name: "프로젝트 추가" }).click();
    await admin.getByLabel("보드 이름").fill("실시간 검증 보드");
    await admin.getByLabel("보드 설명").fill("두 사용자 동기화");
    await admin.getByRole("button", { name: "보드 저장" }).click();
    await expect(
      admin.getByRole("heading", { name: /실시간 검증 보드/ }),
    ).toBeVisible();
    await admin.getByRole("button", { name: "팀 설정", exact: true }).click();
    await prompt(admin, email, () =>
      admin.getByRole("button", { name: "팀원 초대", exact: true }).click(),
    );
    const link = await admin.locator(".invite-generated input").inputValue();
    await member.goto(link.replace("localhost", "127.0.0.1"));
    await register(member, "브라우저 팀원", email);
    await expect(
      member.getByRole("heading", { name: /실시간 검증 보드/ }),
    ).toBeVisible();
    await admin
      .locator("aside")
      .getByRole("button", { name: "전체 보드", exact: true })
      .click();
    await admin.getByRole("button", { name: "새 업무", exact: false }).click();
    await admin
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("공동 수정 카드");
    await admin
      .getByRole("dialog")
      .getByLabel("담당자")
      .selectOption({ label: "브라우저 팀원" });
    await admin.getByRole("button", { name: "업무 등록", exact: true }).click();
    const acard = admin.getByRole("button", {
        name: "공동 수정 카드",
        exact: true,
      }),
      bcard = member.getByRole("button", {
        name: "공동 수정 카드",
        exact: true,
      });
    await expect(bcard).toBeVisible();
    await acard.click();
    await bcard.click();
    await member
      .getByRole("dialog")
      .getByLabel("상세 설명")
      .fill("오래된 초안");
    await admin
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("먼저 저장한 제목");
    await admin.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(member.getByRole("alert")).toContainText("최신 내용");
    await member.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(member.getByRole("dialog")).toBeVisible();
    await expect(member.locator(".toast")).toContainText("다른 사용자가");
    await prompt(member, "", () =>
      member.getByRole("button", { name: "최신 내용 불러오기" }).click(),
    );
    await expect(
      member.getByRole("dialog").getByLabel("업무 제목"),
    ).toHaveValue("먼저 저장한 제목");
    await expect(
      member.getByRole("dialog").getByLabel("상세 설명"),
    ).toHaveValue("");
    await member
      .getByRole("dialog")
      .getByLabel("상태", { exact: true })
      .selectOption("issue");
    await member.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(admin.locator('[data-status="issue"]')).toContainText(
      "먼저 저장한 제목",
    );
    await b.setOffline(true);
    await expect(
      member.getByRole("status").filter({ hasText: "연결 끊김" }),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "먼저 저장한 제목", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("재연결 최신 제목");
    await admin.getByRole("button", { name: "변경사항 저장" }).click();
    await b.setOffline(false);
    await member
      .locator(".mobile-status-tabs")
      .getByRole("button", { name: /Issue/ })
      .click();
    await expect(
      member.getByRole("button", { name: "재연결 최신 제목", exact: true }),
    ).toBeVisible();
    await member
      .getByRole("button", { name: "재연결 최신 제목", exact: true })
      .click();
    await member.getByRole("button", { name: /변경 이력/ }).click();
    await expect(member.locator(".history-list")).toContainText(
      "먼저 저장한 제목",
    );
    await expect(member.locator(".history-list")).toContainText("Issue");
    await member.getByRole("button", { name: "닫기", exact: true }).click();
    await admin
      .getByRole("button", { name: "재연결 최신 제목", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByLabel("담당자", { exact: true })
      .selectOption("");
    await admin.getByRole("button", { name: "변경사항 저장" }).click();
    await admin.getByRole("button", { name: "팀 설정", exact: true }).click();
    await admin.getByRole("button", { name: "편집 · 참여자" }).click();
    await admin.getByRole("checkbox", { name: /브라우저 팀원/ }).uncheck();
    await admin.getByRole("button", { name: "보드 저장" }).click();
    await expect(member.locator(".task-card")).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "새 업무", exact: false }),
    ).toHaveCount(0);
    await admin.screenshot({
      path: "artifacts/firebase-desktop.png",
      fullPage: true,
    });
    await member.screenshot({
      path: "artifacts/firebase-mobile.png",
      fullPage: true,
    });
  } finally {
    await a.close();
    await b.close();
  }
});
