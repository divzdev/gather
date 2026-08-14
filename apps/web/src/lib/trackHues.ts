/** Track colours, by `hue_index`, resolved through the tokens so the palette
 *  has one home. Categorical only — these appear on track chips and agenda
 *  blocks, never as status or chrome (spec 0002). Four screens carried private
 *  copies of this array; they all import this one now.
 */
export const TRACK_HUES = [
  "var(--track-agents,#3E8896)",
  "var(--track-evals,#A85788)",
  "var(--track-infrastructure,#56789E)",
  "var(--track-retrieval,#8A5CA8)",
  "var(--track-multimodal,#C4703A)",
  "var(--track-production,#34526B)",
] as const;

/** `hue_index` is 1-based (models/program.py defaults it to 1; the seed
 *  assigns index + 1). Every screen goes through this so no caller invents
 *  its own indexing convention again — the agenda read it 0-based for a
 *  while, which shifted every track's colour off the other screens. */
export function trackHue(hueIndex: number | string | null | undefined): string {
  const index = Math.max(1, Number(hueIndex) || 1);
  return TRACK_HUES[(index - 1) % TRACK_HUES.length] ?? TRACK_HUES[0];
}
