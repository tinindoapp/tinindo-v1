// Cadastro, pedido de recuperação e nova senha (Supabase Auth). Mensagens neutras: a tela
// nunca diz se um e-mail tem conta. Cadastro e recuperação são PÚBLICOS: o integrador liga as
// rotas (db/proposals/P01/PROPOSTA_INTEGRADOR.md). Nova senha roda dentro de /app/conta.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Field, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { messageFor } from "./errors.ts";
import { MIN_PASSWORD_LENGTH } from "./presets.ts";
import { IdentityServicesProvider, useIdentityServices } from "./services.tsx";

function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== confirm) return "As senhas não são iguais.";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignUpPage() {
  const services = useIdentityServices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "confirm" | "signed_in">(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!EMAIL_RE.test(email)) return setError("Informe um e-mail válido.");
    const problem = passwordProblem(password, String(form.get("confirm") ?? ""));
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      const { needsConfirmation } = await services.signUp(email, password);
      setDone(needsConfirmation ? "confirm" : "signed_in");
    } catch (err) {
      setError(messageFor(err, "auth"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="signup-title">
        <Wordmark width={144} />
        <h1 id="signup-title" className="tn-auth__title">Criar conta</h1>
        {done === "confirm" ? (
          <StatusBanner tone="success">
            Se o e-mail puder ser usado, enviamos um link de confirmação. Abra o link para continuar.
          </StatusBanner>
        ) : done === "signed_in" ? (
          <StatusBanner tone="success">
            Conta criada. <Link to="/app/conta/novo-negocio">Criar meu negócio</Link>
          </StatusBanner>
        ) : (
          <form className="tn-stack" onSubmit={onSubmit} noValidate>
            <Field label="E-mail" name="email" type="email" autoComplete="email" required />
            <Field label="Senha" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
            <Field label="Repita a senha" name="confirm" type="password" autoComplete="new-password" required />
            {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
            <Button type="submit" disabled={pending || !services.online}>
              {pending ? "Criando…" : "Criar conta"}
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!EMAIL_RE.test(email)) return setError("Informe um e-mail válido.");
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
          <form className="tn-stack" onSubmit={onSubmit} noValidate>
            <Field label="E-mail da conta" name="email" type="email" autoComplete="email" required />
            {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
            <Button type="submit" disabled={pending || !services.online}>
              {pending ? "Enviando…" : "Enviar link"}
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
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const problem = passwordProblem(password, String(form.get("confirm") ?? ""));
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      await services.updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(messageFor(err, "auth"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="new-password-title">
      <p className="tn-caps">Conta</p>
      <h1 id="new-password-title">Nova senha</h1>
      {done ? (
        <StatusBanner tone="success">
          Senha alterada. <Link to="/app/conta">Voltar para a conta</Link>
        </StatusBanner>
      ) : (
        <form className="tn-stack" onSubmit={onSubmit} noValidate>
          <Field label="Nova senha" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          <Field label="Repita a nova senha" name="confirm" type="password" autoComplete="new-password" required />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <Button type="submit" disabled={pending || !services.online}>
            {pending ? "Salvando…" : "Salvar senha"}
          </Button>
        </form>
      )}
    </Card>
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
