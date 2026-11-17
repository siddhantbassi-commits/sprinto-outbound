/**
 * Is what is running now the same as what the golden set last checked? The golden set only exercises the extraction
 * prompt, so only extraction prompt versions are compared; the drafting and pain prompts have their own lint and checks.
 * The models are compared whole, because a model that has not been through the golden set is untested for reading.
 */
export function uncovered(inUse: { models: string[]; promptVersions: string[] }, lastLive: { models: string[]; prompt_version: string } | undefined): string[] {
  if (!lastLive) return [];
  return [...inUse.models.filter((m) => !lastLive.models.includes(m)), ...inUse.promptVersions.filter((v) => v.startsWith("extract") && v !== lastLive.prompt_version)];
}
