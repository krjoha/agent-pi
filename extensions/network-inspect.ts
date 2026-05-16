// ABOUTME: Guarded passive local network inspection tool with interface/listener discovery and bounded capture summaries.
// ABOUTME: Uses safe system command wrappers and refuses invasive or privileged escalation behavior.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import os from "node:os";
import { execFile } from "node:child_process";

interface ExecOptions {
  command: string;
  args: string[];
  timeout?: number;
}

function execFileAsync(options: ExecOptions): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? 10000;
  return new Promise((resolve, reject) => {
    execFile(options.command, options.args, { timeout, encoding: "utf-8", maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function localInterfaces() {
  const interfaces = os.networkInterfaces();
  return Object.entries(interfaces).map(([name, addrs]) => ({
    name,
    addresses: (addrs || []).map((addr) => ({
      family: addr.family,
      address: addr.address,
      internal: addr.internal,
      mac: addr.mac,
      cidr: addr.cidr,
    })),
  }));
}

interface InterfaceName {
  value: string;
}

function createInterfaceName(value: string): InterfaceName {
  return { value };
}

function isSafeInterface(name: InterfaceName): boolean {
  return /^[a-zA-Z0-9_.:-]+$/.test(name.value);
}

interface Action {
  value: string;
}

function normalizeAction(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

interface InspectParams {
  action: string;
  iface: string;
  seconds: number;
  packetCount: number;
}

interface CaptureConfig {
  iface: string;
  seconds: number;
  packetCount: number;
}

function parseParams(params: unknown): InspectParams {
  const p = params as any;
  return {
    action: normalizeAction(p.action),
    iface: typeof p.interface === "string" ? p.interface.trim() : "",
    seconds: Math.max(1, Math.min(10, Number(p.seconds) || 3)),
    packetCount: Math.max(1, Math.min(50, Number(p.packet_count) || 10)),
  };
}

async function listListeners(): Promise<string> {
  try {
    const result = await execFileAsync({ command: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN"], timeout: 10000 });
    return result.stdout.trim();
  } catch {
    const result = await execFileAsync({ command: "netstat", args: ["-an"], timeout: 10000 });
    return result.stdout.trim();
  }
}

async function captureSummary(config: CaptureConfig): Promise<string> {
  if (!isSafeInterface(createInterfaceName(config.iface))) throw new Error("Invalid interface name.");
  const args = ["-i", config.iface, "-nn", "-p", "-q", "-c", String(config.packetCount)];
  const timeoutMs = Math.max(1000, config.seconds * 1000);
  const result = await execFileAsync({ command: "tcpdump", args, timeout: timeoutMs });
  return result.stdout.trim() || result.stderr.trim();
}

function formatInterfaceText(items: ReturnType<typeof localInterfaces>): string {
  return [
    "Local interfaces:",
    "",
    ...items.map((item) => `- ${item.name}\n${item.addresses.map((a) => `  ${a.family} ${a.address}${a.internal ? " (internal)" : ""}${a.cidr ? ` ${a.cidr}` : ""}`).join("\n")}`),
  ].join("\n");
}

function buildInterfacesResult() {
  const items = localInterfaces();
  return {
    content: [{ type: "text" as const, text: formatInterfaceText(items) }],
    details: { action: "interfaces", count: items.length, items },
  };
}

async function buildListenersResult() {
  const output = await listListeners();
  return {
    content: [{ type: "text" as const, text: `Local listening sockets:\n\n${output || "No listeners found."}` }],
    details: { action: "listeners", output },
  };
}

function buildMissingInterfaceError() {
  return {
    content: [{ type: "text" as const, text: "capture_summary requires an interface name. Use the interfaces action first and prefer loopback or an explicitly authorized local interface." }],
    details: { error: "missing_interface" },
  };
}

async function buildCaptureResult(config: CaptureConfig) {
  const output = await captureSummary(config);
  return {
    content: [{ type: "text" as const, text: `Passive capture summary (${config.iface}, up to ${config.packetCount} packets):\n\n${output || "No packets captured within the bounded window."}` }],
    details: { action: "capture_summary", interface: config.iface, seconds: config.seconds, packetCount: config.packetCount, output },
  };
}

function buildInvalidActionError(action: Action) {
  return {
    content: [{ type: "text" as const, text: `Unknown action: ${action.value}. Use interfaces, listeners, or capture_summary.` }],
    details: { error: "invalid_action" },
  };
}

function buildErrorResult(action: Action, error: Error) {
  return {
    content: [{ type: "text" as const, text: `network_inspect failed: ${error.message}` }],
    details: { action: action.value, error: error.message },
  };
}

function toCaptureConfig(params: InspectParams): CaptureConfig {
  return {
    iface: params.iface,
    seconds: params.seconds,
    packetCount: params.packetCount,
  };
}

function toAction(value: string): Action {
  return { value };
}

async function handleNetworkInspect(params: unknown) {
  const parsed = parseParams(params);
  const action = toAction(parsed.action);

  try {
    if (parsed.action === "interfaces") return buildInterfacesResult();
    if (parsed.action === "listeners") return buildListenersResult();
    if (parsed.action === "capture_summary") {
      if (!parsed.iface) return buildMissingInterfaceError();
      return buildCaptureResult(toCaptureConfig(parsed));
    }
    return buildInvalidActionError(action);
  } catch (error: any) {
    return buildErrorResult(action, error);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "network_inspect",
    label: "Network Inspect",
    description: "Passive local network inspection with safe actions only: interface inventory, listener inventory, and bounded capture summaries. No privilege escalation or invasive scanning is performed.",
    parameters: Type.Object({
      action: Type.String({ description: "Action to perform: interfaces, listeners, capture_summary" }),
      interface: Type.Optional(Type.String({ description: "Interface name for capture_summary. Prefer loopback/authorized local interfaces only." })),
      seconds: Type.Optional(Type.Number({ description: "Bounded capture duration hint in seconds (default 3, max 10)." })),
      packet_count: Type.Optional(Type.Number({ description: "Maximum packets to summarize (default 10, max 50)." })),
    }),
    async execute(_toolCallId, params) {
      return handleNetworkInspect(params);
    },
    renderCall(args, theme) {
      const p = args as any;
      return new Text(theme.fg("toolTitle", theme.bold("network_inspect ")) + theme.fg("accent", p.action || ""), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as any;
      if (details?.error) return new Text(theme.fg("error", `network_inspect error: ${details.error}`), 0, 0);
      return new Text(theme.fg("success", `network_inspect ${details?.action || "done"}`), 0, 0);
    },
  });
}
