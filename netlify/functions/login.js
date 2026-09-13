import { checkPasscode, issueCookie, clearCookie, readSession } from "../lib/session.js";

export default async (request) => {
  if (request.method === "GET") {
    return Response.json({ signedIn: Boolean(readSession(request)) });
  }
  if (request.method === "DELETE") {
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearCookie() } });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let passcode;
  try {
    ({ passcode } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    if (!checkPasscode(passcode)) {
      // Blunt the speed of an online guessing attempt.
      await new Promise((r) => setTimeout(r, 1000));
      return Response.json({ error: "Incorrect passcode." }, { status: 401 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true }, { headers: { "Set-Cookie": issueCookie() } });
};

export const config = { path: "/api/login" };
