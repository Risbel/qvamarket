// Timezones for the store setting (Settings > General). Built on the server and passed to the
// client picker, so both render the same labels.

/** A zone as the picker shows it: "America/Havana" + its current offset ("GMT-4"). */
export type TimeZoneOption = { value: string; label: string; offset: string };

/** The zone's offset right now, e.g. "GMT-4" ("GMT" for UTC). */
function currentOffset(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" }).formatToParts(now);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** Every zone the runtime knows, alphabetical ("America/New_York" shown as "America/New York"). */
export function timeZoneOptions(now: Date = new Date()): TimeZoneOption[] {
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes("UTC")) zones.push("UTC");
  return zones.map((value) => ({ value, label: value.replaceAll("_", " "), offset: currentOffset(value, now) }));
}
