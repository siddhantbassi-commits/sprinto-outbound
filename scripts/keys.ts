/**
 * Enter your keys without ever pasting them into a chat or leaving them in your shell history:
 *
 *   npm run keys
 *
 * Secret values are typed with the screen blank, held only long enough to be written to .env.local (readable by you alone,
 * and ignored by git), and never printed. Press Enter to keep what is already there, type a new value to replace it, or
 * "-" to remove it.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { KEY_DEFS, mergeEnv, parseEnv, type KeyDef } from "@/lib/smoke/envfile";

const FILE = process.env.SMOKE_ENV_FILE ?? ".env.local";

if (!process.stdin.isTTY) {
  console.error("This needs a real terminal, so it can hide what you type. Run `npm run keys` in your own terminal window.");
  process.exit(1);
}

/**
 * Reads one line in raw mode. A secret is never echoed; an ordinary value is, so a typo is visible. One reader for both,
 * so there is no second reader (such as readline) competing for the same keystrokes.
 */
function ask(prompt: string, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") return finish(() => reject(new Error("Cancelled. Nothing was saved.")));
        if (ch === "\r" || ch === "\n") return finish(() => resolve(buf));
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0 && !hidden) process.stdout.write("\b \b");
          buf = buf.slice(0, -1);
        } else if (ch >= " ") {
          buf += ch;
          if (!hidden) process.stdout.write(ch);
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const existing = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
  const current = parseEnv(existing);
  const updates: Record<string, string> = {};

  console.log("Sprinto Outbound: keys\nSecrets are hidden as you type. Enter keeps the current value, \"-\" removes it.\n");
  let group = "";
  for (const def of KEY_DEFS) {
    if (def.group !== group) {
      group = def.group;
      console.log(`\n== ${group} ==`);
    }
    const state = (current[def.name] ?? "") !== "" ? "set" : "not set";
    console.log(`\n${def.label} (${def.name}, ${state}${def.optional ? ", optional" : ""})\n  ${def.help}`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hint = def.generate ? " [g to generate]" : "";
      let answer = (await ask(`  value${hint}: `, def.secret)).trim();
      if (answer === "") break;
      if (answer === "-") {
        updates[def.name] = "";
        break;
      }
      if (answer.toLowerCase() === "g" && def.generate) answer = def.generate();
      const problem = (def as KeyDef).validate?.(answer) ?? null;
      if (problem) {
        console.log(`  ✕ ${problem}`);
        continue;
      }
      updates[def.name] = answer;
      console.log(`  ✓ saved (${def.secret ? `${answer.length} characters, not shown` : answer})`);
      break;
    }
  }

  const names = Object.keys(updates);
  if (names.length === 0) return console.log("\nNothing changed.");
  writeFileSync(FILE, mergeEnv(existing, updates), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  console.log(`\nWrote ${names.length} value${names.length === 1 ? "" : "s"} to ${FILE}: ${names.join(", ")}\nThe file is readable by you alone and is ignored by git.\nNext: npm run smoke`);
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : "Stopped."}`);
  process.exit(1);
});
