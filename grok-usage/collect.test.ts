import { describe, expect, it } from "vitest";
import {
  GROK_BILLING_URL,
  GROK_SETTINGS_URL,
  GROK_USER_URL,
  collectGrokUsage,
} from "./collect.ts";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const weeklyBilling = {
  status: 200,
  json: {
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        end: "2026-08-24T17:33:48.278812+00:00",
      },
      creditUsagePercent: 14.2,
      productUsage: [{ product: "GrokBuild", usagePercent: 14.2 }],
    },
  },
};

async function billingFetch(url: string) {
  if (url === GROK_BILLING_URL) return weeklyBilling;
  if (url === GROK_USER_URL) {
    return { status: 200, json: { subscriptionTier: "super", email: "aj@example.com" } };
  }
  if (url === GROK_SETTINGS_URL) {
    return { status: 200, json: { subscription_tier_display: "SuperGrok" } };
  }
  throw new Error(url);
}

describe("collectGrokUsage", () => {
  it("reports unauthenticated when no SuperGrok login exists", async () => {
    const result = await collectGrokUsage({
      homeDir: "/tmp/no-grok-home",
      env: {},
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    });
    expect(result.usage.status).toBe("unauthenticated");
  });

  it("reads SuperGrok weekly usage from the Grok Build login file", async () => {
    const token = jwt({
      sub: "user-1",
      email: "aj@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await collectGrokUsage({
      homeDir: "/Users/aj",
      env: {},
      readFile: async (filePath) => {
        expect(filePath).toBe("/Users/aj/.grok/auth.json");
        return JSON.stringify({ default: { key: token } });
      },
      fetchJson: billingFetch,
    });
    expect(result.usage.status).toBe("ok");
    if (result.usage.status !== "ok") return;
    expect(result.accountKey).toBe("xai:grok:user-1");
    expect(result.usage.planLabel).toBe("SuperGrok");
    expect(result.usage.windows[0]?.usedPercent).toBe(14.2);
  });

  it("uses Pi's xAI OAuth login without installing grok", async () => {
    const token = jwt({
      sub: "pi-user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await collectGrokUsage({
      homeDir: "/Users/aj",
      env: {},
      readFile: async (filePath) => {
        if (filePath === "/Users/aj/.grok/auth.json") {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        expect(filePath).toBe("/Users/aj/.pi/agent/auth.json");
        return JSON.stringify({
          xai: {
            type: "oauth",
            access: token,
            refresh: "refresh-token",
            expires: Date.now() + 60 * 60_000,
          },
        });
      },
      fetchJson: billingFetch,
    });
    expect(result.accountKey).toBe("xai:grok:pi-user");
    expect(result.usage.status).toBe("ok");
  });

  it("refreshes an expired Pi xAI token", async () => {
    const stale = jwt({ sub: "pi-user", exp: Math.floor(Date.now() / 1000) - 60 });
    const fresh = jwt({ sub: "pi-user", exp: Math.floor(Date.now() / 1000) + 3600 });
    let written: string | null = null;
    const result = await collectGrokUsage({
      homeDir: "/Users/aj",
      env: {},
      now: () => Date.now(),
      readFile: async (filePath) => {
        if (filePath.endsWith(".grok/auth.json")) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        if (written) return written;
        return JSON.stringify({
          xai: { type: "oauth", access: stale, refresh: "old-refresh", expires: Date.now() - 1_000 },
        });
      },
      writeFile: async (_filePath, contents) => {
        written = contents;
      },
      refreshOAuth: async (refreshToken) => {
        expect(refreshToken).toBe("old-refresh");
        return { accessToken: fresh, refreshToken: "new-refresh", expiresAtMs: Date.now() + 3600_000 };
      },
      fetchJson: async (_url, token) => {
        expect(token).toBe(fresh);
        return billingFetch(_url);
      },
    });
    expect(result.usage.status).toBe("ok");
    expect(written).toContain("new-refresh");
  });

  it("treats a 401 as an expired Grok session", async () => {
    const token = jwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await collectGrokUsage({
      homeDir: "/Users/aj",
      readFile: async () => JSON.stringify({ default: { key: token } }),
      fetchJson: async () => ({ status: 401, json: { error: "expired" } }),
    });
    expect(result.usage.status).toBe("expired");
    expect(result.accountKey).toBe("xai:grok:user-1");
  });
});
