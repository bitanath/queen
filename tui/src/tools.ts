// Tool surface for queen. One tool for now: get_weather via wttr.in, rendered
// as compact markdown (current conditions + the next few hours).

import { FunctionTool, type JSONSchema } from "@strands-agents/sdk";

export type ToolCall = { name: string; arguments: Record<string, string> };

export const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather and the next few hours for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, for example Tokyo" },
      },
      required: ["city"],
    },
  },
};

export const TOOLS_JSON = JSON.stringify([WEATHER_TOOL]);


export function stripToolMarkup(text: string): string {
  const spans: [string, string][] = [
    ["<tool_call>", "</tool_call>"],
    ["<|tool_call_start|>", "<|tool_call_end|>"],
  ]; // FIXME Removes tool-call markup from streamed text to never show, unterminated span, (still streaming) is dropped until it closes.
  let out = text;
  for (const [open, close] of spans) {
    let result = "";
    let i = 0;
    while (i < out.length) {
      const s = out.indexOf(open, i);
      if (s < 0) {
        result += out.slice(i);
        break;
      }
      result += out.slice(i, s);
      const e = out.indexOf(close, s + open.length);
      if (e < 0) break;
      i = e + close.length;
    }
    out = result;
  }
  return out;
}

type WttrHourly = {
  time: string;
  tempC: string;
  chanceofrain?: string;
  weatherDesc?: { value?: string }[];
};

type WttrCondition = {
  temp_C: string;
  FeelsLikeC: string;
  humidity: string;
  windspeedKmph: string;
  winddir16Point: string;
  weatherDesc?: { value?: string }[];
};

type Wttr = {
  current_condition?: WttrCondition[];
  weather?: { hourly?: WttrHourly[] }[];
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function slotMinutes(time: string): number | null {
  const v = parseInt(time, 10);
  if (!Number.isFinite(v)) return null;
  return Math.floor(v / 100) * 60 + (v % 100); // wttr.in hourly slots are HHMM with a plain hour: "0" -> 00:00, "300" -> 03:00, "1500" -> 15:00.
}

function hhmm(time: string): string {
  const v = parseInt(time, 10);
  if (!Number.isFinite(v)) return time;
  return `${pad2(Math.floor(v / 100))}:${pad2(v % 100)}`;
}

export async function getWeather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, { headers: { "User-Agent": "curl" } });
  if (!res.ok) throw new Error(`wttr.in returned ${res.status}`);
  const data = (await res.json()) as Wttr;
  const now = data.current_condition?.[0];
  if (!now) throw new Error("wttr.in returned no current conditions");

  const desc = now.weatherDesc?.[0]?.value ?? "";
  const lines = [
    `**${city}** — ${now.temp_C}°C${desc ? `, ${desc}` : ""} (feels like ${now.FeelsLikeC}°C)`,
    `humidity ${now.humidity}% · wind ${now.windspeedKmph} km/h ${now.winddir16Point}`,
  ];

  const days = data.weather ?? [];
  const clock = new Date();
  const nowMin = clock.getHours() * 60 + clock.getMinutes();
  const upcoming: { h: WttrHourly; tomorrow: boolean }[] = [];
  for (const h of days[0]?.hourly ?? []) {
    const m = slotMinutes(h.time);
    if (m !== null && m >= nowMin) upcoming.push({ h, tomorrow: false });
  }
  for (const h of days[1]?.hourly ?? []) upcoming.push({ h, tomorrow: true });
  const next = upcoming.slice(0, 3);
  if (next.length > 0) {
    lines.push("", "Next hours:");
    for (const { h, tomorrow } of next) {
      const rain = parseInt(h.chanceofrain ?? "0", 10);
      const rainStr = Number.isFinite(rain) && rain > 0 ? ` · ${rain}% rain` : "";
      const hDesc = h.weatherDesc?.[0]?.value ?? "";
      lines.push(
        `- ${tomorrow ? "tomorrow " : ""}${hhmm(h.time)} · ${h.tempC}°C${hDesc ? ` · ${hDesc}` : ""}${rainStr}`,
      );
    }
  }
  return lines.join("\n");
}

export async function runTool(call: ToolCall): Promise<string> {
  if (call.name === "get_weather") {
    const city = (call.arguments?.city ?? "").trim();
    if (!city) throw new Error("get_weather: missing city");
    return getWeather(city);
  }
  throw new Error(`unknown tool: ${call.name}`);
}


export const weatherTool = new FunctionTool({
  name: "get_weather",
  description: "Get the current weather and the next few hours for a city",
  inputSchema: WEATHER_TOOL.function.parameters as JSONSchema,
  callback: async (input) => {
    const city = String((input as { city?: unknown } | null)?.city ?? "").trim();
    if (!city) throw new Error("get_weather: missing city");
    return getWeather(city);
  } // TODO Strands tool example. Wrapped as a FunctionTool so agent loop can execute it and feed result back to the model.
});
