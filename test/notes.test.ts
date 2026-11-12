import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { addNote, deleteNote, filterByTag, formatList, localDate, NotesError, parseTagArgs, searchNotes, type Note } from "../src/notes.ts";

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

describe("tags", () => {
  const tagged = addNote(addNote(addNote([], "buy milk", DAY, ["home", "urgent"]), "call Bob", DAY), "gym", DAY, ["Home"]);

  it("parseTagArgs collects tags and keeps the other words", () => {
    expect(parseTagArgs(["--tag", "a", "buy", "--tag", " B ", "milk"])).toEqual({ tags: ["a", "b"], rest: ["buy", "milk"] });
    expect(parseTagArgs(["buy", "milk"])).toEqual({ tags: [], rest: ["buy", "milk"] });
  });

  it("parseTagArgs refuses a missing or empty value", () => {
    expect(() => parseTagArgs(["x", "--tag"])).toThrow(NotesError);
    expect(() => parseTagArgs(["--tag", "  ", "x"])).toThrow(NotesError);
  });

  it("addNote stores tags, dedupes and omits the key without tags", () => {
    expect(addNote([], "a", DAY, ["x", "X", " y "])[0].tags).toEqual(["x", "y"]);
    expect(addNote([], "a", DAY)).toEqual([{ id: 1, text: "a", created: DAY }]);
    expect(addNote([], "a", DAY, [])[0]).not.toHaveProperty("tags");
  });

  it("addNote does not mutate its input", () => {
    const before: Note[] = [];
    addNote(before, "a", DAY, ["x"]);
    expect(before).toEqual([]);
  });

  it("filterByTag matches case-insensitively and ignores untagged notes", () => {
    expect(filterByTag(tagged, "HOME").map((n) => n.id)).toEqual([1, 3]);
    expect(filterByTag(tagged, "nope")).toEqual([]);
  });

  it("formatList shows tags", () => {
    expect(formatList(tagged)).toBe(
      "1. buy milk (2026-11-06) [home, urgent]\n2. call Bob (2026-11-06)\n3. gym (2026-11-06) [home]",
    );
  });
});

describe("cli tags", () => {
  it("adds tags before or after the text", () => {
    const file = tmpFile();
    expect(run(["add", "--tag", "work", "--tag", "urgent", "text"], file, DAY)).toEqual({ code: 0, out: "Added note 1." });
    expect(run(["add", "other", "--tag", "x"], file, DAY).code).toBe(0);
    expect(run(["list"], file, DAY).out).toBe("1. text (2026-11-06) [work, urgent]\n2. other (2026-11-06) [x]");
  });

  it("lists only notes with the tag, keeping ids", () => {
    const file = tmpFile();
    run(["add", "a"], file, DAY);
    run(["add", "--tag", "work", "b"], file, DAY);
    expect(run(["list", "--tag", "work"], file, DAY)).toEqual({ code: 0, out: "2. b (2026-11-06) [work]" });
  });

  it("reports no match with code 0", () => {
    const file = tmpFile();
    run(["add", "a"], file, DAY);
    expect(run(["list", "--tag", "nope"], file, DAY)).toEqual({ code: 0, out: "No matching notes." });
  });

  it("errors on a missing tag value or missing text", () => {
    const res = run(["list", "--tag"], tmpFile(), DAY);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/^error: /);
    expect(run(["add", "--tag", "x"], tmpFile(), DAY).code).toBe(1);
  });

  it("list --tag does not write the file", () => {
    const file = tmpFile();
    run(["list", "--tag", "x"], file, DAY);
    expect(existsSync(file)).toBe(false);
  });

  it("handles old notes without tags", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify([{ id: 1, text: "old", created: DAY }]));
    expect(run(["list"], file, DAY).out).toBe("1. old (2026-11-06)");
    expect(run(["list", "--tag", "x"], file, DAY).out).toBe("No matching notes.");
  });

  it("prints the new usage for unknown commands", () => {
    expect(run(["fly"], tmpFile(), DAY).out).toContain("notes add [--tag <t>]... <text> | notes list [--tag <t>]");
  });
});
