import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db } from "./db";
import { profileUsers, type ProfileUserRow } from "@shared/schema";

const SALT_ROUNDS = 10;

export type ProfileUser = {
  loginId:   number;
  name:      string;
  email:     string;
  phone:     string;
  createdAt: string;
};

function toProfileUser(row: ProfileUserRow): ProfileUser {
  return {
    loginId:   row.loginId,
    name:      row.name,
    email:     row.email,
    phone:     row.phone,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function getUserById(id: number): Promise<ProfileUser | undefined> {
  const rows = await db.select().from(profileUsers).where(eq(profileUsers.loginId, id)).limit(1);
  return rows[0] ? toProfileUser(rows[0]) : undefined;
}

export async function getUserByEmail(email: string): Promise<ProfileUserRow | undefined> {
  const rows = await db.select().from(profileUsers)
    .where(eq(profileUsers.email, email.trim().toLowerCase())).limit(1);
  return rows[0];
}

export async function createUser(data: {
  name: string; email: string; phone: string; password: string;
}): Promise<ProfileUser> {
  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  const rows = await db.insert(profileUsers).values({
    name:     data.name.trim(),
    email:    data.email.trim().toLowerCase(),
    phone:    data.phone.trim(),
    password: hashed,
  }).returning();
  return toProfileUser(rows[0]);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export async function updateUser(
  id: number,
  data: Partial<{ name: string; email: string; phone: string; password: string }>
): Promise<ProfileUser | null> {
  const updates: Record<string, string> = {};
  if (data.name)     updates.name     = data.name.trim();
  if (data.email)    updates.email    = data.email.trim().toLowerCase();
  if (data.phone)    updates.phone    = data.phone.trim();
  if (data.password) updates.password = await bcrypt.hash(data.password, SALT_ROUNDS);

  if (Object.keys(updates).length === 0) return null;

  const rows = await db.update(profileUsers).set(updates)
    .where(eq(profileUsers.loginId, id)).returning();
  return rows[0] ? toProfileUser(rows[0]) : null;
}
