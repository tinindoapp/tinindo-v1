// Login por e-mail e senha (Supabase Auth). Cadastro e recuperação são do P01 (/criar-conta, /recuperar-senha).
import { type FormEvent, useState } from "react";
import { Link, Navigate } from "react-router";
import { Button, Card, Field, StatusBanner, Wordmark } from "../../components/ui/index.tsx";
import { useSession } from "../session.tsx";
import "./pages.css";

export function SignIn() {
  const { state, signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (state.status === "signed_in" || state.status === "offline_demo") return <Navigate to="/app" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? "")));
    setPending(false);
  }

  return (
    <main className="tn-auth">
      <Card aria-labelledby="signin-title">
        <Wordmark width={144} />
        <h1 id="signin-title" className="tn-auth__title">Entrar</h1>
        <form onSubmit={onSubmit} className="tn-stack" noValidate>
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <Field label="Senha" name="password" type="password" autoComplete="current-password" required />
          {error ? <StatusBanner tone="danger">{error}</StatusBanner> : null}
          <Button type="submit" disabled={pending || state.status === "loading"}>
            {pending ? "Entrando…" : "Entrar"}
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
