import { expect, test, type Page } from "@playwright/test";

const widths = [1440, 1024, 768, 390] as const;

async function quiet(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  return errors;
}

async function noOverflow(page: Page) {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra).toBeLessThanOrEqual(1);
}

function placed(box: { x: number; y: number; width: number; height: number } | null) {
  if (!box) throw new Error("missing layout box");
  return box;
}

async function dashboardFrame(page: Page, width: number) {
  const header = page.locator("header.dash-top");
  await expect(header).toBeVisible();
  const headerBox = placed(await header.boundingBox());
  expect(headerBox.y).toBeLessThanOrEqual(1);
  expect(headerBox.height).toBeGreaterThanOrEqual(40);
  expect(headerBox.height).toBeLessThanOrEqual(120);

  const body = page.locator(".dash-body");
  const bodyBox = placed(await body.boundingBox());
  expect(bodyBox.y).toBeLessThanOrEqual(140);
  expect(bodyBox.y).toBeGreaterThanOrEqual(headerBox.height - 1);

  if (width > 800) {
    const side = page.locator("aside.sidebar");
    const sideBox = placed(await side.boundingBox());
    expect(sideBox.x).toBeLessThanOrEqual(1);
    expect(sideBox.y).toBeLessThanOrEqual(1);
    expect(headerBox.x).toBeGreaterThanOrEqual(sideBox.x + sideBox.width - 2);
    expect(bodyBox.x).toBeGreaterThanOrEqual(sideBox.x + sideBox.width - 2);
    const card = page.locator(".stat-card").first();
    if ((await card.count()) > 0) {
      const cardBox = placed(await card.boundingBox());
      expect(cardBox.y).toBeLessThan(400);
      expect(cardBox.x).toBeGreaterThanOrEqual(sideBox.width - 2);
    }
  }
}

test.describe("visual and glitch checks", () => {
  for (const width of widths) {
    test(`landing ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await quiet(page);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: /Your folders/ })).toBeVisible();
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`landing-${width}.png`, { fullPage: true });
    });

    test(`pair ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors = await quiet(page);
      await page.goto("/pair?fixture=1");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: "Connect a device" })).toBeVisible();
      await expect(page.getByText("Muiz’s ThinkPad")).toBeVisible();
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`pair-${width}.png`, { fullPage: true });
    });

    test(`dashboard ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      const errors = await quiet(page);
      await page.goto("/dashboard?fixture=1");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: "Folders" })).toBeVisible();
      await expect(page.getByText("raffle/.env")).toBeVisible();
      await dashboardFrame(page, width);
      if (width > 800) {
        await page.evaluate(() => window.scrollTo(0, 480));
        const stuck = placed(await page.locator("aside.sidebar").boundingBox());
        expect(stuck.y).toBeLessThanOrEqual(1);
        expect(stuck.x).toBeLessThanOrEqual(1);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`dashboard-${width}.png`, { fullPage: true });
    });
  }

  test("empty, error, offline, and long paths", async ({ page }) => {
    const errors = await quiet(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/dashboard?fixture=empty");
    await expect(page.getByText("No device yet")).toBeVisible();
    await expect(page.getByText("No folders")).toBeVisible();
    await expect(page.getByText("No connected apps")).toBeVisible();
    await expect(page.getByText("No activity yet")).toBeVisible();
    await dashboardFrame(page, 1440);
    await noOverflow(page);

    await page.goto("/dashboard?fixture=error");
    await expect(page.getByRole("alert")).toContainText("not reachable");
    await dashboardFrame(page, 1440);

    await page.goto("/dashboard?fixture=offline");
    await expect(page.getByText("offline")).toBeVisible();
    await dashboardFrame(page, 1440);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/dashboard?fixture=long");
    await page.evaluate(() => document.fonts.ready);
    await dashboardFrame(page, 390);
    await noOverflow(page);
    const clipped = await page
      .locator(".path")
      .evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            node.scrollWidth <= node.clientWidth + 1 ||
            getComputedStyle(node).textOverflow === "ellipsis",
        ),
      );
    expect(clipped).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const width of [1440, 390] as const) {
    test(`privacy ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await quiet(page);
      await page.goto("/privacy");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Google sign-in" })).toBeVisible();
      await expect(page.getByText("security@muiz.pk")).toBeVisible();
      await expect(page.getByText(/does not write them into the database/)).toBeVisible();
      await expect(
        page.getByRole("contentinfo").getByRole("link", { name: "GitHub" }),
      ).toBeVisible();
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`privacy-${width}.png`, { fullPage: true });
    });

    test(`terms ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await quiet(page);
      await page.goto("/terms");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
      await expect(page.getByText(/no warranty/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveCount(2);
      await expect(
        page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`terms-${width}.png`, { fullPage: true });
    });
  }

  test("footer links are on the main screens", async ({ page }) => {
    const errors = await quiet(page);
    for (const path of ["/", "/pair?fixture=1", "/dashboard?fixture=1"]) {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Terms" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/mmuizahmed/mcp-bridge",
      );
    }
    expect(errors).toEqual([]);
  });

  test("keyboard reaches the primary actions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "FolderLink home" })).toBeFocused();
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(page.getByRole("link", { name: "Sign in" })).toBeFocused();
    await page.goto("/pair?fixture=1");
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Approve" }).focus();
    await expect(page.getByRole("button", { name: /Approve/ })).toBeFocused();
  });
});
