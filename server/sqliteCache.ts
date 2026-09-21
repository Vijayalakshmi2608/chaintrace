import { execFile } from "node:child_process";
import { promisify } from "node:util";

type CacheRecord = {
  id: string;
  title: string;
  source: string;
  sourceType: string;
  date: string;
  snippet: string;
  status: string;
  url: string;
};

const execFileAsync = promisify(execFile);

export async function persistEvidence(query: string, records: CacheRecord[]) {
  if (records.length === 0) return;
  const input = JSON.stringify({ query, records });
  try {
    await execFileAsync("python3", ["backend/cache.py", input], { cwd: process.cwd(), maxBuffer: 1_000_000 });
  } catch (error) {
    console.warn("[SQLite] Python cache bridge unavailable:", error instanceof Error ? error.message : error);
  }
}
