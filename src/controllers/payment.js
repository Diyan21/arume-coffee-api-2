import { getSupabaseClient } from '../config/supabase.js';
import {
  createSnapTransaction,
  verifyMidtransSignature
} from '../config/payment.js';

import {
  updateOrderStatus,
  adjustStockForOrder
} from './orders.js';

import {
  successResponse,
  errorResponse
} from '../utils/response.js';

// Runtime cache.
// Hanya lapisan tambahan.
// Proteksi utama tetap berasal dari Supabase.
const processedCallbackMap = new Map();

/**
 * POST /api/payment/create
 *
 * Generate / re-issue Midtrans payment
 * untuk order yang sudah ada.
 */
export const createPayment = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const {
      order_number
    } = body;

    if (!order_number) {
      return errorResponse(
        c,
        'Order number is required',
        null,
        400
      );
    }

    const supabase =
      getSupabaseClient(c.env);

    let orderRecord = null;

    if (supabase) {
      const {
        data,
        error
      } = await supabase
        .from('orders')
        .select('*')
        .eq(
          'order_number',
          order_number
        )
        .single();

      if (error) {
        console.error(
          'Failed to find order:',
          error
        );
      }

      orderRecord = data;
    }

    if (!orderRecord) {
      return errorResponse(
        c,
        'Order not found',
        `Order number '${order_number}' does not exist`,
        404
      );
    }

    // Jangan generate pembayaran baru
    // untuk order yang sudah lunas.
    if (
      orderRecord.status === 'paid' ||
      orderRecord.status === 'settled'
    ) {
      return errorResponse(
        c,
        'Order already paid',
        `Order '${order_number}' is already paid and completed`,
        400
      );
    }

    // Kalau order masih punya Snap token,
    // bisa dikembalikan lagi supaya user
    // tidak terus membuat transaksi baru.
    if (
      orderRecord.status === 'pending' &&
      orderRecord.snap_token &&
      orderRecord.payment_url
    ) {
      return successResponse(
        c,
        {
          order_number,
          payment: {
            token:
              orderRecord.snap_token,

            redirect_url:
              orderRecord.payment_url,

            reused:
              true
          }
        },
        'Existing payment transaction returned'
      );
    }

    // ================================
    // CREATE MIDTRANS SNAP
    // ================================

    const paymentResult =
      await createSnapTransaction(
        c.env,
        {
          orderNumber:
            orderRecord.order_number,

          grossAmount:
            orderRecord.total_amount,

          customer: {
            name:
              orderRecord.customer_name,

            email:
              orderRecord.customer_email,

            phone:
              orderRecord.customer_phone
          }
        }
      );

    // ================================
    // SAVE SNAP TOKEN
    // ================================

    if (
      supabase &&
      paymentResult?.token
    ) {
      const {
        error: updateError
      } = await supabase
        .from('orders')
        .update({
          snap_token:
            paymentResult.token,

          payment_url:
            paymentResult.redirect_url
        })
        .eq(
          'id',
          orderRecord.id
        );

      if (updateError) {
        console.error(
          'Failed saving Snap token:',
          updateError
        );
      }
    }

    return successResponse(
      c,
      {
        order_number,
        payment:
          paymentResult
      },
      'Payment transaction initiated successfully'
    );
  } catch (err) {
    console.error(
      'Create Payment Error:',
      err
    );

    return errorResponse(
      c,
      'Failed to create payment transaction',
      err.message ||
      err,
      500
    );
  }
};


/**
 * POST /api/payment/callback
 *
 * Handle Midtrans webhook.
 *
 * Flow:
 *
 * pending
 *   -> stok tidak berubah
 *
 * settlement
 *   -> paid
 *   -> stok dipotong
 *
 * duplicate settlement
 *   -> tidak diproses ulang
 *
 * refund
 *   -> refunded
 *   -> stok dikembalikan
 */
export const handlePaymentCallback = async (c) => {
  try {
    const body =
      await c.req.json().catch(
        () => ({})
      );

    // ================================
    // MIDTRANS PAYLOAD
    // ================================

    const order_id =
      body.order_id ||
      body.order_number;

    const transaction_status =
      body.transaction_status ||
      body.status ||
      'settlement';

    const fraud_status =
      body.fraud_status ||
      'accept';

    const transaction_id =
      body.transaction_id ||
      `tx-${order_id}-${Date.now()}`;

    const payment_type =
      body.payment_type ||
      'qris';

    const gross_amount =
      body.gross_amount ||
      0;

    if (!order_id) {
      return errorResponse(
        c,
        'Missing order_id in callback payload',
        null,
        400
      );
    }

    // ================================
    // 1. VERIFY MIDTRANS SIGNATURE
    // ================================

    const isValidSignature =
      await verifyMidtransSignature(
        c.env,
        body
      );

    if (!isValidSignature) {
      return errorResponse(
        c,
        'Invalid payment signature',
        'Signature verification failed',
        403
      );
    }

    // ================================
    // 2. IDEMPOTENCY KEY
    // ================================

    const idempotencyKey =
      `${transaction_id}:${transaction_status}`;

    if (
      processedCallbackMap.has(
        idempotencyKey
      )
    ) {
      return successResponse(
        c,
        {
          order_number:
            order_id,

          transaction_id,

          status:
            transaction_status,

          idempotent:
            true
        },
        'Callback notification already processed'
      );
    }

    const supabase =
      getSupabaseClient(
        c.env
      );

    // ================================
    // 3. CHECK DATABASE CALLBACK
    // ================================

    if (supabase) {
      const {
        data: existingPayment,
        error: paymentLookupError
      } = await supabase
        .from('payments')
        .select(
          'id, transaction_id, transaction_status'
        )
        .eq(
          'transaction_id',
          transaction_id
        )
        .eq(
          'transaction_status',
          transaction_status
        )
        .maybeSingle();

      if (paymentLookupError) {
        console.error(
          'Payment lookup error:',
          paymentLookupError
        );
      }

      if (existingPayment) {
        processedCallbackMap.set(
          idempotencyKey,
          true
        );

        return successResponse(
          c,
          {
            order_number:
              order_id,

            transaction_id,

            status:
              transaction_status,

            idempotent:
              true
          },
          'Callback notification already recorded in database'
        );
      }
    }

    // ================================
    // 4. MAP MIDTRANS STATUS
    // ================================

    let newOrderStatus =
      'pending';

    if (
      transaction_status ===
      'capture'
    ) {
      if (
        fraud_status ===
        'accept'
      ) {
        newOrderStatus =
          'paid';
      } else {
        newOrderStatus =
          'challenge';
      }

    } else if (
      transaction_status ===
      'settlement'
    ) {
      newOrderStatus =
        'paid';

    } else if (
      transaction_status ===
        'cancel' ||
      transaction_status ===
        'deny' ||
      transaction_status ===
        'expire'
    ) {
      newOrderStatus =
        'failed';

    } else if (
      transaction_status ===
      'pending'
    ) {
      newOrderStatus =
        'pending';

    } else if (
      transaction_status ===
      'refund'
    ) {
      newOrderStatus =
        'refunded';

    } else if (
      transaction_status ===
      'partial_refund'
    ) {
      // Jangan otomatis balikin stock.
      // Kita belum tahu item/qty mana
      // yang direfund.
      newOrderStatus =
        'partial_refund';
    }

    // ================================
    // 5. UPDATE ORDER STATUS
    // ================================

    await updateOrderStatus(
      c.env,
      order_id,
      newOrderStatus,
      {
        transaction_id,
        payment_type,
        transaction_status
      }
    );

    // ================================
    // 6. STOCK MANAGEMENT
    // ================================

    // Pembayaran berhasil:
    // potong stok sekali saja.
    if (
      newOrderStatus ===
      'paid'
    ) {
      try {
        const stockResult =
          await adjustStockForOrder(
            c.env,
            order_id,
            'decrease'
          );

        console.log(
          'Stock deduction result:',
          stockResult
        );
      } catch (stockError) {
        console.error(
          'Stock deduction failed:',
          stockError
        );

        /*
         * Jangan return error webhook di sini.
         *
         * Midtrans bisa retry callback.
         * Order sudah paid, jadi error stok
         * harus dicatat untuk monitoring.
         */
      }
    }

    // Full refund:
    // kembalikan stock sekali.
    if (
      newOrderStatus ===
      'refunded'
    ) {
      try {
        const stockResult =
          await adjustStockForOrder(
            c.env,
            order_id,
            'increase'
          );

        console.log(
          'Stock restoration result:',
          stockResult
        );
      } catch (stockError) {
        console.error(
          'Stock restoration failed:',
          stockError
        );
      }
    }

    // ================================
    // 7. STORE PAYMENT HISTORY
    // ================================

    if (supabase) {
      const {
        error: paymentInsertError
      } = await supabase
        .from('payments')
        .insert({
          order_number:
            order_id,

          transaction_id,

          payment_type,

          gross_amount:
            parseFloat(
              gross_amount
            ) || 0,

          transaction_status,

          fraud_status,

          raw_response:
            body
        });

      if (paymentInsertError) {
        console.error(
          'Payment history insert error:',
          paymentInsertError
        );
      }
    }

    // ================================
    // 8. MARK CALLBACK PROCESSED
    // ================================

    processedCallbackMap.set(
      idempotencyKey,
      true
    );

    // ================================
    // 9. RESPONSE TO MIDTRANS
    // ================================

    return successResponse(
      c,
      {
        order_number:
          order_id,

        order_status:
          newOrderStatus,

        transaction_status,

        transaction_id
      },
      'Payment notification processed successfully'
    );

  } catch (err) {
    console.error(
      'Payment Callback Error:',
      err
    );

    return errorResponse(
      c,
      'Failed to process payment callback',
      err.message ||
      err,
      500
    );
  }
};


/**
 * POST /api/payment/check
 *
 * Check local payment status
 */
export const checkPaymentStatus = async (c) => {
  try {
    const body =
      await c.req.json().catch(
        () => ({})
      );

    const {
      order_number
    } = body;

    if (!order_number) {
      return errorResponse(
        c,
        'Order number is required',
        null,
        400
      );
    }

    const supabase =
      getSupabaseClient(
        c.env
      );

    if (supabase) {
      const {
        data: order,
        error: orderError
      } = await supabase
        .from('orders')
        .select(`
          order_number,
          total_amount,
          status,
          stock_processed,
          stock_restored,
          created_at,
          updated_at
        `)
        .eq(
          'order_number',
          order_number
        )
        .single();

      if (
        orderError
      ) {
        console.error(
          'Order status lookup error:',
          orderError
        );
      }

      if (order) {
        const {
          data: payments,
          error: paymentsError
        } = await supabase
          .from('payments')
          .select('*')
          .eq(
            'order_number',
            order_number
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          );

        if (
          paymentsError
        ) {
          console.error(
            'Payment history lookup error:',
            paymentsError
          );
        }

        return successResponse(
          c,
          {
            order_number:
              order.order_number,

            order_status:
              order.status,

            total_amount:
              order.total_amount,

            stock_processed:
              order.stock_processed,

            stock_restored:
              order.stock_restored,

            payments:
              payments ||
              []
          },
          'Payment status checked successfully'
        );
      }
    }

    return errorResponse(
      c,
      'Order not found',
      `Order '${order_number}' does not exist`,
      404
    );

  } catch (err) {
    console.error(
      'Check Payment Status Error:',
      err
    );

    return errorResponse(
      c,
      'Failed to check payment status',
      err.message ||
      err,
      500
    );
  }
};
