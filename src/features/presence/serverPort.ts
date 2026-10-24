// Portas reais de Site e Google: Edge Function `presence`.
import { DomainCheckOutput, PresenceOverview, PublicSiteOutput } from "@contracts";
import type { createApiClient } from "../../lib/api/client.ts";
import type { PresencePort, PublicSitePort } from "./port.ts";

type Call = ReturnType<typeof createApiClient>;
const op = (name: string) => `/presence/${name}`;

export function createServerPort(call: Call, tenantId: string): PresencePort {
  const post = (body: unknown, idempotencyKey?: string) => ({ method: "POST" as const, tenantId, body, idempotencyKey });
  const run = async (name: string, body: unknown, key?: string) => (await call(op(name), PresenceOverview, post(body, key))).data;
  return {
    kind: "server",
    overview: () => run("presence.get", {}),
    saveSite: (draft, key) => run("site.save", draft, key),
    publish: (expected_hash, key) => run("site.publish", { expected_hash }, key),
    unpublish: (expected_version, key) => run("site.unpublish", { expected_version }, key),
    restore: (version_no, expected_version, key) => run("site.restore", { version_no, expected_version }, key),
    addDomain: (hostname, key) => run("domain.add", { hostname }, key),
    removeDomain: (domain_id, expected_version, key) => run("domain.remove", { domain_id, expected_version }, key),
    async checkDomain(domain_id) {
      return (await call(op("domain.check"), DomainCheckOutput, post({ domain_id }))).data;
    },
    setGoogle: (action, key) => run("google.set", action, key),
  };
}

export function createServerPublicPort(call: Call): PublicSitePort {
  return {
    kind: "server",
    async site(slug) {
      return (await call(op("presence.public_site"), PublicSiteOutput, { method: "POST", body: { slug } })).data;
    },
  };
}
