type MetroAreaRow = {
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
};

type CityRow = {
  name: string;
  state: string;
  latitude: number;
  longitude: number;
};

type LocationRow = {
  city: string | null;
  state: string | null;
};

export type MobileMetroArea = {
  city: string;
  state: string;
};

const locationKey = (city: string, state: string) =>
  `${city.trim().toLowerCase()}|${state.trim().toUpperCase()}`;

function distanceMiles(
  lhs: { latitude: number; longitude: number },
  rhs: { latitude: number; longitude: number }
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(rhs.latitude - lhs.latitude);
  const longitudeDelta = toRadians(rhs.longitude - lhs.longitude);
  const lhsLatitude = toRadians(lhs.latitude);
  const rhsLatitude = toRadians(rhs.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(lhsLatitude) *
      Math.cos(rhsLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 3959 * 2 * Math.asin(Math.sqrt(a));
}

export function mobileMetroAreas(metroAreas: MetroAreaRow[]): MobileMetroArea[] {
  return metroAreas.map((metro) => ({
    city: metro.name,
    state: metro.state,
  }));
}

export function createMobileMetroResolver(
  metroAreas: MetroAreaRow[],
  cities: CityRow[]
) {
  const cityByKey = new Map(
    cities.map((city) => [locationKey(city.name, city.state), city])
  );

  return (location: LocationRow): MobileMetroArea | null => {
    if (!location.city || !location.state) {
      return null;
    }

    const direct = metroAreas.find(
      (metro) =>
        metro.name.toLowerCase() === location.city!.toLowerCase() &&
        metro.state === location.state
    );

    if (direct) {
      return { city: direct.name, state: direct.state };
    }

    const city = cityByKey.get(locationKey(location.city, location.state));

    if (city) {
      const nearestMetro = metroAreas
        .filter((metro) => metro.state === location.state)
        .map((metro) => ({
          metro,
          distance: distanceMiles(city, metro),
        }))
        .filter(({ metro, distance }) => distance <= metro.radiusMiles)
        .sort((lhs, rhs) => lhs.distance - rhs.distance)[0]?.metro;

      if (nearestMetro) {
        return { city: nearestMetro.name, state: nearestMetro.state };
      }
    }

    const stateFallback = metroAreas.find((metro) => metro.state === location.state);

    return stateFallback
      ? { city: stateFallback.name, state: stateFallback.state }
      : null;
  };
}
