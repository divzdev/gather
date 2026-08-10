# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/03-form-builder.spec.ts >> 25-32. six field types, two of them required
- Location: apps/web/e2e/03-form-builder.spec.ts:59:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/login", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | /** Checklist §"Build the call for papers form" — items 25-42. */
  4   | 
  5   | const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
  6   | 
  7   | test.beforeAll(async ({ request }) => {
  8   |   const health = await request.get(`${API}/v1/health`).catch(() => null);
  9   |   test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
  10  | });
  11  | 
  12  | async function signIn(page: Page) {
> 13  |   await page.goto("/login");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  14  |   await page.getByRole("button", { name: /^Organizer$/i }).click();
  15  |   await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  16  | }
  17  | 
  18  | /** 25. A form built from scratch, so no test leans on the seeded one. */
  19  | async function newForm(page: Page): Promise<void> {
  20  |   await signIn(page);
  21  |   await page.goto("/admin/forms");
  22  |   await page.getByRole("button", { name: /create a form/i }).first().click();
  23  |   await expect(page.getByRole("button", { name: /add a field/i })).toBeVisible({ timeout: 20_000 });
  24  | }
  25  | 
  26  | /** Step 3 of the wizard is where the questions live. */
  27  | async function openQuestions(page: Page) {
  28  |   await page.getByRole("button", { name: /submission questions/i }).click();
  29  |   await expect(page.getByRole("button", { name: /add a field/i })).toBeVisible();
  30  | }
  31  | 
  32  | async function addField(
  33  |   page: Page,
  34  |   options: {
  35  |     label: string;
  36  |     type: string;
  37  |     required?: boolean;
  38  |     choices?: string;
  39  |     limit?: string;
  40  |   },
  41  | ) {
  42  |   await page.getByRole("button", { name: /add a field/i }).click();
  43  |   const dialog = page.getByRole("dialog", { name: /add a field/i });
  44  |   await dialog.getByLabel(/question/i).fill(options.label);
  45  |   await dialog.getByLabel(/^type$/i).selectOption(options.type);
  46  |   if (options.limit !== undefined) {
  47  |     await dialog.getByLabel(/character limit/i).fill(options.limit);
  48  |   }
  49  |   if (options.choices !== undefined) {
  50  |     await dialog.getByLabel(/options/i).fill(options.choices);
  51  |   }
  52  |   if (options.required === true) {
  53  |     await dialog.getByLabel(/^required$/i).check();
  54  |   }
  55  |   await dialog.getByRole("button", { name: /add field/i }).click();
  56  |   await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  57  | }
  58  | 
  59  | test("25-32. six field types, two of them required", async ({ page }) => {
  60  |   await newForm(page);
  61  |   await openQuestions(page);
  62  | 
  63  |   await addField(page, { label: "Talk title", type: "short_text", required: true });
  64  |   await addField(page, { label: "Abstract", type: "long_text", limit: "600", required: true });
  65  |   await addField(page, {
  66  |     label: "Audience level",
  67  |     type: "select",
  68  |     choices: "Beginner\nIntermediate\nAdvanced",
  69  |   });
  70  |   await addField(page, { label: "Attendees expected", type: "number" });
  71  |   await addField(page, { label: "Slides", type: "file" });
  72  |   await addField(page, { label: "First time speaking", type: "checkbox" });
  73  | 
  74  |   for (const label of [
  75  |     "Talk title",
  76  |     "Abstract",
  77  |     "Audience level",
  78  |     "Attendees expected",
  79  |     "Slides",
  80  |     "First time speaking",
  81  |   ]) {
  82  |     await expect(page.getByText(label, { exact: true })).toBeVisible();
  83  |   }
  84  | 
  85  |   // 32. Two of them carry the required flag.
  86  |   await expect(page.getByText("required", { exact: true })).toHaveCount(2);
  87  | });
  88  | 
  89  | test("27-28. a long text keeps its limit and a dropdown keeps its options", async ({ page }) => {
  90  |   await newForm(page);
  91  |   await openQuestions(page);
  92  | 
  93  |   await addField(page, { label: "Abstract", type: "long_text", limit: "600" });
  94  |   await addField(page, {
  95  |     label: "Audience level",
  96  |     type: "select",
  97  |     choices: "Beginner\nIntermediate\nAdvanced",
  98  |   });
  99  | 
  100 |   // The row's own summary line states the type and the option count.
  101 |   await expect(page.getByText(/3 choices/i)).toBeVisible();
  102 | 
  103 |   // Reopen the dropdown and the options are still there.
  104 |   await page.getByText("Audience level", { exact: true }).click();
  105 |   const dialog = page.getByRole("dialog");
  106 |   await expect(dialog.getByLabel(/options/i)).toHaveValue(/Beginner[\s\S]*Advanced/);
  107 |   await dialog.getByRole("button", { name: /cancel/i }).click();
  108 | });
  109 | 
  110 | test("35. fields reorder by dragging, and the order survives a save", async ({ page }) => {
  111 |   await newForm(page);
  112 |   await openQuestions(page);
  113 | 
```