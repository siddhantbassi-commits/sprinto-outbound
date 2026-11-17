import { AGENT_PROMPT_VERSION } from "@/lib/agent/loop";
import { EXTRACT_PROMPT_VERSION } from "@/lib/extract/extract";
import { PAINS_PROMPT_VERSION } from "@/lib/pitch/choose-pains";
import { DRAFT_PROMPT_VERSION } from "@/lib/pitch/draft";

/** The prompt versions a run is started under, recorded on the run so any past result can be traced to the prompts that made it. */
export const PROMPT_VERSIONS = { extract: EXTRACT_PROMPT_VERSION, agent: AGENT_PROMPT_VERSION, pains: PAINS_PROMPT_VERSION, draft: DRAFT_PROMPT_VERSION };
