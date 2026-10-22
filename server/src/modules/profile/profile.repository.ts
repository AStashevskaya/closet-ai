import type { UpdateProfileInput, UserProfile } from "@closet-ai/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { profiles } from "../../db/schema";

export interface ProfileRepository {
  // Every field null until the user fills it in.
  get(userId: string): Promise<UserProfile>;
  // Changes only the fields given and returns the whole profile.
  update(userId: string, patch: UpdateProfileInput): Promise<UserProfile>;
}

export const EMPTY_PROFILE: UserProfile = {
  country: null,
  city: null,
  birthYear: null,
  heightCm: null,
  bodyShape: null,
  sizeTop: null,
  sizeBottom: null,
  sizeShoes: null,
};

export function createProfileRepository(db: Db): ProfileRepository {
  async function get(userId: string): Promise<UserProfile> {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!row) return EMPTY_PROFILE;
    const { userId: _userId, updatedAt: _updatedAt, ...profile } = row;
    return profile;
  }

  return {
    get,
    async update(userId, patch) {
      // The first save creates the row; later ones change only what they send.
      await db
        .insert(profiles)
        .values({ userId, ...patch })
        .onConflictDoUpdate({ target: profiles.userId, set: { ...patch, updatedAt: new Date() } });
      return get(userId);
    },
  };
}
