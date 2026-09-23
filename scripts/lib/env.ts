// Loads .env for local runs; in CI the variables come from secrets instead.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}
