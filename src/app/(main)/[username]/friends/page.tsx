import { notFound } from "next/navigation";
import { ProfileFriendsPage } from "@/components/profile/profile-friends-page";
import { isReservedUsername } from "@/lib/reserved-usernames";

type UsernameFriendsPageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function UsernameFriendsPage({
  params,
}: UsernameFriendsPageProps) {
  const { username } = await params;

  if (isReservedUsername(username)) {
    notFound();
  }

  return <ProfileFriendsPage username={username} />;
}
