import duckdb from "duckdb";
import path from "path";

export type ColumnSchema = {
  name: string;
  type: string;
};

export type TableSchema = {
  name: string;
  columns: ColumnSchema[];
};

type DatabaseState = {
  db: duckdb.Database;
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
const DEPARTMENT_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "department_file.csv",
);
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
const DB_PATH = ":memory:";
const DAILY_TABLE = "synthetic_store_daily";
const ATV_TABLE = "synthetic_store_atv_upt";
const DEPARTMENT_TABLE = "synthetic_store_departments";
const SALES_MARGIN_TABLE = "synthetic_store_sales_margin";
const GROSS_MARGIN_TABLE = "synthetic_store_gross_margin";

const globalState = globalThis as typeof globalThis & {
  __duckdbState?: DatabaseState;
};

const databaseState: DatabaseState =
  globalState.__duckdbState ??
  ({
    db: new duckdb.Database(DB_PATH),
    tables: [],
    locations: [],
    initialized: false,
    initStatus: { state: "idle" },
    debug: { step: "idle", updatedAt: new Date().toISOString() },
  } as DatabaseState);

globalState.__duckdbState = databaseState;

function openConnection(db: duckdb.Database): Promise<duckdb.Connection> {
  try {
    return Promise.resolve(db.connect());
  } catch (error) {
    return Promise.reject(error);
  }
}

async function openConnectionWithTimeout(
  db: duckdb.Database,
  timeoutMs: number,
  label: string,
) {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `Timeout opening DuckDB connection (${label}). Check if ${DB_PATH} is locked.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([openConnection(db), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function runStatement(
  connection: duckdb.Connection,
  sql: string,
  params: unknown[] = [],
) {
  return new Promise<void>((resolve, reject) => {
    if (params.length === 0) {
      connection.run(sql, (error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      return;
    }
    connection.run(sql, ...params, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function allRows(
  connection: duckdb.Connection,
  sql: string,
  params: unknown[] = [],
) {
  return new Promise<unknown[]>((resolve, reject) => {
    if (params.length === 0) {
      connection.all(sql, (error: Error | null, rows: unknown[]) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows);
      });
      return;
    }
    connection.all(sql, ...params, (error: Error | null, rows: unknown[]) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function tableExists(tableName: string) {
  databaseState.debug = {
    step: "init:check-table:connect",
    updatedAt: new Date().toISOString(),
  };
  const connection = await openConnectionWithTimeout(
    databaseState.db,
    8000,
    "check-table",
  );
  try {
    databaseState.debug = {
      step: "init:check-table:query",
      updatedAt: new Date().toISOString(),
    };
    const rows = (await allRows(
      connection,
      "select table_name from information_schema.tables where table_schema = 'main' and table_name = ?",
      [tableName],
    )) as { table_name: string }[];
    databaseState.debug = {
      step: "init:check-table:done",
      updatedAt: new Date().toISOString(),
    };
    return rows.length > 0;
  } finally {
    connection.close();
  }
}

async function refreshSchema() {
  databaseState.debug = {
    step: "init:refresh-schema:connect",
    updatedAt: new Date().toISOString(),
  };
  const connection = await openConnectionWithTimeout(
    databaseState.db,
    8000,
    "refresh-schema",
  );
  try {
    databaseState.debug = {
      step: "init:refresh-schema:tables",
      updatedAt: new Date().toISOString(),
    };
    const tableRows = (await allRows(
      connection,
      "select table_name from information_schema.tables where table_schema = 'main'",
    )) as { table_name: string }[];

    const tables: TableSchema[] = [];
    for (const table of tableRows) {
      databaseState.debug = {
        step: `init:refresh-schema:columns:${table.table_name}`,
        updatedAt: new Date().toISOString(),
      };
      const columns = (await allRows(
        connection,
        "select column_name, data_type from information_schema.columns where table_schema = 'main' and table_name = ? order by ordinal_position",
        [table.table_name],
      )) as { column_name: string; data_type: string }[];

      tables.push({
        name: table.table_name,
        columns: columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
        })),
      });
    }
    databaseState.tables = tables;
    databaseState.debug = {
      step: "init:refresh-schema:done",
      updatedAt: new Date().toISOString(),
    };
  } finally {
    connection.close();
  }
}

async function refreshLocations() {
  const connection = await openConnection(databaseState.db);
  try {
    const rows = (await allRows(
      connection,
      `select distinct "Location Number and Desc" as location from ${quoteIdentifier(
        DAILY_TABLE,
      )}
      union
      select distinct "Location Number and Desc" as location from ${quoteIdentifier(
        ATV_TABLE,
      )}
      union
      select distinct "Location Number and Desc" as location from ${quoteIdentifier(
        DEPARTMENT_TABLE,
      )}
      union
      select distinct "Location Number and Desc" as location from ${quoteIdentifier(
        SALES_MARGIN_TABLE,
      )}
      union
      select distinct "Location Number and Desc" as location from ${quoteIdentifier(
        GROSS_MARGIN_TABLE,
      )}
      order by location`,
    )) as { location: string }[];
    databaseState.locations = rows.map((row) => row.location).filter(Boolean);
  } finally {
    connection.close();
  }
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
      databaseState.debug = {
        step: "init:check-table",
        updatedAt: new Date().toISOString(),
      };
  const dailyExists = await tableExists(DAILY_TABLE);
  const atvExists = await tableExists(ATV_TABLE);
  const departmentExists = await tableExists(DEPARTMENT_TABLE);
  const salesMarginExists = await tableExists(SALES_MARGIN_TABLE);
  const grossMarginExists = await tableExists(GROSS_MARGIN_TABLE);
  if (
    dailyExists &&
    atvExists &&
    departmentExists &&
    salesMarginExists &&
    grossMarginExists
  ) {
    databaseState.debug = {
      step: "init:refresh-schema",
      updatedAt: new Date().toISOString(),
    };
        await refreshSchema();
        await refreshLocations();
        databaseState.initialized = true;
        databaseState.initStatus = { state: "ready" };
        databaseState.debug = {
          step: "init:ready-existing",
          updatedAt: new Date().toISOString(),
        };
        return;
      }

      databaseState.debug = {
        step: "init:open-connection",
        updatedAt: new Date().toISOString(),
      };
      const connection = await openConnectionWithTimeout(
        databaseState.db,
        8000,
        "create-table",
      );
      try {
        databaseState.debug = {
          step: "init:create-table",
          updatedAt: new Date().toISOString(),
        };
    const escapedDailyPath = DAILY_FILE_PATH.replace(/'/g, "''");
    const escapedAtvPath = ATV_FILE_PATH.replace(/'/g, "''");
    const escapedDepartmentPath = DEPARTMENT_FILE_PATH.replace(/'/g, "''");
    const escapedSalesMarginPath = SALES_MARGIN_FILE_PATH.replace(/'/g, "''");
    const escapedGrossMarginPath = GROSS_MARGIN_FILE_PATH.replace(/'/g, "''");
    if (!dailyExists) {
      await runStatement(
        connection,
        `CREATE TABLE ${quoteIdentifier(DAILY_TABLE)} AS
          SELECT
            (try_strptime("Fiscal Date", '%m-%d-%Y'))::DATE AS "Fiscal Date",
            "Location Number and Desc",
            try_cast(nullif("Net Sales Retail Amt", '') AS DOUBLE) AS "Net Sales Retail Amt",
            try_cast(nullif("Net Sales Retail Amt LY", '') AS DOUBLE) AS "Net Sales Retail Amt LY",
            try_cast(nullif("Net Sales Retail Amt Var LY %", '') AS DOUBLE) AS "Net Sales Retail Amt Var LY %",
            try_cast(nullif("Net Sales Qty", '') AS DOUBLE) AS "Net Sales Qty",
            try_cast(nullif("Net Sales Qty LY", '') AS DOUBLE) AS "Net Sales Qty LY",
            try_cast(nullif("Net Sales Qty Var LY %", '') AS DOUBLE) AS "Net Sales Qty Var LY %",
            try_cast(nullif("Clr Net Sales Retail Amt", '') AS DOUBLE) AS "Clr Net Sales Retail Amt",
            try_cast(nullif("Clr Net Sales Retail Amt LY", '') AS DOUBLE) AS "Clr Net Sales Retail Amt LY",
            try_cast(nullif("Clr Net Sales Retail Amt Var LY %", '') AS DOUBLE) AS "Clr Net Sales Retail Amt Var LY %",
            try_cast(nullif(replace("Clearance Sales %", '%', ''), '') AS DOUBLE) AS "Clearance Sales %",
            try_cast(nullif("Clr Net Sales Qty", '') AS DOUBLE) AS "Clr Net Sales Qty",
            try_cast(nullif("Clr Net Sales Qty LY", '') AS DOUBLE) AS "Clr Net Sales Qty LY",
            try_cast(nullif("Clr Net Sales Qty Var LY %", '') AS DOUBLE) AS "Clr Net Sales Qty Var LY %",
            try_cast(nullif("Selling Margin Amt", '') AS DOUBLE) AS "Selling Margin Amt",
            try_cast(nullif("Selling Margin Amt LY", '') AS DOUBLE) AS "Selling Margin Amt LY",
            try_cast(nullif("Selling Margin % LY", '') AS DOUBLE) AS "Selling Margin % LY",
            try_cast(nullif("Selling Margin %", '') AS DOUBLE) AS "Selling Margin %",
            try_cast(nullif("Net Sales AUR", '') AS DOUBLE) AS "Net Sales AUR",
            try_cast(nullif("Net Sales AUR LY", '') AS DOUBLE) AS "Net Sales AUR LY",
            try_cast(nullif("Net Sales AUR Var LY %", '') AS DOUBLE) AS "Net Sales AUR Var LY %"
          FROM read_csv_auto('${escapedDailyPath}', all_varchar=true, sample_size=10000)`,
      );
    }
    if (!atvExists) {
      await runStatement(
        connection,
        `CREATE TABLE ${quoteIdentifier(ATV_TABLE)} AS
          WITH store_map AS (
            SELECT DISTINCT
              regexp_extract("Location Number and Desc", '^\\s*(\\d+)', 1) AS "Org Wid",
              "Location Number and Desc"
            FROM ${quoteIdentifier(DAILY_TABLE)}
            WHERE "Location Number and Desc" IS NOT NULL
          )
          SELECT
            try_cast(nullif(source."Org Wid", '') AS BIGINT) AS "Org Wid",
            source."Bucket",
            try_cast(nullif(source."ATV", '') AS DOUBLE) AS "ATV",
            try_cast(nullif(source."UPT", '') AS DOUBLE) AS "UPT",
            store_map."Location Number and Desc"
          FROM read_csv_auto('${escapedAtvPath}', all_varchar=true, sample_size=10000) AS source
          LEFT JOIN store_map
            ON store_map."Org Wid" = source."Org Wid"`,
      );
    }
    if (!departmentExists) {
      await runStatement(
        connection,
        `CREATE TABLE ${quoteIdentifier(DEPARTMENT_TABLE)} AS
          SELECT
            source."Time Level - REQUIRED" AS "Time Level - REQUIRED",
            source."Location Number and Desc",
            source."Department Number and Desc",
            try_cast(nullif(replace(source."Sales %", '%', ''), '') AS DOUBLE) AS "Sales %",
            try_cast(nullif(source."Sales Volume", '') AS DOUBLE) AS "Sales Volume",
            try_cast(nullif(replace(source."vs LY", '%', ''), '') AS DOUBLE) AS "vs LY",
            try_cast(nullif(source."Rank", '') AS BIGINT) AS "Rank"
          FROM read_csv_auto('${escapedDepartmentPath}', all_varchar=true, sample_size=10000) AS source`,
      );
    }
    if (!salesMarginExists) {
      await runStatement(
        connection,
        `CREATE TABLE ${quoteIdentifier(SALES_MARGIN_TABLE)} AS
          SELECT
            source."Location Number and Desc",
            source."Time Level - REQUIRED",
            try_cast(nullif(source."Net Sales Retail Amt", '') AS DOUBLE) AS "Net Sales Retail Amt",
            try_cast(nullif(source."Net Sales Retail Amt LY", '') AS DOUBLE) AS "Net Sales Retail Amt LY",
            try_cast(nullif(source."Net Sales Retail Amt Var LY %", '') AS DOUBLE) AS "Net Sales Retail Amt Var LY %",
            try_cast(nullif(source."Net Sales Qty", '') AS DOUBLE) AS "Net Sales Qty",
            try_cast(nullif(source."Net Sales Qty LY", '') AS DOUBLE) AS "Net Sales Qty LY",
            try_cast(nullif(source."Net Sales Qty Var LY %", '') AS DOUBLE) AS "Net Sales Qty Var LY %",
            try_cast(nullif(source."Clr Net Sales Retail Amt", '') AS DOUBLE) AS "Clr Net Sales Retail Amt",
            try_cast(nullif(source."Clr Net Sales Retail Amt LY", '') AS DOUBLE) AS "Clr Net Sales Retail Amt LY",
            try_cast(nullif(source."Clr Net Sales Retail Amt Var LY %", '') AS DOUBLE) AS "Clr Net Sales Retail Amt Var LY %",
            try_cast(nullif(replace(source."Clearance Sales %", '%', ''), '') AS DOUBLE) AS "Clearance Sales %",
            try_cast(nullif(source."Clr Net Sales Qty", '') AS DOUBLE) AS "Clr Net Sales Qty",
            try_cast(nullif(source."Clr Net Sales Qty LY", '') AS DOUBLE) AS "Clr Net Sales Qty LY",
            try_cast(nullif(source."Clr Net Sales Qty Var LY %", '') AS DOUBLE) AS "Clr Net Sales Qty Var LY %",
            try_cast(nullif(source."Selling Margin Amt", '') AS DOUBLE) AS "Selling Margin Amt",
            try_cast(nullif(source."Selling Margin Amt LY", '') AS DOUBLE) AS "Selling Margin Amt LY",
            try_cast(nullif(source."Selling Margin % LY", '') AS DOUBLE) AS "Selling Margin % LY",
            try_cast(nullif(source."Selling Margin %", '') AS DOUBLE) AS "Selling Margin %",
            try_cast(nullif(source."Net Sales AUR", '') AS DOUBLE) AS "Net Sales AUR",
            try_cast(nullif(source."Net Sales AUR LY", '') AS DOUBLE) AS "Net Sales AUR LY",
            try_cast(nullif(source."Net Sales AUR Var LY %", '') AS DOUBLE) AS "Net Sales AUR Var LY %"
          FROM read_csv_auto('${escapedSalesMarginPath}', all_varchar=true, sample_size=10000) AS source`,
      );
    }
    if (!grossMarginExists) {
      await runStatement(
        connection,
        `CREATE TABLE ${quoteIdentifier(GROSS_MARGIN_TABLE)} AS
          SELECT
            source."Location Number and Desc",
            source."Time Level - REQUIRED",
            try_cast(nullif(source."Gross Margin Amt", '') AS DOUBLE) AS "Gross Margin Amt",
            try_cast(nullif(source."Gross Margin Amt LY", '') AS DOUBLE) AS "Gross Margin Amt LY",
            try_cast(nullif(source."Gross Margin %", '') AS DOUBLE) AS "Gross Margin %",
            try_cast(nullif(source."Gross Margin % LY", '') AS DOUBLE) AS "Gross Margin % LY",
            try_cast(nullif(source."Clr EOP Inv Qty", '') AS DOUBLE) AS "Clr EOP Inv Qty",
            try_cast(nullif(source."Reg POS EOP Inv Qty", '') AS DOUBLE) AS "Reg POS EOP Inv Qty",
            try_cast(nullif(source."Total EOP Qty", '') AS DOUBLE) AS "Total EOP Qty",
            try_cast(nullif(source."EOP Inv Qty", '') AS DOUBLE) AS "EOP Inv Qty",
            try_cast(nullif(source."Reg POS Net Sales Qty", '') AS DOUBLE) AS "Reg POS Net Sales Qty",
            try_cast(nullif(source."Clr Net Sales Qty", '') AS DOUBLE) AS "Clr Net Sales Qty",
            try_cast(nullif(source."Inventory Health Index", '') AS DOUBLE) AS "Inventory Health Index",
            try_cast(nullif(replace(source."Total Sell Through%", '%', ''), '') AS DOUBLE) AS "Total Sell Through%",
            try_cast(nullif(replace(source."Regular Sell Through%", '%', ''), '') AS DOUBLE) AS "Regular Sell Through%",
            try_cast(nullif(replace(source."Clearance Sell Through%", '%', ''), '') AS DOUBLE) AS "Clearance Sell Through%",
            try_cast(nullif(source."Weeks Of Supply", '') AS DOUBLE) AS "Weeks Of Supply"
          FROM read_csv_auto('${escapedGrossMarginPath}', all_varchar=true, sample_size=10000) AS source`,
      );
    }
      } finally {
        connection.close();
      }

      databaseState.debug = {
        step: "init:refresh-schema",
        updatedAt: new Date().toISOString(),
      };
      await refreshSchema();
      await refreshLocations();
      databaseState.initialized = true;
      databaseState.initStatus = { state: "ready" };
      databaseState.debug = {
        step: "init:ready-new",
        updatedAt: new Date().toISOString(),
      };
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
  const connection = await openConnection(databaseState.db);
  try {
    const rows = await allRows(connection, sql);
    return rows.map((row) =>
      JSON.parse(
        JSON.stringify(row, (_, value) => {
          if (typeof value === "bigint") {
            const numberValue = Number(value);
            return Number.isSafeInteger(numberValue) ? numberValue : value.toString();
          }
          return value;
        }),
      ),
    );
  } finally {
    connection.close();
  }
}

export function getSchemaSummary() {
  if (!databaseState.tables.length) return "";
  return databaseState.tables
    .map((table) => {
      const columns = table.columns
        .map((col) => `${col.name} ${col.type}`)
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
    "- Fiscal Date: DATE type (parsed from MM-DD-YYYY).",
    "- Location Number and Desc: store identifier plus name, city, state.",
    "",
    "Daily table highlights:",
    "- Net Sales Retail Amt, Net Sales Retail Amt LY, Net Sales Retail Amt Var LY %.",
    "- Net Sales Qty, Net Sales Qty LY, Net Sales Qty Var LY %.",
    "- Clr Net Sales Retail Amt, Clr Net Sales Retail Amt LY, Clr Net Sales Retail Amt Var LY %.",
    "- Clearance Sales % (numeric, 0-100).",
    "- Clr Net Sales Qty, Clr Net Sales Qty LY, Clr Net Sales Qty Var LY %.",
    "- Selling Margin Amt, Selling Margin Amt LY, Selling Margin %, Selling Margin % LY.",
    "- Net Sales AUR, Net Sales AUR LY, Net Sales AUR Var LY %.",
    "",
    "ATV/UPT table highlights:",
    "- Org Wid: store number (matches the leading number in Location Number and Desc).",
    "- Bucket: time bucket (YESTERDAY, WTD, MTD, YTD).",
    "- ATV: average transaction value.",
    "- UPT: units per transaction.",
    "",
    "Department table highlights:",
    "- Time Level - REQUIRED: bucket (YESTERDAY, WTD, MTD, YTD).",
    "- Department Number and Desc: department code and name.",
    "- Sales %: numeric percentage (0-100).",
    "- Sales Volume: numeric amount.",
    "- vs LY: numeric percentage (0-100).",
    "- Rank: rank within the store and bucket.",
    "",
    "Sales margin table highlights:",
    "- Time Level - REQUIRED: period bucket (DY, LW, WK, WTD, MTD, QTD, HTD, YTD).",
    "- Net Sales Retail Amt, Net Sales Retail Amt LY, Net Sales Retail Amt Var LY %.",
    "- Net Sales Qty, Net Sales Qty LY, Net Sales Qty Var LY %.",
    "- Clr Net Sales Retail Amt, Clr Net Sales Retail Amt LY, Clr Net Sales Retail Amt Var LY %.",
    "- Clearance Sales %.",
    "- Clr Net Sales Qty, Clr Net Sales Qty LY, Clr Net Sales Qty Var LY %.",
    "- Selling Margin Amt, Selling Margin Amt LY, Selling Margin %, Selling Margin % LY.",
    "- Net Sales AUR, Net Sales AUR LY, Net Sales AUR Var LY %.",
    "",
    "Gross margin table highlights:",
    "- Time Level - REQUIRED: period bucket (DY, LW, WK, WTD, MTD, QTD, HTD, YTD).",
    "- Gross Margin Amt, Gross Margin Amt LY.",
    "- Gross Margin %, Gross Margin % LY.",
    "- Clr EOP Inv Qty, Reg POS EOP Inv Qty, Total EOP Qty, EOP Inv Qty.",
    "- Reg POS Net Sales Qty, Clr Net Sales Qty.",
    "- Inventory Health Index.",
    "- Total Sell Through%, Regular Sell Through%, Clearance Sell Through%.",
    "- Weeks Of Supply.",
    "Notes:",
    "- There is no explicit region column; derive state from Location Number and Desc only if requested.",
    "- When using ATV/UPT with store names, join on Location Number and Desc (the ATV table already includes it).",
    "- Use synthetic_store_departments for department performance questions.",
    "- Use synthetic_store_sales_margin for summarized sales questions (time buckets).",
    "- Use synthetic_store_daily for questions at a specific date.",
    "- Use synthetic_store_gross_margin for gross margin questions.",
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
