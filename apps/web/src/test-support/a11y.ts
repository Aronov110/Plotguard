import axe from "axe-core";
import { expect } from "vitest";

/** What axe reports for a problem, shortened to what a failing test needs to show. */
function summarize(results: axe.AxeResults) {
  return results.violations.map((violation) => ({
    rule: violation.id,
    help: violation.help,
    elements: violation.nodes.map((node) => node.html),
  }));
}

/**
 * Fails the test when axe (the accessibility checker used by Lighthouse and many others) finds a
 * problem in `container`: a missing label, a wrong ARIA attribute, an image without alt text, a
 * skipped heading level, and so on. Use it for one component.
 *
 * Color contrast is not checked, because the test environment applies no CSS. The colors are
 * checked by `tokens.test.ts`, and the end-to-end tests run axe again in a real browser.
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(summarize(results)).toEqual([]);
}

/**
 * Like {@link expectNoA11yViolations}, for a whole rendered page: it also demands that all content
 * sits inside a landmark, that there is exactly one `main` and exactly one level-one heading.
 *
 * The page title and the `lang` attribute are not checked, because they live in `index.html`,
 * which the test environment does not load; the end-to-end tests check them in a real browser.
 */
export async function expectNoPageA11yViolations(): Promise<void> {
  const results = await axe.run(document, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: true },
      "document-title": { enabled: false },
      "html-has-lang": { enabled: false },
    },
  });
  expect(summarize(results)).toEqual([]);
  // Axe's own page-level rules for these two do not run outside a real page, so check them here.
  expect(document.querySelectorAll("main, [role='main']")).toHaveLength(1);
  expect(document.querySelectorAll("h1, [role='heading'][aria-level='1']")).toHaveLength(1);
}
