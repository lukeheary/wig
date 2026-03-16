import { redirect } from "next/navigation";

export default function FriendsListPage() {
  redirect("/friends?view=list");
}
