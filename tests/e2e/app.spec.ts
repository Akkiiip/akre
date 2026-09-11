import { test, expect } from "@playwright/test";
test("all eight routes, browser history, filtering, detail tabs and responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/radar");
  await expect(
    page.getByRole("heading", { name: "Ranked opportunities" }),
  ).toBeVisible();
  await page.getByLabel("Search products").fill("bottle");
  await expect(
    page.getByRole("button", { name: /Portable Pet Water Bottle/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Heatless Curling/ }),
  ).toHaveCount(0);
  await page.getByLabel("Search products").fill("");
  for (const tab of [
    "Evidence",
    "Suppliers",
    "Economics",
    "Variants",
    "Experiments",
    "Store",
    "Creative",
    "Decisions",
    "Overview",
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
  }
  const pages = [
    ["Products", "Operating catalogue"],
    ["Suppliers", "Supplier offers"],
    ["Store", "Prepare a Shopify listing"],
    ["Content", "Creative workspace"],
    ["Experiments", "Create a product experiment"],
    ["Analytics", "Revenue, advertising and contribution"],
    ["Settings", "Integrations"],
  ];
  for (const [name, heading] of pages) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name] of pages) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("operator workflow persists approval, economics, creative, experiment, metrics and audit", async ({
  page,
}) => {
  await page.goto("/radar");
  await page.getByRole("button", { name: "Shortlist", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve product", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "TESTING", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Economics", exact: true }).click();
  await page.getByLabel("Advertising / order", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save assumptions" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Economic assumptions saved",
  );
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Product", exact: true })
    .selectOption("product-1");
  await page.getByLabel("Title", { exact: true }).fill("Bottle test hook");
  await page
    .getByLabel("Creative copy / concept")
    .fill("Show the one-hand water dispenser during a walk.");
  await page.getByRole("button", { name: "Save creative draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Bottle test hook" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Experiments", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Product", exact: true })
    .selectOption("product-1");
  await page
    .getByRole("combobox", { name: "Creative", exact: true })
    .selectOption({ label: "Bottle test hook" });
  await page.getByLabel("Channel", { exact: true }).fill("Manual test");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: /Portable Pet Water Bottle · Manual test/,
    }),
  ).toBeVisible();
  await page.getByText("Record daily metrics", { exact: true }).click();
  for (const [label, value] of [
    ["Spend", "100"],
    ["Impressions", "1000"],
    ["Clicks", "100"],
    ["Add To Cart", "30"],
    ["Checkout", "20"],
    ["Purchases", "10"],
    ["Revenue", "6990"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel("Evidence reference / source")
    .fill("DEMO browser test fixture");
  await page
    .getByRole("button", { name: "Save daily totals and evaluate" })
    .click();
  await expect(page.getByRole("status")).toContainText("Daily metrics saved");
  await page.reload();
  await expect(page.getByText("SCALE", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(2);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByText(/EXPERIMENT_EVALUATED/)).toBeVisible();
  await page
    .getByRole("button", { name: "Recalculate economics", exact: true })
    .click();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible({
    timeout: 10000,
  });
});
