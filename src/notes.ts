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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 32px 16px; font-family: system-ui, sans-serif; background: #f5f6fa; color: #1b2236; }
.panel { max-width: 520px; margin: 0 auto; padding: 24px; background: #f3f4f8; border-radius: 28px; }
.head { display: flex; align-items: center; justify-content: space-between; }
.title { font-size: 22px; font-weight: 600; margin: 0; }
.badge { background: #ddd4ee; border-radius: 999px; padding: 4px 12px; font-size: 14px; }
.add { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
.plus { width: 40px; height: 40px; border-radius: 50%; background: #ddd4ee; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.pill { flex: 1; padding: 10px 16px; border-radius: 999px; background: #ddd4ee; color: #6b6f80; }
.group { margin: 20px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b6f80; }
.card { background: #f5f6fa; border-radius: 28px; padding: 16px 20px; margin-bottom: 10px; }
.text { margin: 0 0 6px; }
.date { font-size: 13px; color: #6b6f80; }
.empty { color: #6b6f80; }
@media (prefers-color-scheme: dark) {
  body { background: #12141c; color: #eceef5; }
  .panel { background: #1d2030; }
  .badge, .plus, .pill { background: #3a3550; color: #eceef5; }
  .card { background: #2f2a45; }
  .group, .date, .empty { color: #ddd4ee; }
}
`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function utcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(today: string, created: string): number {
  return Math.round((utcMs(today) - utcMs(created)) / 86400000);
}

function dateLine(created: string, ago: number): string {
  if (ago <= 0) return "Today";
  const d = new Date(utcMs(created));
  const label = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${label} · ${ago} ${ago === 1 ? "day" : "days"} ago`;
}

function renderNote(n: Note, today: string): string {
  const line = dateLine(n.created, daysBetween(today, n.created));
  return `<div class="card"><p class="text">${escapeHtml(n.text)}</p><span class="date">${line}</span></div>`;
}

function renderGroup(label: string, items: Note[], today: string): string {
  if (items.length === 0) return "";
  const sorted = [...items].sort((a, b) => b.created.localeCompare(a.created) || b.id - a.id);
  return `<div class="group">${label}</div>\n${sorted.map((n) => renderNote(n, today)).join("\n")}`;
}

function groupNotes(notes: Note[], today: string): Note[][] {
  const groups: Note[][] = [[], [], []];
  for (const n of notes) {
    const ago = daysBetween(today, n.created);
    groups[ago <= 0 ? 0 : ago < 7 ? 1 : 2].push(n);
  }
  return groups;
}

export function renderHtml(notes: Note[], today: string): string {
  const [now, week, earlier] = groupNotes(notes, today);
  const body =
    notes.length === 0
      ? `<p class="empty">No notes yet.</p>`
      : [renderGroup("Today", now, today), renderGroup("This week", week, today), renderGroup("Earlier", earlier, today)]
          .filter(Boolean)
          .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes</title>
<style>${CSS}</style>
</head>
<body>
<div class="panel">
<div class="head"><h1 class="title">Your notes</h1><span class="badge">${notes.length}</span></div>
<div class="add"><div class="plus">+</div><div class="pill">Add a note: notes add &lt;your note&gt;</div></div>
${body}
</div>
</body>
</html>
`;
}
