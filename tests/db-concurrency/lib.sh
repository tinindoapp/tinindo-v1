# Utilitários dos testes de concorrência (várias conexões simultâneas; pgTAP numa transação não cobre).
# Cada chamada de as_user abre uma conexão nova, com o JWT simulado do usuário e o papel authenticated.
as_user() { # $1 = user id, $2 = SQL
  psql -qXtA -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
set local role authenticated;
$2;
commit;
SQL
}
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (esperado $3, obtido $2)"; fail=1; fi; }
finish() { [ "$fail" -eq 0 ] && echo "$1: ok" || echo "$1: FALHOU"; exit "$fail"; }
