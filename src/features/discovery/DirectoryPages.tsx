// Diretório (P23): opt-in do dono (no app) e as páginas públicas de busca. O cartão só mostra campos autorizados; a
// ordem e os filtros são os documentados, e a página os mostra. Sem destaque pago, nota ou posição comprada.
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Card, Field, Help, LinkButton, PageHeader, StatusBanner, toast, useFormErrors } from "../../components/ui/index.tsx";
import { CATEGORY_LABEL, CATEGORY_PLURAL, directoryPath, explain, STATUS_LABEL, UFS, WEEKDAY, WEEKDAY_SHORT } from "./labels.ts";
import { type DirectoryCard, type DirectoryCities, type DirectoryPort, type DirectorySearch, type DiscoveryOverview, type DiscoveryPort, newKey } from "./port.ts";

export function CardView({ c }: { c: DirectoryCard }) {
  return (
    <li className="tn-dir-card">
      <div>
        <Link to={c.site_path ?? c.profile_path}><strong>{c.display_name ?? `${CATEGORY_LABEL[c.category]} · ${c.area}`}</strong></Link>
        <p className="tn-muted">{CATEGORY_LABEL[c.category]} · {c.area} · {c.city_name}/{c.uf}</p>
        {c.weekdays?.length ? <p className="tn-muted">Atende {c.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ")}</p> : null}
      </div>
      {c.booking ? <Link className="tn-dir-link" to={c.profile_path}>Ver horários</Link> : null}
    </li>
  );
}

/** Tela do dono: entrar ou sair do diretório, cidade e se mostra o expediente. */
export function DiscoverySettingsPage({ port }: { port: DiscoveryPort }) {
  const [o, setO] = useState<DiscoveryOverview | null>(null);
  const [uf, setUf] = useState("SP");
  const [city, setCity] = useState("");
  const [hours, setHours] = useState(false);
  const [listed, setListed] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"city">();
  const fill = (v: DiscoveryOverview) => {
    setO(v);
    if (v.listing) {
      setUf(v.listing.uf);
      setCity(v.listing.city_name);
      setHours(v.listing.show_hours);
      setListed(v.listing.status === "listed");
    }
  };
  useEffect(() => {
    let alive = true;
    port.overview().then((v) => alive && fill(v), (e: unknown) => alive && setLoadError(explain(e)));
    return () => { alive = false; };
  }, [port]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!o) return;
    if (!show({ city: city.trim().length >= 2 ? null : "Informe a cidade." })) return;
    const wasListed = o.listing?.status === "listed";
    const before = o.listing;
    setBusy(true);
    setError(null);
    try {
      const v = await port.save({ expected_version: o.listing?.version ?? 0, uf, city_name: city, show_hours: hours, listed }, newKey());
      fill(v);
      if (v.visible) toast("Pronto: seu negócio aparece no diretório.");
      else if (wasListed && before) {
        // Sair do diretório volta atrás salvando de novo como estava: executa e oferece Desfazer.
        toast({
          message: "Salvo. Seu negócio não aparece no diretório.",
          action: {
            label: "Desfazer",
            onAction: () =>
              port
                .save({ expected_version: v.listing?.version ?? 0, uf: before.uf, city_name: before.city_name, show_hours: before.show_hours, listed: true }, newKey())
                .then((back) => {
                  fill(back);
                  toast("Seu negócio voltou ao diretório.");
                }, (err: unknown) => toast({ tone: "danger", message: explain(err) })),
          },
        });
      } else toast("Salvo. Seu negócio não aparece no diretório.");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tn-dir">
      <PageHeader id="dir-title" title="Diretório" subtitle="Apareça na busca de profissionais da sua cidade, só com o que seu perfil público já mostra." />
      <Help><p>Clientes encontram profissionais por profissão, cidade, bairro e dia de atendimento. O diretório repete só o que você já publicou no perfil (e o site, se houver). A ordem é alfabética, para todos; ninguém paga para aparecer antes.</p></Help>
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Diretório de exemplo; nada é publicado na internet.</StatusBanner> : null}
      {loadError ? <StatusBanner tone="danger">{loadError}</StatusBanner> : null}
      {o && !o.profile.published ? (
        <StatusBanner tone="warning"><strong>Publique seu perfil público primeiro.</strong> <LinkButton to="/app/perfil" variant="secondary">Abrir Perfil</LinkButton></StatusBanner>
      ) : null}
      {o ? (
        <>
          <Card aria-labelledby="dir-form-title">
            <div className="tn-dir-head">
              <h2 id="dir-form-title">Sua presença no diretório</h2>
              {o.listing ? <span className="tn-dir-chip" data-status={o.listing.status}>{STATUS_LABEL[o.listing.status]}</span> : null}
            </div>
            {o.listing?.status === "suspended" ? <StatusBanner tone="warning">Suspenso pela moderação: {o.listing.suspended_reason}. Fale com o suporte para revisar.</StatusBanner> : null}
            <form className="tn-dir-form" aria-label="Diretório" onSubmit={(e) => void submit(e)} ref={formRef} noValidate>
              <label className="tn-dir-check"><input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} /> Quero aparecer no diretório</label>
              <div className="tn-dir-inline">
                <Field as="select" label="UF" className="tn-dir-uf" value={uf} onChange={(e) => setUf(e.target.value)}>
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Field>
                <Field
                  label="Cidade"
                  value={city}
                  maxLength={80}
                  onChange={(e) => { setCity(e.target.value); clear("city"); }}
                  placeholder="São Paulo"
                  error={errors.city}
                />
              </div>
              <label className="tn-dir-check"><input type="checkbox" checked={hours} onChange={(e) => setHours(e.target.checked)} /> Mostrar os dias em que atendo (permite a busca por dia)</label>
              {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
              <div><Button type="submit" loading={busy}>Salvar</Button></div>
            </form>
          </Card>
          {o.card ? (
            <Card aria-labelledby="dir-preview-title">
              <h2 id="dir-preview-title">Como aparece</h2>
              <ul className="tn-dir-list" aria-label="Seu cartão no diretório"><CardView c={o.card} /></ul>
              <LinkButton to={directoryPath(o.card.uf, o.card.city_slug, o.card.category)} variant="secondary">Ver no diretório</LinkButton>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Página pública: índice de cidades e busca. /diretorio e /diretorio/:uf/:cidade/:categoria? */
export function PublicDirectoryPage({ port }: { port: DirectoryPort }) {
  const { uf: ufParam, cidade, categoria } = useParams();
  const navigate = useNavigate();
  const category = categoria && categoria in CATEGORY_LABEL ? (categoria as DirectoryCard["category"]) : null;
  const [cities, setCities] = useState<DirectoryCities | null>(null);
  const [result, setResult] = useState<{ key: string; data: DirectorySearch | null; error: string | null } | null>(null);
  const [area, setArea] = useState("");
  const [weekday, setWeekday] = useState("");
  const key = `${ufParam}/${cidade}/${category}/${area}/${weekday}`;
  useEffect(() => {
    let alive = true;
    port.cities(null).then((c) => alive && setCities(c), () => alive && setCities({ cities: [] }));
    return () => { alive = false; };
  }, [port]);
  useEffect(() => {
    if (!ufParam || !cidade) return;
    let alive = true;
    port.search({ uf: ufParam.toUpperCase(), city_slug: cidade, category, area: area.trim() || null, weekday: weekday === "" ? null : Number(weekday) })
      .then((d) => alive && setResult({ key, data: d, error: null }), (e: unknown) => alive && setResult({ key, data: null, error: explain(e) }));
    return () => { alive = false; };
  }, [port, ufParam, cidade, category, area, weekday, key]);
  const current = result?.key === key ? result : null;
  const cityName = current?.data?.city_name ?? cidade;
  return (
    <main className="tn-dir-page">
      {port.kind === "demo" ? <StatusBanner tone="info"><strong>Demonstração.</strong> Negócios de exemplo.</StatusBanner> : null}
      <h1>{ufParam && cidade ? `${category ? CATEGORY_PLURAL[category] : "Profissionais"} em ${cityName}/${ufParam.toUpperCase()}` : "Encontre um profissional"}</h1>
      {!ufParam ? (
        <section aria-labelledby="dir-cities">
          <h2 id="dir-cities">Cidades</h2>
          {cities?.cities.length === 0 ? <p>Nenhuma cidade com profissionais listados ainda.</p> : null}
          <ul className="tn-dir-list" aria-label="Cidades">
            {cities?.cities.map((c) => <li key={`${c.uf}/${c.city_slug}`} className="tn-dir-card"><Link to={directoryPath(c.uf, c.city_slug)}>{c.city_name}/{c.uf}</Link><span className="tn-muted">{c.count} profissional(is)</span></li>)}
          </ul>
        </section>
      ) : (
        <>
          <form className="tn-dir-filters" aria-label="Filtros" onSubmit={(e) => e.preventDefault()}>
            <Field as="select" label="Profissão" value={category ?? ""} onChange={(e) => navigate(directoryPath(ufParam, cidade!, e.target.value || null))}>
              <option value="">Todas</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Field>
            <Field label="Bairro" value={area} maxLength={60} onChange={(e) => setArea(e.target.value)} />
            <Field as="select" label="Atende no dia" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              <option value="">Qualquer dia</option>
              {WEEKDAY.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </Field>
          </form>
          {!current ? <p role="status">Carregando…</p> : null}
          {current?.error ? <StatusBanner tone="danger">{current.error}</StatusBanner> : null}
          {current?.data ? (
            <>
              <p className="tn-muted" aria-live="polite">{current.data.total} resultado(s) · {current.data.criteria.order} · sem destaque pago</p>
              <ul className="tn-dir-list" aria-label="Resultados">{current.data.items.map((c) => <CardView key={c.slug} c={c} />)}</ul>
              <details className="tn-dir-criteria"><summary>Como os resultados são escolhidos</summary>
                <p>Filtros: {current.data.criteria.filters.join("; ")}.</p>
                <p>Ordem: {current.data.criteria.order}. Nunca: {current.data.criteria.never.join(", ")}.</p>
              </details>
            </>
          ) : null}
          <p><Link to="/diretorio">Outras cidades</Link></p>
        </>
      )}
    </main>
  );
}
