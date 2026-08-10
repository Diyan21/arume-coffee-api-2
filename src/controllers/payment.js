import { getSupabaseClient } from '../config/supabase.js';
import { createSnapTransaction, verifyMidtransSignature } from '../config/payment.js';
import { updateOrderStatus } from './orders.js';
import { successResponse, errorResponse } from '../utils/response.js';

// Idempotency cache in memory for callback deduplication
const processedCallbackMap = new Map();

/**
 * POST /api/payment/create
 * Generates or re-issues a payment transaction token for an existing pending order
 */
export const createPayment = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { order_number } = body;

    if (!order_number) {
      return errorResponse(c, 'Order number is required', null, 400);
    }

    const supabase = getSupabaseClient(c.env);
    let orderRecord = null;

    if (supabase) {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', order_number)
        .single();
      orderRecord = data;
    }

    if (!orderRecord) {
      return errorResponse(c, 'Order not found', `Order number '${order_number}' does not exist`, 404);
    }

    if (orderRecord.status === 'paid' || orderRecord.status === 'settled') {
      return errorResponse(c, 'Order already paid', `Order '${order_number}' is already paid and completed`, 400);
    }

    // Generate Midtrans Snap transaction token/link
    const paymentResult = await createSnapTransaction(c.env, {
      orderNumber: orderRecord.order_number,
      grossAmount: orderRecord.total_amount,
      customer: {
        name: orderRecord.customer_name,
        email: orderRecord.customer_email,
        phone: orderRecord.customer_phone
      }
    });

    // Update snap token in Supabase
    if (supabase) {
      await supabase
        .from('orders')
        .update({
          snap_token: paymentResult.token,
          payment_url: paymentResult.redirect_url
        })
        .eq('id', orderRecord.id);
    }

    return successResponse(c, {
      order_number,
      payment: paymentResult
    }, 'Payment transaction initiated successfully');
  } catch (err) {
    return errorResponse(c, 'Failed to create payment transaction', err, 500);
  }
};

/**
 * POST /api/payment/callback
 * Handles Midtrans Payment Webhook Notifications with Idempotency check and Signature Verification
 */
export const handlePaymentCallback = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    // Support both Midtrans standard payload and manual test payload
    const order_id = body.order_id || body.order_number;
    const transaction_status = body.transaction_status || body.status || 'settlement';
    const fraud_status = body.fraud_status || 'accept';
    const transaction_id = body.transaction_id || `tx-${order_id}-${Date.now()}`;
    const payment_type = body.payment_type || 'qris';
    const gross_amount = body.gross_amount || 0;

    if (!order_id) {
      return errorResponse(c, 'Missing order_id in callback payload', null, 400);
    }

    // 1. Signature Verification
    const isValidSignature = await verifyMidtransSignature(c.env, body);
    if (!isValidSignature) {
      return errorResponse(c, 'Invalid payment signature', 'Signature verification failed', 403);
    }

    // 2. IDEMPOTENCY CHECK
    // Prevent duplicate processing of the same payment event
    const idempotencyKey = `${transaction_id}:${transaction_status}`;
    if (processedCallbackMap.has(idempotencyKey)) {
      return successResponse(
        c,
        {
          order_number: order_id,
          transaction_id,
          status: transaction_status,
          idempotent: true
        },
        'Callback notification already processed (Idempotent call)'
      );
    }

    const supabase = getSupabaseClient(c.env);

    if (supabase) {
      // Check if this transaction_id with status was already recorded in Supabase
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('*')
        .eq('transaction_id', transaction_id)
        .eq('transaction_status', transaction_status)
        .maybeSingle();

      if (existingPayment) {
        processedCallbackMap.set(idempotencyKey, true);
        return successResponse(
          c,
          {
            order_number: order_id,
            transaction_id,
            status: transaction_status,
            idempotent: true
          },
          'Callback notification already recorded in database'
        );
      }
    }

    // 3. Map Midtrans Status to Local Order Status
    let newOrderStatus = 'pending';

    if (transaction_status === 'capture') {
      if (fraud_status === 'accept') {
        newOrderStatus = 'paid';
      } else {
        newOrderStatus = 'challenge';
      }
    } else if (transaction_status === 'settlement') {
      newOrderStatus = 'paid';
    } else if (transaction_status === 'cancel' || transaction_status === 'deny' || transaction_status === 'expire') {
      newOrderStatus = 'failed';
    } else if (transaction_status === 'pending') {
      newOrderStatus = 'pending';
    } else if (transaction_status === 'refund' || transaction_status === 'partial_refund') {
      newOrderStatus = 'refunded';
    }

    // 4. Update Order Status
    await updateOrderStatus(c.env, order_id, newOrderStatus, {
      transaction_id,
      payment_type,
      transaction_status
    });

    // 5. Store Payment Record in Supabase `payments` table
    if (supabase) {
      await supabase.from('payments').insert({
        order_number: order_id,
        transaction_id,
        payment_type,
        gross_amount: parseFloat(gross_amount) || 0,
        transaction_status,
        fraud_status,
        raw_response: body
      });
    }

    // Mark as processed in runtime idempotency cache
    processedCallbackMap.set(idempotencyKey, true);

    return successResponse(
      c,
      {
        order_number: order_id,
        order_status: newOrderStatus,
        transaction_status,
        transaction_id
      },
      'Payment notification processed successfully'
    );
  } catch (err) {
    return errorResponse(c, 'Failed to process payment callback', err, 500);
  }
};

/**
 * POST /api/payment/check
 * Checks current payment status for an order
 */
export const checkPaymentStatus = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { order_number } = body;

    if (!order_number) {
      return errorResponse(c, 'Order number is required', null, 400);
    }

    const supabase = getSupabaseClient(c.env);

    if (supabase) {
      const { data: order } = await supabase
        .from('orders')
        .select('order_number, total_amount, status, created_at, updated_at')
        .eq('order_number', order_number)
        .single();

      if (order) {
        const { data: payments } = await supabase
          .from('payments')
          .select('*')
          .eq('order_number', order_number)
          .order('created_at', { ascending: false });

        return successResponse(c, {
          order_number: order.order_number,
          order_status: order.status,
          total_amount: order.total_amount,
          payments: payments || []
        }, 'Payment status checked successfully');
      }
    }

    return successResponse(c, {
      order_number,
      message: 'Payment status query complete'
    }, 'Payment status check complete');
  } catch (err) {
    return errorResponse(c, 'Failed to check payment status', err, 500);
  }
};
