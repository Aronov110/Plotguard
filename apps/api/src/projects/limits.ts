import type { RateRule } from "../auth/limits.ts";

/** How often one signed-in person may change projects. Reads are covered by the global limit. */
export interface ProjectLimits {
  /** Per person, shared by create, edit and delete. */
  readonly writes: RateRule;
}

export const DEFAULT_PROJECT_LIMITS: ProjectLimits = {
  writes: { max: 60, windowSeconds: 60 },
};

/** The largest page a list request may ask for. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** A project body has a title (200 characters) and a logline (1000): far below this. */
export const PROJECT_BODY_LIMIT_BYTES = 16_384;
