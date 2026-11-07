import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertProject } from "../../db/test-support/factories.ts";
import { encodeCursor } from "../../projects/cursor.ts";
import { type AuthTestApp, buildAuthTestApp } from "../../test-support/auth-app.ts";
import {
  createdProject,
  type ListJson,
  newPerson,
  type Person,
  projectsApi,
} from "../../test-support/projects-api.ts";

let t: AuthTestApp;
beforeAll(async () => {
  t = await buildAuthTestApp();
});
afterAll(async () => {
  await t.close();
});

const api = () => projectsApi(t.app);
const BASE = Date.parse("2026-01-01T00:00:00.000Z");

/** Puts `n` projects straight into the database, each one second older than the one before. */
async function seed(person: Person, n: number, prefix = "P") {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      await insertProject(t.handle.db, person.id, {
        title: `${prefix}${i}`,
        updatedAt: new Date(BASE - i * 1000),
        createdAt: new Date(BASE - i * 1000),
      }),
    );
  }
  return rows;
}

async function page(person: Person, query = ""): Promise<ListJson> {
  const response = await api().list(person, query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<ListJson>();
}

/** Follows `nextCursor` to the end. Gives every page, and stops a runaway loop. */
async function walk(person: Person, limit: number): Promise<ListJson[]> {
  const pages: ListJson[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? `limit=${limit}` : `limit=${limit}&cursor=${cursor}`;
    const next = await page(person, query);
    pages.push(next);
    cursor = next.nextCursor;
    expect(pages.length).toBeLessThan(200);
  } while (cursor !== null);
  return pages;
}

const idsOf = (pages: ListJson[]) => pages.flatMap((p) => p.items.map((item) => item.id));

describe("the first page", () => {
  it("is empty and has no next page for a person without projects", async () => {
    const person = await newPerson(t.app);
    expect(await page(person)).toEqual({ items: [], nextCursor: null });
  });

  it("has exactly the members items and nextCursor", async () => {
    const person = await newPerson(t.app);
    await seed(person, 1);
    expect(Object.keys(await page(person)).sort()).toEqual(["items", "nextCursor"]);
  });

  it("lists the newest updated first", async () => {
    const person = await newPerson(t.app);
    await seed(person, 4);
    const titles = (await page(person)).items.map((item) => item.title);
    expect(titles).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("holds everything, with no next page, when there are fewer than a page", async () => {
    const person = await newPerson(t.app);
    await seed(person, 3);
    const result = await page(person);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });
});

describe("page sizes", () => {
  it("is 20 when no limit is given", async () => {
    const person = await newPerson(t.app);
    await seed(person, 25);
    const first = await page(person);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(person, `cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });

  it("has no next page when the person has exactly as many projects as the limit", async () => {
    const person = await newPerson(t.app);
    await seed(person, 3);
    const result = await page(person, "limit=3");
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it("has a next page when there is one project more than the limit", async () => {
    const person = await newPerson(t.app);
    await seed(person, 4);
    const first = await page(person, "limit=3");
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(person, `limit=3&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.title)).toEqual(["P3"]);
    expect(second.nextCursor).toBeNull();
  });

  it("allows the smallest page", async () => {
    const person = await newPerson(t.app);
    await seed(person, 2);
    expect((await page(person, "limit=1")).items).toHaveLength(1);
  });

  it("allows the largest page, and pages after it", async () => {
    const person = await newPerson(t.app);
    await seed(person, 101);
    const first = await page(person, "limit=100");
    expect(first.items).toHaveLength(100);
    const second = await page(person, `limit=100&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("accepts a limit with leading zeros", async () => {
    const person = await newPerson(t.app);
    await seed(person, 3);
    expect((await page(person, "limit=002")).items).toHaveLength(2);
  });
});

describe("walking through all the pages", () => {
  it("visits every project exactly once, in order, with one project per page", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 7);
    const pages = await walk(person, 1);
    expect(pages).toHaveLength(7);
    expect(idsOf(pages)).toEqual(rows.map((row) => row.id));
  });

  it("works for a total that is not a multiple of the page size", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 45);
    const pages = await walk(person, 7);
    expect(pages.map((p) => p.items.length)).toEqual([7, 7, 7, 7, 7, 7, 3]);
    expect(idsOf(pages)).toEqual(rows.map((row) => row.id));
  });

  it("works for a total that is a multiple of the page size", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 12);
    const pages = await walk(person, 4);
    expect(pages.map((p) => p.items.length)).toEqual([4, 4, 4]);
    expect(idsOf(pages)).toEqual(rows.map((row) => row.id));
  });

  it("gives the same result whatever the page size", async () => {
    const person = await newPerson(t.app);
    await seed(person, 23);
    const reference = idsOf(await walk(person, 100));
    for (const size of [1, 2, 3, 5, 10, 22, 23, 24]) {
      expect(idsOf(await walk(person, size)), `page size ${size}`).toEqual(reference);
    }
  });
});

describe("projects with the same update time", () => {
  it("are all visited exactly once, ordered by id", async () => {
    const person = await newPerson(t.app);
    const same = new Date(BASE);
    const rows = [];
    for (let i = 0; i < 7; i++) {
      rows.push(await insertProject(t.handle.db, person.id, { title: `Tie${i}`, updatedAt: same }));
    }
    const expected = rows.map((row) => row.id).sort((a, b) => (a < b ? 1 : -1));
    for (const size of [1, 2, 3, 7]) {
      expect(idsOf(await walk(person, size)), `page size ${size}`).toEqual(expected);
    }
  });

  it("do not hide the ones before and after them", async () => {
    const person = await newPerson(t.app);
    const newer = await insertProject(t.handle.db, person.id, { updatedAt: new Date(BASE + 5000) });
    const tied = [];
    for (let i = 0; i < 3; i++) {
      tied.push(await insertProject(t.handle.db, person.id, { updatedAt: new Date(BASE) }));
    }
    const older = await insertProject(t.handle.db, person.id, { updatedAt: new Date(BASE - 5000) });
    const ids = idsOf(await walk(person, 2));
    expect(ids[0]).toBe(newer.id);
    expect(ids.at(-1)).toBe(older.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("projects that differ by less than a millisecond", () => {
  async function insertAt(person: Person, title: string, time: string) {
    await t.handle.db.execute(
      sql`insert into projects (user_id, title, format, updated_at)
          values (${person.id}, ${title}, 'prose', ${time}::timestamptz)`,
    );
  }

  it("are visited exactly once, newest first", async () => {
    const person = await newPerson(t.app);
    // All five share the same millisecond (.123) and differ only in the last three digits.
    await insertAt(person, "a", "2026-03-01 12:00:00.123100+00");
    await insertAt(person, "b", "2026-03-01 12:00:00.123456+00");
    await insertAt(person, "c", "2026-03-01 12:00:00.123457+00");
    await insertAt(person, "d", "2026-03-01 12:00:00.123999+00");
    await insertAt(person, "e", "2026-03-01 12:00:00.123000+00");
    const expected = ["d", "c", "b", "a", "e"];
    for (const size of [1, 2, 3, 5]) {
      const titles = (await walk(person, size)).flatMap((p) => p.items.map((item) => item.title));
      expect(titles, `page size ${size}`).toEqual(expected);
    }
  });

  it("keep the exact time inside the cursor", async () => {
    const person = await newPerson(t.app);
    await insertAt(person, "x", "2026-03-01 12:00:00.123456+00");
    await insertAt(person, "y", "2026-03-01 12:00:00.123400+00");
    const first = await page(person, "limit=1");
    const cursor = JSON.parse(Buffer.from(first.nextCursor ?? "", "base64url").toString());
    expect(cursor[0]).toMatch(/\.123456\+00$/);
  });
});

describe("changes between two pages", () => {
  it("an edited project moves to the top of the list", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 3);
    const oldest = rows[2];
    await api().patch(person, oldest?.id ?? "", { title: "Edited" });
    const titles = (await page(person)).items.map((item) => item.title);
    expect(titles[0]).toBe("Edited");
    expect(titles).toHaveLength(3);
  });

  it("a project created while paging does not cause a repeat or a gap", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 5);
    const first = await page(person, "limit=2");
    const created = await createdProject(t.app, person, { title: "Newcomer" });
    const rest = await walkFrom(person, 2, first.nextCursor);
    const seen = [...first.items.map((i) => i.id), ...rest];
    expect(seen).toEqual(rows.map((row) => row.id));
    expect(seen).not.toContain(created.id);
  });

  it("a project deleted while paging does not break the next page", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 5);
    const first = await page(person, "limit=2");
    // Delete the very project the cursor points at.
    await api().remove(person, first.items[1]?.id ?? "");
    const rest = await walkFrom(person, 2, first.nextCursor);
    expect(rest).toEqual(rows.slice(2).map((row) => row.id));
  });

  it("a project edited while paging may appear again at the top, but never breaks the walk", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 4);
    const first = await page(person, "limit=2");
    await api().patch(person, rows[3]?.id ?? "", { title: "Moved up" });
    const rest = await walkFrom(person, 2, first.nextCursor);
    // The edited project (it was last) now sorts above the cursor, so the walk no longer meets it.
    expect(rest).toEqual([rows[2]?.id]);
  });

  it("deleting every project after the first page leaves an empty second page", async () => {
    const person = await newPerson(t.app);
    const rows = await seed(person, 4);
    const first = await page(person, "limit=2");
    await api().remove(person, rows[2]?.id ?? "");
    await api().remove(person, rows[3]?.id ?? "");
    const second = await page(person, `limit=2&cursor=${first.nextCursor}`);
    expect(second).toEqual({ items: [], nextCursor: null });
  });
});

/** The ids of every page after a cursor. */
async function walkFrom(person: Person, limit: number, start: string | null): Promise<string[]> {
  const ids: string[] = [];
  let cursor = start;
  while (cursor !== null) {
    const next = await page(person, `limit=${limit}&cursor=${cursor}`);
    ids.push(...next.items.map((item) => item.id));
    cursor = next.nextCursor;
  }
  return ids;
}

describe("two people with projects at the same moments", () => {
  it("never see each other's projects while paging", async () => {
    const [a, b] = [await newPerson(t.app), await newPerson(t.app)];
    const same = new Date(BASE);
    const mine = new Set<string>();
    for (let i = 0; i < 6; i++) {
      mine.add((await insertProject(t.handle.db, a.id, { updatedAt: same })).id);
      await insertProject(t.handle.db, b.id, { updatedAt: same });
    }
    for (const size of [1, 2, 4]) {
      const ids = idsOf(await walk(a, size));
      expect(ids, `page size ${size}`).toHaveLength(6);
      expect(new Set(ids)).toEqual(mine);
    }
  });

  it("cannot use a cursor to step into the other's projects", async () => {
    const [a, b] = [await newPerson(t.app), await newPerson(t.app)];
    await seed(a, 3, "A");
    await seed(b, 3, "B");
    const firstOfB = await page(b, "limit=1");
    const result = await page(a, `cursor=${firstOfB.nextCursor}`);
    expect(result.items.every((item) => item.title.startsWith("A"))).toBe(true);
  });
});

describe("a cursor that was made up", () => {
  it("from the far future returns the person's own projects and nobody else's", async () => {
    const [a, b] = [await newPerson(t.app), await newPerson(t.app)];
    await seed(a, 2, "A");
    await seed(b, 2, "B");
    const future = encodeCursor({
      updatedAt: "9999-12-31 23:59:59.999999+00",
      id: "ffffffff-ffff-7fff-bfff-ffffffffffff",
    });
    const result = await page(a, `cursor=${future}`);
    expect(result.items.map((item) => item.title)).toEqual(["A0", "A1"]);
  });

  it("from the far past returns an empty page", async () => {
    const person = await newPerson(t.app);
    await seed(person, 2);
    const past = encodeCursor({
      updatedAt: "0001-01-01 00:00:00+00",
      id: "00000000-0000-7000-8000-000000000000",
    });
    expect(await page(person, `cursor=${past}`)).toEqual({ items: [], nextCursor: null });
  });

  it("with a time zone offset still means the same moment", async () => {
    const person = await newPerson(t.app);
    await seed(person, 3);
    // P1 is at BASE - 1 s = 2025-12-31 23:59:59 UTC; write that moment as UTC+02. Projects with
    // the same time are told apart by id, so the cursor's id is the smallest possible one: it sits
    // below P1, and only P2 (older) comes after it. P0 (newer) is before it.
    const cursor = encodeCursor({
      updatedAt: "2026-01-01 01:59:59+02",
      id: "00000000-0000-7000-8000-000000000000",
    });
    const result = await page(person, `cursor=${cursor}`);
    expect(result.items.map((item) => item.title)).toEqual(["P2"]);
  });

  it("at the same moment as a project but with a larger id still includes that project", async () => {
    const person = await newPerson(t.app);
    await seed(person, 3);
    const cursor = encodeCursor({
      updatedAt: "2026-01-01 01:59:59+02",
      id: "ffffffff-ffff-7fff-bfff-ffffffffffff",
    });
    const result = await page(person, `cursor=${cursor}`);
    expect(result.items.map((item) => item.title)).toEqual(["P1", "P2"]);
  });
});

describe("a limit or cursor that is refused", () => {
  it.each(["0", "101", "1000", "-1", "1.5", "abc", "", "1e1", "0x10", " 5", "NaN", "5%205"])(
    "answers 400 for the limit %j",
    async (limit) => {
      const person = await newPerson(t.app);
      const response = await api().list(person, `limit=${limit}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [
          {
            source: "querystring",
            pointer: "/limit",
            message: "The limit must be a whole number from 1 to 100.",
          },
        ],
      });
    },
  );

  it("answers 400 when the limit is given twice", async () => {
    const person = await newPerson(t.app);
    expect((await api().list(person, "limit=1&limit=2")).statusCode).toBe(400);
  });

  it.each([
    ["garbage", "abc"],
    ["something that looks like base64", "AAAA"],
    [
      "a cursor cut short",
      encodeCursor({
        updatedAt: "2026-01-01 00:00:00+00",
        id: "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
      }).slice(0, 30),
    ],
    [
      "a cursor with a time that does not exist",
      encodeCursor({
        updatedAt: "2026-02-30 00:00:00+00",
        id: "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
      }),
    ],
    ["JSON that is not a cursor", Buffer.from('{"a":1}').toString("base64url")],
    ["an SQL fragment", "%27%3B%20drop%20table%20projects%3B%20--"],
    ["a NUL character", "%00"],
    ["something very long", "A".repeat(600)],
  ])("answers 400 for a cursor that is %s", async (_name, cursor) => {
    const person = await newPerson(t.app);
    const before = t.logs.lines.length;
    const response = await api().list(person, `cursor=${cursor}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe("/cursor");
    expect(t.logs.entries.slice(before).filter((entry) => Number(entry.level) >= 50)).toEqual([]);
  });

  it("answers 400 for an empty cursor", async () => {
    const person = await newPerson(t.app);
    expect((await api().list(person, "cursor=")).statusCode).toBe(400);
  });

  it("ignores query parameters it does not know", async () => {
    const person = await newPerson(t.app);
    await seed(person, 2);
    const result = await page(person, "utm_source=newsletter&sort=title");
    expect(result.items).toHaveLength(2);
  });
});

describe("what a list item contains", () => {
  it("matches what the database holds", async () => {
    const person = await newPerson(t.app);
    const [row] = await seed(person, 1);
    const [item] = (await page(person)).items;
    expect(item).toEqual({
      id: row?.id,
      title: "P0",
      format: "screenplay",
      logline: null,
      createdAt: new Date(BASE).toISOString(),
      updatedAt: new Date(BASE).toISOString(),
    });
  });
});
