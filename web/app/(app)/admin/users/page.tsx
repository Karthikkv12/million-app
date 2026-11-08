import { redirect } from "next/navigation";

/** Users moved into Settings (owner, 2026-11-08). */
export default function AdminUsersRedirect() {
  redirect("/settings/users");
}
