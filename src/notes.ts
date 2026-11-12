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

const STYLE = `
body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; background: #f5f5f7; color: #1d1d1f; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); padding: 1rem 1.25rem; margin: 1rem 0; }
.card p { margin: 0 0 0.5rem; }
.meta { font-size: 0.85rem; color: #6e6e73; }
.empty { color: #6e6e73; }
@media (prefers-color-scheme: dark) {
  body { background: #1c1c1e; color: #f5f5f7; }
  .card { background: #2c2c2e; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); }
  .meta, .empty { color: #a1a1a6; }
}
`;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

function renderCard(n: Note): string {
  return `<article class="card"><p>${escapeHtml(n.text)}</p><div class="meta">#${escapeHtml(n.id)} · <time>${escapeHtml(n.created)}</time></div></article>`;
}

export function renderHtml(notes: Note[]): string {
  const body = notes.length === 0 ? '<p class="empty">No notes yet.</p>' : notes.map(renderCard).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Notas</title>",
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

export function formatList(notes: Note[]): string {
  if (notes.length === 0) return "No notes yet.";
  return notes.map((n) => `${n.id}. ${n.text} (${n.created})`).join("\n");
}
