/**
 * Fictional seller presets for demos and tests. They are sample data, not
 * product limits: owners can add and edit any goods, service or digital offer.
 */
import type { OfferKind } from "@/server/db/types";

export type PresetOffer = {
  key: string;
  kind: OfferKind;
  title: string;
  description: string;
  unitAmountMinor: number;
  fulfillmentNote: string;
  maxQuantity: number;
  stock?: number;
  requiresScopeReview?: boolean;
  serviceScope?: string;
  accessDays?: number;
  /** Which generated download this offer delivers (see sample-asset.ts). */
  download?: "northlight" | "brake-guide";
  /** Photo under public/shop/ (generated for this fictional shop, metadata stripped). */
  imagePath?: string;
};

export type Preset = {
  key: PresetKey;
  sellerName: string;
  summary: string;
  policies: {
    pickupPolicy: string | null;
    serviceRequestPolicy: string | null;
    digitalAccessPolicy: string | null;
    cancellationPolicy: string;
    taxPolicy: string;
  };
  offers: PresetOffer[];
};

export const PRESET_KEYS = ["goods", "service", "digital", "showcase"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

const PICKUP =
  "Pick up at 88 Mill Road, Tuesday to Saturday, 10:00 to 17:00. Bring your order number. Paid orders are held for 30 days.";
const SERVICE_REQUEST =
  "Paying sends a service request, not a booked time. We confirm a drop-off time with you within one business day. If we cannot fit you in within 7 days, ask us to cancel and we refund you through PayPal.";
const DIGITAL_ACCESS =
  "Your download link works for 30 days after payment. The files are yours to use for personal and commercial projects; do not resell the files themselves.";
const TAX = "Prices include all applicable sales tax.";

const LIGHT: PresetOffer = {
  key: "front-light",
  kind: "goods",
  title: "Rechargeable front light",
  imagePath: "/shop/front-light.webp",
  description:
    "800-lumen USB-C front light with a handlebar mount. Runs about 2 hours on high and 12 on the flashing setting. Rain-resistant.",
  unitAmountMinor: 9500,
  fulfillmentNote: "Pickup at the shop, Tuesday to Saturday.",
  maxQuantity: 4,
  stock: 4,
};
const PADS: PresetOffer = {
  key: "brake-pads",
  kind: "goods",
  title: "Disc brake pads",
  imagePath: "/shop/brake-pads.webp",
  description:
    "One pair of organic disc brake pads for Shimano-compatible two-piston calipers. Quiet, good in the wet. Fitting is not included.",
  unitAmountMinor: 3500,
  fulfillmentNote: "Pickup at the shop, Tuesday to Saturday.",
  maxQuantity: 6,
  stock: 6,
};
const SADDLE: PresetOffer = {
  key: "vintage-saddle",
  kind: "goods",
  title: "Restored leather saddle, one of a kind",
  imagePath: "/shop/saddle.webp",
  description:
    "A 1980s leather touring saddle, cleaned, re-oiled and tensioned in the shop. Fits standard seat-post clamps. Only one exists.",
  unitAmountMinor: 6500,
  fulfillmentNote: "Pickup at the shop, Tuesday to Saturday.",
  maxQuantity: 1,
  stock: 1,
};
const BRAKE_SERVICE: PresetOffer = {
  key: "brake-service",
  kind: "service",
  title: "Brake service",
  imagePath: "/shop/brake-service.webp",
  description:
    "Full brake service for one bike: inspection, new pads, rotor or rim truing, cable or hose adjustment, and a test ride. We confirm the exact scope before you pay.",
  unitAmountMinor: 12000,
  fulfillmentNote: "Drop off at the shop. We confirm a time with you after payment.",
  maxQuantity: 2,
  requiresScopeReview: true,
  serviceScope:
    "Inspect both brakes, replace pads (standard pads included), true rotors or rims, adjust cables or hoses, test ride. Other parts are quoted separately before any work.",
};
const BRAKE_CHECK: PresetOffer = {
  key: "brake-check",
  kind: "service",
  title: "Brake check",
  imagePath: "/shop/brake-check.webp",
  description:
    "Twenty-minute inspection of both brakes with a written note of what needs work. No parts or repairs included.",
  unitAmountMinor: 4000,
  fulfillmentNote: "Drop off at the shop. We confirm a time with you after payment.",
  maxQuantity: 2,
  requiresScopeReview: false,
  serviceScope: "Inspect both brakes and write down what needs work. No parts or repairs.",
};
const SAMPLE_PACK: PresetOffer = {
  key: "sample-pack",
  kind: "digital",
  title: "Northlight sample pack",
  imagePath: "/shop/northlight-pack.webp",
  description:
    "Three original abstract wallpapers as SVG files, so they stay sharp on any screen size. Good for a first look at the Northlight style. Beginner friendly: no editing needed.",
  unitAmountMinor: 2500,
  fulfillmentNote: "Instant download after payment is confirmed.",
  maxQuantity: 1,
  accessDays: 30,
  download: "northlight",
};
const BRAKE_GUIDE: PresetOffer = {
  key: "brake-guide",
  kind: "digital",
  title: "Home brake care guide",
  imagePath: "/shop/brake-guide.webp",
  description:
    "A short illustrated guide to checking pads, cables and rotors at home, and knowing when a brake needs the shop. HTML file, works offline.",
  unitAmountMinor: 2500,
  fulfillmentNote: "Instant download after payment is confirmed.",
  maxQuantity: 1,
  accessDays: 30,
  download: "brake-guide",
};

export const PRESETS: Record<PresetKey, Preset> = {
  goods: {
    key: "goods",
    sellerName: "Mill Road Bike Parts",
    summary: "A small bike parts shop selling lights, pads and saddles for pickup.",
    policies: {
      pickupPolicy: PICKUP,
      serviceRequestPolicy: null,
      digitalAccessPolicy: null,
      cancellationPolicy: "Cancel an unpicked order within 30 days for a full refund. Contact the shop to arrange it.",
      taxPolicy: TAX,
    },
    offers: [LIGHT, PADS, SADDLE],
  },
  service: {
    key: "service",
    sellerName: "Spoke Street Bike Repair",
    summary: "A bike repair shop taking paid service requests.",
    policies: {
      pickupPolicy: null,
      serviceRequestPolicy: SERVICE_REQUEST,
      digitalAccessPolicy: null,
      cancellationPolicy: "Cancel before drop-off for a full refund. Contact the shop to arrange it.",
      taxPolicy: TAX,
    },
    offers: [BRAKE_SERVICE, BRAKE_CHECK],
  },
  digital: {
    key: "digital",
    sellerName: "Northlight Photo Packs",
    summary: "A photographer selling a downloadable sample pack.",
    policies: {
      pickupPolicy: null,
      serviceRequestPolicy: null,
      digitalAccessPolicy: DIGITAL_ACCESS,
      cancellationPolicy: "Downloads are final once accessed. If a file is broken, contact us and we fix it or refund you.",
      taxPolicy: TAX,
    },
    offers: [SAMPLE_PACK],
  },
  showcase: {
    key: "showcase",
    sellerName: "Spoke Street Cycles",
    summary: "A fictional bike shop that sells parts, repairs and a download, so one desk shows every flow.",
    policies: {
      pickupPolicy: PICKUP,
      serviceRequestPolicy: SERVICE_REQUEST,
      digitalAccessPolicy: DIGITAL_ACCESS,
      cancellationPolicy: "Contact the shop to cancel. Unpicked goods and unscheduled services are refunded in full.",
      taxPolicy: TAX,
    },
    offers: [LIGHT, PADS, SADDLE, BRAKE_SERVICE, BRAKE_CHECK, BRAKE_GUIDE],
  },
};
