import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ensureDatasetLoaded,
  executeSql,
  getDatasetContext,
  getLocationMatch,
  getInitStatus,
  getSchemaSummary,
} from "@/lib/dataset";

export const runtime = "nodejs";

const sqlAgentInstructions =
  "You convert questions into SQL for SQLite. Use only the provided schema. " +
  "Return a single SQL query and nothing else. Prefer LIMIT 200 for non-aggregate queries. " +
  "Always double-quote column names that contain spaces or symbols (e.g., \"Department Number and Desc\"). " +
  "For dates, use SQLite functions such as date(...), datetime(...), and strftime(format, value). " +
  "SQLite strftime signature is strftime(format, date_or_timestamp). " +
  "Use SQLite date math like date('now', '-1 year'); do not use INTERVAL, dateadd, or date_sub. " +
  "For ATV/UPT, use the synthetic_store_atv_upt table and filter by Bucket (YESTERDAY, WTD, MTD, YTD) as needed. " +
  "For department performance, use the synthetic_store_departments table and filter by Time Level - REQUIRED as needed. " +
  "Use synthetic_store_sales_margin only for sales questions with buckets like WTD/MTD/YTD. " +
  "For sales by specific date/week/month, use synthetic_store_daily and summarize as needed. " +
  "For any margin questions, use synthetic_store_gross_margin. " +
  "Do not join department queries with other tables unless explicitly requested (e.g., find top store by sales then show its top department). " +
  "When combining tables, join on Location Number and Desc.";

const answerAgentInstructions =
  "You answer questions using only the SQL results provided. " +
  "If results are empty, say that no matching rows were found.";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatContext = {
  role?: string;
  period?: string;
  selectedLocation?: string;
  scopeLocations?: string[];
  viewMode?: string;
  portfolioSummary?: string;
  memorySummary?: string;
  screen?: string;
  selectedKpi?: string;
};

export async function POST(req: Request) {
  try {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey =
      process.env.AZURE_OPENAI_CHAT_API_KEY ||
      process.env.AZURE_OPENAI_API_KEY;
    const deploymentName = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
    const chatBaseUrl = process.env.AZURE_OPENAI_CHAT_BASE_URL;

    if ((!endpoint && !chatBaseUrl) || !apiKey || !deploymentName) {
      return NextResponse.json(
        {
          error:
            "Missing Azure OpenAI config. Required: AZURE_OPENAI_CHAT_BASE_URL (or AZURE_OPENAI_ENDPOINT), AZURE_OPENAI_CHAT_API_KEY (or AZURE_OPENAI_API_KEY fallback), and AZURE_OPENAI_CHAT_DEPLOYMENT.",
        },
        { status: 500 },
      );
    }

    const client = new OpenAI({
      baseURL:
        chatBaseUrl ||
        `${endpoint?.replace(/\/$/, "")}/openai/v1`,
      apiKey,
    });

    const createChatCompletion = async (
      messages: Array<{ role: "developer" | "user"; content: string }>,
    ) => {
      const completion = await client.chat.completions.create({
        model: deploymentName,
        messages,
      });
      return completion.choices[0]?.message?.content ?? "";
    };

    const body = (await req.json()) as {
      messages?: ChatMessage[];
      context?: ChatContext;
    };
    const messages = body.messages ?? [];
    const context = body.context;
    const scopeLocations = (context?.scopeLocations ?? []).filter(Boolean);
    const selectedLocation = context?.selectedLocation;
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUserMessage?.content) {
      return NextResponse.json(
        { error: "No user message provided." },
        { status: 400 },
      );
    }

    const requestedLocation = getLocationMatch(lastUserMessage.content);
    if (
      requestedLocation &&
      scopeLocations.length > 0 &&
      !scopeLocations.includes(requestedLocation)
    ) {
      return NextResponse.json({
        reply:
          `That store is outside your portfolio scope. ` +
          `You can ask about: ${scopeLocations.join(", ")}.`,
        sql: "",
      });
    }

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

    const schema = getSchemaSummary();
    if (!schema) {
      return NextResponse.json(
        { error: "No tables found. Check the data file." },
        { status: 400 },
      );
    }

  const datasetContext = getDatasetContext();
  const locationMatch =
    requestedLocation && scopeLocations.includes(requestedLocation)
      ? requestedLocation
      : null;
  const wantsAtvUpt = /\b(atv|upt)\b/i.test(lastUserMessage.content);
  const wantsDepartment = /\bdepartment|dept\b/i.test(lastUserMessage.content);
  const wantsMargin = /\bmargin\b/i.test(lastUserMessage.content);
  const wantsSales = /\b(net sales|sales|revenue)\b/i.test(lastUserMessage.content);
  const bucketHints =
    /\b(ytd|mtd|wtd|qtd|htd|wk|lw|dy)\b/i.test(lastUserMessage.content) ||
    /\b(year to date|month to date|week to date|quarter to date|half to date)\b/i.test(
      lastUserMessage.content,
    );
  const dateHints =
    /\b(daily|by day|per day|on \d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/i.test(
      lastUserMessage.content,
    ) ||
    /\b(week|month)\b/i.test(lastUserMessage.content);
  const monthYearHints =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      lastUserMessage.content,
    ) && /\b(20\d{2}|19\d{2})\b/.test(lastUserMessage.content);
  const wantsDeptAndSales = wantsDepartment && wantsSales;

  const sqlPrompt = [
    context
      ? `User context:\n${JSON.stringify(context, null, 2)}`
      : "User context: none",
    scopeLocations.length
      ? `Security scope: Only use these locations in any query: ${scopeLocations.join(" | ")}. ` +
        `Always constrain with an exact filter on "Location Number and Desc" using only these values.`
      : "Security scope: none",
    selectedLocation
      ? `Current view location: ${selectedLocation}. If question is ambiguous, prioritize this store.`
      : "Current view location: portfolio aggregate",
    "",
    datasetContext,
    wantsAtvUpt
      ? "Routing hint: This question is about ATV/UPT. Use the synthetic_store_atv_upt table."
      : wantsDeptAndSales
        ? "Routing hint: This question asks for sales plus department. Use synthetic_store_daily to find the store, then join synthetic_store_departments on Location Number and Desc (use MTD if month-to-date is mentioned)."
        : wantsDepartment
          ? "Routing hint: This question is about departments. Use the synthetic_store_departments table only."
        : wantsMargin
          ? "Routing hint: This question is about margin. Use the synthetic_store_gross_margin table."
          : wantsSales && bucketHints && !dateHints && !monthYearHints
            ? "Routing hint: This is a sales question with time buckets. Use the synthetic_store_sales_margin table."
            : wantsSales && (dateHints || monthYearHints)
              ? "Routing hint: This is a sales question by date/week/month. Use the synthetic_store_daily table."
              : dateHints || monthYearHints
                ? "Routing hint: This question is daily/by date/week/month. Use the synthetic_store_daily table."
                : "Routing hint: Use synthetic_store_daily unless the question is explicitly about ATV/UPT, departments, margin, or sales buckets.",
    locationMatch
      ? `Location hint: The user likely refers to "${locationMatch}". Use an exact match on "Location Number and Desc".`
      : "Location hint: none",
      "",
      "Schema:",
      schema,
      "",
      `Question: ${lastUserMessage.content}`,
      "SQL:",
    ].join("\n");

    const rawSql = (
      await createChatCompletion([
        { role: "developer", content: sqlAgentInstructions },
        { role: "user", content: sqlPrompt },
      ])
    ).trim();
    const sql = rawSql
      .replace(/```sql|```/gi, "")
      .replace(/\[([^\]]+)\]/g, (_match, name) => `"${name.replace(/"/g, '""')}"`)
      .trim();

    if (!sql) {
      return NextResponse.json(
        { error: "Failed to generate SQL." },
        { status: 500 },
      );
    }

    const rows = await executeSql(sql);

    const answerPrompt = [
      `Question: ${lastUserMessage.content}`,
      `SQL: ${sql}`,
      `Results: ${JSON.stringify(rows)}`,
      "Answer:",
    ].join("\n");

    const answerText = await createChatCompletion([
        { role: "developer", content: answerAgentInstructions },
        { role: "user", content: answerPrompt },
      ]);

    return NextResponse.json({
      reply: answerText,
      sql,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
