import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function assertInteractiveTerminal(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Интерактивный ввод доступен только в терминале (TTY). Для dry-run используйте --dry-run.",
    );
  }
}

export async function promptLine(message: string): Promise<string> {
  assertInteractiveTerminal();
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

export async function promptYesNo(message: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]: " : " [y/N]: ";
  const answer = (await promptLine(`${message}${suffix}`)).toLowerCase();

  if (!answer) {
    return defaultYes;
  }

  return answer === "y" || answer === "yes" || answer === "д" || answer === "да";
}

/**
 * Скрытый ввод пароля через raw mode (без echo). Работает в Windows и Unix TTY.
 */
export async function promptHidden(message: string): Promise<string> {
  assertInteractiveTerminal();

  process.stdout.write(message);

  return new Promise((resolve, reject) => {
    const stdin = input;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        switch (char) {
          case "\n":
          case "\r":
          case "\u0004":
            cleanup();
            resolve(password);
            return;
          case "\u0003":
            cleanup();
            reject(new Error("Отменено пользователем (Ctrl+C)."));
            return;
          case "\u007f":
          case "\b":
            password = password.slice(0, -1);
            break;
          default:
            if (char >= " " && char <= "~") {
              password += char;
            }
            break;
        }
      }
    };

    stdin.on("data", onData);
  });
}
