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
