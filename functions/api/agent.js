/**
 * The agent endpoint. Runs the tool-use loop server-side and streams progress
 * to the browser over SSE, so the user sees the agent working rather than a
 * spinner. The Anthropic key and the Google credentials never leave here.
 */

import Anthropic from "@anthropic-ai/sdk";
import { setEnv } from "../../lib/runtime.js";
import { requireSession } from "../../lib/session.js";
import { buildSystemPrompt } from "../../lib/knowledge.js";
import { TOOLS, executeTool } from "../../lib/tools.js";

const MODEL = "claude-opus-5";
const MAX_TURNS = 24;

export async function onRequest(context) {
  const { request } = context;
  // Hand the Worker's bindings to the library modules before anything reads them.
  setEnv(context.env);

  try {
    requireSession(request);
  } catch {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let history;
  try {
    ({ messages: history } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!Array.isArray(history) || history.length === 0) {
    return Response.json({ error: "No messages supplied." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: context.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      // The date goes in the message turn, not the system prompt, so the
      // cached prefix stays byte-identical between requests.
      const messages = [...history];
      const last = messages[messages.length - 1];
      if (last.role === "user" && typeof last.content === "string") {
        last.content = `${last.content}\n\n[Today is ${new Date().toISOString().slice(0, 10)}.]`;
      }

      /** Hand the new turns back to the browser so it can continue the thread. */
      const sendDone = () =>
        send("done", { messages: stripHeavyBlocks(messages.slice(history.length - 1)) });

      try {
        let completed = false;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = client.messages.stream({
            model: MODEL,
            max_tokens: 32000,
            thinking: { type: "adaptive", display: "summarized" },
            system: [
              {
                type: "text",
                text: buildSystemPrompt(),
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: TOOLS,
            messages,
          });

          response.on("text", (delta) => send("text", { delta }));
          response.on("thinking", (delta) => send("thinking", { delta }));

          const message = await response.finalMessage();

          if (message.stop_reason === "refusal") {
            send("error", {
              message:
                "The model declined to continue with this request. Rephrase it or start a new conversation.",
            });
            sendDone();
            completed = true;
            break;
          }

          if (message.stop_reason === "end_turn") {
            messages.push({ role: "assistant", content: message.content });
            sendDone();
            completed = true;
            break;
          }

          if (message.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: message.content });
            continue;
          }

          const toolUses = message.content.filter((b) => b.type === "tool_use");
          if (toolUses.length === 0) {
            messages.push({ role: "assistant", content: message.content });
            sendDone();
            completed = true;
            break;
          }

          messages.push({ role: "assistant", content: message.content });

          const resultBlocks = [];
          const attachments = [];

          for (const use of toolUses) {
            send("tool", { name: use.name, input: summarise(use.input) });

            let outcome;
            try {
              outcome = await executeTool(use.name, use.input);
            } catch (error) {
              outcome = { text: `Tool failed: ${error.message}`, isError: true };
            }

            resultBlocks.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: outcome.text,
              ...(outcome.isError ? { is_error: true } : {}),
            });

            if (outcome.extraContent) attachments.push(...outcome.extraContent);
            send("tool_done", { name: use.name, ok: !outcome.isError });
          }

          messages.push({ role: "user", content: [...resultBlocks, ...attachments] });

        }

        // Out of steps, or stopped on a refusal: still hand back the work done
        // so far, otherwise the browser loses the whole exchange.
        if (!completed) {
          send("error", {
            message:
              "Stopped before finishing — this needed more steps than one run allows. " +
              "The work so far is kept; ask the agent to continue, or narrow the question.",
          });
          sendDone();
        }
      } catch (error) {
        send("error", { message: describeError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    },
  });
}

/**
 * PDFs and images are pulled in so Claude can read a source document, but they
 * would otherwise travel back to the browser and return on every later turn —
 * a scanned quotation is easily several megabytes. Replace them with a note:
 * by this point the agent has already read what it needed into its answer.
 */
function stripHeavyBlocks(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === "document" || block.type === "image"
          ? { type: "text", text: `[${block.type} read earlier in this conversation]` }
          : block,
      ),
    };
  });
}

/** Tool inputs are shown in the activity log; keep them short and safe to display. */
function summarise(input) {
  const out = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === "string") {
      out[key] = value.length > 120 ? `${value.slice(0, 120)}…` : value;
    } else if (Array.isArray(value)) {
      out[key] = `${value.length} item(s)`;
    } else if (value && typeof value === "object") {
      out[key] = value.name ?? "…";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function describeError(error) {
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Claude API. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "The ANTHROPIC_API_KEY is missing or invalid. Check the Cloudflare Pages environment variables.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API. Check the connection and try again.";
  }
  return error?.message ?? "Something went wrong.";
}
