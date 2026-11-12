import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import {
  addNote,
  deleteNote,
  filterByTag,
  formatList,
  localDate,
  NotesError,
  parseTags,
  searchNotes,
  type Note,
} from "../src/notes.ts";

const DAY = "2026-11-06";
const tmpFile = () => join(mkdtempSync(join(tmpdir(), "notes-")), "notes.json");

describe("notes", () => {
  it("adds a note with the next id", () => {
    const notes = addNote(addNote([], "first", DAY), "second", DAY);
    expect(notes.map((n) => n.id)).toEqual([1, 2]);
  });

  it("trims text and refuses empty notes", () => {
    expect(addNote([], "  hi  ", DAY)[0].text).toBe("hi");
    expect(() => addNote([], "   ", DAY)).toThrow(NotesError);
  });

  it("deletes by id and refuses unknown ids", () => {
    const notes: Note[] = addNote([], "a", DAY);
    expect(deleteNote(notes, 1)).toEqual([]);
    expect(() => deleteNote(notes, 9)).toThrow("no note with id 9");
  });

  it("formats a list", () => {
    expect(formatList([])).toBe("No notes yet.");
    expect(formatList(addNote([], "milk", DAY))).toBe("1. milk (2026-11-06)");
  });
});

describe("localDate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/Bogota";
    try {
      // 23:30 local on 11 Nov 2026 is already 12 Nov in UTC.
      expect(localDate(new Date("2026-11-12T04:30:00Z"))).toBe("2026-11-11");
      expect(localDate(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe("cli", () => {
  it("adds and lists notes in the file", () => {
    const file = tmpFile();
    expect(run(["add", "buy", "milk"], file, DAY)).toEqual({ code: 0, out: "Added note 1." });
    expect(run(["list"], file, DAY).out).toBe("1. buy milk (2026-11-06)");
  });

  it("deletes a note", () => {
    const file = tmpFile();
    run(["add", "x"], file, DAY);
    expect(run(["delete", "1"], file, DAY).code).toBe(0);
    expect(run(["list"], file, DAY).out).toBe("No notes yet.");
  });

  it("reports errors with exit code 1", () => {
    const file = tmpFile();
    writeFileSync(file, "{ not json");
    expect(run(["list"], file, DAY).code).toBe(1);
    expect(run(["delete", "3"], tmpFile(), DAY)).toEqual({ code: 1, out: "error: no note with id 3" });
  });

  it("prints usage for unknown commands", () => {
    expect(run(["fly"], tmpFile(), DAY).code).toBe(2);
  });
});

describe("searchNotes", () => {
  const base = addNote(addNote(addNote([], "buy milk", DAY), "call Bob", DAY), "Milk run", DAY);

  it("returns only matching notes, keeping ids", () => {
    expect(searchNotes(base, "bob").map((n) => n.id)).toEqual([2]);
  });

  it("ignores case", () => {
    expect(searchNotes(base, "MILK").map((n) => n.id)).toEqual([1, 3]);
    expect(searchNotes(base, "milk")).toHaveLength(2);
  });

  it("returns [] when nothing matches", () => {
    expect(searchNotes(base, "zzz")).toEqual([]);
  });

  it("refuses an empty or whitespace-only query", () => {
    expect(() => searchNotes(base, "")).toThrow(NotesError);
    expect(() => searchNotes(base, "   ")).toThrow(NotesError);
  });
});

describe("parseTags", () => {
  it("collects tags and keeps the remaining words", () => {
    expect(parseTags(["--tag", "a", "hello", "world"])).toEqual({ tags: ["a"], rest: ["hello", "world"] });
    expect(parseTags(["--tag", "a", "hi", "--tag", "b"])).toEqual({ tags: ["a", "b"], rest: ["hi"] });
    expect(parseTags(["hi", "--tag", "a"])).toEqual({ tags: ["a"], rest: ["hi"] });
  });

  it("normalizes and dedupes", () => {
    expect(parseTags(["--tag", " Work ", "--tag", "work", "--tag", "B"]).tags).toEqual(["work", "b"]);
  });

  it("refuses a missing or empty value", () => {
    expect(() => parseTags(["hi", "--tag"])).toThrow("--tag needs a value");
    expect(() => parseTags(["--tag", "  ", "hi"])).toThrow(NotesError);
  });
});

describe("tags in notes", () => {
  it("stores tags only when given, without mutating", () => {
    const base: Note[] = addNote([], "a", DAY);
    const next = addNote(base, "b", DAY, ["x", "y"]);
    expect(next[1]).toEqual({ id: 2, text: "b", created: DAY, tags: ["x", "y"] });
    expect(base).toHaveLength(1);
    expect("tags" in addNote([], "c", DAY)[0]).toBe(false);
  });

  it("filters by tag, ignoring case and legacy notes", () => {
    const notes = addNote(addNote(addNote([], "a", DAY, ["work"]), "b", DAY), "c", DAY, ["home"]);
    const copy = structuredClone(notes);
    expect(filterByTag(notes, "WORK").map((n) => n.id)).toEqual([1]);
    expect(filterByTag(notes, "nope")).toEqual([]);
    expect(notes).toEqual(copy);
  });

  it("shows tags in the list", () => {
    expect(formatList(addNote([], "milk", DAY, ["a", "b"]))).toBe("1. milk (2026-11-06) [a, b]");
  });
});

describe("cli tags", () => {
  it("adds a tagged note", () => {
    const file = tmpFile();
    expect(run(["add", "--tag", "work", "--tag", "urgent", "buy", "milk"], file, DAY)).toEqual({
      code: 0,
      out: "Added note 1.",
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      { id: 1, text: "buy milk", created: DAY, tags: ["work", "urgent"] },
    ]);
  });

  it("errors on --tag without a value and writes nothing", () => {
    const file = tmpFile();
    expect(run(["add", "hi", "--tag"], file, DAY)).toEqual({ code: 1, out: "error: --tag needs a value" });
    expect(existsSync(file)).toBe(false);
  });

  it("lists only notes with the tag, read-only", () => {
    const file = tmpFile();
    run(["add", "--tag", "work", "a"], file, DAY);
    run(["add", "b"], file, DAY);
    run(["add", "--tag", "home", "c"], file, DAY);
    const before = readFileSync(file, "utf8");
    expect(run(["list", "--tag", "work"], file, DAY)).toEqual({ code: 0, out: "1. a (2026-11-06) [work]" });
    expect(run(["list", "--tag", "nope"], file, DAY)).toEqual({ code: 0, out: "No matching notes." });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("works with legacy files without tags", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify([{ id: 1, text: "old", created: DAY }]));
    expect(run(["list"], file, DAY).out).toBe("1. old (2026-11-06)");
    expect(run(["list", "--tag", "x"], file, DAY).out).toBe("No matching notes.");
  });
});

describe("cli search", () => {
  it("prints matches and leaves other notes out", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, DAY);
    run(["add", "call", "Bob"], file, DAY);
    expect(run(["search", "milk"], file, DAY)).toEqual({ code: 0, out: "1. buy milk (2026-11-06)" });
  });

  it("joins multi-word queries", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, DAY);
    expect(run(["search", "buy", "milk"], file, DAY).out).toBe("1. buy milk (2026-11-06)");
  });

  it("reports no match with code 0", () => {
    const file = tmpFile();
    run(["add", "x"], file, DAY);
    expect(run(["search", "nope"], file, DAY)).toEqual({ code: 0, out: "No matching notes." });
  });

  it("errors without text", () => {
    const res = run(["search"], tmpFile(), DAY);
    expect(res.code).toBe(1);
    expect(res.out).toBe("error: search needs some text");
  });

  it("does not modify the notes file", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, DAY);
    run(["search", "milk"], file, DAY);
    expect(run(["list"], file, DAY).out).toBe("1. buy milk (2026-11-06)");
  });
});
