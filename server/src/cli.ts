import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { CONFIG_PATH, hashPassword, updateStoredConfig } from './config.ts';

/**
 * npm run set-password            prompts for a password (input hidden)
 * npm run set-password -- --random  generates one and prints it once
 */
async function setPassword(args: string[]) {
  let password: string;
  if (args.includes('--random')) {
    password = randomBytes(12).toString('base64url');
    console.log(`New password: ${password}`);
  } else {
    password = await promptHidden('New password: ');
    const again = await promptHidden('Again: ');
    if (password !== again) throw new Error("Passwords don't match.");
  }
  if (password.length < 8) throw new Error('Use at least 8 characters.');
  updateStoredConfig({ passwordHash: hashPassword(password) });
  console.log(`Saved to ${CONFIG_PATH}. Restart colima-dashboard for it to take effect.`);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'set-password') {
  setPassword(rest).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  console.error('Usage: node server/src/cli.ts set-password [--random]');
  process.exit(1);
}
