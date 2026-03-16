import { redirect } from "next/navigation";

export default function FriendsRequestsPage() {
  redirect("/friends?view=requests");
}
