import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { VisualRegressionError } from "../contracts/error-codes.js";

export const ARCHIVE_LIMITS = {
  compressedBytes: 100 * 1024 * 1024,
  extractedBytes: 500 * 1024 * 1024,
  entryBytes: 100 * 1024 * 1024,
  entries: 50_100,
} as const;

function safeName(name: string): string {
  const normalized = name.normalize("NFC");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\\") ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ||
    normalized.split("/").some((part) => part === ".." || part === ".")
  )
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Unsafe artifact archive path",
    );
  return normalized.replace(/\/$/, "");
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zip) =>
        error || !zip
          ? reject(error ?? new Error("ZIP open failed"))
          : resolve(zip),
    ),
  );
}
function streamEntry(
  zip: ZipFile,
  entry: Entry,
  destination: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, input) => {
      if (error || !input)
        return reject(error ?? new Error("ZIP entry unavailable"));
      const output = createWriteStream(destination, {
        flags: "wx",
        mode: 0o600,
      });
      const fail = (cause: unknown): void => {
        input.destroy();
        output.destroy();
        reject(
          cause instanceof Error ? cause : new Error("Archive stream failed"),
        );
      };
      input.once("error", fail);
      output.once("error", fail);
      output.once("finish", resolve);
      input.pipe(output);
    });
  });
}

/** Extracts a bounded GitHub artifact ZIP without following archive-provided links. */
export async function extractArtifactZip(
  buffer: Buffer,
  destination: string,
): Promise<void> {
  if (buffer.byteLength > ARCHIVE_LIMITS.compressedBytes)
    throw new VisualRegressionError(
      "BASELINE_CORRUPT",
      "Artifact archive exceeds compressed size limit",
    );
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const zip = await openZip(buffer);
  const seen = new Set<string>();
  let count = 0;
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(
        error instanceof Error
          ? error
          : new Error("Artifact extraction failed"),
      );
    };
    zip.once("error", fail);
    zip.once("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        count += 1;
        if (count > ARCHIVE_LIMITS.entries)
          throw new Error("Artifact contains too many entries");
        const name = safeName(entry.fileName);
        const folded = name.toLowerCase();
        if (seen.has(folded))
          throw new Error(
            "Artifact contains duplicate or case-colliding entries",
          );
        seen.add(folded);
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const kind = mode & 0o170000;
        const directory = entry.fileName.endsWith("/");
        if (
          kind !== 0 &&
          kind !== 0o100000 &&
          !(directory && kind === 0o040000)
        )
          throw new Error("Artifact contains a link or special file");
        if (entry.uncompressedSize > ARCHIVE_LIMITS.entryBytes)
          throw new Error("Artifact entry exceeds size limit");
        total += entry.uncompressedSize;
        if (total > ARCHIVE_LIMITS.extractedBytes)
          throw new Error("Artifact exceeds extracted size limit");
        const absolute = path.join(destination, ...name.split("/"));
        if (directory) await mkdir(absolute, { recursive: true, mode: 0o700 });
        else {
          await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
          await streamEntry(zip, entry, absolute);
        }
        zip.readEntry();
      })().catch((error: unknown) =>
        fail(
          new VisualRegressionError(
            "BASELINE_CORRUPT",
            error instanceof Error ? error.message : "Unsafe artifact archive",
          ),
        ),
      );
    });
    zip.readEntry();
  }).catch(async (error: unknown) => {
    await rm(destination, { recursive: true, force: true });
    throw error;
  });
}
