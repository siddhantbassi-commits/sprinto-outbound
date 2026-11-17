import type { Band } from "./types";

/**
 * ICP version 1: the researched hypothesis from docs/Sprinto-Outbound-Scope.md section 3.
 * In the app this becomes a versioned, signed-off row the Growth Lead edits with a reason; the code reads it from there.
 */
export interface IcpConfig {
  version: number;
  qualifyAt: number;
  maybeAt: number;
  minChars: number;
  minPages: number;
  /** The agent loop runs, and "needs more" applies, while fewer than this many of the six key facts are known. */
  minKnownKeyFacts: number;
  points: {
    customerData: { stated: number; implied: number };
    enterprise: { plan: number; logos: number; security: number };
    size: Record<Band, number>;
    status: { in_progress: number; none_visible: number; soc2_type1: number; iso_only: number; soc2_type2: number; soc2_iso: number };
    gap: { eu: number; health: number; payments: number; cap: number };
    hiring: { security_role: number; it_head: number };
    timing: { recent: number; friction: number; market: number };
    competitorPenalty: number;
  };
}

export const ICP_V1: IcpConfig = {
  version: 1,
  qualifyAt: 65,
  maybeAt: 45,
  minChars: 600,
  minPages: 2,
  minKnownKeyFacts: 5,
  points: {
    customerData: { stated: 15, implied: 8 },
    enterprise: { plan: 5, logos: 5, security: 5 },
    size: { "1-10": 4, "11-50": 8, "51-200": 10, "201-500": 6, "501-1000": 2, "1000+": 0 },
    status: { in_progress: 25, none_visible: 20, soc2_type1: 15, iso_only: 15, soc2_type2: 5, soc2_iso: 0 },
    gap: { eu: 3, health: 3, payments: 2, cap: 8 },
    hiring: { security_role: 7, it_head: 3 },
    timing: { recent: 8, friction: 7, market: 5 },
    competitorPenalty: 15,
  },
};
