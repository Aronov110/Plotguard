import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { AuthStateProbe } from "../../../../test-support/auth-state-probe.tsx";
import { server } from "../../../../test-support/msw-server.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { RegisterForm } from "../RegisterForm.tsx";

const SESSION = {
  user: { id: "user-1", email: "ada@example.com", displayName: "Ada" },
  accessToken: "access-1",
  expiresIn: 900,
};
const PASSWORD = "correct horse battery";

function problem(type: string, status: number, extra: Record<string, unknown> = {}, headers = {}) {
  return HttpResponse.json(
    { type: `urn:plotpal:problem:${type}`, status, ...extra },
    { status, headers: { "content-type": "application/problem+json", ...headers } },
  );
}

function registerRoute(
  reply: () => Response | Promise<Response> = () => HttpResponse.json(SESSION, { status: 201 }),
) {
  const calls: unknown[] = [];
  server.use(
    http.post("/auth/register", async ({ request }) => {
      calls.push(await request.json());
      return reply();
    }),
  );
  return calls;
}

function renderForm() {
  const view = render(
    <MemoryRouter>
      <AuthProvider>
        <RegisterForm />
        <AuthStateProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...view, user: userEvent.setup() };
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { email?: string; password?: string; displayName?: string } = {},
) {
  const { email = "ada@example.com", password = PASSWORD, displayName } = values;
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  if (password !== "") {
    await user.click(screen.getByLabelText("Password"));
    await user.paste(password);
  }
  if (displayName !== undefined) {
    await user.type(screen.getByLabelText(/Display name/), displayName);
  }
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Create account" }));

describe("RegisterForm", () => {
  it("has a mail, a lock and a user icon in its fields, which only decorate", () => {
    const { container } = renderForm();
    const icons = [...container.querySelectorAll(".form-field__icon svg")];
    expect(icons.map((icon) => icon.getAttribute("data-icon"))).toEqual(["mail", "lock", "user"]);
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  describe("what it shows", () => {
    it("has email, password and an optional display name, and a submit button", () => {
      renderForm();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Display name (optional)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create account" })).toHaveAttribute(
        "type",
        "submit",
      );
    });

    it("tells browsers and password managers what the fields are", () => {
      renderForm();
      const email = screen.getByLabelText("Email");
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("autocomplete", "email");
      expect(email).toHaveAttribute("autocapitalize", "none");
      expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
      expect(screen.getByLabelText(/Display name/)).toHaveAttribute("autocomplete", "nickname");
    });

    it("tells people what a password may be, before they type", () => {
      renderForm();
      expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
        "12 to 128 characters. Spaces and any language are allowed.",
      );
    });

    it("leaves checking to the server: the browser's own validation is off", () => {
      const { container } = renderForm();
      expect(container.querySelector("form")).toHaveAttribute("novalidate");
    });
  });

  describe("checking that the fields are filled in", () => {
    it("asks for an email and a password, sends nothing and moves the focus to the problems", async () => {
      const calls = registerRoute();
      const { user } = renderForm();
      await submit(user);

      const summary = screen.getByRole("alert");
      expect(
        within(summary).getByRole("link", { name: "Enter your email address." }),
      ).toBeInTheDocument();
      expect(within(summary).getByRole("link", { name: "Enter a password." })).toBeInTheDocument();
      expect(summary).toHaveFocus();
      expect(calls).toHaveLength(0);
    });

    it("does not ask for a display name", async () => {
      registerRoute();
      const { user } = renderForm();
      await submit(user);
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByRole("textbox", { name: /Display name/ })).not.toBeInvalid();
    });
  });

  describe("signing up", () => {
    it("sends the email and password and signs in", async () => {
      const calls = registerRoute();
      const { user } = renderForm();
      await fill(user);
      await submit(user);
      expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
    });

    it("sends the display name when there is one, without spaces around it", async () => {
      const calls = registerRoute();
      const { user } = renderForm();
      await fill(user, { displayName: "  Ada Lovelace  " });
      await submit(user);
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([
        { email: "ada@example.com", password: PASSWORD, displayName: "Ada Lovelace" },
      ]);
    });

    it("leaves the display name out when it is empty or only spaces", async () => {
      const calls = registerRoute();
      const { user } = renderForm();
      await fill(user, { displayName: "   " });
      await submit(user);
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
    });

    it("removes spaces around the email", async () => {
      const calls = registerRoute();
      const { user } = renderForm();
      await fill(user, { email: "  ada@example.com " });
      await submit(user);
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
    });

    it.each([
      ["spaces at both ends", "  twelve or more chars  "],
      ["emoji and accents", "pä🔑ss wörd 🔑 123"],
      ["128 characters", "y".repeat(128)],
      ["a mix of scripts", "пароль 密碼 كلمة السر 🔐 ok ok"],
    ])("sends a password with %s exactly as it was typed", async (_name, password) => {
      const calls = registerRoute();
      const { user } = renderForm();
      await fill(user, { password });
      await submit(user);
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([{ email: "ada@example.com", password }]);
    });
  });

  describe("when something goes wrong", () => {
    it("says the email is taken, under the email field, and links to it", async () => {
      registerRoute(() => problem("conflict", 409));
      const { user } = renderForm();
      await fill(user);
      await submit(user);

      const summary = await screen.findByRole("alert");
      await user.click(
        within(summary).getByRole("link", { name: "That email is already registered." }),
      );
      expect(screen.getByLabelText("Email")).toHaveFocus();
      expect(screen.getByLabelText("Email")).toBeInvalid();
      expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out");
    });

    it("shows what the server says is wrong with each field", async () => {
      registerRoute(() =>
        problem("validation-error", 400, {
          errors: [
            { source: "body", pointer: "/password", message: "Use at least 12 characters." },
            { source: "body", pointer: "/displayName", message: "Use at most 80 characters." },
          ],
        }),
      );
      const { user } = renderForm();
      await fill(user, { password: "short", displayName: "Ada" });
      await submit(user);

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
        "12 to 128 characters. Spaces and any language are allowed. Error: Use at least 12 characters.",
      );
      expect(screen.getByLabelText(/Display name/)).toBeInvalid();
    });

    it("keeps what was typed", async () => {
      registerRoute(() => problem("conflict", 409));
      const { user } = renderForm();
      await fill(user, { displayName: "Ada" });
      await submit(user);
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
      expect(screen.getByLabelText("Password")).toHaveValue(PASSWORD);
      expect(screen.getByLabelText(/Display name/)).toHaveValue("Ada");
    });

    it.each([
      [
        "too many attempts",
        () => problem("rate-limited", 429, {}, { "retry-after": "5" }),
        "Too many attempts. Try again in 5 seconds.",
      ],
      [
        "a busy service",
        () => problem("service-busy", 503),
        "The service is busy. Try again in a moment.",
      ],
      [
        "no answer",
        () => HttpResponse.error(),
        "Can't reach the server. Check your connection and try again.",
      ],
      [
        "an unknown problem",
        () => problem("internal", 500, { detail: "secret internal detail" }),
        "Something went wrong. Please try again.",
      ],
    ])("says the right thing for %s", async (_name, reply, expected) => {
      registerRoute(reply);
      const { user } = renderForm();
      await fill(user);
      await submit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(document.body).not.toHaveTextContent("secret internal detail");
    });
  });

  describe("while the request runs", () => {
    it("sends only one request, however often it is pressed, and says it is working", async () => {
      // The fake server holds its answer until the test opens the gate (see LoginForm.test.tsx).
      const gate = deferred<undefined>();
      const calls = registerRoute(async () => {
        await gate.promise;
        return problem("conflict", 409);
      });
      const { user } = renderForm();
      await fill(user);

      const button = screen.getByRole("button", { name: "Create account" });
      await user.click(button);
      await user.click(button);
      await user.dblClick(button);

      expect(button).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Creating your account…");
      expect(calls).toHaveLength(1);
      gate.resolve(undefined);
      await screen.findByRole("alert");
      expect(calls).toHaveLength(1);
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  describe("accessibility", () => {
    it("has no violations at the start, with problems, and after a server problem", async () => {
      registerRoute(() => problem("conflict", 409));
      const { container, user } = renderForm();
      await expectNoA11yViolations(container);

      await submit(user);
      await expectNoA11yViolations(container);

      await fill(user);
      await submit(user);
      await screen.findByText("That email is already registered.", { selector: "a" });
      await expectNoA11yViolations(container);
    });
  });
});
