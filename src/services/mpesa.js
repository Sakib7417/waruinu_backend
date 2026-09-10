const crypto = require('crypto');

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

const BASE_URL = 'https://sandbox.safaricom.co.ke';

function formatPhone(phone) {
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('0')) {
    // 0713 759 269 → 254713759269
    return `254${digits.slice(1)}`;
  }

  if (digits.startsWith('+')) {
    return digits.slice(1);
  }

  if (digits.startsWith('254')) {
    return digits;
  }

  if (digits.length === 9) {
    // 713 759 269 → 254713759269
    return `254${digits}`;
  }

  if (digits.length === 10) {
    // but 7137592692 would be missing 0. Return as 254 + all 10 → will fail.
    return `254${digits}`;
  }

  return digits;
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

async function getMpesaToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    }
  );

  if (!res.ok) {
    throw new Error(`M-Pesa OAuth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function initiateStkPush(amount, phoneNumber) {
  if (!SHORTCODE || !PASSKEY || !CALLBACK_URL) {
    throw new Error('M-Pesa shortcode, passkey or callback URL not configured');
  }

  const token = await getMpesaToken();
  const timestamp = formatTimestamp(new Date());
  const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
  const phone = formatPhone(phoneNumber);

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: 'WARUINU',
    TransactionDesc: 'Membership payment',
  };

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.errorMessage || `STK push failed: ${res.status}`);
  }

  if (data.ResponseCode !== '0') {
    throw new Error(data?.ResponseDescription || 'STK push was not accepted');
  }

  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID,
    responseDescription: data.ResponseDescription,
  };
}

module.exports = {
  getMpesaToken,
  initiateStkPush,
  formatPhone,
};
