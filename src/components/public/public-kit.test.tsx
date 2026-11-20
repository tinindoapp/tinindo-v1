import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BusinessReader, setPublicBusinessReader, usePublicBusiness } from "./public-kit.tsx";

afterEach(() => setPublicBusinessReader(null));

describe("usePublicBusiness com um kit só para os módulos", () => {
  it("a leitura própria do Perfil não troca a leitura das páginas dos outros módulos", async () => {
    const standard = vi.fn<BusinessReader>(async () => ({ name: "Padrão" }));
    const own = vi.fn<BusinessReader>(async () => ({ name: "Do Perfil" }));
    setPublicBusinessReader(standard);
    const profile = renderHook(() => usePublicBusiness("barbearia-do-leo", own));
    const other = renderHook(() => usePublicBusiness("barbearia-do-leo"));
    await waitFor(() => expect(profile.result.current?.name).toBe("Do Perfil"));
    await waitFor(() => expect(other.result.current?.name).toBe("Padrão"));
    expect(own).toHaveBeenCalledTimes(1);
    expect(standard).toHaveBeenCalledTimes(1);
  });

  it("sem endereço válido não lê nada", () => {
    const own = vi.fn<BusinessReader>(async () => ({ name: "x" }));
    const { result } = renderHook(() => usePublicBusiness("A", own));
    expect(result.current).toBeNull();
    expect(own).not.toHaveBeenCalled();
  });
});
