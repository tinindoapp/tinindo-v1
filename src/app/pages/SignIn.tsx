// Login por e-mail e senha (Supabase Auth). Cadastro e recuperação são do P01 (/criar-conta, /recuperar-senha).
// Primeiro acesso de verdade: volta ao destino (`?volta=/app/...`, de um link de recado ou de uma sessão que expirou),
// avisa por que a pessoa caiu aqui (`?motivo=`) e, se falta confirmar o e-mail, oferece reenviar o link.
import { type FormEvent, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Button, Card, Field, StatusBanner, useFormErrors, Wordmark } from "../../components/ui/index.tsx";
import { PasswordToggle, usePasswordVisibility } from "../../features/identity/PasswordToggle.tsx";
import { REASON_PARAM, RETURN_PARAM, safeReturnPath, type SignInReason } from "../return-to.ts";
import { EMAIL_NOT_CONFIRMED, useSession } from "../session.tsx";
import "./pages.css";

const REASON_TEXT: Record<SignInReason, { tone: "info" | "warning"; text: string }> = {
  sessao: { tone: "warning", text: "Sua sessão terminou. Entre de novo para continuar de onde parou." },
  saiu: { tone: "info", text: "Você saiu da conta. O que estava guardado neste aparelho foi apagado." },
  link: { tone: "warning", text: "O link do e-mail venceu ou já foi usado. Entre com a senha ou peça outro link em “Esqueci minha senha”." },
};

export function SignIn() {
  const { state, signIn, resendConfirmation } = useSession();
  const [params] = useSearchParams();
  const back = safeReturnPath(params.get(RETURN_PARAM)) ?? "/app";
  const reason = params.get(REASON_PARAM) as SignInReason | null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastEmail, setLastEmail] = useState("");
  const [resent, setResent] = useState<null | "sent" | "limit">(null);
  const { formRef, errors, show, clear } = useFormErrors<"email" | "password">();
  const password = usePasswordVisibility();

  if (state.status === "signed_in" || state.status === "offline_demo") return <Navigate to={back} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    setResent(null);
    const ok = show({
      email: !email ? "Informe o e-mail." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Confira o e-mail: falta o @ ou o domínio." : null,
      password: !password ? "Informe a senha." : null,
    });
    if (!ok) return;
    setPending(true);
    setLastEmail(email);
    setError(await signIn(email, password));
    setPending(false);
  }

  async function resend() {
    try {
      await resendConfirmation(lastEmail);
      setResent("sent");
    } catch {
      setResent("limit");
    }
  }

  const notice = reason && REASON_TEXT[reason] ? REASON_TEXT[reason] : null;
  return (
    <main className="tn-auth">
      <Card aria-labelledby="signin-title">
        <Wordmark width={144} />
        <h1 id="signin-title" className="tn-auth__title">Entrar</h1>
        {notice && !error ? <StatusBanner tone={notice.tone}>{notice.text}</StatusBanner> : null}
        <form ref={formRef} onSubmit={onSubmit} className="tn-stack" noValidate>
          <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} onChange={() => clear("email")} />
          <Field
            id="signin-password"
            label="Senha"
            name="password"
            type={password.type}
            autoComplete="current-password"
            required
            error={errors.password}
            onChange={() => clear("password")}
          />
          <PasswordToggle visible={password.visible} onToggle={password.toggle} controls="signin-password" />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          {error === EMAIL_NOT_CONFIRMED ? (
            resent === "sent" ? (
              <StatusBanner tone="success">Se o e-mail puder ser usado, enviamos um link novo. Confira também o spam.</StatusBanner>
            ) : resent === "limit" ? (
              <StatusBanner tone="warning">Muitos envios seguidos. Espere alguns minutos e tente de novo.</StatusBanner>
            ) : (
              <Button variant="secondary" onClick={() => void resend()}>Reenviar o link de confirmação</Button>
            )
          ) : null}
          {/* Enquanto a sessão carrega o botão fica ocupado (não "bloqueado"); ao enviar, mostra Entrando…. */}
          <Button type="submit" loading={pending || state.status === "loading"} loadingText={pending ? "Entrando…" : undefined}>
            Entrar
          </Button>
        </form>
        <p className="tn-auth__links">
          <Link to="/criar-conta">Criar conta</Link>
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
        </p>
      </Card>
    </main>
  );
}
