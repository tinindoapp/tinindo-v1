// Os schemas complementares do módulo network (P09) são contrato v1 em _shared/contracts
// (network.ts). Reexportados aqui para a função e para os testes do módulo.
export {
  OwnerProfile,
  OwnerProfileOutput,
  ProfileUnpublishOutput,
  PublicSlotsInput,
  ReferralClaimOutput,
  ReferralInspectOutput,
  ReferralListOutput,
  ReferralState,
  ReferralSummary,
  ReferralToken,
  ReferralTokenInput,
  Slug,
} from "../_shared/contracts/index.ts";
