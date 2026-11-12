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
  const today = "2026-11-24";
  const mk = (id: number, text: string, created: string): Note => ({ id, text, created });
  const sample = [
    mk(1, "oldie", "2026-11-17"),
    mk(2, "week6", "2026-11-18"),
    mk(3, "yesterday", "2026-11-23"),
    mk(4, "nowish", "2026-11-24"),
    mk(5, "future", "2026-11-30"),
  ];
  const count = (s: string, sub: string) => s.split(sub).length - 1;

  it("is a full document", () => {
    const out = renderHtml([], today);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(out).toContain("<title>Notes</title>");
  });

  it("has the exact CSS and the static card", () => {
    const out = renderHtml([], today);
    expect(out).toContain(".card { background: #ffffff;");
    expect(out).toContain(".panel { background: #ddd4ee;");
    expect(out).toContain(".dot { flex: none; width: 40px; height: 40px; border-radius: 50%; background: #ffffff; }");
    expect(out).toContain(".plus {");
    expect(out).toContain("background: #1b2236;");
    expect(out).toContain("<h2>Add a note</h2>");
    expect(out).toContain('<div class="input">notes add &lt;your note&gt;</div>');
  });

  it("renders one note block per note", () => {
    const out = renderHtml(sample, today);
    expect(count(out, '<div class="note"><span class="dot"></span>')).toBe(5);
    expect(count(out, 'class="note"')).toBe(5);
  });

  it("groups by age in order", () => {
    const out = renderHtml(sample, today);
    const t = out.indexOf('<div class="group">Today</div>');
    const w = out.indexOf('<div class="group">This week</div>');
    const e = out.indexOf('<div class="group">Earlier</div>');
    expect(t).toBeGreaterThan(-1);
    expect(w).toBeGreaterThan(t);
    expect(e).toBeGreaterThan(w);
    expect(out.indexOf(">future<")).toBeLessThan(w);
    expect(out.indexOf(">nowish<")).toBeLessThan(w);
    expect(out.indexOf(">yesterday<")).toBeGreaterThan(w);
    expect(out.indexOf(">week6<")).toBeGreaterThan(w);
    expect(out.indexOf(">week6<")).toBeLessThan(e);
    expect(out.indexOf(">oldie<")).toBeGreaterThan(e);
  });

  it("omits empty groups", () => {
    const out = renderHtml([mk(1, "old", "2026-01-01")], today);
    expect(out).not.toContain('<div class="group">Today</div>');
    expect(out).not.toContain('<div class="group">This week</div>');
    expect(out).toContain('<div class="group">Earlier</div>');
  });

  it("sorts newest first, higher id first on ties, without mutating", () => {
    const input = [mk(1, "aaa", "2026-11-20"), mk(2, "bbb", "2026-11-22"), mk(3, "ccc", "2026-11-20")];
    const copy = structuredClone(input);
    const out = renderHtml(input, today);
    expect(out.indexOf(">bbb<")).toBeLessThan(out.indexOf(">ccc<"));
    expect(out.indexOf(">ccc<")).toBeLessThan(out.indexOf(">aaa<"));
    expect(input).toEqual(copy);
  });

  it("writes the date line", () => {
    const out = renderHtml([mk(1, "a", "2026-11-24"), mk(2, "b", "2026-11-23"), mk(3, "c", "2026-11-21")], today);
    expect(out).toContain('<span class="date">Today</span>');
    expect(out).toContain('<span class="date">Mon 23 Nov · 1 day ago</span>');
    expect(out).toContain('<span class="date">Sat 21 Nov · 3 days ago</span>');
  });

  it("shows the badge count", () => {
    expect(renderHtml(sample.slice(0, 3), today)).toContain('<span class="badge">3</span>');
  });

  it("handles no notes", () => {
    const out = renderHtml([], today);
    expect(out).toContain('<p class="empty">No notes yet.</p>');
    expect(out).toContain('<span class="badge">0</span>');
    expect(out).not.toContain('class="note"');
    expect(out).not.toContain('class="group"');
  });

  it("escapes text and stays self-contained", () => {
    const evil = mk(2, "<script>x</script> <link", today);
    const out = renderHtml([mk(1, "<b>&\"'", today), evil], today);
    expect(out).toContain("&lt;b&gt;&amp;&quot;&#39;");
    expect(out).not.toContain("<b>");
    for (const bad of ["<script", "<link", "http://", "https://"]) expect(out).not.toContain(bad);
  });
});

describe("cli html", () => {
  it("prints the page using today", () => {
    const file = tmpFile();
    run(["add", "buy", "milk"], file, DAY);
    const res = run(["html"], file, DAY);
    expect(res.code).toBe(0);
    expect(res.out).toContain("<!doctype html>");
    expect(res.out).toContain("buy milk");
    expect(res.out).toContain('<div class="group">Today</div>');
  });

  it("never writes", () => {
    const missing = tmpFile();
    expect(run(["html"], missing, DAY).code).toBe(0);
    expect(existsSync(missing)).toBe(false);
    const file = tmpFile();
    run(["add", "x"], file, DAY);
    const before = readFileSync(file, "utf8");
    run(["html"], file, DAY);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("lists html in usage", () => {
    expect(run(["fly"], tmpFile(), DAY).out).toContain("notes html");
  });
});
