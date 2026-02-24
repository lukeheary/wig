import { redirect } from "next/navigation";

type SearchParams = {
  type?: string | string[];
  create?: string | string[];
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminPlacesRedirectPage({
  searchParams,
}: {
  searchParams: SearchParams | Promise<SearchParams>;
}) {
  const params = await searchParams;
  const typeParam = firstValue(params.type);
  const createParam = firstValue(params.create);

  const isOrganizerTarget =
    typeParam === "organizer" || createParam === "organizer";
  const target = isOrganizerTarget ? "/admin/organizers" : "/admin/venues";

  const shouldOpenCreate =
    createParam === "organizer" ||
    createParam === "venue" ||
    createParam === "1" ||
    createParam === "true";

  redirect(shouldOpenCreate ? `${target}?create=1` : target);
}
