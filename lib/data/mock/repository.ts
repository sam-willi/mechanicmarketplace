import { toPublicProfile, type ProfileSources } from "@/lib/domain/public-profile";
import { eligibility } from "@/lib/domain/eligibility";
import { confirmSpec, toRecorded } from "@/lib/vehicles/record";
import { CATEGORY_LABEL, REPAIR_LABEL } from "@/lib/domain/provenance";
import type { IntakeDraft } from "@/lib/domain/intake-draft";
import { customerRelationships, relevanceKey } from "@/lib/domain/reputation";
import type {
  AnalyticsEventName,
  AppMode,
  NotificationKind,
  User,
  CustomerConfirmation,
  ID,
  Job,
  PastRepair,
  Quote,
  RepairMedia,
  RepairPhoto,
  SupportReport,
  RepairRequest,
  ScreeningKind,
  Vehicle,
  VerificationRecord,
  DeclineReason,
} from "@/lib/domain/types";
import { getProviderByKey, getScreeningProvider } from "@/lib/verification/providers/registry";
import { today } from "@/lib/verification/lifecycle";
import { findArea, serves } from "@/lib/domain/areas";

/** How many qualified mechanics a posted request reaches. Small on purpose: no auction. */
const MATCH_LIMIT = 4;
import type { RepositoryCore } from "../repository";
import { current as db } from "../store";

let counter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}`;
const nowISO = () => new Date().toISOString();

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class MockRepository implements RepositoryCore {
  // ---------------------------------------------------------------- public
  listPublicProfiles() {
    return db().mechanics.map((m) => toPublicProfile(this.getMechanicSources(m.id)));
  }

  getPublicProfile(slug: string) {
    const m = this.getMechanicBySlug(slug);
    return m ? toPublicProfile(this.getMechanicSources(m.id)) : null;
  }

  // --------------------------------------------------------------- private
  getUser(id: ID) {
    return db().users.find((u) => u.id === id);
  }
  getMechanic(id: ID) {
    return db().mechanics.find((m) => m.id === id);
  }
  getMechanicByPhotoUrl(url: string) {
    return db().mechanics.find((m) => m.photoUrl === url);
  }
  getMechanicBySlug(slug: string) {
    return db().mechanics.find((m) => m.slug === slug);
  }

  getMechanicSources(mechanicId: ID): ProfileSources {
    const d = db();
    const mechanic = this.getMechanic(mechanicId)!;
    return {
      mechanic,
      screenings: d.screenings.filter((s) => s.mechanicId === mechanicId),
      insurance: d.insurance.filter((s) => s.mechanicId === mechanicId),
      credentials: d.credentials.filter((s) => s.mechanicId === mechanicId),
      employment: d.employment.filter((s) => s.mechanicId === mechanicId),
      pastRepairs: d.pastRepairs.filter((s) => s.mechanicId === mechanicId),
      reviews: d.reviews.filter((s) => s.mechanicId === mechanicId),
      verifications: d.verifications.filter((s) => s.mechanicId === mechanicId),
    };
  }

  listVerifications(filter?: { mechanicId?: ID; statuses?: VerificationRecord["status"][] }) {
    return db()
      .verifications.filter((v) => !filter?.mechanicId || v.mechanicId === filter.mechanicId)
      .filter((v) => !filter?.statuses || filter.statuses.includes(v.status))
      .sort((a, b) => ((a.submittedAt ?? "") < (b.submittedAt ?? "") ? 1 : -1));
  }

  getVerification(id: ID) {
    return db().verifications.find((v) => v.id === id);
  }

  describeSubject(v: VerificationRecord) {
    const d = db();
    switch (v.subjectType) {
      case "screening_check": {
        const s = d.screenings.find((x) => x.id === v.subjectId);
        return {
          title: CATEGORY_LABEL[v.category],
          detail: [
            `Provider: ${s?.provider ?? "—"} (ref ${s?.providerRef ?? "—"})`,
            s?.consentAt ? `FCRA consent recorded ${s.consentAt}` : "",
            s?.result ? `Provider result: ${s.result}` : "Result not yet returned",
          ].filter(Boolean),
        };
      }
      case "insurance_record": {
        const i = d.insurance.find((x) => x.id === v.subjectId);
        return {
          title: `Insurance — ${i?.carrier ?? ""}`,
          detail: i
            ? [`Policy ending ${i.policyLast4}`, `Effective ${i.effectiveOn} → ${i.expiresOn}`, `Document: ${i.documentName}`]
            : [],
        };
      }
      case "credential": {
        const c = d.credentials.find((x) => x.id === v.subjectId);
        return {
          title: c ? `${c.issuer} ${c.code ? c.code + " · " : ""}${c.name}` : "Credential",
          detail: c
            ? [c.issuedOn ? `Issued ${c.issuedOn}` : "", c.expiresOn ? `Expires ${c.expiresOn}` : "No expiry", c.documentName ? `Document: ${c.documentName}` : ""].filter(Boolean)
            : [],
        };
      }
      case "employment": {
        const e = d.employment.find((x) => x.id === v.subjectId);
        return {
          title: e ? `${e.position}, ${e.employer}` : "Employment",
          detail: e ? [`${e.startedOn} → ${e.endedOn ?? "present"}`, e.documentName ? `Document: ${e.documentName}` : "No document"] : [],
        };
      }
      case "past_repair": {
        const r = d.pastRepairs.find((x) => x.id === v.subjectId);
        const conf = d.confirmations.find((c) => c.pastRepairId === v.subjectId);
        return {
          title: r ? `${r.year} ${r.make} ${r.model} — ${r.title}` : "Past repair",
          detail: [
            r ? `Performed ${r.performedOn}` : "",
            r?.evidence.length ? `Evidence: ${r.evidence.map((e) => e.name).join(", ")}` : "No files attached",
            conf ? `Confirmation sent to ${conf.contactName} (${conf.contact}) on ${conf.sentAt}${conf.response ? ` — ${conf.response}` : " — awaiting reply"}` : "",
          ].filter(Boolean),
        };
      }
    }
  }

  getConfirmationByToken(token: string) {
    const d = db();
    const confirmation = d.confirmations.find((c) => c.token === token);
    if (!confirmation) return null;
    const repair = d.pastRepairs.find((r) => r.id === confirmation.pastRepairId)!;
    const mechanic = this.getMechanic(confirmation.mechanicId)!;
    return { confirmation, repair, mechanic };
  }

  listConfirmations(mechanicId: ID) {
    return db().confirmations.filter((c) => c.mechanicId === mechanicId);
  }

  getCustomer(id: ID) {
    return db().customers.find((c) => c.id === id);
  }
  listVehicles(customerId: ID) {
    return db().vehicles.filter((v) => v.customerId === customerId);
  }
  getVehicle(id: ID) {
    return db().vehicles.find((v) => v.id === id);
  }
  listRequestsForCustomer(customerId: ID) {
    return db()
      .requests.filter((r) => r.customerId === customerId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  listRequestsForMechanic(mechanicId: ID) {
    return db()
      .requests.filter((r) => r.matchedMechanicIds.includes(mechanicId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  getRequest(id: ID) {
    return db().requests.find((r) => r.id === id);
  }
  listQuotesForRequest(requestId: ID) {
    return db().quotes.filter((q) => q.requestId === requestId);
  }
  listQuotesForMechanic(mechanicId: ID) {
    return db().quotes.filter((q) => q.mechanicId === mechanicId);
  }
  getQuote(id: ID) {
    return db().quotes.find((q) => q.id === id);
  }
  listJobsForMechanic(mechanicId: ID) {
    return db().jobs.filter((j) => j.mechanicId === mechanicId);
  }
  listJobsForCustomer(customerId: ID) {
    return db().jobs.filter((j) => j.customerId === customerId);
  }
  getJob(id: ID) {
    return db().jobs.find((j) => j.id === id);
  }
  getReviewForJob(jobId: ID) {
    return db().reviews.find((r) => r.jobId === jobId);
  }
  listCustomerHistory(customerId: ID) {
    return db()
      .pastRepairs.filter((r) => r.customerId === customerId && r.source === "platform")
      .sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  }
  listSaved(customerId: ID) {
    return db()
      .saved.filter((s) => s.customerId === customerId)
      .map((s) => s.mechanicId);
  }

  listMechanicCustomers(mechanicId: ID) {
    const rels = customerRelationships(db().pastRepairs.filter((r) => r.mechanicId === mechanicId));
    return rels
      .map((r) => ({ customer: this.getCustomer(r.customerId)!, jobs: r.jobs, isRepeat: r.isRepeat }))
      .filter((r) => r.customer)
      .sort((a, b) => (a.jobs[0].performedOn < b.jobs[0].performedOn ? 1 : -1));
  }

  analyticsSummary(mechanicId: ID) {
    const d = db();
    const names: AnalyticsEventName[] = [
      "profile_view",
      "profile_share",
      "verification_badge_clicked",
      "repair_request_started",
      "repair_request_completed",
      "quote_requested",
      "quote_viewed",
      "mechanic_selected",
      "repeat_booking",
      "review_submitted",
    ];
    const out = Object.fromEntries(names.map((n) => [n, 0])) as Record<AnalyticsEventName | "profile_view_total", number>;
    for (const e of d.events.filter((e) => e.mechanicId === mechanicId)) {
      out[e.name] += typeof e.props.count === "number" ? e.props.count : 1;
    }
    out.profile_share += d.profileShares[mechanicId] ?? 0;
    out.profile_view_total = out.profile_view;
    return out;
  }

  listEvents(limit = 50) {
    return [...db().events].reverse().slice(0, limit);
  }

  // ---------------------------------------------------------- mechanic writes
  upsertMechanicProfile(input: Parameters<RepositoryCore["upsertMechanicProfile"]>[0]) {
    const d = db();
    const existing = input.id ? this.getMechanic(input.id) : undefined;
    if (existing) {
      Object.assign(existing, {
        displayName: input.displayName,
        firstName: input.displayName.split(" ")[0],
        ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
        city: input.city,
        neighborhood: input.neighborhood,
        serviceRadiusMi: input.serviceRadiusMi,
        bio: input.bio,
        workModel: input.workModel,
        shopName: input.shopName,
        declaredRepairCategories: input.declaredRepairCategories,
        declaredMakes: input.declaredMakes,
        hourlyRateCents: input.hourlyRateCents,
        diagnosticFeeCents: input.diagnosticFeeCents,
        travelFeeCents: input.travelFeeCents,
        availabilityNote: input.availabilityNote ?? existing.availabilityNote,
      });
      return existing;
    }
    let slug = slugify(input.displayName);
    while (this.getMechanicBySlug(slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`;
    const id = `mech-${slug}`;
    // Attach to the signed-in account if there is one: one login, two roles.
    let userId = input.userId;
    const existingUser = userId ? this.getUser(userId) : undefined;
    if (existingUser) {
      if (!existingUser.roles.includes("mechanic")) existingUser.roles.push("mechanic");
    } else {
      userId = `user-${slug}`;
      d.users.push({ id: userId, roles: ["mechanic"], email: `${slug}@clutch.demo`, name: input.displayName, notificationPrefs: { email: true, sms: true, push: true }, createdAt: today() });
    }
    const m = {
      id,
      userId: userId!,
      slug,
      displayName: input.displayName,
      firstName: input.displayName.split(" ")[0],
      photoUrl: input.photoUrl ?? "",
      city: input.city,
      neighborhood: input.neighborhood,
      serviceRadiusMi: input.serviceRadiusMi,
      bio: input.bio,
      workModel: input.workModel,
      shopName: input.shopName,
      hourlyRateCents: input.hourlyRateCents,
      diagnosticFeeCents: input.diagnosticFeeCents,
      travelFeeCents: input.travelFeeCents,
      fixedPrices: [],
      availabilityNote: input.availabilityNote ?? "",
      nextAvailable: "Ask for availability",
      nextAvailableOn: today(),
      declaredRepairCategories: input.declaredRepairCategories,
      declaredMakes: input.declaredMakes,
      selfReportedClaims: [],
      joinedAt: today(),
      lat: 34.05,
      lng: -118.25,
      isDemo: true as const,
    };
    d.mechanics.push(m);
    return m;
  }

  updatePricing(mechanicId: ID, input: Parameters<RepositoryCore["updatePricing"]>[1]) {
    const m = this.getMechanic(mechanicId);
    if (!m) return;
    m.hourlyRateCents = input.hourlyRateCents;
    m.diagnosticFeeCents = input.diagnosticFeeCents;
    m.travelFeeCents = input.travelFeeCents;
    m.fixedPrices = input.fixed.map((f) => ({ ...f, id: f.id ?? newId("fp") }));
  }

  async startScreening(mechanicId: ID, kind: ScreeningKind, consent: boolean) {
    if (kind !== "identity" && !consent) throw new Error("FCRA disclosure consent is required before a background or driving record check.");
    const d = db();
    const provider = getScreeningProvider(kind);
    const started = await provider.startCheck({ mechanicId, kind, consentAt: consent ? nowISO() : undefined });
    const sc = {
      id: newId("scr"),
      mechanicId,
      kind,
      provider: started.provider,
      providerRef: started.providerRef,
      status: started.status,
      consentAt: consent ? today() : undefined,
    };
    d.screenings.push(sc);
    d.verifications.push({
      id: newId("ver"),
      mechanicId,
      subjectType: "screening_check",
      subjectId: sc.id,
      category: kind,
      method: "vendor_screening",
      provider: started.provider,
      status: "pending",
      submittedAt: today(),
      notes: "Submitted to screening provider.",
      evidenceSummary:
        kind === "identity"
          ? "Government ID + live selfie captured by screening provider"
          : kind === "background"
            ? "FCRA disclosure signed; criminal + sex offender registry search"
            : "Motor vehicle record request",
    });
  }

  async refreshScreening(mechanicId: ID, kind: ScreeningKind) {
    const d = db();
    const sc = d.screenings.filter((s) => s.mechanicId === mechanicId && s.kind === kind && s.status === "pending").at(-1);
    if (!sc) return;
    const res = await getProviderByKey(sc.provider).getResult(sc.providerRef);
    sc.status = res.status;
    sc.result = res.result;
    sc.completedAt = res.completedAt;
    sc.expiresAt = res.expiresAt;
    const v = d.verifications.find((x) => x.subjectId === sc.id);
    if (v) {
      v.status = res.status;
      v.verifiedAt = res.completedAt;
      v.expiresAt = res.expiresAt;
      v.notes = res.result === "clear" ? "Provider returned clear." : `Provider returned ${res.result}.`;
    }
  }

  submitCredential(mechanicId: ID, input: Parameters<RepositoryCore["submitCredential"]>[1]) {
    const d = db();
    const cred = { ...input, id: newId("cred"), mechanicId };
    d.credentials.push(cred);
    d.verifications.push({
      id: newId("ver"),
      mechanicId,
      subjectType: "credential",
      subjectId: cred.id,
      category: "credential",
      method: input.issuer === "ASE" || input.issuer === "EPA" ? "institution_check" : "document_review",
      status: "pending",
      submittedAt: today(),
      expiresAt: input.expiresOn,
      evidenceSummary: `${input.issuer} ${input.code ? input.code + " " : ""}${input.name}${input.documentName ? ` — ${input.documentName}` : ""}`,
    });
  }

  submitEmployment(mechanicId: ID, input: Parameters<RepositoryCore["submitEmployment"]>[1]) {
    const d = db();
    const emp = { ...input, id: newId("emp"), mechanicId };
    d.employment.push(emp);
    d.verifications.push({
      id: newId("ver"),
      mechanicId,
      subjectType: "employment",
      subjectId: emp.id,
      category: "employment",
      method: "employer_check",
      status: "pending",
      submittedAt: today(),
      evidenceSummary: `${input.position} at ${input.employer}${input.documentName ? ` — ${input.documentName}` : ""}`,
    });
  }

  submitInsurance(mechanicId: ID, input: { carrier: string; expiresOn: string; documentName: string }) {
    const d = db();
    const rec = {
      id: newId("ins"),
      mechanicId,
      carrier: input.carrier,
      policyLast4: "••••",
      coverageCents: 0,
      documentName: input.documentName,
      effectiveOn: today(),
      expiresOn: input.expiresOn,
    };
    d.insurance.push(rec);
    d.verifications.push({
      id: newId("ver"),
      mechanicId,
      subjectType: "insurance_record",
      subjectId: rec.id,
      category: "insurance",
      method: "document_review",
      status: "pending",
      submittedAt: today(),
      expiresAt: input.expiresOn,
      evidenceSummary: `Certificate of insurance, ${input.carrier} — ${input.documentName}`,
    });
  }

  resubmit(verificationId: ID, note: string) {
    const v = this.getVerification(verificationId);
    if (!v) return;
    v.status = "pending";
    v.submittedAt = today();
    v.notes = note ? `Mechanic: ${note}` : "Resubmitted by mechanic.";
  }

  addPastRepair(mechanicId: ID, input: Parameters<RepositoryCore["addPastRepair"]>[1]) {
    const { evidenceNames, ...rest } = input;
    const r: PastRepair = {
      ...rest,
      id: newId("rep"),
      mechanicId,
      source: "self",
      evidence: evidenceNames.filter(Boolean).map((name) => ({ kind: /\.(pdf)$/i.test(name) ? "invoice" : "photo", name })),
    };
    db().pastRepairs.push(r);
    return r;
  }

  requestCustomerConfirmation(pastRepairId: ID, contactName: string, contact: string) {
    const d = db();
    const repair = d.pastRepairs.find((r) => r.id === pastRepairId)!;
    const conf: CustomerConfirmation = {
      id: newId("conf"),
      pastRepairId,
      mechanicId: repair.mechanicId,
      token: Math.random().toString(36).slice(2, 10),
      contact,
      contactName,
      sentAt: today(),
    };
    d.confirmations.push(conf);
    const existing = d.verifications.find((v) => v.subjectId === pastRepairId);
    if (existing) {
      existing.status = "pending";
      existing.method = "customer_confirmation";
      existing.submittedAt = today();
    } else {
      d.verifications.push({
        id: newId("ver"),
        mechanicId: repair.mechanicId,
        subjectType: "past_repair",
        subjectId: pastRepairId,
        category: "past_repair",
        method: "customer_confirmation",
        status: "pending",
        submittedAt: today(),
        notes: "Confirmation link sent to prior customer.",
        evidenceSummary: `${repair.year} ${repair.make} ${repair.model} — ${repair.title}`,
      });
    }
    return conf;
  }

  respondToConfirmation(token: string, response: "confirmed" | "denied") {
    const d = db();
    const conf = d.confirmations.find((c) => c.token === token);
    if (!conf || conf.response) return;
    conf.response = response;
    conf.respondedAt = today();
    const repair = d.pastRepairs.find((r) => r.id === conf.pastRepairId)!;
    const v = d.verifications.find((x) => x.subjectId === repair.id);
    if (response === "confirmed") {
      repair.source = "customer_confirmed";
      if (v) Object.assign(v, { status: "verified", verifiedAt: today(), notes: `Confirmed by ${conf.contactName} via private link.` });
    } else if (v) {
      Object.assign(v, { status: "rejected", notes: `${conf.contactName} said they did not recognise this repair.` });
    }
  }

  declineRequest(requestId: ID, mechanicId: ID, reason?: DeclineReason) {
    const r = this.getRequest(requestId);
    if (!r || r.declinedBy.includes(mechanicId)) return;
    r.declinedBy.push(mechanicId);
    r.declines = [...(r.declines ?? []), { mechanicId, reason, at: nowISO() }];
    // The customer is told when the mechanic they picked passes, or when everyone it went to has.
    const picked = r.requestedMechanicId === mechanicId;
    const nobodyLeft = r.matchedMechanicIds.every((mid) => r.declinedBy.includes(mid)) && !this.listQuotesForRequest(r.id).some((q) => q.status === "submitted");
    if (picked || nobodyLeft) {
      const v = this.getVehicle(r.vehicleId);
      this.notifyCustomer(
        r.customerId,
        "mechanic_declined",
        picked ? `${this.getMechanic(mechanicId)?.displayName} can't take your ${v?.make ?? ""} request`.replace("  ", " ") : `No one has taken your ${v?.make ?? ""} request yet`.replace("  ", " "),
        `/customer/requests/${r.id}`,
        "We've found other mechanics with strong verified experience for it. Send it on in one tap.",
      );
    }
  }

  forwardRequest(requestId: ID, mechanicIds: ID[], kind: "replacement" | "broaden") {
    const r = this.getRequest(requestId);
    if (!r) return;
    const fresh = mechanicIds.filter((mid) => !r.matchedMechanicIds.includes(mid) && !r.declinedBy.includes(mid));
    if (!fresh.length) return;
    r.matchedMechanicIds.push(...fresh);
    r.handoffs = [...(r.handoffs ?? []), { to: fresh, at: nowISO(), kind }];
    // A one-mechanic replacement is the customer's new pick.
    if (kind === "replacement" && fresh.length === 1) r.requestedMechanicId = fresh[0];
    if (r.status === "cancelled") r.status = "open";
    const v = this.getVehicle(r.vehicleId);
    // The new mechanic sees a new request; never who passed on it.
    for (const mid of fresh) this.notifyMechanic(mid, "new_opportunity", `New job near you: ${v?.year} ${v?.make} ${v?.model}`, `/mechanic/requests/${r.id}`);
  }

  askQuestion(requestId: ID, mechanicId: ID, question: string) {
    const r = this.getRequest(requestId);
    if (!r) return;
    r.questions.push({ mechanicId, customerId: r.customerId, question, askedAt: today(), attachments: [] });
    this.notifyCustomer(r.customerId, "mechanic_question", `${this.getMechanic(mechanicId)?.displayName} asked a question`, `/customer/requests/${r.id}`, question);
  }

  markInterested(requestId: ID, mechanicId: ID, note?: string) {
    const r = this.getRequest(requestId);
    if (!r || r.interested.some((i) => i.mechanicId === mechanicId)) return;
    r.interested.push({ mechanicId, note: note?.trim() || undefined, at: today() });
    this.notifyCustomer(r.customerId, "mechanic_interested", `${this.getMechanic(mechanicId)?.displayName} is interested in your request`, `/customer/requests/${r.id}`, note);
  }

  submitQuote(input: Parameters<RepositoryCore["submitQuote"]>[0], opts: { draft?: boolean } = {}) {
    const d = db();
    const prev = d.quotes.find((x) => x.requestId === input.requestId && x.mechanicId === input.mechanicId);
    const q: Quote = { ...input, id: prev?.id ?? newId("quote"), status: opts.draft ? "draft" : "submitted", createdAt: today(), customerQuestions: prev?.customerQuestions ?? [] };
    d.quotes = d.quotes.filter((x) => x !== prev);
    d.quotes.push(q);
    const r = this.getRequest(input.requestId);
    if (!opts.draft && r) {
      if (r.status === "open") r.status = "quoted";
      const m = this.getMechanic(input.mechanicId);
      const v = this.getVehicle(r.vehicleId);
      this.notifyCustomer(
        r.customerId,
        prev && prev.status !== "draft" ? "quote_updated" : "new_quote",
        `${m?.displayName} ${prev && prev.status !== "draft" ? "updated their estimate" : "sent an estimate"} for your ${v?.make} ${v?.model}`,
        `/customer/requests/${r.id}`,
      );
    }
    return q;
  }

  // ----------------------------------------------------------------- jobs
  startJob(jobId: ID) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "scheduled") return;
    job.status = "in_progress";
    job.startedAt = today();
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "mechanic_checked_in", `${m?.firstName} checked in and started the repair`, `/customer/jobs/${job.id}`);
  }

  recordDiagnosis(jobId: ID, note: string, matchesEstimate: boolean) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "in_progress") return;
    job.diagnosis = { note: note.slice(0, 2000), matchesEstimate, at: nowISO() };
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(
      job.customerId,
      "diagnosis_shared",
      matchesEstimate ? `${m?.firstName} confirmed the diagnosis matches the estimate` : `${m?.firstName} found something different`,
      `/customer/jobs/${job.id}`,
      note.slice(0, 160),
    );
  }

  requestScopeChange(jobId: ID, description: string, extraCents: number) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "in_progress" || job.scopeChange?.status === "pending") return;
    job.scopeChange = { description: description.slice(0, 2000), extraCents: Math.max(0, Math.round(extraCents)), status: "pending", requestedAt: nowISO() };
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "scope_change_requested", `${m?.firstName} needs your approval for extra work`, `/customer/jobs/${job.id}`, description.slice(0, 160));
  }

  respondScopeChange(jobId: ID, approve: boolean) {
    const job = this.getJob(jobId);
    if (!job?.scopeChange || job.scopeChange.status !== "pending") return;
    job.scopeChange.status = approve ? "approved" : "declined";
    job.scopeChange.respondedAt = nowISO();
    this.notifyMechanic(job.mechanicId, "scope_change_answered", `${this.getCustomer(job.customerId)?.displayName} ${approve ? "approved" : "declined"} the extra work`, `/mechanic/jobs/${job.id}`);
  }

  /** Mechanic marks the work done. The customer then confirms; only that creates verified history. */
  markJobDone(jobId: ID, finalAmountCents: number | undefined, notes?: string, confirm?: { engine?: string; transmission?: string; drivetrain?: string }) {
    const job = this.getJob(jobId);
    if (!job || (job.status !== "scheduled" && job.status !== "in_progress")) return;
    if (job.scopeChange?.status === "pending") return;
    // The mechanic has seen the car: open configuration questions can be settled now.
    if (confirm && job.vehicleSpec && (confirm.engine || confirm.transmission || confirm.drivetrain)) {
      job.vehicleSpec = confirmSpec(job.vehicleSpec, confirm);
      const veh = this.getVehicle(job.vehicleId);
      if (veh) veh.spec = veh.spec ? confirmSpec(veh.spec, confirm) : job.vehicleSpec;
    }
    job.status = "awaiting_customer";
    job.mechanicCompletedAt = today();
    job.finalAmountCents = finalAmountCents;
    job.completionNotes = notes;
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "repair_completed", `${m?.displayName} marked your repair complete`, `/customer/jobs/${job.id}`, "Confirm the work is done to add it to their verified record.");
  }

  cancelJob(jobId: ID, by: "customer" | "mechanic", reason?: DeclineReason) {
    const job = this.getJob(jobId);
    if (!job || job.status === "completed" || job.status === "cancelled") return;
    job.status = "cancelled";
    job.cancelledAt = today();
    job.cancelledBy = by;
    const req = this.getRequest(job.requestId);
    if (by === "customer") {
      if (req) req.status = "cancelled";
      this.notifyMechanic(job.mechanicId, "job_reminder", `A customer cancelled: ${job.title}`, `/mechanic/jobs/${job.id}`);
      return;
    }
    // The mechanic backed out: the customer still needs the repair. Reopen the request, and
    // the estimates they passed over only because they booked this one (if still valid).
    if (!req) return;
    const q = this.getQuote(job.quoteId);
    if (q) q.status = "withdrawn";
    if (!req.declinedBy.includes(job.mechanicId)) req.declinedBy.push(job.mechanicId);
    req.declines = [...(req.declines ?? []), { mechanicId: job.mechanicId, reason, at: nowISO(), cancelledJob: true }];
    const reopened = this.listQuotesForRequest(req.id).filter(
      (x) =>
        x.status === "declined" &&
        x.closedReason === "chose_other" &&
        (!x.expiresOn || x.expiresOn >= today()) &&
        eligibility(toPublicProfile(this.getMechanicSources(x.mechanicId))).eligible,
    );
    for (const x of reopened) {
      x.status = "submitted";
      x.closedReason = undefined;
      this.notifyMechanic(x.mechanicId, "quote_updated", "An estimate you sent is open again", `/mechanic/requests/${req.id}`, "The customer's booking fell through. They may take you up on it.");
    }
    req.status = reopened.length ? "quoted" : "open";
    this.notifyCustomer(
      job.customerId,
      "mechanic_declined",
      `${this.getMechanic(job.mechanicId)?.displayName} cancelled your booking`,
      `/customer/requests/${req.id}`,
      reopened.length ? "Your other estimates are open again, and we've found more mechanics who could do it." : "We've found other mechanics with strong verified experience for it.",
    );
  }

  confirmAppointment(jobId: ID) {
    const job = this.getJob(jobId);
    if (!job || job.status !== "scheduled" || job.confirmedAt) return;
    job.confirmedAt = nowISO();
    const m = this.getMechanic(job.mechanicId);
    this.notifyCustomer(job.customerId, "appointment_confirmed", `${m?.firstName} is confirmed for ${job.scheduledFor}`, `/customer/jobs/${job.id}`);
  }

  addJobPhotos(jobId: ID, photos: RepairPhoto[]) {
    const job = this.getJob(jobId);
    if (job) job.photos = [...(job.photos ?? []), ...photos];
  }

  addRepairPhotos(pastRepairId: ID, photos: RepairPhoto[]) {
    const r = db().pastRepairs.find((x) => x.id === pastRepairId);
    if (r) r.photos = [...(r.photos ?? []), ...photos];
  }

  markQuoteViewed(quoteId: ID) {
    const q = this.getQuote(quoteId);
    if (!q || q.viewedAt || q.status === "draft") return;
    q.viewedAt = nowISO();
    const r = this.getRequest(q.requestId);
    const v = r ? this.getVehicle(r.vehicleId) : undefined;
    this.notifyMechanic(q.mechanicId, "quote_viewed", `Your estimate for the ${v?.year} ${v?.make} ${v?.model} was viewed`, `/mechanic/quotes`);
  }

  declineQuote(quoteId: ID) {
    const q = this.getQuote(quoteId);
    if (!q || q.status !== "submitted") return;
    q.status = "declined";
    q.closedReason = "customer_declined";
    this.notifyMechanic(q.mechanicId, "quote_updated", "A customer went with a different option", `/mechanic/quotes?tab=closed`);
  }

  findJobWithPhoto(mediaId: ID) {
    return db().jobs.find((j) => j.photos?.some((p) => p.id === mediaId));
  }

  findRepairWithPhoto(mediaId: ID) {
    return db().pastRepairs.find((r) => r.photos?.some((p) => p.id === mediaId));
  }

  createSupportReport(input: Omit<SupportReport, "id" | "createdAt" | "status">) {
    const rep: SupportReport = { ...input, id: newId("sup"), createdAt: nowISO(), status: "open" };
    db().supportReports.push(rep);
    return rep;
  }

  listSupportReports(filter?: { userId?: ID }) {
    return db()
      .supportReports.filter((r) => !filter?.userId || r.userId === filter.userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  setJobNotes(jobId: ID, notes: string) {
    const job = this.getJob(jobId);
    if (job) job.mechanicNotes = notes;
  }

  completeJob(jobId: ID) {
    const d = db();
    const job = this.getJob(jobId);
    if (!job || job.status === "completed") return;
    job.status = "completed";
    job.completedAt = today();
    this.notifyCustomer(job.customerId, "review_requested", `How did ${this.getMechanic(job.mechanicId)?.firstName} do?`, `/customer/jobs/${job.id}`, "Leave a verified review.");
    this.notifyMechanic(job.mechanicId, "quote_accepted", `Customer confirmed: ${job.title}`, `/mechanic/reputation`, "Added to your verified record.");
    const quote = this.getQuote(job.quoteId);
    const v = this.getVehicle(job.vehicleId)!;
    const repair: PastRepair = {
      id: newId("rep"),
      mechanicId: job.mechanicId,
      source: "platform",
      jobId: job.id,
      year: v.year,
      make: v.make,
      model: v.model,
      repairCategory: job.repairCategory,
      title: job.title,
      performedOn: today(),
      customerId: job.customerId,
      evidence: [{ kind: "invoice", name: "clutch-estimate.pdf" }],
      valueCents: job.finalAmountCents ?? (quote ? quote.laborCents + quote.diagnosticFeeCents + quote.travelFeeCents : undefined),
      photos: (job.photos ?? []).map((p) => ({ ...p, source: "job" as const })),
      mileage: v.mileage,
      spec: toRecorded(job.vehicleSpec),
    };
    d.pastRepairs.push(repair);
    d.verifications.push({
      id: newId("ver"),
      mechanicId: job.mechanicId,
      subjectType: "past_repair",
      subjectId: repair.id,
      category: "past_repair",
      method: "platform_job",
      status: "verified",
      submittedAt: today(),
      verifiedAt: today(),
      notes: "Completed through Clutch.",
      evidenceSummary: `${v.year} ${v.make} ${v.model} — ${job.title}`,
    });
    const req = this.getRequest(job.requestId);
    if (req) req.status = "completed";
  }

  // ------------------------------------------------------------- admin writes
  decideVerification(id: ID, decision: "verified" | "rejected" | "needs_info", reviewerId: ID, notes: string, expiresAt?: string) {
    const d = db();
    const v = this.getVerification(id);
    if (!v) return;
    this.notifyMechanic(
      v.mechanicId,
      "verification_update",
      `${CATEGORY_LABEL[v.category]}: ${decision === "verified" ? "verified" : decision === "rejected" ? "not approved" : "more information needed"}`,
      "/mechanic/verification",
      notes || undefined,
    );
    v.status = decision;
    v.reviewerId = reviewerId;
    v.notes = notes || v.notes;
    if (decision === "verified") {
      v.verifiedAt = today();
      if (expiresAt) v.expiresAt = expiresAt;
      if (v.subjectType === "screening_check") {
        const sc = d.screenings.find((s) => s.id === v.subjectId);
        if (sc) Object.assign(sc, { status: "verified", completedAt: today(), expiresAt: expiresAt ?? sc.expiresAt });
      }
      if (v.subjectType === "past_repair") {
        const r = d.pastRepairs.find((x) => x.id === v.subjectId);
        // Staff review of an invoice makes a prior repair Document verified; only a
        // customer's own confirmation makes it Customer verified.
        if (r && r.source === "self") r.source = v.method === "customer_confirmation" ? "customer_confirmed" : "document";
      }
    }
  }

  // ---------------------------------------------------------- customer writes
  createRequest(input: Parameters<RepositoryCore["createRequest"]>[0]) {
    const d = db();
    const { vehicle, directTo, ...rest } = input;
    let vehicleId = rest.vehicleId;
    if (vehicle) {
      vehicleId = newId("veh");
      d.vehicles.push({ ...vehicle, id: vehicleId, customerId: rest.customerId });
    }
    const v = d.vehicles.find((x) => x.id === vehicleId)!;
    let matched: ID[];
    if (directTo) matched = [directTo];
    else if (rest.rebookOf) matched = [rest.rebookOf];
    else matched = this.qualifiedMechanics(rest.repairCategory, v.make, rest.location.area, rest.location.serviceMode === "mobile").slice(0, MATCH_LIMIT);
    const req: RepairRequest = {
      ...rest,
      vehicleId,
      vehicleSpec: rest.vehicleSpec ?? v.spec,
      id: newId("req"),
      status: "open",
      createdAt: today(),
      matchedMechanicIds: matched,
      requestedMechanicId: directTo ?? rest.rebookOf,
      declinedBy: [],
      questions: [],
      interested: [],
    };
    d.requests.push(req);
    for (const mid of matched) {
      this.notifyMechanic(
        mid,
        rest.rebookOf ? "customer_rebooked" : "new_opportunity",
        rest.rebookOf ? `${this.getCustomer(rest.customerId)?.displayName} wants to book you again` : `New job near you: ${v.year} ${v.make} ${v.model}`,
        `/mechanic/requests/${req.id}`,
      );
    }
    return req;
  }

  /**
   * Qualified = can be booked under the shared eligibility rules (all required
   * screening current, lib/domain/eligibility.ts), serves the area, and has verified experience with
   * this repair or make (or declares the repair type). Ordered by relevant verified
   * experience; price is never an input.
   */
  private qualifiedMechanics(category: RepairRequest["repairCategory"], make: Vehicle["make"], areaKey?: string, mobileRequired?: boolean): ID[] {
    const d = db();
    const area = findArea(areaKey);
    return d.mechanics
      .filter((m) => !mobileRequired || m.workModel !== "shop")
      .filter((m) => !area || serves(m, area))
      .filter((m) => eligibility(toPublicProfile(this.getMechanicSources(m.id))).eligible)
      .map((m) => ({ m, key: relevanceKey(d.pastRepairs.filter((r) => r.mechanicId === m.id), category, make) }))
      .filter(({ m, key }) => key[1] > 0 || key[2] > 0 || m.declaredRepairCategories.includes(category))
      .sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
        return 0;
      })
      .map(({ m }) => m.id);
  }

  respondToQuestion(requestId: ID, questionIndex: number, response: string, attachments: RepairMedia[]) {
    const q = this.getRequest(requestId)?.questions[questionIndex];
    if (!q || (!response.trim() && !attachments.length)) return;
    q.response = response.trim() || undefined;
    q.respondedAt = today();
    q.attachments = [...q.attachments, ...attachments];
    this.notifyMechanic(q.mechanicId, "customer_answered", `${this.getCustomer(q.customerId)?.displayName} answered your question`, `/mechanic/requests/${requestId}`, response || undefined);
  }

  getDraft(customerId: ID) {
    return db().drafts[customerId];
  }
  saveDraft(customerId: ID, draft: IntakeDraft) {
    db().drafts[customerId] = draft;
  }
  clearDraft(customerId: ID) {
    delete db().drafts[customerId];
  }

  acceptQuote(quoteId: ID): Job {
    const d = db();
    const q = this.getQuote(quoteId)!;
    // Same rule as everywhere else: a mechanic whose required screening isn't current can't be booked.
    if (!eligibility(toPublicProfile(this.getMechanicSources(q.mechanicId))).eligible) throw new Error("This mechanic can't be booked right now.");
    const req = this.getRequest(q.requestId)!;
    for (const other of d.quotes.filter((x) => x.requestId === q.requestId && x.status !== "draft")) {
      if (other.id === q.id) other.status = "accepted";
      else if (other.status === "submitted") Object.assign(other, { status: "declined", closedReason: "chose_other" });
    }
    req.status = "booked";
    // Job title from the mechanic's own scope: first clause, cut at a word boundary.
    const clause = q.scope.split(/[.;]/)[0].trim();
    const title = clause.length <= 60 ? clause : `${clause.slice(0, 57).replace(/\s+\S*$/, "")}…` || `${REPAIR_LABEL[req.repairCategory]} work`;
    const job: Job = {
      id: newId("job"),
      quoteId: q.id,
      requestId: req.id,
      mechanicId: q.mechanicId,
      customerId: req.customerId,
      vehicleId: req.vehicleId,
      repairCategory: req.repairCategory,
      title,
      status: "scheduled",
      scheduledFor: q.availableOn,
      vehicleSpec: req.vehicleSpec ?? this.getVehicle(req.vehicleId)?.spec,
    };
    d.jobs.push(job);
    const v = this.getVehicle(req.vehicleId);
    this.notifyMechanic(q.mechanicId, "quote_accepted", `Estimate approved: ${v?.year} ${v?.make} ${v?.model}`, `/mechanic/jobs/${job.id}`, `Booked for ${q.availableOn}.`);
    this.notifyCustomer(req.customerId, "job_scheduled", `Booked with ${this.getMechanic(q.mechanicId)?.displayName}`, `/customer/jobs/${job.id}`, q.availableOn);
    return job;
  }

  submitReview(jobId: ID, input: Parameters<RepositoryCore["submitReview"]>[1]) {
    const d = db();
    const job = this.getJob(jobId);
    if (!job || this.getReviewForJob(jobId)) return;
    const v = this.getVehicle(job.vehicleId)!;
    const c = this.getCustomer(job.customerId)!;
    const repair = d.pastRepairs.find((r) => r.jobId === jobId);
    const [first, last] = c.displayName.split(" ");
    d.reviews.push({
      ...input,
      id: newId("rev"),
      mechanicId: job.mechanicId,
      kind: "verified_job",
      jobId,
      pastRepairId: repair?.id,
      authorName: last ? `${first} ${last[0]}.` : first,
      vehicleLabel: `${v.year} ${v.make} ${v.model}`,
      repairLabel: job.title,
      createdAt: today(),
    });
    this.notifyMechanic(job.mechanicId, "new_review", `New verified review: ${input.overall} stars from ${first}`, `/mechanic/reputation`);
  }

  toggleSaved(customerId: ID, mechanicId: ID) {
    const d = db();
    const i = d.saved.findIndex((s) => s.customerId === customerId && s.mechanicId === mechanicId);
    if (i >= 0) {
      d.saved.splice(i, 1);
      return false;
    }
    d.saved.push({ customerId, mechanicId, savedAt: today() });
    return true;
  }

  // ------------------------------------------------------------- accounts
  getUserByEmail(email: string) {
    return db().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  createUser(input: { id?: ID; name: string; email: string; phone?: string; role: "customer" | "mechanic"; avatarUrl?: string }) {
    const d = db();
    const user: User = {
      id: input.id ?? newId("user"),
      avatarUrl: input.avatarUrl,
      roles: [input.role] as User["roles"],
      name: input.name,
      email: input.email,
      phone: input.phone,
      notificationPrefs: { email: true, sms: Boolean(input.phone), push: true },
      createdAt: today(),
    };
    d.users.push(user);
    if (input.role === "customer") this.addCustomerProfile(user.id);
    return user;
  }

  addCustomerProfile(userId: ID) {
    const d = db();
    const u = this.getUser(userId)!;
    const existing = d.customers.find((c) => c.userId === userId);
    if (existing) return existing;
    if (!u.roles.includes("customer")) u.roles.push("customer");
    const c = { id: newId("cust"), userId, displayName: u.name, city: "Los Angeles" };
    d.customers.push(c);
    return c;
  }

  grantAdmin(userId: ID) {
    const u = this.getUser(userId);
    if (u && !u.roles.includes("admin")) u.roles.push("admin");
  }

  updateUser(userId: ID, patch: Partial<Pick<User, "name" | "email" | "phone" | "notificationPrefs" | "avatarUrl">>) {
    const u = this.getUser(userId);
    if (u) Object.assign(u, patch);
  }

  getCustomerByUser(userId: ID) {
    return db().customers.find((c) => c.userId === userId);
  }

  getMechanicByUser(userId: ID) {
    return db().mechanics.find((m) => m.userId === userId);
  }

  // -------------------------------------------------------- notifications
  notify(userId: ID, mode: AppMode, kind: NotificationKind, title: string, href: string, body?: string) {
    db().notifications.push({ id: newId("ntf"), userId, mode, kind, title, body, href, createdAt: nowISO(), read: false });
  }
  private notifyCustomer(customerId: ID, kind: NotificationKind, title: string, href: string, body?: string) {
    const c = this.getCustomer(customerId);
    if (c) this.notify(c.userId, "customer", kind, title, href, body);
  }
  private notifyMechanic(mechanicId: ID, kind: NotificationKind, title: string, href: string, body?: string) {
    const m = this.getMechanic(mechanicId);
    if (m) this.notify(m.userId, "mechanic", kind, title, href, body);
  }
  listNotifications(userId: ID, mode: AppMode) {
    return db()
      .notifications.filter((n) => n.userId === userId && n.mode === mode)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  markNotificationsRead(userId: ID, mode: AppMode) {
    for (const n of db().notifications) if (n.userId === userId && n.mode === mode) n.read = true;
  }

  findRequestWithMedia(mediaId: ID) {
    return db().requests.find((r) => r.media.some((m) => m.id === mediaId) || r.questions.some((q) => q.attachments.some((a) => a.id === mediaId)));
  }

  // ---------------------------------------------------- quote questions
  listQuotesForCustomer(customerId: ID) {
    const reqIds = new Set(this.listRequestsForCustomer(customerId).map((r) => r.id));
    return db().quotes.filter((q) => reqIds.has(q.requestId) && q.status !== "draft");
  }
  askAboutQuote(quoteId: ID, question: string) {
    const q = this.getQuote(quoteId);
    if (!q || !question.trim()) return;
    q.customerQuestions.push({ question: question.trim(), askedAt: today() });
    const r = this.getRequest(q.requestId);
    this.notifyMechanic(q.mechanicId, "customer_question", `${r ? this.getCustomer(r.customerId)?.displayName : "A customer"} asked about your estimate`, `/mechanic/quotes`, question.trim());
  }
  answerQuoteQuestion(quoteId: ID, index: number, answer: string) {
    const q = this.getQuote(quoteId);
    const item = q?.customerQuestions[index];
    if (!q || !item || !answer.trim()) return;
    item.answer = answer.trim();
    item.answeredAt = today();
    const r = this.getRequest(q.requestId);
    if (r) this.notifyCustomer(r.customerId, "quote_updated", `${this.getMechanic(q.mechanicId)?.displayName} answered your question`, `/customer/quotes`, answer.trim());
  }

  // ------------------------------------------------------------- vehicles
  addVehicle(customerId: ID, v: Omit<Vehicle, "id" | "customerId">) {
    const veh = { ...v, id: newId("veh"), customerId };
    db().vehicles.push(veh);
    return veh;
  }
  updateVehicle(vehicleId: ID, patch: Partial<Omit<Vehicle, "id" | "customerId">>) {
    const v = this.getVehicle(vehicleId);
    if (v) Object.assign(v, patch);
  }
  /** Maintenance record: every Clutch repair on this vehicle, newest first. */
  listVehicleHistory(vehicleId: ID) {
    const d = db();
    const jobIds = new Set(d.jobs.filter((j) => j.vehicleId === vehicleId).map((j) => j.id));
    const v = this.getVehicle(vehicleId);
    return d.pastRepairs
      .filter((r) => r.source === "platform" && ((r.jobId && jobIds.has(r.jobId)) || (v && r.customerId === v.customerId && r.make === v.make && r.model === v.model && r.year === v.year)))
      .sort((a, b) => (a.performedOn < b.performedOn ? 1 : -1));
  }

  // ------------------------------------------------ mechanic's customer notes
  getCustomerNote(mechanicId: ID, customerId: ID) {
    return db().customerNotes[mechanicId]?.[customerId] ?? "";
  }
  setCustomerNote(mechanicId: ID, customerId: ID, note: string) {
    const d = db();
    (d.customerNotes[mechanicId] ??= {})[customerId] = note;
  }

  track(name: AnalyticsEventName, props: Parameters<RepositoryCore["track"]>[1]) {
    const { mechanicId, actorId, variant, ...rest } = props;
    db().events.push({ id: newId("evt"), name, mechanicId, actorId, variant, props: rest, createdAt: nowISO() });
    if (process.env.NODE_ENV !== "production") console.log(`[analytics] ${name}`, JSON.stringify(props));
  }
}
