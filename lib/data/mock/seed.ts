/**
 * Demo seed. Every person, shop, review and repair here is fictional.
 * Shop and dealership names carry "(demo)" in the admin view and are invented.
 */
import { configsFor } from "@/lib/vehicles/catalog";
import { buildSpec, type Selection } from "@/lib/vehicles/spec";
import type { RecordedSpec } from "@/lib/vehicles/types";
import type {
  Credential,
  CustomerConfirmation,
  CustomerProfile,
  EmploymentRecord,
  InsuranceRecord,
  MechanicProfile,
  PastRepair,
  Quote,
  RepairCategory,
  RepairMedia,
  RepairRequest,
  Review,
  SavedMechanic,
  ScreeningCheck,
  ScreeningKind,
  User,
  Vehicle,
  VehicleMake,
  VerificationMethod,
  VerificationRecord,
  VerificationStatus,
} from "@/lib/domain/types";
import { COMMENTS, CUSTOMER_NAMES, MODELS, TITLES } from "./catalog";

export interface DB {
  users: User[];
  mechanics: MechanicProfile[];
  customers: CustomerProfile[];
  vehicles: Vehicle[];
  screenings: ScreeningCheck[];
  insurance: InsuranceRecord[];
  credentials: Credential[];
  employment: EmploymentRecord[];
  pastRepairs: PastRepair[];
  confirmations: CustomerConfirmation[];
  verifications: VerificationRecord[];
  requests: RepairRequest[];
  quotes: Quote[];
  jobs: import("@/lib/domain/types").Job[];
  reviews: Review[];
  saved: SavedMechanic[];
  events: import("@/lib/domain/types").AnalyticsEvent[];
  profileShares: Record<string, number>;
  drafts: Record<string, import("@/lib/domain/intake-draft").IntakeDraft>;
  notifications: import("@/lib/domain/types").AppNotification[];
  /** Mechanic's private notes about their own customers: mechanicId → customerId → note. */
  customerNotes: Record<string, Record<string, string>>;
  supportReports: import("@/lib/domain/types").SupportReport[];
}

// Deterministic RNG so the seed is identical on every boot.
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function expand<K extends string>(counts: Partial<Record<K, number>>): K[] {
  return (Object.entries(counts) as [K, number][]).flatMap(([k, n]) => Array(n).fill(k));
}

function monthsBetween(start: string, end: string, n: number, rand: () => number): string[] {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Array.from({ length: n }, () => new Date(s + rand() * (e - s)).toISOString().slice(0, 10)).sort(
    (a, b) => (a < b ? 1 : -1),
  );
}

type SafetySpec = {
  identity?: VerificationStatus;
  background?: VerificationStatus;
  driving?: VerificationStatus;
  insurance?: { status: VerificationStatus; carrier: string; expiresOn: string; verifiedAt?: string };
};

type CredSpec = {
  issuer: string;
  name: string;
  code?: string;
  issuedOn?: string;
  expiresOn?: string;
  status: VerificationStatus;
  method?: VerificationMethod; // how it was / will be verified
  notes?: string;
};

type EmpSpec = {
  employer: string;
  position: string;
  startedOn: string;
  endedOn?: string;
  status: VerificationStatus;
  method?: VerificationMethod;
  notes?: string;
};

type RepairTuple = [RepairCategory, VehicleMake, number, string, string, "platform" | "customer" | "self", string?];

interface MechSpec {
  profile: Omit<MechanicProfile, "id" | "userId" | "isDemo" | "fixedPrices"> & {
    fixedPrices?: { category: RepairCategory; label: string; labor: number }[];
  };
  safety: SafetySpec;
  credentials: CredSpec[];
  employment: EmpSpec[];
  /** Explicit list (used for Derek, so the cross counts are exact). */
  repairs?: RepairTuple[];
  /** Generated distribution. */
  gen?: {
    platform: number;
    customer: number;
    categories: Partial<Record<RepairCategory, number>>;
    makes: Partial<Record<VehicleMake, number>>;
    from: string;
  };
  selfRepairs: RepairTuple[];
  reviews: { n: number; fours: number };
  repeat: number;
  customerConfirmedReviews?: number;
  testimonials?: { author: string; comment: string }[];
}

// ---------------------------------------------------------------------------
// Derek Hall — the primary demo profile. Counts match the brief exactly:
// 34 verified (18 brakes, 6 starters, 5 suspension, 5 diagnostics),
// makes 8 BMW, 9 Honda, 7 Toyota, 5 Ford, 5 other; 6 BMW brake jobs.
// ---------------------------------------------------------------------------
const DEREK_REPAIRS: RepairTuple[] = [
  ["brakes", "Honda", 2016, "Accord", "Front brake pads + rotors", "platform", "2026-09-18"],
  ["brakes", "BMW", 2018, "X3 xDrive30i", "Front pads, rotors + wear sensor", "platform", "2026-09-06"],
  ["diagnostics", "BMW", 2017, "330i", "Intermittent no-start diagnosis", "platform", "2026-08-29"],
  ["brakes", "Toyota", 2019, "RAV4", "Rear brake pads + rotors", "platform", "2026-08-21"],
  ["starters", "Ford", 2013, "F-150", "Starter motor replacement", "platform", "2026-08-12"],
  ["brakes", "BMW", 2014, "328i", "Rear pads + parking brake adjustment", "platform", "2026-08-03"],
  ["suspension", "Lexus", 2012, "RX 350", "Front struts + mounts", "platform", "2026-07-26"],
  ["brakes", "Honda", 2018, "CR-V", "Front brake pads + rotors", "platform", "2026-07-15"],
  ["brakes", "BMW", 2011, "135i Convertible", "Front caliper replacement + brake fluid flush", "platform", "2026-07-02"],
  ["starters", "Honda", 2011, "Odyssey", "No-crank diagnosis + starter", "platform", "2026-06-20"],
  ["diagnostics", "Honda", 2017, "Civic", "Check engine light diagnosis", "platform", "2026-06-11"],
  ["brakes", "Toyota", 2015, "Camry", "Front brake pads + rotors", "platform", "2026-05-30"],
  ["brakes", "Ford", 2018, "Escape", "Brake fluid flush + rear pads", "platform", "2026-05-17"],
  ["suspension", "BMW", 2013, "328i", "Lower control arms + alignment check", "platform", "2026-05-04"],
  ["brakes", "BMW", 2019, "X5 xDrive40i", "Front pads, rotors + wear sensor", "platform", "2026-04-22"],
  ["starters", "Toyota", 2012, "Corolla", "Starter motor replacement", "platform", "2026-04-09"],
  ["brakes", "Honda", 2014, "Accord", "Rear brake pads + rotors", "platform", "2026-03-28"],
  ["diagnostics", "Toyota", 2016, "Prius", "Warning light + scan diagnosis", "platform", "2026-03-14"],
  ["brakes", "Nissan", 2017, "Altima", "Front brake pads + rotors", "platform", "2026-02-27"],
  ["suspension", "Honda", 2015, "Pilot", "Rear shocks replacement", "platform", "2026-02-11"],
  ["brakes", "Toyota", 2020, "Tacoma", "Front caliper replacement", "platform", "2026-01-29"],
  ["starters", "Chevrolet", 2012, "Silverado 1500", "Starter + battery cable repair", "platform", "2026-01-15"],
  ["diagnostics", "Ford", 2014, "Fusion", "Misfire diagnosis", "platform", "2025-12-18"],
  ["brakes", "Honda", 2019, "Civic", "Front brake pads + rotors", "platform", "2025-12-04"],
  ["suspension", "Subaru", 2016, "Outback", "Front sway bar end links", "platform", "2025-11-19"],
  ["brakes", "BMW", 2015, "428i", "Rear brake pads + rotors", "platform", "2025-11-06"],
  ["starters", "Honda", 2010, "Fit", "Starter motor replacement", "platform", "2025-10-23"],
  // Customer-verified prior work (before joining Clutch)
  ["brakes", "Toyota", 2014, "Highlander", "Front brake pads + rotors", "customer", "2025-06-14"],
  ["brakes", "Honda", 2013, "Odyssey", "Brake fluid flush + rear pads", "customer", "2025-04-02"],
  ["starters", "Ford", 2010, "Ranger", "Starter motor replacement", "customer", "2025-02-19"],
  ["diagnostics", "Nissan", 2015, "Rogue", "Pre-purchase inspection", "customer", "2024-11-08"],
  ["brakes", "Ford", 2016, "Explorer", "Front brake pads + rotors", "customer", "2024-09-21"],
  ["suspension", "Toyota", 2011, "Camry", "Tie rod ends replacement", "customer", "2024-07-10"],
  ["brakes", "BMW", 2011, "328i", "Rear brake pads + rotors", "customer", "2024-05-03"],
];

const SPECS: MechSpec[] = [
  {
    profile: {
      slug: "derek-hall",
      openings: [{"on": "2026-09-27", "time": "10:00 AM"}, {"on": "2026-09-29", "time": "8:00 AM"}, {"on": "2026-09-30", "time": "1:00 PM"}],
      tagline: "BMW-trained technician. Brakes, suspension, starters and diagnostics, in your driveway.",
      languages: ["English"],
      trainedAt: "Six years at a BMW dealership service department after community-college auto tech.",
      guarantee: "12-month / 12,000-mile workmanship guarantee on brake and suspension labor I perform.",
      displayName: "Derek Hall",
      firstName: "Derek",
      photoUrl: "/mechanics/derek-hall.webp",
      city: "Los Angeles",
      neighborhood: "Mid-City",
      serviceRadiusMi: 15,
      bio: "I spent six years as a BMW-trained technician at a Westside dealership before going independent. I come to your driveway or office with a fully stocked van, send photos of anything I replace, and I don't start work until you've approved the estimate.",
      workModel: "mobile",
      hourlyRateCents: 8500,
      diagnosticFeeCents: 6000,
      travelFeeCents: 2500,
      fixedPrices: [
        { category: "brakes", label: "Front pads + rotors (labor)", labor: 18500 },
        { category: "brakes", label: "Rear pads + rotors (labor)", labor: 17000 },
        { category: "starters", label: "Starter replacement (labor)", labor: 16000 },
        { category: "diagnostics", label: "Check engine diagnosis", labor: 6000 },
      ],
      availabilityNote: "Weekdays 7am–6pm, Saturdays 8am–2pm",
      nextAvailable: "Sat, Sep 27",
      nextAvailableOn: "2026-09-27",
      declaredRepairCategories: ["brakes", "starters", "suspension", "diagnostics"],
      declaredMakes: ["BMW", "Honda", "Toyota", "Ford"],
      selfReportedClaims: ["Over 100 brake jobs before joining Clutch", "Comfortable with BMW ISTA diagnostics"],
      yearsExperienceClaim: 11,
      joinedAt: "2025-10-01",
      lat: 34.05,
      lng: -118.35,
    },
    safety: {
      identity: "verified",
      background: "verified",
      driving: "verified",
      insurance: { status: "verified", carrier: "Pacific Tradesman Mutual (demo)", expiresOn: "2027-04-30", verifiedAt: "2026-05-02" },
    },
    credentials: [
      { issuer: "ASE", name: "Brakes", code: "A5", issuedOn: "2024-03-12", expiresOn: "2029-03-31", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Suspension & Steering", code: "A4", issuedOn: "2024-03-12", expiresOn: "2029-03-31", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Electrical/Electronic Systems", code: "A6", issuedOn: "2022-06-02", expiresOn: "2027-06-30", status: "verified", method: "document_review" },
      { issuer: "BMW Group", name: "STEP Technician Program", issuedOn: "2019-05-20", status: "verified", method: "document_review" },
    ],
    employment: [
      { employer: "Wilshire Motorwerks BMW (demo)", position: "BMW Service Technician", startedOn: "2019-06-01", endedOn: "2025-08-31", status: "verified", method: "employer_check" },
      { employer: "Valley Auto Care (demo)", position: "Lube Tech → Technician", startedOn: "2015-02-01", endedOn: "2019-05-01", status: "not_submitted" },
    ],
    repairs: DEREK_REPAIRS,
    selfRepairs: [
      ["engine", "BMW", 2008, "535i", "Timing chain guides", "self", "2023-10-10"],
      ["cooling", "BMW", 2012, "328i", "Water pump + thermostat", "self", "2023-06-18"],
      ["brakes", "Mercedes-Benz", 2014, "C300", "Front brake pads + rotors", "self", "2023-03-05"],
    ],
    reviews: { n: 24, fours: 2 },
    repeat: 12,
    customerConfirmedReviews: 3,
    testimonials: [
      { author: "Former service advisor", comment: "Derek was the tech we gave the hard BMW jobs to. Meticulous and never came back." },
    ],
  },
  {
    profile: {
      slug: "rosa-delgado",
      openings: [{"on": "2026-09-30", "time": "8:30 AM"}, {"on": "2026-10-01", "time": "1:00 PM"}],
      tagline: "Hybrid and Toyota/Lexus diagnostics specialist with her own two-bay shop.",
      languages: ["English", "Spanish"],
      trainedAt: "Toyota T-TEN program, then eleven years as a dealership master technician.",
      guarantee: "24-month / 24,000-mile guarantee on parts and labor for repairs done in my shop.",
      displayName: "Rosa Delgado",
      firstName: "Rosa",
      photoUrl: "/mechanics/rosa-delgado.webp",
      city: "Pasadena",
      serviceRadiusMi: 10,
      bio: "Hybrid and Toyota/Lexus diagnostics are my focus — eleven years at a Toyota dealership, now running my own two-bay shop. I also do mobile diagnostics around Pasadena and Altadena.",
      workModel: "both",
      shopName: "Delgado Hybrid Service (demo)",
      hourlyRateCents: 12000,
      diagnosticFeeCents: 9500,
      travelFeeCents: 3500,
      fixedPrices: [
        { category: "diagnostics", label: "Hybrid system diagnosis", labor: 14500 },
        { category: "cooling", label: "Inverter coolant pump (labor)", labor: 24000 },
      ],
      availabilityNote: "Shop Mon–Fri 8am–5pm; mobile Tue & Thu",
      nextAvailable: "Tue, Sep 30",
      nextAvailableOn: "2026-09-30",
      declaredRepairCategories: ["diagnostics", "cooling", "electrical", "brakes", "engine"],
      declaredMakes: ["Toyota", "Lexus"],
      selfReportedClaims: ["Rebuilt over 40 Prius hybrid batteries"],
      yearsExperienceClaim: 14,
      joinedAt: "2025-06-10",
      lat: 34.15,
      lng: -118.14,
    },
    safety: {
      identity: "verified",
      background: "verified",
      driving: "verified",
      insurance: { status: "verified", carrier: "Golden State Garage Insurance (demo)", expiresOn: "2027-01-31", verifiedAt: "2026-02-03" },
    },
    credentials: [
      { issuer: "ASE", name: "Master Automobile Technician", code: "A1–A8", issuedOn: "2021-09-01", expiresOn: "2026-09-30", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Advanced Engine Performance", code: "L1", issuedOn: "2022-02-14", expiresOn: "2027-02-28", status: "verified", method: "institution_check" },
      { issuer: "Toyota", name: "Master Diagnostic Technician", issuedOn: "2018-11-01", status: "verified", method: "document_review" },
    ],
    employment: [
      { employer: "Arroyo Toyota (demo)", position: "Master Diagnostic Technician", startedOn: "2012-04-01", endedOn: "2023-05-31", status: "verified", method: "employer_check" },
    ],
    gen: {
      platform: 40,
      customer: 12,
      categories: { diagnostics: 16, cooling: 11, electrical: 9, brakes: 10, engine: 6 },
      makes: { Toyota: 30, Lexus: 15, Honda: 4, Subaru: 3 },
      from: "2025-06-15",
    },
    selfRepairs: [["engine", "Toyota", 2010, "Prius", "Hybrid battery reconditioning", "self", "2022-08-01"]],
    reviews: { n: 38, fours: 8 },
    repeat: 17,
  },
  {
    profile: {
      slug: "marcus-webb",
      openings: [{"on": "2026-09-25", "time": "4:30 PM"}, {"on": "2026-09-26", "time": "5:00 PM"}],
      tagline: "Ten years at a Ford dealership, now independent in the South Bay.",
      languages: ["English"],
      trainedAt: "Dealership apprenticeship at a Ford store.",
      displayName: "Marcus Webb",
      firstName: "Marcus",
      photoUrl: "/mechanics/marcus-webb.webp",
      city: "Inglewood",
      serviceRadiusMi: 20,
      bio: "Ten years wrenching at a Ford dealership. Just went independent and I'm building my book of business — fair prices, straight answers, and I'll come to you anywhere in the South Bay.",
      workModel: "mobile",
      hourlyRateCents: 7000,
      diagnosticFeeCents: 4000,
      fixedPrices: [{ category: "brakes", label: "Front pads + rotors (labor)", labor: 14000 }],
      availabilityNote: "Every day 8am–7pm",
      nextAvailable: "Thu, Sep 25",
      nextAvailableOn: "2026-09-25",
      declaredRepairCategories: ["brakes", "suspension", "maintenance", "starters"],
      declaredMakes: ["Ford", "Chevrolet", "BMW"],
      selfReportedClaims: ["Over 100 brake jobs", "10 years of dealership experience", "Worked on plenty of BMWs"],
      yearsExperienceClaim: 10,
      joinedAt: "2026-08-04",
      lat: 33.96,
      lng: -118.35,
    },
    safety: { identity: "verified", background: "pending" },
    credentials: [
      { issuer: "ASE", name: "Brakes", code: "A5", issuedOn: "2019-01-10", expiresOn: "2024-01-31", status: "pending", method: "document_review" },
    ],
    employment: [
      { employer: "South Bay Ford (demo)", position: "Line Technician", startedOn: "2015-03-01", endedOn: "2026-07-15", status: "pending", method: "employer_check" },
    ],
    repairs: [
      ["brakes", "Ford", 2017, "F-150", "Front brake pads + rotors", "platform", "2026-09-12"],
      ["brakes", "Chevrolet", 2015, "Malibu", "Rear brake pads + rotors", "platform", "2026-08-30"],
      ["suspension", "Ford", 2014, "Explorer", "Front struts + mounts", "platform", "2026-08-19"],
    ],
    selfRepairs: [
      ["brakes", "BMW", 2012, "328i", "Front brake pads + rotors", "self", "2026-06-01"],
      ["brakes", "Ford", 2019, "Escape", "Front caliper replacement", "self", "2026-05-10"],
      ["suspension", "Chevrolet", 2016, "Tahoe", "Lower control arms", "self", "2026-04-02"],
      ["starters", "Ford", 2013, "Focus", "Starter motor replacement", "self", "2026-03-15"],
      ["maintenance", "Ford", 2018, "F-150", "Major service (60k)", "self", "2026-02-01"],
      ["brakes", "BMW", 2015, "X3 xDrive28i", "Rear brake pads + rotors", "self", "2025-12-12"],
    ],
    reviews: { n: 2, fours: 0 },
    repeat: 0,
    testimonials: [
      { author: "Tony R.", comment: "Marcus did my brakes at the dealership for years. Best tech there." },
      { author: "Keisha M.", comment: "Great guy, fair price." },
    ],
  },
  {
    profile: {
      slug: "anh-tran",
      openings: [{"on": "2026-09-26", "time": "9:00 AM"}, {"on": "2026-09-27", "time": "11:00 AM"}],
      tagline: "Electrical and drivability problems other shops give up on.",
      languages: ["English", "Vietnamese"],
      trainedAt: "Honda PACT program and eight years as a Honda technician.",
      displayName: "Anh Tran",
      firstName: "Anh",
      photoUrl: "/mechanics/anh-tran.webp",
      city: "Alhambra",
      serviceRadiusMi: 12,
      bio: "Electrical and drivability problems other shops give up on — that's most of my work. Eight years as a Honda technician, now mobile across the San Gabriel Valley with a full scan-tool setup.",
      workModel: "mobile",
      hourlyRateCents: 9500,
      diagnosticFeeCents: 7500,
      travelFeeCents: 2000,
      fixedPrices: [{ category: "electrical", label: "Parasitic drain diagnosis", labor: 15000 }],
      availabilityNote: "Mon–Sat 9am–6pm",
      nextAvailable: "Fri, Sep 26",
      nextAvailableOn: "2026-09-26",
      declaredRepairCategories: ["electrical", "diagnostics", "alternators", "starters"],
      declaredMakes: ["Honda", "Acura"],
      selfReportedClaims: [],
      yearsExperienceClaim: 9,
      joinedAt: "2025-09-01",
      lat: 34.09,
      lng: -118.13,
    },
    safety: {
      identity: "verified",
      background: "verified",
      driving: "verified",
      insurance: { status: "verified", carrier: "Pacific Tradesman Mutual (demo)", expiresOn: "2026-10-14", verifiedAt: "2025-10-15" },
    },
    credentials: [
      { issuer: "ASE", name: "Electrical/Electronic Systems", code: "A6", issuedOn: "2023-04-02", expiresOn: "2028-04-30", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Engine Performance", code: "A8", issuedOn: "2023-04-02", expiresOn: "2028-04-30", status: "verified", method: "institution_check" },
      { issuer: "Honda", name: "PACT Certified Technician", issuedOn: "2016-07-01", status: "verified", method: "document_review" },
    ],
    employment: [
      { employer: "San Gabriel Honda (demo)", position: "Technician", startedOn: "2016-05-01", endedOn: "2024-12-31", status: "verified", method: "employer_check" },
    ],
    gen: {
      platform: 22,
      customer: 7,
      categories: { electrical: 10, diagnostics: 11, alternators: 5, starters: 3 },
      makes: { Honda: 14, Acura: 8, Toyota: 4, Nissan: 3 },
      from: "2025-09-05",
    },
    selfRepairs: [],
    reviews: { n: 22, fours: 2 },
    repeat: 9,
  },
  {
    profile: {
      slug: "samuel-okafor",
      openings: [{"on": "2026-09-29", "time": "8:00 AM"}],
      tagline: "European specialist: BMW, Mercedes, Audi and VW, with factory-level scan tools.",
      languages: ["English"],
      trainedAt: "BMW STEP, then nine years as a BMW master technician.",
      displayName: "Samuel Okafor",
      firstName: "Samuel",
      photoUrl: "/mechanics/samuel-okafor.webp",
      city: "Long Beach",
      serviceRadiusMi: 8,
      bio: "European specialist. Nine years as a BMW master technician, now in my own shop in Bixby Knolls with factory-level diagnostic equipment for BMW, Mercedes, Audi and VW.",
      workModel: "shop",
      shopName: "Okafor European (demo)",
      hourlyRateCents: 14000,
      diagnosticFeeCents: 15000,
      fixedPrices: [
        { category: "engine", label: "Valve cover gasket (labor)", labor: 42000 },
        { category: "cooling", label: "Water pump + thermostat (labor)", labor: 52000 },
      ],
      availabilityNote: "Mon–Fri 8am–5:30pm",
      nextAvailable: "Mon, Sep 29",
      nextAvailableOn: "2026-09-29",
      declaredRepairCategories: ["engine", "cooling", "diagnostics", "electrical", "suspension"],
      declaredMakes: ["BMW", "Mercedes-Benz", "Audi", "Volkswagen"],
      selfReportedClaims: [],
      yearsExperienceClaim: 15,
      joinedAt: "2025-04-01",
      lat: 33.84,
      lng: -118.19,
    },
    safety: {
      identity: "verified",
      background: "verified",
      insurance: { status: "verified", carrier: "Harbor Commercial Insurance (demo)", expiresOn: "2026-08-31", verifiedAt: "2025-09-02" },
    },
    credentials: [
      { issuer: "ASE", name: "Engine Repair", code: "A1", issuedOn: "2022-01-15", expiresOn: "2027-01-31", status: "verified", method: "institution_check" },
      { issuer: "BMW Group", name: "Master Technician", issuedOn: "2017-10-01", status: "verified", method: "document_review" },
    ],
    employment: [
      { employer: "Harbor BMW (demo)", position: "Master Technician", startedOn: "2013-01-01", endedOn: "2022-03-31", status: "verified", method: "employer_check" },
    ],
    gen: {
      platform: 34,
      customer: 7,
      categories: { engine: 12, cooling: 10, diagnostics: 9, electrical: 6, suspension: 4 },
      makes: { BMW: 17, "Mercedes-Benz": 12, Audi: 7, Volkswagen: 5 },
      from: "2025-04-10",
    },
    selfRepairs: [],
    reviews: { n: 30, fours: 9 },
    repeat: 14,
  },
  {
    profile: {
      slug: "jess-kowalski",
      openings: [{"on": "2026-09-26", "time": "7:30 AM"}, {"on": "2026-09-26", "time": "1:00 PM"}],
      tagline: "Trucks, SUVs and suspension, done in your driveway.",
      languages: ["English", "Polish"],
      trainedAt: "Seven years maintaining a city vehicle fleet.",
      displayName: "Jess Kowalski",
      firstName: "Jess",
      photoUrl: "/mechanics/jess-kowalski.webp",
      city: "Burbank",
      serviceRadiusMi: 15,
      bio: "Trucks, SUVs and anything with a lift kit. Former fleet technician — I do suspension and brakes in your driveway across Burbank, Glendale and the east Valley.",
      workModel: "mobile",
      hourlyRateCents: 8000,
      diagnosticFeeCents: 5000,
      travelFeeCents: 2000,
      fixedPrices: [{ category: "suspension", label: "Front struts (labor)", labor: 26000 }],
      availabilityNote: "Mon–Fri 7am–4pm",
      nextAvailable: "Fri, Sep 26",
      nextAvailableOn: "2026-09-26",
      declaredRepairCategories: ["suspension", "brakes", "maintenance"],
      declaredMakes: ["Ford", "Chevrolet", "Jeep", "Toyota"],
      selfReportedClaims: [],
      yearsExperienceClaim: 8,
      joinedAt: "2025-11-15",
      lat: 34.18,
      lng: -118.31,
    },
    safety: {
      identity: "verified",
      background: "verified",
      driving: "verified",
      insurance: { status: "verified", carrier: "Golden State Garage Insurance (demo)", expiresOn: "2027-03-31", verifiedAt: "2026-04-01" },
    },
    credentials: [
      { issuer: "ASE", name: "Suspension & Steering", code: "A4", issuedOn: "2023-08-10", expiresOn: "2028-08-31", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Brakes", code: "A5", issuedOn: "2023-08-10", expiresOn: "2028-08-31", status: "verified", method: "document_review" },
    ],
    employment: [
      { employer: "Valley Fleet Services (demo)", position: "Fleet Technician", startedOn: "2018-02-01", endedOn: "2025-10-31", status: "verified", method: "employer_check" },
    ],
    gen: {
      platform: 18,
      customer: 3,
      categories: { suspension: 9, brakes: 8, maintenance: 4 },
      makes: { Ford: 8, Chevrolet: 5, Jeep: 4, Toyota: 4 },
      from: "2025-11-20",
    },
    selfRepairs: [],
    reviews: { n: 16, fours: 3 },
    repeat: 6,
  },
  {
    profile: {
      slug: "luis-romero",
      openings: [{"on": "2026-09-27", "time": "9:00 AM"}],
      tagline: "The neighborhood mechanic for starters, alternators and electrical.",
      languages: ["English", "Spanish"],
      trainedAt: "Learned at an auto-electric shop in East LA, independent since 2017.",
      displayName: "Luis Romero",
      firstName: "Luis",
      photoUrl: "/mechanics/luis-romero.webp",
      city: "Los Angeles",
      neighborhood: "Boyle Heights",
      serviceRadiusMi: 10,
      bio: "Starters, alternators and electrical — I've been the neighborhood mechanic in Boyle Heights for over fifteen years. Most of my customers found me by word of mouth, and a lot of them have confirmed my work here.",
      workModel: "mobile",
      hourlyRateCents: 6500,
      diagnosticFeeCents: 3500,
      fixedPrices: [
        { category: "alternators", label: "Alternator replacement (labor)", labor: 13000 },
        { category: "starters", label: "Starter replacement (labor)", labor: 12000 },
      ],
      availabilityNote: "Mon–Sat 8am–6pm",
      nextAvailable: "Sat, Sep 27",
      nextAvailableOn: "2026-09-27",
      declaredRepairCategories: ["starters", "alternators", "electrical"],
      declaredMakes: ["Nissan", "Honda", "Toyota", "Chevrolet"],
      selfReportedClaims: ["15+ years as an independent mechanic", "ASE A6 certified"],
      yearsExperienceClaim: 17,
      joinedAt: "2026-05-20",
      lat: 34.03,
      lng: -118.21,
    },
    safety: { identity: "verified", background: "verified" },
    credentials: [
      { issuer: "ASE", name: "Electrical/Electronic Systems", code: "A6", issuedOn: "2014-06-01", status: "needs_info", method: "document_review", notes: "Certificate photo is cropped — please upload the full ASE transcript or certificate showing your ID number." },
    ],
    employment: [
      { employer: "Eastside Auto Electric (demo)", position: "Auto Electrician", startedOn: "2008-01-01", endedOn: "2016-12-31", status: "pending", method: "employer_check" },
    ],
    gen: {
      platform: 4,
      customer: 14,
      categories: { starters: 7, alternators: 7, electrical: 4 },
      makes: { Nissan: 6, Honda: 5, Toyota: 4, Chevrolet: 3 },
      from: "2026-05-25",
    },
    selfRepairs: [
      ["alternators", "Nissan", 2012, "Altima", "Alternator replacement", "self", "2024-02-10"],
      ["starters", "Honda", 2009, "Civic", "Starter motor replacement", "self", "2023-11-02"],
      ["electrical", "Toyota", 2011, "Camry", "Headlight wiring repair", "self", "2023-07-19"],
    ],
    reviews: { n: 4, fours: 1 },
    repeat: 1,
    customerConfirmedReviews: 6,
  },
  {
    profile: {
      slug: "priya-nair",
      openings: [{"on": "2026-09-29", "time": "10:30 AM"}],
      tagline: "Cooling systems and A/C, EPA 609 certified.",
      languages: ["English", "Hindi"],
      trainedAt: "Seven years as lead A/C technician at a Culver City shop.",
      guarantee: "90-day guarantee on A/C recharge and leak repairs.",
      displayName: "Priya Nair",
      firstName: "Priya",
      photoUrl: "",
      city: "Culver City",
      serviceRadiusMi: 12,
      bio: "Cooling systems and A/C, year-round. EPA 609 certified for refrigerant work. Shop in Culver City, mobile across the Westside for diagnosis and recharges.",
      workModel: "both",
      shopName: "Nair Auto Climate (demo)",
      hourlyRateCents: 10500,
      diagnosticFeeCents: 8500,
      travelFeeCents: 3000,
      fixedPrices: [
        { category: "ac", label: "A/C recharge + leak test", labor: 16500 },
        { category: "cooling", label: "Thermostat replacement (labor)", labor: 18000 },
      ],
      availabilityNote: "Mon–Fri 8am–6pm",
      nextAvailable: "Mon, Sep 29",
      nextAvailableOn: "2026-09-29",
      declaredRepairCategories: ["ac", "cooling", "diagnostics"],
      declaredMakes: ["Honda", "Toyota", "Hyundai", "Kia", "Mazda"],
      selfReportedClaims: [],
      yearsExperienceClaim: 10,
      joinedAt: "2025-08-01",
      lat: 34.02,
      lng: -118.4,
    },
    safety: {
      identity: "verified",
      background: "verified",
      driving: "verified",
      insurance: { status: "verified", carrier: "Pacific Tradesman Mutual (demo)", expiresOn: "2027-02-28", verifiedAt: "2026-03-01" },
    },
    credentials: [
      { issuer: "EPA", name: "Section 609 Refrigerant Certification", issuedOn: "2016-03-01", status: "verified", method: "institution_check" },
      { issuer: "ASE", name: "Heating & Air Conditioning", code: "A7", issuedOn: "2022-10-01", expiresOn: "2027-10-31", status: "verified", method: "institution_check" },
    ],
    employment: [
      { employer: "Culver Auto Air (demo)", position: "Lead A/C Technician", startedOn: "2016-01-01", endedOn: "2023-06-30", status: "verified", method: "employer_check" },
    ],
    gen: {
      platform: 21,
      customer: 5,
      categories: { ac: 12, cooling: 10, diagnostics: 4 },
      makes: { Honda: 7, Toyota: 6, Hyundai: 5, Kia: 4, Mazda: 4 },
      from: "2025-08-05",
    },
    selfRepairs: [],
    reviews: { n: 19, fours: 2 },
    repeat: 7,
  },
];

const ADMIN_ID = "user-admin";

/** Typical demo job values by category, in cents (labor + fees; parts excluded). */
const JOB_VALUE: Record<RepairCategory, number> = {
  brakes: 26000,
  starters: 24000,
  suspension: 34000,
  diagnostics: 9000,
  cooling: 42000,
  electrical: 22000,
  engine: 56000,
  ac: 26000,
  alternators: 28000,
  maintenance: 18000,
};
const REVIEWER_NAME = "C. Ortiz";
export { REVIEWER_NAME };

export function buildSeed(): DB {
  const db: DB = {
    users: [
      { id: ADMIN_ID, demo: true, roles: ["admin"], email: "review@clutch.demo", name: "C. Ortiz", notificationPrefs: { email: true, sms: true, push: true } },
      { id: "user-maya", demo: true, roles: ["customer"], email: "maya@clutch.demo", phone: "(213) 555-0118", name: "Maya Chen", notificationPrefs: { email: true, sms: true, push: true } },
    ],
    mechanics: [],
    customers: [
      { id: "cust-maya", userId: "user-maya", displayName: "Maya Chen", city: "Los Angeles" },
      // Derek holds both roles: he hires other mechanics for his own truck.
      { id: "cust-derek", userId: "user-derek-hall", displayName: "Derek Hall", city: "Los Angeles" },
    ],
    vehicles: [
      { id: "veh-maya-bmw", customerId: "cust-maya", year: 2017, make: "BMW", model: "330i", engine: "2.0L turbo 4-cyl", transmission: "automatic", mileage: 71200 },
      { id: "veh-derek-tacoma", customerId: "cust-derek", year: 2011, make: "Toyota", model: "Tacoma", trim: "TRD Off-Road", engine: "4.0L V6", transmission: "manual", mileage: 164000 },
      { id: "veh-maya-crv", customerId: "cust-maya", year: 2018, make: "Honda", model: "CR-V", engine: "1.5L turbo", transmission: "cvt", mileage: 88400 },
    ],
    screenings: [],
    insurance: [],
    credentials: [],
    employment: [],
    pastRepairs: [],
    confirmations: [],
    verifications: [],
    requests: [],
    quotes: [],
    jobs: [],
    reviews: [],
    saved: [{ customerId: "cust-maya", mechanicId: "mech-derek-hall", savedAt: "2026-06-12" }],
    events: [],
    profileShares: {},
    drafts: {},
    notifications: [],
    supportReports: [],
    customerNotes: { "mech-derek-hall": { "cust-maya": "Prefers texts. Parks in the driveway on the left." } },
  };

  let seq = 0;
  const id = (p: string) => `${p}-${(++seq).toString(36)}`;
  let nameCursor = 1; // 0 is Maya

  SPECS.forEach((spec, idx) => {
    const rand = rng(1000 + idx * 97);
    const mid = `mech-${spec.profile.slug}`;
    const uid = `user-${spec.profile.slug}`;
    db.users.push({ id: uid, demo: true, roles: spec.profile.slug === "derek-hall" ? ["mechanic", "customer"] : ["mechanic"], email: `${spec.profile.slug}@clutch.demo`, phone: `(323) 555-01${String(20 + idx)}`, name: spec.profile.displayName, notificationPrefs: { email: true, sms: true, push: true } });
    const { fixedPrices, ...rest } = spec.profile;
    db.mechanics.push({
      ...rest,
      id: mid,
      userId: uid,
      isDemo: true,
      fixedPrices: (fixedPrices ?? []).map((f) => ({ id: id("fp"), repairCategory: f.category, label: f.label, laborCents: f.labor })),
    });

    // ---- Safety ----
    const screen = (kind: ScreeningKind, status?: VerificationStatus) => {
      if (!status) return;
      // Identity is checked at onboarding; background/MVR are rescreened annually (last run Jul 2026).
      const onboarded = addDays(spec.profile.joinedAt, -6);
      const rescreened = onboarded > "2026-07-15" ? onboarded : "2026-07-15";
      const completed = status === "verified" ? (kind === "identity" ? onboarded : rescreened) : undefined;
      const expires = completed ? addMonthsISO(completed, kind === "identity" ? 36 : 12) : undefined;
      const sc: ScreeningCheck = {
        id: id("scr"),
        mechanicId: mid,
        kind,
        provider: "mock",
        providerRef: `mock_${kind}_${spec.profile.slug}`,
        status,
        result: status === "verified" ? "clear" : undefined,
        consentAt: kind === "identity" ? undefined : addDays(spec.profile.joinedAt, -8),
        completedAt: completed,
        expiresAt: expires,
      };
      db.screenings.push(sc);
      db.verifications.push({
        id: id("ver"),
        mechanicId: mid,
        subjectType: "screening_check",
        subjectId: sc.id,
        category: kind,
        method: "vendor_screening",
        provider: "mock",
        status,
        submittedAt: addDays(spec.profile.joinedAt, -8),
        verifiedAt: completed,
        expiresAt: expires,
        notes: status === "verified" ? "Provider returned clear." : "Awaiting provider result.",
        evidenceSummary:
          kind === "identity"
            ? "Government ID + live selfie captured by screening provider"
            : kind === "background"
              ? "FCRA disclosure signed; county, state and national criminal search + sex offender registry"
              : "Motor vehicle record request, California DMV",
      });
    };
    screen("identity", spec.safety.identity);
    screen("background", spec.safety.background);
    screen("driving_record", spec.safety.driving);
    if (spec.safety.insurance) {
      const ins = spec.safety.insurance;
      const rec: InsuranceRecord = {
        id: id("ins"),
        mechanicId: mid,
        carrier: ins.carrier,
        policyLast4: String(1000 + Math.floor(rand() * 8999)).slice(-4),
        coverageCents: 100_000_000,
        documentName: "certificate-of-insurance.pdf",
        effectiveOn: addMonthsISO(ins.expiresOn, -12),
        expiresOn: ins.expiresOn,
      };
      db.insurance.push(rec);
      db.verifications.push({
        id: id("ver"),
        mechanicId: mid,
        subjectType: "insurance_record",
        subjectId: rec.id,
        category: "insurance",
        method: "document_review",
        status: ins.status,
        submittedAt: ins.verifiedAt ? addDays(ins.verifiedAt, -2) : undefined,
        verifiedAt: ins.verifiedAt,
        expiresAt: ins.expiresOn,
        reviewerId: ins.verifiedAt ? ADMIN_ID : undefined,
        notes: "General liability $1M per occurrence confirmed on certificate.",
        evidenceSummary: `Certificate of insurance, ${ins.carrier}`,
      });
    }

    // ---- Credentials & employment ----
    for (const c of spec.credentials) {
      const cred: Credential = {
        id: id("cred"),
        mechanicId: mid,
        issuer: c.issuer,
        name: c.name,
        code: c.code,
        issuedOn: c.issuedOn,
        expiresOn: c.expiresOn,
        documentName: `${c.issuer.toLowerCase().replace(/\s+/g, "-")}-${(c.code ?? c.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`,
      };
      db.credentials.push(cred);
      db.verifications.push({
        id: id("ver"),
        mechanicId: mid,
        subjectType: "credential",
        subjectId: cred.id,
        category: "credential",
        method: c.method ?? "document_review",
        status: c.status,
        submittedAt: addDays(spec.profile.joinedAt, 2),
        verifiedAt: c.status === "verified" ? addDays(spec.profile.joinedAt, 5) : undefined,
        expiresAt: c.expiresOn,
        reviewerId: c.status === "verified" ? ADMIN_ID : undefined,
        notes: c.notes ?? (c.method === "institution_check" ? "Matched against issuer's certification lookup." : undefined),
        evidenceSummary: `${c.issuer} ${c.code ? c.code + " " : ""}${c.name} — certificate upload`,
      });
    }
    for (const e of spec.employment) {
      const emp: EmploymentRecord = {
        id: id("emp"),
        mechanicId: mid,
        employer: e.employer,
        position: e.position,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        documentName: e.status === "not_submitted" ? undefined : "employment-verification-letter.pdf",
      };
      db.employment.push(emp);
      db.verifications.push({
        id: id("ver"),
        mechanicId: mid,
        subjectType: "employment",
        subjectId: emp.id,
        category: "employment",
        method: e.method ?? "employer_check",
        status: e.status,
        submittedAt: e.status === "not_submitted" ? undefined : addDays(spec.profile.joinedAt, 3),
        verifiedAt: e.status === "verified" ? addDays(spec.profile.joinedAt, 9) : undefined,
        reviewerId: e.status === "verified" ? ADMIN_ID : undefined,
        notes: e.status === "verified" ? "Service manager confirmed dates and role by phone." : e.notes,
        evidenceSummary: e.status === "not_submitted" ? undefined : `Employment letter + service manager contact at ${e.employer}`,
      });
    }

    // ---- Repairs ----
    let tuples: RepairTuple[] = spec.repairs ?? [];
    if (spec.gen) {
      const g = spec.gen;
      const total = g.platform + g.customer;
      const cats = shuffle(expand(g.categories), rand);
      const makes = shuffle(expand(g.makes), rand);
      const pDates = monthsBetween(g.from, "2026-09-20", g.platform, rand);
      const cDates = monthsBetween("2022-01-01", addDays(g.from, -20), g.customer, rand);
      tuples = Array.from({ length: total }, (_, i) => {
        const cat = cats[i % cats.length];
        const make = makes[i % makes.length];
        const models = MODELS[make];
        const model = models[Math.floor(rand() * models.length)];
        const titles = TITLES[cat];
        const title = titles[Math.floor(rand() * titles.length)];
        const year = 2008 + Math.floor(rand() * 13);
        const isPlatform = i < g.platform;
        return [cat, make, year, model, title, isPlatform ? "platform" : "customer", isPlatform ? pDates[i] : cDates[i - g.platform]];
      });
    }

    // Customers: `repeat` customers get two platform jobs; the rest one each.
    const platformIdx = tuples.map((t, i) => (t[5] === "platform" ? i : -1)).filter((i) => i >= 0);
    const customerFor: string[] = [];
    const repeatIds: string[] = [];
    for (let r = 0; r < spec.repeat; r++) {
      const cid = spec.profile.slug === "derek-hall" && r === 0 ? "cust-maya" : `cust-${spec.profile.slug}-${r}`;
      repeatIds.push(cid);
    }
    const singles = platformIdx.length - spec.repeat * 2;
    const order = shuffle([...repeatIds, ...repeatIds, ...Array.from({ length: Math.max(0, singles) }, (_, i) => `cust-${spec.profile.slug}-s${i}`)], rand);
    platformIdx.forEach((ti, k) => (customerFor[ti] = order[k]));
    // Maya's two Derek jobs are the BMW + CR-V rows so her history reads true.
    if (spec.profile.slug === "derek-hall") {
      const bmwIdx = tuples.findIndex((t) => t[1] === "BMW" && t[3] === "330i");
      const crvIdx = tuples.findIndex((t) => t[1] === "Honda" && t[3] === "CR-V");
      const swap = (target: number) => {
        const cur = customerFor.indexOf("cust-maya");
        const other = customerFor.indexOf("cust-maya", cur + 1);
        const from = [cur, other].find((x) => x !== bmwIdx && x !== crvIdx);
        if (from === undefined || from === target || customerFor[target] === "cust-maya") return;
        [customerFor[from], customerFor[target]] = [customerFor[target], customerFor[from]];
      };
      swap(bmwIdx);
      swap(crvIdx);
    }
    const custName = new Map<string, string>();
    const nameOf = (cid: string) => {
      if (cid === "cust-maya") return "Maya C.";
      if (!custName.has(cid)) custName.set(cid, CUSTOMER_NAMES[nameCursor++ % CUSTOMER_NAMES.length]);
      return custName.get(cid)!;
    };

    const repairIds: string[] = [];
    tuples.forEach((t, i) => {
      const [cat, make, year, model, title, source, date] = t;
      const rid = id("rep");
      repairIds.push(rid);
      const cid = customerFor[i];
      if (cid && cid !== "cust-maya" && !db.customers.some((c) => c.id === cid)) {
        db.customers.push({ id: cid, userId: `user-${cid}`, displayName: nameOf(cid), city: spec.profile.city });
      }
      db.pastRepairs.push({
        id: rid,
        mechanicId: mid,
        source: source === "platform" ? "platform" : "customer_confirmed",
        jobId: source === "platform" ? `job-hist-${rid}` : undefined,
        year,
        make,
        model,
        repairCategory: cat,
        title,
        performedOn: date ?? "2025-01-01",
        customerId: cid,
        evidence: source === "platform" ? [{ kind: "invoice", name: "clutch-estimate.pdf" }] : [{ kind: "photo", name: "before-after.jpg" }],
        // Demo job values (approved-estimate amounts) so earnings views have history.
        valueCents: source === "platform" ? Math.round((JOB_VALUE[cat] * (0.8 + rand() * 0.45)) / 500) * 500 : undefined,
      });
      if (source === "customer") {
        const conf: CustomerConfirmation = {
          id: id("conf"),
          pastRepairId: rid,
          mechanicId: mid,
          token: `c-${rid}`,
          contact: "(private)",
          contactName: CUSTOMER_NAMES[(nameCursor + i) % CUSTOMER_NAMES.length],
          sentAt: addDays(spec.profile.joinedAt, 4),
          respondedAt: addDays(spec.profile.joinedAt, 6),
          response: "confirmed",
        };
        db.confirmations.push(conf);
        db.verifications.push({
          id: id("ver"),
          mechanicId: mid,
          subjectType: "past_repair",
          subjectId: rid,
          category: "past_repair",
          method: "customer_confirmation",
          status: "verified",
          submittedAt: conf.sentAt,
          verifiedAt: conf.respondedAt,
          notes: "Customer confirmed via private link.",
          evidenceSummary: `${year} ${make} ${model} — ${title}`,
        });
      }
    });
    for (const t of spec.selfRepairs) {
      const [cat, make, year, model, title, , date] = t;
      db.pastRepairs.push({
        id: id("rep"),
        mechanicId: mid,
        source: "self",
        year,
        make,
        model,
        repairCategory: cat,
        title,
        performedOn: date ?? "2024-01-01",
        evidence: [],
      });
    }

    // ---- Reviews on platform jobs ----
    const platformRepairs = db.pastRepairs.filter((r) => r.mechanicId === mid && r.source === "platform");
    const comments = shuffle(COMMENTS, rand);
    for (let k = 0; k < spec.reviews.n && k < platformRepairs.length; k++) {
      const r = platformRepairs[k];
      const overall = 5; // 4-star reviews are placed deterministically below
      db.reviews.push({
        id: id("rev"),
        mechanicId: mid,
        kind: "verified_job",
        jobId: r.jobId,
        pastRepairId: r.id,
        overall,
        communication: overall === 5 ? 5 : 4,
        timeliness: rand() > 0.15 ? 5 : 4,
        priceAccuracy: rand() > 0.1 ? 5 : 4,
        workmanship: overall,
        comment: k < comments.length ? comments[k].replace("{v}", r.model) : "",
        authorName: nameOf(r.customerId ?? ""),
        vehicleLabel: `${r.year} ${r.make} ${r.model}`,
        repairLabel: r.title,
        createdAt: addDays(r.performedOn, 1),
      });
    }
    // Force the exact count of 4-star reviews for stable averages.
    const mine = db.reviews.filter((r) => r.mechanicId === mid && r.kind === "verified_job");
    mine.forEach((r) => (r.overall = 5));
    for (let f = 0; f < spec.reviews.fours; f++) {
      const r = mine[Math.min(mine.length - 1, 2 + f * 3)];
      r.overall = 4;
      r.workmanship = 4;
    }
    const customerRepairs = db.pastRepairs.filter((r) => r.mechanicId === mid && r.source === "customer_confirmed");
    for (let k = 0; k < (spec.customerConfirmedReviews ?? 0) && k < customerRepairs.length; k++) {
      const r = customerRepairs[k];
      db.reviews.push({
        id: id("rev"),
        mechanicId: mid,
        kind: "customer_confirmed",
        pastRepairId: r.id,
        overall: 5,
        comment: comments[(k + 7) % comments.length].replace("{v}", r.model),
        authorName: CUSTOMER_NAMES[(nameCursor + 11 + k) % CUSTOMER_NAMES.length],
        vehicleLabel: `${r.year} ${r.make} ${r.model}`,
        repairLabel: r.title,
        createdAt: addDays(r.performedOn, 3),
      });
    }
    for (const t of spec.testimonials ?? []) {
      db.reviews.push({
        id: id("rev"),
        mechanicId: mid,
        kind: "testimonial",
        overall: 5,
        comment: t.comment,
        authorName: t.author,
        createdAt: spec.profile.joinedAt,
      });
    }
  });

  // ---- Pending verification work for the admin queue & Verification Center ----
  const derekSelf = db.pastRepairs.find((r) => r.mechanicId === "mech-derek-hall" && r.source === "self" && r.make === "Mercedes-Benz")!;
  derekSelf.evidence = [{ kind: "invoice", name: "invoice-c300-brakes.jpg" }];
  const derekConf: CustomerConfirmation = {
    id: "conf-derek-c300",
    pastRepairId: derekSelf.id,
    mechanicId: "mech-derek-hall",
    token: "derek-c300",
    contact: "(310) 555-0142",
    contactName: "Alan W.",
    sentAt: "2026-09-22",
  };
  db.confirmations.push(derekConf);
  db.verifications.push({
    id: "ver-derek-c300",
    mechanicId: "mech-derek-hall",
    subjectType: "past_repair",
    subjectId: derekSelf.id,
    category: "past_repair",
    method: "customer_confirmation",
    status: "pending",
    submittedAt: "2026-09-22",
    notes: "Confirmation link sent to prior customer.",
    evidenceSummary: "2014 Mercedes-Benz C300 — Front brake pads + rotors (invoice photo attached)",
  });
  const marcusSelf = db.pastRepairs.find((r) => r.mechanicId === "mech-marcus-webb" && r.source === "self" && r.make === "BMW")!;
  marcusSelf.evidence = [{ kind: "photo", name: "328i-front-brakes.jpg" }];
  db.verifications.push({
    id: "ver-marcus-328i",
    mechanicId: "mech-marcus-webb",
    subjectType: "past_repair",
    subjectId: marcusSelf.id,
    category: "past_repair",
    method: "document_review",
    status: "pending",
    submittedAt: "2026-09-19",
    notes: "Mechanic uploaded a work photo; no invoice or customer contact yet.",
    evidenceSummary: "2012 BMW 328i — Front brake pads + rotors (1 photo)",
  });

  // ---- Marketplace demo state ----
  // Maya's open BMW brake request with three quotes to compare.
  db.requests.push(
    req({
      id: "req-maya-bmw",
      customerId: "cust-maya",
      vehicleId: "veh-maya-bmw",
      repairCategory: "brakes",
      categorySource: "inferred",
      symptomDescription:
        "Grinding noise from the front when I brake, and the brake warning light came on this week. It's louder when I first pull out of the driveway. I don't think the front pads have ever been changed.",
      occurrence: { conditions: ["While braking", "When cold"] },
      onset: { when: "few_days", firstNoticed: "Heard it braking down the hill on Olympic; the light came on the next morning." },
      startsStatus: "normal",
      driveability: "normal",
      safeToDrive: "unsure",
      warningLights: ["Brake"],
      sounds: { present: "yes", kinds: ["Grinding"], description: "Metal-on-metal grind from the front, only when braking." },
      leaks: { present: "no" },
      recentRepairs: [{ what: "Oil change", when: "About two months ago (68k)", shop: "Quick-lube place" }],
      suspectedIssue: "I think the front brakes are worn.",
      location: {
        serviceMode: "mobile",
        area: "mid-city",
        address: "1234 S Demo Ave, Los Angeles (demo)",
        parkingType: "driveway",
        flatGround: "yes",
        workSpace: "yes",
        repairsAllowed: "yes",
        accessAvailable: true,
      },
      urgency: "this_week",
      preferredTimes: "This weekend, Saturday morning preferred",
      media: [
        demoMedia("m-maya-1", "photo", "dashboard", "dash-brake-light.jpg"),
        demoMedia("m-maya-2", "photo", "wheel", "front-left-wheel.jpg"),
        demoMedia("m-maya-3", "audio", "sound", "brake-grind.m4a"),
      ],
      status: "quoted",
      createdAt: "2026-09-23",
      matchedMechanicIds: ["mech-derek-hall", "mech-marcus-webb", "mech-samuel-okafor", "mech-jess-kowalski"],
      declinedBy: ["mech-jess-kowalski"],
      questions: [
        {
          mechanicId: "mech-marcus-webb",
          customerId: "cust-maya",
          question: "Is the grinding only from the front, or from the back too?",
          askedAt: "2026-09-24",
          attachments: [],
        },
      ],
    }),
  );
  db.quotes.push(
    {
      id: "quote-derek-bmw",
      requestId: "req-maya-bmw",
      mechanicId: "mech-derek-hall",
      laborCents: 18500,
      diagnosticFeeCents: 0,
      travelFeeCents: 2500,
      partsIncluded: false,
      partsEstimateCents: 34000,
      durationHours: 2,
      availableOn: "Sat, Sep 27 · 9am",
      serviceMode: "mobile",
      scope: "Replace front pads, rotors and wear sensor with OEM-spec parts; inspect rear pads and brake fluid; reset service interval.",
      notes: "I can do this. On the F30 330i the brake light with grinding up front almost always means the front pads are down to metal and the wear sensor has tripped. I've done 6 verified BMW brake jobs, including this generation. I'll measure the rotors before replacing them; if they're within spec I'll tell you and knock the rotor labor off. Parts at cost with receipts.",
      status: "submitted",
      createdAt: "2026-09-23",
      viewedAt: "2026-09-24T07:15:00Z",
      customerQuestions: [],
    },
    {
      id: "quote-marcus-bmw",
      requestId: "req-maya-bmw",
      mechanicId: "mech-marcus-webb",
      laborCents: 14000,
      diagnosticFeeCents: 0,
      travelFeeCents: 0,
      partsIncluded: false,
      partsEstimateCents: 29000,
      durationHours: 2.5,
      availableOn: "Fri, Sep 26 · 4pm",
      serviceMode: "mobile",
      scope: "Front pads and rotors.",
      notes: "Can do it Friday after work.",
      status: "submitted",
      createdAt: "2026-09-24",
      customerQuestions: [],
    },
    {
      id: "quote-samuel-bmw",
      requestId: "req-maya-bmw",
      mechanicId: "mech-samuel-okafor",
      laborCents: 26000,
      diagnosticFeeCents: 0,
      travelFeeCents: 0,
      partsIncluded: true,
      partsEstimateCents: 38000,
      durationHours: 3,
      availableOn: "Mon, Sep 29 · drop-off 8am",
      serviceMode: "shop",
      scope: "Front pads, rotors, wear sensor (genuine BMW parts included), brake fluid test, road test.",
      notes: "Drop-off at the shop in Long Beach; ready same day.",
      status: "submitted",
      createdAt: "2026-09-24",
      customerQuestions: [],
    },
  );
  // Incoming requests for Derek to quote.
  db.customers.push(
    { id: "cust-req-1", userId: "user-cust-req-1", displayName: "Jordan P.", city: "Los Angeles" },
    { id: "cust-req-2", userId: "user-cust-req-2", displayName: "Sofia M.", city: "Culver City" },
    { id: "cust-req-4", userId: "user-cust-req-4", displayName: "Chris T.", city: "Los Angeles" },
  );
  db.vehicles.push(
    { id: "veh-req-1", customerId: "cust-req-1", year: 2015, make: "BMW", model: "X3 xDrive28i", transmission: "automatic", mileage: 94000 },
    { id: "veh-req-2", customerId: "cust-req-2", year: 2018, make: "Toyota", model: "Camry", transmission: "automatic", mileage: 61000 },
    { id: "veh-req-4", customerId: "cust-req-4", year: 2008, make: "BMW", model: "135i", engine: "3.0L twin-turbo (N54)", transmission: "manual", vin: "WBAUC73578VF00000", mileage: 94000 },
  );
  db.requests.push(
    req({
      id: "req-jordan-x3",
      customerId: "cust-req-1",
      vehicleId: "veh-req-1",
      repairCategory: "brakes",
      categorySource: "customer",
      symptomDescription: "Squealing from the rear when I brake, and the brake pad warning is on. Would like pads and rotors checked.",
      occurrence: { conditions: ["While braking"] },
      onset: { when: "few_weeks" },
      startsStatus: "normal",
      driveability: "normal",
      safeToDrive: "yes",
      warningLights: ["Brake"],
      sounds: { present: "yes", kinds: ["Squealing"] },
      leaks: { present: "no" },
      location: { serviceMode: "mobile", area: "koreatown", address: "(demo)", parkingType: "street", flatGround: "yes", workSpace: "limited", repairsAllowed: "unsure", notes: "Street parking, usually a spot on the block." },
      urgency: "this_week",
      preferredTimes: "Weekday evening or Saturday",
      media: [demoMedia("m-jordan-1", "photo", "dashboard", "dash-warning.jpg")],
      status: "open",
      createdAt: "2026-09-24",
      matchedMechanicIds: ["mech-derek-hall", "mech-marcus-webb"],
      interested: [{ mechanicId: "mech-marcus-webb", note: "Available Thursday evening. I'd check rear pad thickness and the wear sensor first.", at: "2026-09-24" }],
    }),
    req({
      id: "req-sofia-camry",
      customerId: "cust-req-2",
      vehicleId: "veh-req-2",
      repairCategory: "starters",
      categorySource: "inferred",
      symptomDescription: "Clicks once but won't crank some mornings. Other mornings it starts fine. Battery was replaced last year.",
      occurrence: { conditions: ["At startup", "When cold", "Intermittently"] },
      onset: { when: "few_days" },
      startsStatus: "clicks_no_crank",
      driveability: "normal",
      safeToDrive: "yes",
      warningLights: ["None"],
      sounds: { present: "yes", kinds: ["Clicking"] },
      recentRepairs: [{ what: "Battery replaced", when: "About a year ago" }],
      location: { serviceMode: "mobile", area: "culver-city", address: "(demo)", parkingType: "apartment_garage", flatGround: "yes", workSpace: "limited", repairsAllowed: "unsure", notes: "Low-clearance garage, about 6'8\"." },
      urgency: "one_two_days",
      preferredTimes: "Any weekday morning",
      status: "open",
      createdAt: "2026-09-25",
      matchedMechanicIds: ["mech-derek-hall", "mech-luis-romero", "mech-anh-tran"],
    }),
    req({
      id: "req-chris-135i",
      customerId: "cust-req-4",
      vehicleId: "veh-req-4",
      repairCategory: "starters",
      categorySource: "inferred",
      symptomDescription:
        "When I press start there's a single click and the engine doesn't turn over. Dash lights come on and stay bright. It started yesterday and happens every time now.",
      occurrence: { conditions: ["At startup", "All the time"] },
      onset: { when: "today", firstNoticed: "Went out in the morning and it just clicked once. It drove fine the night before." },
      startsStatus: "clicks_no_crank",
      driveability: "no",
      safeToDrive: "unsure",
      warningLights: ["None"],
      diagnosticCodes: ["2A82"],
      sounds: { present: "yes", kinds: ["Clicking"], description: "One click from under the hood each time I press start." },
      smells: [],
      leaks: { present: "no" },
      recentRepairs: [{ what: "Battery replaced", when: "3 months ago", shop: "Auto parts store" }],
      suspectedIssue: "Starter",
      priorDiagnosis: { said: "Scanned it at a shop; they thought it might be the starter or a VANOS solenoid.", quotedRepair: "Starter replacement", quotedPriceCents: 89000 },
      location: {
        serviceMode: "mobile",
        area: "silver-lake",
        address: "(demo)",
        parkingType: "driveway",
        flatGround: "yes",
        workSpace: "yes",
        repairsAllowed: "yes",
        accessAvailable: true,
        accessInstructions: "Keys with the neighbor at #4 (demo).",
      },
      urgency: "one_two_days",
      preferredTimes: "Saturday morning",
      media: [
        demoMedia("m-chris-1", "photo", "dashboard", "dash-on-start.jpg"),
        demoMedia("m-chris-2", "photo", "engine_bay", "engine-bay.jpg"),
        demoMedia("m-chris-3", "audio", "sound", "click-on-start.m4a"),
        demoMedia("m-chris-4", "document", "prior_estimate", "shop-estimate.pdf"),
      ],
      status: "open",
      createdAt: "2026-09-25",
      matchedMechanicIds: ["mech-derek-hall", "mech-samuel-okafor", "mech-luis-romero"],
    }),
  );
  // An upcoming job on Derek's calendar (customer approved his estimate).
  db.customers.push({ id: "cust-req-3", userId: "user-cust-req-3", displayName: "Elena R.", city: "Los Angeles" });
  db.vehicles.push({ id: "veh-req-3", customerId: "cust-req-3", year: 2016, make: "Honda", model: "Pilot", transmission: "automatic", mileage: 102000 });
  db.requests.push(
    req({
      id: "req-elena-pilot",
      customerId: "cust-req-3",
      vehicleId: "veh-req-3",
      repairCategory: "suspension",
      categorySource: "inferred",
      symptomDescription: "Clunk from the front right over bumps and sometimes when turning into the driveway.",
      occurrence: { conditions: ["Over bumps", "While turning"] },
      onset: { when: "few_weeks" },
      startsStatus: "normal",
      driveability: "normal",
      safeToDrive: "yes",
      warningLights: ["None"],
      sounds: { present: "yes", kinds: ["Knocking"] },
      location: { serviceMode: "mobile", area: "silver-lake", address: "(demo)", parkingType: "driveway", flatGround: "no", workSpace: "yes", repairsAllowed: "yes", notes: "Driveway has a slope; can move the car to the street." },
      urgency: "flexible",
      preferredTimes: "Next week",
      status: "booked",
      createdAt: "2026-09-19",
      matchedMechanicIds: ["mech-derek-hall"],
    }),
  );
  db.quotes.push({
    id: "quote-derek-pilot",
    requestId: "req-elena-pilot",
    mechanicId: "mech-derek-hall",
    laborCents: 22000,
    diagnosticFeeCents: 6000,
    travelFeeCents: 2500,
    partsIncluded: false,
    partsEstimateCents: 18000,
    durationHours: 2.5,
    availableOn: "Tue, Sep 30 · 10am",
    serviceMode: "mobile",
    scope: "Diagnose front-right clunk; replace sway bar end link and/or strut mount as found.",
    status: "accepted",
    createdAt: "2026-09-20",
    customerQuestions: [],
  });
  db.jobs.push({
    id: "job-elena-pilot",
    quoteId: "quote-derek-pilot",
    requestId: "req-elena-pilot",
    mechanicId: "mech-derek-hall",
    customerId: "cust-req-3",
    vehicleId: "veh-req-3",
    repairCategory: "suspension",
    title: "Front suspension clunk — end link / strut mount",
    status: "scheduled",
    scheduledFor: "Tue, Sep 30 · 10am",
  });

  // Seeded analytics so the dashboard has a baseline.
  db.profileShares["mech-derek-hall"] = 41;
  const views: Record<string, number> = { "mech-derek-hall": 612, "mech-rosa-delgado": 480, "mech-marcus-webb": 96 };
  for (const [mechanicId, n] of Object.entries(views)) {
    db.events.push({
      id: id("evt"),
      name: "profile_view",
      mechanicId,
      props: { seeded: true, count: n },
      createdAt: "2026-09-01",
    });
  }

  // Maya asked Anh for her CR-V specifically; Anh is booked up, so Clutch suggests who else could do it.
  db.requests.push(
    req({
      id: "req-maya-crv",
      customerId: "cust-maya",
      vehicleId: "veh-maya-crv",
      repairCategory: "alternators",
      categorySource: "customer",
      symptomDescription: "The battery light flickers on while driving and the headlights dim at idle. The battery is only a year old.",
      occurrence: { conditions: ["While driving", "At idle"] },
      onset: { when: "few_days" },
      startsStatus: "normal",
      driveability: "normal",
      safeToDrive: "unsure",
      warningLights: ["Battery"],
      location: { serviceMode: "mobile", area: "mid-city", parkingType: "driveway", flatGround: "yes", workSpace: "yes", repairsAllowed: "yes", accessAvailable: true },
      urgency: "this_week",
      status: "open",
      createdAt: "2026-09-25",
      matchedMechanicIds: ["mech-anh-tran"],
      requestedMechanicId: "mech-anh-tran",
      declinedBy: ["mech-anh-tran"],
      declines: [{ mechanicId: "mech-anh-tran", reason: "booked_up", at: "2026-09-25T15:20:00Z" }],
    }),
  );

  // Seeded notifications (role-aware: mode decides which app shows them).
  const n = (userId: string, mode: "customer" | "mechanic", kind: import("@/lib/domain/types").NotificationKind, title: string, href: string, createdAt: string, read = false, body?: string) =>
    db.notifications.push({ id: id("ntf"), userId, mode, kind, title, body, href, createdAt, read });
  n("user-maya", "customer", "mechanic_declined", "Anh Tran can't take your Honda request", "/customer/requests/req-maya-crv", "2026-09-25T15:20:00Z", false, "We've found other mechanics with strong verified experience for it. Send it on in one tap.");
  n("user-maya", "customer", "new_quote", "Derek Hall sent an estimate for your BMW 330i", "/customer/requests/req-maya-bmw", "2026-09-23T18:10:00Z");
  n("user-maya", "customer", "new_quote", "Marcus Webb sent an estimate for your BMW 330i", "/customer/requests/req-maya-bmw", "2026-09-24T09:40:00Z");
  n("user-maya", "customer", "mechanic_question", "Marcus Webb asked a question", "/customer/requests/req-maya-bmw", "2026-09-24T09:45:00Z", false, "Is the grinding only from the front, or from the back too?");
  n("user-maya", "customer", "new_quote", "Samuel Okafor sent an estimate for your BMW 330i", "/customer/requests/req-maya-bmw", "2026-09-24T16:20:00Z");
  n("user-derek-hall", "mechanic", "new_opportunity", "New job near you: 2008 BMW 135i no-start", "/mechanic/requests/req-chris-135i", "2026-09-25T08:05:00Z", false, "Matched on your BMW and starter experience.");
  n("user-derek-hall", "mechanic", "new_opportunity", "New job near you: 2018 Toyota Camry no-start", "/mechanic/requests/req-sofia-camry", "2026-09-25T07:30:00Z");
  n("user-derek-hall", "mechanic", "new_opportunity", "New job near you: 2015 BMW X3 brakes", "/mechanic/requests/req-jordan-x3", "2026-09-24T12:00:00Z", true);
  n("user-derek-hall", "mechanic", "new_review", "New verified review: 5 stars from Chris T.", "/mechanic/reputation", "2026-09-19T15:00:00Z", true);
  n("user-derek-hall", "mechanic", "job_reminder", "Tuesday 10am: Elena R.'s 2016 Honda Pilot", "/mechanic/jobs", "2026-09-25T06:00:00Z");
  n("user-derek-hall", "mechanic", "quote_viewed", "Maya C. viewed your estimate for the 2017 BMW 330i", "/mechanic/quotes", "2026-09-24T07:15:00Z", true);
  n("user-rosa-delgado", "mechanic", "verification_expiring", "Your ASE Master certification expires Sep 30", "/mechanic/verification", "2026-09-23T09:00:00Z", false, "Upload the renewed certificate so it stays verified on your profile.");

  // Structured configuration for demo cars, built by the same rules as the live
  // picker: only what each owner "selected", everything else likely or unconfirmed.
  const SPEC_SEED: Record<string, Partial<Selection>> = {
    "veh-maya-bmw": { transmission: "8AT" },
    "veh-derek-tacoma": { engine: "1GR-FE", transmission: "6MT" },
    "veh-maya-crv": { engine: "L15B7" },
    "veh-req-1": { trim: "xDrive28i" },
    "veh-req-2": { transmission: "8AT" },
    "veh-req-3": {},
    "veh-req-4": { transmission: "6MT" },
  };
  for (const v of db.vehicles) {
    if (!(v.id in SPEC_SEED)) continue;
    const configs = configsFor(v.year, v.make, v.model);
    if (configs.length) v.spec = buildSpec({ year: v.year, make: v.make, model: v.model, ...SPEC_SEED[v.id] }, configs);
  }
  for (const r of db.requests) r.vehicleSpec = db.vehicles.find((v) => v.id === r.vehicleId)?.spec;
  for (const j of db.jobs) j.vehicleSpec = db.vehicles.find((v) => v.id === j.vehicleId)?.spec;
  // A few of Derek's Clutch jobs recorded the car's configuration; older records didn't.
  const recorded: [string, RecordedSpec][] = [
    ["135i Convertible", { platform: "E88", engineCode: "N55", source: "mechanic_confirmed" }],
  ];
  for (const [model, spec] of recorded) {
    const rec = db.pastRepairs.find((r) => r.mechanicId === "mech-derek-hall" && r.model === model);
    if (rec) rec.spec = spec;
  }
  for (const rec of db.pastRepairs.filter((r) => r.mechanicId === "mech-derek-hall" && r.source === "platform" && r.make === "BMW")) {
    if (rec.model === "328i" && rec.year === 2014) rec.spec = { platform: "F30", engineCode: "N20", transmissionType: "automatic", source: "selected" };
    if (rec.model === "330i" && rec.year === 2017) rec.spec = { platform: "F30", engineCode: "B46", transmissionType: "automatic", source: "selected" };
  }

  // Demo photos (supplied for the demo, labelled as such; never shown as verified evidence).
  const demoRepair = db.pastRepairs.find((r) => r.mechanicId === "mech-derek-hall" && r.model === "135i Convertible");
  if (demoRepair)
    demoRepair.photos = [
      { id: "demo-derek-135i-1", url: "/repairs/derek-135i-driveway.webp", kind: "on_site", source: "mechanic", media: "image", demo: true, caption: "On the job in the customer's driveway", uploadedAt: "2026-07-02" },
      { id: "demo-derek-135i-2", url: "/repairs/derek-135i-engine-bay.webp", kind: "on_site", source: "mechanic", media: "image", demo: true, caption: "Working under the hood", uploadedAt: "2026-07-02" },
    ];

  return db;
}

/** Fills the list fields a seeded request doesn't need to spell out. */
function req(r: Omit<RepairRequest, "warningLights" | "diagnosticCodes" | "smells" | "recentRepairs" | "customerParts" | "media" | "declinedBy" | "questions" | "interested"> & Partial<RepairRequest>): RepairRequest {
  return {
    warningLights: [],
    diagnosticCodes: [],
    smells: [],
    recentRepairs: [],
    customerParts: [],
    media: [],
    declinedBy: [],
    questions: [],
    interested: [],
    ...r,
  };
}

/** Demo attachments have metadata only (no file bytes), so they preview as labelled tiles. */
function demoMedia(id: string, kind: RepairMedia["kind"], tag: RepairMedia["tag"], name: string): RepairMedia {
  return { id, kind, tag, name, contentType: "", size: 0, uploadedAt: "2026-09-23" };
}

function addDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(date: string, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
