import { redirect } from "next/navigation";

// Pilot scope: no landing page. Role-aware routing happens in /login after
// sign-in (Coach -> /coach/calendar, Athlete -> /today).
export default function Home() {
  redirect("/login");
}
