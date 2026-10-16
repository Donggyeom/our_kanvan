import { test, expect, type Page } from "@playwright/test";
async function nav(page: Page, name: string) {
  if (await page.getByRole("button", { name: "메뉴 열기" }).isVisible())
    await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page
    .locator("aside")
    .getByRole("button", { name, exact: true })
    .click();
}
for (const width of [390, 768, 1280]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("Coral Orange, four statuses and layout have no page overflow", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: /신규 서비스 개발/ }),
      ).toBeVisible();
      await expect(page.locator(".status-wrap")).toHaveCount(4);
      if (width === 390) {
        for (const status of ["To Do", "In Progress", "Done", "Issue"]) {
          await page
            .locator(".mobile-status-tabs")
            .getByRole("button", { name: new RegExp(status) })
            .click();
          await expect(
            page.locator(".mobile-current .column-title"),
          ).toContainText(status);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator(".brand-tile").first()).toHaveCSS(
        "background-color",
        "rgb(249, 115, 22)",
      );
      await page.screenshot({
        path: `artifacts/board-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
    test("create, edit status, history, archive and restore through touch-friendly detail form", async ({
      page,
    }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "새 업무", exact: false }).click();
      const dialog = page.getByRole("dialog", { name: "새 업무" });
      await dialog.getByLabel("업무 제목").fill(`검수 업무 ${width}`);
      await dialog
        .getByLabel("상세 설명")
        .fill('<script>alert("safe")</script> 일반 텍스트');
      await dialog.getByLabel("담당자").selectOption("demo");
      await dialog.getByLabel("완료기한").fill("2026-12-31");
      await dialog
        .getByRole("button", { name: "업무 등록", exact: true })
        .click();
      const card = page.getByRole("button", {
        name: `검수 업무 ${width}`,
        exact: true,
      });
      await card.click();
      const detail = page.getByRole("dialog", { name: "업무 상세" });
      await detail.getByLabel("상태", { exact: true }).selectOption("done");
      await detail.getByRole("button", { name: "변경사항 저장" }).click();
      if (width === 390)
        await page
          .locator(".mobile-status-tabs")
          .getByRole("button", { name: /Done/ })
          .click();
      await card.click();
      await detail.getByRole("button", { name: /변경 이력/ }).click();
      await expect(detail.locator(".history-list")).toContainText("상태");
      await detail.getByRole("button", { name: "업무 정보" }).click();
      await detail.getByRole("button", { name: "보관", exact: true }).click();
      await expect(card).toHaveCount(0);
      await nav(page, "보관함");
      await page.getByRole("button", { name: "복원", exact: true }).click();
      await nav(page, "전체 보드");
      if (width === 390)
        await page
          .locator(".mobile-status-tabs")
          .getByRole("button", { name: /Done/ })
          .click();
      await expect(card).toBeVisible();
      await page.reload();
      if (width === 390)
        await page
          .locator(".mobile-status-tabs")
          .getByRole("button", { name: /Done/ })
          .click();
      await expect(card).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
    test("search, priority sorting, my tasks and filter reset", async ({
      page,
    }) => {
      await page.goto("/");
      await page
        .getByRole("textbox", { name: "업무 검색" })
        .fill("실시간 동기화 오류");
      if (width === 390)
        await page
          .locator(".mobile-status-tabs")
          .getByRole("button", { name: /Issue/ })
          .click();
      await expect(page.locator(".task-card")).toHaveCount(1);
      await page
        .getByRole("textbox", { name: "업무 검색" })
        .fill("없는 검색 결과");
      await expect(
        page.getByText("조건에 맞는 업무가 없습니다."),
      ).toBeVisible();
      await page.getByRole("button", { name: "초기화", exact: true }).click();
      await expect(page.locator(".task-card")).toHaveCount(7);
      await page.getByLabel("정렬", { exact: true }).selectOption("high");
      await expect(
        page.getByRole("button", { name: "카드 이동" }).first(),
      ).toHaveAttribute("aria-disabled", "true");
      await nav(page, "내 업무 2");
      await expect(page.locator(".task-card")).toHaveCount(2);
      await page.getByRole("textbox", { name: "업무 검색" }).fill("이지민");
      await expect(page.locator(".task-card")).toHaveCount(0);
    });
    test("board settings edit description and members without exposing IDs", async ({
      page,
    }) => {
      await page.goto("/");
      await nav(page, "팀 설정");
      await page.getByRole("button", { name: "편집 · 참여자" }).first().click();
      const dialog = page.getByRole("dialog", { name: "프로젝트 편집" });
      await dialog.getByLabel("보드 설명").fill("반응형 검수 설명");
      await dialog.getByRole("checkbox", { name: /이지민/ }).uncheck();
      await expect(
        dialog.getByRole("checkbox", { name: /김동겸/ }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "보드 저장" }).click();
      await expect(page.locator(".toast")).toContainText("담당자를 변경");
      await dialog.getByRole("checkbox", { name: /이지민/ }).check();
      await dialog.getByRole("button", { name: "보드 저장" }).click();
      await nav(page, "전체 보드");
      await expect(page.getByText("반응형 검수 설명")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });
}
test("keyboard card access, dirty-close confirmation, Escape and focus restoration", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.getByRole("button", {
    name: "서비스 기획안 검토",
    exact: true,
  });
  await card.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("업무 제목")).toBeFocused();
  await dialog.getByLabel("업무 제목").fill("아직 저장 안 함");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});
test("same-column keyboard drag persists after reload and sorted view cannot reorder", async ({
  page,
}) => {
  await page.goto("/");
  const titles = await page
    .locator('[data-status="todo"] .card-title')
    .allTextContents();
  const grip = page.locator('[data-status="todo"] .drag-grip').first();
  await grip.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      page.locator('[data-status="todo"] .card-title').allTextContents(),
    )
    .not.toEqual(titles);
  const saved = await page
    .locator('[data-status="todo"] .card-title')
    .allTextContents();
  await page.reload();
  await expect
    .poll(() =>
      page.locator('[data-status="todo"] .card-title').allTextContents(),
    )
    .toEqual(saved);
});

for (const width of [390, 768])
  test.describe(`touch ${width}px`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: true,
      isMobile: true,
    });
    test("touch tap opens details and long-press drag reorders cards", async ({
      page,
      context,
    }) => {
      await page.goto("/");
      const first = page.getByRole("button", {
        name: "서비스 기획안 검토",
        exact: true,
      });
      await first.scrollIntoViewIfNeeded();
      const cardBox = await first.boundingBox();
      await page.touchscreen.tap(cardBox!.x + 40, cardBox!.y + 55);
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      const titles = await page
        .locator('[data-status="todo"] .card-title')
        .allTextContents();
      const grip = page.locator('[data-status="todo"] .drag-grip').first();
      await grip.scrollIntoViewIfNeeded();
      const start = await grip.boundingBox();
      const target = await page
        .locator('[data-status="todo"] .task-card')
        .nth(1)
        .boundingBox();
      const x = start!.x + start!.width / 2,
        y = start!.y + start!.height / 2,
        endY = target!.y + target!.height / 2;
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await page.waitForTimeout(250);
      for (let step = 1; step <= 8; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + ((endY - y) * step) / 8 }],
        });
        await page.waitForTimeout(35);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect
        .poll(() =>
          page.locator('[data-status="todo"] .card-title').allTextContents(),
        )
        .not.toEqual(titles);
      await cdp.detach();
      const changed = await page
        .locator('[data-status="todo"] .card-title')
        .allTextContents();
      await page.reload();
      await expect
        .poll(() =>
          page.locator('[data-status="todo"] .card-title').allTextContents(),
        )
        .toEqual(changed);
    });
  });
