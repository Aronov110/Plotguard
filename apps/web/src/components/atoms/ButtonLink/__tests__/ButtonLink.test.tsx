import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ButtonLink } from "../ButtonLink.tsx";

function Destination() {
  const location = useLocation();
  return (
    <p data-testid="arrived">
      {location.pathname}:{JSON.stringify(location.state)}
    </p>
  );
}

function renderLink(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/login" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ButtonLink", () => {
  it("is a link, because it goes somewhere", () => {
    renderLink(<ButtonLink to="/login">Log in</ButtonLink>);
    const link = screen.getByRole("link", { name: "Log in" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("looks like a primary button unless it is secondary", () => {
    const { unmount } = renderLink(<ButtonLink to="/login">One</ButtonLink>);
    expect(screen.getByRole("link")).toHaveClass("button", "button--primary");
    unmount();
    renderLink(
      <ButtonLink to="/login" variant="secondary">
        One
      </ButtonLink>,
    );
    expect(screen.getByRole("link")).toHaveClass("button", "button--secondary");
  });

  it("goes to its address without reloading the page", async () => {
    renderLink(<ButtonLink to="/login">Log in</ButtonLink>);
    await userEvent.setup().click(screen.getByRole("link"));
    expect(screen.getByTestId("arrived")).toHaveTextContent("/login");
  });

  it("hands state on to the next screen", async () => {
    renderLink(
      <ButtonLink to="/login" state={{ from: "/app" }}>
        Log in
      </ButtonLink>,
    );
    await userEvent.setup().click(screen.getByRole("link"));
    expect(screen.getByTestId("arrived")).toHaveTextContent('/login:{"from":"/app"}');
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    renderLink(<ButtonLink to="/login">Log in</ButtonLink>);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("arrived")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderLink(
      <div>
        <ButtonLink to="/login">One</ButtonLink>
        <ButtonLink to="/login" variant="secondary">
          Two
        </ButtonLink>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
