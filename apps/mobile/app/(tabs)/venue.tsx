import { useMemo, useState } from "react";
import { View } from "react-native";
import { Screen } from "../../components/screen";
import { PlaceCard } from "../../components/place-card";
import { Card, FieldLabel, Heading, Input, Pill } from "../../components/ui";
import { trpc } from "../../lib/trpc";
import type { AvailableCity, PlaceListItem } from "../../types/api";

type PlaceFilter = "all" | "venue" | "organizer";

export default function VenueScreen() {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [filter, setFilter] = useState<PlaceFilter>("all");
  const citiesQuery = trpc.event.getAvailableCities.useQuery();

  const selectedCity = useMemo(() => city.trim() || undefined, [city]);

  const placesQuery = trpc.place.listPlaces.useQuery({
    type: filter === "all" ? undefined : filter,
    search: search.trim() || undefined,
    city: selectedCity,
    limit: 40,
  });

  return (
    <Screen>
      <Heading subtitle="A native version of the mobile web venues and organizers browser, backed by the same public place route.">
        Venue
      </Heading>

      <Card>
        <View>
          <FieldLabel>Search places</FieldLabel>
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Venue or organizer name"
          />
        </View>

        <View>
          <FieldLabel>City</FieldLabel>
          <Input value={city} onChangeText={setCity} placeholder="e.g. Brooklyn" />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Pill active={filter === "all"} onPress={() => setFilter("all")}>
            All
          </Pill>
          <Pill active={filter === "venue"} onPress={() => setFilter("venue")}>
            Venues
          </Pill>
          <Pill
            active={filter === "organizer"}
            onPress={() => setFilter("organizer")}
          >
            Organizers
          </Pill>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {citiesQuery.data?.slice(0, 8).map((availableCity: AvailableCity) => (
            <Pill
              key={`${availableCity.city}-${availableCity.state}`}
              active={city === availableCity.city}
              onPress={() => setCity(availableCity.city)}
            >
              {availableCity.city}
            </Pill>
          ))}
        </View>
      </Card>

      {placesQuery.data?.map((place: PlaceListItem) => (
        <PlaceCard key={place.id} place={place} />
      ))}

      {!placesQuery.isLoading && !placesQuery.data?.length ? (
        <Card>
          <Heading subtitle="Try another city or switch the place type filter.">
            No places found
          </Heading>
        </Card>
      ) : null}
    </Screen>
  );
}
