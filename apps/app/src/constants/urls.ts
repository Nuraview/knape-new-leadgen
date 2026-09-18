import { demoDataEnabled, isVendorDemoHost } from "@/lib/demo/enabled";

/**
 * Whether to draw the demo banner.
 *
 * This used to be the hostname check alone, which meant a build carrying the
 * seeded outreach dataset (VITE_DEMO_DATA=true) on any OTHER host served
 * invented send figures with no notice attached. The banner and the dataset
 * have to be one decision — see lib/demo/enabled.ts — so this is the union:
 * either the vendor's hosted demo, or any build made with the demo data on.
 */
export const isDemoMode = demoDataEnabled || isVendorDemoHost;
