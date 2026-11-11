import { z } from "zod";
import { apiJson, apiRequest } from "./http.ts";

// These mirror the API's response schemas (apps/api/src/projects/schemas.ts). Every answer is
// checked when it arrives, so a changed API fails loudly here instead of showing garbage on a page.

export const PROJECT_FORMATS = ["screenplay", "prose", "other"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

const projectSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  format: z.enum(PROJECT_FORMATS),
  logline: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const projectPageSchema = z.object({
  items: z.array(projectSchema),
  nextCursor: z.string().nullable(),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;

export interface CreateProjectInput {
  readonly title: string;
  readonly format: ProjectFormat;
  /** Leave it out for no logline; the API treats a blank one the same way. */
  readonly logline?: string;
}

export interface ListProjectsOptions {
  /** The `nextCursor` of the previous page. Leave it out for the first page. */
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface CreateProjectOptions {
  readonly signal?: AbortSignal;
}

/** What to change. Only the fields that are present are sent. */
export interface UpdateProjectInput {
  readonly title?: string;
  readonly format?: ProjectFormat;
  /** `null` clears the logline. */
  readonly logline?: string | null;
}

export interface ProjectCallOptions {
  readonly signal?: AbortSignal;
}

/**
 * The project routes the "Your projects" screen uses. All need the access token: run them through
 * `withAuth` so that an expired token is renewed once. Each call throws `ApiError`, `NetworkError`
 * or `ResponseShapeError`.
 */
export interface ProjectsApi {
  /** One page of the signed-in person's projects, newest change first. */
  list(options?: ListProjectsOptions): Promise<ProjectPage>;
  create(input: CreateProjectInput, options?: CreateProjectOptions): Promise<Project>;
  /** Changes some fields of one project. Returns the project as it is now. */
  update(id: string, changes: UpdateProjectInput, options?: ProjectCallOptions): Promise<Project>;
  /** Deletes one project for good, with its documents and analyses. */
  remove(id: string, options?: ProjectCallOptions): Promise<void>;
}

/**
 * The address of one project. The id comes from the API's own list, but it is encoded anyway, so
 * that nothing in it (`/`, `..`, `?`) can ever change which address is called.
 */
function projectPath(id: string): string {
  return `/projects/${encodeURIComponent(id)}`;
}

export const projectsApi: ProjectsApi = {
  list: ({ cursor, signal } = {}) => {
    // URLSearchParams encodes the cursor (it carries characters such as `+` and `:`).
    const query = cursor === undefined ? "" : `?${new URLSearchParams({ cursor }).toString()}`;
    return apiJson(`/projects${query}`, projectPageSchema, {
      auth: true,
      ...(signal === undefined ? {} : { signal }),
    });
  },

  create: ({ title, format, logline }, { signal } = {}) =>
    apiJson("/projects", projectSchema, {
      method: "POST",
      auth: true,
      json: { title, format, ...(logline === undefined ? {} : { logline }) },
      ...(signal === undefined ? {} : { signal }),
    }),

  update: (id, changes, { signal } = {}) =>
    apiJson(projectPath(id), projectSchema, {
      method: "PATCH",
      auth: true,
      json: changes,
      ...(signal === undefined ? {} : { signal }),
    }),

  remove: async (id, { signal } = {}) => {
    // The answer is 204 with no body, so there is nothing to read.
    await apiRequest(projectPath(id), {
      method: "DELETE",
      auth: true,
      ...(signal === undefined ? {} : { signal }),
    });
  },
};
