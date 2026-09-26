import type { RepairCategory, VehicleMake } from "@/lib/domain/types";

export const MODELS: Record<VehicleMake, string[]> = {
  BMW: ["328i", "330i", "X3 xDrive30i", "535i", "X5 xDrive35i", "428i"],
  Honda: ["Accord", "Civic", "CR-V", "Odyssey", "Pilot", "Fit"],
  Toyota: ["Camry", "Corolla", "RAV4", "Prius", "Tacoma", "Highlander"],
  Ford: ["F-150", "Escape", "Focus", "Explorer", "Fusion", "Ranger"],
  "Mercedes-Benz": ["C300", "E350", "GLC 300", "ML350", "CLA 250"],
  Lexus: ["RX 350", "ES 350", "CT 200h", "NX 300h", "IS 250"],
  Acura: ["TLX", "MDX", "RDX", "TSX", "ILX"],
  Nissan: ["Altima", "Sentra", "Rogue", "Frontier"],
  Chevrolet: ["Silverado 1500", "Malibu", "Tahoe", "Equinox", "Colorado"],
  Subaru: ["Outback", "Forester", "Impreza", "Crosstrek"],
  Audi: ["A4", "Q5", "A6", "Q7"],
  Volkswagen: ["Jetta", "GTI", "Passat", "Tiguan"],
  Hyundai: ["Elantra", "Sonata", "Tucson", "Santa Fe"],
  Kia: ["Optima", "Sorento", "Soul", "Sportage"],
  Mazda: ["Mazda3", "CX-5", "Mazda6", "CX-9"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Gladiator"],
  Tesla: ["Model 3", "Model Y"],
};

export const TITLES: Record<RepairCategory, string[]> = {
  brakes: [
    "Front brake pads + rotors",
    "Rear brake pads + rotors",
    "Front caliper replacement",
    "Brake fluid flush + rear pads",
    "Front pads, rotors + wear sensor",
    "Rear pads + parking brake adjustment",
  ],
  suspension: [
    "Front struts + mounts",
    "Lower control arms + alignment check",
    "Rear shocks replacement",
    "Front sway bar end links",
    "Tie rod ends replacement",
  ],
  cooling: [
    "Water pump + thermostat",
    "Radiator replacement",
    "Coolant leak diagnosis + hose replacement",
    "Expansion tank + coolant flush",
    "Thermostat housing replacement",
  ],
  starters: ["Starter motor replacement", "Starter + battery cable repair", "No-crank diagnosis + starter"],
  alternators: [
    "Alternator replacement",
    "Charging system diagnosis + alternator",
    "Serpentine belt + tensioner",
  ],
  diagnostics: [
    "Check engine light diagnosis",
    "Intermittent no-start diagnosis",
    "Misfire diagnosis",
    "Pre-purchase inspection",
    "Warning light + scan diagnosis",
  ],
  electrical: [
    "Parasitic drain diagnosis",
    "Window regulator + motor",
    "Headlight wiring repair",
    "Blower motor resistor",
    "Battery + ground strap replacement",
  ],
  engine: [
    "Valve cover gasket replacement",
    "Timing chain guides",
    "Oil filter housing gasket",
    "Ignition coils + spark plugs",
    "Intake manifold gasket",
  ],
  ac: [
    "A/C recharge + leak test",
    "A/C compressor replacement",
    "Condenser replacement",
    "Evaporator temperature sensor",
    "Cabin blower + A/C diagnosis",
  ],
  maintenance: ["Major service (60k)", "Fluid service + inspection", "Oil service + multipoint inspection"],
};

export const CUSTOMER_NAMES = [
  "Maya C.", "Jordan P.", "Elena R.", "Chris T.", "Amara O.", "Ben L.", "Sofia M.", "Kevin N.",
  "Hannah W.", "Diego F.", "Tasha B.", "Ryan K.", "Leila S.", "Omar H.", "Grace Y.", "Nate D.",
  "Isabel V.", "Marcus J.", "Priyanka G.", "Tom E.", "Carmen A.", "Will Z.", "Janelle Q.", "Andre U.",
  "Mei L.", "Paul R.", "Rachel I.", "Victor M.", "Noor A.", "Sam B.", "Lucia P.", "Eli C.",
  "Dana F.", "Kofi A.", "Rosa T.", "Jin P.", "Alicia N.", "Gabe H.", "Fatima S.", "Luke W.",
  "Yesenia R.", "Tyler O.", "Imani C.", "Hugo L.", "Beth K.", "Arjun D.", "Kara V.", "Miles G.",
];

/** Comment pool for verified reviews. `{v}` = vehicle model, `{r}` = repair noun. */
export const COMMENTS = [
  "Showed up on time, explained exactly what was wrong with the {v} before touching anything, and the final price matched the estimate to the dollar.",
  "Sent photos of the worn parts during the job. First mechanic I've used who didn't try to upsell me.",
  "Did the job in my driveway in under two hours. Clean, careful, and walked me through every part that was replaced.",
  "Knew this car. Diagnosed it in ten minutes after a shop had guessed wrong twice.",
  "Quoted a fair price up front and stuck to it. Already booked the next service.",
  "Very clear communication by text the whole way. Car drives like new.",
  "Honest about what could wait and what couldn't. That's why I keep coming back.",
  "Brought the right parts the first time — clearly has done this exact job on this model before.",
  "Tidy work, no mess, old parts left in a box so I could see them.",
  "Took the time to show me the problem on the {v}. Would absolutely hire again.",
  "Came back the next day to double-check the fix at no charge.",
  "Professional from the first message to the invoice. The estimate was itemized and accurate.",
  "Found the real issue instead of throwing parts at it. Saved me a lot of money.",
  "Reliable, punctual, and knows the work. Price was exactly what was quoted.",
];
