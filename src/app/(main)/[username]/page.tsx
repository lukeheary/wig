import { notFound } from "next/navigation";
import { UserProfilePage } from "@/components/profile/user-profile-page";
import { isReservedUsername } from "@/lib/reserved-usernames";

type UsernamePageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function UsernamePage({ params }: UsernamePageProps) {
  const { username } = await params;

  if (isReservedUsername(username)) {
    notFound();
  }

  return <UserProfilePage username={username} />;
}
