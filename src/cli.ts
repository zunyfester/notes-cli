// notes add [--tag <t>]... <text> | notes list [--tag <t>] | notes search <text> | notes delete <id>. Run with: node src/cli.ts <command>
import { addNote, deleteNote, filterByTag, formatList, loadNotes, localDate, NotesError, parseTagArgs, saveNotes, searchNotes, type Note } from "./notes.ts";

export interface Result {
  code: number;
  out: string;
}

const USAGE = "usage: notes add [--tag <t>]... <text> | notes list [--tag <t>] | notes search <text> | notes delete <id>";

function listOut(notes: Note[], tags: string[]): string {
  if (tags.length === 0) return formatList(notes);
  const found = filterByTag(notes, tags[0]);
  return found.length === 0 ? "No matching notes." : formatList(found);
}

export function run(argv: string[], file: string, today: string): Result {
  const [command, ...rest] = argv;
  try {
    const notes = loadNotes(file);
    if (command === "add") {
      const { tags, rest: words } = parseTagArgs(rest);
      const next = addNote(notes, words.join(" "), today, tags);
      saveNotes(file, next);
      return { code: 0, out: `Added note ${next[next.length - 1].id}.` };
    }
    if (command === "list") return { code: 0, out: listOut(notes, parseTagArgs(rest).tags) };
    if (command === "search") {
      const found = searchNotes(notes, rest.join(" "));
      return { code: 0, out: found.length === 0 ? "No matching notes." : formatList(found) };
    }
    if (command === "delete") {
      saveNotes(file, deleteNote(notes, Number(rest[0])));
      return { code: 0, out: `Deleted note ${rest[0]}.` };
    }
    return { code: 2, out: USAGE };
  } catch (err) {
    if (err instanceof NotesError || err instanceof SyntaxError) return { code: 1, out: `error: ${err.message}` };
    throw err;
  }
}

if (import.meta.main) {
  const result = run(process.argv.slice(2), process.env.NOTES_FILE ?? "notes.json", localDate(new Date()));
  console.log(result.out);
  process.exitCode = result.code;
}
