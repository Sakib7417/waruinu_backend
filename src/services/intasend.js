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

  return {
    invoiceId: resp.invoice_id || resp.id,
    checkoutUrl: resp.url,
  };
}

module.exports = {
  initiateCheckout,
};
