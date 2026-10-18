import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const planSchema = z
  .object({
    id: z.string().min(1),
    multiplier: z.number().int().positive().nullable(),
  })
  .strict()
  .nullable()
  .default(null);

const usageIdentitySchema = {
  plan: planSchema,
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};

const windowSchema = z
  .object({
    kind: z.enum(["five-hour", "daily", "weekly", "custom"]).default("custom"),
    id: z.string().min(1),
    label: z.string().min(1),
    usedPercent: z.number().nonnegative(),
    resetsAt: z.string().nullable(),
    model: z.string().nullable(),
    cost: z
      .object({
        usedUsdCents: z.number().nonnegative(),
        limitUsdCents: z.number().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const usageMeasurementSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...usageIdentitySchema, windows: z.array(windowSchema) }),
  z.object({ status: z.literal("not_installed"), ...usageIdentitySchema }),
  z.object({ status: z.literal("unauthenticated"), ...usageIdentitySchema }),
  z.object({ status: z.literal("expired"), ...usageIdentitySchema }),
  z.object({ status: z.literal("error"), ...usageIdentitySchema, message: z.string() }),
]);

const accountKeySchema = z
  .string()
  .min(1)
  .nullable()
  .default(null)
  .describe(
    "Provider-issued quota account identity, namespaced by issuer and account/organization scope. Never use email, a display label, a source-local ID, or credentials. Null means unknown; unknown accounts must not be merged.",
  );

export const usageResourceSchema = z.object({
  accountKey: accountKeySchema,
  id: z.string().min(1).describe("Stable resource ID within this source plugin."),
  providerId: z.string().min(1),
  label: z.string().min(1),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shared") }),
    z.object({
      kind: z.literal("host"),
      hostId: z.string().min(1),
      hostName: z.string().min(1),
    }),
  ]),
});

export const listResourcesOutputSchema = z.object({
  label: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Declares a shared group even when empty. Host-only sources omit it; machine groups use host names.",
    ),
  resources: z.array(usageResourceSchema),
});

export const getResourceOutputSchema = z.object({
  accountKey: accountKeySchema,
  observedAt: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe("Last successful measurement time in epoch milliseconds; null if never observed."),
  usage: usageMeasurementSchema,
});

export const LIST_RESOURCES_METHOD = "provider-usage.v1.listResources";
export const GET_RESOURCE_METHOD = "provider-usage.v1.getResource";

export const usageSourceContract = defineRpcContract({
  [LIST_RESOURCES_METHOD]: {
    input: z.object({}),
    output: listResourcesOutputSchema,
    experimental_description:
      "Cheap complete inventory of resources owned by this source. Reads local metadata only; never refreshes quota or contacts providers. IDs are stable and source-local. Resource order is display order. Shared label preserves empty groups. Resources may disappear between list and fetch.",
  },
  [GET_RESOURCE_METHOD]: {
    input: z.object({
      resourceId: z.string().min(1),
      refresh: z
        .boolean()
        .describe(
          "False permits a cached measurement but still returns actual usage. True requests a fresh collection attempt for this resource only.",
        ),
    }),
    output: getResourceOutputSchema,
    experimental_description:
      "Returns actual usage for exactly one listed resource, even when refresh is false. False permits cached observations; true requests a fresh attempt. Never collects other resources as a side effect. A removed resource fails the RPC; consumers relist. Per-account authentication and collection failures are usage states. observedAt is the last successful measurement time.",
  },
});

export const GROK_PROVIDER_ID = "acp-grok";
export const GROK_PROVIDER_LABEL = "Grok Build";
export const CACHE_TTL_MS = 60_000;
