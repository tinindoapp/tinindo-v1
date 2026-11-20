import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tenantA } from "@contracts/fixtures.ts";
import { createDemoPublicPort, resetDemoState } from "./demoPort.ts";
import type { PublicReviewsPort } from "./port.ts";
import { setPublicBusinessReader } from "./public-kit.tsx";
import { PublicReviewsPage } from "./PublicReviewsPage.tsx";

const open = (port: PublicReviewsPort, slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/avaliacoes/${slug}`]}>
      <Routes>
        <Route path="/avaliacoes/:slug" element={<PublicReviewsPage port={port} />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => resetDemoState());
afterEach(() => setPublicBusinessReader(null));

describe("avaliações públicas", () => {
  it("05 #12: o título diz de quem são as avaliações, com o negócio no topo e a volta ao perfil", async () => {
    setPublicBusinessReader(async (slug) => ({ name: "Barbearia do Léo", slug, lead: "Barbearia · Centro", photo: null, whatsapp_e164: null }));
    open(createDemoPublicPort(), "barbearia-exemplo-a");
    expect(await screen.findByRole("heading", { level: 1, name: "Avaliações de Barbearia do Léo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Barbearia do Léo" })).toHaveAttribute("href", "/p/barbearia-exemplo-a");
    expect(screen.getByRole("list", { name: "Avaliações publicadas" }).children.length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Voltar ao perfil" })).toHaveAttribute("href", "/p/barbearia-exemplo-a");
    expect(screen.getByText("Página feita com a Tinindo")).toBeInTheDocument();
  });

  it("demonstração sem perfil lido: usa o nome do negócio de exemplo", async () => {
    open(createDemoPublicPort(), "barbearia-exemplo-a");
    expect(await screen.findByRole("heading", { level: 1, name: `Avaliações de ${tenantA.name}` })).toBeInTheDocument();
  });

  it("endereço desconhecido: não encontrado com saída, sem lista", async () => {
    open(createDemoPublicPort(), "nao-existe-aqui");
    expect(await screen.findByRole("heading", { level: 1, name: "Não encontramos estas avaliações" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Avaliações publicadas" })).not.toBeInTheDocument();
  });

  it("perfil publicado mas lista indisponível: a saída leva ao perfil do negócio", async () => {
    setPublicBusinessReader(async (slug) => ({ name: "Barbearia do Léo", slug, whatsapp_e164: null }));
    open({ kind: "server", list: () => Promise.reject(new Error("fora do ar")) }, "barbearia-do-leo");
    expect(await screen.findByRole("heading", { level: 1, name: "Não encontramos estas avaliações" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver a página de Barbearia do Léo" })).toHaveAttribute("href", "/p/barbearia-do-leo");
  });
});
