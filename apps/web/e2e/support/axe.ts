import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import type { AxeResults, RunOptions } from "axe-core";

const AXE_SOURCE = createRequire(import.meta.url).resolve("axe-core");

// Axe's defaults plus two rules that are off by default: landmarks ("region") and the 24 px
// minimum size of buttons and fields ("target-size", WCAG 2.2). Colour contrast is on by default,
// and unlike in the unit tests it works here, because the page has its real CSS.
const OPTIONS: RunOptions = {
  rules: { region: { enabled: true }, "target-size": { enabled: true } },
};

/**
 * Runs axe (the accessibility checker used by Lighthouse and many others) on the page as it is
 * right now, in the colour scheme of the test, and fails with a readable list of problems.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  // Colours are measured at rest: something that is still fading in (an error message, a notice) has
  // a lower contrast for a moment, which is not what a person looks at. Wait for the animations that
  // have an end; the ones that never end (a spinner, a progress bar) are left running.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const iterations = animation.effect?.getComputedTiming().iterations;
      return iterations !== undefined && Number.isFinite(iterations);
    });
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.addScriptTag({ path: AXE_SOURCE });
  const violations = await page.evaluate(async (options) => {
    const { axe } = window as unknown as {
      axe: { run: (context: Document, options: RunOptions) => Promise<AxeResults> };
    };
    const results = await axe.run(document, options);
    return results.violations.map((violation) => ({
      rule: violation.id,
      help: violation.help,
      elements: violation.nodes.map((node) => node.html),
    }));
  }, OPTIONS);
  expect(violations).toEqual([]);
}
