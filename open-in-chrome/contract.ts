import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const hostContract = defineRpcContract({
  openUrl: {
    input: z.object({ url: z.string().min(1).max(4096) }).strict(),
    output: z.object({ url: z.string() }).strict(),
  },
});
