// Unified chat entry-point. Reads the selected provider/model from settings
// and dispatches to either the Claude CLI (anthropic-cli) or the HTTP
// provider stack. Returns the assistant's text content.

import { ipc } from "./ipc";

export interface SimpleMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteArgs {
  task: "query" | "ingest";
  messages: SimpleMessage[];
  cwd: string;
}

export async function complete(args: CompleteArgs): Promise<string> {
  const settings = await ipc.getSettings();
  const provider =
    args.task === "query" ? settings.query_provider : settings.ingest_provider;
  const model =
    args.task === "query" ? settings.query_model : settings.ingest_model;

  const isCli =
    provider === "anthropic-cli" ||
    provider === "gemini-cli" ||
    provider === "codex-cli";
  if (isCli) {
    // CLIs accept a single prompt; flatten system+user turns.
    const system = args.messages.find((m) => m.role === "system");
    const userTurns = args.messages
      .filter((m) => m.role !== "system")
      .map((m) =>
        m.role === "assistant" ? `Assistant: ${m.content}` : m.content,
      )
      .join("\n\n");
    const prompt = system ? `${system.content}\n\n${userTurns}` : userTurns;
    const res =
      provider === "anthropic-cli"
        ? await ipc.claudeRun(prompt, args.cwd)
        : await ipc.agentRun(provider, model, prompt, args.cwd);
    if (res.status !== 0) {
      throw new Error(res.stderr.trim() || `${provider} exit ${res.status}`);
    }
    return res.stdout.trim();
  }

  const res = await ipc.chatComplete({
    provider_id: provider,
    model,
    messages: args.messages,
  });
  return res.content.trim();
}

export async function getActiveModel(task: "query" | "ingest"): Promise<{
  provider: string;
  model: string;
}> {
  const s = await ipc.getSettings();
  return task === "query"
    ? { provider: s.query_provider, model: s.query_model }
    : { provider: s.ingest_provider, model: s.ingest_model };
}
