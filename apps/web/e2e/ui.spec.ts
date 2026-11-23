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

test.describe("visual and glitch checks", () => {
  for (const width of widths) {
    test(`landing ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = await quiet(page);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: /Your AI, your folders/ })).toBeVisible();
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
      await noOverflow(page);
      expect(errors).toEqual([]);
      await expect(page).toHaveScreenshot(`dashboard-${width}.png`, { fullPage: true });
    });
  }

  test("empty, error, offline, and long paths", async ({ page }) => {
    const errors = await quiet(page);
    await page.goto("/dashboard?fixture=empty");
    await expect(page.getByText("No device yet")).toBeVisible();
    await expect(page.getByText("No folders")).toBeVisible();
    await expect(page.getByText("No connected apps")).toBeVisible();
    await expect(page.getByText("No activity yet")).toBeVisible();
    await noOverflow(page);

    await page.goto("/dashboard?fixture=error");
    await expect(page.getByRole("alert")).toContainText("not reachable");

    await page.goto("/dashboard?fixture=offline");
    await expect(page.getByText("offline")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/dashboard?fixture=long");
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page);
    const clipped = await page.locator(".path").evaluateAll((nodes) =>
      nodes.every((node) => node.scrollWidth <= node.clientWidth + 1 || getComputedStyle(node).textOverflow === "ellipsis"),
    );
    expect(clipped).toBe(true);
    expect(errors).toEqual([]);
  });

  test("keyboard reaches the primary actions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "bridge home" })).toBeFocused();
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
