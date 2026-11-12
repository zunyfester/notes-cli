import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { addNote, deleteNote, editNote, formatList, localDate, NotesError, searchNotes, type Note } from "../src/notes.ts";

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

describe("editNote", () => {
  const base = addNote(addNote(addNote([], "a", "2026-01-01"), "b", "2026-02-02"), "c", "2026-03-03");

  it("changes text and keeps id and created", () => {
    const out = editNote(base, 2, "new");
    expect(out[1]).toEqual({ id: 2, text: "new", created: "2026-02-02" });
  });

  it("leaves other notes untouched and keeps order", () => {
    const out = editNote(base, 2, "new");
    expect(out.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(out[0]).toEqual(base[0]);
    expect(out[2]).toEqual(base[2]);
  });

  it("does not mutate the input", () => {
    const copy = structuredClone(base);
    const out = editNote(base, 2, "new");
    expect(out).not.toBe(base);
    expect(base).toEqual(copy);
  });

  it("trims the new text", () => {
    expect(editNote(base, 1, "  hi  ")[0].text).toBe("hi");
  });

  it("refuses empty text", () => {
    expect(() => editNote(base, 1, "   ")).toThrow("a note needs some text");
    expect(() => editNote(base, 1, "")).toThrow(NotesError);
  });

  it("refuses unknown ids", () => {
    expect(() => editNote(base, 99, "x")).toThrow("no note with id 99");
    expect(() => editNote(base, 99, "x")).toThrow(NotesError);
  });
});

describe("cli edit", () => {
  it("edits a note and keeps its date", () => {
    const file = tmpFile();
    writeFileSync(
      file,
      JSON.stringify([
        { id: 1, text: "a", created: "2026-01-01" },
        { id: 2, text: "b", created: "2026-02-02" },
      ]),
    );
    expect(run(["edit", "2", "new", "text"], file, DAY)).toEqual({ code: 0, out: "Edited note 2." });
    expect(run(["list"], file, DAY).out).toBe("1. a (2026-01-01)\n2. new text (2026-02-02)");
  });

  it("edits a note created today", () => {
    const file = tmpFile();
    run(["add", "a"], file, DAY);
    run(["add", "b"], file, DAY);
    run(["edit", "2", "new", "text"], file, DAY);
    expect(run(["list"], file, DAY).out).toContain("2. new text (2026-11-06)");
  });

  it("fails with code 1 and leaves the file unchanged", () => {
    const file = tmpFile();
    run(["add", "a"], file, DAY);
    const before = readFileSync(file, "utf8");
    for (const args of [["edit", "99", "x"], ["edit", "abc", "x"], ["edit", "1"]]) {
      const res = run(args, file, DAY);
      expect(res.code).toBe(1);
      expect(res.out).toMatch(/^error: /);
      expect(readFileSync(file, "utf8")).toBe(before);
    }
  });

  it("lists edit in the usage", () => {
    expect(run(["fly"], tmpFile(), DAY).out).toContain("notes edit <id> <text>");
  });
});
