import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ProjectFields, projectFieldIds } from "../ProjectFields.tsx";

const noErrors = () => undefined;

function renderFields(props: Partial<Parameters<typeof ProjectFields>[0]> = {}) {
  return render(
    <form>
      <ProjectFields id="p" fieldError={noErrors} {...props} />
    </form>,
  );
}

describe("ProjectFields", () => {
  it("has a title, a format and an optional logline, each with its label", () => {
    renderFields();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Format" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toBeInTheDocument();
  });

  it("is empty with Screenplay chosen when it has no defaults", () => {
    renderFields();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toHaveValue("");
  });

  it("starts with the values it is given", () => {
    renderFields({
      defaults: { title: "The Lighthouse", format: "prose", logline: "A keeper finds a message." },
    });
    expect(screen.getByLabelText("Title")).toHaveValue("The Lighthouse");
    expect(screen.getByRole("radio", { name: "Prose" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toHaveValue(
      "A keeper finds a message.",
    );
  });

  it("goes back to those values when the form is reset", () => {
    renderFields({ defaults: { title: "Kept", format: "other", logline: "Kept too." } });
    const title = screen.getByLabelText("Title");
    (title as HTMLInputElement).value = "Changed";
    (screen.getByRole("radio", { name: "Prose" }) as HTMLInputElement).click();
    (document.querySelector("form") as HTMLFormElement).reset();
    expect(title).toHaveValue("Kept");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
  });

  it("sends the three fields under the names title, format and logline", () => {
    renderFields({ defaults: { title: "T", format: "prose", logline: "L" } });
    const data = new FormData(document.querySelector("form") as HTMLFormElement);
    expect(Object.fromEntries(data.entries())).toEqual({
      title: "T",
      format: "prose",
      logline: "L",
    });
  });

  it("tells how long the title and the logline may be", () => {
    renderFields();
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription("Up to 200 characters.");
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toHaveAccessibleDescription(
      "One or two sentences about the story. Up to 1,000 characters.",
    );
  });

  it("does not stop typing at a number of characters: the API owns that rule", () => {
    renderFields();
    expect(screen.getByLabelText("Title")).not.toHaveAttribute("maxlength");
  });

  it("builds every id from the id it is given", () => {
    renderFields({ id: "edit-42" });
    expect(screen.getByLabelText("Title")).toHaveAttribute("id", "edit-42-title");
    expect(screen.getByRole("radio", { name: "Prose" })).toHaveAttribute(
      "id",
      "edit-42-format-prose",
    );
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toHaveAttribute(
      "id",
      "edit-42-logline",
    );
  });

  it("lets two forms on the page have fields that do not clash", () => {
    render(
      <>
        <form aria-label="one">
          <ProjectFields id="one" fieldError={noErrors} />
        </form>
        <form aria-label="two">
          <ProjectFields id="two" fieldError={noErrors} />
        </form>
      </>,
    );
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows each field's message under that field", () => {
    renderFields({
      fieldError: (field) =>
        ({ title: "Title problem.", format: "Format problem.", logline: "Logline problem." })[
          field
        ],
    });
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription(/Title problem\./);
    expect(screen.getByLabelText("Title")).toBeInvalid();
    expect(screen.getByRole("group", { name: "Format" })).toHaveAccessibleDescription(
      /Format problem\./,
    );
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toHaveAccessibleDescription(
      /Logline problem\./,
    );
  });

  it("shows no error when there is none", () => {
    renderFields();
    expect(screen.getByLabelText("Title")).not.toBeInvalid();
  });

  it("passes a ref to the title field", () => {
    const titleRef = createRef<HTMLInputElement>();
    renderFields({ titleRef });
    expect(titleRef.current).toBe(screen.getByLabelText("Title"));
  });

  it("has no accessibility violations, plain and with problems", async () => {
    const { container } = render(
      <>
        <form aria-label="plain">
          <ProjectFields id="a" fieldError={noErrors} />
        </form>
        <form aria-label="with problems">
          <ProjectFields id="b" fieldError={() => "A problem."} />
        </form>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});

describe("projectFieldIds", () => {
  it("names the three fields; a format problem links to the first option", () => {
    expect(projectFieldIds("x")).toEqual({
      title: "x-title",
      format: "x-format-screenplay",
      logline: "x-logline",
    });
  });
});
