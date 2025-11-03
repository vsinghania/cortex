import "dotenv/config";
import { z } from "zod";

import { toolRegistry } from "../src/agent_svc/registry/tool_registry.js";
import type { AgentTool } from "../src/agent_svc/types/tool.types.js";
import { agent_config_schema } from "../src/agent_svc/types/agent_config.types.js";
import { createAgentFromConfig } from "../src/agent_svc/factory/agent_factory.js";
import { agentRegistry } from "../src/agent_svc/registry/agent_registry.js";
import { NotesSvc } from "../src/notes_svc/notes_svc.js";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment. Set it before running the smoke script.");
    process.exit(1);
  }

  const user_id = process.env.AGENT_SMOKE_USER_ID ?? "vishal";

  // Define simple tools

  // const echoTool: AgentTool = {
  //   name: "echo",
  //   description: "Echo back the provided text.",
  //   parameters: z.object({
  //     text: z.string().min(1)
  //   }),
  //   async handler(args, _ctx) {
  //     console.log("[tool:echo] called", args);
  //     const out = { content: `echo: ${args.text}` };
  //     console.log("[tool:echo] result", out);
  //     return out;
  //   }
  // };
  const notes_svc = await NotesSvc.createWithMongo({host: 'localhost', port: 27017});
  const notesTool: AgentTool = {
    name: "GetAllNotes",
    description: "Get all notes for user",
    parameters: z.object({
      user_id: z.string().min(1)
    }),
    async handler(args, _ctx) {
      console.log("[tool:GetAllNotes] called", args);
      const result = await notes_svc.listNotes({ user_id: args.user_id });
      console.log("[tool:GetAllNotes] result count", Array.isArray(result) ? result.length : result);
      return { content: result };
    }
  };

  // const addTool: AgentTool = {
  //   name: "add",
  //   description: "Add two numbers and return the sum.",
  //   parameters: z.object({
  //     a: z.number(),
  //     b: z.number()
  //   }),
  //   async handler(args, _ctx) {
  //     console.log("[tool:add] called", args);
  //     const sum = args.a + args.b;
  //     const out = { content: `sum=${sum}` };
  //     console.log("[tool:add] result", out);
  //     return out;
  //   }
  // };

  // Register tools globally
  toolRegistry.registerMany([notesTool]);
  console.log("Registered tools:", toolRegistry.listNames());

  // Build agent config
  const cfg = agent_config_schema.parse({
    name: "smoke-agent",
    instructions:
      "You are a helpful assistant for a user with user_id `vishal`. Use the available tools when helpful. ",
    user_id,
    tools: ["GetAllNotes"],
    default_run_options: {
      temperature: 0,
      timeout_ms: 30_000
    }
  });

  const { agent, run } = createAgentFromConfig(cfg);

  // Optionally register this agent in the global registry for reference by name
  agentRegistry.register(cfg.name, agent);

  const promptArg = process.argv.slice(2).join(" ").trim();
  const prompt =
    promptArg ||
    "List my notes.";

  console.log("Running agent smoke test...");
  console.log(`User: ${user_id}`);
  console.log(`Prompt: ${prompt}\n`);

  try {
    const res = await run({
      user_id,
      prompt
    });

    console.log("Final Text:");
    console.log(res.final_text);
    console.log("\nMessages:");
    for (const m of res.messages) {
      console.log(`[${m.role}${m.name ? `:${m.name}` : ""}] ${m.content}`);
    }
    if (res.usage) {
      console.log("\nUsage:", res.usage);
    }
    console.log("\nSmoke test completed.");
  } catch (err) {
    console.error("Smoke test error:", err);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
