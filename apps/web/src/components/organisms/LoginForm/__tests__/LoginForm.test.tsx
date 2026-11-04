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
import { LoginForm } from "../LoginForm.tsx";

const SESSION = {
  user: { id: "user-1", email: "ada@example.com", displayName: null },
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

/** Answers the login route and records what was sent. */
function loginRoute(reply: () => Response | Promise<Response> = () => HttpResponse.json(SESSION)) {
  const calls: unknown[] = [];
  server.use(
    http.post("/auth/login", async ({ request }) => {
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
        <LoginForm />
        <AuthStateProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...view, user: userEvent.setup() };
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email = "ada@example.com",
  password = PASSWORD,
) {
  if (email !== "") await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByLabelText("Password"));
  if (password !== "") await user.paste(password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginForm", () => {
  describe("what it shows", () => {
    it("has an email field, a password field and a submit button", () => {
      renderForm();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByLabelText("Password")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Log in" })).toHaveAttribute("type", "submit");
    });

    it("tells browsers and password managers what the fields are", () => {
      renderForm();
      const email = screen.getByLabelText("Email");
      const password = screen.getByLabelText("Password");
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("name", "email");
      expect(email).toHaveAttribute("autocomplete", "username");
      expect(email).toHaveAttribute("inputmode", "email");
      expect(email).toHaveAttribute("autocapitalize", "none");
      expect(email).toHaveAttribute("spellcheck", "false");
      expect(password).toHaveAttribute("name", "password");
      expect(password).toHaveAttribute("autocomplete", "current-password");
    });

    it("leaves checking to the server: the browser's own validation is off", () => {
      const { container } = renderForm();
      expect(container.querySelector("form")).toHaveAttribute("novalidate");
    });

    it("shows no error before anything is sent", () => {
      renderForm();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("checking that the fields are filled in", () => {
    it("asks for both fields when both are empty, sends nothing and moves the focus to the problems", async () => {
      const calls = loginRoute();
      const { user } = renderForm();

      await user.click(screen.getByRole("button", { name: "Log in" }));

      const summary = screen.getByRole("alert");
      expect(
        within(summary).getByRole("link", { name: "Enter your email address." }),
      ).toBeInTheDocument();
      expect(
        within(summary).getByRole("link", { name: "Enter your password." }),
      ).toBeInTheDocument();
      expect(summary).toHaveFocus();
      expect(screen.getByLabelText("Email")).toBeInvalid();
      expect(screen.getByLabelText("Password")).toBeInvalid();
      expect(calls).toHaveLength(0);
    });

    it("asks only for the password when only that is missing", async () => {
      const calls = loginRoute();
      const { user } = renderForm();
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.click(screen.getByRole("button", { name: "Log in" }));

      expect(screen.getByRole("link", { name: "Enter your password." })).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Enter your email address." }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Email")).not.toBeInvalid();
      expect(calls).toHaveLength(0);
    });

    it("treats an email of only spaces as empty", async () => {
      const calls = loginRoute();
      const { user } = renderForm();
      await user.type(screen.getByLabelText("Email"), "   ");
      await user.click(screen.getByLabelText("Password"));
      await user.paste(PASSWORD);
      await user.click(screen.getByRole("button", { name: "Log in" }));
      expect(screen.getByRole("link", { name: "Enter your email address." })).toBeInTheDocument();
      expect(calls).toHaveLength(0);
    });

    it("jumps to a field when its problem is clicked", async () => {
      loginRoute();
      const { user } = renderForm();
      await user.click(screen.getByRole("button", { name: "Log in" }));
      await user.click(screen.getByRole("link", { name: "Enter your password." }));
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });
  });

  describe("signing in", () => {
    it("sends exactly what was typed and signs in", async () => {
      const calls = loginRoute();
      const { user } = renderForm();
      await fillAndSubmit(user);
      expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
    });

    it("removes spaces around the email, because a pasted address often has them", async () => {
      const calls = loginRoute();
      const { user } = renderForm();
      await fillAndSubmit(user, "  ada@example.com  ");
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
    });

    it.each([
      ["spaces at both ends", "  spaced out  password  "],
      ["emoji and accents", "pä🔑ss wörd 🔑 123"],
      ["only spaces", "                "],
      ["128 characters", "x".repeat(128)],
      ["a mix of scripts", "пароль 密碼 كلمة السر 🔐 ok ok"],
    ])("sends a password with %s exactly as it was typed", async (_name, password) => {
      const calls = loginRoute();
      const { user } = renderForm();
      await fillAndSubmit(user, "ada@example.com", password);
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toEqual([{ email: "ada@example.com", password }]);
    });

    it("also signs in when Enter is pressed in the password field", async () => {
      const calls = loginRoute();
      const { user } = renderForm();
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.click(screen.getByLabelText("Password"));
      await user.paste(PASSWORD);
      await user.keyboard("{Enter}");
      await screen.findByText("signed-in:ada@example.com");
      expect(calls).toHaveLength(1);
    });
  });

  describe("while the request runs", () => {
    it("says it is working, keeps its label and sends only one request, however often it is pressed", async () => {
      // The fake server holds its answer until the test opens the gate, so "busy" can be checked
      // at any speed. A fixed delay would be a race on a slow machine.
      const gate = deferred<undefined>();
      const calls = loginRoute(async () => {
        await gate.promise;
        return problem("unauthorized", 401);
      });
      const { user } = renderForm();
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.click(screen.getByLabelText("Password"));
      await user.paste(PASSWORD);

      const button = screen.getByRole("button", { name: "Log in" });
      await user.click(button);
      await user.click(button);
      await user.dblClick(button);

      expect(button).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
      expect(calls).toHaveLength(1);
      gate.resolve(undefined);
      await screen.findByText("Email or password is incorrect.");
      expect(calls).toHaveLength(1);
      expect(button).not.toHaveAttribute("aria-busy");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
  });

  describe("when something goes wrong", () => {
    it("says one thing about a wrong email or password, without pointing at either field", async () => {
      loginRoute(() => problem("unauthorized", 401));
      const { user } = renderForm();
      await fillAndSubmit(user);

      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent("Email or password is incorrect.");
      expect(within(summary).queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Email")).not.toBeInvalid();
      expect(screen.getByLabelText("Password")).not.toBeInvalid();
      expect(summary).toHaveFocus();
      expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out");
    });

    it("keeps what was typed, so it can be corrected", async () => {
      loginRoute(() => problem("unauthorized", 401));
      const { user } = renderForm();
      await fillAndSubmit(user, "ada@example.com", "  my password  ");
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
      expect(screen.getByLabelText("Password")).toHaveValue("  my password  ");
    });

    it("puts the server's message under the field it is about and links to it", async () => {
      loginRoute(() =>
        problem("validation-error", 400, {
          errors: [{ source: "body", pointer: "/email", message: "Enter a valid email address." }],
        }),
      );
      const { user } = renderForm();
      await fillAndSubmit(user, "not-an-email");

      const summary = await screen.findByRole("alert");
      await user.click(within(summary).getByRole("link", { name: "Enter a valid email address." }));
      expect(screen.getByLabelText("Email")).toHaveFocus();
      expect(screen.getByLabelText("Email")).toBeInvalid();
      expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
        "Error: Enter a valid email address.",
      );
    });

    it("says how long to wait when there were too many attempts", async () => {
      loginRoute(() => problem("rate-limited", 429, {}, { "retry-after": "30" }));
      const { user } = renderForm();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Too many attempts. Try again in 30 seconds.",
      );
    });

    it("says the service is busy for a 503", async () => {
      loginRoute(() => problem("service-busy", 503));
      const { user } = renderForm();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The service is busy. Try again in a moment.",
      );
    });

    it("says the server cannot be reached when there is no answer", async () => {
      loginRoute(() => HttpResponse.error());
      const { user } = renderForm();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Can't reach the server. Check your connection and try again.",
      );
    });

    it("never shows the server's own words for a problem it does not know", async () => {
      loginRoute(() =>
        problem("internal", 500, { detail: "secret internal detail: stack at line 42" }),
      );
      const { user } = renderForm();
      await fillAndSubmit(user);
      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent("Something went wrong. Please try again.");
      expect(document.body).not.toHaveTextContent("secret internal detail");
    });

    it("copes with an HTML error page from a proxy", async () => {
      loginRoute(
        () => new HttpResponse("<html><body>502 Bad Gateway</body></html>", { status: 502 }),
      );
      const { user } = renderForm();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Something went wrong. Please try again.",
      );
    });

    it("clears the problems when the next attempt works", async () => {
      let attempt = 0;
      loginRoute(() =>
        ++attempt === 1 ? problem("unauthorized", 401) : HttpResponse.json(SESSION),
      );
      const { user } = renderForm();
      await fillAndSubmit(user);
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: "Log in" }));

      await screen.findByText("signed-in:ada@example.com");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("removes old problems when a new attempt finds different ones", async () => {
      loginRoute();
      const { user } = renderForm();
      await user.click(screen.getByRole("button", { name: "Log in" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      await user.type(screen.getByLabelText("Email"), "ada@example.com");
      await user.click(screen.getByRole("button", { name: "Log in" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
  });

  describe("accessibility", () => {
    it("has no violations when it first appears", async () => {
      const { container } = renderForm();
      await expectNoA11yViolations(container);
    });

    it("has no violations with problems shown", async () => {
      const { container, user } = renderForm();
      await user.click(screen.getByRole("button", { name: "Log in" }));
      await expectNoA11yViolations(container);
    });

    it("has no violations after a failed login", async () => {
      loginRoute(() => problem("unauthorized", 401));
      const { container, user } = renderForm();
      await fillAndSubmit(user);
      await screen.findByRole("alert");
      await expectNoA11yViolations(container);
    });
  });
});
