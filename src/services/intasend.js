require('dotenv').config();
const IntaSend = require('intasend-node');

const PUBLISHABLE_KEY = process.env.INTASEND_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.INTASEND_SECRET_KEY;
const TEST = process.env.INTASEND_TEST !== 'false';

function splitName(name) {
  if (!name || typeof name !== 'string') return { firstName: 'Customer', lastName: '' };
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractInvoiceId(resp) {
  const candidates = [
    resp?.invoice?.invoice_id,
    resp?.invoice?.id,
    resp?.invoice_id,
    resp?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length <= 15) return c;
  }
  // Fallback to original logic if nothing short found
  return resp?.invoice_id || resp?.id;
}

async function initiateCheckout({
  amount,
  currency,
  email,
  name,
  phoneNumber,
  apiRef,
  redirectUrl,
  callbackUrl,
  method,
}) {
  if (!PUBLISHABLE_KEY || !SECRET_KEY) {
    throw new Error('INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY must be set');
  }

  const intasend = new IntaSend(PUBLISHABLE_KEY, SECRET_KEY, TEST);
  const collection = intasend.collection();

  const { firstName, lastName } = splitName(name);

  const payload = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone_number: phoneNumber || undefined,
    amount,
    currency,
    api_ref: apiRef,
    redirect_url: redirectUrl,
    callback_url: callbackUrl,
  };

  if (method) payload.method = method;

  const resp = await collection.charge(payload);

  console.log('[IntaSend checkout] raw response:', JSON.stringify(resp));

  return {
    invoiceId: extractInvoiceId(resp),
    apiRef,
    checkoutUrl: resp.url,
  };
}

async function checkPaymentStatus(reference) {
  if (!PUBLISHABLE_KEY || !SECRET_KEY) {
    throw new Error('INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY must be set');
  }

  if (!reference) {
    throw new Error('reference is required to check payment status');
  }

  const intasend = new IntaSend(PUBLISHABLE_KEY, SECRET_KEY, TEST);

  let resp;

  // Existing payments stored the api_ref (UUID). New ones store the short invoice_id.
  // Try the appropriate endpoint based on the input format.
  if (isUuid(reference)) {
    resp = await intasend.send({ api_ref: reference }, '/api/v1/payment/status/', 'POST');
  } else {
    resp = await intasend.send({ invoice_id: reference }, '/api/v1/payment/status/', 'POST');
  }

  console.log('[IntaSend status] ref:', reference, 'resp:', JSON.stringify(resp));

  // Normalize the response — IntaSend returns { invoice: { state, ... } }
  const invoice = resp.invoice || resp;
  return {
    invoiceId: invoice.invoice_id || invoice.id || reference,
    state: invoice.state,
    failedReason: invoice.failed_reason || null,
    raw: resp,
  };
}

module.exports = {
  initiateCheckout,
  checkPaymentStatus,
};
