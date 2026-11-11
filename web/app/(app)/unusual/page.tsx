import { redirect } from "next/navigation";

/** Unusual activity moved into Research (was Catalyst; owner, 2026-11-08). */
export default function UnusualRedirect() {
  redirect("/catalyst/unusual");
}
