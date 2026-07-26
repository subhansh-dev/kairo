/**
 * Swap policy — controls how session state is swapped during rewind.
 *
 */

export enum SwapPolicy {
  /** Always swap file state on rewind */
  Always = 'always',
  /** Only swap if there are meaningful changes */
  Lazy = 'lazy',
  /** Never swap file state */
  Never = 'never',
}

export interface SwapPolicyConfig {
  policy: SwapPolicy;
  /** Minimum number of changed files to trigger a swap in lazy mode */
  minChangesForSwap?: number;
}

/**
 * Determine if a file state swap should happen.
 */
export function shouldSwap(
  config: SwapPolicyConfig,
  changedFilesCount: number
): boolean {
  switch (config.policy) {
    case SwapPolicy.Always:
      return true;
    case SwapPolicy.Never:
      return false;
    case SwapPolicy.Lazy:
      return changedFilesCount >= (config.minChangesForSwap ?? 1);
    default:
      return true;
  }
}
