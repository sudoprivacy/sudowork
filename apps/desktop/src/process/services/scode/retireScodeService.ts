import { execFile } from 'node:child_process';
import { z } from 'zod';

const ShutdownResponse = z.union([z.object({ id: z.literal(1), result: z.literal(true) }).strict(), z.object({ id: z.literal(1), error: z.object({ code: z.number(), message: z.string() }) }).strict()]);

/** Ask the installed engine to retire its idle service before replacing its binary. */
export async function retireScodeService(executable: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // The engine checks active agents and shared Box ownership. A refusal must
    // abort installation before any existing files or receipts are removed.
    const child = execFile(executable, ['service', 'stdio'], { encoding: 'utf8', windowsHide: true, timeout: 45_000, maxBuffer: 65_536 }, (error, stdout) => {
      if (error) {
        reject(new Error('Unable to retire Sudocode services before upgrading', { cause: error }));
        return;
      }
      let response: z.infer<typeof ShutdownResponse>;
      try {
        response = ShutdownResponse.parse(JSON.parse(stdout.trim()));
      } catch (cause) {
        reject(new Error('Sudocode services could not be retired before upgrading', { cause }));
        return;
      }
      if ('error' in response) reject(new Error(`Sudocode services could not be retired before upgrading: ${response.error.message}`));
      else resolve();
    });
    child.stdin?.on('error', reject);
    // EOF lets the capability adapter exit normally after its one response,
    // releasing its own Windows executable handle as well.
    child.stdin?.end(`${JSON.stringify({ id: 1, method: 'service.shutdown', params: {} })}\n`);
  });
}
