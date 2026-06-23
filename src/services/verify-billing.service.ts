import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }

  return stripeClient;
}

/**
 * Adds a one-off invoice item for a single over-allotment verification. Stripe
 * attaches it to the customer's next monthly invoice automatically, so each
 * overage verification is billed without touching the subscription.
 */
export async function chargeVerifyOverage(params: {
  stripeCustomerId: string;
  cents: number;
  accountId: string;
}): Promise<void> {
  await getStripe().invoiceItems.create({
    customer: params.stripeCustomerId,
    amount: params.cents,
    currency: "usd",
    description: "Identity verification (overage)",
    metadata: {
      accountId: params.accountId,
      kind: "verify_overage",
    },
  });
}
