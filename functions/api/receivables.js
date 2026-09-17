/**
 * The receivables position, computed from the finance workbook.
 *
 * This endpoint deliberately touches no language model. Ageing an invoice and
 * summing a customer's balance is arithmetic, and arithmetic should not cost
 * money, need an API key, or stop working because a billing account is in the
 * wrong country. The agent uses the same library through its own tool; this is
 * the same answer without the conversation.
 */

import { setEnv } from "../../lib/runtime.js";
import { requireSession } from "../../lib/session.js";
import { loadLedger, analyseReceivables } from "../../lib/ledger.js";
import { ledgerFileId, profile } from "../../lib/config.js";

export async function onRequest(context) {
  const { request } = context;
  setEnv(context.env);

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    requireSession(request);
  } catch {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const customer = url.searchParams.get("customer");

  try {
    const ledger = await loadLedger(ledgerFileId());
    const co = profile().company;

    const report = analyseReceivables(
      ledger.rows,
      new Date(),
      customer || null,
      [co.tradingName, co.legalName].filter(Boolean),
    );

    return Response.json(
      { source: { name: ledger.name, sheet: ledger.sheetName }, ...report },
      // The figures change whenever someone edits the workbook, and a stale
      // balance is worse than a slow one.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
