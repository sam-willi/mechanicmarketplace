# Vehicle details

What Clutch knows about a car, how sure it is, and where it came from.

## Picking the car
Year first, then make, then only the models that existed for that make and year (NHTSA vPIC
`GetModelsForMakeYear`), then the configuration the curated catalog (`lib/vehicles/catalog.ts`)
says existed: body, trim, engine and transmission, drive. Sign-up, adding or editing a vehicle, and
the repair request all use the same picker (`components/vehicle/vehicle-selector.tsx`). The VIN is
optional and the preferred route: vPIC `DecodeVinValues`, decoded on the server.

## How sure each field is
Every field carries one source, shown next to it:

| Source | Meaning |
| --- | --- |
| VIN-decoded | The VIN decoded and matches the car picked |
| Customer selected | Picked from the options that existed for that car |
| Customer entered | Typed, or from the older form; not matched to factory data |
| Likely (inferred) | The only factory option for what was picked, not confirmed. Shown as "Likely N54 …" with how to confirm |
| Unknown | Several options, or never recorded |
| Mechanic confirmed | Confirmed by the mechanic who worked on the car |

A likely engine is never stored as the flat `engine` field or treated as fact. A VIN that disagrees
with the selections is kept as a recorded conflict; nothing is upgraded or overwritten. Corrections
(a customer's edit, a mechanic's confirmation) are appended to `spec.corrections` with what the
field was, what it became, who and when.

## Where it shows
A vehicle brief (`components/vehicle/vehicle-brief.tsx`) sits at the top of the mechanic's request
(where they quote) and job, and the customer's estimate, booking step and vehicle page. When the
engine, transmission or drive isn't confirmed it warns before quoting or booking; it never blocks.

## NHTSA adapter
`lib/vehicles/provider.ts`: 4-second timeout; model lists cached 7 days and VIN decodes 30 days;
on failure the last good answer is served (even if stale), and a failure is remembered for a
minute so an outage isn't hammered. With nothing cached, model lists fall back to the catalog and
the picker offers "not listed" free text; a VIN that can't be decoded says so and the customer
picks the car instead. Nothing dead-ends.

`CLUTCH_VEHICLE_DATA=fixtures` swaps the network for recorded vPIC responses
(`lib/vehicles/fixtures.ts`, fictional VINs). The test runners set it; production doesn't.

## Older vehicles
Vehicles saved before structured details get an honest spec at read time (`lib/vehicles/effective.ts`):
entered values as "customer entered", catalog implications as "likely", the rest "unknown", marked
as saved before these details existed. `npm run db:backfill-vehicle-specs` stores the same (dry run
by default; `--apply` backs up first). The 2026-09-27 dry run found no vehicle without a spec in
either scope, so nothing needs applying.
