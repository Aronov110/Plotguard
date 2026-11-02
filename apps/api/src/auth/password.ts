import argon2 from "argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * argon2id with the OWASP minimum: 19 MiB of memory, 2 passes, 1 lane. Takes roughly 40 ms on a
 * laptop, which is slow enough to make guessing expensive and fast enough for a login.
 */
export const DEFAULT_ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface Argon2Params {
  readonly type: typeof argon2.argon2id;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/** Why a password was refused. The wording for users lives with the code that shows it. */
export type PasswordIssue =
  | "too-short"
  | "too-long"
  | "control-character"
  | "malformed-unicode"
  | "only-whitespace";

export const PASSWORD_ISSUE_MESSAGES: Readonly<Record<PasswordIssue, string>> = {
  "too-short": `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  "too-long": `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  "control-character": "Remove tabs, line breaks and other control characters.",
  "malformed-unicode": "The password contains characters that are not valid text.",
  "only-whitespace": "Use more than spaces.",
};

/** NFKC, so the same password typed on different keyboards always gives the same hash. */
export function normalizePassword(plain: string): string {
  return plain.normalize("NFKC");
}

/**
 * The password policy: 12 to 128 characters (counted after normalisation), no control characters,
 * not only whitespace. No composition rules (no "needs a digit"): length matters, rules do not.
 * Returns the first problem, or `undefined` when the password is acceptable.
 */
export function checkPasswordPolicy(plain: string): PasswordIssue | undefined {
  // A lone surrogate would be encoded as U+FFFD, so two different passwords could collide.
  if (!plain.isWellFormed()) return "malformed-unicode";

  const normalized = normalizePassword(plain);
  if (/\p{Cc}/u.test(normalized)) return "control-character";
  // `+`, not `*`: an empty password is "too short", which is the more useful message.
  if (/^\s+$/u.test(normalized)) return "only-whitespace";

  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return "too-short";
  if (length > PASSWORD_MAX_LENGTH) return "too-long";
  return undefined;
}

/** Anything with a `run` method, such as the HashGate. Lets tests watch the calls. */
export interface TaskGate {
  run<T>(task: () => Promise<T>): Promise<T>;
}

const NO_GATE: TaskGate = { run: (task) => task() };

/** Longer than any hash we create. Stops a huge value reaching the native code. */
const MAX_HASH_LENGTH = 1024;

export interface PasswordHasher {
  /** Normalises and hashes. Does not check the policy: that is the caller's job. */
  hash(plain: string): Promise<string>;
  /** True only for the right password. A malformed hash gives false, never an exception. */
  verify(hash: string, plain: string): Promise<boolean>;
  /** True when the stored hash is weaker than the current settings and should be replaced. */
  needsRehash(hash: string): boolean;
  /**
   * Does the same amount of work as a real check and discards the result. Used for emails that do
   * not exist, so an attacker cannot tell them apart from real ones by how long the answer takes.
   */
  verifyAgainstDummy(plain: string): Promise<void>;
}

export interface PasswordHasherOptions {
  readonly params?: Argon2Params;
  readonly gate?: TaskGate;
}

export function createPasswordHasher(options: PasswordHasherOptions = {}): PasswordHasher {
  const params = options.params ?? DEFAULT_ARGON2_PARAMS;
  const gate = options.gate ?? NO_GATE;
  let dummyHash: Promise<string> | undefined;

  const hash = (plain: string): Promise<string> =>
    gate.run(() => argon2.hash(normalizePassword(plain), { ...params }));

  const verify = (stored: string, plain: string): Promise<boolean> =>
    gate.run(async () => {
      if (stored.length === 0 || stored.length > MAX_HASH_LENGTH) return false;
      try {
        return await argon2.verify(stored, normalizePassword(plain));
      } catch {
        return false;
      }
    });

  return {
    hash,
    verify,

    needsRehash(stored) {
      if (!stored.startsWith("$argon2")) return false;
      // argon2's own check compares the costs only, so the variant is checked here.
      if (!stored.startsWith("$argon2id$")) return true;
      try {
        return argon2.needsRehash(stored, {
          memoryCost: params.memoryCost,
          timeCost: params.timeCost,
          parallelism: params.parallelism,
        });
      } catch {
        return false;
      }
    },

    async verifyAgainstDummy(plain) {
      dummyHash ??= hash("plotpal timing dummy password");
      await verify(await dummyHash, plain);
    },
  };
}
