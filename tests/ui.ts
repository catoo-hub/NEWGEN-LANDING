import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { rateLimit } from "../src/server/db/schema";
const fixture = JSON.parse(
  await readFile("/tmp/restatic-test-fixtures.json", "utf8"),
);
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  for (const role of ["client", "performer", "mod", "owner"]) {
    await db.delete(rateLimit);
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const mode =
      role === "owner" ? "admin" : role === "mod" ? "moderation" : "account";
    await page.goto(`${fixture.base}/ru/${mode}/`);
    await page.locator("#auth").waitFor({ state: "visible" });
    await page.getByLabel("Email", { exact: true }).fill(fixture.emails[role]);
    await page
      .getByLabel("Пароль (от 12 символов)", { exact: true })
      .fill(fixture.password);
    await page
      .locator('#auth button[type="submit"], #auth form > button')
      .click();
    await expect(page.locator("#workspace")).toBeVisible();
    if (role === "client") {
      await page.locator('[data-nav="prices"]').click();
      await expect(page.locator(".big-price").first()).toContainText(
        "По согласованию",
      );
      await page.locator('[data-nav="works"]').click();
      await expect(page.locator("#content restatic-player")).toHaveCount(12);
      const player = page.locator("#content restatic-player").first();
      await expect(player).toHaveAttribute("data-enhanced", "");
      await expect(player.locator(".controls")).toBeHidden();
      await player.click({ position: { x: 120, y: 100 } });
      await expect(player).toHaveAttribute("data-activated", "");
      await expect(player.locator(".controls")).toBeVisible();
      await expect
        .poll(() =>
          player
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await page.locator('[data-nav="team"]').click();
      await expect(page.locator(".roster-card")).toHaveCount(29);
      await page.locator('[data-nav="orders"]').click();
      await page.locator(`[data-order="${fixture.orderId}"]`).click();
      await expect(page.locator("#chat-messages")).toBeVisible();
      await page.screenshot({
        path: "/tmp/restatic-ui-order-ru.png",
        fullPage: true,
      });
      await page
        .locator('[data-action="new"]')
        .count()
        .then(async (n) => {
          if (n) await page.locator('[data-action="new"]').first().click();
          else await page.locator('[data-nav="new"]').click();
        });
      await expect(page.locator('form[data-form="new"]')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "/tmp/restatic-ui-mobile-new.png",
        fullPage: true,
      });
      await page
        .getByLabel("Страна проживания или регистрации", { exact: true })
        .fill("Россия");
      await page
        .getByLabel("Название заказа", { exact: true })
        .fill("Browser application");
      await page
        .getByLabel("Техническое задание", { exact: true })
        .fill("Cinematic test edit through the actual UI");
      await page
        .getByLabel("Музыка: ссылка, название или помощь с выбором", {
          exact: true,
        })
        .fill("Original music");
      await page.locator('form[data-form="new"] button').click();
      await expect(page.locator("#content h1")).toContainText(
        "Browser application",
      );
      await expect(page.locator("#chat-messages")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    }
    if (role === "performer") {
      await page.locator('[data-nav="assigned"]').click();
      await expect(page.locator("#availability")).toBeVisible();
      await page.locator('[data-nav="finance"]').click();
      await expect(page.locator('form[data-form="withdrawal"]')).toBeVisible();
      await page.screenshot({
        path: "/tmp/restatic-ui-performer-ru.png",
        fullPage: true,
      });
    }
    if (role === "mod") {
      await expect(page.locator("#content h1")).toContainText("Очередь");
      await expect(page.locator('[data-nav="users"]')).toHaveCount(0);
      await page.screenshot({
        path: "/tmp/restatic-ui-moderation-ru.png",
        fullPage: true,
      });
    }
    if (role === "owner") {
      await expect(page.locator('form[data-form="member"]')).toHaveCount(30);
      await page.locator('[data-nav="payouts"]').click();
      await expect(page.locator("#content h1")).toContainText("Финансы");
      await page.screenshot({
        path: "/tmp/restatic-ui-admin-ru.png",
        fullPage: true,
      });
    }
    await page.goto(`${fixture.base}/en/${mode}/`);
    await expect(page.locator("#workspace")).toBeVisible();
    await expect(page.locator('[data-nav="orders"]')).toHaveText("My orders");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `/tmp/restatic-ui-${role}-en-mobile.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await context.close();
  }
  const publicPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  for (const language of ["ru", "en", "ko", "ja"]) {
    const response = await publicPage.goto(
      `${fixture.base}/${language}/works/`,
    );
    expect(response!.status()).toBe(200);
    await expect(publicPage.locator("main restatic-player")).toHaveCount(12);
    expect(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
  }
  await publicPage.close();
  expect(errors).toEqual([]);
  console.log(
    "PASS: browser sign-in, four role views, RU/EN, mobile widths and video mounts",
  );
} finally {
  await browser.close();
}
