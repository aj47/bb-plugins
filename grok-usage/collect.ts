import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { usageMeasurementSchema } from "./usage-contract.ts";

export const GROK_BILLING_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const GROK_USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
export const GROK_SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings";
export const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

const moneySchema = z.object({ val: z.number() }).passthrough().optional();

const periodSchema = z
  .object({
    type: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  })
  .passthrough()
  .optional();

const productUsageSchema = z
  .object({
    product: z.union([z.string(), z.number()]).optional(),
    usagePercent: z.number().optional(),
  })
  .passthrough();

const billingConfigSchema = z
  .object({
    currentPeriod: periodSchema,
    creditUsagePercent: z.number().optional(),
    productUsage: z.array(productUsageSchema).optional(),
    prepaidBalance: moneySchema,
    onDemandCap: moneySchema,
    onDemandUsed: moneySchema,
    billingPeriodStart: z.string().optional(),
    billingPeriodEnd: z.string().optional(),
  })
  .passthrough();

const billingResponseSchema = z
  .object({
    config: billingConfigSchema.optional(),
  })
  .passthrough();

const userResponseSchema = z
  .object({
    subscriptionTier: z.string().optional(),
    email: z.string().optional(),
    userId: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const settingsResponseSchema = z
  .object({
    subscription_tier_display: z.string().optional(),
    subscriptionTierDisplay: z.string().optional(),
  })
  .passthrough();

const grokAuthEntrySchema = z
  .object({
    key: z.string().min(1).optional(),
    access_token: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    email: z.string().optional(),
    user_id: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const piOAuthSchema = z
  .object({
    type: z.string().optional(),
    access: z.string().min(1),
    refresh: z.string().min(1).optional(),
    expires: z.number().optional(),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().optional(),
  })
  .passthrough();

export type UsageMeasurement = z.infer<typeof usageMeasurementSchema>;

export type CollectedUsage = {
  accountKey: string | null;
  usage: UsageMeasurement;
};

export type CollectGrokUsageDeps = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, contents: string) => Promise<void>;
  which?: (command: string) => Promise<string | null>;
  fetchJson?: (
    url: string,
    token: string,
  ) => Promise<{ status: number; json: unknown }>;
  refreshOAuth?: (refreshToken: string) => Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAtMs: number | null;
  }>;
};

type AuthSession = {
  token: string;
  refreshToken: string | null;
  persistPath: string | null;
  persistKind: "pi" | null;
  email: string | null;
  userId: string | null;
  expired: boolean;
};

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function parseIso(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (padded.length % 4)) % 4);
    const decoded = Buffer.from(padded + pad, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function jwtExpired(token: string, nowMs: number): boolean {
  const payload = jwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" && exp * 1000 - REFRESH_SKEW_MS <= nowMs;
}

function resolveGrokDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const grokHome = env.GROK_HOME?.trim();
  if (!grokHome) return path.join(homeDir, ".grok");
  if (grokHome.startsWith("~")) return path.join(homeDir, grokHome.slice(1));
  return path.isAbsolute(grokHome) ? grokHome : path.join(homeDir, grokHome);
}

function resolvePiAuthPath(homeDir: string, env: NodeJS.ProcessEnv): string {
  const piHome = env.PI_CODING_AGENT_DIR?.trim();
  if (piHome) {
    const resolved = piHome.startsWith("~") ? path.join(homeDir, piHome.slice(1)) : piHome;
    return path.join(resolved, "auth.json");
  }
  return path.join(homeDir, ".pi", "agent", "auth.json");
}

export async function resolveExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const pathEnv = env.PATH ?? "";
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${command}${extension}`);
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function periodKind(type: string | undefined): "weekly" | "daily" | "custom" {
  const normalized = (type ?? "").toUpperCase();
  if (normalized.includes("WEEK")) return "weekly";
  if (normalized.includes("DAY") || normalized.includes("DAILY")) return "daily";
  if (normalized.includes("MONTH")) return "custom";
  return "custom";
}

function periodLabel(kind: "weekly" | "daily" | "custom", type: string | undefined): string {
  if (kind === "weekly") return "Weekly limit";
  if (kind === "daily") return "Daily limit";
  const normalized = (type ?? "").toUpperCase();
  if (normalized.includes("MONTH")) return "Monthly limit";
  return "Usage";
}

function planFromTier(tier: string | null): {
  id: string;
  multiplier: number | null;
  label: string;
} | null {
  if (!tier) return null;
  const trimmed = tier.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.includes("heavy")) {
    return { id: "supergrok-heavy", multiplier: null, label: "SuperGrok Heavy" };
  }
  if (lower.includes("super")) {
    return { id: "supergrok", multiplier: null, label: "SuperGrok" };
  }
  return { id: lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), multiplier: null, label: trimmed };
}

function isBuildProduct(product: string | number | undefined): boolean {
  return product === "GrokBuild" || product === 2 || product === "2";
}

function sessionFromToken(
  token: string,
  extras: Partial<AuthSession>,
  nowMs: number,
): AuthSession {
  const payload = jwtPayload(token);
  return {
    token,
    refreshToken: extras.refreshToken ?? null,
    persistPath: extras.persistPath ?? null,
    persistKind: extras.persistKind ?? null,
    email: extras.email ?? asString(payload?.email),
    userId: extras.userId ?? asString(payload?.sub) ?? asString(payload?.user_id) ?? asString(payload?.principal_id),
    expired: extras.expired ?? jwtExpired(token, nowMs),
  };
}

function sessionsFromGrokAuth(data: unknown, nowMs: number): AuthSession[] {
  const candidates: unknown[] = [];
  if (Array.isArray(data)) {
    candidates.push(...data);
  } else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.key === "string" || typeof record.access_token === "string") {
      candidates.push(record);
    } else {
      candidates.push(...Object.values(record));
    }
  }

  const sessions: AuthSession[] = [];
  for (const value of candidates) {
    const parsed = grokAuthEntrySchema.safeParse(value);
    if (!parsed.success) continue;
    const token = parsed.data.key ?? parsed.data.access_token;
    if (!token) continue;
    sessions.push(
      sessionFromToken(
        token,
        {
          refreshToken: parsed.data.refresh_token ?? null,
          email: asString(parsed.data.email),
          userId: asString(parsed.data.user_id),
        },
        nowMs,
      ),
    );
  }
  return sessions;
}

function sessionsFromPiAuth(data: unknown, filePath: string, nowMs: number): AuthSession[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const sessions: AuthSession[] = [];
  for (const key of ["xai", "xai-oauth", "xai-auth", "grok", "supergrok"]) {
    const value = record[key];
    const parsed = piOAuthSchema.safeParse(value);
    if (!parsed.success) continue;
    const expiredByClock =
      typeof parsed.data.expires === "number" && parsed.data.expires - REFRESH_SKEW_MS <= nowMs;
    sessions.push(
      sessionFromToken(
        parsed.data.access,
        {
          refreshToken: parsed.data.refresh ?? null,
          persistPath: filePath,
          persistKind: "pi",
          expired: expiredByClock || jwtExpired(parsed.data.access, nowMs),
        },
        nowMs,
      ),
    );
  }
  return sessions;
}

function sessionFromEnv(env: NodeJS.ProcessEnv, nowMs: number): AuthSession | null {
  const token = env.GROK_OAUTH_TOKEN?.trim() || env.XAI_OAUTH_TOKEN?.trim();
  if (!token) return null;
  return sessionFromToken(token, {}, nowMs);
}

async function readJsonFile(
  filePath: string,
  readFile: NonNullable<CollectGrokUsageDeps["readFile"]>,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath)) as unknown;
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function defaultFetchJson(
  url: string,
  token: string,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-XAI-Token-Auth": "xai-grok-cli",
      "User-Agent": "bb-plugin-grok-usage",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

async function defaultRefreshOAuth(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
}> {
  const response = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "bb-plugin-grok-usage",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: XAI_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`xAI token refresh failed (HTTP ${response.status}).`);
  }
  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("xAI token refresh returned invalid JSON.");
  const expiresAtMs =
    typeof parsed.data.expires_in === "number"
      ? Date.now() + parsed.data.expires_in * 1000
      : null;
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    expiresAtMs,
  };
}

function identityUsage(
  status: Exclude<UsageMeasurement["status"], "ok" | "error">,
  email: string | null,
  planLabel: string | null,
): UsageMeasurement {
  return {
    status,
    plan: null,
    accountEmail: email,
    planLabel,
  };
}

function errorUsage(
  message: string,
  email: string | null,
  planLabel: string | null,
): UsageMeasurement {
  return {
    status: "error",
    plan: null,
    accountEmail: email,
    planLabel,
    message,
  };
}

function fileErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

async function persistPiSession(
  session: AuthSession,
  readFile: NonNullable<CollectGrokUsageDeps["readFile"]>,
  writeFile: NonNullable<CollectGrokUsageDeps["writeFile"]>,
  expiresAtMs: number | null,
): Promise<void> {
  if (session.persistKind !== "pi" || !session.persistPath) return;
  const data = await readJsonFile(session.persistPath, readFile);
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  for (const key of ["xai", "xai-oauth", "xai-auth", "grok", "supergrok"]) {
    const parsed = piOAuthSchema.safeParse(record[key]);
    if (!parsed.success) continue;
    record[key] = {
      ...parsed.data,
      access: session.token,
      ...(session.refreshToken ? { refresh: session.refreshToken } : {}),
      ...(expiresAtMs !== null ? { expires: expiresAtMs } : {}),
    };
    await writeFile(`${session.persistPath}`, `${JSON.stringify(record, null, 2)}\n`);
    return;
  }
}

async function resolveSession(
  deps: CollectGrokUsageDeps,
): Promise<{ session: AuthSession | null; authError: string | null }> {
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? homedir();
  const nowMs = (deps.now ?? Date.now)();
  const readFile =
    deps.readFile ??
    (async (filePath: string) => {
      const { readFile: fsReadFile } = await import("node:fs/promises");
      return fsReadFile(filePath, "utf8");
    });
  const writeFile =
    deps.writeFile ??
    (async (filePath: string, contents: string) => {
      const { writeFile: fsWriteFile } = await import("node:fs/promises");
      await fsWriteFile(filePath, contents, { encoding: "utf8", mode: 0o600 });
    });
  const refreshOAuth = deps.refreshOAuth ?? defaultRefreshOAuth;

  const sessions: AuthSession[] = [];
  const grokAuthPath = path.join(resolveGrokDir(homeDir, env), "auth.json");
  const piAuthPath = resolvePiAuthPath(homeDir, env);

  try {
    const grokAuth = await readJsonFile(grokAuthPath, readFile);
    if (grokAuth !== undefined) sessions.push(...sessionsFromGrokAuth(grokAuth, nowMs));
  } catch {
    return { session: null, authError: "Grok login file could not be read." };
  }

  try {
    const piAuth = await readJsonFile(piAuthPath, readFile);
    if (piAuth !== undefined) sessions.push(...sessionsFromPiAuth(piAuth, piAuthPath, nowMs));
  } catch {
    // Pi auth is optional; ignore unreadable files and keep other sources.
  }

  const envSession = sessionFromEnv(env, nowMs);
  if (envSession) sessions.push(envSession);

  const usable = sessions.find((candidate) => !candidate.expired) ?? sessions.find((candidate) => candidate.refreshToken);
  if (!usable) return { session: sessions[0] ?? null, authError: null };
  if (!usable.expired) return { session: usable, authError: null };
  if (!usable.refreshToken) return { session: usable, authError: null };

  try {
    const refreshed = await refreshOAuth(usable.refreshToken);
    usable.token = refreshed.accessToken;
    if (refreshed.refreshToken) usable.refreshToken = refreshed.refreshToken;
    usable.expired = false;
    usable.userId = sessionFromToken(usable.token, usable, nowMs).userId;
    if (usable.persistKind === "pi") {
      try {
        await persistPiSession(usable, readFile, writeFile, refreshed.expiresAtMs);
      } catch {
        // In-memory refresh is enough for this reading.
      }
    }
    return { session: usable, authError: null };
  } catch {
    return { session: usable, authError: null };
  }
}

export async function collectGrokUsage(
  deps: CollectGrokUsageDeps = {},
): Promise<CollectedUsage> {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const { session, authError } = await resolveSession(deps);

  if (authError) {
    return { accountKey: null, usage: errorUsage(authError, null, null) };
  }
  if (!session) {
    return {
      accountKey: null,
      usage: identityUsage("unauthenticated", null, null),
    };
  }
  if (session.expired) {
    return {
      accountKey: session.userId ? `xai:grok:${session.userId}` : null,
      usage: identityUsage("expired", session.email, null),
    };
  }

  try {
    const [billingResult, userResult, settingsResult] = await Promise.all([
      fetchJson(GROK_BILLING_URL, session.token),
      fetchJson(GROK_USER_URL, session.token).catch(() => ({ status: 0, json: null })),
      fetchJson(GROK_SETTINGS_URL, session.token).catch(() => ({ status: 0, json: null })),
    ]);

    if (billingResult.status === 401 || billingResult.status === 403) {
      return {
        accountKey: session.userId ? `xai:grok:${session.userId}` : null,
        usage: identityUsage("expired", session.email, null),
      };
    }
    if (billingResult.status === 0 || billingResult.status >= 400) {
      return {
        accountKey: session.userId ? `xai:grok:${session.userId}` : null,
        usage: errorUsage(
          `Grok usage request failed (HTTP ${billingResult.status || "network"}).`,
          session.email,
          null,
        ),
      };
    }

    const billing = billingResponseSchema.safeParse(billingResult.json);
    if (!billing.success) {
      return {
        accountKey: session.userId ? `xai:grok:${session.userId}` : null,
        usage: errorUsage("Grok returned invalid usage information.", session.email, null),
      };
    }

    const config = billing.data.config ?? {};
    const user = userResponseSchema.safeParse(userResult.json);
    const settings = settingsResponseSchema.safeParse(settingsResult.json);
    const userEmail = user.success ? asString(user.data.email) : null;
    const userId =
      session.userId ??
      (user.success ? asString(user.data.userId) ?? asString(user.data.id) : null);
    const settingsTier = settings.success
      ? asString(settings.data.subscription_tier_display) ??
        asString(settings.data.subscriptionTierDisplay)
      : null;
    const userTier = user.success ? asString(user.data.subscriptionTier) : null;
    const plan = planFromTier(settingsTier ?? userTier);
    const period = config.currentPeriod;
    const kind = periodKind(period?.type);
    const resetsAt = parseIso(period?.end) ?? parseIso(config.billingPeriodEnd);
    const buildSlice = (config.productUsage ?? []).find((product) =>
      isBuildProduct(product.product),
    );
    const usedPercent =
      typeof config.creditUsagePercent === "number"
        ? config.creditUsagePercent
        : typeof buildSlice?.usagePercent === "number"
          ? buildSlice.usagePercent
          : 0;

    const windows: Array<{
      kind: "weekly" | "daily" | "custom";
      id: string;
      label: string;
      usedPercent: number;
      resetsAt: string | null;
      model: string | null;
      cost: { usedUsdCents: number; limitUsdCents: number } | null;
    }> = [
      {
        kind,
        id: "pool",
        label: periodLabel(kind, period?.type),
        usedPercent: clampPercent(usedPercent),
        resetsAt,
        model: null,
        cost: null,
      },
    ];

    const onDemandCap = config.onDemandCap?.val ?? 0;
    const onDemandUsed = config.onDemandUsed?.val ?? 0;
    if (onDemandCap > 0) {
      windows.push({
        kind: "custom",
        id: "on-demand",
        label: "On-demand",
        usedPercent: clampPercent((onDemandUsed / onDemandCap) * 100),
        resetsAt,
        model: null,
        cost: {
          usedUsdCents: Math.max(0, onDemandUsed),
          limitUsdCents: onDemandCap,
        },
      });
    }

    return {
      accountKey: userId ? `xai:grok:${userId}` : null,
      usage: {
        status: "ok",
        plan: plan ? { id: plan.id, multiplier: plan.multiplier } : null,
        accountEmail: userEmail ?? session.email,
        planLabel: plan?.label ?? null,
        windows,
      },
    };
  } catch (error) {
    return {
      accountKey: session.userId ? `xai:grok:${session.userId}` : null,
      usage: errorUsage(
        error instanceof Error ? error.message : "Grok usage could not be collected. Try again.",
        session.email,
        null,
      ),
    };
  }
}
