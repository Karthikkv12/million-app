import { redirect } from "next/navigation";

/** Markets was folded into the Dashboard (Sectors + Market pulse); keep old links working. */
export default function MarketsRedirect() {
  redirect("/dashboard#sectors");
}
