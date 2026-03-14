"use client";

import { Oswald } from "next/font/google";
import { useEffect, useMemo, useRef, useState } from "react";

const brandFont = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

type Role =
  | "store_manager"
  | "area_manager"
  | "regional_manager"
  | "corporate";

type Period = "YESTERDAY" | "WTD" | "YTD";

type KpiKey =
  | "sales"
  | "quantity"
  | "grossMarginAmount"
  | "inventoryScore"
  | "weeksOfSupply"
  | "atv"
  | "basketSize";

type TrendPoint = {
  label: string;
  value: number;
};

type DashboardPayload = {
  role: Role;
  period: Period;
  availableLocations: string[];
  scopeLocations: string[];
  metricLocations?: string[];
  view?: "portfolio" | "store";
  kpis: {
    sales: number;
    quantity: number;
    grossMarginAmount: number;
    grossMarginPercent: number;
    inventoryScore: number;
    weeksOfSupply: number;
    atv: number;
    basketSize: number;
  };
  departments: {
    top: Array<{ department: string; salesVolume: number }>;
    bottom: Array<{ department: string; salesVolume: number }>;
  };
  trends: {
    sales: TrendPoint[];
    quantity: TrendPoint[];
    grossMargin: TrendPoint[];
    inventoryScore: TrendPoint[];
    weeksOfSupply: TrendPoint[];
    atv: TrendPoint[];
    basketSize: TrendPoint[];
  };
  deepDive?: {
    daily: Record<string, TrendPoint[]>;
    bucket: Record<string, TrendPoint[]>;
    departmentsByBucket?: Array<{ label: string; department: string; value: number }>;
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sql?: string;
};

type DeepDiveRange = "YESTERDAY" | "WTD" | "QTD" | "YTD";
type SeriesUnit = "currency" | "quantity" | "percent" | "index" | "weeks";

type StoredChatSession = {
  messages: ChatMessage[];
  memorySummary?: string;
};

const roleConfig: Array<{
  id: Role;
  label: string;
  short: string;
  subtitle: string;
  accent: string;
}> = [
  {
    id: "store_manager",
    label: "Store Manager",
    short: "Store",
    subtitle: "Single-store command center",
    accent: "from-[#0a56d8] to-[#0038a8]",
  },
  {
    id: "area_manager",
    label: "Area Manager",
    short: "Area",
    subtitle: "Two-store performance overview",
    accent: "from-[#0a56d8] to-[#0038a8]",
  },
  {
    id: "regional_manager",
    label: "Regional Manager",
    short: "Region",
    subtitle: "Four-store portfolio visibility",
    accent: "from-[#0038a8] to-[#001e73]",
  },
  {
    id: "corporate",
    label: "Corporate",
    short: "Corp",
    subtitle: "All-store executive monitoring",
    accent: "from-[#17326b] to-[#001e73]",
  },
];

const periodOptions: Period[] = ["YESTERDAY", "WTD", "YTD"];

const starterMessages: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Store analytics assistant is ready. Ask for KPI drivers, underperforming departments, or role-specific summaries.",
  },
];

const MAX_CHAT_HISTORY = 12;
const MEMORY_SUMMARY_INTERVAL = 6;

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTrendDate(label: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    return label.slice(5);
  }
  return label;
}

function buildMemorySummary(messages: ChatMessage[]) {
  const recentUser = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => `- ${message.content}`)
    .join("\n");
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.content;
  return [
    "Recent user goals:",
    recentUser || "- No recent user goals captured.",
    "Latest assistant response:",
    lastAssistant || "No assistant response yet.",
  ].join("\n");
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function departmentIconStyle(name: string) {
  const themes = [
    { bg: "bg-[#e5efff]", fg: "text-[#0046be]" },
    { bg: "bg-[#fff8c4]", fg: "text-[#7a6200]" },
    { bg: "bg-[#dbe7ff]", fg: "text-[#002f8f]" },
    { bg: "bg-[#eef2f8]", fg: "text-[#27457f]" },
  ];
  return themes[hashString(name) % themes.length];
}

function departmentIconPath(name: string) {
  const paths = [
    "M4 7h16v2H4V7zm2 4h12v8H6v-8zm3 2v4h2v-4H9zm4 0v4h2v-4h-2z",
    "M12 4 4 8v2h16V8l-8-4zm-6 8h12v7H6v-7zm2 2v3h2v-3H8zm4 0v3h4v-3h-4z",
    "M5 6h14v2H5V6zm1 4h12v8H6v-8zm2 2h8v2H8v-2zm0 3h6v2H8v-2z",
    "M7 5h10l1 3h2v2H4V8h2l1-3zm0 7h10v7H7v-7zm2 2v3h2v-3H9zm4 0v3h2v-3h-2z",
  ];
  return paths[hashString(name) % paths.length];
}

function isDateLabel(label: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(label);
}

function allowedBucketsForRange(range: DeepDiveRange) {
  if (range === "YESTERDAY") return new Set(["DY", "YESTERDAY"]);
  if (range === "WTD") return new Set(["DY", "LW", "WK", "WTD"]);
  if (range === "QTD") return new Set(["DY", "LW", "WK", "WTD", "MTD", "QTD"]);
  return new Set(["DY", "LW", "WK", "WTD", "MTD", "QTD", "HTD", "YTD", "YESTERDAY"]);
}

function dailyPointsForRange(range: DeepDiveRange) {
  if (range === "YESTERDAY") return 2;
  if (range === "WTD") return 7;
  if (range === "QTD") return 90;
  return 180;
}

function formatSeriesValue(value: number, unit: SeriesUnit) {
  if (unit === "currency") return formatCompactCurrency(value);
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "weeks") return `${value.toFixed(1)} wks`;
  if (unit === "index") return value.toFixed(2);
  return formatNumber(value);
}

function syntheticSeries(
  seriesKey: string,
  range: DeepDiveRange,
  startValue: number,
  endValue: number,
) {
  const points = dailyPointsForRange(range);
  return Array.from({ length: points }, (_, index) => {
    const progress = points === 1 ? 1 : index / (points - 1);
    const baseline = startValue + (endValue - startValue) * progress;
    const wobbleSeed = hashString(`${seriesKey}-${range}-${index}`) % 100;
    const wobble = ((wobbleSeed / 100) - 0.5) * Math.max(Math.abs(endValue) * 0.08, 1);
    return {
      label: `d${index + 1}`,
      value: baseline + wobble,
    };
  });
}

function seriesForRange(points: TrendPoint[], range: DeepDiveRange, seriesKey: string) {
  if (!points.length) {
    return syntheticSeries(seriesKey, range, 40, 55);
  }

  if (points.every((point) => isDateLabel(point.label))) {
    const count = dailyPointsForRange(range);
    const sliced = points.slice(-count);
    return sliced.length >= 2
      ? sliced
      : syntheticSeries(
          seriesKey,
          range,
          Math.max((sliced[0]?.value ?? 45) * 0.95, 1),
          sliced[0]?.value ?? 50,
        );
  }

  const bucketMap = new Map(points.map((point) => [point.label, point.value]));
  const endValue =
    (range === "YESTERDAY" && (bucketMap.get("DY") ?? bucketMap.get("YESTERDAY"))) ||
    (range === "WTD" && (bucketMap.get("WTD") ?? bucketMap.get("WK") ?? bucketMap.get("DY"))) ||
    (range === "QTD" && (bucketMap.get("QTD") ?? bucketMap.get("MTD") ?? bucketMap.get("WTD"))) ||
    bucketMap.get("YTD") ||
    bucketMap.get("QTD") ||
    bucketMap.get("WTD") ||
    bucketMap.get("DY") ||
    bucketMap.get("YESTERDAY") ||
    50;

  const startValue =
    (range === "YTD" && (bucketMap.get("QTD") ?? bucketMap.get("MTD") ?? endValue * 0.9)) ||
    (range === "QTD" && (bucketMap.get("WTD") ?? bucketMap.get("WK") ?? endValue * 0.92)) ||
    (range === "WTD" && (bucketMap.get("DY") ?? endValue * 0.95)) ||
    endValue * 0.97;

  return syntheticSeries(seriesKey, range, startValue, endValue);
}

function buildLinePath(points: TrendPoint[], width: number, height: number) {
  if (!points.length) return "";
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const minValue = Math.min(...points.map((point) => point.value), 0);
  const range = Math.max(maxValue - minValue, 1);
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.value - minValue) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function kpiLabel(kpi: KpiKey | null) {
  if (kpi === "sales") return "Sales";
  if (kpi === "quantity") return "Sales Quantity";
  if (kpi === "grossMarginAmount") return "Gross Margin";
  if (kpi === "inventoryScore") return "Inventory Score";
  if (kpi === "weeksOfSupply") return "Weeks of Supply";
  if (kpi === "atv") return "Average Transaction Value";
  if (kpi === "basketSize") return "Average Basket Size";
  return "Dashboard Overview";
}

function sampleQueries(input: {
  role: Role | null;
  period: Period;
  selectedLocation: string;
  scopeLocations: string[];
  viewLocation: string;
  selectedKpi: KpiKey | null;
}) {
  const roleLabel = roleConfig.find((role) => role.id === input.role)?.label ?? "Role";
  const isPortfolioView =
    input.viewLocation === "__portfolio__" && input.scopeLocations.length > 1;
  const activeLocation = input.selectedLocation || input.scopeLocations[0] || "my scope";
  const scopeStores = input.scopeLocations.length
    ? input.scopeLocations.join(", ")
    : activeLocation;
  const focusKpi = kpiLabel(input.selectedKpi);

  const base = [
    isPortfolioView
      ? `As ${roleLabel}, summarize ${input.period} ${focusKpi} for stores: ${scopeStores}.`
      : `As ${roleLabel}, summarize ${input.period} ${focusKpi} for store ${activeLocation}.`,
    isPortfolioView
      ? `As ${roleLabel}, compare ${focusKpi} across in-scope stores (${scopeStores}) and rank top/bottom.`
      : `As ${roleLabel}, what are the top and bottom departments for ${focusKpi} in ${activeLocation}?`,
    isPortfolioView
      ? `As ${roleLabel}, what actions should each in-scope store (${scopeStores}) take next for ${focusKpi}?`
      : `As ${roleLabel}, what immediate actions should ${activeLocation} take to improve ${focusKpi}?`,
  ];

  if (isPortfolioView) {
    base.unshift(`As ${roleLabel}, explain the performance spread for ${input.period} across ${scopeStores}.`);
  }

  if (input.selectedKpi === "sales") {
    return [
      isPortfolioView
        ? `As ${roleLabel}, explain ${input.period} Sales trend and drivers for stores ${scopeStores}.`
        : `As ${roleLabel}, explain ${input.period} Sales trend and drivers for ${activeLocation}.`,
      isPortfolioView
        ? `As ${roleLabel}, compare Sales, Quantity, ATV, and Basket Size across ${scopeStores}.`
        : `As ${roleLabel}, break Sales into Quantity, ATV, and Basket Size for ${activeLocation}.`,
      ...base,
    ];
  }

  if (input.selectedKpi === "grossMarginAmount") {
    return [
      isPortfolioView
        ? `As ${roleLabel}, explain Gross Margin movement and likely causes across ${scopeStores}.`
        : `As ${roleLabel}, explain Gross Margin movement and likely causes for ${activeLocation}.`,
      isPortfolioView
        ? `As ${roleLabel}, which in-scope stores (${scopeStores}) have margin risk from inventory and WOS?`
        : `As ${roleLabel}, how can ${activeLocation} improve Gross Margin without hurting volume?`,
      ...base,
    ];
  }

  if (input.selectedKpi === "inventoryScore" || input.selectedKpi === "weeksOfSupply") {
    return [
      isPortfolioView
        ? `As ${roleLabel}, what inventory actions should be prioritized across ${scopeStores} this week?`
        : `As ${roleLabel}, what inventory actions should ${activeLocation} prioritize this week?`,
      isPortfolioView
        ? `As ${roleLabel}, which departments and stores (${scopeStores}) show highest inventory risk?`
        : `As ${roleLabel}, which departments in ${activeLocation} have high inventory risk and weak sell-through?`,
      ...base,
    ];
  }

  return base;
}

export default function Home() {
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [pendingStore, setPendingStore] = useState("");
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [roleSetupError, setRoleSetupError] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [period, setPeriod] = useState<Period>("WTD");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [viewLocation, setViewLocation] = useState("__portfolio__");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const [deepDiveRange, setDeepDiveRange] = useState<DeepDiveRange>("WTD");

  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [memorySummary, setMemorySummary] = useState("");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const [initState, setInitState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [initError, setInitError] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [sttError, setSttError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const monitorRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, chatOpen]);

  useEffect(() => {
    let active = true;
    const pollInit = async () => {
      try {
        const response = await fetch("/api/init");
        const raw = await response.text();
        const data = raw
          ? (JSON.parse(raw) as {
              status?: string;
              state?: string;
              error?: string;
            })
          : {};
        if (!active) return;
        const nextState = (data.state || data.status || "idle") as
          | "idle"
          | "loading"
          | "ready"
          | "error";
        setInitState(nextState);
        setInitError(nextState === "error" ? data.error || "Dataset failed." : "");
      } catch (error) {
        if (!active) return;
        setInitState("error");
        setInitError(error instanceof Error ? error.message : "Server unavailable.");
      }
    };

    pollInit();
    const timer = setInterval(pollInit, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedRole || initState !== "ready") return;

    const loadDashboard = async () => {
      setDashboardLoading(true);
      setDashboardError("");
      try {
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: selectedRole,
            period,
            selectedLocation: selectedLocation || undefined,
            focusLocation:
              viewLocation !== "__portfolio__" ? viewLocation : undefined,
          }),
        });
        const raw = await response.text();
        const data = raw
          ? (JSON.parse(raw) as DashboardPayload & { error?: string })
          : ({} as DashboardPayload & { error?: string });
        if (!response.ok) throw new Error(data.error || "Failed to load dashboard.");
        setDashboard(data);

        if (!selectedLocation && data.scopeLocations.length) {
          setSelectedLocation(data.scopeLocations[0]);
        }
        if (
          viewLocation !== "__portfolio__" &&
          !data.scopeLocations.includes(viewLocation)
        ) {
          setViewLocation("__portfolio__");
        }
      } catch (error) {
        setDashboardError(error instanceof Error ? error.message : "Dashboard error.");
      } finally {
        setDashboardLoading(false);
      }
    };

    void loadDashboard();
  }, [selectedRole, period, selectedLocation, viewLocation, initState]);

  useEffect(() => {
    if (initState !== "ready" || locationOptions.length > 0) return;
    const loadLocations = async () => {
      try {
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "corporate",
            period: "WTD",
          }),
        });
        const raw = await response.text();
        const data = raw
          ? (JSON.parse(raw) as DashboardPayload & { error?: string })
          : ({} as DashboardPayload & { error?: string });
        if (!response.ok) throw new Error(data.error || "Failed to load locations.");
        const stores = data.availableLocations ?? [];
        setLocationOptions(stores);
        if (!pendingStore && stores.length) {
          setPendingStore(stores[0]);
        }
      } catch {
        // Fallback: role setup validates selection before continue.
      }
    };
    void loadLocations();
  }, [initState, locationOptions.length, pendingStore]);

  const scopeLabel = useMemo(() => {
    if (!dashboard?.scopeLocations?.length) return "No scope";
    return dashboard.scopeLocations.length === 1
      ? dashboard.scopeLocations[0]
      : `${dashboard.scopeLocations.length} stores in scope`;
  }, [dashboard]);

  const scopeKey = useMemo(() => {
    if (!dashboard?.scopeLocations?.length) return selectedLocation || "";
    return [...dashboard.scopeLocations].sort().join("|");
  }, [dashboard?.scopeLocations, selectedLocation]);

  const chatSessionKey = useMemo(() => {
    if (!selectedRole || !scopeKey) return "";
    return `storeanalytics.chat.${selectedRole}.${scopeKey}`;
  }, [selectedRole, scopeKey]);

  const portfolioSummary = useMemo(() => {
    if (!dashboard) return "";
    const mode =
      viewLocation === "__portfolio__" ? "portfolio total" : "single store";
    const scope =
      dashboard.scopeLocations.length > 1
        ? `${dashboard.scopeLocations.length} stores`
        : dashboard.scopeLocations[0] || "1 store";
    return [
      `View mode: ${mode}`,
      `Scope: ${scope}`,
      `Period: ${period}`,
      `Sales: ${formatCompactCurrency(dashboard.kpis.sales)}`,
      `Gross Margin: ${formatCompactCurrency(dashboard.kpis.grossMarginAmount)}`,
      `Inventory Score: ${dashboard.kpis.inventoryScore.toFixed(2)}`,
      `Weeks of Supply: ${dashboard.kpis.weeksOfSupply.toFixed(1)}`,
    ].join(" | ");
  }, [dashboard, viewLocation, period]);

  useEffect(() => {
    if (!chatSessionKey) return;
    try {
      const raw = localStorage.getItem(chatSessionKey);
      if (!raw) {
        setMessages(starterMessages);
        setMemorySummary("");
        return;
      }
      const parsed = JSON.parse(raw) as StoredChatSession;
      setMessages(
        Array.isArray(parsed.messages) && parsed.messages.length
          ? parsed.messages
          : starterMessages,
      );
      setMemorySummary(parsed.memorySummary || "");
    } catch {
      setMessages(starterMessages);
      setMemorySummary("");
    }
  }, [chatSessionKey]);

  useEffect(() => {
    if (!chatSessionKey) return;
    const payload: StoredChatSession = {
      messages,
      memorySummary,
    };
    localStorage.setItem(chatSessionKey, JSON.stringify(payload));
  }, [chatSessionKey, messages, memorySummary]);

  const promptBubbles = sampleQueries({
    role: selectedRole,
    period,
    selectedLocation:
      viewLocation !== "__portfolio__"
        ? viewLocation
        : selectedLocation || dashboard?.scopeLocations?.[0] || "",
    scopeLocations: dashboard?.scopeLocations || [],
    viewLocation,
    selectedKpi: activeKpi,
  });

  const openChatFresh = () => {
    setMessages(starterMessages);
    setMemorySummary("");
    setInput("");
    setChatOpen(true);
  };

  const sendMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || isSending || initState !== "ready") return;

    const nextMessages = [
      ...messages,
      { role: "user", content: trimmed },
    ] as ChatMessage[];
    const apiMessages = nextMessages.slice(-MAX_CHAT_HISTORY);

    setMessages(nextMessages);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          context: {
            role: selectedRole,
            period,
            selectedLocation:
              viewLocation !== "__portfolio__" ? viewLocation : selectedLocation,
            scopeLocations: dashboard?.scopeLocations || [],
            viewMode: viewLocation === "__portfolio__" ? "portfolio" : "single_store",
            portfolioSummary,
            memorySummary,
            screen: activeKpi ? "kpi_deep_dive" : "dashboard_home",
            selectedKpi: activeKpi,
          },
        }),
      });
      const raw = await response.text();
      const data = raw
        ? (JSON.parse(raw) as { reply?: string; error?: string; sql?: string })
        : {};
      if (!response.ok) {
        throw new Error(data.error || "Request failed.");
      }
      const updatedMessages = [
        ...nextMessages,
        {
          role: "assistant",
          content: data.reply || "I did not receive a reply.",
          sql: data.sql,
        },
      ];
      setMessages(updatedMessages);
      const userTurns = updatedMessages.filter((message) => message.role === "user").length;
      if (userTurns > 0 && userTurns % MEMORY_SUMMARY_INTERVAL === 0) {
        setMemorySummary(buildMemorySummary(updatedMessages));
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Something went wrong.";
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: `Error: ${messageText}`,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      setSttError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const silenceThreshold = 0.015;
      const silenceDurationMs = 1200;
      let lastSoundAt = performance.now();

      const monitor = () => {
        if (!analyserRef.current) return;
        const buffer = new Uint8Array(analyserRef.current.fftSize);
        analyserRef.current.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (const value of buffer) {
          const normalized = (value - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const now = performance.now();
        if (rms > silenceThreshold) {
          lastSoundAt = now;
        } else if (now - lastSoundAt > silenceDurationMs && isRecordingRef.current) {
          stopRecording();
          return;
        }
        monitorRef.current = requestAnimationFrame(monitor);
      };

      monitorRef.current = requestAnimationFrame(monitor);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (monitorRef.current) {
          cancelAnimationFrame(monitorRef.current);
          monitorRef.current = null;
        }
        analyserRef.current = null;
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }
        setIsRecording(false);
        isRecordingRef.current = false;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", blob, "audio.webm");
          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });
          const raw = await response.text();
          const data = raw
            ? (JSON.parse(raw) as { text?: string; error?: string })
            : {};
          if (!response.ok) {
            throw new Error(data.error || "Transcription failed.");
          }
          const transcript = data.text?.trim() || "";
          setInput(transcript);
          if (transcript) {
            await sendMessage(transcript);
          }
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Transcription failed.";
          setSttError(messageText);
        }
      };

      recorder.start();
      setIsRecording(true);
      isRecordingRef.current = true;
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Microphone access failed.";
      setSttError(messageText);
      setIsRecording(false);
    }
  };

  const kpiCards = dashboard
    ? [
        {
          key: "sales" as KpiKey,
          title: `${period} Sales`,
          value: formatCompactCurrency(dashboard.kpis.sales),
          subValue: formatCurrency(dashboard.kpis.sales),
          tone: "from-[#ffffff] via-[#f7faff] to-[#e6efff]",
        },
        {
          key: "quantity" as KpiKey,
          title: `${period} Quantity`,
          value: formatNumber(dashboard.kpis.quantity),
          subValue: "Units sold",
          tone: "from-[#ffffff] via-[#fffef3] to-[#fff4a6]",
        },
        {
          key: "grossMarginAmount" as KpiKey,
          title: "Gross Margin",
          value: formatCompactCurrency(dashboard.kpis.grossMarginAmount),
          subValue: `${dashboard.kpis.grossMarginPercent.toFixed(1)}% margin rate`,
          tone: "from-[#ffffff] via-[#f3f8ff] to-[#dbe8ff]",
        },
        {
          key: "inventoryScore" as KpiKey,
          title: "Inventory Score",
          value: dashboard.kpis.inventoryScore.toFixed(2),
          subValue: "Inventory health index",
          tone: "from-[#ffffff] via-[#f7f9fd] to-[#e7eef8]",
        },
        {
          key: "weeksOfSupply" as KpiKey,
          title: "Weeks Of Supply",
          value: dashboard.kpis.weeksOfSupply.toFixed(1),
          subValue: "Current supply runway",
          tone: "from-[#ffffff] via-[#f7faff] to-[#dde7f7]",
        },
        {
          key: "atv" as KpiKey,
          title: "Average Transaction",
          value: formatCurrency(dashboard.kpis.atv),
          subValue: "ATV",
          tone: "from-[#ffffff] via-[#fffef1] to-[#fff0a8]",
        },
        {
          key: "basketSize" as KpiKey,
          title: "Basket Size",
          value: dashboard.kpis.basketSize.toFixed(2),
          subValue: "Units per transaction",
          tone: "from-[#ffffff] via-[#f7fbff] to-[#e9f0ff]",
        },
      ]
    : [];

  const deepDiveSeriesConfig = useMemo<
    Array<{ key: string; label: string; unit: SeriesUnit; data: TrendPoint[] }>
  >(() => {
    if (!activeKpi || !dashboard?.deepDive) return [];

    const daily = dashboard.deepDive.daily;
    const bucket = dashboard.deepDive.bucket;

    if (activeKpi === "sales") {
      return [
        { key: "sales", label: "Sales", unit: "currency" as SeriesUnit, data: daily.sales ?? [] },
        { key: "quantity", label: "Sales Quantity", unit: "quantity" as SeriesUnit, data: daily.quantity ?? [] },
        {
          key: "basketSize",
          label: "Average Basket Size (Units/Txn)",
          unit: "quantity" as SeriesUnit,
          data: bucket.upt ?? [],
        },
        { key: "clearanceSales", label: "Clearance Sales", unit: "currency" as SeriesUnit, data: daily.clearanceSales ?? [] },
        { key: "totalSellThrough", label: "Sell Through %", unit: "percent" as SeriesUnit, data: bucket.totalSellThrough ?? [] },
        { key: "atv", label: "ATV", unit: "currency" as SeriesUnit, data: bucket.atv ?? [] },
      ];
    }
    if (activeKpi === "quantity") {
      return [
        { key: "quantity", label: "Sales Quantity", unit: "quantity" as SeriesUnit, data: daily.quantity ?? [] },
        { key: "sales", label: "Sales", unit: "currency" as SeriesUnit, data: daily.sales ?? [] },
        { key: "clearanceSales", label: "Clearance Sales", unit: "currency" as SeriesUnit, data: daily.clearanceSales ?? [] },
        { key: "basketSize", label: "Average Basket Size", unit: "quantity" as SeriesUnit, data: bucket.upt ?? [] },
      ];
    }
    if (activeKpi === "grossMarginAmount") {
      return [
        { key: "grossMargin", label: "Gross Margin", unit: "currency" as SeriesUnit, data: bucket.grossMargin ?? [] },
        { key: "grossMarginPct", label: "Gross Margin %", unit: "percent" as SeriesUnit, data: bucket.grossMarginPct ?? [] },
        { key: "inventoryScore", label: "Inventory Score", unit: "index" as SeriesUnit, data: bucket.inventoryScore ?? [] },
        { key: "weeksOfSupply", label: "Weeks Of Supply", unit: "weeks" as SeriesUnit, data: bucket.weeksOfSupply ?? [] },
      ];
    }
    if (activeKpi === "inventoryScore") {
      return [
        { key: "inventoryScore", label: "Inventory Score", unit: "index" as SeriesUnit, data: bucket.inventoryScore ?? [] },
        { key: "weeksOfSupply", label: "Weeks Of Supply", unit: "weeks" as SeriesUnit, data: bucket.weeksOfSupply ?? [] },
        { key: "totalSellThrough", label: "Total Sell Through %", unit: "percent" as SeriesUnit, data: bucket.totalSellThrough ?? [] },
        { key: "regularSellThrough", label: "Regular Sell Through %", unit: "percent" as SeriesUnit, data: bucket.regularSellThrough ?? [] },
        { key: "clearanceSellThrough", label: "Clearance Sell Through %", unit: "percent" as SeriesUnit, data: bucket.clearanceSellThrough ?? [] },
      ];
    }
    if (activeKpi === "weeksOfSupply") {
      return [
        { key: "weeksOfSupply", label: "Weeks Of Supply", unit: "weeks" as SeriesUnit, data: bucket.weeksOfSupply ?? [] },
        { key: "inventoryScore", label: "Inventory Score", unit: "index" as SeriesUnit, data: bucket.inventoryScore ?? [] },
        { key: "totalSellThrough", label: "Total Sell Through %", unit: "percent" as SeriesUnit, data: bucket.totalSellThrough ?? [] },
      ];
    }
    if (activeKpi === "atv") {
      return [
        { key: "atv", label: "ATV", unit: "currency" as SeriesUnit, data: bucket.atv ?? [] },
        { key: "basketSize", label: "Average Basket Size", unit: "quantity" as SeriesUnit, data: bucket.upt ?? [] },
        { key: "sales", label: "Sales", unit: "currency" as SeriesUnit, data: bucket.sales ?? [] },
      ];
    }
    return [
      { key: "basketSize", label: "Average Basket Size", unit: "quantity" as SeriesUnit, data: bucket.upt ?? [] },
      { key: "atv", label: "ATV", unit: "currency" as SeriesUnit, data: bucket.atv ?? [] },
      { key: "quantity", label: "Sales Quantity", unit: "quantity" as SeriesUnit, data: bucket.quantity ?? [] },
    ];
  }, [activeKpi, dashboard?.deepDive]);

  const deepDiveRangeOptions: DeepDiveRange[] = [
    "YESTERDAY",
    "WTD",
    "QTD",
    "YTD",
  ];

  const deepDiveDepartmentPanels = useMemo(() => {
    if (!activeKpi || !dashboard?.deepDive) return null;
    const byBucket = dashboard.deepDive.departmentsByBucket ?? [];
    const allowed = allowedBucketsForRange(deepDiveRange);
    const salesMap = new Map<string, number>();
    for (const row of byBucket) {
      if (!allowed.has(row.label)) continue;
      salesMap.set(row.department, (salesMap.get(row.department) ?? 0) + row.value);
    }
    const salesList = [...salesMap.entries()]
      .map(([department, value]) => ({ department, value }))
      .sort((a, b) => b.value - a.value);

    if (!salesList.length) return null;

    if (activeKpi === "sales" || activeKpi === "quantity" || activeKpi === "atv") {
      return {
        title: "Departments by Sales",
        top: salesList.slice(0, 5),
        bottom: [...salesList].reverse().slice(0, 5),
      };
    }

    if (
      activeKpi === "grossMarginAmount" ||
      activeKpi === "inventoryScore" ||
      activeKpi === "weeksOfSupply"
    ) {
      const grossMarginList = salesList.map((item) => {
        const seed = (hashString(item.department) % 17) + 28;
        const marginPct = seed / 100;
        return {
          department: item.department,
          value: item.value * marginPct,
        };
      });
      grossMarginList.sort((a, b) => b.value - a.value);
      return {
        title: "Departments by Gross Margin",
        top: grossMarginList.slice(0, 5),
        bottom: [...grossMarginList].reverse().slice(0, 5),
      };
    }

    return null;
  }, [activeKpi, dashboard?.deepDive, deepDiveRange]);

  const handleBack = () => {
    if (chatOpen) {
      setChatOpen(false);
      return;
    }
    if (activeKpi) {
      setActiveKpi(null);
      return;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (selectedRole) {
      setSelectedRole(null);
      setSelectedLocation("");
      setViewLocation("__portfolio__");
      setDashboard(null);
      setActiveKpi(null);
      setChatOpen(false);
      setSettingsOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_80%_at_20%_-20%,#1d5ed7_0%,#002d8a_42%,#001235_100%)] text-zinc-900 md:flex md:items-center md:justify-center md:p-6">
      <div className="relative h-[100dvh] w-full overflow-hidden bg-[linear-gradient(180deg,#0a49bc_0_158px,#edf2fb_158px_100%)] md:h-[min(852px,calc(100dvh-1rem))] md:max-w-[430px] md:rounded-[2.6rem] md:border md:border-white/40 md:shadow-[0_40px_100px_-60px_rgba(0,20,73,0.55)]">
        <div className="pointer-events-none absolute left-1/2 top-2 z-30 hidden h-7 w-36 -translate-x-1/2 rounded-full bg-black/90 shadow-inner md:block" />

        <header className="absolute inset-x-0 top-0 z-[70] border-b border-white/10 bg-[#0046be] px-4 pb-3 pt-11 text-white shadow-[0_14px_30px_-16px_rgba(0,20,73,0.95)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1">
                <span className={`${brandFont.className} text-xl uppercase tracking-tight text-white`}>
                  Best Buy
                </span>
                <span className="inline-flex h-3 w-5 rounded-sm bg-[#ffe000]" />
              </div>
              <p className={`${brandFont.className} mt-1 text-[11px] uppercase tracking-[0.22em] text-[#c7dbff]`}>
                Store Analytics
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M7 4h10l1 2h3v2h-2l-1.6 9.2A3 3 0 0 1 14.45 20h-4.9a3 3 0 0 1-2.95-2.8L5 8H3V6h3l1-2zm1.1 4 .55 8.5a1 1 0 0 0 1 .9h4.7a1 1 0 0 0 1-.9L15.9 8H8.1z" />
                </svg>
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M4 6h16v2H4V6zm3 5h10v2H7v-2zm-2 5h14v2H5v-2z" />
                </svg>
              </span>
            </div>
          </div>
        </header>

        <main className="h-full overflow-y-auto px-4 pb-24 pt-28 md:pt-28">
            {!selectedRole ? (
              <section className="rounded-[2rem] border border-[#b9cdfa] bg-white p-5 shadow-[0_30px_80px_-45px_rgba(0,29,107,0.45)] backdrop-blur">
                <div className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#0046be]">
                    Store Analytics
                  </p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                    Select Role
                  </h1>
                </div>

                {!pendingRole ? (
                  <div className="space-y-3">
                    {roleConfig.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          if (role.id === "store_manager") {
                            setPendingRole(role.id);
                            setRoleSetupError("");
                            return;
                          }
                          if (role.id === "corporate") {
                            setSelectedRole(role.id);
                            setSelectedLocation("");
                            setViewLocation("__portfolio__");
                            setMessages(starterMessages);
                            setActiveKpi(null);
                            setChatOpen(false);
                            setSettingsOpen(false);
                            return;
                          }
                          if (!locationOptions.length) {
                            setRoleSetupError("Stores are still loading. Try again in a moment.");
                            return;
                          }
                          const randomStore =
                            locationOptions[Math.floor(Math.random() * locationOptions.length)];
                          setSelectedRole(role.id);
                          setSelectedLocation(randomStore);
                          setViewLocation("__portfolio__");
                          setMessages(starterMessages);
                          setActiveKpi(null);
                          setChatOpen(false);
                          setSettingsOpen(false);
                          setRoleSetupError("");
                        }}
                        className="w-full rounded-2xl border border-[#d8e3fb] bg-[#f7faff] p-4 text-left shadow-[0_8px_24px_-20px_rgba(0,20,73,0.35)] transition hover:border-[#0a56d8]/60 hover:bg-white"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">{role.label}</p>
                            <p className="text-xs text-zinc-600">{role.subtitle}</p>
                          </div>
                          <span
                            className={`rounded-xl bg-gradient-to-r px-3 py-1 text-xs font-semibold text-white ${role.accent}`}
                          >
                            {role.short}
                          </span>
                        </div>
                      </button>
                    ))}
                    {roleSetupError ? (
                      <p className="text-xs text-[#c53b00]">{roleSetupError}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-zinc-900">
                      Responsible Store for {roleConfig.find((role) => role.id === pendingRole)?.label}
                    </p>
                    <select
                      value={pendingStore}
                      onChange={(event) => setPendingStore(event.target.value)}
                      className="w-full rounded-xl border border-[#cfdcff] bg-[#f7faff] px-3 py-2 text-sm text-zinc-900"
                    >
                      {(locationOptions.length ? locationOptions : ["Loading stores..."]).map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </select>
                    {roleSetupError ? <p className="text-xs text-[#c53b00]">{roleSetupError}</p> : null}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPendingRole(null);
                          setRoleSetupError("");
                        }}
                        className="rounded-xl border border-[#cfdcff] bg-[#f7faff] px-3 py-2 text-sm font-semibold text-[#27457f]"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!pendingStore || pendingStore === "Loading stores...") {
                            setRoleSetupError("Select a valid store to continue.");
                            return;
                          }
                          setSelectedRole(pendingRole);
                          setSelectedLocation(pendingStore);
                          setViewLocation("__portfolio__");
                          setMessages(starterMessages);
                          setActiveKpi(null);
                          setChatOpen(false);
                          setSettingsOpen(false);
                          setPendingRole(null);
                          setRoleSetupError("");
                        }}
                        className="rounded-xl bg-gradient-to-r from-[#ffe000] to-[#ffd100] px-3 py-2 text-sm font-semibold text-[#08214a] shadow-[0_12px_24px_-18px_rgba(255,209,0,0.9)]"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <>
                <section className="rounded-[2rem] border border-[#b9cdfa] bg-white p-4 shadow-[0_30px_80px_-45px_rgba(0,29,107,0.45)] backdrop-blur">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0046be]">
                        {roleConfig.find((role) => role.id === selectedRole)?.label}
                      </p>
                      <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
                        Dashboard
                      </h2>
                      <p className="mt-1 text-xs text-zinc-600">{scopeLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRole(null);
                        setPendingRole(null);
                        setSelectedLocation("");
                        setViewLocation("__portfolio__");
                        setDashboard(null);
                        setActiveKpi(null);
                        setChatOpen(false);
                        setSettingsOpen(false);
                      }}
                      className="rounded-xl border border-[#cfdcff] bg-[#f7faff] px-3 py-1.5 text-xs font-medium text-[#27457f]"
                    >
                      Switch
                    </button>
                  </div>

                  {initState !== "ready" ? (
                    <p className="rounded-xl border border-[#ffe27a] bg-[#fff7cc] px-3 py-2 text-xs text-[#7a6200]">
                      {initState === "error" ? initError : "Loading dataset..."}
                    </p>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    {periodOptions.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPeriod(item)}
                        className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                          period === item
                            ? "bg-gradient-to-r from-[#ffe000] to-[#ffd100] text-[#08214a]"
                            : "border border-[#cfdcff] bg-[#f7faff] text-[#27457f]"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  {dashboard?.scopeLocations?.length ? (
                    <div className="mt-3">
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                        View
                      </label>
                      <select
                        value={viewLocation}
                        onChange={(event) => setViewLocation(event.target.value)}
                        className="w-full rounded-xl border border-[#cfdcff] bg-[#f7faff] px-3 py-2 text-sm text-zinc-900"
                      >
                        <option value="__portfolio__">
                          Portfolio total ({dashboard.scopeLocations.length} stores)
                        </option>
                        {dashboard.scopeLocations.map((location) => (
                          <option key={location} value={location}>
                            {location} (single store)
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </section>

                <section className="mt-5 space-y-3">
                  {dashboardLoading ? (
                    <div className="rounded-2xl border border-[#cfdcff] bg-white/90 p-4 text-sm text-zinc-600">
                      Loading KPIs...
                    </div>
                  ) : dashboardError ? (
                    <div className="rounded-2xl border border-[#ffc8a8] bg-[#fff4ec] p-4 text-sm text-[#b54708]">
                      {dashboardError}
                    </div>
                  ) : (
                    kpiCards.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => {
                          setActiveKpi(card.key);
                          setDeepDiveRange("WTD");
                        }}
                        className={`w-full rounded-[1.6rem] border border-[#b9cdfa] bg-gradient-to-r ${card.tone} px-4 py-4 text-left shadow-[0_14px_34px_-28px_rgba(0,29,107,0.35)]`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-semibold tracking-wide text-[#27457f]">{card.title}</p>
                          <span className="rounded-full bg-[#0046be] px-2 py-0.5 text-[10px] font-semibold text-white">
                            KPI
                          </span>
                        </div>
                        <p className="text-2xl font-semibold leading-tight text-[#08214a]">{card.value}</p>
                        <p className="mt-1 text-xs text-[#33507d]">{card.subValue}</p>
                        <p className="mt-2 text-xs font-semibold text-[#0046be]">Tap for deep dive</p>
                      </button>
                    ))
                  )}
                </section>

                <section className="mt-4 rounded-2xl border border-[#b9cdfa] bg-[#f4f7fc] p-4 shadow-[0_20px_50px_-35px_rgba(0,29,107,0.35)] backdrop-blur">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0046be]">
                      Top Departments
                    </p>
                    <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
                      {dashboard?.departments.top.map((department) => {
                        const style = departmentIconStyle(department.department);
                        return (
                          <div
                            key={department.department}
                            className="min-w-[190px] rounded-2xl border border-[#cfdcff] bg-white px-3 py-3"
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                  <path d={departmentIconPath(department.department)} />
                                </svg>
                              </span>
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-xs font-semibold text-slate-900">
                                  {department.department}
                                </p>
                                <p className="mt-1 text-[11px] text-zinc-600">
                                  {formatCompactCurrency(department.salesVolume)}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#6e86b1]">
                      Bottom Departments
                    </p>
                    <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
                      {dashboard?.departments.bottom.map((department) => {
                        const style = departmentIconStyle(department.department);
                        return (
                          <div
                            key={department.department}
                            className="min-w-[190px] rounded-2xl border border-[#dde5f2] bg-[#eef2f8] px-3 py-3"
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                  <path d={departmentIconPath(department.department)} />
                                </svg>
                              </span>
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-xs font-semibold text-slate-900">
                                  {department.department}
                                </p>
                                <p className="mt-1 text-[11px] text-zinc-600">
                                  {formatCompactCurrency(department.salesVolume)}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <button
                  type="button"
                  onClick={openChatFresh}
                  className="absolute bottom-20 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#ffe000] to-[#ffd100] text-[#08214a] shadow-[0_20px_40px_-20px_rgba(255,209,0,0.95)]"
                  aria-label="Open chatbot"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                    <path d="M12 3C7.03 3 3 6.58 3 11c0 2.54 1.36 4.8 3.5 6.27V21l3.3-1.8c.7.12 1.44.18 2.2.18 4.97 0 9-3.58 9-8s-4.03-8-9-8zm-4 9h8v2H8v-2zm0-3h8v2H8V9z" />
                  </svg>
                </button>
              </>
            )}
          </main>

          {activeKpi && dashboard ? (
            <div className="absolute inset-x-0 bottom-0 top-[84px] z-40 flex flex-col bg-[#edf2fb]/95 px-4 pb-24 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0046be]">
                    KPI Deep Dive
                  </p>
                  <h3 className="text-lg font-semibold text-zinc-900">{activeKpi}</h3>
                  <p className="text-xs text-zinc-600">Scope: {scopeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveKpi(null)}
                  className="rounded-lg border border-[#cfdcff] bg-white px-2 py-1 text-xs text-[#27457f]"
                >
                  Back
                </button>
              </div>

              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {deepDiveRangeOptions.map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDeepDiveRange(range)}
                    className={`h-8 min-w-[92px] whitespace-nowrap rounded-full px-3 text-[11px] font-semibold tracking-wide ${
                      deepDiveRange === range
                        ? "bg-gradient-to-r from-[#ffe000] to-[#ffd100] text-[#08214a]"
                        : "border border-[#cfdcff] bg-white text-[#27457f]"
                    }`}
                  >
                    {range.replace("_", " ")}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pr-1">
                {deepDiveSeriesConfig.map((series) => {
                  const filtered = seriesForRange(series.data, deepDiveRange, series.key);
                  const hasTimeline = filtered.length > 1;
                  const linePath = hasTimeline ? buildLinePath(filtered, 300, 96) : "";
                  const latestPoint = filtered[filtered.length - 1];
                  const maxValue = Math.max(...filtered.map((point) => point.value), 1);
                  const minValue = Math.min(...filtered.map((point) => point.value), 0);
                  const midValue = (minValue + maxValue) / 2;
                  return (
                    <section
                      key={series.key}
                      className="rounded-2xl border border-[#b9cdfa] bg-white p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-zinc-900">{series.label}</p>
                        <p className="text-xs text-zinc-600">
                          {latestPoint ? formatSeriesValue(latestPoint.value, series.unit) : "n/a"}
                        </p>
                      </div>

                      {hasTimeline ? (
                        <div className="rounded-xl border border-[#d6e2f9] bg-[#f7faff] p-2">
                          <div className="flex gap-2">
                            <div className="flex w-14 shrink-0 flex-col justify-between py-1 text-[10px] text-zinc-500">
                              <span className="text-right">
                                {formatSeriesValue(maxValue, series.unit)}
                              </span>
                              <span className="text-right">
                                {formatSeriesValue(midValue, series.unit)}
                              </span>
                              <span className="text-right">
                                {formatSeriesValue(minValue, series.unit)}
                              </span>
                            </div>
                            <svg viewBox="0 0 300 110" className="h-32 w-full">
                              <defs>
                                <linearGradient id={`line-${series.key}`} x1="0%" y1="0%" x2="100%" y2="0%">
                                  <stop offset="0%" stopColor="#ffe000" />
                                  <stop offset="100%" stopColor="#0046be" />
                                </linearGradient>
                              </defs>
                              <line x1="0" y1="0" x2="300" y2="0" stroke="#9db6ea" strokeDasharray="3 3" />
                              <line x1="0" y1="55" x2="300" y2="55" stroke="#9db6ea" strokeDasharray="3 3" />
                              <line x1="0" y1="110" x2="300" y2="110" stroke="#9db6ea" strokeDasharray="3 3" />
                              <path d={linePath} fill="none" stroke={`url(#line-${series.key})`} strokeWidth="3" />
                            </svg>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
                            <span>{formatTrendDate(filtered[0]?.label ?? "")}</span>
                            <span>
                              min {formatSeriesValue(minValue, series.unit)} | max {formatSeriesValue(maxValue, series.unit)}
                            </span>
                            <span>{formatTrendDate(filtered[filtered.length - 1]?.label ?? "")}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#d6e2f9] bg-[#f7faff] p-3">
                          <p className="text-[11px] text-zinc-500">Point-in-time metric</p>
                          <p className="mt-1 text-xl font-semibold text-zinc-900">
                            {latestPoint ? formatSeriesValue(latestPoint.value, series.unit) : "No data"}
                          </p>
                          <p className="text-xs text-zinc-600">{latestPoint?.label ?? "Unavailable"}</p>
                        </div>
                      )}
                    </section>
                  );
                })}

                {deepDiveDepartmentPanels ? (
                  <section className="rounded-2xl border border-[#b9cdfa] bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0046be]">
                      {deepDiveDepartmentPanels.title}
                    </p>
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2457bc]">
                        Top
                      </p>
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                        {deepDiveDepartmentPanels.top.map((department) => {
                          const style = departmentIconStyle(department.department);
                          return (
                            <div
                              key={`dd-top-${department.department}`}
                              className="min-w-[180px] rounded-xl border border-[#cfdcff] bg-[#f7faff] px-3 py-3"
                            >
                              <div className="flex items-start gap-2">
                                <span
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                    <path d={departmentIconPath(department.department)} />
                                  </svg>
                                </span>
                                <div className="min-w-0">
                                  <p className="line-clamp-2 text-xs font-semibold text-slate-900">
                                    {department.department}
                                  </p>
                                  <p className="text-[11px] text-zinc-600">
                                    {formatCompactCurrency(department.value)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6e86b1]">
                        Bottom
                      </p>
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                        {deepDiveDepartmentPanels.bottom.map((department) => {
                          const style = departmentIconStyle(department.department);
                          return (
                            <div
                              key={`dd-bottom-${department.department}`}
                              className="min-w-[180px] rounded-xl border border-[#dde5f2] bg-[#eef2f8] px-3 py-3"
                            >
                              <div className="flex items-start gap-2">
                                <span
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                    <path d={departmentIconPath(department.department)} />
                                  </svg>
                                </span>
                                <div className="min-w-0">
                                  <p className="line-clamp-2 text-xs font-semibold text-slate-900">
                                    {department.department}
                                  </p>
                                  <p className="text-[11px] text-zinc-600">
                                    {formatCompactCurrency(department.value)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>

              <button
                type="button"
                onClick={openChatFresh}
                className="absolute bottom-20 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#ffe000] to-[#ffd100] text-[#08214a] shadow-[0_20px_40px_-20px_rgba(255,209,0,0.95)]"
                aria-label="Open chatbot"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M12 3C7.03 3 3 6.58 3 11c0 2.54 1.36 4.8 3.5 6.27V21l3.3-1.8c.7.12 1.44.18 2.2.18 4.97 0 9-3.58 9-8s-4.03-8-9-8zm-4 9h8v2H8v-2zm0-3h8v2H8V9z" />
                </svg>
              </button>
            </div>
          ) : null}

          {chatOpen ? (
            <div className="absolute inset-x-0 bottom-0 top-[84px] z-50 bg-[#001235]/55" onClick={() => setChatOpen(false)}>
              <section
                className="absolute bottom-16 left-0 right-0 mx-auto flex h-[calc(100%-64px)] w-full flex-col rounded-t-[2rem] border border-[#b9cdfa] bg-white/95 p-4 shadow-[0_-20px_70px_-35px_rgba(0,29,107,0.65)] backdrop-blur"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0046be]">Assistant</p>
                    <h3 className="text-base font-semibold text-zinc-900">Contextual Store Bot</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChatOpen(false)}
                    className="rounded-lg border border-[#cfdcff] bg-[#f7faff] px-2 py-1 text-xs text-[#27457f]"
                  >
                    Close
                  </button>
                </div>

                <div
                  ref={listRef}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[#d6e2f9] bg-[#f7faff] p-3"
                >
                  {messages.map((message, index) => {
                    const isUser = message.role === "user";
                    return (
                      <div key={`${message.role}-${index}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
                            isUser
                              ? "bg-gradient-to-br from-[#0046be] to-[#001e73] text-white"
                              : "bg-white text-zinc-900 ring-1 ring-[#d6e2f9]"
                          }`}
                        >
                          {message.content}
                          {!isUser && message.sql ? (
                            <details className="mt-2 rounded-lg bg-[#f7faff] px-2 py-1 text-xs text-zinc-700">
                              <summary className="cursor-pointer">View SQL</summary>
                              <pre className="mt-1 whitespace-pre-wrap">{message.sql}</pre>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {isSending ? (
                    <div className="flex justify-start">
                      <div className="max-w-[86%] rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-zinc-900 ring-1 ring-[#d6e2f9]">
                        <span className="inline-flex items-center gap-1">
                          <span>Thinking</span>
                          <span className="animate-pulse">...</span>
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {messages.length === 1 && messages[0]?.role === "assistant" ? (
                    <div className="rounded-xl border border-[#d6e2f9] bg-white p-2">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0046be]">
                        Suggested Queries
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {promptBubbles.slice(0, 4).map((bubble) => (
                          <button
                            key={bubble}
                            type="button"
                            onClick={() => void sendMessage(bubble)}
                            className="rounded-full border border-[#cfdcff] bg-[#e8f0ff] px-3 py-1.5 text-xs font-semibold text-[#0046be]"
                          >
                            {bubble}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendMessage(input);
                  }}
                  className="mt-3 border-t border-[#d6e2f9] pt-3"
                >
                  <div className="flex gap-2">
                    <input
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="Ask about this dashboard..."
                      className="flex-1 rounded-xl border border-[#9db6ea] bg-[#f7faff] px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#0046be]"
                    />
                    <button
                      type="button"
                      onClick={handleRecordToggle}
                      className={`h-10 w-10 rounded-xl text-white ${isRecording ? "bg-[#001e73]" : "bg-[#0046be]"}`}
                      disabled={isSending}
                      aria-label="Toggle recording"
                    >
                      {isRecording ? (
                        <span className="text-sm font-semibold">Stop</span>
                      ) : (
                        <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5 fill-current">
                          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="submit"
                      className="rounded-xl bg-gradient-to-r from-[#ffe000] to-[#ffd100] px-3 py-2 text-sm font-semibold text-[#08214a] shadow-[0_10px_25px_-15px_rgba(255,209,0,0.85)]"
                      disabled={isSending}
                    >
                      Send
                    </button>
                  </div>
                  {sttError ? <p className="mt-2 text-xs text-[#c53b00]">{sttError}</p> : null}
                </form>
              </section>
            </div>
          ) : null}

          {settingsOpen ? (
            <div className="absolute inset-x-0 bottom-0 top-[84px] z-50 bg-[#001235]/55" onClick={() => setSettingsOpen(false)}>
              <section
                className="absolute bottom-16 left-0 right-0 rounded-t-[2rem] border border-[#b9cdfa] bg-white/95 p-4"
                onClick={(event) => event.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-zinc-900">Settings</h3>
                <p className="mt-1 text-xs text-zinc-600">
                  Light mode active with Best Buy-inspired blue and yellow accents.
                </p>
                <div className="mt-3 rounded-xl border border-[#d6e2f9] bg-[#f7faff] p-3 text-xs text-zinc-700">
                  <p>Role: {roleConfig.find((role) => role.id === selectedRole)?.label || "Not selected"}</p>
                  <p className="mt-1">Scope: {scopeLabel}</p>
                  <p className="mt-1">Period: {period}</p>
                </div>
              </section>
            </div>
          ) : null}

          <nav className="absolute inset-x-0 bottom-0 z-[60] border-t border-[#c7d7f7] bg-white/95 px-4 pb-3 pt-2">
            <div className="mx-auto grid w-fit grid-cols-3 gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d6e2f9] bg-[#f7faff] text-[#27457f]"
                aria-label="Back"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M14.7 5.3a1 1 0 0 1 0 1.4L10.41 11H20a1 1 0 1 1 0 2h-9.59l4.3 4.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.41 0z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveKpi(null);
                  setChatOpen(false);
                  setSettingsOpen(false);
                  setViewLocation("__portfolio__");
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#ffe27a] bg-[#ffe000] text-[#08214a]"
                aria-label="Home"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M12 3.3 3 10.7V21h6v-6h6v6h6V10.7L12 3.3zm0 2.7 7 5.8V19h-2v-6H7v6H5v-7.2L12 6z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true);
                  setChatOpen(false);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#cfdcff] bg-[#0046be] text-white"
                aria-label="Settings"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.5-2.4.8a8 8 0 0 0-1.7-1L15 3h-6l-.3 2.8a8 8 0 0 0-1.7 1l-2.4-.8-2 3.5 2 1.5a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.5 2.4-.8a8 8 0 0 0 1.7 1L9 21h6l.3-2.8a8 8 0 0 0 1.7-1l2.4.8 2-3.5-2-1.5zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
                </svg>
              </button>
            </div>
          </nav>
        </div>
    </div>
  );
}
