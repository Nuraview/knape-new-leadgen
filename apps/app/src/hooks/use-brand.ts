import { type Brand, getSeedBrand } from "@/lib/brand";
import useGetConfig from "@/hooks/queries/config/use-get-config";

/**
 * The instance's branding.
 *
 * Returns the build-time seed until GET /api/config resolves, then the served
 * value — so the first paint is already correct and a later env change still
 * wins without a rebuild. See lib/brand.ts.
 */
export function useBrand(): Brand {
  const { data } = useGetConfig();
  return data?.brand ?? getSeedBrand();
}

export default useBrand;
