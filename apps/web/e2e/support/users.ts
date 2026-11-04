/** A made-up person for one test. Nothing here is a real address or a real password. */
export interface TestUser {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/**
 * A new user with a random address, so tests can run side by side and in any order without
 * meeting each other's accounts. `example.com` is reserved for documentation: mail to it goes
 * nowhere. The password is long enough for the API's rule (12 characters).
 */
export function uniqueUser(): TestUser {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    email: `e2e-${id}@example.com`,
    password: "correct horse battery staple",
    displayName: `Tester ${id}`,
  };
}
