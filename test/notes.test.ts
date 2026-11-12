import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { addNote, deleteNote, formatList, loadNotes, localDate, NotesError, searchNotes, type Note } from "../src/notes.ts";

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

const good = { id: 1, text: "a", created: "2026-01-01" };
const withData = (data: unknown): string => {
  const file = tmpFile();
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
  return file;
};

describe("loadNotes validation", () => {
  it("accepts valid, empty and missing files", () => {
    expect(loadNotes(withData([good, { ...good, id: 2 }]))).toEqual([good, { ...good, id: 2 }]);
    expect(loadNotes(withData([]))).toEqual([]);
    expect(loadNotes(tmpFile())).toEqual([]);
  });

  it("reports the position of an invalid note", () => {
    const file = withData([{ id: "x" }]);
    expect(() => loadNotes(file)).toThrow(new NotesError(`${file} has an invalid note at position 1`));
    const file3 = withData([good, { ...good, id: 2 }, { id: 3, created: "2026-01-01" }]);
    expect(() => loadNotes(file3)).toThrow(`${file3} has an invalid note at position 3`);
  });

  const bad: unknown[] = [
    { ...good, id: 0 },
    { ...good, id: -1 },
    { ...good, id: 1.5 },
    { ...good, id: "1" },
    { ...good, text: "" },
    { ...good, text: "   " },
    { ...good, text: 5 },
    { id: 1, text: "a" },
    { ...good, created: "2026/01/01" },
    { ...good, created: "26-1-1" },
    { ...good, created: 20260101 },
    null,
    42,
    [],
  ];
  it.each(bad.map((b) => [JSON.stringify(b), b]))("rejects %s", (_name, b) => {
    const file = withData([b]);
    expect(() => loadNotes(file)).toThrow(NotesError);
  });

  it("reports the first of several invalid notes", () => {
    const file = withData([good, null, 7]);
    expect(() => loadNotes(file)).toThrow(`${file} has an invalid note at position 2`);
  });

  it("keeps JSON and non-list errors", () => {
    expect(() => loadNotes(withData("{nope"))).toThrow(SyntaxError);
    expect(() => loadNotes(withData({}))).toThrow(NotesError);
  });
});

describe("cli with a broken file", () => {
  it.each([["list"], ["add", "x"]])("%s fails and leaves the file untouched", (...args) => {
    const file = withData([good, { id: 0 }]);
    const before = readFileSync(file, "utf8");
    expect(run(args.flat(), file, DAY)).toEqual({ code: 1, out: `error: ${file} has an invalid note at position 2` });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("invalid JSON still gives code 1", () => {
    expect(run(["list"], withData("{nope"), DAY).code).toBe(1);
  });
});
