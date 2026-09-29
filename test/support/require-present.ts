/**
 * Test-only narrowing for values a test has just caused to exist.
 *
 * A non-null assertion would silence the compiler without proving anything, so
 * a regression would surface as an opaque `TypeError` instead of a named
 * failure. Throwing here keeps the expectation readable and reports the site.
 */
export const requirePresent = <T>(value: T | undefined, context: string): T => {
  if (value === undefined) {
    throw new Error(`expected ${context} to be present`)
  }

  return value
}

/** The first element of a collection a test has just built and knows is non-empty. */
export const firstOf = <T>(values: ReadonlyArray<T>, context: string): T =>
  requirePresent(values[0], `the first entry of ${context}`)

/** One element of a collection, at a position the test has just computed. */
export const atIndex = <T>(values: ReadonlyArray<T>, index: number, context: string): T =>
  requirePresent(values[index], `entry ${index} of ${context}`)
