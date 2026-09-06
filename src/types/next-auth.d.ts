import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role?: string;
      /** Производство зав. складом: rose_farm | esentai. У остальных null. */
      farm?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    farm?: string | null;
  }
}
