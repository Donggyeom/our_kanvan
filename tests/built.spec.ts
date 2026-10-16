import { test, expect } from "@playwright/test";
for (const width of [390, 768, 1280])
  test(`production bundle initializes and saves a card at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /신규 서비스 개발/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "새 업무", exact: false }).click();
    await page
      .getByRole("dialog")
      .getByLabel("업무 제목")
      .fill("빌드 결과 검증");
    await page.getByRole("button", { name: "업무 등록", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "빌드 결과 검증", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "빌드 결과 검증", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
