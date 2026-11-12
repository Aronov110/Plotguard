import { z } from "zod";
import { apiJson, apiRequest } from "./http.ts";

// These mirror the API's response schemas (apps/api/src/documents/schemas.ts). Every answer is
// checked when it arrives, so a changed API fails loudly here instead of showing garbage on a page.

const outlineItemSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  title: z.string(),
  position: z.number().int(),
  wordCount: z.number().int(),
  updatedAt: z.string(),
});

const outlineSchema = z.object({ items: z.array(outlineItemSchema) });

const documentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  parentId: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  position: z.number().int(),
  wordCount: z.number().int(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OutlineItem = z.infer<typeof outlineItemSchema>;
export type DocumentDetail = z.infer<typeof documentSchema>;

export interface CreateDocumentInput {
  readonly title: string;
  /** The act or chapter it goes under. Leave it out (or `null`) for the top level. */
  readonly parentId?: string | null;
  /** Leave it out to put it last. */
  readonly position?: number;
  readonly content?: string;
}

export interface UpdateDocumentInput {
  readonly title?: string;
  readonly content?: string;
  readonly parentId?: string | null;
  readonly position?: number;
}

export interface DocumentCallOptions {
  readonly signal?: AbortSignal;
}

export interface UpdateDocumentOptions extends DocumentCallOptions {
  /** The version the caller read. Required by the API: a stale one is refused with 412. */
  readonly ifMatch: number;
}

/**
 * The document routes the writing screen uses. All need the access token: run them through
 * `withAuth` so that an expired token is renewed once. Each call throws `ApiError`, `NetworkError`
 * or `ResponseShapeError`.
 */
export interface DocumentsApi {
  /** The whole outline of a project without text, each act followed by its children. */
  outline(projectId: string, options?: DocumentCallOptions): Promise<readonly OutlineItem[]>;
  /** One document with its text and its `version`. */
  get(projectId: string, id: string, options?: DocumentCallOptions): Promise<DocumentDetail>;
  /** Adds an outline item. 409 means the project already has the most items allowed. */
  create(
    projectId: string,
    input: CreateDocumentInput,
    options?: DocumentCallOptions,
  ): Promise<DocumentDetail>;
  /** Saves changes. 412 means the document was changed since `ifMatch`; 428 means it was not sent. */
  update(
    projectId: string,
    id: string,
    changes: UpdateDocumentInput,
    options: UpdateDocumentOptions,
  ): Promise<DocumentDetail>;
  /**
   * Deletes an item for good; the items inside an act or chapter go with it. Needs no version. 404
   * means it was already gone.
   */
  remove(projectId: string, id: string, options?: DocumentCallOptions): Promise<void>;
}

/**
 * The address of a project's documents. The ids come from the API's own answers, but they are
 * encoded anyway, so that nothing in them (`/`, `..`, `?`) can change which address is called.
 */
function documentsPath(projectId: string, id?: string): string {
  const base = `/projects/${encodeURIComponent(projectId)}/documents`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

export const documentsApi: DocumentsApi = {
  outline: async (projectId, { signal } = {}) => {
    const outline = await apiJson(documentsPath(projectId), outlineSchema, {
      auth: true,
      ...(signal === undefined ? {} : { signal }),
    });
    return outline.items;
  },

  get: (projectId, id, { signal } = {}) =>
    apiJson(documentsPath(projectId, id), documentSchema, {
      auth: true,
      ...(signal === undefined ? {} : { signal }),
    }),

  create: (projectId, { title, parentId, position, content }, { signal } = {}) =>
    apiJson(documentsPath(projectId), documentSchema, {
      method: "POST",
      auth: true,
      json: {
        title,
        ...(parentId === undefined ? {} : { parentId }),
        ...(position === undefined ? {} : { position }),
        ...(content === undefined ? {} : { content }),
      },
      ...(signal === undefined ? {} : { signal }),
    }),

  update: (projectId, id, changes, { ifMatch, signal }) =>
    apiJson(documentsPath(projectId, id), documentSchema, {
      method: "PATCH",
      auth: true,
      ifMatch,
      json: changes,
      ...(signal === undefined ? {} : { signal }),
    }),

  remove: async (projectId, id, { signal } = {}) => {
    await apiRequest(documentsPath(projectId, id), {
      method: "DELETE",
      auth: true,
      ...(signal === undefined ? {} : { signal }),
    });
  },
};
