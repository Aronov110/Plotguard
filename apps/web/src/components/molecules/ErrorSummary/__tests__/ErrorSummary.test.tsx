import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ErrorSummary } from "../ErrorSummary.tsx";

describe("ErrorSummary", () => {
  it("shows nothing when there is nothing wrong", () => {
    const { container } = render(<ErrorSummary items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has a heading and one list entry per problem, in order", () => {
    render(
      <ErrorSummary
        items={[
          { message: "Enter a valid email address.", fieldId: "email" },
          { message: "Use at least 12 characters.", fieldId: "password" },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "There is a problem" }),
    ).toBeInTheDocument();
    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Enter a valid email address.");
    expect(entries[1]).toHaveTextContent("Use at least 12 characters.");
  });

  it("is announced when it appears, and named by its heading", () => {
    render(<ErrorSummary items={[{ message: "Something is wrong." }]} />);
    expect(screen.getByRole("alert")).toHaveAccessibleName("There is a problem");
  });

  describe("a problem that belongs to a field", () => {
    it("is a link to that field", () => {
      render(
        <ErrorSummary items={[{ message: "Enter a valid email address.", fieldId: "email" }]} />,
      );
      expect(screen.getByRole("link", { name: "Enter a valid email address." })).toHaveAttribute(
        "href",
        "#email",
      );
    });

    it("moves the focus to the field when its link is clicked, without changing the address", async () => {
      render(
        <>
          <ErrorSummary items={[{ message: "Enter a valid email address.", fieldId: "email" }]} />
          <label htmlFor="email">Email</label>
          <input id="email" />
        </>,
      );
      await userEvent.setup().click(screen.getByRole("link"));
      expect(screen.getByLabelText("Email")).toHaveFocus();
      expect(window.location.hash).toBe("");
    });

    it("also works from the keyboard", async () => {
      const user = userEvent.setup();
      render(
        <>
          <ErrorSummary items={[{ message: "Enter a valid email address.", fieldId: "email" }]} />
          <label htmlFor="email">Email</label>
          <input id="email" />
        </>,
      );
      await user.tab();
      expect(screen.getByRole("link")).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(screen.getByLabelText("Email")).toHaveFocus();
    });

    it("does nothing, and does not fail, when the field is not on the page", async () => {
      render(<ErrorSummary items={[{ message: "Lost.", fieldId: "nowhere" }]} />);
      await userEvent.setup().click(screen.getByRole("link"));
      expect(screen.getByRole("link")).toBeInTheDocument();
    });
  });

  it("shows a problem without a field as plain text, not as a link", () => {
    render(<ErrorSummary items={[{ message: "Email or password is incorrect." }]} />);
    expect(screen.getByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("can be focused by code, so a form can move the focus here after a failed attempt", () => {
    const ref = createRef<HTMLDivElement>();
    render(<ErrorSummary items={[{ message: "Wrong." }]} ref={ref} />);
    expect(ref.current).toBe(screen.getByRole("alert"));
    expect(ref.current).toHaveAttribute("tabindex", "-1");
    ref.current?.focus();
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("is not in the tab order by itself", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ErrorSummary items={[{ message: "Wrong." }]} />
        <button type="button">After</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("shows every message as plain text, whatever it contains", () => {
    const { container } = render(
      <ErrorSummary
        items={[
          { message: '<img src=x onerror="alert(1)">', fieldId: "email" },
          { message: "<b>bold</b>" },
        ]}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <ErrorSummary
          items={[
            { message: "Enter a valid email address.", fieldId: "email" },
            { message: "General problem." },
          ]}
        />
        <label htmlFor="email">Email</label>
        <input id="email" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("shows a picture in its heading without changing the heading's name", () => {
    const { container } = render(<ErrorSummary items={[{ message: "Fix this." }]} />);
    expect(container.querySelector(".error-summary__title svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("heading", { name: "There is a problem" })).toBeInTheDocument();
  });
});
