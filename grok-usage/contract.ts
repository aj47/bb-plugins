import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { getResourceOutputSchema } from "./usage-contract.ts";

export const hostContract = defineRpcContract({
  collectUsage: {
    input: z.object({ refresh: z.boolean() }).strict(),
    output: getResourceOutputSchema,
  },
});
