// Notes kept in a JSON file. Pure functions take and return note lists; only load/save touch disk.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Note {
  id: number;
  text: string;
  created: string; // ISO date, YYYY-MM-DD
}

export class NotesError extends Error {}

export function loadNotes(file: string): Note[] {
  if (!existsSync(file)) return [];
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new NotesError(`${file} does not hold a list of notes`);
  return data as Note[];
}

export function saveNotes(file: string, notes: Note[]): void {
  writeFileSync(file, JSON.stringify(notes, null, 2) + "\n");
}

export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addNote(notes: Note[], text: string, today: string): Note[] {
  const clean = text.trim();
  if (!clean) throw new NotesError("a note needs some text");
  const id = notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
  return [...notes, { id, text: clean, created: today }];
}

export function deleteNote(notes: Note[], id: number): Note[] {
  if (!notes.some((n) => n.id === id)) throw new NotesError(`no note with id ${id}`);
  return notes.filter((n) => n.id !== id);
}

export function searchNotes(notes: Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new NotesError("search needs some text");
  return notes.filter((n) => n.text.toLowerCase().includes(needle));
}

export function formatList(notes: Note[]): string {
  if (notes.length === 0) return "No notes yet.";
  return notes.map((n) => `${n.id}. ${n.text} (${n.created})`).join("\n");
}

const CSS = [
  ":root { color-scheme: light dark; }",
  'body { margin: 0; padding: 40px 16px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f5f6fa; color: #1b2236; }',
  ".wrap { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }",
  ".card { background: #ffffff; border-radius: 28px; padding: 28px 32px; }",
  "h2 { margin: 0 0 16px; font-size: 24px; font-weight: 600; }",
  ".input { background: #f3f4f8; border-radius: 999px; padding: 16px 24px; color: #8a8ea0; font-size: 17px; }",
  ".plus { margin-top: 16px; width: 56px; height: 56px; border-radius: 50%; background: #1b2236; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 28px; }",
  ".panel { background: #ddd4ee; border-radius: 28px; padding: 28px 32px; }",
  ".head { display: flex; justify-content: space-between; align-items: center; }",
  ".head h2 { margin: 0; }",
  ".badge { background: #ffffff; border-radius: 999px; min-width: 40px; height: 40px; padding: 0 12px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 500; }",
  ".group { margin: 20px 0 4px; font-size: 15px; font-weight: 600; color: #6b6f80; }",
  ".note { display: flex; align-items: center; gap: 20px; padding: 10px 0; }",
  ".dot { flex: none; width: 40px; height: 40px; border-radius: 50%; background: #ffffff; }",
  ".text { margin: 0; font-size: 20px; line-height: 1.3; }",
  ".date { font-size: 15px; color: #6b6f80; }",
  ".empty { margin: 8px 0 0; color: #6b6f80; }",
  "@media (prefers-color-scheme: dark) {",
  "  body { background: #12141c; color: #eceef5; }",
  "  .card { background: #1d2030; }",
  "  .input { background: #262a3c; color: #9a9eb0; }",
  "  .plus { background: #eceef5; color: #12141c; }",
  "  .panel { background: #2f2a45; }",
  "  .badge, .dot { background: #3a3550; }",
  "  .group, .date, .empty { color: #a8acbd; }",
  "}",
].join("\n");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function utc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysAgo(created: string, today: string): number {
  return Math.round((utc(today) - utc(created)) / 86_400_000);
}

function dateLabel(created: string, ago: number): string {
  if (ago <= 0) return "Today";
  const d = new Date(utc(created));
  const when = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${when} · ${ago} ${ago === 1 ? "day" : "days"} ago`;
}

function groupOf(ago: number): string {
  if (ago <= 0) return "Today";
  return ago < 7 ? "This week" : "Earlier";
}

function renderNote(n: Note, today: string): string {
  const label = dateLabel(n.created, daysAgo(n.created, today));
  return (
    `<div class="note"><span class="dot"></span><div><p class="text">${escapeHtml(n.text)}</p>` +
    `<span class="date">${label}</span></div></div>`
  );
}

function renderGroups(notes: Note[], today: string): string[] {
  if (notes.length === 0) return ['<p class="empty">No notes yet.</p>'];
  const sorted = [...notes].sort((a, b) => b.created.localeCompare(a.created) || b.id - a.id);
  const out: string[] = [];
  for (const name of ["Today", "This week", "Earlier"]) {
    const inGroup = sorted.filter((n) => groupOf(daysAgo(n.created, today)) === name);
    if (inGroup.length === 0) continue;
    out.push(`<div class="group">${name}</div>`, ...inGroup.map((n) => renderNote(n, today)));
  }
  return out;
}

export function renderHtml(notes: Note[], today: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Notes</title>",
    `<style>\n${CSS}\n</style>`,
    "</head>",
    "<body>",
    '<main class="wrap">',
    '<section class="card"><h2>Add a note</h2><div class="input">notes add &lt;your note&gt;</div><div class="plus">+</div></section>',
    '<section class="panel">',
    `<div class="head"><h2>Your notes</h2><span class="badge">${notes.length}</span></div>`,
    ...renderGroups(notes, today),
    "</section>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}
