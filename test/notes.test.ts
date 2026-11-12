import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { addNote, deleteNote, formatList, localDate, NotesError, renderHtml, searchNotes, type Note } from "../src/notes.ts";

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

describe("renderHtml", () => {
  const T = "2026-11-21";
  const mk = (id: number, text: string, created: string): Note => ({ id, text, created });
  const pos = (s: string, x: string) => s.indexOf(x);

  it("has the document shell", () => {
    const out = renderHtml([], T);
    for (const s of ["<!doctype html>", '<meta charset="utf-8">', '<meta name="viewport"', "<title>Notes</title>", "Add a note", "notes add &lt;your note&gt;", "Your notes"]) {
      expect(out).toContain(s);
    }
  });

  it("handles an empty list", () => {
    const out = renderHtml([], T);
    expect(out).toContain("No notes yet.");
    expect(out).toContain(">0<");
    for (const g of ["Today", "This week", "Earlier"]) expect(out).not.toContain(`>${g}<`);
  });

  it("groups notes in order and omits empty groups", () => {
    const notes = [mk(1, "n-today", T), mk(2, "n-3", "2026-11-18"), mk(3, "n-6", "2026-11-15"), mk(4, "n-7", "2026-11-14"), mk(5, "n-30", "2026-10-22")];
    const out = renderHtml(notes, T);
    const [a, b, c] = [pos(out, ">Today<"), pos(out, ">This week<"), pos(out, ">Earlier<")];
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(pos(out, "n-today")).toBeLessThan(b);
    expect(pos(out, "n-3")).toBeGreaterThan(b);
    expect(pos(out, "n-6")).toBeLessThan(c);
    expect(pos(out, "n-7")).toBeGreaterThan(c);
    expect(pos(out, "n-30")).toBeGreaterThan(c);
    const only = renderHtml([mk(1, "x", T)], T);
    expect(only).not.toContain(">This week<");
    expect(only).not.toContain(">Earlier<");
  });

  it("sorts newer first, then higher id first", () => {
    const out = renderHtml([mk(1, "old", "2026-11-18"), mk(2, "tieA", "2026-11-19"), mk(3, "tieB", "2026-11-19")], T);
    expect(pos(out, "tieB")).toBeLessThan(pos(out, "tieA"));
    expect(pos(out, "tieA")).toBeLessThan(pos(out, "old"));
  });

  it("shows the total count in the badge", () => {
    expect(renderHtml([mk(1, "a", T), mk(2, "b", "2026-01-01")], T)).toContain(">2<");
  });

  it("formats date lines", () => {
    expect(renderHtml([mk(1, "a", T)], T)).toContain(">Today<");
    expect(renderHtml([mk(1, "a", "2026-11-20")], T)).toContain("Fri 20 Nov · 1 day ago");
    expect(renderHtml([mk(1, "a", "2026-11-18")], T)).toContain("Wed 18 Nov · 3 days ago");
    expect(renderHtml([mk(1, "a", "2025-12-30")], "2026-01-02")).toContain("Tue 30 Dec · 3 days ago");
  });

  it("escapes note text", () => {
    const out = renderHtml([mk(1, `<script>alert("x")</script> & 'q'`, T)], T);
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
    expect(out).not.toContain("<script");
  });

  it("is self-contained", () => {
    const out = renderHtml([mk(1, "a", T)], T);
    for (const s of ["<script", "<link", "http://", "https://"]) expect(out).not.toContain(s);
    for (const s of ["prefers-color-scheme: dark", "#f5f6fa", "#ddd4ee", "#1b2236", "border-radius: 28px"]) expect(out).toContain(s);
  });

  it("is pure", () => {
    const notes = [mk(2, "b", T), mk(1, "a", "2026-11-01")];
    const copy = structuredClone(notes);
    const out = renderHtml(notes, T);
    expect(notes).toEqual(copy);
    expect(renderHtml(notes, T)).toBe(out);
  });
});

describe("cli html", () => {
  it("prints a page relative to the given day", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, "2026-11-05");
    const res = run(["html"], file, DAY);
    expect(res.code).toBe(0);
    expect(res.out.startsWith("<!doctype html>")).toBe(true);
    expect(res.out).toContain("buy milk");
    expect(res.out).toContain("Thu 5 Nov · 1 day ago");
  });

  it("does not create or modify the file", () => {
    const missing = tmpFile();
    expect(run(["html"], missing, DAY).code).toBe(0);
    expect(existsSync(missing)).toBe(false);
    const file = tmpFile();
    run(["add", "x"], file, DAY);
    const before = readFileSync(file);
    run(["html"], file, DAY);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("mentions html in usage", () => {
    const res = run(["fly"], tmpFile(), DAY);
    expect(res.code).toBe(2);
    expect(res.out).toContain("notes html");
  });
});
