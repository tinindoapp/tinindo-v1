// Ícone por tom (auditoria de UX, item 7): estado nunca só por cor. Cada tom tem um desenho próprio
// (informação "i", sucesso "✓", atenção "!" num triângulo, erro "×") e o texto acessível vem junto.
export type Tone = "info" | "success" | "warning" | "danger";

export const TONE_LABEL: Record<Tone, string> = {
  info: "Informação",
  success: "Concluído",
  warning: "Atenção",
  danger: "Erro",
};

const PATHS: Record<Tone, string[]> = {
  info: ["M10 9v5", "M10 6.2v.3"],
  success: ["M6.5 10.2l2.4 2.4 4.6-5"],
  warning: ["M10 2.8 18 16.6H2Z", "M10 8v3.6", "M10 13.9v.3"],
  danger: ["M7.2 7.2l5.6 5.6", "M12.8 7.2l-5.6 5.6"],
};

export function ToneIcon({ tone, size = 20 }: { tone: Tone; size?: number }) {
  return (
    <svg className="tn-tone-icon" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {tone === "warning" ? null : <circle cx="10" cy="10" r="8" />}
      {PATHS[tone].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
