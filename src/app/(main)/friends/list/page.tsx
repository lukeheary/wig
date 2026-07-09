import { redirect } from "next/navigation";

export default function FriendsListPage() {
  redirect("/activity?view=list");
}
