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

async function checkPaymentStatus(reference, checkoutSignature) {
  if (!PUBLISHABLE_KEY || !SECRET_KEY) {
    throw new Error('INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY must be set');
  }

  if (!reference) {
    throw new Error('reference is required to check payment status');
  }

  const intasend = new IntaSend(PUBLISHABLE_KEY, SECRET_KEY, TEST);

  let resp;

  if (isUuid(reference)) {
    // Existing payments stored the checkout UUID, not the invoice_id.
    // Use the invoices list API to find the invoice by api_ref (which is the payment UUID).
    const listPath = `/api/v1/invoices/?api_ref=${encodeURIComponent(reference)}`;
    const listResp = await intasend.send(null, listPath, 'GET');
    console.log('[IntaSend invoices list] ref:', reference, 'resp:', JSON.stringify(listResp));

    // Try to find the invoice in the list. Common response shapes: { results: [...] } or { invoices: [...] }
    const invoices = listResp.results || listResp.invoices || listResp;
    const invoice = Array.isArray(invoices) ? invoices[0] : null;

    if (invoice) {
      // Normalize — use invoice state directly if present, otherwise query status by invoice_id
      const invoiceId = invoice.invoice_id || invoice.id;
      if (invoice.state !== undefined) {
        resp = { invoice };
      } else if (invoiceId) {
        resp = await intasend.send({ invoice_id: invoiceId }, '/api/v1/payment/status/', 'POST');
      }
    }

    if (!resp) {
      // Fallback to checkout_id status (if checkout signature is available)
      const payload = { checkout_id: reference };
      if (checkoutSignature) payload.signature = checkoutSignature;
      resp = await intasend.send(payload, '/api/v1/payment/status/', 'POST');
    }
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
