// Cadastro, pedido de recuperação e nova senha (Supabase Auth). Mensagens neutras: a tela
// nunca diz se um e-mail tem conta. Cadastro e recuperação são PÚBLICOS: o integrador liga as
// rotas (db/proposals/P01/PROPOSTA_INTEGRADOR.md). Nova senha roda dentro de /app/conta.
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Card, Field, PageHeader, StatusBanner, toast, useFormErrors, Wordmark } from "../../components/ui/index.tsx";
import { EMAIL_UNAVAILABLE, messageFor } from "./errors.ts";
import { PasswordToggle, usePasswordVisibility } from "./PasswordToggle.tsx";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "./presets.ts";
import { AuthFlowError, IdentityServicesProvider, useIdentityServices } from "./services.tsx";

/** Erros de senha por campo: o tamanho fica na senha; a diferença, na repetição. */
function passwordErrors(password: string, confirm: string) {
  return {
    password: !password
      ? "Crie uma senha."
      : password.length < MIN_PASSWORD_LENGTH
        ? `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
        : !/\p{L}/u.test(password) || !/\d/.test(password)
          ? "Use letras e números na senha."
          : null,
    confirm: !confirm ? "Repita a senha." : password && confirm !== password ? "As senhas não são iguais." : null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailError = (email: string) => (!email ? "Informe seu e-mail." : EMAIL_RE.test(email) ? null : "Informe um e-mail válido.");

export function SignUpPage() {
  const services = useIdentityServices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "confirm" | "signed_in">(null);
  const { formRef, errors, show, clear } = useFormErrors<"email" | "password" | "confirm">();
  const password = usePasswordVisibility();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!show({ email: emailError(email), ...passwordErrors(password, String(form.get("confirm") ?? "")) })) return;
    setPending(true);
    setError(null);
    try {
      const { needsConfirmation } = await services.signUp(email, password);
      setDone(needsConfirmation ? "confirm" : "signed_in");
    } catch (err) {
      setError(err instanceof AuthFlowError && err.kind === "email_unavailable" ? EMAIL_UNAVAILABLE : messageFor(err, "auth"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="signup-title">
        <Wordmark width={144} />
        <h1 id="signup-title" className="tn-auth__title">Criar conta</h1>
        <p className="tn-auth__subtitle">
          Para quem atende com hora marcada: agenda, clientes, preços e recebimentos num lugar só.
        </p>
        {done === "confirm" ? (
          <StatusBanner tone="success">
            Se o e-mail puder ser usado, enviamos um link de confirmação. Abra o link para continuar.
          </StatusBanner>
        ) : done === "signed_in" ? (
          <StatusBanner tone="success">
            Conta criada. <Link to="/app/conta/novo-negocio">Criar meu negócio</Link>
          </StatusBanner>
        ) : (
          <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate>
            <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} onChange={() => clear("email")} />
            <Field
              id="signup-password"
              label="Senha"
              name="password"
              type={password.type}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              hint={PASSWORD_HINT}
              error={errors.password}
              onChange={() => clear("password")}
            />
            <Field
              id="signup-confirm"
              label="Repita a senha"
              name="confirm"
              type={password.type}
              autoComplete="new-password"
              required
              error={errors.confirm}
              onChange={() => clear("confirm")}
            />
            <PasswordToggle visible={password.visible} onToggle={password.toggle} controls="signup-password signup-confirm" />
            {error === EMAIL_UNAVAILABLE ? (
              <StatusBanner tone="danger">
                {error} <Link to="/entrar">Entrar</Link> · <Link to="/recuperar-senha">Recuperar a senha</Link>
              </StatusBanner>
            ) : error ? (
              <StatusBanner tone="danger">{error}</StatusBanner>
            ) : null}
            <Button type="submit" loading={pending} loadingText="Criando…" disabled={!services.online}>
              Criar conta
            </Button>
            {!services.online ? <StatusBanner tone="info">Demonstração sem servidor: cadastro desabilitado.</StatusBanner> : null}
            <Link to="/entrar">Já tenho conta</Link>
          </form>
        )}
      </Card>
    </main>
  );
}

export function RecoverPasswordPage() {
  const services = useIdentityServices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"email">();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!show({ email: emailError(email) })) return;
    setPending(true);
    setError(null);
    try {
      await services.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(messageFor(err, "auth"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="recover-title">
        <Wordmark width={144} />
        <h1 id="recover-title" className="tn-auth__title">Recuperar acesso</h1>
        {sent ? (
          <StatusBanner tone="success">
            Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. O link vale por pouco
            tempo.
          </StatusBanner>
        ) : (
          <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate>
            <Field label="E-mail da conta" name="email" type="email" autoComplete="email" required error={errors.email} onChange={() => clear("email")} />
            {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
            <Button type="submit" loading={pending} loadingText="Enviando…" disabled={!services.online}>
              Enviar link
            </Button>
          </form>
        )}
        <Link to="/entrar">Voltar para entrar</Link>
      </Card>
    </main>
  );
}

export function NewPasswordPage() {
  const services = useIdentityServices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { formRef, errors, show, clear } = useFormErrors<"password" | "confirm">();
  const password = usePasswordVisibility();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (!show(passwordErrors(password, String(form.get("confirm") ?? "")))) return;
    setPending(true);
    setError(null);
    try {
      await services.updatePassword(password);
      toast("Senha alterada.");
      navigate("/app/conta");
    } catch (err) {
      setError(messageFor(err, "auth"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tn-stack">
      <PageHeader id="new-password-title" eyebrow="Conta" title="Nova senha" />
      <Card aria-labelledby="new-password-title">
        <form className="tn-stack" onSubmit={onSubmit} ref={formRef} noValidate>
          <Field
            id="new-password"
            label="Nova senha"
            name="password"
            type={password.type}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            hint={PASSWORD_HINT}
            error={errors.password}
            onChange={() => clear("password")}
          />
          <Field
            id="new-password-confirm"
            label="Repita a nova senha"
            name="confirm"
            type={password.type}
            autoComplete="new-password"
            required
            error={errors.confirm}
            onChange={() => clear("confirm")}
          />
          <PasswordToggle visible={password.visible} onToggle={password.toggle} controls="new-password new-password-confirm" />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <div className="tn-actions">
            <Button type="submit" loading={pending} loadingText="Salvando…" disabled={!services.online}>
              Salvar senha
            </Button>
            <Link to="/app/conta">Voltar</Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Rotas públicas prontas para o roteador central (fora do AppShell). */
export function PublicSignUp() {
  return (
    <IdentityServicesProvider>
      <SignUpPage />
    </IdentityServicesProvider>
  );
}

export function PublicRecoverPassword() {
  return (
    <IdentityServicesProvider>
      <RecoverPasswordPage />
    </IdentityServicesProvider>
  );
}
