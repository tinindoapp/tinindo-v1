// Telas de Avaliações, carregadas sob demanda pelo manifesto (module.tsx).
import { usePort, useSessionPort } from "../../app/api.tsx";
import { useSession } from "../../app/session.tsx";
import { PageHeader, StatusBanner } from "../../components/ui/index.tsx";
import { createDemoCustomerPort, createDemoOwnerPort } from "./demoPort.ts";
import type { CustomerReviewsPort, OwnerReviewsPort } from "./port.ts";
import { CustomerReviewPage, OwnerReviewsPage } from "./ReviewPages.tsx";
import { createServerCustomerPort, createServerOwnerPort } from "./serverPort.ts";

export function OwnerLayout() {
  const { tenantId } = useSession();
  const port = usePort<OwnerReviewsPort>({ demo: createDemoOwnerPort, server: createServerOwnerPort });
  if (!port) {
    return (
      <div className="tn-page-intro">
        <PageHeader id="rev-no-tenant" title="Avaliações" />
        <StatusBanner tone="info">Selecione um negócio.</StatusBanner>
      </div>
    );
  }
  return <OwnerReviewsPage key={`${port.kind}:${tenantId ?? ""}`} port={port} />;
}

/** O cliente avalia (com login, sem negócio). */
export function CustomerReview() {
  const port = useSessionPort<CustomerReviewsPort>({ demo: createDemoCustomerPort, server: createServerCustomerPort });
  return <CustomerReviewPage port={port} />;
}
