const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// SPRINT 17 - DOCUMENT STORAGE ABSTRACTION
// ------------------------------------------------------------
// One well-defined seam between the CAP service code and wherever
// document bytes live. WHY an abstraction: development and SQLite
// tests run on a local private directory, production (SAP BTP +
// HANA) has no persistent local filesystem - there the env var
// EWMS_DOCUMENT_STORAGE_DIR points to a mounted, private volume
// (or a future Object Store implementation plugs in HERE only).
//
// WHAT IT GUARANTEES
//   * Content-addressed keys: `${hash.slice(0,2)}/${hash}.bin`.
//     The key is pure hex -> path traversal is structurally
//     impossible; readFile additionally re-checks the key shape
//     and that the resolved path stays inside the storage root.
//   * Magic signature sniffing - the stored mimeType ALWAYS comes
//     from the bytes, never from the client ("attachment.pdf"
//     containing a shell script can pass the check only as its
//     real type - which the allowlist then rejects).
//   * No execution: files are stored with a fixed `.bin` suffix in
//     a non-served directory; nothing ever passes them to a
//     runtime. (Documented limitation: no malware scanning exists
//     in this environment - see SPRINT-17.md.)
//   * Identical files hash to identical keys -> safe retries never
//     duplicate bytes on disk.
// ============================================================

// Exact list of accepted content types (Sprint 17 policy; the
// requirement file documents how to extend it).
const ALLOWED_CONTENT_TYPES = {
  "application/pdf": { magic: (b) => b.subarray(0, 4).toString("latin1") === "%PDF" },
  "image/png":       { magic: (b) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" },
  "image/jpeg":      { magic: (b) => b.subarray(0, 3).toString("hex") === "ffd8ff" },
};

// Hard limit. The existing B3 rule (10 MB, enforced since the first
// document handler) stays; it is a constant until ops asks for
// per-document-type configuration.
const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Storage root. Development default: `<project>/document-store/`
 * - created on demand - keyed in .gitignore so no document ever
 * enters version control. Production: set EWMS_DOCUMENT_STORAGE_DIR
 * to a private persisted volume.
 */
function storageRoot() {
  const dir =
    process.env.EWMS_DOCUMENT_STORAGE_DIR ||
    path.join(process.cwd(), "document-store");
  return path.resolve(dir);
}

/** True when the buffer's magic signature belongs to an allowed type. */
function sniffContentType(buffer) {
  for (const [type, spec] of Object.entries(ALLOWED_CONTENT_TYPES)) {
    if (spec.magic(buffer)) return type;
  }
  return null;
}

/**
 * Normalize a client-supplied filename:
 *  - drop every path component (no directories, no traversal),
 *  - keep only [A-Za-z0-9 ._-], collapse repeats,
 *  - cap length.
 * The result is DISPLAY metadata only - never used to locate bytes.
 */
function sanitizeFileName(raw) {
  let name = String(raw || "");
  name = name.split(/[/\\]/).pop(); // drop directories: no traversal
  name = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  name = name.replace(/^[._]+/, "").slice(0, 200);
  return name || "document.bin";
}

/**
 * Validate + persist an upload. Throws (Error with .status) on any
 * violation so the caller's 400/413 response carries the reason.
 *
 * @param {Buffer} buffer   decoded file bytes
 * @param {string} fileName client-declared name (untrusted)
 * @param {number?} declaredSize client-declared size (untrusted)
 * @returns {{ key, fileName, mimeType, fileSize, sha256 }}
 */
function saveFile(buffer, fileName, declaredSize) {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer || "");
  if (!buf.length) {
    const e = new Error("Empty document content is not allowed.");
    e.status = 400;
    throw e;
  }
  if (buf.length > MAX_DOCUMENT_FILE_SIZE) {
    const e = new Error(
      `Document content exceeds the ${MAX_DOCUMENT_FILE_SIZE / (1024 * 1024)} MB limit.`,
    );
    e.status = 413;
    throw e;
  }

  const sniffed = sniffContentType(buf);
  if (!sniffed) {
    const e = new Error(
      "Document content type is not allowed (allowed: application/pdf, image/png, image/jpeg).",
    );
    e.status = 400;
    throw e;
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  // Content-addressed key: hex-only segments make traversal
  // impossible and give the retry/dedupe property for free.
  const key = `${sha256.slice(0, 2)}/${sha256}.bin`;

  const dir = storageRoot();
  const abs = path.join(dir, key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, buf); // same-bytes retry is a no-op
  }

  return {
    key,
    fileName: sanitizeFileName(fileName),
    mimeType: sniffed, // the CLIENT mimeType is ignored by design
    fileSize: buf.length > (declaredSize ?? buf.length) ? Math.max(buf.length, declaredSize ?? buf.length) : buf.length,
    sha256,
  };
}

/**
 * Read stored bytes by key. The key regex + resolved-path check
 * make any traversal attempt (../../etc/passwd, absolute paths)
 * fail closed before ever touching the disk.
 */
function readFile(key) {
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.bin$/.test(String(key || ""))) {
    const e = new Error("Invalid storage key.");
    e.status = 400;
    throw e;
  }
  const abs = path.join(storageRoot(), key);
  if (!abs.startsWith(storageRoot() + path.sep)) {
    const e = new Error("Invalid storage key.");
    e.status = 400;
    throw e;
  }
  if (!fs.existsSync(abs)) {
    const e = new Error("Stored document file is missing (storage error).");
    e.status = 404;
    throw e;
  }
  return fs.readFileSync(abs);
}

/** True when the environment is NOT configured with a private dir
 *  (i.e. running on the development default). Used by the docs to
 *  explain what production must change. */
function isDevelopmentDefaultDir() {
  return !process.env.EWMS_DOCUMENT_STORAGE_DIR;
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  MAX_DOCUMENT_FILE_SIZE,
  storageRoot,
  sniffContentType,
  sanitizeFileName,
  saveFile,
  readFile,
  isDevelopmentDefaultDir,
};
