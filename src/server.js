import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const csvPath = path.join(dataDir, "submissions.csv");
const port = Number(process.env.PORT || 3000);
const adminToken = process.env.ADMIN_TOKEN || "";
const databaseUrl = process.env.DATABASE_URL || "";

const app = express();
let pool = null;
let storageMode = "not initialized";
let storageReadyPromise = null;

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.static(publicDir, { extensions: ["html"] }));

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function submissionFromBody(body) {
  const name = normalize(body.name);
  const email = normalize(body.email).toLowerCase();
  const phone = normalize(body.phone);
  const weddingSoon = normalize(body.weddingSoon);
  const expectations = normalize(body.expectations);
  const website = normalize(body.website);

  if (website) {
    return { spam: true };
  }

  const errors = {};
  if (name.length < 2) errors.name = "Please enter your name.";
  if (!isValidEmail(email)) errors.email = "Please enter a valid email address.";
  if (phone && !/^[+\d][\d\s().-]{5,24}$/.test(phone)) {
    errors.phone = "Please enter a valid phone number or leave it blank.";
  }
  if (!["yes", "no", "not-sure"].includes(weddingSoon)) {
    errors.weddingSoon = "Please choose one option.";
  }
  if (expectations.length < 8) {
    errors.expectations = "Please share a little more detail.";
  }
  if (expectations.length > 2000) {
    errors.expectations = "Please keep your note under 2,000 characters.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    submission: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      name,
      email,
      phone,
      weddingSoon,
      expectations
    }
  };
}

async function initStorage() {
  if (databaseUrl) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: getPgSslConfig(databaseUrl),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000
    });
    try {
      await withTimeout(
        pool.query(`
          create table if not exists suggestions (
            id uuid primary key,
            created_at timestamptz not null,
            name text not null,
            email text not null,
            phone text,
            wedding_soon text not null,
            expectations text not null
          )
        `),
        5000,
        "PostgreSQL initialization timed out"
      );
      storageMode = "PostgreSQL";
      return;
    } catch (error) {
      console.error("PostgreSQL storage failed. Falling back to CSV.", error);
      await pool.end().catch(() => {});
      pool = null;
    }
  }

  await initCsvStorage();
  storageMode = `CSV at ${csvPath}`;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getPgSslConfig(connectionString) {
  const explicit = (process.env.PGSSL || "").toLowerCase();
  if (explicit === "true") return { rejectUnauthorized: false };
  if (explicit === "false") return false;
  return connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false;
}

async function initCsvStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(csvPath);
  } catch {
    await fs.writeFile(
      csvPath,
      "id,created_at,name,email,phone,wedding_soon,expectations\n",
      "utf8"
    );
  }
}

async function ensureStorageReady() {
  if (!storageReadyPromise) {
    storageReadyPromise = initStorage();
  }

  await storageReadyPromise;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsvRow(submission) {
  return [
    submission.id,
    submission.createdAt,
    submission.name,
    submission.email,
    submission.phone,
    submission.weddingSoon,
    submission.expectations
  ].map(csvEscape).join(",");
}

async function saveSubmission(submission) {
  await ensureStorageReady();

  if (pool) {
    await pool.query(
      `insert into suggestions
        (id, created_at, name, email, phone, wedding_soon, expectations)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        submission.id,
        submission.createdAt,
        submission.name,
        submission.email,
        submission.phone || null,
        submission.weddingSoon,
        submission.expectations
      ]
    );
    return;
  }

  await fs.appendFile(csvPath, `${toCsvRow(submission)}\n`, "utf8");
}

function assertAdmin(req, res) {
  if (!adminToken) {
    res.status(404).json({ error: "CSV export is not enabled. Set ADMIN_TOKEN first." });
    return false;
  }

  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = req.query.token || bearer;
  if (token !== adminToken) {
    res.status(401).json({ error: "Unauthorized." });
    return false;
  }

  return true;
}

async function exportCsv() {
  await ensureStorageReady();

  if (!pool) {
    try {
      return await fs.readFile(csvPath, "utf8");
    } catch {
      return "id,created_at,name,email,phone,wedding_soon,expectations\n";
    }
  }

  const { rows } = await pool.query(`
    select id, created_at, name, email, phone, wedding_soon, expectations
    from suggestions
    order by created_at desc
  `);
  const header = "id,created_at,name,email,phone,wedding_soon,expectations";
  const body = rows.map((row) =>
    [
      row.id,
      new Date(row.created_at).toISOString(),
      row.name,
      row.email,
      row.phone,
      row.wedding_soon,
      row.expectations
    ].map(csvEscape).join(",")
  );
  return [header, ...body].join("\n") + "\n";
}

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

app.post("/api/suggestions", async (req, res, next) => {
  try {
    const result = submissionFromBody(req.body);
    if (result.spam) {
      res.json({ ok: true });
      return;
    }
    if (result.errors) {
      res.status(422).json({ ok: false, errors: result.errors });
      return;
    }

    await saveSubmission(result.submission);
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/submissions.csv", async (req, res, next) => {
  try {
    if (!assertAdmin(req, res)) return;
    const csv = await exportCsv();
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=wedsnvows-suggestions.csv");
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
});

app.listen(port, () => {
  console.log(`Weds & Vows listening on port ${port}. Storage: ${storageMode}`);
});
