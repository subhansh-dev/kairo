/**
 * Token-free detection of user reactions to the agent.
 *
 * Currently detects "vibe" — affection or gratitude (ily, <3, love you, good bot, ❤️).
 * No model call, no tokens. Pure regex.
 */

export type ReactionKind = 'vibe';

// Curated affection lexicon. Narrow: gratitude + love aimed at agent, heart emoji, <3.
const VIBE_RE = new RegExp(
  [
    /\bgood\s*bot\b/i.source,
    /\bi\s*(?:love|luv)\s*(?:you|u|ya)\b/i.source,
    /\b(?:love|luv)\s*(?:you|u|ya)\b/i.source,
    /\bily(?:sm)?\b/i.source,
    /\bthank\s*(?:you|u)\b/i.source,
    /\b(?:thanks|thx|tysm|ty)\b/i.source,
    /<3+/.source, // <3, <33 … but not </3
    // Hearts + affection faces
    /[\u2764\u2665\u2764\uFE0F]/.source,
    /\p{Emoji_Presentation}/u.source, // broad emoji match
  ].join('|'),
  'i',
);

// More precise heart/affection emoji pattern
const HEART_EMOJI_RE = /[\u2764\u2665❤️♥️🥰😍😘💕💖💗💞💛💜💚💙💓💘💝🩷]/u;

/**
 * Detect if user text contains a reaction.
 * Returns the reaction kind ('vibe') or null.
 */
export function detectReaction(text: string | undefined | null): ReactionKind | null {
  if (!text) return null;

  // Check for affection/gratitude patterns
  if (VIBE_RE.test(text)) return 'vibe';
  if (HEART_EMOJI_RE.test(text)) return 'vibe';

  return null;
}
