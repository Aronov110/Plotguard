import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// The two fonts are served by this app itself (nothing is loaded from another site).
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/newsreader";
import "./components/ions/tokens.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
