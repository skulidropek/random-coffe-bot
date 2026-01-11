import { RngSeed } from "./brand.js"

const modulus = 2_147_483_647
const multiplier = 48_271

// CHANGE: advance the deterministic RNG seed
// WHY: keep randomness pure and reproducible for tests and scheduling
// QUOTE(TZ): "желательно постоянно выбирать новую пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall s: 0 < next(s) < modulus
// PURITY: CORE
// INVARIANT: seed is always within (0, modulus)
// COMPLEXITY: O(1)/O(1)
export const nextSeed = (seed: RngSeed): RngSeed => {
  const normalized = seed % modulus
  const positive = normalized > 0 ? normalized : normalized + modulus
  return RngSeed((positive * multiplier) % modulus)
}

// CHANGE: sample a random integer below an upper bound
// WHY: enable unbiased selection among equally scored candidates
// QUOTE(TZ): "желательно постоянно выбирать новую пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall n>0: value in [0, n)
// PURITY: CORE
// INVARIANT: returned seed is advanced exactly once
// COMPLEXITY: O(1)/O(1)
export const randomInt = (
  seed: RngSeed,
  upperExclusive: number
): { readonly value: number; readonly seed: RngSeed } => {
  const next = nextSeed(seed)
  const value = upperExclusive <= 0 ? 0 : next % upperExclusive
  return { value, seed: next }
}

// CHANGE: deterministically shuffle a list
// WHY: avoid positional bias when pairing participants
// QUOTE(TZ): "желательно постоянно выбирать новую пару"
// REF: user-2026-01-09-random-coffee
// SOURCE: n/a
// FORMAT THEOREM: forall xs: permute(xs) is a permutation of xs
// PURITY: CORE
// INVARIANT: array length is preserved
// COMPLEXITY: O(n)/O(n)
export const shuffle = <T>(
  items: ReadonlyArray<T>,
  seed: RngSeed
): { readonly items: ReadonlyArray<T>; readonly seed: RngSeed } => {
  const copy = [...items]
  let next = seed
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const result = randomInt(next, i + 1)
    next = result.seed
    const j = result.value
    const current = copy[i]
    const swap = copy[j]
    if (current !== undefined && swap !== undefined) {
      copy[i] = swap
      copy[j] = current
    }
  }
  return { items: copy, seed: next }
}
