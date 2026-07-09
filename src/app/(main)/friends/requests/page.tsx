import { redirect } from "next/navigation";

export default function FriendsRequestsPage() {
  redirect("/activity?view=requests");
}
