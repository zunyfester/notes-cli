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
  const two = addNote(addNote([], "first note", DAY), "second note", DAY);

  it("is a complete page", () => {
    const html = renderHtml(two);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("<title>Notas</title>");
  });

  it("renders each note in order with id and date", () => {
    const html = renderHtml(two);
    expect(html).toContain("#1");
    expect(html).toContain("#2");
    expect(html).toContain(DAY);
    expect(html.indexOf("first note")).toBeGreaterThan(-1);
    expect(html.indexOf("first note")).toBeLessThan(html.indexOf("second note"));
    expect(html.match(/<article class="card">/g)).toHaveLength(2);
  });

  it("shows an empty state without cards", () => {
    const html = renderHtml([]);
    expect(html).toContain("No notes yet.");
    expect(html).not.toContain("<article");
  });

  it("escapes note text", () => {
    const html = renderHtml(addNote([], `<script>alert("x") & 'y'</script>`, DAY));
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).not.toContain("<script");
  });

  it("is self-contained with dark mode styles", () => {
    const html = renderHtml(two);
    expect(html).toContain("<style>");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("<link");
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(two);
    renderHtml(two);
    expect(two).toEqual(copy);
  });
});

describe("cli html", () => {
  it("prints the page with the notes", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, DAY);
    const res = run(["html"], file, DAY);
    expect(res.code).toBe(0);
    expect(res.out.startsWith("<!doctype html>")).toBe(true);
    expect(res.out).toContain("buy milk");
  });

  it("does not create a missing file", () => {
    const file = tmpFile();
    const res = run(["html"], file, DAY);
    expect(res.code).toBe(0);
    expect(res.out).toContain("No notes yet.");
    expect(existsSync(file)).toBe(false);
  });

  it("leaves an existing file unchanged", () => {
    const file = tmpFile();
    run(["add", "x"], file, DAY);
    const before = readFileSync(file, "utf8");
    run(["html"], file, DAY);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("lists html in the usage", () => {
    const res = run(["fly"], tmpFile(), DAY);
    expect(res.code).toBe(2);
    expect(res.out).toContain("notes html");
  });
});
