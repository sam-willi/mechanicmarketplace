import type { VerificationMethod } from "@/lib/domain/types";

/**
 * Who checked it, in the words customers see ("verified by Stripe Identity"). A test or demo
 * provider says so plainly, so nothing reads as a real check that wasn't one.
 */
export function verifierName(provider: string | undefined, method: VerificationMethod | undefined): string {
  switch (provider) {
    case "stripe_identity":
      return "Stripe Identity";
    case "test":
      return "Clutch's test provider (not a real check)";
    case "mock":
      return "a demo provider (fictional)";
    case "provider-under-test":
      return "a test provider";
  }
  switch (method) {
    case "email_link":
      return "email confirmation";
    case "sms_code":
      return "a text-message code";
    case "customer_confirmation":
      return "the customer";
    case "platform_job":
      return "a completed Clutch job";
    case "institution_check":
      return "the issuer, checked by Clutch staff";
    case "employer_check":
      return "the employer, checked by Clutch staff";
    case "vendor_screening":
      return "a screening provider";
    case "hosted_identity":
      return "an identity provider";
    default:
      return "Clutch staff";
  }
}
