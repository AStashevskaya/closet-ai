// Two pieces as one key, whichever comes first: a pair she cut apart, or one to avoid.
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
