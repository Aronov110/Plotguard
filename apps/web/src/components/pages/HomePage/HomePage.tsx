import type { ReactElement } from "react";
import "./HomePage.css";

/** Placeholder landing page. Replaced by the real landing and auth flow in later steps. */
export function HomePage(): ReactElement {
  return (
    <main className="home-page">
      <h1 className="home-page__title">Plotguard</h1>
      <p className="home-page__tagline">Write your story. Let AI catch what you missed.</p>
    </main>
  );
}
