import { test, expect } from "@playwright/test";

test("public order routes load", async ({ page }) => {
  await page.goto("/eggs");
  await expect(page.getByRole("heading", { name: /order form/i })).toBeVisible();

  await page.goto("/livestock");
  await expect(page.getByRole("heading", { name: /order form/i })).toBeVisible();
});
