// The policy the consent at sign-up refers to. Change the version when docs/legal/privacy-policy.md
// changes in substance; it's stored with each new account (YYYY-MM-DD, the server checks the form).
export const PRIVACY_POLICY_VERSION = '2026-11-05';

// Where the published policy is, from EXPO_PUBLIC_PRIVACY_URL; without it there's nothing to link to.
export const privacyUrl = () => process.env.EXPO_PUBLIC_PRIVACY_URL || null;
