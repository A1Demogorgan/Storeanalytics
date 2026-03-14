import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export type ColumnSchema = {
  name: string;
  type: string;
};

export type TableSchema = {
  name: string;
  columns: ColumnSchema[];
};

type DatabaseState = {
  db: InstanceType<typeof DatabaseSync>;
  tables: TableSchema[];
  locations: string[];
  initialized: boolean;
  initPromise?: Promise<void>;
  initStatus: {
    state: "idle" | "loading" | "ready" | "error";
    error?: string;
  };
  debug: {
    step: string;
    updatedAt: string;
  };
};

const DAILY_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "synthetic_store_daily_2025-02-02_to_2026-01-13.csv",
);
const ATV_FILE_PATH = path.join(process.cwd(), "data", "atv_upt_dummy.csv");
const DEPARTMENT_FILE_PATH = path.join(process.cwd(), "data", "department_file.csv");
const SALES_MARGIN_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "synthetic_store_sales_margin.csv",
);
const GROSS_MARGIN_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "synthetic_store_gross_margin.csv",
);

const DAILY_TABLE = "synthetic_store_daily";
const ATV_TABLE = "synthetic_store_atv_upt";
const DEPARTMENT_TABLE = "synthetic_store_departments";
const SALES_MARGIN_TABLE = "synthetic_store_sales_margin";
const GROSS_MARGIN_TABLE = "synthetic_store_gross_margin";

const TABLES: TableSchema[] = [
  {
    name: DAILY_TABLE,
    columns: [
      { name: "Fiscal Date", type: "TEXT" },
      { name: "Location Number and Desc", type: "TEXT" },
      { name: "Net Sales Retail Amt", type: "REAL" },
      { name: "Net Sales Retail Amt LY", type: "REAL" },
      { name: "Net Sales Retail Amt Var LY %", type: "REAL" },
      { name: "Net Sales Qty", type: "REAL" },
      { name: "Net Sales Qty LY", type: "REAL" },
      { name: "Net Sales Qty Var LY %", type: "REAL" },
      { name: "Clr Net Sales Retail Amt", type: "REAL" },
      { name: "Clr Net Sales Retail Amt LY", type: "REAL" },
      { name: "Clr Net Sales Retail Amt Var LY %", type: "REAL" },
      { name: "Clearance Sales %", type: "REAL" },
      { name: "Clr Net Sales Qty", type: "REAL" },
      { name: "Clr Net Sales Qty LY", type: "REAL" },
      { name: "Clr Net Sales Qty Var LY %", type: "REAL" },
      { name: "Selling Margin Amt", type: "REAL" },
      { name: "Selling Margin Amt LY", type: "REAL" },
      { name: "Selling Margin % LY", type: "REAL" },
      { name: "Selling Margin %", type: "REAL" },
      { name: "Net Sales AUR", type: "REAL" },
      { name: "Net Sales AUR LY", type: "REAL" },
      { name: "Net Sales AUR Var LY %", type: "REAL" },
    ],
  },
  {
    name: ATV_TABLE,
    columns: [
      { name: "Org Wid", type: "INTEGER" },
      { name: "Bucket", type: "TEXT" },
      { name: "ATV", type: "REAL" },
      { name: "UPT", type: "REAL" },
      { name: "Location Number and Desc", type: "TEXT" },
    ],
  },
  {
    name: DEPARTMENT_TABLE,
    columns: [
      { name: "Time Level - REQUIRED", type: "TEXT" },
      { name: "Location Number and Desc", type: "TEXT" },
      { name: "Department Number and Desc", type: "TEXT" },
      { name: "Sales %", type: "REAL" },
      { name: "Sales Volume", type: "REAL" },
      { name: "vs LY", type: "REAL" },
      { name: "Rank", type: "INTEGER" },
    ],
  },
  {
    name: SALES_MARGIN_TABLE,
    columns: [
      { name: "Location Number and Desc", type: "TEXT" },
      { name: "Time Level - REQUIRED", type: "TEXT" },
      { name: "Net Sales Retail Amt", type: "REAL" },
      { name: "Net Sales Retail Amt LY", type: "REAL" },
      { name: "Net Sales Retail Amt Var LY %", type: "REAL" },
      { name: "Net Sales Qty", type: "REAL" },
      { name: "Net Sales Qty LY", type: "REAL" },
      { name: "Net Sales Qty Var LY %", type: "REAL" },
      { name: "Clr Net Sales Retail Amt", type: "REAL" },
      { name: "Clr Net Sales Retail Amt LY", type: "REAL" },
      { name: "Clr Net Sales Retail Amt Var LY %", type: "REAL" },
      { name: "Clearance Sales %", type: "REAL" },
      { name: "Clr Net Sales Qty", type: "REAL" },
      { name: "Clr Net Sales Qty LY", type: "REAL" },
      { name: "Clr Net Sales Qty Var LY %", type: "REAL" },
      { name: "Selling Margin Amt", type: "REAL" },
      { name: "Selling Margin Amt LY", type: "REAL" },
      { name: "Selling Margin % LY", type: "REAL" },
      { name: "Selling Margin %", type: "REAL" },
      { name: "Net Sales AUR", type: "REAL" },
      { name: "Net Sales AUR LY", type: "REAL" },
      { name: "Net Sales AUR Var LY %", type: "REAL" },
    ],
  },
  {
    name: GROSS_MARGIN_TABLE,
    columns: [
      { name: "Location Number and Desc", type: "TEXT" },
      { name: "Time Level - REQUIRED", type: "TEXT" },
      { name: "Gross Margin Amt", type: "REAL" },
      { name: "Gross Margin Amt LY", type: "REAL" },
      { name: "Gross Margin %", type: "REAL" },
      { name: "Gross Margin % LY", type: "REAL" },
      { name: "Clr EOP Inv Qty", type: "REAL" },
      { name: "Reg POS EOP Inv Qty", type: "REAL" },
      { name: "Total EOP Qty", type: "REAL" },
      { name: "EOP Inv Qty", type: "REAL" },
      { name: "Reg POS Net Sales Qty", type: "REAL" },
      { name: "Clr Net Sales Qty", type: "REAL" },
      { name: "Inventory Health Index", type: "REAL" },
      { name: "Total Sell Through%", type: "REAL" },
      { name: "Regular Sell Through%", type: "REAL" },
      { name: "Clearance Sell Through%", type: "REAL" },
      { name: "Weeks Of Supply", type: "REAL" },
    ],
  },
];

const globalState = globalThis as typeof globalThis & {
  __datasetState?: DatabaseState;
};

const databaseState: DatabaseState =
  globalState.__datasetState ??
  ({
    db: new DatabaseSync(":memory:"),
    tables: TABLES,
    locations: [],
    initialized: false,
    initStatus: { state: "idle" },
    debug: { step: "idle", updatedAt: new Date().toISOString() },
  } as DatabaseState);

globalState.__datasetState = databaseState;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "").replace(/%/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | undefined) {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function parseFiscalDate(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return value;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function readCsvObjects(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw);
  const header = rows[0] ?? [];
  return rows.slice(1).map((row) => {
    return Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""]));
  });
}

function createTable(table: TableSchema) {
  const columnSql = table.columns
    .map((column) => `${quoteIdentifier(column.name)} ${column.type}`)
    .join(", ");
  databaseState.db.exec(`CREATE TABLE ${quoteIdentifier(table.name)} (${columnSql})`);
}

function insertRows(table: TableSchema, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const columnSql = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const placeholders = table.columns.map(() => "?").join(", ");
  const statement = databaseState.db.prepare(
    `INSERT INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES (${placeholders})`,
  );

  databaseState.db.exec("BEGIN TRANSACTION");
  try {
    for (const row of rows) {
      statement.run(...table.columns.map((column) => row[column.name] ?? null));
    }
    databaseState.db.exec("COMMIT");
  } catch (error) {
    databaseState.db.exec("ROLLBACK");
    throw error;
  }
}

function prepareDailyRows() {
  const rows = readCsvObjects(DAILY_FILE_PATH);
  const prepared = rows.map((row) => ({
    "Fiscal Date": parseFiscalDate(row["Fiscal Date"]),
    "Location Number and Desc": row["Location Number and Desc"] || null,
    "Net Sales Retail Amt": parseNumber(row["Net Sales Retail Amt"]),
    "Net Sales Retail Amt LY": parseNumber(row["Net Sales Retail Amt LY"]),
    "Net Sales Retail Amt Var LY %": parseNumber(row["Net Sales Retail Amt Var LY %"]),
    "Net Sales Qty": parseNumber(row["Net Sales Qty"]),
    "Net Sales Qty LY": parseNumber(row["Net Sales Qty LY"]),
    "Net Sales Qty Var LY %": parseNumber(row["Net Sales Qty Var LY %"]),
    "Clr Net Sales Retail Amt": parseNumber(row["Clr Net Sales Retail Amt"]),
    "Clr Net Sales Retail Amt LY": parseNumber(row["Clr Net Sales Retail Amt LY"]),
    "Clr Net Sales Retail Amt Var LY %": parseNumber(row["Clr Net Sales Retail Amt Var LY %"]),
    "Clearance Sales %": parseNumber(row["Clearance Sales %"]),
    "Clr Net Sales Qty": parseNumber(row["Clr Net Sales Qty"]),
    "Clr Net Sales Qty LY": parseNumber(row["Clr Net Sales Qty LY"]),
    "Clr Net Sales Qty Var LY %": parseNumber(row["Clr Net Sales Qty Var LY %"]),
    "Selling Margin Amt": parseNumber(row["Selling Margin Amt"]),
    "Selling Margin Amt LY": parseNumber(row["Selling Margin Amt LY"]),
    "Selling Margin % LY": parseNumber(row["Selling Margin % LY"]),
    "Selling Margin %": parseNumber(row["Selling Margin %"]),
    "Net Sales AUR": parseNumber(row["Net Sales AUR"]),
    "Net Sales AUR LY": parseNumber(row["Net Sales AUR LY"]),
    "Net Sales AUR Var LY %": parseNumber(row["Net Sales AUR Var LY %"]),
  }));

  const locationByOrgWid = new Map<string, string>();
  for (const row of prepared) {
    const location = row["Location Number and Desc"];
    if (typeof location !== "string") continue;
    const orgWid = location.match(/^\s*(\d+)/)?.[1];
    if (orgWid) {
      locationByOrgWid.set(orgWid, location);
    }
  }

  return { prepared, locationByOrgWid };
}

function prepareAtvRows(locationByOrgWid: Map<string, string>) {
  const rows = readCsvObjects(ATV_FILE_PATH);
  return rows.map((row) => ({
    "Org Wid": parseInteger(row["Org Wid"]),
    Bucket: row.Bucket || null,
    ATV: parseNumber(row.ATV),
    UPT: parseNumber(row.UPT),
    "Location Number and Desc":
      locationByOrgWid.get((row["Org Wid"] || "").trim()) ?? null,
  }));
}

function prepareDepartmentRows() {
  const rows = readCsvObjects(DEPARTMENT_FILE_PATH);
  return rows.map((row) => ({
    "Time Level - REQUIRED": row["Time Level - REQUIRED"] || null,
    "Location Number and Desc": row["Location Number and Desc"] || null,
    "Department Number and Desc": row["Department Number and Desc"] || null,
    "Sales %": parseNumber(row["Sales %"]),
    "Sales Volume": parseNumber(row["Sales Volume"]),
    "vs LY": parseNumber(row["vs LY"]),
    Rank: parseInteger(row.Rank),
  }));
}

function prepareSalesMarginRows() {
  const rows = readCsvObjects(SALES_MARGIN_FILE_PATH);
  return rows.map((row) => ({
    "Location Number and Desc": row["Location Number and Desc"] || null,
    "Time Level - REQUIRED": row["Time Level - REQUIRED"] || null,
    "Net Sales Retail Amt": parseNumber(row["Net Sales Retail Amt"]),
    "Net Sales Retail Amt LY": parseNumber(row["Net Sales Retail Amt LY"]),
    "Net Sales Retail Amt Var LY %": parseNumber(row["Net Sales Retail Amt Var LY %"]),
    "Net Sales Qty": parseNumber(row["Net Sales Qty"]),
    "Net Sales Qty LY": parseNumber(row["Net Sales Qty LY"]),
    "Net Sales Qty Var LY %": parseNumber(row["Net Sales Qty Var LY %"]),
    "Clr Net Sales Retail Amt": parseNumber(row["Clr Net Sales Retail Amt"]),
    "Clr Net Sales Retail Amt LY": parseNumber(row["Clr Net Sales Retail Amt LY"]),
    "Clr Net Sales Retail Amt Var LY %": parseNumber(row["Clr Net Sales Retail Amt Var LY %"]),
    "Clearance Sales %": parseNumber(row["Clearance Sales %"]),
    "Clr Net Sales Qty": parseNumber(row["Clr Net Sales Qty"]),
    "Clr Net Sales Qty LY": parseNumber(row["Clr Net Sales Qty LY"]),
    "Clr Net Sales Qty Var LY %": parseNumber(row["Clr Net Sales Qty Var LY %"]),
    "Selling Margin Amt": parseNumber(row["Selling Margin Amt"]),
    "Selling Margin Amt LY": parseNumber(row["Selling Margin Amt LY"]),
    "Selling Margin % LY": parseNumber(row["Selling Margin % LY"]),
    "Selling Margin %": parseNumber(row["Selling Margin %"]),
    "Net Sales AUR": parseNumber(row["Net Sales AUR"]),
    "Net Sales AUR LY": parseNumber(row["Net Sales AUR LY"]),
    "Net Sales AUR Var LY %": parseNumber(row["Net Sales AUR Var LY %"]),
  }));
}

function prepareGrossMarginRows() {
  const rows = readCsvObjects(GROSS_MARGIN_FILE_PATH);
  return rows.map((row) => ({
    "Location Number and Desc": row["Location Number and Desc"] || null,
    "Time Level - REQUIRED": row["Time Level - REQUIRED"] || null,
    "Gross Margin Amt": parseNumber(row["Gross Margin Amt"]),
    "Gross Margin Amt LY": parseNumber(row["Gross Margin Amt LY"]),
    "Gross Margin %": parseNumber(row["Gross Margin %"]),
    "Gross Margin % LY": parseNumber(row["Gross Margin % LY"]),
    "Clr EOP Inv Qty": parseNumber(row["Clr EOP Inv Qty"]),
    "Reg POS EOP Inv Qty": parseNumber(row["Reg POS EOP Inv Qty"]),
    "Total EOP Qty": parseNumber(row["Total EOP Qty"]),
    "EOP Inv Qty": parseNumber(row["EOP Inv Qty"]),
    "Reg POS Net Sales Qty": parseNumber(row["Reg POS Net Sales Qty"]),
    "Clr Net Sales Qty": parseNumber(row["Clr Net Sales Qty"]),
    "Inventory Health Index": parseNumber(row["Inventory Health Index"]),
    "Total Sell Through%": parseNumber(row["Total Sell Through%"]),
    "Regular Sell Through%": parseNumber(row["Regular Sell Through%"]),
    "Clearance Sell Through%": parseNumber(row["Clearance Sell Through%"]),
    "Weeks Of Supply": parseNumber(row["Weeks Of Supply"]),
  }));
}

function refreshLocations() {
  const rows = databaseState.db.prepare(`
    SELECT DISTINCT "Location Number and Desc" AS location
    FROM synthetic_store_daily
    WHERE "Location Number and Desc" IS NOT NULL
    ORDER BY "Location Number and Desc"
  `).all() as Array<{ location: string }>;
  databaseState.locations = rows.map((row) => row.location).filter(Boolean);
}

function normalizeSql(sql: string) {
  return sql
    .replace(/\bTRY_CAST\s*\(/gi, "CAST(")
    .replace(/\bDOUBLE\b/gi, "REAL")
    .replace(/\bBIGINT\b/gi, "INTEGER")
    .replace(
      /strftime\s*\(\s*("Fiscal Date"|date\s*\([^)]+\)|datetime\s*\([^)]+\)|[A-Za-z_][\w." %%-]*)\s*,\s*('[^']+')\s*\)/gi,
      "strftime($2, $1)",
    );
}

export async function ensureDatasetLoaded() {
  if (databaseState.initialized) return;
  if (databaseState.initPromise) {
    await databaseState.initPromise;
    return;
  }

  databaseState.initStatus = { state: "loading" };
  databaseState.debug = { step: "init:start", updatedAt: new Date().toISOString() };
  databaseState.initPromise = (async () => {
    try {
      databaseState.debug = { step: "init:create-tables", updatedAt: new Date().toISOString() };
      for (const table of TABLES) {
        createTable(table);
      }

      databaseState.debug = { step: "init:load-daily", updatedAt: new Date().toISOString() };
      const { prepared: dailyRows, locationByOrgWid } = prepareDailyRows();
      insertRows(TABLES[0], dailyRows);

      databaseState.debug = { step: "init:load-atv", updatedAt: new Date().toISOString() };
      insertRows(TABLES[1], prepareAtvRows(locationByOrgWid));

      databaseState.debug = { step: "init:load-departments", updatedAt: new Date().toISOString() };
      insertRows(TABLES[2], prepareDepartmentRows());

      databaseState.debug = { step: "init:load-sales-margin", updatedAt: new Date().toISOString() };
      insertRows(TABLES[3], prepareSalesMarginRows());

      databaseState.debug = { step: "init:load-gross-margin", updatedAt: new Date().toISOString() };
      insertRows(TABLES[4], prepareGrossMarginRows());

      databaseState.debug = { step: "init:refresh-locations", updatedAt: new Date().toISOString() };
      refreshLocations();

      databaseState.initialized = true;
      databaseState.initStatus = { state: "ready" };
      databaseState.debug = { step: "init:ready", updatedAt: new Date().toISOString() };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dataset load failed.";
      databaseState.initStatus = { state: "error", error: message };
      databaseState.debug = {
        step: `init:error:${message}`,
        updatedAt: new Date().toISOString(),
      };
      throw error;
    } finally {
      databaseState.initPromise = undefined;
    }
  })();

  await databaseState.initPromise;
}

export function getInitStatus() {
  return databaseState.initStatus;
}

export function getDebugStatus() {
  return databaseState.debug;
}

export async function executeSql(sql: string) {
  const normalizedSql = normalizeSql(sql);
  const statement = databaseState.db.prepare(normalizedSql);
  const rows = statement.all() as Array<Record<string, unknown>>;
  return rows.map((row) => JSON.parse(JSON.stringify(row)));
}

export function getSchemaSummary() {
  if (!databaseState.tables.length) return "";
  return databaseState.tables
    .map((table) => {
      const columns = table.columns
        .map((column) => `${column.name} ${column.type}`)
        .join(", ");
      return `${table.name}(${columns})`;
    })
    .join("\n");
}

export function listTables() {
  return databaseState.tables.map((table) => table.name);
}

export function getDatasetContext() {
  return [
    "Datasets:",
    "- synthetic_store_daily: daily sales and margin metrics by store.",
    "- synthetic_store_atv_upt: ATV/UPT metrics by store and bucket.",
    "- synthetic_store_departments: department performance by store and time bucket.",
    "- synthetic_store_sales_margin: summarized sales and margin metrics by store.",
    "- synthetic_store_gross_margin: gross margin and inventory metrics by store.",
    "",
    "Common columns:",
    "- Fiscal Date: ISO date text (YYYY-MM-DD), compatible with SQLite date functions.",
    "- Location Number and Desc: store identifier plus name, city, state.",
    "",
    "SQLite notes:",
    "- Use strftime('%Y-%m-%d', \"Fiscal Date\") syntax.",
    "- Use date(\"Fiscal Date\") or datetime(...) when needed.",
    "- Use date('now', '-1 year') style date math.",
  ].join("\n");
}

export function getLocationMatch(userText: string) {
  if (!databaseState.locations.length) return null;
  const lowered = userText.toLowerCase();
  const numberMatch = lowered.match(/\b\d{2,}\b/g);
  if (numberMatch) {
    for (const candidate of numberMatch) {
      const match = databaseState.locations.find((location) =>
        location.toLowerCase().startsWith(candidate),
      );
      if (match) return match;
    }
  }

  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "how",
    "are",
    "was",
    "were",
    "per",
    "each",
    "all",
  ]);
  const tokens =
    lowered.match(/[a-z0-9]+/g)?.filter((token) => {
      if (token.length < 3) return false;
      return !stopwords.has(token);
    }) ?? [];

  let bestMatch: string | null = null;
  let bestScore = 0;
  for (const location of databaseState.locations) {
    const locationLower = location.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (locationLower.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = location;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}
