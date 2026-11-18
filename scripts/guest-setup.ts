/**
 * Switches the guest pass on for the real app, without the guest password ever being shown, pasted into a chat or left in your shell
 * history:
 *
 *   npm run guest
 *
 * Before you run it, create the guest account in Supabase (Authentication, Users, Add user, with "Auto confirm" ticked) and make it an
 * admin with the one SQL line this script prints. Then this script asks for the account's email and password (the password is typed
 * with the screen blank) and stores GUEST_PASS, GUEST_EMAIL and GUEST_PASSWORD on the Vercel project. It prints names only.
 */
import { spawnSync } from "node:child_process";
import { promoteSql } from "@/lib/app/guest";

if (!process.stdin.isTTY) {
  console.error("This needs a real terminal, so it can hide what you type. Run `npm run guest` in your own terminal window.");
  process.exit(1);
}

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

function setOnVercel(name: string, value: string): boolean {
  // The value goes in on standard input, so it is never on a command line or in the output.
  const r = spawnSync("npx", ["vercel", "env", "add", name, "production", "--force"], { input: value, encoding: "utf8" });
  return r.status === 0;
}

async function main() {
  console.log("Guest pass setup\n");
  const email = (await ask("Guest account email: ", false)).trim();
  const sql = promoteSql(email);
  if (!sql) {
    console.error("That does not look like a plain email address. Nothing was saved.");
    process.exit(1);
  }
  console.log("\nIf you have not yet, run this once in the Supabase SQL editor so the guest can do what an admin does:\n\n  " + sql + "\n");
  const password = await ask("Guest account password (hidden): ", true);
  const again = await ask("Type it again (hidden): ", true);
  if (password.length < 12 || password !== again) {
    console.error("The passwords differ, or are shorter than 12 characters. Nothing was saved.");
    process.exit(1);
  }
  const results: [string, boolean][] = [
    ["GUEST_PASS", setOnVercel("GUEST_PASS", "1")],
    ["GUEST_EMAIL", setOnVercel("GUEST_EMAIL", email)],
    ["GUEST_PASSWORD", setOnVercel("GUEST_PASSWORD", password)],
  ];
  for (const [name, ok] of results) console.log(`${ok ? "saved " : "FAILED"}  ${name}`);
  if (results.some(([, ok]) => !ok)) {
    console.error("\nSomething did not save. Check that you are signed in to Vercel (`npx vercel whoami`) and try again.");
    process.exit(1);
  }
  console.log("\nDone. The guest pass switches on at the next deploy.");
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
