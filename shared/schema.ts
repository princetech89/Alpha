import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

// ── Profile users table ────────────────────────────────────────────────────────
export const profileUsers = pgTable("profile_users", {
  loginId:   serial("login_id").primaryKey(),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  phone:     text("phone").notNull(),
  password:  text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProfileUserRow = typeof profileUsers.$inferSelect;
