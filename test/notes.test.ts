import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { addNote, deleteNote, formatList, localDate, NotesError, notesSince, searchNotes, type Note } from "../src/notes.ts";

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

describe("notesSince", () => {
  const list: Note[] = [
    { id: 1, text: "a", created: "2026-10-31" },
    { id: 2, text: "b", created: "2026-11-01" },
    { id: 3, text: "c", created: "2026-11-05" },
  ];

  it("keeps notes created on or after the date, in order, with ids", () => {
    expect(notesSince(list, "2026-11-01").map((n) => n.id)).toEqual([2, 3]);
  });

  it("returns a new array and does not mutate", () => {
    const copy = structuredClone(list);
    const out = notesSince(list, "2026-01-01");
    expect(out).not.toBe(list);
    expect(list).toEqual(copy);
  });

  it("returns [] when nothing matches", () => {
    expect(notesSince(list, "2027-01-01")).toEqual([]);
  });

  it.each(["2026-13-01", "ayer", "2026-1-5", "", "2026-02-30"])("rejects %j", (bad) => {
    expect(() => notesSince(list, bad)).toThrow(NotesError);
    expect(() => notesSince(list, bad)).toThrow("--since needs a date like YYYY-MM-DD");
  });
});

describe("cli list --since", () => {
  const seed = (file: string) => {
    writeFileSync(
      file,
      JSON.stringify([
        { id: 1, text: "old", created: "2026-10-01" },
        { id: 2, text: "new", created: "2026-11-02" },
      ]),
    );
  };
  const ERR = "error: --since needs a date like YYYY-MM-DD";

  it("prints only matching notes", () => {
    const file = tmpFile();
    seed(file);
    expect(run(["list", "--since", "2026-11-01"], file, DAY)).toEqual({ code: 0, out: "2. new (2026-11-02)" });
  });

  it("reports no matches with code 0", () => {
    const file = tmpFile();
    seed(file);
    expect(run(["list", "--since", "2027-01-01"], file, DAY)).toEqual({ code: 0, out: "No matching notes." });
  });

  it("errors without a date", () => {
    expect(run(["list", "--since"], tmpFile(), DAY)).toEqual({ code: 1, out: ERR });
  });

  it.each(["2026-13-01", "ayer", "2026-1-5"])("errors on malformed date %s", (bad) => {
    expect(run(["list", "--since", bad], tmpFile(), DAY)).toEqual({ code: 1, out: ERR });
  });

  it("plain list is unchanged", () => {
    const file = tmpFile();
    seed(file);
    expect(run(["list"], file, DAY).out).toBe("1. old (2026-10-01)\n2. new (2026-11-02)");
    expect(run(["list"], tmpFile(), DAY).out).toBe("No notes yet.");
  });

  it("does not write the file", () => {
    const file = tmpFile();
    seed(file);
    const before = readFileSync(file, "utf8");
    run(["list", "--since", "2026-11-01"], file, DAY);
    expect(readFileSync(file, "utf8")).toBe(before);
    const missing = tmpFile();
    run(["list", "--since", "2026-11-01"], missing, DAY);
    expect(existsSync(missing)).toBe(false);
  });
});
