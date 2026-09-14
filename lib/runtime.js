/**
 * Environment access.
 *
 * On Netlify (Node) secrets arrive as process.env. On Cloudflare Workers there
 * is no process.env — the bindings are handed to the request handler instead.
 * Each Pages Function calls setEnv() with what it was given; the library
 * modules read through env() and stay host-neutral.
 *
 * Storing it at module scope is safe here: a Worker isolate is created per
 * deployment and every request it serves carries the same bindings.
 */

let current = null;

export function setEnv(bindings) {
  current = bindings;
}

export function env(name) {
  // Fall back to process.env so the modules still run under Node, which is how
  // the test scripts and any local tooling execute them.
  const value = current?.[name] ?? globalThis.process?.env?.[name];
  return value;
}

export function requireEnv(name, hint = "See AGENT_SETUP.md.") {
  const value = env(name);
  if (!value) throw new Error(`Missing environment variable ${name}. ${hint}`);
  return value;
}
