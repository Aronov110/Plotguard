import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { type Document, documents } from "../db/schema/documents.ts";
import { projects } from "../db/schema/projects.ts";
import { MAX_DOCUMENTS_PER_PROJECT } from "./limits.ts";
import type {
  CreateDocumentInput,
  DocumentView,
  Outline,
  OutlineItem,
  PatchDocumentInput,
} from "./schemas.ts";
import { countWords } from "./word-count.ts";

/** The save was based on a version that is no longer the current one. The route answers 412. */
export class StaleVersionError extends Error {
  constructor() {
    super("The document was changed since it was loaded.");
    this.name = "StaleVersionError";
  }
}

export type InvalidParentReason = "not-found" | "too-deep" | "self" | "has-children";

/** The chosen parent cannot hold this item. The route answers 400 on `/parentId`. */
export class InvalidParentError extends Error {
  readonly reason: InvalidParentReason;
  constructor(reason: InvalidParentReason) {
    super(`The parent is not valid: ${reason}.`);
    this.name = "InvalidParentError";
    this.reason = reason;
  }
}

/** The position is past the end of the siblings. The route answers 400 on `/position`. */
export class InvalidPositionError extends Error {
  /** The largest position that would have been accepted. */
  readonly max: number;
  constructor(max: number) {
    super(`The position must be from 0 to ${max}.`);
    this.name = "InvalidPositionError";
    this.max = max;
  }
}

/** The project already has the most items allowed. The route answers 409. */
export class DocumentLimitError extends Error {
  constructor() {
    super(`A project can have at most ${MAX_DOCUMENTS_PER_PROJECT} outline items.`);
    this.name = "DocumentLimitError";
  }
}

/**
 * The outline items and texts of one project. Every method takes the owner's id and puts it in the
 * query, so a document of someone else is simply not found. Methods return `undefined` (or `false`)
 * for "not found" and for "not yours" alike.
 *
 * Every change first locks the project row, so one change at a time runs per project. That makes
 * the "count, then place" steps below safe, and it closes the race the depth trigger documents.
 * The same statement moves the project to the top of the project list.
 */
export interface DocumentsService {
  /** The whole outline without text, or `undefined` if the project is not the person's. */
  outline(userId: string, projectId: string): Promise<Outline | undefined>;
  /** @returns `undefined` if the project is not the person's. */
  create(
    userId: string,
    projectId: string,
    input: CreateDocumentInput,
  ): Promise<DocumentView | undefined>;
  get(userId: string, projectId: string, id: string): Promise<DocumentView | undefined>;
  /**
   * @param expectedVersion The version the caller loaded; a different current version throws
   * {@link StaleVersionError}.
   * @returns `undefined` if there is no such document in the person's project.
   */
  update(
    userId: string,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: PatchDocumentInput,
  ): Promise<DocumentView | undefined>;
  /** @returns whether a document was deleted. Its children go with it. */
  remove(userId: string, projectId: string, id: string): Promise<boolean>;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Thrown to leave a transaction early (rolling back the project touch) with a result. */
class Rollback<T> extends Error {
  readonly result: T;
  constructor(result: T) {
    super("rollback");
    this.name = "Rollback";
    this.result = result;
  }
}

async function transact<T>(
  db: Database,
  work: (tx: Transaction, leave: (result: T) => never) => Promise<T>,
): Promise<T> {
  const leave = (result: T): never => {
    throw new Rollback(result);
  };
  try {
    return await db.transaction((tx) => work(tx, leave));
  } catch (error) {
    if (error instanceof Rollback) return error.result as T;
    throw error;
  }
}

/**
 * Locks the project row, checks that it is the person's, and moves it to the top of their list,
 * all in one statement. Must be the first statement of every change.
 */
async function lockProject(tx: Transaction, userId: string, projectId: string): Promise<boolean> {
  const rows = await tx
    .update(projects)
    .set({ updatedAt: sql`now()` })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return rows.length > 0;
}

interface Placed {
  readonly id: string;
  readonly position: number;
}

/** The items under one parent (`null` is the top level), in order. */
async function siblingsOf(
  tx: Transaction,
  projectId: string,
  parentId: string | null,
): Promise<Placed[]> {
  return tx
    .select({ id: documents.id, position: documents.position })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        parentId === null ? isNull(documents.parentId) : eq(documents.parentId, parentId),
      ),
    )
    .orderBy(asc(documents.position), asc(documents.id));
}

/**
 * Gives the items the positions 0, 1, 2, ... in the order given, with one statement that touches
 * only the rows whose position actually changes. Does not change `version`: moving a sibling
 * must not make another tab's save stale.
 */
async function renumber(
  tx: Transaction,
  projectId: string,
  ordered: readonly Placed[],
): Promise<void> {
  const changes = ordered.flatMap((item, index) =>
    item.position === index ? [] : [{ id: item.id, position: index }],
  );
  if (changes.length === 0) return;
  const values = sql.join(
    changes.map((change) => sql`(${change.id}::uuid, ${change.position}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    update documents as d
    set position = v.position
    from (values ${values}) as v(id, position)
    where d.id = v.id and d.project_id = ${projectId}
  `);
}

/** Checks that `parentId` can hold an item: same project, top level, and not the item itself. */
async function checkParent(
  tx: Transaction,
  projectId: string,
  parentId: string,
  movingId: string | undefined,
): Promise<void> {
  if (parentId === movingId) throw new InvalidParentError("self");
  const [parent] = await tx
    .select({ parentId: documents.parentId })
    .from(documents)
    .where(and(eq(documents.id, parentId), eq(documents.projectId, projectId)));
  if (parent === undefined) throw new InvalidParentError("not-found");
  if (parent.parentId !== null) throw new InvalidParentError("too-deep");
  if (movingId === undefined) return;
  const [child] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.parentId, movingId), eq(documents.projectId, projectId)))
    .limit(1);
  if (child !== undefined) throw new InvalidParentError("has-children");
}

function toView(row: Document): DocumentView {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    title: row.title,
    content: row.content,
    position: row.position,
    wordCount: row.wordCount,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Each top-level item followed by its children. The rows must already be in position order. */
function arrange(rows: readonly OutlineItem[]): OutlineItem[] {
  const childrenOf = new Map<string, OutlineItem[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row]);
  }
  return rows.flatMap((row) =>
    row.parentId === null ? [row, ...(childrenOf.get(row.id) ?? [])] : [],
  );
}

export function createDocumentsService(db: Database): DocumentsService {
  return {
    async outline(userId, projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      if (project === undefined) return undefined;

      // Never selects `content`: the outline must stay small however long the texts are.
      const rows = await db
        .select({
          id: documents.id,
          parentId: documents.parentId,
          title: documents.title,
          position: documents.position,
          wordCount: documents.wordCount,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(eq(documents.projectId, projectId))
        .orderBy(asc(documents.position), asc(documents.id));
      return {
        items: arrange(rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))),
      };
    },

    async create(userId, projectId, input) {
      return transact<DocumentView | undefined>(db, async (tx, leave) => {
        if (!(await lockProject(tx, userId, projectId))) return leave(undefined);

        const [{ total } = { total: 0 }] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(documents)
          .where(eq(documents.projectId, projectId));
        if (total >= MAX_DOCUMENTS_PER_PROJECT) throw new DocumentLimitError();

        const parentId = input.parentId ?? null;
        if (parentId !== null) await checkParent(tx, projectId, parentId, undefined);

        const siblings = await siblingsOf(tx, projectId, parentId);
        const position = input.position ?? siblings.length;
        if (position > siblings.length) throw new InvalidPositionError(siblings.length);

        const content = input.content ?? "";
        const [row] = await tx
          .insert(documents)
          .values({
            projectId,
            parentId,
            title: input.title,
            content,
            position,
            wordCount: countWords(content),
          })
          .returning();
        if (row === undefined) throw new Error("The insert returned no row.");

        await renumber(tx, projectId, [
          ...siblings.slice(0, position),
          { id: row.id, position },
          ...siblings.slice(position),
        ]);
        return toView(row);
      });
    },

    async get(userId, projectId, id) {
      const [row] = await db
        .select({ document: documents })
        .from(documents)
        .innerJoin(projects, eq(projects.id, documents.projectId))
        .where(
          and(
            eq(documents.id, id),
            eq(documents.projectId, projectId),
            eq(projects.userId, userId),
          ),
        );
      return row === undefined ? undefined : toView(row.document);
    },

    async update(userId, projectId, id, expectedVersion, patch) {
      return transact<DocumentView | undefined>(db, async (tx, leave) => {
        if (!(await lockProject(tx, userId, projectId))) return leave(undefined);

        const [current] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
        if (current === undefined) return leave(undefined);
        if (current.version !== expectedVersion) throw new StaleVersionError();

        const changes: Partial<
          Pick<Document, "title" | "content" | "wordCount" | "parentId" | "position">
        > = {};
        if (patch.title !== undefined) changes.title = patch.title;
        if (patch.content !== undefined) {
          changes.content = patch.content;
          changes.wordCount = countWords(patch.content);
        }

        // Work out the move before writing, so that a bad parent or position changes nothing.
        const targetParent = patch.parentId === undefined ? current.parentId : patch.parentId;
        const parentChanged = targetParent !== current.parentId;
        let newOrder: Placed[] | undefined;
        let oldOrder: Placed[] | undefined;
        if (parentChanged || patch.position !== undefined) {
          if (targetParent !== null && parentChanged) {
            await checkParent(tx, projectId, targetParent, id);
          }
          const others = (await siblingsOf(tx, projectId, targetParent)).filter(
            (item) => item.id !== id,
          );
          const position = patch.position ?? (parentChanged ? others.length : current.position);
          if (position > others.length) throw new InvalidPositionError(others.length);
          changes.parentId = targetParent;
          changes.position = position;
          newOrder = [...others.slice(0, position), { id, position }, ...others.slice(position)];
          if (parentChanged) {
            oldOrder = (await siblingsOf(tx, projectId, current.parentId)).filter(
              (item) => item.id !== id,
            );
          }
        }

        const [row] = await tx
          .update(documents)
          .set({ ...changes, version: sql`${documents.version} + 1` })
          .where(
            and(
              eq(documents.id, id),
              eq(documents.projectId, projectId),
              eq(documents.version, expectedVersion),
            ),
          )
          .returning();
        if (row === undefined) throw new StaleVersionError();

        if (newOrder !== undefined) await renumber(tx, projectId, newOrder);
        if (oldOrder !== undefined) await renumber(tx, projectId, oldOrder);
        return toView(row);
      });
    },

    async remove(userId, projectId, id) {
      return transact<boolean>(db, async (tx, leave) => {
        if (!(await lockProject(tx, userId, projectId))) return leave(false);

        const [current] = await tx
          .select({ parentId: documents.parentId })
          .from(documents)
          .where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
        if (current === undefined) return leave(false);

        // The children go with it (the foreign key cascades).
        await tx
          .delete(documents)
          .where(and(eq(documents.id, id), eq(documents.projectId, projectId)));
        await renumber(tx, projectId, await siblingsOf(tx, projectId, current.parentId));
        return true;
      });
    },
  };
}
