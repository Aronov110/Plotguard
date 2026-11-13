// Runs before the page is painted: puts the chosen colour theme on the page, so that it never flashes
// the wrong colours. It must stay in step with src/lib/theme/theme.ts (same key, same three words);
// theme-init.test.ts checks that it does. It reads one word and writes one attribute, nothing else.
(() => {
  let preference = null;
  try {
    preference = window.localStorage.getItem("plotpal-theme");
  } catch {
    // Blocked storage: the system's setting decides.
  }
  if (preference === "light" || preference === "dark") {
    document.documentElement.setAttribute("data-theme", preference);
  }
})();
