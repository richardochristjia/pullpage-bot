import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRunId } from "./approve";

export const WORK_FILE = /^(card[0-2]\.(clean2?\.)?png|(binder|toploader)\.(canvas|bg2?)\.png)$/;

// Validate both id and name before path.join; null means 404.
export async function readWorkFile(root: string, id: string, file: string): Promise<Buffer | null> {
  if (!isRunId(id) || !WORK_FILE.test(file)) return null;
  try {
    return await readFile(path.join(root, ".work", id, file));
  } catch {
    return null;
  }
}
