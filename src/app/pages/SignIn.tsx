// Login por e-mail e senha (Supabase Auth). Cadastro e recuperação são do P01 (/criar-conta, /recuperar-senha).
import { type FormEvent, useState } from "react";
import { Link, Navigate } from "react-router";
import { Button, Card, Field, StatusBanner, useFormErrors, Wordmark } from "../../components/ui/index.tsx";
import { useSession } from "../session.tsx";
import "./pages.css";

export function SignIn() {
  const { state, signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { formRef, errors, show, clear } = useFormErrors<"email" | "password">();

  if (state.status === "signed_in" || state.status === "offline_demo") return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setError(null);
    const ok = show({
      email: !email ? "Informe o e-mail." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Confira o e-mail: falta o @ ou o domínio." : null,
      password: !password ? "Informe a senha." : null,
    });
    if (!ok) return;
    setPending(true);
    setError(await signIn(email, password));
    setPending(false);
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="signin-title">
        <Wordmark width={144} />
        <h1 id="signin-title" className="tn-auth__title">Entrar</h1>
        <form ref={formRef} onSubmit={onSubmit} className="tn-stack" noValidate>
          <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} onChange={() => clear("email")} />
          <Field label="Senha" name="password" type="password" autoComplete="current-password" required error={errors.password} onChange={() => clear("password")} />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
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
