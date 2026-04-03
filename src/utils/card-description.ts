/**
 * card-description.ts — Resolves card description template variables.
 *
 * Card descriptions in cards.json use placeholders like {damage}, {block},
 * {amount}, {hits}. This utility replaces them with actual values from
 * the card's effect definitions.
 *
 * Template variables:
 *   {damage} → value from first deal_damage effect
 *   {block}  → value from first gain_block effect
 *   {amount} → value from first apply_status or draw_cards effect
 *   {hits}   → hits field from any effect that defines it
 *
 * When the card is upgraded, uses upgradedValue if present.
 */

import type { CardEffect } from '../types/card';

/**
 * Resolve template variables in a card description string.
 *
 * @param description - Raw description with {damage}, {block}, etc. placeholders.
 * @param effects - The card's effect list (used to find values).
 * @param upgraded - Whether the card is upgraded (affects value selection).
 * @returns Description with all resolved template variables.
 */
export function resolveCardDescription(
  description: string,
  effects: CardEffect[],
  upgraded: boolean,
): string {
  let resolved = description;

  // {damage} → from deal_damage effects
  const dmgEffect = effects.find(e => e.type === 'deal_damage');
  if (dmgEffect && resolved.includes('{damage}')) {
    const val = (upgraded && dmgEffect.upgradedValue != null)
      ? dmgEffect.upgradedValue
      : dmgEffect.value;
    if (val != null) {
      resolved = resolved.replace(/\{damage\}/g, String(val));
    }
  }

  // {block} → from gain_block effects
  const blockEffect = effects.find(e => e.type === 'gain_block');
  if (blockEffect && resolved.includes('{block}')) {
    const val = (upgraded && blockEffect.upgradedValue != null)
      ? blockEffect.upgradedValue
      : blockEffect.value;
    if (val != null) {
      resolved = resolved.replace(/\{block\}/g, String(val));
    }
  }

  // {amount} → from apply_status or draw_cards effects
  const amountEffect = effects.find(e => e.type === 'apply_status' || e.type === 'draw_cards');
  if (amountEffect && resolved.includes('{amount}')) {
    const val = (upgraded && amountEffect.upgradedValue != null)
      ? amountEffect.upgradedValue
      : amountEffect.value;
    if (val != null) {
      resolved = resolved.replace(/\{amount\}/g, String(val));
    }
  }

  // {hits} → from any effect with hits field
  const hitsEffect = effects.find(e => e.hits != null);
  if (hitsEffect && resolved.includes('{hits}') && hitsEffect.hits != null) {
    resolved = resolved.replace(/\{hits\}/g, String(hitsEffect.hits));
  }

  return resolved;
}
