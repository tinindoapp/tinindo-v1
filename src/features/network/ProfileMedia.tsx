// Foto e chaves do perfil (recado #64, item 4). A foto é preparada no aparelho (recorte, WebP, sem localização),
// vai para a pasta do negócio no Storage e só então o perfil passa a apontar para ela; a anterior é apagada.
// As três chaves começam desligadas e o servidor decide o que o público recebe.
import { type FormEvent, useEffect, useState } from "react";
import { Button, Card, ChoiceCard, Field, StatusBanner, toast } from "../../components/ui/index.tsx";
import type { NetworkApi, OwnerProfile } from "./api.ts";
import { PhotoError, type ProcessedPhoto, processPhoto } from "./photo.ts";
import { errorMessage, newIdempotencyKey } from "./useNetworkApi.ts";

/** "+5511999990001" → "(11) 99999-0001". */
function formatBrPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function ProfileMediaEditor({ api, profile, onSaved }: { api: NetworkApi; profile: OwnerProfile; onSaved: () => Promise<void> }) {
  const m = profile.media;
  // Foto nova escolhida e ainda não salva; `uploaded` guarda o caminho já enviado para uma nova tentativa não reenviar.
  const [draft, setDraft] = useState<{ photo: ProcessedPhoto; preview: string; uploaded: string | null } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [alt, setAlt] = useState(m.photo_alt);
  const [showPhoto, setShowPhoto] = useState(m.show_photo);
  const [showWhatsapp, setShowWhatsapp] = useState(m.show_whatsapp);
  const [showPrices, setShowPrices] = useState(m.show_prices);
  const [busy, setBusy] = useState<"photo" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Mesma chave enquanto nada muda: um retry não grava duas vezes.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const touch = () => setIdemKey(newIdempotencyKey());

  const draftPreview = draft?.preview;
  useEffect(() => () => {
    if (draftPreview) URL.revokeObjectURL(draftPreview);
  }, [draftPreview]);

  const hasPhoto = draft ? true : !removed && !!m.photo_path;
  const preview = draft?.preview ?? (!removed ? m.photo_url : null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    setProblem(null);
    try {
      const photo = await processPhoto(file);
      setDraft({ photo, preview: URL.createObjectURL(photo.blob), uploaded: null });
      setRemoved(false);
      touch();
    } catch (e) {
      setProblem(e instanceof PhotoError ? e.message : "Não foi possível abrir esta imagem. Tente outra foto.");
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setProblem(null);
    try {
      let path = removed ? null : m.photo_path;
      if (draft) {
        path = draft.uploaded ?? (await api.uploadProfilePhoto(draft.photo)).path;
        setDraft({ ...draft, uploaded: path });
      }
      await api.setProfileMedia(
        { photo_path: path, photo_alt: alt.trim() || null, show_photo: showPhoto && !!path, show_whatsapp: showWhatsapp, show_prices: showPrices },
        idemKey,
      );
      // Uma foto por negócio: a anterior sai do Storage depois que o perfil já aponta para a nova.
      if (m.photo_path && m.photo_path !== path) await api.removeProfilePhoto(m.photo_path).catch(() => undefined);
      toast("Foto e opções do perfil salvas.");
      await onSaved();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card aria-labelledby="midia-titulo">
      <h2 id="midia-titulo">Foto e contato</h2>
      <form className="tn-stack" onSubmit={save} noValidate>
        <div className="tn-net-head">
          {preview ? (
            <img className="tn-net-photo" src={preview} alt={alt.trim() || m.photo_alt} width={96} height={96} />
          ) : (
            <p className="tn-muted">Sem foto.</p>
          )}
          <Field
            label="Foto do negócio"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hint="JPG, PNG ou WebP de até 10 MB. A foto é recortada em quadrado e a localização da câmera é apagada antes do envio."
            disabled={busy !== null}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {busy === "photo" ? <p role="status">Preparando a foto…</p> : null}
        {hasPhoto ? (
          <>
            <Field
              label="Descrição da foto"
              value={alt}
              maxLength={200}
              hint="Lida para quem usa leitor de tela."
              onChange={(e) => {
                setAlt(e.target.value);
                touch();
              }}
            />
            <div className="tn-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(null);
                  setRemoved(true);
                  setShowPhoto(false);
                  touch();
                }}
              >
                Remover foto
              </Button>
            </div>
          </>
        ) : null}
        <fieldset className="tn-stack" data-gap="sm">
          <legend>O que aparece no perfil público</legend>
          <ChoiceCard
            type="checkbox"
            name="midia"
            value="show_photo"
            checked={showPhoto && hasPhoto}
            disabled={!hasPhoto}
            onChange={(on) => {
              setShowPhoto(on);
              touch();
            }}
            title="Mostrar foto"
            description={hasPhoto ? "A foto aparece no perfil e na prévia do link." : "Escolha uma foto primeiro."}
          />
          <ChoiceCard
            type="checkbox"
            name="midia"
            value="show_whatsapp"
            checked={showWhatsapp}
            onChange={(on) => {
              setShowWhatsapp(on);
              touch();
            }}
            title="Mostrar botão do WhatsApp"
            description={
              m.whatsapp_e164
                ? `Abre uma conversa com o número do negócio, ${formatBrPhone(m.whatsapp_e164)}.`
                : "Conecte o WhatsApp do negócio em Mensagens para o botão aparecer."
            }
          />
          <ChoiceCard
            type="checkbox"
            name="midia"
            value="show_prices"
            checked={showPrices}
            onChange={(on) => {
              setShowPrices(on);
              touch();
            }}
            title="Mostrar preços"
            description="Mostra “a partir de R$ X” em cada serviço, com o preço base do cadastro."
          />
        </fieldset>
        {problem ? <StatusBanner tone="danger">{problem}</StatusBanner> : null}
        <div className="tn-actions">
          <Button type="submit" loading={busy === "save"} loadingText="Salvando…" disabled={busy === "photo"}>
            Salvar foto e opções
          </Button>
        </div>
      </form>
    </Card>
  );
}
