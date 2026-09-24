/**
 * Approximate coordinates for placing schools on the world map.
 * A principal's city is looked up here; if it isn't listed, the country's center is used.
 * Good enough for a map at world scale — no external geocoding service, no cost.
 */

const CITIES = {
  // Europe
  "london": [51.51, -0.13], "manchester": [53.48, -2.24], "leeds": [53.8, -1.55], "glasgow": [55.86, -4.25], "dublin": [53.35, -6.26],
  "paris": [48.86, 2.35], "marseille": [43.3, 5.37], "lyon": [45.76, 4.84], "nice": [43.7, 7.27], "strasbourg": [48.58, 7.75], "toulouse": [43.6, 1.44],
  "antwerp": [51.22, 4.4], "brussels": [50.85, 4.35], "amsterdam": [52.37, 4.9], "the hague": [52.08, 4.3],
  "berlin": [52.52, 13.4], "munich": [48.14, 11.58], "frankfurt": [50.11, 8.68], "hamburg": [53.55, 9.99], "düsseldorf": [51.23, 6.78], "dusseldorf": [51.23, 6.78],
  "vienna": [48.21, 16.37], "zurich": [47.38, 8.54], "geneva": [46.2, 6.14], "basel": [47.56, 7.59],
  "rome": [41.9, 12.5], "milan": [45.46, 9.19], "madrid": [40.42, -3.7], "barcelona": [41.39, 2.17], "lisbon": [38.72, -9.14],
  "budapest": [47.5, 19.04], "prague": [50.08, 14.44], "warsaw": [52.23, 21.01], "krakow": [50.06, 19.94], "bratislava": [48.15, 17.11],
  "bucharest": [44.43, 26.1], "sofia": [42.7, 23.32], "athens": [37.98, 23.73], "thessaloniki": [40.64, 22.94], "istanbul": [41.01, 28.98],
  "stockholm": [59.33, 18.07], "copenhagen": [55.68, 12.57], "oslo": [59.91, 10.75], "helsinki": [60.17, 24.94],
  "riga": [56.95, 24.11], "vilnius": [54.69, 25.28], "tallinn": [59.44, 24.75], "minsk": [53.9, 27.56],
  "kyiv": [50.45, 30.52], "kiev": [50.45, 30.52], "dnipro": [48.46, 35.05], "odesa": [46.48, 30.72], "odessa": [46.48, 30.72], "kharkiv": [49.99, 36.23], "chisinau": [47.01, 28.86],
  "moscow": [55.76, 37.62], "st petersburg": [59.93, 30.34], "saint petersburg": [59.93, 30.34],
  "tbilisi": [41.72, 44.79], "baku": [40.41, 49.87], "almaty": [43.24, 76.89], "tashkent": [41.3, 69.24],
  // Israel
  "jerusalem": [31.77, 35.21], "tel aviv": [32.09, 34.78], "haifa": [32.79, 34.99], "be'er sheva": [31.25, 34.79], "beersheba": [31.25, 34.79],
  // North America
  "new york": [40.71, -74.01], "brooklyn": [40.68, -73.94], "boston": [42.36, -71.06], "chicago": [41.88, -87.63], "los angeles": [34.05, -118.24],
  "miami": [25.76, -80.19], "philadelphia": [39.95, -75.17], "baltimore": [39.29, -76.61], "washington": [38.91, -77.04], "cleveland": [41.5, -81.69],
  "atlanta": [33.75, -84.39], "dallas": [32.78, -96.8], "houston": [29.76, -95.37], "denver": [39.74, -104.99], "san francisco": [37.77, -122.42],
  "seattle": [47.61, -122.33], "detroit": [42.33, -83.05], "st. louis": [38.63, -90.2], "phoenix": [33.45, -112.07], "las vegas": [36.17, -115.14],
  "toronto": [43.65, -79.38], "montreal": [45.5, -73.57], "vancouver": [49.28, -123.12], "winnipeg": [49.9, -97.14], "ottawa": [45.42, -75.7],
  "mexico city": [19.43, -99.13], "panama city": [8.98, -79.52],
  // South America
  "buenos aires": [-34.6, -58.38], "montevideo": [-34.9, -56.16], "são paulo": [-23.55, -46.63], "sao paulo": [-23.55, -46.63], "rio de janeiro": [-22.91, -43.17],
  "porto alegre": [-30.03, -51.23], "santiago": [-33.45, -70.67], "lima": [-12.05, -77.04], "bogotá": [4.71, -74.07], "bogota": [4.71, -74.07], "caracas": [10.48, -66.9],
  // Africa
  "johannesburg": [-26.2, 28.05], "cape town": [-33.92, 18.42], "durban": [-29.86, 31.02], "casablanca": [33.57, -7.59],
  // Asia-Pacific
  "melbourne": [-37.81, 144.96], "sydney": [-33.87, 151.21], "perth": [-31.95, 115.86], "brisbane": [-27.47, 153.03], "auckland": [-36.85, 174.76],
  "singapore": [1.35, 103.82], "hong kong": [22.32, 114.17], "shanghai": [31.23, 121.47], "tokyo": [35.68, 139.69], "mumbai": [19.08, 72.88],
};

const COUNTRIES = {
  "united kingdom": [54, -2.5], "uk": [54, -2.5], "england": [52.5, -1.5], "scotland": [56.5, -4], "ireland": [53.3, -7.8],
  "france": [46.6, 2.4], "belgium": [50.6, 4.6], "netherlands": [52.2, 5.3], "germany": [51.1, 10.4], "austria": [47.6, 14.1], "switzerland": [46.8, 8.2],
  "italy": [42.8, 12.6], "spain": [40.2, -3.6], "portugal": [39.6, -8], "hungary": [47.2, 19.4], "czech republic": [49.8, 15.5], "czechia": [49.8, 15.5],
  "poland": [52, 19.4], "slovakia": [48.7, 19.7], "romania": [45.9, 24.9], "bulgaria": [42.7, 25.5], "greece": [39.1, 22.9], "turkey": [39, 35.2],
  "sweden": [62, 15], "denmark": [56, 10], "norway": [61, 9], "finland": [64, 26], "latvia": [56.9, 24.6], "lithuania": [55.2, 23.9], "estonia": [58.6, 25],
  "belarus": [53.7, 28], "ukraine": [49, 31.3], "moldova": [47.2, 28.5], "russia": [56, 38], "georgia": [42.3, 43.4], "azerbaijan": [40.1, 47.6],
  "kazakhstan": [48, 67], "uzbekistan": [41.4, 64.6], "israel": [31.5, 34.9],
  "united states": [39.8, -98.6], "usa": [39.8, -98.6], "us": [39.8, -98.6], "canada": [56, -96], "mexico": [23.6, -102.5], "panama": [8.5, -80.8],
  "argentina": [-38.4, -63.6], "uruguay": [-32.5, -55.8], "brazil": [-14.2, -51.9], "chile": [-35.7, -71.5], "peru": [-9.2, -75], "colombia": [4.6, -74.3], "venezuela": [6.4, -66.6],
  "south africa": [-30.6, 22.9], "morocco": [31.8, -7.1], "australia": [-25.3, 133.8], "new zealand": [-40.9, 174.9],
  "singapore": [1.35, 103.82], "hong kong": [22.32, 114.17], "china": [35.9, 104.2], "japan": [36.2, 138.3], "india": [20.6, 79],
};

const key = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Returns [lat, lng] for a city/country, or null when neither is known. */
export function locate(city, country) {
  return CITIES[key(city)] || COUNTRIES[key(country)] || null;
}
