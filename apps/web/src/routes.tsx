import type { ReactElement } from "react";
import { Route, Routes } from "react-router";
import { AppHomePage } from "./components/pages/AppHomePage/AppHomePage.tsx";
import { HomePage } from "./components/pages/HomePage/HomePage.tsx";
import { LoginPage } from "./components/pages/LoginPage/LoginPage.tsx";
import { NotFoundPage } from "./components/pages/NotFoundPage/NotFoundPage.tsx";
import { RegisterPage } from "./components/pages/RegisterPage/RegisterPage.tsx";
import { RedirectIfSignedIn } from "./components/templates/RedirectIfSignedIn/RedirectIfSignedIn.tsx";
import { RequireAuth } from "./components/templates/RequireAuth/RequireAuth.tsx";

/**
 * The screens of the app and the addresses they live at. `/auth` and everything below it belong to
 * the API (the dev server and the production proxy send them there), so no screen may use that
 * address.
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<RedirectIfSignedIn />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppHomePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
