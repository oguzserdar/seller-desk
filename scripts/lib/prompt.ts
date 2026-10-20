import { createInterface } from "node:readline/promises";

/** Asks a visible question on the terminal. */
export async function ask(question: string, fallback = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/** Reads a secret without echoing it. Never accepts it from argv or logs it. */
export async function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("A hidden prompt needs a terminal. Use --password-stdin to pipe the password instead.");
  stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

/** Reads all of stdin (for --password-stdin), trimming one trailing newline. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
