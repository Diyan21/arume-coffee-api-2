/**
 * Payment Config and Midtrans Integration Service for Cloudflare Workers
 */

/**
 * Check if Midtrans Server Key is configured in environment
 */
export const isMidtransConfigured = (env = {}) => {
  const serverKey = env.MIDTRANS_SERVER_KEY || (typeof process !== 'undefined' ? process.env.MIDTRANS_SERVER_KEY : undefined);
  return Boolean(serverKey && serverKey.trim().length > 0);
};

/**
 * Creates a Midtrans Snap transaction token/link or returns MOCK payment details
 */
export const createSnapTransaction = async (env = {}, { orderNumber, grossAmount, customer, items }) => {
  const serverKey = env.MIDTRANS_SERVER_KEY || (typeof process !== 'undefined' ? process.env.MIDTRANS_SERVER_KEY : undefined);
  const isProduction = (env.MIDTRANS_ENVIRONMENT || (typeof process !== 'undefined' ? process.env.MIDTRANS_ENVIRONMENT : undefined)) === 'production';

  // If Midtrans credential is not provided, fall back to MOCK MODE
  if (!serverKey || serverKey.trim() === '' || serverKey.includes('YOUR_SERVER_KEY')) {
    const mockToken = `mock-snap-${orderNumber}-${Date.now()}`;
    const mockUrl = `https://app.sandbox.midtrans.com/snap/v1/transactions/mock?token=${mockToken}`;
    return {
      is_mock: true,
      mode: 'MOCK_PAYMENT_MODE',
      token: mockToken,
      redirect_url: mockUrl,
      message: 'Running in Mock Payment Mode (Midtrans credentials not configured yet)'
    };
  }

  // Real Midtrans Snap API Integration
  const endpoint = isProduction
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

  // Base64 encode serverKey + ':' for Basic Auth
  const authHeader = `Basic ${btoa(serverKey.trim() + ':')}`;

  const payload = {
    transaction_details: {
      order_id: orderNumber,
      gross_amount: Math.round(grossAmount)
    },
    customer_details: customer ? {
      first_name: customer.name || 'Customer',
      email: customer.email || '',
      phone: customer.phone || ''
    } : undefined,
    item_details: Array.isArray(items) && items.length > 0
      ? items.map(item => ({
          id: String(item.product_id || item.id),
          price: Math.round(item.price),
          quantity: item.quantity,
          name: String(item.product_name || item.name || 'Coffee Item').substring(0, 50)
        }))
      : undefined
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(payload)
  });

  const responseData = await response.json();

  if (!response.ok) {
    const errorMsg = Array.isArray(responseData.error_messages)
      ? responseData.error_messages.join(', ')
      : responseData.message || 'Failed to generate Midtrans Snap transaction';
    throw new Error(errorMsg);
  }

  return {
    is_mock: false,
    mode: isProduction ? 'PRODUCTION' : 'SANDBOX',
    token: responseData.token,
    redirect_url: responseData.redirect_url
  };
};

/**
 * Verify Midtrans Webhook Signature Key using SHA-512 (Web Crypto API)
 * SHA512(order_id + status_code + gross_amount + ServerKey)
 */
export const verifyMidtransSignature = async (env = {}, callbackBody = {}) => {
  const serverKey = env.MIDTRANS_SERVER_KEY || (typeof process !== 'undefined' ? process.env.MIDTRANS_SERVER_KEY : undefined);
  
  // In mock mode, signature check passes
  if (!serverKey || serverKey.trim() === '' || serverKey.includes('YOUR_SERVER_KEY')) {
    return true;
  }

  const { order_id, status_code, gross_amount, signature_key } = callbackBody;
  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return false;
  }

  try {
    const rawString = `${order_id}${status_code}${gross_amount}${serverKey.trim()}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-512', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const calculatedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return calculatedSignature.toLowerCase() === signature_key.toLowerCase();
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
};
