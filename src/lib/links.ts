export function parseFrameLink(url: string, fileKey = process.env.FIGMA_FILE_KEY) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("Not a link.");
  }
  if (u.hostname !== "figma.com" && u.hostname !== "www.figma.com") throw new Error("Not a Figma link.");
  const m = u.pathname.match(/^\/(?:design|file)\/([^/]+)(?:\/branch\/([^/]+))?/);
  const key = m && (m[2] ?? m[1]);
  if (!key) throw new Error("Not a Figma file link.");
  if (!fileKey) throw new Error("FIGMA_FILE_KEY is not set.");
  if (key !== fileKey) throw new Error("Not the configured Figma file.");
  const id = u.searchParams.get("node-id") ?? "";
  if (!/^\d+[-:]\d+$/.test(id)) throw new Error("Link has no frame node-id.");
  return { fileKey: key, nodeId: id.replace("-", ":") };
}
