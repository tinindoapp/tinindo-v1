// P53: na demonstração offline não há cliente de API; o contexto do negócio é o da fixture e a porta é a de demonstração.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tenantA } from "@contracts/fixtures.ts";
import { useApi, useBusinessTimezone, usePort } from "./api.tsx";
import { SessionProvider } from "./session.tsx";

const demo = () => "porta de demonstração";
const server = () => "porta do servidor";

function Probe() {
  const { demo: isDemo, call } = useApi();
  const { timezone } = useBusinessTimezone();
  const port = usePort({ demo, server });
  return <p>{`${isDemo}|${call === null}|${timezone}|${port}`}</p>;
}

describe("sessão na demonstração", () => {
  it("sem cliente, fuso da fixture e porta de demonstração", () => {
    render(
      <SessionProvider client={null}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByText(`true|true|${tenantA.timezone}|porta de demonstração`)).toBeInTheDocument();
  });
});
