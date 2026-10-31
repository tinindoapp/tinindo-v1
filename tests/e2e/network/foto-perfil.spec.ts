import { expect, test } from "@playwright/test";

// Recado #64, item 4: foto do perfil preparada no navegador (800 × 800, WebP, até 300 KB) e as chaves
// "Mostrar foto", "Mostrar botão do WhatsApp" e "Mostrar preços", que começam desligadas.
test("foto do perfil e chaves: preparo no aparelho e o que o público vê", async ({ page }) => {
  await page.goto("/app/perfil");
  await page.getByLabel("Endereço do perfil").fill("barbearia-foto");
  await page.getByLabel("Bairro ou região").fill("Centro");
  await page.getByRole("button", { name: "Publicar perfil" }).click();
  const media = page.getByRole("region", { name: "Foto e contato" });
  await expect(media.getByRole("checkbox", { name: /Mostrar foto/ })).toBeDisabled();

  // Foto de câmera em paisagem (1600 × 1200, JPEG): o app recorta em quadrado e converte.
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, "#ff4b1f");
    g.addColorStop(1, "#1f6bff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1600, 1200);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
      ctx.fillRect((i * 97) % 1600, (i * 53) % 1200, 40, 40);
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await media.getByLabel("Foto do negócio").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
  const preview = media.locator("img.tn-net-photo");
  await expect(preview).toBeVisible();
  const out = await preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const blob = await (await fetch(img.src)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { w: img.naturalWidth, h: img.naturalHeight, type: blob.type, size: blob.size, exif: new TextDecoder("latin1").decode(bytes).includes("Exif") };
  });
  expect(out).toMatchObject({ w: 800, h: 800, type: "image/webp", exif: false });
  expect(out.size).toBeLessThanOrEqual(300 * 1024);

  await expect(media.getByLabel("Descrição da foto")).toHaveValue(/^Foto de /);
  await media.getByLabel("Descrição da foto").fill("Fachada da barbearia");
  for (const name of [/Mostrar foto/, /Mostrar botão do WhatsApp/, /Mostrar preços/]) await media.getByRole("checkbox", { name }).check();
  await media.getByRole("button", { name: "Salvar foto e opções" }).click();
  await expect(page.getByText("Foto e opções do perfil salvas.")).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

  await page.getByRole("link", { name: "Abrir perfil público" }).click();
  await expect(page).toHaveURL(/\/p\/barbearia-foto$/);
  await expect(page.getByRole("img", { name: "Fachada da barbearia" })).toBeVisible();
  const wa = page.getByRole("link", { name: "Conversar no WhatsApp" });
  await expect(wa).toHaveAttribute("href", `https://wa.me/5511999990001?text=${encodeURIComponent("Olá! Vi seu perfil na Tinindo.")}`);
  expect((await wa.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("radio", { name: /^Corte/ }).locator("xpath=..")).toContainText(/a partir de R\$\s60,00/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
