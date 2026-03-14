import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey =
      process.env.AZURE_OPENAI_TRANSCRIBE_API_KEY ||
      process.env.AZURE_OPENAI_API_KEY;
    const transcribeEndpoint = process.env.AZURE_OPENAI_TRANSCRIBE_ENDPOINT;
    const authMode = (
      process.env.AZURE_OPENAI_TRANSCRIBE_AUTH_MODE ?? "api-key"
    ).toLowerCase();
    const deployment =
      process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT ??
      "gpt-4o-transcribe-diarize";
    const apiVersion =
      process.env.AZURE_OPENAI_TRANSCRIBE_API_VERSION ??
      "2025-03-01-preview";

    if ((!transcribeEndpoint && !endpoint) || !apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing Azure OpenAI config. Required: AZURE_OPENAI_TRANSCRIBE_ENDPOINT (or AZURE_OPENAI_ENDPOINT) and AZURE_OPENAI_TRANSCRIBE_API_KEY (or AZURE_OPENAI_API_KEY fallback).",
        },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
    }

    const azureForm = new FormData();
    azureForm.append("model", deployment);
    azureForm.append("file", file, file.name || "audio.webm");

    const endpointBase = endpoint!.replace(/\/$/, "");
    const transcribeUrl =
      transcribeEndpoint ||
      `${endpointBase}/openai/deployments/${deployment}/audio/transcriptions?api-version=${apiVersion}`;

    const headers: HeadersInit = {
      Accept: "application/json",
    };
    if (authMode === "bearer") {
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (authMode === "ocp") {
      headers["Ocp-Apim-Subscription-Key"] = apiKey;
    } else {
      headers["api-key"] = apiKey;
    }

    const response = await fetch(
      transcribeUrl,
      {
        method: "POST",
        headers,
        body: azureForm,
      },
    );

    const raw = await response.text();
    const payload = raw
      ? (JSON.parse(raw) as {
          text?: string;
          displayText?: string;
          segments?: Array<{ text?: string; speaker?: string }>;
          error?: { message?: string };
          message?: string;
        })
      : {};

    if (!response.ok) {
      const message =
        payload.error?.message ||
        payload.message ||
        "Azure OpenAI transcription failed.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const transcript =
      payload.text ||
      payload.displayText ||
      payload.segments?.map((segment) => segment.text ?? "").join(" ").trim() ||
      "";

    return NextResponse.json({ text: transcript });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
