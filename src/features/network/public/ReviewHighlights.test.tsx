// Vitrine do perfil (P55 parte 2, item 5): avaliações em destaque, lidas pela API pública do módulo Avaliações.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewPublicList } from "@contracts";
import { pickHighlights, ReviewHighlights, setReviewsReader, useReviewList } from "./ReviewHighlights.tsx";

const review = (i: number, rating: number, body: string | null) => ({
  id: `91000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  rating,
  body,
  service_name: "Corte",
  service_month: "2026-10",
  verified_booking: true as const,
  reply: null,
  created_at: `2026-10-${String(10 + i).padStart(2, "0")}T12:00:00Z`,
});
const list = (reviews: ReviewPublicList["reviews"], average: number | null = 4.3): ReviewPublicList => ({
  rules: { window_days: 30, min_reviews_for_average: 3, body_max: 600 },
  summary: { identity_verified: false, completed_bookings: 12, reviews_count: reviews.length, rating_average: average, certified_competence: false },
  reviews,
});
function Highlights() {
  return <ReviewHighlights slug="barbearia-exemplo-a" list={useReviewList("barbearia-exemplo-a")} />;
}
const show = (l: ReviewPublicList | null) => {
  setReviewsReader(async () => l);
  return render(<MemoryRouter><Highlights /></MemoryRouter>);
};

afterEach(() => setReviewsReader(null));

describe("avaliações em destaque no perfil", () => {
  it("as 3 mais recentes com comentário, sem escolher pela nota", () => {
    const top = pickHighlights(list([review(1, 5, "Ótimo"), review(2, 2, "Atrasou"), review(3, 4, null), review(4, 5, "Voltarei"), review(5, 3, "Ok")]));
    expect(top.map((r) => r.body)).toEqual(["Ok", "Voltarei", "Atrasou"]);
  });

  it("média com 3 ou mais, comentários e o link para todas", async () => {
    show(list([review(1, 5, "Ótimo corte"), review(2, 4, "Pontual"), review(3, 4, null)]));
    expect(await screen.findByRole("heading", { level: 2, name: "O que os clientes dizem" })).toBeInTheDocument();
    expect(screen.getByText(/de 5 · 3 avaliações/)).toHaveTextContent("4,3 de 5");
    expect(screen.getByLabelText("5 de 5 estrelas")).toBeInTheDocument();
    expect(screen.getByText("Ótimo corte")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver as 3 avaliações" })).toHaveAttribute("href", "/avaliacoes/barbearia-exemplo-a");
  });

  it("poucas para a média: sem média, com a avaliação", async () => {
    show(list([review(1, 5, "Gostei")], null));
    expect(await screen.findByText("Gostei")).toBeInTheDocument();
    expect(screen.queryByText(/de 5 ·/)).toBeNull();
    expect(screen.getByRole("link", { name: "Ver a avaliação" })).toBeInTheDocument();
  });

  it("sem avaliações ou leitura falhou: a seção não aparece", async () => {
    const { container } = show(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
