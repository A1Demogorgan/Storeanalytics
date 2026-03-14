import { NextResponse } from "next/server";
import {
  ensureDatasetLoaded,
  executeSql,
  getInitStatus,
} from "@/lib/dataset";

export const runtime = "nodejs";

type Role =
  | "store_manager"
  | "area_manager"
  | "regional_manager"
  | "corporate";

type Period = "YESTERDAY" | "WTD" | "YTD";

const ROLE_LIMITS: Record<Role, number> = {
  store_manager: 1,
  area_manager: 2,
  regional_manager: 4,
  corporate: Number.POSITIVE_INFINITY,
};

const PERIOD_TO_SALES_BUCKET: Record<Period, string> = {
  YESTERDAY: "DY",
  WTD: "WTD",
  YTD: "YTD",
};

const PERIOD_TO_GROSS_BUCKET: Record<Period, string> = {
  YESTERDAY: "DY",
  WTD: "WTD",
  YTD: "YTD",
};

const BUCKET_ORDER_SQL = `
  CASE "Time Level - REQUIRED"
    WHEN 'DY' THEN 1
    WHEN 'LW' THEN 2
    WHEN 'WK' THEN 3
    WHEN 'WTD' THEN 4
    WHEN 'MTD' THEN 5
    WHEN 'QTD' THEN 6
    WHEN 'HTD' THEN 7
    WHEN 'YTD' THEN 8
    ELSE 99
  END
`;

const ATV_BUCKET_ORDER_SQL = `
  CASE "Bucket"
    WHEN 'YESTERDAY' THEN 1
    WHEN 'WTD' THEN 2
    WHEN 'MTD' THEN 3
    WHEN 'YTD' THEN 4
    ELSE 99
  END
`;

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function sqlList(items: string[]) {
  return items.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

function resolveRoleApplicableLocations(
  locations: string[],
  role: Role,
  selectedLocation?: string,
) {
  if (!locations.length) return [];
  const limit = ROLE_LIMITS[role] ?? 1;
  if (limit === Number.POSITIVE_INFINITY || limit >= locations.length) {
    return locations;
  }
  if (role === "store_manager") {
    if (selectedLocation && locations.includes(selectedLocation)) {
      return [selectedLocation];
    }
    return [locations[0]];
  }

  const startIndex = selectedLocation
    ? Math.max(locations.indexOf(selectedLocation), 0)
    : 0;
  return Array.from({ length: limit }, (_, offset) => {
    return locations[(startIndex + offset) % locations.length];
  });
}

export async function POST(req: Request) {
  try {
    const initStatus = getInitStatus();
    if (initStatus.state === "idle") {
      void ensureDatasetLoaded();
      return NextResponse.json(
        { error: "Dataset is loading. Try again shortly." },
        { status: 503 },
      );
    }
    if (initStatus.state === "loading") {
      return NextResponse.json(
        { error: "Dataset is still loading. Try again shortly." },
        { status: 503 },
      );
    }
    if (initStatus.state === "error") {
      return NextResponse.json(
        { error: initStatus.error || "Dataset failed to load." },
        { status: 500 },
      );
    }

    const body = (await req.json()) as {
      role?: Role;
      period?: Period;
      selectedLocation?: string;
      focusLocation?: string;
    };
    const role = body.role ?? "store_manager";
    const period = body.period ?? "WTD";

    const allLocationsRows = (await executeSql(`
      SELECT DISTINCT "Location Number and Desc" AS location
      FROM synthetic_store_daily
      WHERE "Location Number and Desc" IS NOT NULL
      ORDER BY "Location Number and Desc"
    `)) as Array<{ location: string }>;
    const allLocations = allLocationsRows
      .map((row) => row.location)
      .filter(Boolean);
    const scopeLocations = resolveRoleApplicableLocations(
      allLocations,
      role,
      body.selectedLocation,
    );
    if (!scopeLocations.length) {
      return NextResponse.json(
        { error: "No locations available in dataset." },
        { status: 400 },
      );
    }

    const metricLocations =
      body.focusLocation && scopeLocations.includes(body.focusLocation)
        ? [body.focusLocation]
        : scopeLocations;
    const locationsSql = sqlList(metricLocations);
    const salesBucket = PERIOD_TO_SALES_BUCKET[period];
    const grossBucket = PERIOD_TO_GROSS_BUCKET[period];

    const salesRows = (await executeSql(`
      SELECT
        sum("Net Sales Retail Amt") AS sales,
        sum("Net Sales Qty") AS qty
      FROM synthetic_store_sales_margin
      WHERE "Time Level - REQUIRED" = '${salesBucket}'
        AND "Location Number and Desc" IN (${locationsSql})
    `)) as Array<{ sales: number; qty: number }>;

    const grossRows = (await executeSql(`
      SELECT
        sum("Gross Margin Amt") AS gross_margin_amt,
        avg("Gross Margin %") AS gross_margin_pct,
        avg("Inventory Health Index") AS inventory_score,
        avg("Weeks Of Supply") AS weeks_of_supply
      FROM synthetic_store_gross_margin
      WHERE "Time Level - REQUIRED" = '${grossBucket}'
        AND "Location Number and Desc" IN (${locationsSql})
    `)) as Array<{
      gross_margin_amt: number;
      gross_margin_pct: number;
      inventory_score: number;
      weeks_of_supply: number;
    }>;

    const atvRows = (await executeSql(`
      SELECT
        avg("ATV") AS atv,
        avg("UPT") AS upt
      FROM synthetic_store_atv_upt
      WHERE "Bucket" = '${period}'
        AND "Location Number and Desc" IN (${locationsSql})
    `)) as Array<{ atv: number; upt: number }>;

    const topDepartments = (await executeSql(`
      SELECT
        "Department Number and Desc" AS department,
        sum("Sales Volume") AS sales_volume
      FROM synthetic_store_departments
      WHERE "Time Level - REQUIRED" = '${period}'
        AND "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY sales_volume DESC
      LIMIT 5
    `)) as Array<{ department: string; sales_volume: number }>;

    const bottomDepartments = (await executeSql(`
      SELECT
        "Department Number and Desc" AS department,
        sum("Sales Volume") AS sales_volume
      FROM synthetic_store_departments
      WHERE "Time Level - REQUIRED" = '${period}'
        AND "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY sales_volume ASC
      LIMIT 5
    `)) as Array<{ department: string; sales_volume: number }>;

    const salesTrend = (await executeSql(`
      SELECT * FROM (
        SELECT
          strftime('%Y-%m-%d', "Fiscal Date") AS label,
          sum("Net Sales Retail Amt") AS value
        FROM synthetic_store_daily
        WHERE "Location Number and Desc" IN (${locationsSql})
        GROUP BY 1
        ORDER BY label DESC
        LIMIT 30
      ) trend
      ORDER BY label ASC
    `)) as Array<{ label: string; value: number }>;

    const qtyTrend = (await executeSql(`
      SELECT * FROM (
        SELECT
          strftime('%Y-%m-%d', "Fiscal Date") AS label,
          sum("Net Sales Qty") AS value
        FROM synthetic_store_daily
        WHERE "Location Number and Desc" IN (${locationsSql})
        GROUP BY 1
        ORDER BY label DESC
        LIMIT 30
      ) trend
      ORDER BY label ASC
    `)) as Array<{ label: string; value: number }>;

    const grossTrend = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        avg("Gross Margin Amt") AS value
      FROM synthetic_store_gross_margin
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${BUCKET_ORDER_SQL}
    `)) as Array<{ label: string; value: number }>;

    const inventoryTrend = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        avg("Inventory Health Index") AS value
      FROM synthetic_store_gross_margin
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${BUCKET_ORDER_SQL}
    `)) as Array<{ label: string; value: number }>;

    const weeksTrend = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        avg("Weeks Of Supply") AS value
      FROM synthetic_store_gross_margin
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${BUCKET_ORDER_SQL}
    `)) as Array<{ label: string; value: number }>;

    const atvTrend = (await executeSql(`
      SELECT
        "Bucket" AS label,
        avg("ATV") AS value
      FROM synthetic_store_atv_upt
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${ATV_BUCKET_ORDER_SQL}
    `)) as Array<{ label: string; value: number }>;

    const uptTrend = (await executeSql(`
      SELECT
        "Bucket" AS label,
        avg("UPT") AS value
      FROM synthetic_store_atv_upt
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${ATV_BUCKET_ORDER_SQL}
    `)) as Array<{ label: string; value: number }>;

    const dailyDeepDive = (await executeSql(`
      SELECT * FROM (
        SELECT
          strftime('%Y-%m-%d', "Fiscal Date") AS label,
          sum("Net Sales Retail Amt") AS sales,
          sum("Net Sales Qty") AS quantity,
          sum("Clr Net Sales Retail Amt") AS clearance_sales,
          avg("Clearance Sales %") AS clearance_sales_pct
        FROM synthetic_store_daily
        WHERE "Location Number and Desc" IN (${locationsSql})
        GROUP BY 1
        ORDER BY label DESC
        LIMIT 180
      ) t
      ORDER BY label ASC
    `)) as Array<{
      label: string;
      sales: number;
      quantity: number;
      clearance_sales: number;
      clearance_sales_pct: number;
    }>;

    const salesBucketDeepDive = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        sum("Net Sales Retail Amt") AS sales,
        sum("Net Sales Qty") AS quantity,
        sum("Clr Net Sales Retail Amt") AS clearance_sales,
        avg("Clearance Sales %") AS clearance_sales_pct
      FROM synthetic_store_sales_margin
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${BUCKET_ORDER_SQL}
    `)) as Array<{
      label: string;
      sales: number;
      quantity: number;
      clearance_sales: number;
      clearance_sales_pct: number;
    }>;

    const grossBucketDeepDive = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        sum("Gross Margin Amt") AS gross_margin,
        avg("Gross Margin %") AS gross_margin_pct,
        avg("Inventory Health Index") AS inventory_score,
        avg("Weeks Of Supply") AS weeks_of_supply,
        avg("Total Sell Through%") AS total_sell_through,
        avg("Regular Sell Through%") AS regular_sell_through,
        avg("Clearance Sell Through%") AS clearance_sell_through
      FROM synthetic_store_gross_margin
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${BUCKET_ORDER_SQL}
    `)) as Array<{
      label: string;
      gross_margin: number;
      gross_margin_pct: number;
      inventory_score: number;
      weeks_of_supply: number;
      total_sell_through: number;
      regular_sell_through: number;
      clearance_sell_through: number;
    }>;

    const atvBucketDeepDive = (await executeSql(`
      SELECT
        "Bucket" AS label,
        avg("ATV") AS atv,
        avg("UPT") AS upt
      FROM synthetic_store_atv_upt
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1
      ORDER BY ${ATV_BUCKET_ORDER_SQL}
    `)) as Array<{
      label: string;
      atv: number;
      upt: number;
    }>;

    const departmentBucketDeepDive = (await executeSql(`
      SELECT
        "Time Level - REQUIRED" AS label,
        "Department Number and Desc" AS department,
        sum("Sales Volume") AS sales_volume
      FROM synthetic_store_departments
      WHERE "Location Number and Desc" IN (${locationsSql})
      GROUP BY 1, 2
    `)) as Array<{
      label: string;
      department: string;
      sales_volume: number;
    }>;

    return NextResponse.json({
      role,
      period,
      availableLocations: allLocations,
      scopeLocations,
      metricLocations,
      view: metricLocations.length === 1 ? "store" : "portfolio",
      kpis: {
        sales: toNumber(salesRows[0]?.sales),
        quantity: toNumber(salesRows[0]?.qty),
        grossMarginAmount: toNumber(grossRows[0]?.gross_margin_amt),
        grossMarginPercent: toNumber(grossRows[0]?.gross_margin_pct),
        inventoryScore: toNumber(grossRows[0]?.inventory_score),
        weeksOfSupply: toNumber(grossRows[0]?.weeks_of_supply),
        atv: toNumber(atvRows[0]?.atv),
        basketSize: toNumber(atvRows[0]?.upt),
      },
      departments: {
        top: topDepartments.map((row) => ({
          department: row.department,
          salesVolume: toNumber(row.sales_volume),
        })),
        bottom: bottomDepartments.map((row) => ({
          department: row.department,
          salesVolume: toNumber(row.sales_volume),
        })),
      },
      trends: {
        sales: salesTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        quantity: qtyTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        grossMargin: grossTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        inventoryScore: inventoryTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        weeksOfSupply: weeksTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        atv: atvTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
        basketSize: uptTrend.map((row) => ({
          label: row.label,
          value: toNumber(row.value),
        })),
      },
      deepDive: {
        daily: {
          sales: dailyDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.sales),
          })),
          quantity: dailyDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.quantity),
          })),
          clearanceSales: dailyDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.clearance_sales),
          })),
          clearanceSalesPct: dailyDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.clearance_sales_pct),
          })),
        },
        bucket: {
          sales: salesBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.sales),
          })),
          quantity: salesBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.quantity),
          })),
          clearanceSales: salesBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.clearance_sales),
          })),
          clearanceSalesPct: salesBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.clearance_sales_pct),
          })),
          grossMargin: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.gross_margin),
          })),
          grossMarginPct: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.gross_margin_pct),
          })),
          inventoryScore: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.inventory_score),
          })),
          weeksOfSupply: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.weeks_of_supply),
          })),
          totalSellThrough: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.total_sell_through),
          })),
          regularSellThrough: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.regular_sell_through),
          })),
          clearanceSellThrough: grossBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.clearance_sell_through),
          })),
          atv: atvBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.atv),
          })),
          upt: atvBucketDeepDive.map((row) => ({
            label: row.label,
            value: toNumber(row.upt),
          })),
        },
        departmentsByBucket: departmentBucketDeepDive.map((row) => ({
          label: row.label,
          department: row.department,
          value: toNumber(row.sales_volume),
        })),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
