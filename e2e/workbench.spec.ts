import { expect, test, type Page } from "@playwright/test";
import { RULES } from "../src/lib/review/rules";

/** Fail the test on any console error, including CSP violations. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(w);
}

test("sends strict security headers", async ({ request }) => {
  const res = await request.get("/workbench/program");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).not.toContain("unsafe-inline");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("full validation run with the bundled Memory test and waveform", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Open the workbench" }).click();
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await expect(page.getByText("Assembles cleanly")).toBeVisible();

  await page.getByRole("link", { name: "Continue to Assemble" }).click();
  await expect(page.getByText("Assembled", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Continue to Simulate" }).click();
  await expect(page.getByText("Reached HLT")).toBeVisible();

  await page.getByRole("link", { name: "Continue to Check" }).click();
  await expect(page.getByText("25 passed")).toBeVisible();

  await page.getByRole("link", { name: "Continue to Compare" }).click();
  await page.getByRole("radio", { name: "Bundled sample" }).check();
  await page.getByRole("button", { name: "Load the waveform for Memory.asm" }).click();
  await expect(page.getByText(/First divergence/)).toBeVisible();
  await expect(page.getByText(/expected 00000019 after “POP R1”/).first()).toBeVisible();

  await page.getByRole("link", { name: "Continue to Report" }).click();
  await expect(page.getByText("First hardware divergence")).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("assembly errors point back to the editor line", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: "Start from a blank template" }).click();
  const editor = page.getByRole("textbox", { name: "Assembly source" });
  await editor.fill(".ORG 0\n10\n.ORG 10\nFOO R1\nHLT");
  await page.getByRole("link", { name: "Assemble", exact: false }).first().click();
  await expect(page.getByText("unknown instruction 'FOO'")).toBeVisible();
  await page.getByRole("button", { name: "Edit line 4" }).click();
  await expect(page).toHaveURL(/line=4/);
});

test("share links round-trip and never auto-overwrite work", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /One-operand ALU/ }).click();
  await page.goto("/workbench/report");
  await page.getByRole("button", { name: "Copy share link" }).click();
  const link = await page.getByLabel("Link").inputValue();
  expect(link).toContain("/workbench/program#s=");

  // Someone with their own program open is asked first.
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Two-operand ALU/ }).click();
  await page.goto(link);
  await expect(page.getByText(/Open the shared program/)).toBeVisible();
  await page.getByRole("button", { name: "Open shared program" }).click();
  await expect(page.getByLabel("Program name")).toHaveValue("One-operand ALU");
});

test("a hostile share link is ignored", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/workbench/program#s=AAAA%3Cscript%3E");
  await page.goto("/workbench/program#s=" + "A".repeat(300_000));
  await expect(page.getByRole("heading", { name: "Write or load a program" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("pages fit narrow screens", async ({ page }) => {
  for (const path of ["/", "/isa", "/guide", "/license", "/review", "/faq", "/privacy", "/terms", "/accessibility", "/docs", "/docs/start", "/docs/review-rules", "/docs/checks", "/docs/troubleshooting", "/docs/glossary", "/waveforms", "/try", "/workbench/program", "/workbench/simulate", "/workbench/compare"]) {
    await page.goto(path);
    await noHorizontalScroll(page);
  }
});

test("the 'Try it' option needs nothing and lands on a ready sample", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("radio", { name: /^Try it with a bundled test/ }).check();
  await expect(page.getByLabel("Program name")).toHaveValue("Memory and stack");
  await page.goto("/workbench/compare");
  await expect(page.getByRole("radio", { name: "Bundled sample" })).toBeChecked();
  await page.getByRole("button", { name: /Load the waveform/ }).click();
  await expect(page.getByText(/First divergence/)).toBeVisible();
});

test("'Check a program' skips the hardware step", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /One-operand ALU/ }).click();
  await page.getByRole("radio", { name: /^Check a program/ }).check();
  await expect(page.getByText("Your program: an .asm source file, or an assembled .mem image").first()).toBeVisible();
  await page.goto("/workbench/check");
  await expect(page.getByRole("link", { name: "Continue to Report" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare with hardware (optional)" })).toBeVisible();
});

test("final register values can be typed and compared", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await page.goto("/workbench/compare");
  await page.getByRole("radio", { name: "Final register values" }).check();
  await page.getByRole("textbox", { name: /^Final values/ }).fill("R1=0 R2=1E\nSP=FFF\nfoo=1");
  await expect(page.getByText("1 of 3 values differ")).toBeVisible();
  await expect(page.getByText(/“foo” is not a register name/)).toBeVisible();
  await page.goto("/workbench/report");
  await expect(page.getByText("2/3 match")).toBeVisible();
});

test("code review of the bundled processor, with depth switching", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Review my code" }).first().click();
  await expect(page).toHaveURL(/\/review/);
  await page.getByRole("button", { name: "Try the reference processor" }).click();
  await expect(page.getByText("Review of Reference processor")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Input rst of pc is never used" })).toBeVisible();

  await page.getByRole("radio", { name: /^5 stages/ }).check();
  await expect(page.getByText("This looks like a 6-stage design")).toBeVisible();
  await page.getByRole("button", { name: "Switch to 6 stages" }).click();
  await expect(page.getByText("This looks like a 6-stage design")).toHaveCount(0);

  await page.getByRole("tab", { name: "Design overview" }).click();
  await page.getByRole("button", { name: "Use this order in the hardware kit" }).click();
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await page.goto("/workbench/compare");
  await expect(page.getByText(/Compile order: 28 files from your code review/)).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("pipeline depth changes the timing estimate", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await page.getByRole("radio", { name: /^6 stages/ }).first().check();
  await page.goto("/workbench/simulate");
  const estimate = page.locator("dt:has-text('Estimated cycles') + dd");
  await expect(page.getByRole("radio", { name: /^6 stages/ })).toBeChecked();
  const six = parseInt(await estimate.innerText());
  await page.getByRole("radio", { name: /^5 stages/ }).check();
  // Wait for the re-render instead of reading the old value.
  await expect.poll(async () => parseInt(await estimate.innerText())).toBeLessThan(six);
  await expect(page.getByText(/5-stage pipeline/).first()).toBeVisible();
});

test("forwarding settings drive timing in every scan", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Two-operand ALU/ }).click();
  await page.getByRole("radio", { name: /^5 stages/ }).check();
  await page.getByRole("radio", { name: "Full forwarding" }).check();
  await page.goto("/workbench/simulate");
  const cycles = () => page.locator("dt:has-text('Estimated cycles') + dd").innerText().then((t) => parseInt(t));
  await expect(page.getByRole("radio", { name: "Full forwarding" })).toBeChecked();
  const full = await cycles();
  await page.getByRole("radio", { name: "No forwarding" }).check();
  await expect.poll(cycles).toBeGreaterThan(full);
  await expect(page.getByText(/Data-hazard stalls/)).toBeVisible();
  // Loading another program keeps the design's forwarding setting.
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory/ }).first().click();
  await expect(page.getByRole("radio", { name: "No forwarding" })).toBeChecked();
  await page.goto("/workbench/simulate");
  await page.getByRole("radio", { name: "Some paths" }).check();
  await expect(page.getByRole("checkbox", { name: /MEM\/WB → EX/ })).toBeChecked();
  await expect(page.getByText(/partial forwarding/).first()).toBeVisible();

  // The same setting reaches Code review.
  await page.goto("/review");
  await expect(page.getByRole("radio", { name: "Some paths" })).toBeChecked();
  await page.getByRole("button", { name: "Try the reference processor" }).click();
  await page.getByRole("radio", { name: /^6 stages/ }).check();
  await page.getByRole("radio", { name: "No forwarding" }).check();
  await expect(page.getByRole("heading", { name: "A forwarding unit exists, but forwarding is set to off" })).toBeVisible();
  await page.getByRole("radio", { name: "Full forwarding" }).check();
  await expect(page.getByRole("heading", { name: "A forwarding unit exists, but forwarding is set to off" })).toHaveCount(0);
});

test("the review explains the .zip structure and checks the upload", async ({ page }) => {
  await page.goto("/review");
  await page.getByText("How to structure your .zip").click();
  await expect(page.getByLabel("Example folder structure")).toContainText("cpu_pkg.vhd");
  await expect(page.getByText(/A \.zip inside the \.zip/)).toBeVisible();
  await page.getByRole("button", { name: "Try the reference processor" }).click();
  await expect(page.getByText("The upload looks complete")).toBeVisible();
  await expect(page.getByText(/28 VHDL files in \d+ folders/)).toBeVisible();
});

test("legal pages, FAQ and the analytics opt-out", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  const box = page.getByRole("checkbox", { name: /Don't measure my visits/ });
  await box.check();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Don't measure my visits/ })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("pipelith:analytics-opt-out"))).toBe("1");
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
  await page.goto("/faq");
  await page.getByText("How should I structure the .zip file?").click();
  await expect(page.getByText(/Put all source files of one design/)).toBeVisible();
  // Structured data is present and passes the CSP (no console errors).
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.some((t) => JSON.parse(t)["@type"] === "FAQPage")).toBe(true);
  expect(errors).toEqual([]);
});

test("SEO endpoints and no analytics requests when not on Vercel", async ({ page, request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  expect(robots).toMatch(/ClaudeBot|GPTBot/);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("/review</loc>");
  const llms = await request.get("/llms.txt");
  expect(llms.headers()["content-type"]).toContain("text/plain");
  expect(await llms.text()).toContain("## FAQ");
  expect((await request.get("/opengraph-image.png")).status()).toBe(200);
  expect((await request.get("/manifest.webmanifest")).status()).toBe(200);
  const vercel: string[] = [];
  page.on("request", (r) => r.url().includes("/_vercel/") && vercel.push(r.url()));
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/?$/);
  expect(vercel).toEqual([]);
});

test("Pipelith branding everywhere, and old saved work carries over", async ({ page, request }) => {
  // A visitor from before the rename: their session and opt-out live under the old keys.
  // Seed from a plain-text URL so no app page saves a session before the "first visit".
  await page.goto("/robots.txt");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "processor-workbench:session:v1",
      JSON.stringify({ v: 1, name: "Legacy program", source: "LDM R1, 5\nHLT\n", stages: 5 }),
    );
    localStorage.setItem("processor-workbench:analytics-opt-out", "1");
  });
  // (The browser's plain-text viewer for robots.txt trips the CSP; watch the app only.)
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/^Pipelith — Pipeline verification for RISC processors$/);
  await expect(page.getByRole("link", { name: "Pipelith" }).first()).toBeVisible();
  await expect(page.getByText("Pipeline verification for RISC processors").first()).toBeVisible();
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Pipelith");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join("\n")).toContain('"name":"Pipelith"');
  expect(await page.content()).not.toMatch(/Processor Workbench/i);

  await page.goto("/workbench/program");
  await expect(page.locator("textarea").first()).toHaveValue(/LDM R1, 5/);
  await expect(page.getByText("Legacy program").first()).toBeVisible();
  await expect(page.getByText(/5-stage pipeline/).first()).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toContain("pipelith:session:v1");
  expect(keys).toContain("pipelith:analytics-opt-out");
  expect(keys.filter((k) => k.startsWith("processor-workbench:"))).toEqual([]);

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.short_name).toBe("Pipelith");
  expect((await request.get("/apple-icon.png")).status()).toBe(200);
  expect(await (await request.get("/icon.svg")).text()).toContain("<title>Pipelith</title>");
  expect(await (await request.get("/llms.txt")).text()).toMatch(/^# Pipelith/);
  expect(errors).toEqual([]);
});

test("one click from the home page to a finished demo comparison", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("link", { name: "Run the demo" }).first().click();
  await expect(page).toHaveURL(/\/workbench\/compare$/);
  await expect(page.getByText(/First divergence/)).toBeVisible();
  await expect(page.getByText(/expected 00000019 after “POP R1”/).first()).toBeVisible();
  await expect(page.getByText(/6-stage pipeline/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the demo asks before replacing the visitor's own program", async ({ page }) => {
  await page.goto("/workbench/program");
  await page.getByLabel("Program name").fill("My CPU test");
  await page.locator("textarea").first().fill("LDM R1, 5\nHLT\n");
  await page.goto("/try");
  await expect(page.getByRole("heading", { name: /Replace “My CPU test” with the demo\?/ })).toBeVisible();
  await page.getByRole("link", { name: "Keep my program" }).click();
  await expect(page.locator("textarea").first()).toHaveValue(/LDM R1, 5/);
});

test("quick start opens each file where it belongs", async ({ page }) => {
  const errors = watchConsole(page);
  // A codebase goes straight into Code review.
  const zip = await (await page.request.get("/samples/reference-rtl.zip")).body();
  await page.goto("/");
  await page.getByLabel("Open files").setInputFiles({ name: "my-cpu.zip", mimeType: "application/zip", buffer: zip });
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("The upload looks complete")).toBeVisible();
  const about = page.getByRole("link", { name: /About this rule/ }).first();
  await expect(about).toHaveAttribute("href", /^\/docs\/review-rules#[a-z-]+$/);

  // A program and its waveform land on the comparison, already compared.
  await page.goto("/try");
  await expect(page.getByText(/First divergence/)).toBeVisible();
  // The session is saved with a short debounce: wait until the demo program is stored.
  const stored = () => page.evaluate(() => (JSON.parse(localStorage.getItem("pipelith:session:v1") ?? "{}").source as string) ?? "");
  await expect.poll(stored).toContain("PUSH R1");
  const source = await stored();
  const wave = await (await page.request.get("/samples/memory.vcd.gz")).body();
  await page.goto("/");
  await page.getByLabel("Open files").setInputFiles([
    { name: "Memory.asm", mimeType: "text/plain", buffer: Buffer.from(source) },
    { name: "wave.vcd.gz", mimeType: "application/gzip", buffer: wave },
  ]);
  await expect(page).toHaveURL(/\/workbench\/compare$/);
  await expect(page.getByText(/First divergence/)).toBeVisible();

  // A single program opens in Assemble.
  await page.goto("/");
  await page.getByLabel("Open files").setInputFiles({ name: "tiny.asm", mimeType: "text/plain", buffer: Buffer.from(".ORG 0\n10\n.ORG 10\nHLT\n") });
  await expect(page).toHaveURL(/\/workbench\/assemble$/);
  await expect(page.getByText("Assembled", { exact: true })).toBeVisible();

  // Anything else gets a clear message instead of a dead end.
  await page.goto("/");
  await page.getByLabel("Open files").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(page.locator(".quick").getByRole("alert")).toContainText(".zip");
  expect(errors).toEqual([]);
});

test("documentation pages, navigation and footer", async ({ page, request }) => {
  const errors = watchConsole(page);
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Documentation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /Find bugs in my VHDL/ }).click();
  await expect(page).toHaveURL(/\/review$/);

  await page.goto("/docs/review-rules#latch");
  await expect(page.locator("#latch")).toContainText("Possible latch");
  await expect(page.locator(".rule")).toHaveCount(RULES.length);
  // The language filter hides rules for other languages without a script.
  await page.getByRole("radio", { name: "Verilog", exact: true }).check();
  await expect(page.locator("#case-others")).toBeHidden();
  await expect(page.locator("#ff-blocking")).toBeVisible();
  await page.getByRole("radio", { name: "All languages" }).check();
  await page.goto("/docs/checks");
  await expect(page.getByRole("table")).toContainText("shouldn't be executed");
  await page.goto("/docs/glossary");
  await expect(page.locator("#forwarding")).toContainText("Forwarding");
  await page.goto("/docs/troubleshooting");
  await page.getByText("Channels show “Not mapped”").click();
  await expect(page.getByText(/Open Signal mapping/)).toBeVisible();
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
  for (const t of ["BreadcrumbList", "TechArticle", "FAQPage"]) expect(ld).toContain(t);

  // The guide counts as docs in the main nav.
  await page.goto("/guide");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");

  // Footer: three groups and the fine print, on every page.
  const footer = page.getByRole("contentinfo");
  for (const name of ["Product", "Docs", "Legal"]) await expect(footer.getByRole("heading", { name })).toBeVisible();
  for (const name of ["Run the demo", "Waveforms", "Getting started", "Review rules", "Privacy", "Terms", "Accessibility", "MIT License"]) {
    await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(footer).toContainText(`© ${new Date().getFullYear()}`);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/docs</loc>", "/docs/start</loc>", "/docs/review-rules</loc>", "/docs/glossary</loc>", "/docs/troubleshooting</loc>", "/docs/checks</loc>", "/waveforms</loc>", "/accessibility</loc>"]) {
    expect(sitemap).toContain(p);
  }
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toContain("## Code review rules");
  expect(llms).toContain("## Glossary");
  expect(errors).toEqual([]);
});

test("the design language is on every page and drives the review sample, kit and docs", async ({ page }) => {
  const errors = watchConsole(page);
  for (const path of ["/", "/docs/start", "/privacy"]) {
    await page.goto(path);
    await expect(page.getByLabel("HDL (design language)")).toHaveValue("vhdl");
  }
  await page.goto("/review");
  await page.getByLabel("HDL (design language)").selectOption("verilog");
  await expect(page.locator(".toast")).toContainText("Design language: Verilog");
  await page.getByRole("button", { name: "Try the reference processor" }).click();
  await expect(page.getByText("Review of Reference processor (5-stage Verilog)")).toBeVisible();
  await expect(page.getByText("The upload looks complete")).toBeVisible();
  await expect(page.getByText(/17 Verilog files in \d+ folders/)).toBeVisible();
  await expect(page.getByText("This looks like a 5-stage design")).toBeVisible();
  await page.getByRole("button", { name: "Switch to 5 stages" }).click();
  await expect(page.locator(".review-summary")).toContainText(/^0\s*errors\s*0\s*warnings/);

  // Tabs follow the keyboard pattern.
  await page.getByRole("tab", { name: /Findings/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Design overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Compile order");

  // The kit is written in Verilog.
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await page.goto("/workbench/compare");
  await expect(page.getByText(/Kit language:/)).toContainText("Verilog");
  const [kit] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download hardware kit (.zip)" }).click()]);
  expect(kit.suggestedFilename()).toBe("memory-and-stack-hardware-run.zip");

  // The guide's language tabs show the same language.
  await page.goto("/guide#hardware");
  await expect(page.getByRole("tab", { name: "Verilog" }).first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("./run_icarus.sh path/to/your/rtl").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a badly structured upload gets an AI prompt with file names and no code", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/review");
  const files = [
    { name: "top.v", mimeType: "text/plain", buffer: Buffer.from('`include "defs.vh"\nmodule top(input clk, output y); alu u (.a(clk), .y(y)); endmodule') },
  ];
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(files);
  await expect(page.getByText("Check the upload's structure")).toBeVisible();
  await expect(page.locator(".notice").getByText(/1 include file is missing \(defs\.vh\)/)).toBeVisible();
  // The prompt follows the files' language, not the (default) setting.
  await expect(page.getByText("These files are Verilog, but VHDL is selected")).toBeVisible();
  await page.getByText("Ask an AI assistant to fix the structure").click();
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.locator(".toast")).toContainText("Prompt copied");
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("top.v");
  expect(prompt).toContain("written in Verilog");
  expect(prompt).toContain("zip -r my-cpu.zip my-cpu");
  expect(prompt).toMatch(/include file is missing \(defs\.vh\)/);
  expect(prompt).not.toContain("module top");

  // An upload with no source files at all offers the prompt straight away.
  await page.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles({ name: "notes.md", mimeType: "text/plain", buffer: Buffer.from("# notes") });
  await expect(page.getByText("Nothing to review")).toBeVisible();
});

test("expected and simulated waveforms for the standard tests", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/waveforms");
  const [expected] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /6 stages \(\.vcd\) — expected waveform of Memory\.asm/ }).click()]);
  expect(expected.suggestedFilename()).toBe("memory-expected-6stage.vcd");
  expect((await page.request.get("/samples/verilog/memory.vcd.gz")).status()).toBe(200);

  // The 5-stage bundled sample is the Verilog design, and it matches the model.
  await page.goto("/workbench/program");
  await page.getByRole("button", { name: /Memory and stack/ }).click();
  await page.getByRole("radio", { name: /^5 stages/ }).first().check();
  await page.goto("/workbench/simulate");
  await expect(page.getByRole("button", { name: /Download expected waveform/ })).toBeVisible();
  await page.goto("/workbench/compare");
  await page.getByRole("radio", { name: "Bundled sample" }).check();
  await page.getByRole("button", { name: "Load the waveform for Memory.asm" }).click();
  await expect(page.getByText("The hardware matches the reference model")).toBeVisible();
  expect(errors).toEqual([]);
});

test("display settings apply before the first paint and persist", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.locator(".display-menu > summary").click();
  await page.getByRole("radio", { name: "Dark" }).check();
  await page.getByRole("radio", { name: "Larger" }).check();
  await page.getByRole("radio", { name: /Atkinson Hyperlegible/ }).check();
  await page.getByRole("radio", { name: "Reduce" }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".display-menu")).not.toHaveAttribute("open", "");
  await page.reload();
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-text", "larger");
  await expect(html).toHaveAttribute("data-font", "readable");
  await expect(html).toHaveAttribute("data-motion", "reduce");
  await noHorizontalScroll(page);
  await page.evaluate(() => localStorage.removeItem("pipelith:display"));
  expect(errors).toEqual([]);
});

test("skip link, focus and the smallest screens", async ({ page }) => {
  await page.goto("/review");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", "/review", "/guide", "/waveforms", "/workbench/compare"]) {
    await page.goto(path);
    await noHorizontalScroll(page);
  }
});
