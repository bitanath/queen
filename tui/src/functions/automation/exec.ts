export type ExecResult = { stdout: string; stderr: string; code: number };

export async function exec(cmd: readonly string[]): Promise<ExecResult> {
  const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), code };
}

export async function execOrThrow(cmd: readonly string[], label: string): Promise<string> {
  const { stdout, stderr, code } = await exec(cmd);
  if (code !== 0) throw new Error(`${label} failed: ${stderr || stdout || `exit ${code}`}`);
  return stdout.length > 0 ? stdout : "ok";
}

export async function execStdin(cmd: readonly string[], input: string): Promise<ExecResult> {
  const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", stdin: "pipe" }); //NOTE this is for something like queen <do this> or queen "do this"
  proc.stdin.write(input);
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }; 
}

function arg(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
}

export function str(input: Record<string, unknown>, key: string, required = true): string {
  const value = arg(input, key);
  if (required && value.length === 0) throw new Error(`Missing '${key}'.`);
  return value;
}

export function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const value = arg(input, key);
  return value.length > 0 ? value : undefined;
}
